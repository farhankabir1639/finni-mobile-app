// Supabase Edge Function — process-forwarded-email (v2, rewritten)
// Inbound webhook (SendGrid Inbound Parse) for a user's forwarded bank/MFS email.
// Pipeline: token auth → match user by alias → financial filter → OTP scrub →
// grounded Gemini extraction + categorization → dedup → stage to
// extracted_transactions (status='pending'). The app's Review screen confirms.
// See docs/email-forwarding-v1-spec.md.
//
// Secrets: GEMINI_API_KEY, INBOUND_WEBHOOK_SECRET (+ auto SUPABASE_* keys).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY   = Deno.env.get('GEMINI_API_KEY')!;
const WEBHOOK_SECRET   = Deno.env.get('INBOUND_WEBHOOK_SECRET') ?? '';
const GEMINI_MODEL     = 'gemini-2.5-flash';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Known BD financial senders + generic keywords. Non-matching mail never reaches the LLM.
const SENDER_HINTS = ['bkash', 'nagad', 'rocket', 'upay', 'bank', 'visa', 'mastercard', 'card', 'dbbl', 'brac', 'city', 'ebl', 'sslcommerz'];
const KEYWORD_HINTS = ['tk', 'bdt', '৳', 'debit', 'credit', 'payment', 'paid', 'transaction', 'txn', 'purchase', 'spent', 'received', 'balance', 'charged'];

function looksFinancial(from: string, subject: string, text: string): boolean {
  const hay = `${from} ${subject} ${text}`.toLowerCase();
  return SENDER_HINTS.some((s) => hay.includes(s)) || KEYWORD_HINTS.some((k) => hay.includes(k));
}

// Strip OTP / one-time codes so they're never stored or sent to the LLM.
function scrubOtp(text: string): string {
  return text
    .replace(/(otp|one[-\s]?time|verification|security|passcode|code)[^\d]{0,20}\d{3,8}/gi, '$1 [redacted]')
    .replace(/\b\d{4,8}\b(?=\s*(is your|otp|code|pin))/gi, '[redacted]');
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Extracted {
  is_transaction: boolean;
  amount?: number; currency?: string;
  direction?: 'expense' | 'income';
  merchant?: string; date?: string | null;
  category?: string | null; confidence?: number;
}

async function extract(content: string, categories: { name: string }[], currency: string): Promise<Extracted | null> {
  const catList = categories.map((c) => c.name).join(', ') || '(none)';
  const prompt = `You read a forwarded bank / mobile-money (bKash, Nagad, etc.) email and extract ONE transaction. Currency context: ${currency} (৳/Tk = BDT).
Rules: "debited / paid / spent / purchase / charged" = expense; "credited / received / deposit" = income. Use ONLY facts in the email — never invent an amount. If it is not a real financial transaction (promo, OTP, statement summary, newsletter), set is_transaction=false.
Suggest a category from this list if one clearly fits, else null: ${catList}

EMAIL:
${content.slice(0, 2500)}

Return ONLY minified JSON:
{"is_transaction":boolean,"amount":number,"currency":"${currency}","direction":"expense"|"income","merchant":"string","date":"YYYY-MM-DD"|null,"category":"exact name or null","confidence":0-1}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    const data = await res.json();
    const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').replace(/```json?|```/g, '').trim();
    return JSON.parse(raw) as Extracted;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    // 1. Webhook auth — reject anything without the shared secret (prevents spoofed injections).
    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? req.headers.get('x-webhook-token') ?? '';
    if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) return ok({ error: 'unauthorized' }, 401);

    const payload = await req.json().catch(() => ({}));
    const from = String(payload.from ?? '');
    const to = String(payload.to ?? '').toLowerCase().trim();
    const subject = String(payload.subject ?? '');
    const text = String(payload.text ?? payload.html ?? '');
    if (!to || !text) return ok({ message: 'nothing to process' });

    // 2. Match user by the forwarding alias (the `to` address). FIX for the old
    //    bug that used the first active connection.
    const alias = (to.match(/[^\s<>]+@[^\s<>]+/) ?? [to])[0];
    const { data: conn } = await supabase
      .from('email_sms_connections')
      .select('user_id')
      .eq('connection_type', 'email').eq('is_active', true)
      .eq('forwarding_alias', alias)
      .maybeSingle();
    if (!conn) return ok({ message: 'no matching connection' });
    const userId = conn.user_id as string;

    // 3. Financial filter — drop non-financial mail before it touches the LLM.
    if (!looksFinancial(from, subject, text)) return ok({ message: 'not financial' });

    // 4. OTP scrub + dedup.
    const clean = scrubOtp(`${subject}\n${text}`).slice(0, 4000);
    const sourceHash = await sha256(`${alias}|${from}|${subject}|${text.slice(0, 400)}`);

    // 5. Extract + categorize (grounded).
    const { data: profile } = await supabase.from('profiles').select('currency').eq('id', userId).maybeSingle();
    const currency = profile?.currency ?? 'BDT';
    const { data: categories } = await supabase.from('categories').select('id, name').eq('user_id', userId);
    const ex = await extract(clean, categories ?? [], currency);
    if (!ex || !ex.is_transaction || !ex.amount || ex.amount <= 0) return ok({ message: 'no transaction found' });

    // Grounding guard: the amount must actually appear in the email text.
    const amountStr = String(Math.round(ex.amount));
    if (!text.replace(/,/g, '').includes(amountStr)) return ok({ message: 'amount not grounded', amount: ex.amount });

    const matched = (categories ?? []).find((c) => c.name.toLowerCase() === (ex.category ?? '').toLowerCase());

    // 6. Stage (idempotent via unique (user_id, source_hash)).
    const { error } = await supabase.from('extracted_transactions').upsert({
      user_id: userId,
      source: 'email',
      source_hash: sourceHash,
      raw_snippet: clean.slice(0, 500),
      amount: ex.amount,
      direction: ex.direction === 'income' ? 'income' : 'expense',
      merchant: ex.merchant ?? null,
      currency: ex.currency ?? currency,
      occurred_at: ex.date ? `${ex.date}T12:00:00Z` : new Date().toISOString(),
      suggested_category_id: matched?.id ?? null,
      confidence: ex.confidence ?? 0.5,
      status: 'pending',
    }, { onConflict: 'user_id,source_hash', ignoreDuplicates: true });
    if (error) return ok({ error: error.message }, 500);

    return ok({ success: true, staged: true });
  } catch (e) {
    return ok({ error: (e as Error).message }, 500);
  }
});
