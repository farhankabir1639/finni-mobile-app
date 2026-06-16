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
  computeAnalytics, buildEmailHtml, formatCurrency,
  type Txn, type Cat, type Freq, type EmailAnalytics,
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

// Grounded warm line: Gemini phrases the computed numbers, never invents one.
async function warmLine(name: string, currency: string, a: EmailAnalytics, freq: Freq): Promise<string> {
  const fallback = a.onTrack
    ? `You're pacing well — ${a.monthUsedPct}% of your monthly budget used. Keep it up!`
    : `Heads up: you're at ${a.monthUsedPct}% of your monthly budget. Let's ease off a bit.`;
  const facts = {
    spent: Math.round(a.totalSpent), income: Math.round(a.totalIncome),
    month_used_pct: a.monthUsedPct, on_track: a.onTrack,
    top_category: a.topCategories[0]?.name ?? null,
  };
  const prompt = `You are Finni, a warm personal-finance companion. Write ONE short, friendly sentence (max 22 words) for ${name}'s ${freq} email, using ONLY these facts. Never state any number not in the facts. No greeting (it's added separately).
FACTS: ${JSON.stringify(facts)}
Currency symbol context: ${formatCurrency(currency, 0).replace('0', '')}
Return ONLY the sentence, no quotes.`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 80, thinkingConfig: { thinkingBudget: 0 } } }),
      },
    );
    const data = await res.json();
    const text: string = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim().replace(/^["']|["']$/g, '');
    // Lightweight grounding guard: reject if it introduces an untraceable number.
    const allowed = new Set([facts.spent, facts.income, facts.month_used_pct].map(String));
    const nums = (text.match(/\d[\d,]*/g) ?? []).map((s) => s.replace(/,/g, ''));
    const grounded = nums.every((n) => allowed.has(n) || allowed.has(String(Math.round(Number(n)))));
    return text && grounded ? text : fallback;
  } catch {
    return fallback;
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
      const line = await warmLine(name, currency, analytics, freq);
      const subject = freq === 'daily' ? '📊 Your Finni daily snapshot' : '📊 Your Finni weekly summary';
      const html = buildEmailHtml(name, currency, analytics, line, freq);

      await sendEmail(email, subject, html);
      sent++;
    } catch (e) {
      errors.push(`${profile.id}: ${(e as Error).message}`);
    }
  }

  return new Response(JSON.stringify({ sent, errors }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
