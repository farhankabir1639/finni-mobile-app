// Supabase Edge Function — send-insights-email
// Triggered by pg_cron daily at 08:00 UTC.
// Sends daily or weekly financial insight emails via Resend.
//
// Required secrets (set via: supabase secrets set KEY=value):
//   RESEND_API_KEY        — from resend.com (verify heyfinni.com domain first)
//   GEMINI_API_KEY        — same key used by gemini-proxy
//
// Auto-available in Edge Functions:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY')!;
const GEMINI_API_KEY        = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_MODEL          = 'gemini-2.5-flash';
const FROM_EMAIL            = 'Finni <insights@updates.heyfinni.com>';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function isMonday(): boolean {
  return new Date().getDay() === 1;
}

function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

function formatCurrency(code: string, amount: number): string {
  const symbols: Record<string, string> = {
    USD: '$', BDT: '৳', EUR: '€', GBP: '£',
    AUD: 'A$', CAD: 'C$', SGD: 'S$', INR: '₹',
  };
  return `${symbols[code] ?? code}${amount.toFixed(2)}`;
}

async function generateInsights(
  name: string,
  currency: string,
  transactions: { description: string | null; withdrawal: number; deposit: number; type: string; date: string }[],
  frequency: 'daily' | 'weekly',
): Promise<{ title: string; description: string }[]> {
  const period = frequency === 'daily' ? 'today' : 'this week';
  const totalSpent = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.withdrawal), 0);
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.deposit), 0);

  const prompt = `You are Finni, a personal finance AI. Generate 2-3 brief, warm financial insights for ${name}'s ${frequency} email summary.

SPENDING ${period.toUpperCase()}:
- Total spent: ${formatCurrency(currency, totalSpent)}
- Total income: ${formatCurrency(currency, totalIncome)}
- Transactions: ${JSON.stringify(transactions.slice(0, 20))}

Return ONLY a valid JSON array (no markdown):
[{ "title": "short title", "description": "1-2 sentence insight" }]
Use ${currency} for amounts. Be warm and specific.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        }),
      },
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
    const cleaned = text.replace(/```json?|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [{ title: 'Keep tracking!', description: 'Log your expenses regularly to get personalized insights.' }];
  }
}

function buildEmailHtml(
  name: string,
  currency: string,
  totalSpent: number,
  totalIncome: number,
  insights: { title: string; description: string }[],
  frequency: 'daily' | 'weekly',
): string {
  const period = frequency === 'daily' ? "Today's" : "This Week's";
  const insightsHtml = insights.map(i => `
    <div style="background:#1a1f35;border-radius:12px;padding:16px 20px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.1);">
      <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#5EEAD4;">${i.title}</p>
      <p style="margin:0;font-size:14px;color:#97A3BD;line-height:1.6;">${i.description}</p>
    </div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07070E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:28px;">
      <span style="font-size:32px;">💰</span>
      <h1 style="margin:8px 0 4px;font-size:26px;font-weight:800;color:#F4F6FC;letter-spacing:-0.5px;">Finni</h1>
      <p style="margin:0;font-size:14px;color:#57647F;">${period} Financial Summary</p>
    </div>

    <p style="font-size:16px;color:#97A3BD;margin-bottom:20px;">Hey ${name}! Here's your ${frequency} snapshot 👋</p>

    <div style="background:#0D1322;border-radius:16px;padding:20px 24px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.07);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div>
          <p style="margin:0 0 3px;font-size:11px;color:#57647F;text-transform:uppercase;letter-spacing:1px;">Total Spent</p>
          <p style="margin:0;font-size:24px;font-weight:800;color:#FB7185;">${formatCurrency(currency, totalSpent)}</p>
        </div>
        <div style="text-align:right;">
          <p style="margin:0 0 3px;font-size:11px;color:#57647F;text-transform:uppercase;letter-spacing:1px;">Income</p>
          <p style="margin:0;font-size:24px;font-weight:800;color:#34D399;">${formatCurrency(currency, totalIncome)}</p>
        </div>
      </div>
    </div>

    <h2 style="font-size:14px;color:#57647F;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">AI Insights</h2>
    ${insightsHtml}

    <div style="text-align:center;margin-top:28px;">
      <a href="finni-app://home" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:700;">Open Finni</a>
    </div>

    <p style="text-align:center;font-size:12px;color:#3A4660;margin-top:28px;line-height:1.8;">
      You're receiving this because you enabled ${frequency} email insights in Finni.<br>
      To change this, go to Settings → Notifications in the app.
    </p>
  </div>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Only allow internal invocations (cron) or service role calls
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token !== SUPABASE_SERVICE_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const today = new Date();
  const isWeekly = isMonday();
  const since = sevenDaysAgo();

  const { data: users, error: usersError } = await supabase
    .from('profiles')
    .select('id, name, currency, email_insights')
    .neq('email_insights', 'off')
    .not('email_insights', 'is', null);

  if (usersError || !users?.length) {
    return new Response(JSON.stringify({ sent: 0, error: usersError?.message }), { status: 200 });
  }

  let sent = 0;
  const errors: string[] = [];

  for (const profile of users) {
    const freq = profile.email_insights as 'daily' | 'weekly';
    if (freq === 'weekly' && !isWeekly) continue;

    try {
      // Get user email from auth
      const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
      const email = authUser?.user?.email;
      if (!email) continue;

      // Fetch recent transactions
      const { data: txs } = await supabase
        .from('transactions')
        .select('description, withdrawal, deposit, type, date')
        .eq('user_id', profile.id)
        .gte('date', freq === 'daily' ? today.toISOString().split('T')[0] : since)
        .order('date', { ascending: false })
        .limit(50);

      const transactions = txs ?? [];
      const totalSpent  = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.withdrawal), 0);
      const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t)  => s + Number(t.deposit), 0);

      const insights  = await generateInsights(profile.name ?? 'there', profile.currency ?? 'USD', transactions, freq);
      const subject   = freq === 'daily' ? `📊 Your Finni Daily Snapshot` : `📊 Your Finni Weekly Summary`;
      const html      = buildEmailHtml(profile.name ?? 'there', profile.currency ?? 'USD', totalSpent, totalIncome, insights, freq);

      await sendEmail(email, subject, html);
      sent++;
    } catch (e) {
      errors.push(`${profile.id}: ${(e as Error).message}`);
    }
  }

  return new Response(JSON.stringify({ sent, errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
