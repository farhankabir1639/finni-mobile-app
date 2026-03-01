import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil((((now.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
}

async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    }),
  });
  console.log('[Agent1] Gemini response status:', res.status);
  const data = await res.json();
  console.log('[Agent1] Gemini data:', JSON.stringify(data).slice(0, 200));
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

async function callGeminiWithHistory(
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    }),
  });
  console.log('[Agent1] Gemini response status:', res.status);
  const data = await res.json();
  console.log('[Agent1] Gemini data:', JSON.stringify(data).slice(0, 200));
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');
  return text;
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
        response: `Parsed: ${parsed.description} - $${Math.abs(parsed.amount).toFixed(2)}`,
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
  summary: string;
  topCategory: string;
  suggestion: string;
};

export async function getDailyInsights(
  userId: string,
  transactions: { withdrawal?: number; deposit?: number; description: string | null; category: string | null; date: string; type?: string }[]
): Promise<DailyInsight[]> {
  console.log('[Agent2] Running insights for user:', userId);
  console.log('[Agent2] Transactions found:', transactions?.length);

  const cacheKey = `insights_${userId}_${new Date().toDateString()}`;
  const cached = await AsyncStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  const totalSpent =
    transactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + (Number(t.withdrawal) || 0), 0);
  const totalIncome =
    transactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + (Number(t.deposit) || 0), 0);

  const normalized = transactions.slice(0, 50).map((t) => ({
    ...t,
    amount: t.type === 'expense' ? (Number(t.withdrawal) || 0) : (Number(t.deposit) || 0),
  }));

  try {
    const prompt = `Based on these transactions, give 3 short insights (each as JSON: { "summary": "...", "topCategory": "...", "suggestion": "..." }). Return a JSON array only.
Totals: totalSpent=$${totalSpent.toFixed(2)}, totalIncome=$${totalIncome.toFixed(2)}
Transactions: ${JSON.stringify(normalized)}`;
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

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await AsyncStorage.removeItem(`insights_${userId}_${yesterday.toDateString()}`);

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

  try {
    const prompt = `Based on these transactions, suggest 3 practical ways to save money. Return a JSON array: [{ "title": "...", "description": "...", "potentialSavings": "..." }]. No markdown.
Totals: totalSpent=$${totalSpent.toFixed(2)}, totalIncome=$${totalIncome.toFixed(2)}
Transactions: ${JSON.stringify(normalized)}`;
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
  recentTransactions?: { withdrawal?: number; deposit?: number; description: string | null; category: string | null; date: string; type?: string }[] | null;
  goals?: { name: string; target_amount?: number; current_amount?: number }[] | null;
};

const TRANSACTION_DATA_REGEX = /TRANSACTION_DATA:\s*(\{[\s\S]*?\})(?:\s|$)/;
const NEW_CATEGORY_REGEX = /NEW_CATEGORY:\s*(\{[\s\S]*?\})(?:\s|$)/;

function extractTransactionData(text: string): {
  response: string;
  txData: Record<string, unknown> | null;
  newCategory: Record<string, unknown> | null;
} {
  const txMatch = text.match(TRANSACTION_DATA_REGEX);
  const catMatch = text.match(NEW_CATEGORY_REGEX);

  let txData: Record<string, unknown> | null = null;
  let newCategory: Record<string, unknown> | null = null;
  let response = text;

  if (catMatch) {
    try {
      newCategory = JSON.parse(catMatch[1]) as Record<string, unknown>;
    } catch {}
    response = response.replace(NEW_CATEGORY_REGEX, '').trim();
  }
  if (txMatch) {
    try {
      txData = JSON.parse(txMatch[1]) as Record<string, unknown>;
    } catch {}
    response = response.replace(TRANSACTION_DATA_REGEX, '').trim();
  }

  return { response, txData, newCategory };
}

export async function chatAgent(
  userMessage: string,
  userId: string,
  messages: ChatMessage[],
  context?: ChatAgentContext
): Promise<ChatAgentResult> {
  console.log('[Agent1] URL being used:', GEMINI_URL);
  console.log('[Agent1] Key length:', GEMINI_API_KEY?.length);
  console.log('[Agent1] API Key exists:', !!process.env.EXPO_PUBLIC_GEMINI_API_KEY);
  console.log('[Agent1] User ID:', userId);
  console.log('[Agent1] Message:', userMessage);

  const profile = context?.profile ?? null;
  const categories = context?.categories ?? [];
  const recentTransactions = context?.recentTransactions ?? [];
  const goals = context?.goals ?? [];

  const systemPrompt = `You are Finni, a smart AI personal finance coach. 
You have access to the user's real financial data.

User: ${profile?.name ?? 'User'}
Currency: ${profile?.currency || 'USD'}
Categories: ${JSON.stringify(categories?.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, budget: c.budget, spent: c.spent })))}
Recent transactions: ${JSON.stringify(recentTransactions?.slice(0, 5))}
Goals: ${JSON.stringify(goals?.map((g) => ({ name: g.name, target: g.target_amount, current: g.current_amount })))}

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

STEP 2 - MATCH TO USER'S CATEGORIES:
Compare your semantic analysis to the user's actual category list above.
Use fuzzy matching - "drinks" maps to "Food" if Food exists.

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

INCOME vs EXPENSE:
- Expense: spent, paid, bought, cost, bill, any food/item name
- Income: received, earned, salary, got paid, freelance, refund
- If ambiguous: ask "Was that an expense or income?"

CRITICAL RULES:
1. ALWAYS write a friendly confirmation message first (e.g. "✅ Logged $1.25 under Food.")
2. THEN on the very last line append TRANSACTION_DATA
3. Never return ONLY TRANSACTION_DATA with no message above it
4. Never put any text after TRANSACTION_DATA

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
    const { response, txData, newCategory } = extractTransactionData(text);

    // Fallback if Gemini returns empty response after stripping TRANSACTION_DATA
    const finalResponse =
      response.trim() ||
      (txData
        ? `✅ Logged $${Math.abs(Number(txData.amount)).toFixed(2)} under ${categories?.find((c) => c.id === txData.category_id)?.name ?? 'expenses'}.`
        : "I couldn't process that. Please try again.");

    if (newCategory && typeof newCategory.name === 'string') {
      const { data: newCat, error: catError } = await supabase
        .from('categories')
        .insert({
          user_id: userId,
          name: newCategory.name,
          emoji: typeof newCategory.emoji === 'string' ? newCategory.emoji : '📦',
          budget: typeof newCategory.budget === 'number' ? newCategory.budget : 0,
          spent: 0,
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
      const categoryId = typeof txData.category_id === 'string' ? txData.category_id : null;
      const categoryName = categoryId ? categories?.find((c) => c.id === categoryId)?.name ?? null : null;
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
        date: new Date().toISOString(),
        matching_score: 0,
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

    return { response: finalResponse, transaction: null };
  } catch (e) {
    console.error('[Agent1] chatAgent Error:', e);
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
