import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseUrl } from './supabase';
import { captureError } from './sentry';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', BDT: '৳', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', INR: '₹',
};
function getCurrencySymbol(code?: string | null): string {
  return CURRENCY_SYMBOLS[code ?? 'USD'] ?? code ?? '$';
}

function resolveCategoryFuzzy(
  catName: string,
  userCategories: { id: string; name: string }[]
): string | null {
  if (!catName || !userCategories.length) return null;
  const needle = catName.toLowerCase();
  const scored = userCategories.map((c) => {
    const hay = c.name.toLowerCase();
    let score = 0;
    if (hay === needle) score = 1.0;
    else if (hay.includes(needle) || needle.includes(hay)) score = 0.85;
    else {
      const overlap = [...needle].filter((ch) => hay.includes(ch)).length;
      score = overlap / Math.max(needle.length, hay.length);
    }
    return { ...c, score };
  });
  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 0.7 ? best.id : null;
}

// Legacy client-side key — used as fallback during migration, removed in Phase 3
const GEMINI_API_KEY_LEGACY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_PROXY_URL = supabaseUrl ? `${supabaseUrl}/functions/v1/gemini-proxy` : null;
const GEMINI_DIRECT_URL = GEMINI_API_KEY_LEGACY
  ? `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY_LEGACY}`
  : null;

if (!GEMINI_PROXY_URL && !GEMINI_API_KEY_LEGACY) {
  console.error('[Agent] No Gemini proxy or API key configured. All AI features will fail.');
}

async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Returns true if the error is an infrastructure error (not a Gemini API error) */
function isInfraError(status: number): boolean {
  // 404 from proxy = edge function not deployed yet → fall back to direct
  // 502/504 = proxy infra failures → fall back to direct
  // 4xx/5xx from Gemini itself (400, 403, 429, 503) should NOT trigger fallback
  return status === 404 || status === 502 || status === 504 || status === 0;
}

function getYearWeekKey(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil((((now.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
  return `${now.getFullYear()}_w${week}`;
}

const RETRY_DELAYS = [1500, 3000, 5000];

const _insightsInFlight = new Map<string, Promise<DailyInsight[]>>();

async function callGemini(prompt: string, retryCount = 0): Promise<string> {
  return callGeminiWithHistory([{ role: 'user', parts: [{ text: prompt }] }], retryCount);
}

async function callGeminiWithHistory(
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
  retryCount = 0
): Promise<string> {
  if (!GEMINI_PROXY_URL && !GEMINI_DIRECT_URL) throw new Error('Gemini is not configured');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    // Try edge function proxy first, fall back to direct if infra fails
    const token = await getAuthToken();
    const useProxy = !!(GEMINI_PROXY_URL && token);
    const url = useProxy ? GEMINI_PROXY_URL! : GEMINI_DIRECT_URL!;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (useProxy) headers['Authorization'] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      // Network error reaching proxy — fall back to direct if available
      if (useProxy && GEMINI_DIRECT_URL) {
        if (__DEV__) console.log('[Agent1] Proxy network error, falling back to direct');
        res = await fetch(GEMINI_DIRECT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
          }),
          signal: controller.signal,
        });
      } else {
        throw fetchErr;
      }
    }

    clearTimeout(timeoutId);
    if (__DEV__) console.log('[Agent1] Gemini response status:', res.status);

    // If proxy returned infra error, retry via direct
    if (useProxy && isInfraError(res.status) && GEMINI_DIRECT_URL) {
      if (__DEV__) console.log(`[Agent1] Proxy infra error (${res.status}), falling back to direct`);
      const directRes = await fetch(GEMINI_DIRECT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      });
      res = directRes;
    }

    if (!res.ok) {
      const status = res.status;
      if ((status === 503 || status === 429) && retryCount < 3) {
        const delay = RETRY_DELAYS[retryCount];
        if (__DEV__) console.log(`[Gemini] ${status} error, retrying in ${delay}ms (attempt ${retryCount + 1}/3)`);
        await new Promise((r) => setTimeout(r, delay));
        return callGeminiWithHistory(contents, retryCount + 1);
      }
      const errBody = await res.json().catch(() => ({}));
      const errMsg = (errBody as any)?.error?.message ?? '';
      if (__DEV__) console.error(`[Gemini] ${status} error body:`, JSON.stringify(errBody));
      if (status === 503) throw new Error('Gemini is experiencing high demand. Please try again in a moment.');
      if (status === 429) throw new Error('Rate limit reached. Please wait a moment before trying again.');
      if (status === 403) throw new Error(`Gemini API key error (403): ${errMsg || 'Check API key permissions and billing in Google Cloud Console'}`);
      if (status === 400) throw new Error(`Gemini API error: 400 - ${errMsg}`);
      throw new Error(`Gemini API error: ${status} - ${errMsg}`);
    }
    const data = await res.json();
    if (__DEV__) console.log('[Agent1] Gemini data:', JSON.stringify(data).slice(0, 200));
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      if (retryCount < 2) {
        const delay = RETRY_DELAYS[retryCount];
        if (__DEV__) console.log(`[Gemini] Empty response, retrying in ${delay}ms (attempt ${retryCount + 1}/2)`);
        await new Promise((r) => setTimeout(r, delay));
        return callGeminiWithHistory(contents, retryCount + 1);
      }
      throw new Error('Empty Gemini response');
    }
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
    if (__DEV__) console.error('[Agent1] parseTransaction Error:', e);
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
  if (__DEV__) console.log('[Agent2] Running insights for user:', userId);
  if (__DEV__) console.log('[Agent2] Transactions found:', transactions?.length);

  const _now = new Date();
  const _localDate = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  const cacheKey = `insights_${userId}_${_localDate}`;
  const cached = await AsyncStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  // Dedup concurrent calls with same cache key
  const inFlight = _insightsInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const realTransactions = (transactions ?? []).filter((t) => {
    const amount = t.type === 'expense' ? (Number(t.withdrawal) || 0) : (Number(t.deposit) || 0);
    const desc = (t.description ?? '').trim();
    return amount > 0 && desc.length >= 2 && (t.type === 'expense' || t.type === 'income');
  });

  const MIN_TRANSACTIONS = 10;
  if (realTransactions.length < MIN_TRANSACTIONS) {
    return [{
      title: 'Building your insights...',
      description: `Finni needs at least ${MIN_TRANSACTIONS} real transactions to generate accurate, personalized insights. You have ${realTransactions.length} so far — keep logging!`,
      type: 'tip',
    }];
  }

  const computePromise = (async (): Promise<DailyInsight[]> => {
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
      if (inc.frequency === 'weekly') return sum + amt * (52 / 12);
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
            const over = Number(c.spent) > Number(c.budget) + 0.005;
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
      const prompt = `You are Finni, an AI assistant for personal finance tracking. You are NOT a licensed financial advisor.
IMPORTANT DISCLAIMER: All suggestions are for informational purposes only and do not constitute financial, investment, or legal advice. Users should consult a qualified professional before making financial decisions.

Generate highly personalized financial insights for this user.

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
        if (__DEV__) console.error('[Agent2] JSON parse Error:', parseErr);
        insights = [];
      }

      if (insights.length > 0) {
        await AsyncStorage.setItem(cacheKey, JSON.stringify(insights));
      }

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
      if (__DEV__) console.error('[Agent2] Error:', e);
      captureError(e, { context: 'getDailyInsights', userId });
      return [{
        title: 'Insights unavailable',
        description: 'Unable to load AI insights right now. Check your connection and tap Refresh to try again.',
        type: 'tip',
      }];
    }
  })();

  _insightsInFlight.set(cacheKey, computePromise);
  computePromise.finally(() => _insightsInFlight.delete(cacheKey));
  return computePromise;
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
  if (__DEV__) console.log('[Agent3] Running savings agent');
  if (__DEV__) console.log('[Agent3] Transactions:', transactions?.length);

  const weekKey = `savings_${userId}_${getYearWeekKey()}`;
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
    const prompt = `You are Finni, an AI assistant for personal finance tracking. You are NOT a licensed financial advisor.
DISCLAIMER: Suggestions are for informational purposes only, not financial advice.

Suggest 3 highly practical, specific ways for this user to save money based on their spending patterns.

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
      if (__DEV__) console.error('[Agent3] JSON parse Error:', parseErr);
      localizedResults = [];
    }
    await AsyncStorage.setItem(weekKey, JSON.stringify(localizedResults));
    return localizedResults;
  } catch (e) {
    if (__DEV__) console.error('[Agent3] Error:', e);
    captureError(e, { context: 'getWeeklySavingsRecommendations', userId });
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
const INVESTMENT_DATA_REGEX = /INVESTMENT_DATA:\s*(\{[\s\S]*?\})(?:\s|$)/;
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
  investmentData: { name: string; ticker?: string; asset_type: string; quantity: number; buy_price: number; action: 'buy' | 'sell' } | null;
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
      if (__DEV__) console.error('[Agent] Failed to parse NEW_CATEGORY JSON:', e);
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
      if (__DEV__) console.error('[Agent] Failed to parse GOAL_UPDATE JSON:', e);
    }
    response = response.replace(GOAL_UPDATE_REGEX, '').trim();
  }
  if (goalCreateMatch) {
    try {
      const parsed = JSON.parse(goalCreateMatch[1]);
      if (typeof parsed.name === 'string' && typeof parsed.target_amount === 'number' && parsed.target_amount > 0) {
        goalCreate = {
          name: parsed.name,
          target_amount: parsed.target_amount,
          goal_type: parsed.goal_type ?? 'saving',
        };
      }
    } catch (e) {
      if (__DEV__) console.error('[Agent] Failed to parse GOAL_CREATE JSON:', e);
    }
    response = response.replace(GOAL_CREATE_REGEX, '').trim();
  }
  if (txMatch) {
    try {
      txData = JSON.parse(txMatch[1]) as Record<string, unknown>;
    } catch (e) {
      if (__DEV__) console.error('[Agent] Failed to parse TRANSACTION_DATA JSON:', e);
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
      if (__DEV__) console.error('[Agent] Failed to parse CATEGORY_BUDGET JSON:', e);
    }
    response = response.replace(CATEGORY_BUDGET_REGEX, '').trim();
  }

  const investmentMatch = text.match(INVESTMENT_DATA_REGEX);
  let investmentData: { name: string; ticker?: string; asset_type: string; quantity: number; buy_price: number; action: 'buy' | 'sell' } | null = null;
  if (investmentMatch) {
    try {
      const parsed = JSON.parse(investmentMatch[1]);
      if (typeof parsed.name === 'string' && typeof parsed.quantity === 'number' && typeof parsed.buy_price === 'number') {
        investmentData = {
          name: parsed.name,
          ticker: parsed.ticker ?? null,
          asset_type: parsed.asset_type ?? 'stock',
          quantity: parsed.quantity,
          buy_price: parsed.buy_price,
          action: parsed.action ?? 'buy',
        };
      }
    } catch (e) {
      if (__DEV__) console.error('[Agent] Failed to parse INVESTMENT_DATA JSON:', e);
    }
    response = response.replace(INVESTMENT_DATA_REGEX, '').trim();
  }

  return { response, txData, newCategory, goalUpdate, goalCreate, categoryBudgetUpdate, investmentData, txParseError };
}

export async function chatAgent(
  userMessage: string,
  userId: string,
  messages: ChatMessage[],
  context?: ChatAgentContext,
  sessionDate?: string
): Promise<ChatAgentResult> {
  if (__DEV__) {
    console.log('[Agent1] Proxy configured:', !!GEMINI_PROXY_URL, 'Legacy key:', !!GEMINI_API_KEY_LEGACY);
    console.log('[Agent1] User ID:', userId);
    console.log('[Agent1] Message:', userMessage);
  }

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
    if (r.frequency === 'weekly') return sum + amt * (52 / 12);
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

  // Fetch investment portfolio for context
  const { data: investmentsData } = await supabase
    .from('investments')
    .select('name, ticker, asset_type, quantity, buy_price, current_value')
    .eq('user_id', userId);

  const investmentContext = investmentsData?.length
    ? `Here is the user's investment portfolio:\n${JSON.stringify(investmentsData, null, 2)}`
    : `The user has no recorded investments yet.`;

  const totalPortfolioValue = (investmentsData ?? []).reduce((sum, inv) => sum + (Number(inv.quantity) * Number(inv.current_value)), 0);

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

${investmentContext}
${totalPortfolioValue > 0 ? `Total portfolio value: ${(profile?.currency || 'USD')} ${totalPortfolioValue.toFixed(2)}` : ''}

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

INVESTMENT TRACKING:
If the user mentions buying, investing in, or adding stocks, crypto, mutual funds, gold, or any investment asset:
- Parse: name, ticker (if known), quantity, buy price per unit, and asset type
- asset_type must be one of: stock, crypto, mutual_fund, gold, other
- Respond with confirmation, then emit on its own line:
  INVESTMENT_DATA:{"name": "Asset Name", "ticker": "TICK", "asset_type": "stock", "quantity": 10, "buy_price": 450, "action": "buy"}
If the user mentions selling an investment:
  INVESTMENT_DATA:{"name": "Asset Name", "ticker": "TICK", "asset_type": "stock", "quantity": 5, "buy_price": 280, "action": "sell"}
Note: For sell actions, "buy_price" is the sell price per unit.
Examples:
- "bought 10 shares of Grameenphone at 450" → stock, qty 10, price 450, action buy
- "added 0.5 BTC at 95000" → crypto, qty 0.5, price 95000, action buy
- "invested 50000 in IDLC Growth Fund" → mutual_fund, qty 1, price 50000, action buy
- "sold 5 shares of Square Pharma at 280" → stock, qty 5, price 280, action sell
- "bought 2 grams of gold at 9500" → gold, qty 2, price 9500, action buy
Do NOT emit TRANSACTION_DATA for investments. Use INVESTMENT_DATA only.
Do NOT confuse regular expenses with investments. "Bought groceries" = expense. "Bought shares" = investment.
If the user asks about their portfolio, use the investment data above to answer directly.

CRITICAL RULES — YOU MUST FOLLOW THESE EXACTLY:
1. Every time you log a transaction, your response MUST end with TRANSACTION_DATA on its own line.
2. Format: TRANSACTION_DATA:{"amount": number, "description": "string", "category_id": "CategoryName", "type": "expense"|"income"}
3. Every time you log an investment, your response MUST end with INVESTMENT_DATA on its own line.
4. Write the confirmation message first, then the data tag last. Nothing after the data tag.
5. Example of a CORRECT transaction response:
   ✅ Logged $650 under Shopping.
   TRANSACTION_DATA:{"amount": 650, "description": "Daraz order", "category_id": "Shopping", "type": "expense"}
6. Example of a CORRECT investment response:
   ✅ Added 10 shares of Grameenphone to your portfolio at ৳450/share.
   INVESTMENT_DATA:{"name": "Grameenphone", "ticker": "GP", "asset_type": "stock", "quantity": 10, "buy_price": 450, "action": "buy"}
7. NEVER respond with only the confirmation text and no data tag — the app cannot save without it.
8. NEVER emit both TRANSACTION_DATA and INVESTMENT_DATA in the same response. Pick one based on what the user said.

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
    let { response, txData, newCategory, goalUpdate, goalCreate, categoryBudgetUpdate, investmentData, txParseError } = extractTransactionData(text);

    if (txParseError) {
      return {
        response: "I couldn't understand that response. Please try again.",
        transaction: null,
      };
    }

    // If valid investment data is present, skip transaction processing entirely
    // (prevents double-logging when Gemini emits both tags)
    if (investmentData && investmentData.quantity > 0 && investmentData.buy_price > 0) {
      txData = null;
    } else if (investmentData) {
      // Investment data is malformed — discard it and keep the transaction
      investmentData = null;
    }

    // Fallback: if Gemini dropped TRANSACTION_DATA but wrote "✅ Logged $X under Y.", parse it directly
    if (!txData && !newCategory && !investmentData) {
      const loggedMatch = response.match(/✅\s+Logged\s+\$?([\d.]+)\s+under\s+([^.\n!]+)/i);
      if (loggedMatch) {
        const parsedAmount = parseFloat(loggedMatch[1]);
        const parsedCategory = loggedMatch[2].trim().replace(/['"]/g, '');
        if (!isNaN(parsedAmount) && parsedAmount > 0) {
          if (__DEV__) console.log(`[Agent1] Fallback parse: amount=${parsedAmount}, category="${parsedCategory}"`);
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
          if (__DEV__) console.error('[Agent1] Standalone category create error:', catError);
          return {
            response: "I tried to create the category but something went wrong. Please try again.",
            transaction: null,
          };
        }

        if (__DEV__) console.log('[Agent1] Standalone category created:', catName);
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
        if (__DEV__) console.log('[Agent1] New category created:', newCat.id);
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

    const parsedTxAmount = typeof txData?.amount === 'number'
      ? txData.amount
      : parseFloat(String(txData?.amount ?? ''));
    if (txData && !isNaN(parsedTxAmount) && parsedTxAmount > 0 && parsedTxAmount < 1_000_000 && (txData.type === 'expense' || txData.type === 'income')) {
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
            if (__DEV__) console.log(`[Agent1] Category matched: "${bestMatch.name}" (score: ${bestMatch.score.toFixed(2)})`);
            categoryId = bestMatch.id;
            matchingScore = bestMatch.score;
          } else {
            // Score below threshold — auto-create a new category with a smart emoji
            const newCatName = typeof txData.category_id === 'string' ? txData.category_id : categoryId;
            const autoEmoji = CATEGORY_EMOJI_MAP[newCatName.toLowerCase()] ?? '📦';
            if (__DEV__) console.log(`[Agent1] No match above threshold (best: ${bestMatch?.score?.toFixed(2) ?? 'n/a'}), creating category: "${newCatName}" ${autoEmoji}`);

            // Pre-check prevents duplicate categories from concurrent requests
            const { data: existingByName } = await supabase
              .from('categories')
              .select('id')
              .eq('user_id', userId)
              .ilike('name', newCatName)
              .maybeSingle();

            if (existingByName) {
              categoryId = existingByName.id;
              matchingScore = 0.85;
              allCategories?.push({ id: existingByName.id, name: newCatName });
            } else {
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
                if (__DEV__) console.error('[Agent1] Auto-create category failed:', newCatError);
                return {
                  response: "I couldn't find or create a category for this. Please add it manually in Settings → Categories.",
                  transaction: null,
                };
              }
            }
          }
        }
      }

      const categoryName = categoryId ? (allCategories?.find((c) => c.id === categoryId)?.name ?? null) : null;
      const amount = Math.abs(parsedTxAmount);
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
      if (__DEV__) {
        console.log('[Agent1] Insert result data:', JSON.stringify(insertedRow));
        console.log('[Agent1] Insert result error:', JSON.stringify(error));
      }
      if (error) {
        if (__DEV__) console.error('[Agent1] Insert error:', error);
        return {
          response: `I parsed that but couldn't save it: ${error.message}. Try again!`,
          transaction: null,
        };
      }

      // Update goal current_amount if this transaction is a goal contribution
      if (goalUpdate) {
        const { data: matchedGoals } = await supabase
          .from('financial_goals')
          .select('id, current_amount, target_amount, name')
          .eq('user_id', userId)
          .ilike('name', goalUpdate.goal_name);
        const goal = matchedGoals?.[0] as { id: string; current_amount: number; target_amount: number; name: string } | undefined;
        if (goal) {
          const newAmount = Math.min(
            Number(goal.target_amount ?? Infinity),
            Number(goal.current_amount ?? 0) + goalUpdate.amount
          );
          const { error: goalError } = await supabase
            .from('financial_goals')
            .update({ current_amount: newAmount })
            .eq('id', goal.id)
            .eq('user_id', userId);
          if (goalError) {
            if (__DEV__) console.error('[Agent1] Goal update error:', goalError);
          } else {
            if (__DEV__) console.log(`[Agent1] Goal "${goal.name}" updated: ${goal.current_amount} → ${newAmount}`);
          }
        } else {
          if (__DEV__) console.warn('[Agent1] GOAL_UPDATE: no matching goal found for name:', goalUpdate.goal_name);
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

    // Handle GOAL_UPDATE standalone (when emitted without TRANSACTION_DATA)
    if (goalUpdate && !txData) {
      const { data: matchedGoals } = await supabase
        .from('financial_goals')
        .select('id, current_amount, target_amount, name')
        .eq('user_id', userId)
        .ilike('name', goalUpdate.goal_name);
      const goal = matchedGoals?.[0] as { id: string; current_amount: number; target_amount: number; name: string } | undefined;
      if (goal) {
        const newAmount = Math.min(
          Number(goal.target_amount ?? Infinity),
          Number(goal.current_amount ?? 0) + goalUpdate.amount
        );
        await supabase.from('financial_goals')
          .update({ current_amount: newAmount })
          .eq('id', goal.id)
          .eq('user_id', userId);
        if (__DEV__) console.log(`[Agent1] Standalone goal update: "${goal.name}" → ${newAmount}`);
      }
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
            if (__DEV__) console.log(`[Agent1] Fallback GOAL_CREATE: name="${m[1].trim()}", target=${parsedTarget}`);
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
        if (__DEV__) console.log(`[Agent1] Goal "${goalCreate.name}" already exists, skipping duplicate insert`);
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
        if (__DEV__) console.error('[Agent1] Goal create error:', gcError);
      } else {
        if (__DEV__) console.log(`[Agent1] Goal created: "${goalCreate.name}" target=${goalCreate.target_amount}`);
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
        const validatedBudget = Math.max(0, Number(categoryBudgetUpdate.budget) || 0);
        const { error: cbError } = await supabase
          .from('categories')
          .update({ budget: validatedBudget, type: 'monthly' })
          .eq('id', cat.id)
          .eq('user_id', userId);
        if (cbError) { if (__DEV__) console.error('[Agent1] Category budget update error:', cbError); }
        else if (__DEV__) console.log(`[Agent1] Category "${cat.name}" budget set to ${categoryBudgetUpdate.budget}`);
      } else {
        if (__DEV__) console.warn('[Agent1] CATEGORY_BUDGET: no matching category for:', categoryBudgetUpdate.category_name);
      }
    }

    // Handle investment data if Gemini emitted INVESTMENT_DATA
    if (investmentData && investmentData.quantity > 0 && investmentData.buy_price > 0) {
      const validTypes = ['stock', 'crypto', 'mutual_fund', 'gold', 'other'];
      const assetType = validTypes.includes(investmentData.asset_type) ? investmentData.asset_type : 'other';

      if (investmentData.action === 'sell') {
        const { data: existing } = await supabase
          .from('investments')
          .select('id, quantity, buy_price')
          .eq('user_id', userId)
          .ilike('name', investmentData.name)
          .maybeSingle();
        if (existing) {
          if (investmentData.quantity > Number(existing.quantity)) {
            // Can't sell more than owned — tell the user
            return {
              response: `You only own ${existing.quantity} units of ${investmentData.name}. You can't sell ${investmentData.quantity}.`,
              transaction: null,
            };
          }
          const newQty = Number(existing.quantity) - investmentData.quantity;
          if (newQty <= 0) {
            await supabase.from('investments').delete().eq('id', existing.id);
          } else {
            await supabase.from('investments').update({ quantity: newQty }).eq('id', existing.id);
          }
          if (__DEV__) console.log(`[Agent1] Investment sold: "${investmentData.name}" qty=${investmentData.quantity}`);
        } else {
          return {
            response: `I couldn't find "${investmentData.name}" in your portfolio. Check the name and try again.`,
            transaction: null,
          };
        }
      } else {
        // Buy — upsert with weighted average price
        const { data: existing } = await supabase
          .from('investments')
          .select('id, quantity, buy_price, current_value')
          .eq('user_id', userId)
          .ilike('name', investmentData.name)
          .maybeSingle();

        if (existing) {
          const oldTotal = Number(existing.quantity) * Number(existing.buy_price);
          const newTotal = investmentData.quantity * investmentData.buy_price;
          const combinedQty = Number(existing.quantity) + investmentData.quantity;
          const avgPrice = (oldTotal + newTotal) / combinedQty;
          await supabase.from('investments').update({
            quantity: combinedQty,
            buy_price: Math.round(avgPrice * 100) / 100,
            // Preserve existing current_value — don't overwrite with buy price
          }).eq('id', existing.id);
          if (__DEV__) console.log(`[Agent1] Investment updated: "${investmentData.name}" qty=${combinedQty} avg=${avgPrice.toFixed(2)}`);
        } else {
          await supabase.from('investments').insert({
            user_id: userId,
            name: investmentData.name,
            ticker: investmentData.ticker ?? null,
            asset_type: assetType,
            quantity: investmentData.quantity,
            buy_price: investmentData.buy_price,
            current_value: investmentData.buy_price,
            currency: profile?.currency ?? 'USD',
          });
          if (__DEV__) console.log(`[Agent1] Investment created: "${investmentData.name}" qty=${investmentData.quantity} price=${investmentData.buy_price}`);
        }
      }
    }

    return { response: finalResponse, transaction: null };
  } catch (e) {
    if (__DEV__) console.error('[Agent1] chatAgent Error:', e);
    captureError(e, { context: 'chatAgent', userId });
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

// --- Agent 4: Extract transactions from image ---

const IMAGE_TX_LIMIT_KEY = (userId: string, date: string) => `image_tx_used_${userId}_${date}`;

function getLocalDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function checkImageTxLimit(userId: string): Promise<boolean> {
  const today = getLocalDateStr();
  const localVal = await AsyncStorage.getItem(IMAGE_TX_LIMIT_KEY(userId, today));
  if (localVal === 'true') return true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.user_metadata?.image_scan_date === today) {
      await AsyncStorage.setItem(IMAGE_TX_LIMIT_KEY(userId, today), 'true');
      return true;
    }
  } catch (e) {
    // Fail closed: if we can't verify, assume limit is hit to prevent abuse
    captureError(e, { context: 'checkImageTxLimit' });
    return true;
  }
  return false;
}

export async function markImageTxUsed(userId: string): Promise<void> {
  const today = getLocalDateStr();
  await AsyncStorage.setItem(IMAGE_TX_LIMIT_KEY(userId, today), 'true');
  try {
    await supabase.auth.updateUser({ data: { image_scan_date: today } });
  } catch (e) {
    captureError(e, { context: 'markImageTxUsed' });
  }
}

export type ImageTransaction = {
  description: string;
  amount: number;
  type: 'expense' | 'income';
  category?: string;
};

export type ImageExtractionResult = {
  transactions: ImageTransaction[];
  summary: string;
  savedCount: number;
};

const MAX_IMAGE_BASE64_BYTES = 15 * 1024 * 1024; // 15MB base64 limit

export async function parseTransactionsFromImage(
  base64Image: string,
  mimeType: string,
): Promise<ImageTransaction[]> {
  if (!GEMINI_PROXY_URL && !GEMINI_DIRECT_URL) throw new Error('Gemini is not configured');
  if (base64Image.length > MAX_IMAGE_BASE64_BYTES) throw new Error('IMAGE_TOO_LARGE');

  const prompt = `You are a financial transaction extractor. Analyze this image (it could be a receipt, bank statement, transaction history screenshot, or any financial document) and extract individual line item transactions.

Return ONLY a valid JSON array with this exact format (no markdown, no extra text):
[
  {
    "description": "item or merchant name",
    "amount": 25.50,
    "type": "expense",
    "category": "Food"
  }
]

Rules:
- type must be "expense" or "income"
- amount must be a positive number
- category should be one of: Food, Transport, Shopping, Entertainment, Health, Bills, Education, Travel, Other
- If no transactions found, return empty array []
- Extract individual line items only — do NOT include subtotals, totals, grand totals, balance rows, or any row whose amount equals the sum of other rows on the same document
- Delivery fees, shipping fees, and service charges associated with a purchase should use category "Shopping", not "Transport". Use "Transport" only for taxi, ride-share, bus, train, fuel, or parking
- For receipts: extract each purchased item or service as a separate transaction; skip the final total row`;

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  });

  const fetchWithRetry = async (): Promise<Response> => {
    const token = await getAuthToken();
    const useProxy = !!(GEMINI_PROXY_URL && token);

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 30000);
      try {
        const url = useProxy ? GEMINI_PROXY_URL! : GEMINI_DIRECT_URL!;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (useProxy) headers['Authorization'] = `Bearer ${token}`;

        let r: Response;
        try {
          r = await fetch(url, { method: 'POST', headers, body: requestBody, signal: ctrl.signal });
        } catch (fetchErr) {
          // Network error reaching proxy — fall back to direct
          if (useProxy && GEMINI_DIRECT_URL) {
            if (__DEV__) console.log('[ImageAgent] Proxy network error, falling back to direct');
            r = await fetch(GEMINI_DIRECT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody, signal: ctrl.signal });
          } else {
            throw fetchErr;
          }
        }

        clearTimeout(tid);

        // If proxy returned infra error, retry via direct
        if (useProxy && isInfraError(r.status) && GEMINI_DIRECT_URL) {
          if (__DEV__) console.log(`[ImageAgent] Proxy infra error (${r.status}), falling back to direct`);
          r = await fetch(GEMINI_DIRECT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody });
        }

        if (r.status !== 429 && r.status !== 503) return r;
        if (__DEV__) console.log(`[ImageAgent] ${r.status} error, retrying (attempt ${attempt + 1}/3)`);
      } catch (e) {
        clearTimeout(tid);
        if (e instanceof Error && e.name === 'AbortError') throw new Error('Gemini image request timed out');
        throw e;
      }
    }
    throw new Error('Gemini image API unreachable after retries');
  };

  const res = await fetchWithRetry();
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  let parsed: ImageTransaction[] = [];
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {
    parsed = [];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  return parsed
    .map((t) => ({ ...t, amount: Number(t.amount) }))
    .filter((t) => t.description?.trim() && !isNaN(t.amount) && t.amount > 0 && t.amount < 1_000_000);
}

export async function saveImageTransactions(
  valid: ImageTransaction[],
  userId: string,
  currency: string = 'USD',
  sessionDate?: string,
): Promise<ImageExtractionResult> {
  const { data: userCategories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', userId);

  const categoryMap: Record<string, string> = {};
  (userCategories ?? []).forEach((c: { id: string; name: string }) => {
    categoryMap[c.name.toLowerCase()] = c.id;
  });

  const currencySymbol = getCurrencySymbol(currency);
  let savedCount = 0;
  let failCount = 0;
  const lines: string[] = [];

  for (const tx of valid) {
    const catName = tx.category ?? 'Other';
    const catId = resolveCategoryFuzzy(catName, userCategories ?? []) ?? categoryMap['other'] ?? null;
    const type: 'expense' | 'income' = tx.type === 'income' ? 'income' : 'expense';
    const txDate = sessionDate ? new Date(sessionDate).toISOString() : new Date().toISOString();

    const { error } = await supabase.from('transactions').insert({
      user_id: userId,
      withdrawal: type === 'expense' ? tx.amount : 0,
      deposit: type === 'income' ? tx.amount : 0,
      balance: 0,
      given_to: tx.description,
      description: tx.description,
      type,
      date: txDate,
      matching_score: 80,
      ...(catId ? { category_id: catId } : {}),
    });

    if (!error) {
      savedCount++;
      const sign = type === 'income' ? '+' : '-';
      lines.push(`• ${tx.description}: ${sign}${currencySymbol}${tx.amount.toFixed(2)} (${catName})`);
    } else {
      failCount++;
      if (__DEV__) console.error('[ImageAgent] Insert error:', tx.description, error);
      captureError(error, { context: 'saveImageTransactions.insert', userId, description: tx.description });
    }
  }

  const failNote = failCount > 0
    ? `\n\n⚠️ ${failCount} transaction${failCount > 1 ? 's' : ''} couldn't be saved — please log them manually.`
    : '';
  const summary = savedCount === 0
    ? "I found transactions but couldn't save them. Please try again."
    : `Got it! I found and logged ${savedCount} transaction${savedCount > 1 ? 's' : ''} from your image:\n\n${lines.join('\n')}${failNote}`;

  return { transactions: valid, summary, savedCount };
}

export async function extractTransactionsFromImage(
  base64Image: string,
  mimeType: string,
  userId: string,
  currency: string = 'USD',
  sessionDate?: string
): Promise<ImageExtractionResult> {
  if (base64Image.length > MAX_IMAGE_BASE64_BYTES) {
    return { transactions: [], summary: "That image is too large to process. Please use a smaller or clearer photo.", savedCount: 0 };
  }
  try {
    const valid = await parseTransactionsFromImage(base64Image, mimeType);
    if (!valid.length) {
      return { transactions: [], summary: "I couldn't find any transactions in that image. Try a clearer photo of a receipt or statement.", savedCount: 0 };
    }
    return saveImageTransactions(valid, userId, currency, sessionDate);
  } catch (e) {
    captureError(e, { context: 'extractTransactionsFromImage', userId });
    throw e;
  }
}

// --- Cache clearing for manual refresh ---
export async function clearAgentCache(userId: string): Promise<void> {
  if (!userId) return;
  const keys = await AsyncStorage.getAllKeys();
  const toRemove = keys.filter(
    (k) => k.startsWith(`insights_${userId}_`) || k.startsWith(`savings_${userId}_`)
  );
  if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
}

// --- Voice transcription via Gemini ---
const MAX_AUDIO_BASE64_BYTES = 10 * 1024 * 1024; // 10MB

export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
  if (!GEMINI_PROXY_URL && !GEMINI_DIRECT_URL) throw new Error('Gemini is not configured');
  if (base64Audio.length > MAX_AUDIO_BASE64_BYTES) throw new Error('Audio file too large');

  const token = await getAuthToken();
  const useProxy = !!(GEMINI_PROXY_URL && token);
  const url = useProxy ? GEMINI_PROXY_URL! : GEMINI_DIRECT_URL!;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (useProxy) headers['Authorization'] = `Bearer ${token}`;

  const body = JSON.stringify({
    contents: [{
      role: 'user',
      parts: [
        { text: 'Transcribe this audio exactly as spoken. Return ONLY the transcribed text, nothing else. If the audio is unclear or empty, return an empty string.' },
        { inlineData: { mimeType, data: base64Audio } },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    } catch (fetchErr) {
      if (useProxy && GEMINI_DIRECT_URL) {
        res = await fetch(GEMINI_DIRECT_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal,
        });
      } else { throw fetchErr; }
    }
    clearTimeout(timeoutId);

    if (useProxy && isInfraError(res.status) && GEMINI_DIRECT_URL) {
      res = await fetch(GEMINI_DIRECT_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(`Transcription failed: ${res.status} - ${(errBody as any)?.error?.message ?? ''}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    return text;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') throw new Error('Transcription request timed out');
    throw e;
  }
}
