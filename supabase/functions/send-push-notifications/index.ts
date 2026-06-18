// Supabase Edge Function — send-push-notifications
// Triggered by pg_cron daily at 09:00 UTC.
// Sends targeted push notifications via the Expo Push API (no API key needed).
//
// Auto-available in Edge Functions:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL        = 'https://exp.host/--/api/v2/push/send';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

async function sendPushBatch(messages: PushMessage[]): Promise<void> {
  if (!messages.length) return;
  // Expo Push API accepts up to 100 messages per batch
  const chunks: PushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }
  for (const chunk of chunks) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(chunk),
    });
  }
}

function isMonday(): boolean {
  return new Date().getDay() === 1;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function monthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token !== SUPABASE_SERVICE_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const monday = isMonday();
  const messages: PushMessage[] = [];

  // Fetch all users with a push token and push enabled
  const { data: users } = await supabase
    .from('profiles')
    .select('id, name, currency, push_token, push_enabled, last_active_at')
    .eq('push_enabled', true)
    .not('push_token', 'is', null);

  if (!users?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  for (const user of users) {
    const token    = user.push_token as string;
    const name     = (user.name as string | null)?.split(' ')[0] ?? 'there';
    const lastActive = user.last_active_at ? new Date(user.last_active_at) : null;
    const daysSinceActive = lastActive
      ? Math.floor((Date.now() - lastActive.getTime()) / 86_400_000)
      : 99;

    // 1. Weekly summary (Monday only)
    if (monday) {
      messages.push({
        to: token,
        title: 'Your weekly summary is ready 📊',
        body: `Hey ${name}! Check your Finni weekly breakdown — see how you spent last week.`,
        sound: 'default',
      });
      continue; // only one notification per user per day
    }

    // 2. Reactivation nudge (inactive 2–4 days)
    if (daysSinceActive >= 2 && daysSinceActive < 5) {
      messages.push({
        to: token,
        title: `Hey ${name}! 👋`,
        body: "You haven't logged any expenses recently. Tap to catch up — it only takes a second!",
        sound: 'default',
      });
      continue;
    }

    // 3. Win-back nudge (inactive 5+ days)
    if (daysSinceActive >= 5) {
      messages.push({
        to: token,
        title: 'Your money misses you 💰',
        body: 'Log your first expense this week and stay on top of your budget with Finni.',
        sound: 'default',
      });
      continue;
    }

    // 4. Budget alert (active users — any category ≥ 80% spent this month).
    // NOTE: categories.spent is not maintained app-side, so compute month-to-date
    // spend from transactions directly (mirrors the email function).
    const { data: cats } = await supabase
      .from('categories')
      .select('id, name, budget')
      .eq('user_id', user.id)
      .gt('budget', 0);

    if (cats?.length) {
      const { data: txns } = await supabase
        .from('transactions')
        .select('category_id, withdrawal')
        .eq('user_id', user.id)
        .eq('type', 'expense')
        .gte('date', monthStart());

      const spentByCat = new Map<string, number>();
      for (const t of txns ?? []) {
        const k = t.category_id as string | null;
        if (k) spentByCat.set(k, (spentByCat.get(k) ?? 0) + (Number(t.withdrawal) || 0));
      }

      // Surface the single most over-threshold category.
      let alert: { name: string; pct: number } | null = null;
      for (const c of cats) {
        const spent = spentByCat.get(c.id as string) ?? 0;
        const pct = Number(c.budget) > 0 ? (spent / Number(c.budget)) * 100 : 0;
        if (pct >= 80 && (!alert || pct > alert.pct)) alert = { name: c.name as string, pct: Math.round(pct) };
      }
      if (alert) {
        messages.push({
          to: token,
          title: `⚠️ ${alert.name} budget at ${alert.pct}%`,
          body: `You've used ${alert.pct}% of your ${alert.name} budget this month. Tap to review.`,
          sound: 'default',
        });
      }
    }
  }

  await sendPushBatch(messages);

  return new Response(JSON.stringify({ sent: messages.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
