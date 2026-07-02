// Supabase Edge Function — process-forwarded-email (v4, SendGrid Inbound Parse)
// Inbound webhook for a user's forwarded bank/MFS email, via SendGrid Inbound
// Parse. SendGrid POSTs multipart/form-data (from,to,subject,text,html,…) and
// does NOT sign requests, so we authenticate with a hard-to-guess token in the
// webhook URL (?token=…). Pipeline: token auth → match user by alias →
// financial filter → OTP scrub → grounded Gemini extraction + categorization →
// dedup → stage to extracted_transactions (status='pending'). The Review tab confirms.
//
// Secrets: GEMINI_API_KEY, INBOUND_WEBHOOK_SECRET (+ auto SUPABASE_* keys).
// Deploy with --no-verify-jwt (SendGrid has no Supabase JWT).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY  = Deno.env.get('GEMINI_API_KEY')!;
const WEBHOOK_SECRET  = Deno.env.get('INBOUND_WEBHOOK_SECRET') ?? '';
const GEMINI_MODEL    = 'gemini-2.5-flash';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Known BD financial senders (matched loosely against the sender address) +
// generic keywords (matched on WORD boundaries against the body so "tk" doesn't
// hit "thank", "card" doesn't hit "discard", etc.). '৳' is a symbol, matched raw.
const SENDER_HINTS = ['bkash', 'nagad', 'rocket', 'upay', 'dbbl', 'brac', 'ebl', 'sslcommerz', 'mastercard', 'visa'];
const KEYWORD_HINTS = ['tk', 'bdt', 'debit', 'credit', 'payment', 'paid', 'transaction', 'txn', 'purchase', 'spent', 'received', 'balance', 'charged', 'debited', 'credited'];

function looksFinancial(from: string, subject: string, text: string): boolean {
  const fromL = from.toLowerCase();
  if (SENDER_HINTS.some((s) => fromL.includes(s))) return true;
  const hay = `${subject} ${text}`.toLowerCase();
  if (hay.includes('৳')) return true;
  return KEYWORD_HINTS.some((k) => new RegExp(`\\b${k}\\b`).test(hay));
}

// Redact sensitive PII before storage OR the LLM: OTP/one-time codes AND long
// digit runs (account/card numbers, 9+ digits) — transaction amounts are short
// (< 9 digits) so they're preserved for extraction + grounding.
function scrubSensitive(text: string): string {
  return text
    .replace(/(otp|one[-\s]?time|verification|security|passcode|code)[^\d]{0,20}\d{3,8}/gi, '$1 [redacted]')
    .replace(/\b\d{4,8}\b(?=\s*(is your|otp|code|pin))/gi, '[redacted]')
    .replace(/\b[xX*]{2,}\d{2,6}\b/g, '[redacted]')   // masked card/acct: ****1234
    .replace(/\b\d{9,}\b/g, '[redacted]');            // full account/card numbers
}

// The amount must appear in the email as a standalone number — handles decimals
// (1234.56 vs a rounded 1235) and rejects substring hits (a year, acct fragment).
function amountIsGrounded(amount: number, text: string): boolean {
  const norm = text.replace(/,/g, '');
  const forms = new Set([String(amount), amount.toFixed(2), amount.toFixed(0), String(Math.round(amount))]);
  for (const f of forms) {
    const esc = f.replace(/\./g, '\\.');
    if (new RegExp(`(?<![\\d.])${esc}(?![\\d])`).test(norm)) return true;
  }
  return false;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function emailsFrom(...vals: unknown[]): string[] {
  const out: string[] = [];
  for (const v of vals) {
    const m = String(v ?? '').toLowerCase().match(/[^\s<>,;]+@[^\s<>,;]+/g);
    if (m) out.push(...m);
  }
  return [...new Set(out)];
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
    // 1. Auth — SendGrid Inbound Parse doesn't sign, so guard with a URL token.
    const reqUrl = new URL(req.url);
    const token = reqUrl.searchParams.get('token') ?? req.headers.get('x-webhook-token') ?? '';
    if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) return ok({ error: 'unauthorized' }, 401);

    // 2. SendGrid posts multipart/form-data with parsed fields.
    const form = await req.formData();
    const from = String(form.get('from') ?? '');
    const to = String(form.get('to') ?? '');
    const subject = String(form.get('subject') ?? '');
    const text = String(form.get('text') || form.get('html') || '');
    if (!to || !text) return ok({ message: 'nothing to process' });

    // 3. Match user by the forwarding alias (any recipient address). Take the
    //    first matching connection — don't fail if the mail lists 2+ aliases.
    const candidates = emailsFrom(to, form.get('envelope'));
    if (!candidates.length) return ok({ message: 'no recipient' });
    const { data: conns } = await supabase
      .from('email_sms_connections')
      .select('user_id')
      .eq('connection_type', 'email').eq('is_active', true)
      .in('forwarding_alias', candidates)
      .limit(1);
    if (!conns?.length) return ok({ message: 'no matching connection' });
    const userId = conns[0].user_id as string;

    // 4. Financial filter — drop non-financial mail before it touches the LLM.
    if (!looksFinancial(from, subject, text)) return ok({ message: 'not financial' });

    // 5. Scrub PII + dedup key. Hash the FULL body (not a 400-char prefix) so two
    //    different transactions sharing templated boilerplate don't collide.
    const clean = scrubSensitive(`${subject}\n${text}`).slice(0, 4000);
    const sourceHash = await sha256(`${userId}|${from}|${subject}|${text}`);

    // 6. Extract + categorize (grounded).
    const { data: profile } = await supabase.from('profiles').select('currency').eq('id', userId).maybeSingle();
    const currency = profile?.currency ?? 'BDT';
    const { data: categories } = await supabase.from('categories').select('id, name').eq('user_id', userId);
    const ex = await extract(clean, categories ?? [], currency);
    if (!ex || !ex.is_transaction || !ex.amount || ex.amount <= 0) return ok({ message: 'no transaction found' });

    // Grounding guard: the amount must appear in the email as a standalone number.
    if (!amountIsGrounded(ex.amount, text)) return ok({ message: 'amount not grounded', amount: ex.amount });

    const matched = (categories ?? []).find((c) => c.name.toLowerCase() === (ex.category ?? '').toLowerCase());

    // 7. Stage (idempotent via unique (user_id, source_hash)).
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
    if (error) { console.error('stage error:', error.message); return ok({ error: 'stage_failed' }, 500); }

    return ok({ success: true, staged: true });
  } catch (e) {
    console.error('process-forwarded-email:', (e as Error).message);
    return ok({ error: 'processing_failed' }, 500);
  }
});
