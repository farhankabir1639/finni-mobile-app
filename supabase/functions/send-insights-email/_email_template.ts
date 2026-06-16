// Pure email analytics + template — no Deno/Node globals, so it's shared by the
// edge function (index.ts) AND the preview generator (eval/email_preview.ts).
// All numbers are computed here deterministically; the LLM only phrases a warm
// line (passed in), never computes a figure.

export type Freq = 'daily' | 'weekly';

export interface Txn {
  description: string | null;
  withdrawal: number;
  deposit: number;
  type: string;
  date: string;
  category_id?: string | null;
}
export interface Cat { id: string; name: string; emoji?: string; budget?: number }

export interface Todo { name: string; emoji: string; status: 'ok' | 'tight' | 'over'; line: string }
export interface TopCat { name: string; emoji: string; amount: number; pct: number }

export interface EmailAnalytics {
  totalSpent: number;
  totalIncome: number;
  topCategories: TopCat[];
  todos: Todo[];
  monthUsedPct: number;
  monthElapsedPct: number;
  onTrack: boolean;
}

const SYMBOLS: Record<string, string> = {
  USD: '$', BDT: '৳', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', INR: '₹',
};
export function formatCurrency(code: string, amount: number): string {
  const n = Math.round(amount).toLocaleString('en-US');
  return `${SYMBOLS[code] ?? code}${n}`;
}

function daysInMonth(y: number, m: number): number { return new Date(y, m, 0).getDate(); }
const num = (v: unknown) => Number(v) || 0;

export function computeAnalytics(
  periodTxns: Txn[],
  monthTxns: Txn[],
  categories: Cat[],
  currency: string,
  today: Date,
): EmailAnalytics {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const emojiOf = (id?: string | null) => (id && catById.get(id)?.emoji) || '📦';
  const nameOf = (id?: string | null) => (id && catById.get(id)?.name) || 'Other';

  const totalSpent = periodTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + num(t.withdrawal), 0);
  const totalIncome = periodTxns.filter((t) => t.type === 'income').reduce((s, t) => s + num(t.deposit), 0);

  // Top categories for the period.
  const periodByCat = new Map<string, number>();
  for (const t of periodTxns) {
    if (t.type !== 'expense') continue;
    const k = t.category_id ?? 'other';
    periodByCat.set(k, (periodByCat.get(k) ?? 0) + num(t.withdrawal));
  }
  const topCategories: TopCat[] = [...periodByCat.entries()]
    .map(([id, amount]) => ({ name: nameOf(id), emoji: emojiOf(id), amount, pct: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);

  // Month-to-date per category, for budget pacing + daily allowances.
  const monthByCat = new Map<string, number>();
  let monthSpent = 0;
  for (const t of monthTxns) {
    if (t.type !== 'expense') continue;
    monthSpent += num(t.withdrawal);
    const k = t.category_id ?? 'other';
    monthByCat.set(k, (monthByCat.get(k) ?? 0) + num(t.withdrawal));
  }

  const y = today.getFullYear(), m = today.getMonth() + 1, d = today.getDate();
  const dim = daysInMonth(y, m);
  const daysLeft = Math.max(1, dim - d + 1);
  const monthElapsedPct = Math.round((d / dim) * 100);

  // Daily to-dos: only for categories with a budget set.
  const todos: Todo[] = categories
    .filter((c) => num(c.budget) > 0)
    .map((c) => {
      const spent = monthByCat.get(c.id) ?? 0;
      const budget = num(c.budget);
      const remaining = budget - spent;
      const emoji = c.emoji ?? '📦';
      if (remaining <= 0) {
        return { name: c.name, emoji, status: 'over' as const, line: `${formatCurrency(currency, -remaining)} over budget — pause if you can` };
      }
      const perDay = remaining / daysLeft;
      const usedPct = budget > 0 ? (spent / budget) * 100 : 0;
      const status: 'ok' | 'tight' = usedPct > monthElapsedPct + 10 ? 'tight' : 'ok';
      return { name: c.name, emoji, status, line: `${formatCurrency(currency, remaining)} left — keep today under ${formatCurrency(currency, perDay)}` };
    })
    .sort((a, b) => (a.status === 'over' ? -1 : b.status === 'over' ? 1 : a.status === 'tight' ? -1 : 1))
    .slice(0, 5);

  const totalBudget = categories.reduce((s, c) => s + num(c.budget), 0);
  const monthUsedPct = totalBudget > 0 ? Math.round((monthSpent / totalBudget) * 100) : 0;
  const onTrack = monthUsedPct <= monthElapsedPct;

  return { totalSpent, totalIncome, topCategories, todos, monthUsedPct, monthElapsedPct, onTrack };
}

// ── HTML ─────────────────────────────────────────────────────────────────────
const C = {
  bg: '#07070E', card: '#0D1322', card2: '#141A2E', line: 'rgba(255,255,255,0.07)',
  text: '#F4F6FC', text2: '#97A3BD', text3: '#57647F',
  aqua: '#5EEAD4', rose: '#FB7185', green: '#34D399', indigo: '#6366F1', amber: '#FBBF24',
};

function bar(pct: number, color: string): string {
  return `<div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
    <div style="height:6px;width:${Math.min(100, pct)}%;background:${color};border-radius:3px;"></div></div>`;
}

export function buildEmailHtml(
  name: string,
  currency: string,
  a: EmailAnalytics,
  warmLine: string,
  freq: Freq,
): string {
  const period = freq === 'daily' ? 'today' : 'this week';
  const Period = freq === 'daily' ? 'Today' : 'This week';

  const topHtml = a.topCategories.length
    ? a.topCategories.map((c) => `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:${C.text};margin-bottom:5px;">
          <span>${c.emoji} ${c.name}</span><span style="color:${C.text2};font-weight:600;">${formatCurrency(currency, c.amount)} · ${c.pct}%</span>
        </div>${bar(c.pct, C.indigo)}
      </div>`).join('')
    : `<p style="font-size:13px;color:${C.text3};margin:0;">No spending ${period} — nice. 🌱</p>`;

  // Daily-only "game plan" to-dos.
  const todoHtml = (freq === 'daily' && a.todos.length)
    ? `<h2 style="font-size:12px;color:${C.text3};text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 12px;">Today's game plan</h2>
       ${a.todos.map((td) => {
         const dot = td.status === 'over' ? C.rose : td.status === 'tight' ? C.amber : C.green;
         return `<div style="display:flex;align-items:flex-start;gap:10px;background:${C.card2};border:1px solid ${C.line};border-radius:10px;padding:11px 14px;margin-bottom:8px;">
           <span style="width:7px;height:7px;border-radius:4px;background:${dot};margin-top:6px;flex-shrink:0;"></span>
           <div><span style="font-size:13px;font-weight:700;color:${C.text};">${td.emoji} ${td.name}</span>
           <span style="font-size:13px;color:${C.text2};"> — ${td.line}</span></div>
         </div>`;
       }).join('')}`
    : '';

  const paceColor = a.onTrack ? C.green : C.rose;
  const paceText = a.onTrack ? 'On track' : 'Over pace';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:28px 18px;">

    <div style="margin-bottom:22px;">
      <span style="font-size:20px;font-weight:800;color:${C.text};letter-spacing:-0.4px;">finni</span>
      <span style="float:right;font-size:12px;color:${C.text3};padding-top:6px;">${Period}'s summary</span>
    </div>

    <p style="font-size:16px;color:${C.text};margin:0 0 4px;font-weight:600;">Hey ${name} 👋</p>
    <p style="font-size:14px;color:${C.text2};margin:0 0 22px;line-height:1.55;">${warmLine}</p>

    <!-- Hero: spent / income + pace -->
    <div style="background:${C.card};border-radius:16px;padding:20px;margin-bottom:18px;border:1px solid ${C.line};">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><p style="margin:0 0 3px;font-size:11px;color:${C.text3};text-transform:uppercase;letter-spacing:1px;">Spent ${period}</p>
          <p style="margin:0;font-size:23px;font-weight:800;color:${C.rose};">${formatCurrency(currency, a.totalSpent)}</p></td>
        <td style="text-align:right;"><p style="margin:0 0 3px;font-size:11px;color:${C.text3};text-transform:uppercase;letter-spacing:1px;">Income</p>
          <p style="margin:0;font-size:23px;font-weight:800;color:${C.green};">${formatCurrency(currency, a.totalIncome)}</p></td>
      </tr></table>
      <div style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
          <span style="color:${C.text2};">Monthly budget · ${a.monthUsedPct}% used</span>
          <span style="color:${paceColor};font-weight:700;">${paceText}</span>
        </div>${bar(a.monthUsedPct, paceColor)}
      </div>
    </div>

    <!-- Where it went -->
    <h2 style="font-size:12px;color:${C.text3};text-transform:uppercase;letter-spacing:1.5px;margin:0 0 12px;">Where it went</h2>
    <div style="background:${C.card};border-radius:16px;padding:18px 20px 8px;margin-bottom:6px;border:1px solid ${C.line};">${topHtml}</div>

    ${todoHtml}

    <div style="text-align:center;margin-top:26px;">
      <a href="finni-app://home" style="display:inline-block;background:${C.indigo};color:#fff;text-decoration:none;padding:13px 30px;border-radius:12px;font-size:15px;font-weight:700;">Open Finni</a>
    </div>

    <p style="text-align:center;font-size:11px;color:${C.text3};margin-top:24px;line-height:1.7;">
      ${freq === 'daily' ? 'Daily' : 'Weekly'} insights from Finni · change anytime in Settings → Notifications
    </p>
  </div>
</body></html>`;
}
