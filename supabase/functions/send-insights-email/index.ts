// Supabase Edge Function — send-insights-email
// Triggered by pg_cron daily at 08:00 UTC. Sends daily/weekly insight emails.
//
// Analytics are computed deterministically in _email_template.ts; Gemini only
// writes ONE warm sentence from the pre-computed numbers (and is told not to
// invent any figure). See docs/recurring-transactions-spec.md for the grounded
// philosophy this mirrors.
//
// Secrets: RESEND_API_KEY, GEMINI_API_KEY (+ auto SUPABASE_URL / SERVICE_ROLE_KEY).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  computeAnalytics, renderEmail, symbolOf,
  type Txn, type Cat, type Freq, type EmailAnalytics, type AiFields,
} from './_email_template.ts';

const RESEND_API_KEY       = Deno.env.get('RESEND_API_KEY')!;
const GEMINI_API_KEY       = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_MODEL         = 'gemini-2.5-flash';
const FROM_EMAIL           = 'Finni <insights@updates.heyfinni.com>';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const isMonday = () => new Date().getDay() === 1;
const dateStr = (d: Date) => d.toISOString().split('T')[0];

// Grounded coach fields: Gemini phrases the computed numbers, never invents one.
// Returns greeting + insight (+ weekly focus). Any field with an untraceable
// number is replaced by a safe deterministic fallback.
async function coachFields(name: string, currency: string, a: EmailAnalytics, freq: Freq): Promise<AiFields> {
  const sym = symbolOf(currency);
  const greetFb = a.onTrack
    ? `You're pacing well — ${a.monthUsedPct}% of your monthly budget used. Nice and steady.`
    : `Heads up — you're at ${a.monthUsedPct}% of your monthly budget. Let's ease off a touch.`;
  const top = a.topCategories[0]?.name ?? 'spending';
  const insightFb = a.onTrack
    ? `Your spending is under control this ${freq === 'daily' ? 'day' : 'week'}. ${top} led the way — keep being intentional with it.`
    : `${top} is your biggest driver right now. A small trim there is the quickest win.`;
  const focusFb = `keep an eye on ${top} and check in daily — small daily awareness beats end-of-month surprises.`;

  const facts = {
    spent: Math.round(a.totalSpent), income: Math.round(a.totalIncome),
    month_used_pct: a.monthUsedPct, on_track: a.onTrack,
    top_category: a.topCategories[0]?.name ?? null,
    over_budget_categories: a.todos.filter((t) => t.status === 'over').map((t) => t.name),
  };
  const wants = freq === 'weekly'
    ? `{"greeting":"...","insight":"...","focus":"..."} (greeting: 1 warm sentence ≤20 words; insight: 1-2 reflective sentences on the week; focus: a short phrase completing "Next week — ...")`
    : `{"greeting":"...","insight":"..."} (greeting: 1 warm sentence ≤20 words; insight: 1-2 supportive coaching sentences for today)`;

  const COUNTRY: Record<string, string> = {
    BDT: 'Bangladesh', INR: 'India', PKR: 'Pakistan', LKR: 'Sri Lanka', NPR: 'Nepal',
    USD: 'the US', GBP: 'the UK', EUR: 'the Eurozone', AUD: 'Australia', CAD: 'Canada', SGD: 'Singapore',
  };
  const place = COUNTRY[currency] ?? null;
  const localCtx = place
    ? `The user lives in ${place}. Make every suggestion realistic for local costs and norms — never propose impractically low daily targets (e.g. an unlivable daily food budget). If a category is nearly exhausted, acknowledge it honestly rather than demanding an unrealistic cut.`
    : '';

  const prompt = `You are Finni, a warm, encouraging personal-finance coach. Write the coach copy for ${name}'s ${freq} email.
Use ONLY the numbers in FACTS — NEVER state, compute, or invent any figure not present. Currency symbol is "${sym}". Be specific, kind, motivating, never preachy.
${localCtx}
FACTS: ${JSON.stringify(facts)}
Return ONLY minified JSON: ${wants}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.55, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } } }),
      },
    );
    const data = await res.json();
    const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').replace(/```json?|```/g, '').trim();
    const p = JSON.parse(raw) as Partial<AiFields>;

    // Grounding guard per field: any untraceable number → use the fallback.
    const allowed = new Set([facts.spent, facts.income, facts.month_used_pct].map(String));
    const grounded = (s?: string): boolean => {
      if (!s) return false;
      const nums = (s.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, ''));
      return nums.every((n) => allowed.has(n) || allowed.has(String(Math.round(Number(n)))));
    };
    return {
      greeting: grounded(p.greeting) ? p.greeting!.trim() : greetFb,
      insight: grounded(p.insight) ? p.insight!.trim() : insightFb,
      focus: freq === 'weekly' ? (grounded(p.focus) ? p.focus!.trim() : focusFb) : undefined,
    };
  } catch {
    return { greeting: greetFb, insight: insightFb, focus: freq === 'weekly' ? focusFb : undefined };
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (token !== SUPABASE_SERVICE_KEY) return new Response('Unauthorized', { status: 401 });

  const today = new Date();
  const weekly = isMonday();
  const monthStart = dateStr(new Date(today.getFullYear(), today.getMonth(), 1));
  const weekAgo = dateStr(new Date(today.getTime() - 7 * 86400000));
  const todayD = dateStr(today);

  const { data: users, error: usersError } = await supabase
    .from('profiles').select('id, name, currency, email_insights')
    .neq('email_insights', 'off').not('email_insights', 'is', null);
  if (usersError || !users?.length) return new Response(JSON.stringify({ sent: 0, error: usersError?.message }), { status: 200 });

  let sent = 0;
  const errors: string[] = [];

  for (const profile of users) {
    const freq = profile.email_insights as Freq;
    if (freq === 'weekly' && !weekly) continue;
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
      const email = authUser?.user?.email;
      if (!email) continue;
      const currency = profile.currency ?? 'USD';
      const name = profile.name ?? 'there';

      // Fetch from the earliest needed date (month start covers both period + pacing).
      const since = monthStart < weekAgo ? monthStart : weekAgo;
      const { data: txData } = await supabase
        .from('transactions').select('description, withdrawal, deposit, type, date, category_id')
        .eq('user_id', profile.id).gte('date', since).order('date', { ascending: false }).limit(300);
      const { data: catData } = await supabase
        .from('categories').select('id, name, emoji, budget').eq('user_id', profile.id);

      const all = (txData ?? []) as Txn[];
      const periodStart = freq === 'daily' ? todayD : weekAgo;
      const periodTxns = all.filter((t) => dateStr(new Date(t.date)) >= periodStart);
      const monthTxns = all.filter((t) => dateStr(new Date(t.date)) >= monthStart);

      const analytics = computeAnalytics(periodTxns, monthTxns, (catData ?? []) as Cat[], currency, today);
      const ai = await coachFields(name, currency, analytics, freq);
      const subject = freq === 'daily' ? '📊 Your Finni daily snapshot' : '📊 Your Finni weekly summary';
      const appUrl = 'finni-app://home';
      const html = renderEmail(freq, name, currency, analytics, ai, appUrl);

      await sendEmail(email, subject, html);
      sent++;
    } catch (e) {
      errors.push(`${profile.id}: ${(e as Error).message}`);
    }
  }

  return new Response(JSON.stringify({ sent, errors }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
