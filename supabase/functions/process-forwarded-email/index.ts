// Supabase Edge Function — process-forwarded-email (v3, Resend inbound)
// Inbound webhook for a user's forwarded bank/MFS email, via Resend Receiving.
//
// Resend's webhook is metadata-only: it sends an `email.received` event with an
// `email_id`; we then fetch the body from the Received Emails API. Pipeline:
// Svix-verify webhook → fetch email → match user by alias → financial filter →
// OTP scrub → grounded Gemini extraction + categorization → dedup → stage to
// extracted_transactions (status='pending'). The app's Review tab confirms.
//
// Secrets: GEMINI_API_KEY, RESEND_API_KEY, RESEND_INBOUND_SIGNING_SECRET
// (Svix signing secret, whsec_…) (+ auto SUPABASE_URL / SERVICE_ROLE_KEY).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Webhook } from 'https://esm.sh/svix@1.24.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, svix-id, svix-timestamp, svix-signature',
};

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY  = Deno.env.get('GEMINI_API_KEY')!;
const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!;
const SIGNING_SECRET  = Deno.env.get('RESEND_INBOUND_SIGNING_SECRET') ?? '';
const GEMINI_MODEL    = 'gemini-2.5-flash';

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

function emailsFrom(...vals: unknown[]): string[] {
  const out: string[] = [];
  for (const v of vals) {
    const arr = Array.isArray(v) ? v : [v];
    for (const item of arr) {
      const m = String(item ?? '').toLowerCase().match(/[^\s<>,;]+@[^\s<>,;]+/g);
      if (m) out.push(...m);
    }
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

// Fetch the full received email body from Resend (the webhook is metadata-only).
async function fetchReceivedEmail(emailId: string): Promise<{ from: string; to: unknown; received_for: unknown; subject: string; text: string; html: string } | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (!res.ok) return null;
    const d = await res.json();
    return {
      from: String(d?.from ?? ''),
      to: d?.to ?? [],
      received_for: d?.received_for ?? [],
      subject: String(d?.subject ?? ''),
      text: String(d?.text ?? ''),
      html: String(d?.html ?? ''),
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    // 1. Verify the Svix-signed webhook (rejects spoofed/forged inbound events).
    if (!SIGNING_SECRET) return ok({ error: 'signing secret not configured' }, 500);
    const raw = await req.text();
    let event: any;
    try {
      const wh = new Webhook(SIGNING_SECRET);
      event = wh.verify(raw, {
        'svix-id': req.headers.get('svix-id') ?? '',
        'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
        'svix-signature': req.headers.get('svix-signature') ?? '',
      });
    } catch {
      return ok({ error: 'invalid signature' }, 401);
    }

    if (event?.type !== 'email.received' || !event?.data?.email_id) {
      return ok({ message: 'ignored event' });
    }

    // 2. Fetch the body (webhook carries only metadata + email_id).
    const emailId = String(event.data.email_id);
    const mail = await fetchReceivedEmail(emailId);
    if (!mail) return ok({ message: 'could not fetch email' });
    const from = mail.from || String(event.data.from ?? '');
    const subject = mail.subject || String(event.data.subject ?? '');
    const text = mail.text || mail.html || '';
    if (!text) return ok({ message: 'empty body' });

    // 3. Match user by the forwarding alias (any recipient address). FIX for the
    //    old bug that used the first active connection.
    const candidates = emailsFrom(mail.to, mail.received_for, event.data.to);
    if (!candidates.length) return ok({ message: 'no recipient' });
    const { data: conn } = await supabase
      .from('email_sms_connections')
      .select('user_id, forwarding_alias')
      .eq('connection_type', 'email').eq('is_active', true)
      .in('forwarding_alias', candidates)
      .maybeSingle();
    if (!conn) return ok({ message: 'no matching connection' });
    const userId = conn.user_id as string;

    // 4. Financial filter — drop non-financial mail before it touches the LLM.
    if (!looksFinancial(from, subject, text)) return ok({ message: 'not financial' });

    // 5. OTP scrub.
    const clean = scrubOtp(`${subject}\n${text}`).slice(0, 4000);

    // 6. Extract + categorize (grounded).
    const { data: profile } = await supabase.from('profiles').select('currency').eq('id', userId).maybeSingle();
    const currency = profile?.currency ?? 'BDT';
    const { data: categories } = await supabase.from('categories').select('id, name').eq('user_id', userId);
    const ex = await extract(clean, categories ?? [], currency);
    if (!ex || !ex.is_transaction || !ex.amount || ex.amount <= 0) return ok({ message: 'no transaction found' });

    // Grounding guard: the amount must actually appear in the email text.
    const amountStr = String(Math.round(ex.amount));
    if (!text.replace(/,/g, '').includes(amountStr)) return ok({ message: 'amount not grounded', amount: ex.amount });

    const matched = (categories ?? []).find((c) => c.name.toLowerCase() === (ex.category ?? '').toLowerCase());

    // 7. Stage (idempotent via unique (user_id, source_hash); Resend's email_id
    //    is unique per received message → perfect dedup key).
    const { error } = await supabase.from('extracted_transactions').upsert({
      user_id: userId,
      source: 'email',
      source_hash: emailId,
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
