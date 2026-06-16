import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseUrl } from './supabase';
import { captureError } from './sentry';
import { classifyChatIntent } from './chat/intent';
import { buildChatPrompt } from './chat/buildChatPrompt';

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
  if (__DEV__) console.error('[Agent] No Gemini proxy or API key configured. All AI features will fail.');
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
  retryCount = 0,
  genConfig?: Record<string, unknown>
): Promise<string> {
  if (!GEMINI_PROXY_URL && !GEMINI_DIRECT_URL) throw new Error('Gemini is not configured');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  const defaultConfig = { temperature: 0.3, maxOutputTokens: 2048 };
  const effectiveConfig = genConfig ? { ...defaultConfig, ...genConfig } : defaultConfig;
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
          model: GEMINI_MODEL,
          contents,
          generationConfig: effectiveConfig,
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
            generationConfig: effectiveConfig,
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
          generationConfig: effectiveConfig,
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
        return callGeminiWithHistory(contents, retryCount + 1, genConfig);
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
        return callGeminiWithHistory(contents, retryCount + 1, genConfig);
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

// --- Grounded generation helper (used by the insights pipeline) ---
// Single-shot text generation over the shared Gemini transport (proxy + direct
// fallback). The insights layer computes every number itself and only asks
// Gemini to phrase it, so this is a thin pass-through with a low token ceiling.
export async function generateGroundedText(
  prompt: string,
  opts?: { temperature?: number; maxOutputTokens?: number }
): Promise<string> {
  return callGeminiWithHistory(
    [{ role: 'user', parts: [{ text: prompt }] }],
    0,
    {
      temperature: opts?.temperature ?? 0.5,
      maxOutputTokens: opts?.maxOutputTokens ?? 512,
      // gemini-2.5-flash is a thinking model; for a short phrasing task the
      // thinking budget would otherwise eat the whole output allowance and
      // return empty text. Disable it — no reasoning needed to phrase facts.
      thinkingConfig: { thinkingBudget: 0 },
    }
  );
}

// --- Category → budget-bucket classification (labels only, no numbers) ---
// Used by the Smart Budget feature. Returns a map of category name → bucket.
// The caller applies keyword classification first and only asks the model about
// the leftovers, then falls back to 'wants' for anything still unresolved.
export async function classifyCategoryBuckets(
  names: string[]
): Promise<Record<string, 'needs' | 'wants' | 'savings'>> {
  if (!names.length) return {};
  try {
    const prompt = `Classify each personal-finance category into EXACTLY one bucket:
- "needs": essentials (food, groceries, rent, bills, utilities, transport, health, education, insurance, debt/loan)
- "wants": discretionary (entertainment, shopping, dining out, hobbies, treats, travel, subscriptions)
- "savings": savings, investments, emergency fund, retirement, financial goals
Return ONLY minified JSON mapping each exact category name to its bucket, e.g. {"Food":"needs","Netflix":"wants"}.
Categories: ${JSON.stringify(names)}`;
    const text = await generateGroundedText(prompt, { temperature: 0.1, maxOutputTokens: 512 });
    const cleaned = text.replace(/```json?|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, string>;
    const out: Record<string, 'needs' | 'wants' | 'savings'> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'needs' || v === 'wants' || v === 'savings') out[k] = v;
    }
    return out;
  } catch (e) {
    if (__DEV__) console.log('[classifyCategoryBuckets] failed:', e);
    return {};
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

// --- Insights-specific Gemini call ---
// Bypasses the Supabase proxy so Supabase edge function timeouts can't truncate
// the response mid-JSON. Uses a bounded thinking budget (1024 tokens) so the
// model still reasons about spending patterns without taking 30+ seconds.
async function callInsightsDirect(prompt: string, retryCount = 0): Promise<string> {
  if (!GEMINI_DIRECT_URL && !GEMINI_PROXY_URL) throw new Error('Gemini is not configured');

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 1024 },
    },
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    // Always prefer direct API for insights to avoid proxy timeout truncation
    const url = GEMINI_DIRECT_URL ?? GEMINI_PROXY_URL!;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!GEMINI_DIRECT_URL && GEMINI_PROXY_URL) {
      const token = await getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    let res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });

    // If direct failed with infra error and proxy is available, try proxy as fallback
    if (isInfraError(res.status) && GEMINI_PROXY_URL && url !== GEMINI_PROXY_URL) {
      const token = await getAuthToken();
      res = await fetch(GEMINI_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 1024 } },
        }),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);

    // Retry on 503 (overload) and 429 (rate limit) with backoff
    if ((res.status === 503 || res.status === 429) && retryCount < 3) {
      const delay = RETRY_DELAYS[retryCount];
      if (__DEV__) console.log(`[Insights] ${res.status}, retrying in ${delay}ms (attempt ${retryCount + 1}/3)`);
      await new Promise((r) => setTimeout(r, delay));
      return callInsightsDirect(prompt, retryCount + 1);
    }

    if (!res.ok) throw new Error(`Gemini insights error: ${res.status}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') throw new Error('Insights request timed out');
    throw e;
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

  const MIN_TRANSACTIONS = 3;
  if (realTransactions.length < MIN_TRANSACTIONS) {
    return [{
      title: 'Building your insights...',
      description: `Log ${MIN_TRANSACTIONS - realTransactions.length} more transaction${MIN_TRANSACTIONS - realTransactions.length > 1 ? 's' : ''} and Finni will start generating personalized insights for you.`,
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

      const text = await callInsightsDirect(prompt);
      const cleaned = text.replace(/```json?|```/g, '').trim();
      let insights: DailyInsight[];
      try {
        insights = JSON.parse(cleaned);
        if (!Array.isArray(insights)) insights = [];
      } catch (parseErr) {
        // Attempt partial recovery: strip trailing incomplete object and close the array
        let recovered = false;
        try {
          const arrayStart = cleaned.indexOf('[');
          if (arrayStart !== -1) {
            let partial = cleaned.slice(arrayStart);
            partial = partial.replace(/,?\s*\{[^}]*$/, '');
            if (!partial.endsWith(']')) partial += ']';
            insights = JSON.parse(partial);
            if (!Array.isArray(insights)) insights = [];
            else recovered = insights.length > 0;
            if (__DEV__) console.log('[Agent2] Recovered partial insights:', insights.length);
          } else {
            insights = [];
          }
        } catch {
          insights = [];
        }
        if (!recovered) {
          if (__DEV__) console.error('[Agent2] JSON parse Error (unrecoverable):', parseErr);
          captureError(parseErr, { context: 'getDailyInsights.jsonParse', userId });
        }
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

    const text = await callInsightsDirect(prompt);
    const cleaned = text.replace(/```json?|```/g, '').trim();
    let localizedResults: SavingsRecommendation[];
    try {
      localizedResults = JSON.parse(cleaned);
      if (!Array.isArray(localizedResults)) localizedResults = [];
    } catch (parseErr) {
      let recovered = false;
      try {
        const arrayStart = cleaned.indexOf('[');
        if (arrayStart !== -1) {
          let partial = cleaned.slice(arrayStart);
          partial = partial.replace(/,?\s*\{[^}]*$/, '');
          if (!partial.endsWith(']')) partial += ']';
          localizedResults = JSON.parse(partial);
          if (!Array.isArray(localizedResults)) localizedResults = [];
          else recovered = localizedResults.length > 0;
        } else {
          localizedResults = [];
        }
      } catch {
        localizedResults = [];
      }
      if (!recovered) {
        if (__DEV__) console.error('[Agent3] JSON parse Error (unrecoverable):', parseErr);
        captureError(parseErr, { context: 'getWeeklySavingsRecommendations.jsonParse', userId });
      }
    }
    if (localizedResults.length > 0) {
      await AsyncStorage.setItem(weekKey, JSON.stringify(localizedResults));
    }
    return localizedResults;
  } catch (e) {
    if (__DEV__) console.error('[Agent3] Error:', e);
    captureError(e, { context: 'getWeeklySavingsRecommendations', userId });
    return [];
  }
}



// --- Chat agent: conversational + transaction parsing ---
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

// A category the AI inferred that doesn't exist yet. Instead of silently
// creating it, we save the affected transaction(s) under "Other" and propose
// the new category to the user — created on confirm, or auto-created at session
// end if they don't respond.
export type CategoryProposal = {
  name: string;
  emoji: string;
  transactionIds: string[];
};

export type ChatAgentResult = {
  response: string;
  transaction: ParsedTransaction;
  // All transactions parsed from a single message (bulk logging). The chat
  // renders one card per entry. `transaction` stays as the first for back-compat.
  transactions?: ParsedTransaction[];
  // New categories the user should confirm (see CategoryProposal).
  categoryProposals?: CategoryProposal[];
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
  txDataArray: Record<string, unknown>[];
  newCategory: Record<string, unknown> | null;
  goalUpdate: { goal_name: string; amount: number } | null;
  goalCreate: { name: string; target_amount: number; goal_type: string } | null;
  categoryBudgetUpdate: { category_name: string; budget: number } | null;
  investmentData: { name: string; ticker?: string; asset_type: string; quantity: number; buy_price: number; action: 'buy' | 'sell' } | null;
  txParseError: boolean;
} {
  const txMatch = text.match(TRANSACTION_DATA_REGEX); // kept for single-match compat below
  const catMatch = text.match(NEW_CATEGORY_REGEX);
  const goalUpdateMatch = text.match(GOAL_UPDATE_REGEX);
  const goalCreateMatch = text.match(GOAL_CREATE_REGEX);

  let txParseError = false;
  let response = text;

  const txDataArray: Record<string, unknown>[] = [];
  for (const m of text.matchAll(/TRANSACTION_DATA:\s*(\{[\s\S]*?\})(?:\s|$)/g)) {
    try { txDataArray.push(JSON.parse(m[1]) as Record<string, unknown>); }
    catch (e) {
      if (__DEV__) console.error('[Agent] Failed to parse TRANSACTION_DATA JSON:', e);
      txParseError = true;
    }
  }
  let txData: Record<string, unknown> | null = txDataArray[0] ?? null;
  let newCategory: Record<string, unknown> | null = null;
  let goalUpdate: { goal_name: string; amount: number } | null = null;
  let goalCreate: { name: string; target_amount: number; goal_type: string } | null = null;

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
  // Strip ALL TRANSACTION_DATA blocks from the displayed response
  if (txMatch) {
    response = response.replace(/TRANSACTION_DATA:\s*\{[\s\S]*?\}(?:\s|$)/g, '').trim();
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

  return { response, txData, txDataArray, newCategory, goalUpdate, goalCreate, categoryBudgetUpdate, investmentData, txParseError };
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

  // Prompt chaining: classify the message, then assemble only the rule blocks
  // that intent needs. 'action' = full rule set (unchanged behavior); 'query' =
  // slim prompt (context + safety + query rules). See src/lib/chat/.
  const intent = classifyChatIntent(userMessage);
  const systemPrompt = buildChatPrompt(
    intent,
    {
      name: profile?.name ?? 'User',
      currency: profile?.currency || 'USD',
      todayDateStr,
      pastThreadNote:
        sessionDate && sessionDate !== now.toISOString().split('T')[0]
          ? `\nNOTE: The user is adding to a past thread from ${todayDateStr}. Record all transactions for that date.`
          : '',
      monthlyIncome,
      todaySpent,
      monthSpent,
      monthLeft,
      categoriesJson: JSON.stringify(categories?.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, budget: c.budget, spent: c.spent }))),
      goalsJson: JSON.stringify(goals?.map((g) => ({ name: g.name, target: g.target_amount, current: g.current_amount }))),
      transactionContext,
      investmentContext,
      portfolioLine: totalPortfolioValue > 0 ? `Total portfolio value: ${profile?.currency || 'USD'} ${totalPortfolioValue.toFixed(2)}` : '',
    },
    userMessage
  );

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
    let { response, txData, txDataArray, newCategory, goalUpdate, goalCreate, categoryBudgetUpdate, investmentData, txParseError } = extractTransactionData(text);

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
      // If the AI proposes a category that doesn't exist, we hold it here instead
      // of creating it, and attach the transaction id after insert.
      let proposalForMain: { name: string; emoji: string } | null = null;

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
            // No good match. Don't silently create — save under "Other" for now
            // and propose the new category for the user to confirm (created on
            // confirm, or auto-created at session end).
            const newCatName = typeof txData.category_id === 'string' ? txData.category_id : categoryId;
            const autoEmoji = CATEGORY_EMOJI_MAP[newCatName.toLowerCase()] ?? '📦';

            // If it already exists (e.g. created earlier this session), reuse it.
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
              const otherCat = (allCategories ?? []).find((c) => c.name.toLowerCase() === 'other');
              categoryId = otherCat?.id ?? null;
              matchingScore = 0;
              proposalForMain = { name: newCatName, emoji: autoEmoji };
              if (__DEV__) console.log(`[Agent1] Proposing new category "${newCatName}" ${autoEmoji} (saved under Other for now)`);
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

      const mainTxId = (insertedRow?.[0] as { id?: string } | undefined)?.id;
      const otherCatId = (allCategories ?? []).find((c) => c.name.toLowerCase() === 'other')?.id ?? null;

      // Category proposals awaiting user confirmation. Merge by name so two
      // transactions wanting the same new category produce a single prompt.
      const pendingProposals: CategoryProposal[] = [];
      const addProposal = (name: string, emoji: string, txId: string) => {
        const existing = pendingProposals.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (existing) existing.transactionIds.push(txId);
        else pendingProposals.push({ name, emoji, transactionIds: [txId] });
      };
      if (proposalForMain && mainTxId) addProposal(proposalForMain.name, proposalForMain.emoji, mainTxId);

      // Collect every parsed transaction so the chat can render a card per item.
      // The primary transaction is first; extras follow below. Show the proposed
      // name on the card even though it's saved under "Other" until confirmed.
      const parsedTransactions: ParsedTransaction[] = [{
        amount,
        description,
        category: proposalForMain?.name ?? categoryName ?? '',
        date: new Date().toISOString().slice(0, 10),
        type: type as 'expense' | 'income',
      }];

      // Insert any additional transactions from the same message (bulk logging)
      for (const extra of txDataArray.slice(1)) {
        const extraAmount = Math.abs(typeof extra.amount === 'number' ? extra.amount : parseFloat(String(extra.amount ?? '')));
        const extraType = extra.type === 'income' ? 'income' : 'expense';
        if (!isNaN(extraAmount) && extraAmount > 0 && extraAmount < 1_000_000) {
          const extraRawName = typeof extra.category_id === 'string' ? extra.category_id : '';
          let extraCatId: string | null = extraRawName || null;
          let extraCatName = extraRawName;
          let extraProposal: { name: string; emoji: string } | null = null;
          if (extraCatId) {
            const uuidRx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRx.test(extraCatId)) {
              extraCatName = (allCategories ?? []).find(c => c.id === extraCatId)?.name ?? extraCatName;
            } else {
              const lower = extraCatId.toLowerCase();
              const best = (allCategories ?? [])
                .map(c => ({ ...c, score: c.name.toLowerCase() === lower ? 1 : c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()) ? 0.85 : 0 }))
                .sort((a, b) => b.score - a.score)[0];
              if ((best?.score ?? 0) >= 0.7) { extraCatId = best.id; extraCatName = best.name; }
              else {
                // Unmatched — save under "Other" and propose the new category.
                extraProposal = { name: extraRawName, emoji: CATEGORY_EMOJI_MAP[lower] ?? '📦' };
                extraCatId = otherCatId;
              }
            }
          }
          const extraInsert: Record<string, unknown> = {
            user_id: userId,
            withdrawal: extraType === 'expense' ? extraAmount : 0,
            deposit: extraType === 'income' ? extraAmount : 0,
            balance: 0,
            given_to: typeof extra.description === 'string' ? extra.description : '',
            description: typeof extra.description === 'string' ? extra.description : '',
            type: extraType,
            date: sessionDate ? new Date(sessionDate).toISOString() : new Date().toISOString(),
            matching_score: 0,
          };
          if (extraCatId) extraInsert.category_id = extraCatId;
          const { data: extraRow, error: extraErr } = await supabase.from('transactions').insert(extraInsert).select();
          if (extraErr && __DEV__) console.error('[Agent1] Extra transaction insert error:', extraErr);
          const extraTxId = (extraRow?.[0] as { id?: string } | undefined)?.id;
          if (extraProposal && extraTxId) addProposal(extraProposal.name, extraProposal.emoji, extraTxId);
          parsedTransactions.push({
            amount: extraAmount,
            description: typeof extra.description === 'string' ? extra.description : '',
            category: extraCatName,
            date: (sessionDate ?? new Date().toISOString()).slice(0, 10),
            type: extraType as 'expense' | 'income',
          });
        }
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
        transaction: parsedTransactions[0],
        transactions: parsedTransactions,
        categoryProposals: pendingProposals.length ? pendingProposals : undefined,
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
      return { response: "Finni is a bit busy right now — please try again in a few seconds. 🔄", transaction: null };
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
      return { response: "You're sending messages too quickly. Please wait a moment and try again. ⏳", transaction: null };
    }
    if (msg.includes('timed out') || msg.includes('AbortError')) {
      return { response: "That took too long to process. Please try again. ⏱️", transaction: null };
    }
    return {
      response: "Something went wrong on my end. Please try again in a moment. 🔄",
      transaction: null,
    };
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
