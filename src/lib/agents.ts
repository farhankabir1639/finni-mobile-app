import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', BDT: '৳', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', INR: '₹',
};
function getCurrencySymbol(code?: string | null): string {
  return CURRENCY_SYMBOLS[code ?? 'USD'] ?? code ?? '$';
}

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

if (!GEMINI_API_KEY) {
  console.error('[Agent] EXPO_PUBLIC_GEMINI_API_KEY is not configured. All AI features will fail.');
}

function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil((((now.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
}

const RETRY_DELAYS = [1500, 3000, 5000];

async function callGemini(prompt: string, retryCount = 0): Promise<string> {
  return callGeminiWithHistory([{ role: 'user', parts: [{ text: prompt }] }], retryCount);
}

async function callGeminiWithHistory(
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
  retryCount = 0
): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key is not configured');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    console.log('[Agent1] Gemini response status:', res.status);
    if (!res.ok) {
      const status = res.status;
      if ((status === 503 || status === 429) && retryCount < 3) {
        const delay = RETRY_DELAYS[retryCount];
        console.log(`[Gemini] ${status} error, retrying in ${delay}ms (attempt ${retryCount + 1}/3)`);
        await new Promise((r) => setTimeout(r, delay));
        return callGeminiWithHistory(contents, retryCount + 1);
      }
      if (status === 503) throw new Error('Gemini is experiencing high demand. Please try again in a moment.');
      if (status === 429) throw new Error('Rate limit reached. Please wait a moment before trying again.');
      if (status === 400) throw new Error('Gemini API error: 400');
      throw new Error(`Gemini API error: ${status}`);
    }
    const data = await res.json();
    console.log('[Agent1] Gemini data:', JSON.stringify(data).slice(0, 200));
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty Gemini response');
    return text;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') throw new Error('Gemini request timed out');
    throw e;
  }
}

// --- AGENT 1: Parse transaction from receipt/text ---
export type ParsedTransaction = {
  amount: number;
  description: string;
  category: string;
  date: string;
  type: 'expense' | 'income';
} | null;

export type ParseTransactionResult = {
  response: string;
  transaction: ParsedTransaction;
};

export async function parseTransaction(input: string): Promise<ParseTransactionResult> {
  try {
    const prompt = `Parse this receipt/transaction text into structured data. Return ONLY valid JSON, no markdown or extra text.
Format: { "amount": number, "description": "string", "category": "string", "date": "YYYY-MM-DD", "type": "expense"|"income" }
If you cannot parse it, return: { "amount": 0, "description": "", "category": "", "date": "", "type": "expense" }

Input: ${input}`;
    const text = await callGemini(prompt);
    const cleaned = text.replace(/```json?|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as ParsedTransaction;
    if (parsed && typeof parsed.amount === 'number' && parsed.description) {
      return {
        response: `Parsed: ${parsed.description} - ${Math.abs(parsed.amount).toFixed(2)}`,
        transaction: parsed,
      };
    }
    return { response: "I couldn't parse that. Try entering the amount and description manually.", transaction: null };
  } catch (e) {
    console.error('[Agent1] parseTransaction Error:', e);
    return {
      response: "I'm having trouble connecting right now. Please try again in a moment. 🔄",
      transaction: null,
    };
  }
}

// --- AGENT 2: Daily insights (cached by date) ---
export type DailyInsight = {
  // Enriched format
  title?: string;
  description?: string;
  type?: 'warning' | 'tip' | 'goal' | 'income_alert';
  // Legacy format (backward compat with old cached insights)
  summary?: string;
  topCategory?: string;
  suggestion?: string;
};

export async function getDailyInsights(
  userId: string,
  transactions: { withdrawal?: number; deposit?: number; description: string | null; category: string | null; date: string; type?: string }[],
  userPrompt?: string
): Promise<DailyInsight[]> {
  console.log('[Agent2] Running insights for user:', userId);
  console.log('[Agent2] Transactions found:', transactions?.length);

  const _now = new Date();
  const _localDate = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  const cacheKey = `insights_${userId}_${_localDate}`;
  const cached = await AsyncStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  const realTransactions = (transactions ?? []).filter((t) => {
    const amount = t.type === 'expense' ? (Number(t.withdrawal) || 0) : (Number(t.deposit) || 0);
    const desc = (t.description ?? '').trim();
    return amount > 0 && desc.length >= 2 && (t.type === 'expense' || t.type === 'income');
  });

  const MIN_TRANSACTIONS = 50;
  if (realTransactions.length < MIN_TRANSACTIONS) {
    return [{
      title: 'Building your insights...',
      description: `Finni needs at least ${MIN_TRANSACTIONS} real transactions to generate accurate, personalized insights. You have ${realTransactions.length} so far — keep logging!`,
      type: 'tip',
    }];
  }

  const totalSpent = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + (Number(t.withdrawal) || 0), 0);
  const totalIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + (Number(t.deposit) || 0), 0);

  const normalized = transactions.slice(0, 50).map((t) => ({
    ...t,
    amount: t.type === 'expense' ? (Number(t.withdrawal) || 0) : (Number(t.deposit) || 0),
  }));

  // Fetch enriched context
  const [profileRes, goalsRes, incomeRes, catRes] = await Promise.all([
    supabase.from('profiles').select('name, currency').eq('id', userId).maybeSingle(),
    supabase.from('financial_goals').select('name, target_amount, current_amount, goal_type, status').eq('user_id', userId),
    supabase.from('income').select('label, amount, frequency').eq('user_id', userId),
    supabase.from('categories').select('name, budget, spent').eq('user_id', userId),
  ]);

  const profile = profileRes.data as { name?: string; currency?: string } | null;
  const goals = (goalsRes.data ?? []) as { name: string; target_amount: number; current_amount: number; goal_type?: string; status?: string }[];
  const income = (incomeRes.data ?? []) as { label: string; amount: number; frequency: string }[];
  const catBudgets = (catRes.data ?? []) as { name: string; budget: number; spent: number }[];

  const totalMonthlyIncome = income.reduce((sum, inc) => {
    const amt = Number(inc.amount) || 0;
    if (inc.frequency === 'weekly') return sum + amt * 4.33;
    if (inc.frequency === 'annual') return sum + amt / 12;
    return sum + amt;
  }, 0);

  const currency = profile?.currency ?? 'USD';
  const name = profile?.name ?? 'User';

  const goalsContext = goals.length
    ? goals.map((g) => `- ${g.name}: Target ${currency} ${g.target_amount}, Current ${currency} ${g.current_amount} (${g.goal_type ?? 'saving'}, ${g.status ?? 'in_progress'})`).join('\n')
    : 'No goals set yet.';

  const categoryBudgetContext = catBudgets.filter((c) => Number(c.budget) > 0).length
    ? catBudgets
        .filter((c) => Number(c.budget) > 0)
        .map((c) => {
          const over = Number(c.spent) > Number(c.budget);
          return `- ${c.name}: Budget ${currency} ${Number(c.budget).toFixed(2)}, Spent ${currency} ${Number(c.spent).toFixed(2)}${over ? ' ⚠ OVER BUDGET' : ''}`;
        })
        .join('\n')
    : 'No category budgets set.';

  const incomeContext = income.length
    ? income.map((i) => `- ${i.label}: ${currency} ${i.amount} ${i.frequency}`).join('\n')
    : 'No income recorded.';

  const incomeAlertInstruction = totalMonthlyIncome > 0
    ? `INCOME THRESHOLD ALERT: If total monthly spending (${totalSpent.toFixed(2)} ${currency}) exceeds 80% of monthly income (${totalMonthlyIncome.toFixed(2)} ${currency}), add exactly ONE insight with type "income_alert" encouraging specific action to reduce spending or find additional income.`
    : 'Do NOT emit income_alert type insights — no income is recorded yet.';

  try {
    const prompt = `You are Finni, a personal AI finance coach. Generate highly personalized financial insights for this user.

USER PROFILE:
- Name: ${name}
- Currency: ${currency} (use this to infer regional context — e.g. BDT = Bangladesh, INR = India, GBP = UK, AUD = Australia, SGD = Singapore — tailor advice to local costs and norms)
- Total Monthly Income: ${currency} ${totalMonthlyIncome.toFixed(2)}

FINANCIAL GOALS:
${goalsContext}

CATEGORY BUDGETS (monthly limits set by user):
${categoryBudgetContext}

INCOME SOURCES:
${incomeContext}

TRANSACTION HISTORY (recent, up to 50):
Total Spent: ${currency} ${totalSpent.toFixed(2)}, Total Income Logged: ${currency} ${totalIncome.toFixed(2)}
${JSON.stringify(normalized)}

INSTRUCTIONS:
1. Analyze spending per category against its budget — flag any category marked OVER BUDGET as a warning.
2. Track progress toward each financial goal and state clearly if on track or falling behind.
3. Use ${currency} for all amounts.
4. ${incomeAlertInstruction}
5. Be warm, encouraging, and coach-like — not robotic.
6. Generate exactly 3-4 insights total.
${userPrompt ? `7. ADDITIONAL INSTRUCTIONS FROM USER: ${userPrompt}` : ''}

Respond ONLY with a valid JSON array (no markdown):
[{ "title": "...", "description": "...", "suggestion": "...", "type": "warning|tip|goal|income_alert" }]`;

    const text = await callGemini(prompt);
    const cleaned = text.replace(/```json?|```/g, '').trim();
    let insights: DailyInsight[];
    try {
      insights = JSON.parse(cleaned);
      if (!Array.isArray(insights)) insights = [];
    } catch (parseErr) {
      console.error('[Agent2] JSON parse Error:', parseErr);
      insights = [];
    }
    await AsyncStorage.setItem(cacheKey, JSON.stringify(insights));

    // Clean up stale insight cache keys from the past 7 days
    const cleanupKeys: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      cleanupKeys.push(`insights_${userId}_${dateStr}`);
    }
    await AsyncStorage.multiRemove(cleanupKeys);

    return insights;
  } catch (e) {
    console.error('[Agent2] Error:', e);
    return [];
  }
}

// --- AGENT 3 + 4: Weekly savings recommendations (cached by week) ---
export type SavingsRecommendation = {
  title: string;
  description: string;
  potentialSavings: string;
};

export async function getWeeklySavingsRecommendations(
  userId: string,
  transactions: { withdrawal?: number; deposit?: number; description: string | null; category: string | null; date: string; type?: string }[]
): Promise<SavingsRecommendation[]> {
  console.log('[Agent3] Running savings agent');
  console.log('[Agent3] Transactions:', transactions?.length);

  const weekKey = `savings_${userId}_week_${getWeekNumber()}`;
  const cached = await AsyncStorage.getItem(weekKey);
  if (cached) return JSON.parse(cached);

  const realTx = (transactions ?? []).filter((t) => {
    const amount = t.type === 'expense' ? (Number(t.withdrawal) || 0) : (Number(t.deposit) || 0);
    const desc = (t.description ?? '').trim();
    return amount > 0 && desc.length >= 2 && (t.type === 'expense' || t.type === 'income');
  });
  if (realTx.length < 50) return [];

  const totalSpent =
    transactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + (Number(t.withdrawal) || 0), 0);
  const totalIncome =
    transactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + (Number(t.deposit) || 0), 0);

  const normalized = transactions.slice(0, 80).map((t) => ({
    ...t,
    amount: t.type === 'expense' ? (Number(t.withdrawal) || 0) : (Number(t.deposit) || 0),
  }));

  // Fetch profile for currency and location context
  const profileRes = await supabase
    .from('profiles')
    .select('currency, location, name')
    .eq('id', userId)
    .maybeSingle();
  const profile = profileRes.data as { currency?: string; location?: string; name?: string } | null;
  const currency = profile?.currency ?? 'USD';
  const location = profile?.location ?? '';
  const name = profile?.name ?? 'User';

  try {
    const prompt = `You are Finni, a personal AI finance coach. Suggest 3 highly practical, specific ways for this user to save money based on their spending patterns.

USER PROFILE:
- Name: ${name}
- Currency: ${currency}
${location ? `- Location: ${location}` : ''}

SPENDING SUMMARY:
- Total Spent: ${currency} ${totalSpent.toFixed(2)}
- Total Income Logged: ${currency} ${totalIncome.toFixed(2)}

RECENT TRANSACTIONS:
${JSON.stringify(normalized)}

Return ONLY a valid JSON array (no markdown):
[{ "title": "...", "description": "...", "potentialSavings": "..." }]
Use ${currency} for all amounts. Be specific to the user's actual spending patterns.`;

    const text = await callGemini(prompt);
    const cleaned = text.replace(/```json?|```/g, '').trim();
    let localizedResults: SavingsRecommendation[];
    try {
      localizedResults = JSON.parse(cleaned);
      if (!Array.isArray(localizedResults)) localizedResults = [];
    } catch (parseErr) {
      console.error('[Agent3] JSON parse Error:', parseErr);
      localizedResults = [];
    }
    await AsyncStorage.setItem(weekKey, JSON.stringify(localizedResults));
    return localizedResults;
  } catch (e) {
    console.error('[Agent3] Error:', e);
    return [];
  }
}

// --- Chat agent: conversational + transaction parsing ---
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

export type ChatAgentResult = {
  response: string;
  transaction: ParsedTransaction;
};

export type ChatAgentContext = {
  profile?: { name?: string; currency?: string } | null;
  categories?: { id: string; name: string; emoji?: string; budget?: number; spent?: number }[] | null;
  recentTransactions?: { withdrawal?: number; deposit?: number; description: string | null; category_id?: string | null; date: string; type?: string }[] | null;
  goals?: { name: string; target_amount?: number; current_amount?: number }[] | null;
};

const TRANSACTION_DATA_REGEX = /TRANSACTION_DATA:\s*(\{[\s\S]*?\})(?:\s|$)/;
const NEW_CATEGORY_REGEX = /NEW_CATEGORY:\s*(\{[\s\S]*?\})(?:\s|$)/;
const GOAL_UPDATE_REGEX = /GOAL_UPDATE:\s*(\{[\s\S]*?\})(?:\s|$)/;
const GOAL_CREATE_REGEX = /GOAL_CREATE:\s*(\{[\s\S]*?\})(?:\s|$)/;
const CATEGORY_BUDGET_REGEX = /CATEGORY_BUDGET:\s*(\{[\s\S]*?\})(?:\s|$)/;
const STANDALONE_CATEGORY_CREATE_REGEX = /✅ Created '([^']+)' category/i;

const CATEGORY_EMOJI_MAP: Record<string, string> = {
  food: '🍔',
  travel: '✈️',
  transport: '🚗',
  shopping: '🛍️',
  health: '💊',
  entertainment: '🎬',
  bills: '💡',
  education: '📚',
  fitness: '🏋️',
  groceries: '🛒',
  dining: '🍽️',
  coffee: '☕',
  utilities: '🔌',
  clothing: '👕',
  tech: '💻',
  other: '💰',
  miscellaneous: '💰',
  misc: '💰',
};

function extractTransactionData(text: string): {
  response: string;
  txData: Record<string, unknown> | null;
  newCategory: Record<string, unknown> | null;
  goalUpdate: { goal_name: string; amount: number } | null;
  goalCreate: { name: string; target_amount: number; goal_type: string } | null;
  categoryBudgetUpdate: { category_name: string; budget: number } | null;
  txParseError: boolean;
} {
  const txMatch = text.match(TRANSACTION_DATA_REGEX);
  const catMatch = text.match(NEW_CATEGORY_REGEX);
  const goalUpdateMatch = text.match(GOAL_UPDATE_REGEX);
  const goalCreateMatch = text.match(GOAL_CREATE_REGEX);

  let txData: Record<string, unknown> | null = null;
  let newCategory: Record<string, unknown> | null = null;
  let goalUpdate: { goal_name: string; amount: number } | null = null;
  let goalCreate: { name: string; target_amount: number; goal_type: string } | null = null;
  let txParseError = false;
  let response = text;

  if (catMatch) {
    try {
      newCategory = JSON.parse(catMatch[1]) as Record<string, unknown>;
    } catch (e) {
      console.error('[Agent] Failed to parse NEW_CATEGORY JSON:', e);
    }
    response = response.replace(NEW_CATEGORY_REGEX, '').trim();
  }
  if (goalUpdateMatch) {
    try {
      const parsed = JSON.parse(goalUpdateMatch[1]);
      if (typeof parsed.goal_name === 'string' && typeof parsed.amount === 'number') {
        goalUpdate = { goal_name: parsed.goal_name, amount: parsed.amount };
      }
    } catch (e) {
      console.error('[Agent] Failed to parse GOAL_UPDATE JSON:', e);
    }
    response = response.replace(GOAL_UPDATE_REGEX, '').trim();
  }
  if (goalCreateMatch) {
    try {
      const parsed = JSON.parse(goalCreateMatch[1]);
      if (typeof parsed.name === 'string' && typeof parsed.target_amount === 'number') {
        goalCreate = {
          name: parsed.name,
          target_amount: parsed.target_amount,
          goal_type: parsed.goal_type ?? 'saving',
        };
      }
    } catch (e) {
      console.error('[Agent] Failed to parse GOAL_CREATE JSON:', e);
    }
    response = response.replace(GOAL_CREATE_REGEX, '').trim();
  }
  if (txMatch) {
    try {
      txData = JSON.parse(txMatch[1]) as Record<string, unknown>;
    } catch (e) {
      console.error('[Agent] Failed to parse TRANSACTION_DATA JSON:', e);
      txParseError = true;
    }
    response = response.replace(TRANSACTION_DATA_REGEX, '').trim();
  }

  const catBudgetMatch = text.match(CATEGORY_BUDGET_REGEX);
  let categoryBudgetUpdate: { category_name: string; budget: number } | null = null;
  if (catBudgetMatch) {
    try {
      const parsed = JSON.parse(catBudgetMatch[1]);
      if (typeof parsed.category_name === 'string' && typeof parsed.budget === 'number') {
        categoryBudgetUpdate = { category_name: parsed.category_name, budget: parsed.budget };
      }
    } catch (e) {
      console.error('[Agent] Failed to parse CATEGORY_BUDGET JSON:', e);
    }
    response = response.replace(CATEGORY_BUDGET_REGEX, '').trim();
  }

  return { response, txData, newCategory, goalUpdate, goalCreate, categoryBudgetUpdate, txParseError };
}

export async function chatAgent(
  userMessage: string,
  userId: string,
  messages: ChatMessage[],
  context?: ChatAgentContext,
  sessionDate?: string
): Promise<ChatAgentResult> {
  console.log('[Agent1] API Key configured:', !!GEMINI_API_KEY);
  console.log('[Agent1] User ID:', userId);
  console.log('[Agent1] Message:', userMessage);

  const profile = context?.profile ?? null;
  const categories = context?.categories ?? [];
  const goals = context?.goals ?? [];

  const now = new Date();
  const todayDateStr = sessionDate ?? now.toISOString().split('T')[0];
  const sessionDateObj = sessionDate ? new Date(sessionDate) : now;
  const todayStart = new Date(sessionDateObj.getFullYear(), sessionDateObj.getMonth(), sessionDateObj.getDate()).toISOString();
  const monthStart = new Date(sessionDateObj.getFullYear(), sessionDateObj.getMonth(), 1).toISOString();

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const { data: transactions } = await supabase
    .from('transactions')
    .select('withdrawal, deposit, description, category_id, type, date')
    .eq('user_id', userId)
    .gte('date', ninetyDaysAgo.toISOString().split('T')[0])
    .order('date', { ascending: false })
    .limit(100);

  // Fetch monthly income as the budget source of truth
  const { data: incomeData } = await supabase
    .from('income')
    .select('amount, frequency')
    .eq('user_id', userId);
  const monthlyIncome = (incomeData ?? []).reduce((sum, r) => {
    const amt = Number(r.amount) || 0;
    if (r.frequency === 'weekly') return sum + amt * 4.33;
    if (r.frequency === 'annual') return sum + amt / 12;
    return sum + amt;
  }, 0);

  // Pre-calculate totals so Gemini doesn't have to do date math
  const todaySpent = (transactions ?? [])
    .filter((t) => t.type === 'expense' && t.date >= todayStart)
    .reduce((sum, t) => sum + (Number(t.withdrawal) || 0), 0);
  const monthSpent = (transactions ?? [])
    .filter((t) => t.type === 'expense' && t.date >= monthStart)
    .reduce((sum, t) => sum + (Number(t.withdrawal) || 0), 0);
  const monthLeft = Math.max(0, monthlyIncome - monthSpent);

  const transactionContext = transactions?.length
    ? `Here is the user's transaction history for the last 90 days:\n${JSON.stringify(transactions, null, 2)}`
    : `The user has no recorded transactions yet.`;

  const systemPrompt = `You are Finni, a smart AI personal finance coach.
You have access to the user's real financial data.

User: ${profile?.name ?? 'User'}
Currency: ${profile?.currency || 'USD'}
Current date (TODAY): ${todayDateStr}${sessionDate && sessionDate !== now.toISOString().split('T')[0] ? `\nNOTE: The user is adding to a past thread from ${todayDateStr}. Record all transactions for that date.` : ''}
Pre-calculated totals (authoritative — use these when answering spending questions):
- Monthly income (budget): ${monthlyIncome.toFixed(2)} ${profile?.currency || 'USD'}
- Today's total spending: ${todaySpent.toFixed(2)} ${profile?.currency || 'USD'}
- This month's total spending: ${monthSpent.toFixed(2)} ${profile?.currency || 'USD'}
- Remaining budget this month: ${monthLeft.toFixed(2)} ${profile?.currency || 'USD'}
Categories: ${JSON.stringify(categories?.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, budget: c.budget, spent: c.spent })))}
Goals: ${JSON.stringify(goals?.map((g) => ({ name: g.name, target: g.target_amount, current: g.current_amount })))}

${transactionContext}

UNINTELLIGIBLE INPUT:
If the input is gibberish, random characters, or cannot be interpreted as a financial transaction or question, respond with:
"I didn't quite get that. Try something like 'Spent $20 on lunch' or 'Received $500 salary'."
Do NOT emit TRANSACTION_DATA or create categories.

FINANCIAL QUERY RULES:
- Use the transaction data above to answer ANY financial questions directly. Calculate totals, breakdowns, and summaries yourself.
- If the user asks about a time period (e.g. "in May", "last week", "this month"), filter the transactions by date yourself and compute the answer.
- Never say "I'll look it up", "give me a moment", or "I don't have access to your data" — you already have the data above.
- If the user has no transactions, tell them and suggest logging their first expense.

CATEGORIZATION RULES:
You have access to the user's categories listed above with their UUIDs.
When the user logs a transaction, follow this flow:

STEP 1 - SEMANTIC ANALYSIS:
Map what the user spent on to a category type:
- "pizza/burger/lunch/dinner/coffee/groceries/food/drinks/juice/water/snack" → Food
- "uber/grab/taxi/petrol/fuel/bus/train/transport" → Transport
- "netflix/spotify/cinema/games/movie/entertainment" → Entertainment
- "electricity/water/rent/phone bill/internet/bills" → Bills
- "gym/doctor/medicine/pharmacy/health" → Health
- "shirt/shoes/shopping/amazon/clothes/mall" → Shopping
- "course/tuition/school/university/books/class/training/workshop" → Education
- "miscellaneous/misc/other/random/various" → Other

STEP 2 - MATCH TO USER'S CATEGORIES:
Compare your semantic analysis to the user's actual category list above.
Use fuzzy matching - "drinks" maps to "Food" if Food exists.

CRITICAL: For category_id in TRANSACTION_DATA, always use the category NAME as a plain string (e.g. "Food", "Transport"). Never use a UUID. The app resolves names to IDs internally.

IMPORTANT: Only match to a category if the semantic match is strong. Examples of BAD matches to avoid:
- "taxi/uber/transport" should NOT match "Bali trip" or any savings goal category
- Only match transport-related expenses to categories explicitly named: Transport, Travel, Car, Commute
- If no strong match exists, always go to STEP 4 and propose a new category instead of guessing.

STEP 3 - CONFIDENCE CHECK:
- 80%+ confident in a match → Log it immediately with TRANSACTION_DATA
- Below 80% confident → Ask:
  "What category should I put this under?
   [list their actual category names]
   Or reply 'new' to create a new one"
  Do NOT include TRANSACTION_DATA yet.

STEP 4 - NO MATCHING CATEGORY EXISTS:
If none of the user's categories fit at all, respond:
"I don't have a matching category for this.
Should I create a new '[suggested name]' [emoji] category?
Reply 'yes' to confirm or suggest a different name."
Do NOT include TRANSACTION_DATA yet.

STEP 5 - USER APPROVES NEW CATEGORY:
When user says yes or confirms, respond with:
"✅ Created '[name]' category and logged this under it!"
Then append BOTH on separate last lines:
NEW_CATEGORY:{"name": "string", "emoji": "emoji", "budget": 0}
TRANSACTION_DATA:{"amount": number, "description": "string", "category_id": "NEW", "type": "expense"|"income"}

STANDALONE CATEGORY CREATION (no transaction involved):
If the user asks to create or add a new category WITHOUT logging a transaction (e.g. "Create a Food category", "Add a category called Travel", "Make a new Shopping category"):
1. Check if the category already exists in the user's category list above.
2. If it already exists: respond "You already have a '[name]' category! Manage it in Settings → Categories."
3. If it does NOT exist: respond with EXACTLY this format and nothing else:
   "✅ Created '[CategoryName]' category for you! 🎉"
   Use the exact name the user requested with proper capitalization.
4. Do NOT include NEW_CATEGORY or TRANSACTION_DATA tags for standalone creation — the app detects the response format automatically.

INCOME vs EXPENSE:
- Expense: spent, paid, bought, cost, bill, any food/item name
- Income: received, earned, salary, got paid, freelance, refund
- If ambiguous: ask "Was that an expense or income?"

CATEGORY BUDGET SETTING — MANDATORY:
If the user asks to set, update, or assign a budget for a specific category (e.g. "set my food budget to $300", "what should my food budget be" then confirms an amount), emit on its own line:
CATEGORY_BUDGET:{"category_name": "exact category name", "budget": <number>}
Example:
  I've set your Food budget to $300/month!
  CATEGORY_BUDGET:{"category_name": "Food", "budget": 300}
NEVER say you set a budget without emitting CATEGORY_BUDGET.

GOAL CREATION — MANDATORY:
Whenever you create OR confirm creating a financial goal (whether the user asked now or in a previous message), you MUST emit GOAL_CREATE on its own line. Without it, the goal is NOT saved.
Format: GOAL_CREATE:{"name": "Goal Name", "target_amount": <number>, "goal_type": "saving"|"debt_payment"|"investment"|"expense"}
Example of a CORRECT response when creating a goal:
  I've created an "Eid Shopping" goal for you with a target of $400!
  GOAL_CREATE:{"name": "Eid Shopping", "target_amount": 400, "goal_type": "saving"}
NEVER say you created a goal without appending GOAL_CREATE. If you already mentioned creating a goal in a prior message but didn't emit GOAL_CREATE, emit it now.

GOAL CONTRIBUTION TRACKING:
If the user is explicitly saving toward or contributing to a named goal (e.g., "saving for Bangkok", "adding to emergency fund", "paying off loan"), AND a matching goal exists in the Goals list above:
- Log the transaction normally with TRANSACTION_DATA
- Also emit on its own line BEFORE TRANSACTION_DATA: GOAL_UPDATE:{"goal_name": "exact goal name from Goals list", "amount": <number>}

CRITICAL RULES — YOU MUST FOLLOW THESE EXACTLY:
1. Every time you log a transaction, your response MUST end with TRANSACTION_DATA on its own line.
2. Format: TRANSACTION_DATA:{"amount": number, "description": "string", "category_id": "CategoryName", "type": "expense"|"income"}
3. Write the confirmation message first, then TRANSACTION_DATA last. Nothing after TRANSACTION_DATA.
4. Example of a CORRECT response:
   ✅ Logged $650 under Shopping.
   TRANSACTION_DATA:{"amount": 650, "description": "Daraz order", "category_id": "Shopping", "type": "expense"}
5. NEVER respond with only the confirmation text and no TRANSACTION_DATA — the app cannot save without it.

Current user message: ${userMessage}`;

  const conversationHistory = messages.slice(-6).map((msg) => ({
    role: (msg.role === 'user' ? 'user' : 'model') as 'user' | 'model',
    parts: [{ text: msg.content }],
  }));
  const contents = [
    ...conversationHistory,
    {
      role: 'user' as const,
      parts: [{ text: systemPrompt + '\n\nUser: ' + userMessage }],
    },
  ];

  try {
    const text = await callGeminiWithHistory(contents);
    let { response, txData, newCategory, goalUpdate, goalCreate, categoryBudgetUpdate, txParseError } = extractTransactionData(text);

    if (txParseError) {
      return {
        response: "I couldn't understand that response. Please try again.",
        transaction: null,
      };
    }

    // Fallback: if Gemini dropped TRANSACTION_DATA but wrote "✅ Logged $X under Y.", parse it directly
    if (!txData && !newCategory) {
      const loggedMatch = response.match(/✅\s+Logged\s+\$?([\d.]+)\s+under\s+([^.\n!]+)/i);
      if (loggedMatch) {
        const parsedAmount = parseFloat(loggedMatch[1]);
        const parsedCategory = loggedMatch[2].trim().replace(/['"]/g, '');
        if (!isNaN(parsedAmount) && parsedAmount > 0) {
          console.log(`[Agent1] Fallback parse: amount=${parsedAmount}, category="${parsedCategory}"`);
          txData = {
            amount: parsedAmount,
            description: userMessage,
            category_id: parsedCategory,
            type: 'expense',
          };
        }
      }
    }

    // Fallback if Gemini returns empty response after stripping TRANSACTION_DATA.
    // At this point txData.category_id is still the name string from Gemini (e.g. "Food"),
    // not a UUID — search by name, not id.
    const sym = getCurrencySymbol(profile?.currency);
    const fallbackCatName = txData
      ? (categories?.find((c) => c.name.toLowerCase() === String(txData.category_id ?? '').toLowerCase())?.name
          ?? String(txData.category_id ?? 'expenses'))
      : null;
    const finalResponse =
      response.trim() ||
      (txData
        ? `✅ Logged ${sym}${Math.abs(Number(txData.amount)).toFixed(2)} under ${fallbackCatName}.`
        : "I couldn't process that. Please try again.");

    // Bug 1 fix: Detect standalone category creation (no TRANSACTION_DATA or NEW_CATEGORY tags)
    if (!txData && !newCategory) {
      const catCreateMatch = response.match(STANDALONE_CATEGORY_CREATE_REGEX);
      if (catCreateMatch) {
        const catName = catCreateMatch[1].trim();

        // Check for duplicates before inserting
        const { data: existingCat } = await supabase
          .from('categories')
          .select('id')
          .eq('user_id', userId)
          .ilike('name', catName)
          .maybeSingle();

        if (existingCat) {
          return {
            response: `You already have a '${catName}' category! You can manage it in Settings → Categories.`,
            transaction: null,
          };
        }

        const autoEmoji = CATEGORY_EMOJI_MAP[catName.toLowerCase()] ?? '📦';
        const { error: catError } = await supabase
          .from('categories')
          .insert({
            user_id: userId,
            name: catName,
            emoji: autoEmoji,
            budget: 0,
            spent: 0,
            color: '#6366F1',
            type: 'monthly',
          });

        if (catError) {
          console.error('[Agent1] Standalone category create error:', catError);
          return {
            response: "I tried to create the category but something went wrong. Please try again.",
            transaction: null,
          };
        }

        console.log('[Agent1] Standalone category created:', catName);
        return { response: finalResponse, transaction: null };
      }
    }

    if (newCategory && typeof newCategory.name === 'string') {
      const { data: newCat, error: catError } = await supabase
        .from('categories')
        .insert({
          user_id: userId,
          name: newCategory.name,
          emoji: typeof newCategory.emoji === 'string' ? newCategory.emoji : '📦',
          budget: typeof newCategory.budget === 'number' ? newCategory.budget : 0,
          spent: 0,
          color: '#6366F1',
          type: 'monthly',
        })
        .select()
        .single();

      if (!catError && newCat) {
        console.log('[Agent1] New category created:', newCat.id);
        // Update txData to use the new category's real ID
        if (txData && txData.category_id === 'NEW') {
          txData.category_id = newCat.id;
        }
        // Refresh context so new category appears
        categories?.push({
          id: newCat.id,
          name: newCat.name,
          emoji: newCat.emoji,
          budget: newCat.budget,
          spent: 0,
        });
      }
    }

    if (txData && typeof txData.amount === 'number' && (txData.type === 'expense' || txData.type === 'income')) {
      let categoryId = typeof txData.category_id === 'string' ? txData.category_id : null;
      let matchingScore = 0;

      const { data: allCategories } = await supabase
        .from('categories')
        .select('id, name')
        .eq('user_id', userId);

      if (categoryId) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const isValidUUID = uuidRegex.test(categoryId);
        const exactUUIDMatch = allCategories?.find((c) => c.id === categoryId);

        if (isValidUUID && exactUUIDMatch) {
          // Real UUID that exists in DB — use as-is
          matchingScore = 1.0;
        } else {
          // Name string or hallucinated UUID — use similarity scoring
          const geminiName = categoryId.toLowerCase();
          const scoredCategories = (allCategories ?? []).map((cat) => {
            const catName = cat.name.toLowerCase();
            let score = 0;
            if (catName === geminiName) {
              score = 1.0;
            } else if (catName.includes(geminiName) || geminiName.includes(catName)) {
              score = 0.85;
            } else {
              const overlap = [...geminiName].filter((c) => catName.includes(c)).length;
              score = overlap / Math.max(geminiName.length, catName.length);
            }
            return { ...cat, score };
          });

          const bestMatch = scoredCategories.sort((a, b) => b.score - a.score)[0];
          const THRESHOLD = 0.7;

          if (bestMatch && bestMatch.score >= THRESHOLD) {
            console.log(`[Agent1] Category matched: "${bestMatch.name}" (score: ${bestMatch.score.toFixed(2)})`);
            categoryId = bestMatch.id;
            matchingScore = bestMatch.score;
          } else {
            // Score below threshold — auto-create a new category with a smart emoji
            const newCatName = typeof txData.category_id === 'string' ? txData.category_id : categoryId;
            const autoEmoji = CATEGORY_EMOJI_MAP[newCatName.toLowerCase()] ?? '📦';
            console.log(`[Agent1] No match above threshold (best: ${bestMatch?.score?.toFixed(2) ?? 'n/a'}), creating category: "${newCatName}" ${autoEmoji}`);
            const { data: newCat, error: newCatError } = await supabase
              .from('categories')
              .insert({
                user_id: userId,
                name: newCatName,
                emoji: autoEmoji,
                budget: 0,
                spent: 0,
                color: '#6366F1',
                type: 'monthly',
              })
              .select()
              .single();
            if (newCat && !newCatError) {
              categoryId = newCat.id;
              matchingScore = bestMatch?.score ?? 0;
              allCategories?.push({ id: newCat.id, name: newCatName });
            } else {
              // Bug 2 fix: never silently drop — always tell the user what went wrong
              console.error('[Agent1] Auto-create category failed:', newCatError);
              return {
                response: "I couldn't find or create a category for this. Please add it manually in Settings → Categories.",
                transaction: null,
              };
            }
          }
        }
      }

      const categoryName = categoryId ? (allCategories?.find((c) => c.id === categoryId)?.name ?? null) : null;
      const amount = Math.abs(txData.amount);
      const description = typeof txData.description === 'string' ? txData.description : '';
      const type = txData.type === 'income' ? 'income' : 'expense';

      const insertData: Record<string, unknown> = {
        user_id: userId,
        withdrawal: type === 'expense' ? Number(amount) : 0,
        deposit: type === 'income' ? Number(amount) : 0,
        balance: 0,
        given_to: description || '',
        description: description || '',
        type,
        date: sessionDate ? new Date(sessionDate).toISOString() : new Date().toISOString(),
        matching_score: Math.round((matchingScore ?? 0) * 100),
      };
      if (categoryId) insertData.category_id = categoryId;

      const { data: insertedRow, error } = await supabase.from('transactions').insert(insertData).select();
      console.log('[Agent1] Insert result data:', JSON.stringify(insertedRow));
      console.log('[Agent1] Insert result error:', JSON.stringify(error));
      if (error) {
        console.error('[Agent1] Insert error:', error);
        return {
          response: `I parsed that but couldn't save it: ${error.message}. Try again!`,
          transaction: null,
        };
      }

      // Update goal current_amount if this transaction is a goal contribution
      if (goalUpdate) {
        const { data: matchedGoals } = await supabase
          .from('financial_goals')
          .select('id, current_amount, name')
          .eq('user_id', userId)
          .ilike('name', goalUpdate.goal_name);
        const goal = matchedGoals?.[0];
        if (goal) {
          const newAmount = Number(goal.current_amount ?? 0) + goalUpdate.amount;
          const { error: goalError } = await supabase
            .from('financial_goals')
            .update({ current_amount: newAmount })
            .eq('id', goal.id)
            .eq('user_id', userId);
          if (goalError) {
            console.error('[Agent1] Goal update error:', goalError);
          } else {
            console.log(`[Agent1] Goal "${goal.name}" updated: ${goal.current_amount} → ${newAmount}`);
          }
        } else {
          console.warn('[Agent1] GOAL_UPDATE: no matching goal found for name:', goalUpdate.goal_name);
        }
      }

      return {
        response: finalResponse,
        transaction: {
          amount,
          description,
          category: categoryName ?? '',
          date: new Date().toISOString().slice(0, 10),
          type: type as 'expense' | 'income',
        },
      };
    }

    // Fallback: only match past-tense confirmations, not proposals
    if (!goalCreate) {
      const isConfirmation = /(?:i(?:'ve| have) created|created a (?:new )?(?:savings |financial )?goal)/i.test(response);
      if (isConfirmation) {
        const createdMatch = response.match(/(?:created).*?[''""]([^''""]+)[''""].*?\$?([\d,.]+)/i);
        const mdMatch = response.match(/\*\*Goal(?:\s+Name)?:\*\*\s+(.+?)(?:\n|$)[\s\S]*?\*\*Target[^:]*:\*\*\s+\$?([\d,.]+)/i);
        const m = createdMatch ?? mdMatch;
        if (m) {
          const parsedTarget = parseFloat(m[2].replace(/,/g, ''));
          if (m[1] && !isNaN(parsedTarget) && parsedTarget > 0) {
            console.log(`[Agent1] Fallback GOAL_CREATE: name="${m[1].trim()}", target=${parsedTarget}`);
            goalCreate = { name: m[1].trim(), target_amount: parsedTarget, goal_type: 'saving' };
          }
        }
      }
    }

    // Create a new goal if Gemini emitted GOAL_CREATE — with duplicate check
    if (goalCreate) {
      const { data: existingGoal } = await supabase
        .from('financial_goals')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', goalCreate.name)
        .maybeSingle();
      if (existingGoal) {
        console.log(`[Agent1] Goal "${goalCreate.name}" already exists, skipping duplicate insert`);
        goalCreate = null;
      }
    }

    if (goalCreate) {
      const { error: gcError } = await supabase.from('financial_goals').insert({
        user_id: userId,
        name: goalCreate.name,
        target_amount: goalCreate.target_amount,
        current_amount: 0,
        goal_type: goalCreate.goal_type,
        status: 'in_progress',
        target_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (gcError) {
        console.error('[Agent1] Goal create error:', gcError);
      } else {
        console.log(`[Agent1] Goal created: "${goalCreate.name}" target=${goalCreate.target_amount}`);
        clearAgentCache(userId).catch(() => {});
      }
    }

    // Update category budget if Gemini emitted CATEGORY_BUDGET
    if (categoryBudgetUpdate) {
      const { data: matchedCats } = await supabase
        .from('categories')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', categoryBudgetUpdate.category_name);
      const cat = matchedCats?.[0];
      if (cat) {
        const { error: cbError } = await supabase
          .from('categories')
          .update({ budget: categoryBudgetUpdate.budget, type: 'monthly' })
          .eq('id', cat.id)
          .eq('user_id', userId);
        if (cbError) console.error('[Agent1] Category budget update error:', cbError);
        else console.log(`[Agent1] Category "${cat.name}" budget set to ${categoryBudgetUpdate.budget}`);
      } else {
        console.warn('[Agent1] CATEGORY_BUDGET: no matching category for:', categoryBudgetUpdate.category_name);
      }
    }

    return { response: finalResponse, transaction: null };
  } catch (e) {
    console.error('[Agent1] chatAgent Error:', e);
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('503') || msg.includes('high demand')) {
      return { response: "Gemini is a bit busy right now. Retrying automatically failed — please try again in a few seconds. 🔄", transaction: null };
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
      return { response: "You're sending messages too quickly. Please wait a moment and try again. ⏳", transaction: null };
    }
    return {
      response: "I'm having trouble connecting right now. Please try again in a moment. 🔄",
      transaction: null,
    };
  }
}

// --- Cache clearing for manual refresh ---
export async function clearAgentCache(userId: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const toRemove = keys.filter(
    (k) => k.startsWith(`insights_${userId}_`) || k.startsWith(`savings_${userId}_`)
  );
  if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
}
