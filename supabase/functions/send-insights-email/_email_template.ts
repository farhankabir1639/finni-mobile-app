// Pure email analytics + renderer — no Deno/Node globals, shared by the edge
// function (index.ts) and the preview generator (eval/email_preview.ts).
// All numbers are computed here deterministically; the LLM only writes the
// coach prose (passed in as `ai`), never a figure.
//
// Templates are the user's email-client-safe (table-based, MSO-conditional)
// designs, parameterized with {{...}} placeholders.

export type Freq = 'daily' | 'weekly';

export interface Txn {
  description: string | null;
  withdrawal: number; deposit: number;
  type: string; date: string; category_id?: string | null;
}
export interface Cat { id: string; name: string; emoji?: string; budget?: number }
export interface Todo { name: string; emoji: string; status: 'ok' | 'tight' | 'over'; line: string }
export interface TopCat { name: string; emoji: string; amount: number; pct: number }
export interface EmailAnalytics {
  totalSpent: number; totalIncome: number;
  topCategories: TopCat[]; todos: Todo[];
  monthUsedPct: number; monthElapsedPct: number; onTrack: boolean;
}
// AI coach fields (grounded; generated in index.ts).
export interface AiFields { greeting: string; insight: string; focus?: string }

const SYMBOLS: Record<string, string> = {
  USD: '$', BDT: '৳', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', INR: '₹',
};
export function symbolOf(code: string): string { return SYMBOLS[code] ?? code; }
export function formatAmount(n: number): string { return Math.round(n).toLocaleString('en-US'); }
export function formatCurrency(code: string, amount: number): string { return `${symbolOf(code)}${formatAmount(amount)}`; }

function daysInMonth(y: number, m: number): number { return new Date(y, m, 0).getDate(); }
const num = (v: unknown) => Number(v) || 0;

export function computeAnalytics(
  periodTxns: Txn[], monthTxns: Txn[], categories: Cat[], _currency: string, today: Date,
): EmailAnalytics {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const emojiOf = (id?: string | null) => (id && catById.get(id)?.emoji) || '📦';
  const nameOf = (id?: string | null) => (id && catById.get(id)?.name) || 'Other';

  const totalSpent = periodTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + num(t.withdrawal), 0);
  const totalIncome = periodTxns.filter((t) => t.type === 'income').reduce((s, t) => s + num(t.deposit), 0);

  const periodByCat = new Map<string, number>();
  for (const t of periodTxns) {
    if (t.type !== 'expense') continue;
    const k = t.category_id ?? 'other';
    periodByCat.set(k, (periodByCat.get(k) ?? 0) + num(t.withdrawal));
  }
  const topCategories: TopCat[] = [...periodByCat.entries()]
    .map(([id, amount]) => ({ name: nameOf(id), emoji: emojiOf(id), amount, pct: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount).slice(0, 5);

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

  const todos: Todo[] = categories
    .filter((c) => num(c.budget) > 0)
    .map((c) => {
      const spent = monthByCat.get(c.id) ?? 0;
      const budget = num(c.budget);
      const remaining = budget - spent;
      const emoji = c.emoji ?? '📦';
      if (remaining <= 0) return { name: c.name, emoji, status: 'over' as const, line: `${formatCurrency(_currency, -remaining)} over budget — pause if you can` };
      const perDay = remaining / daysLeft;
      const usedPct = budget > 0 ? (spent / budget) * 100 : 0;
      const status: 'ok' | 'tight' = usedPct > monthElapsedPct + 10 ? 'tight' : 'ok';
      return { name: c.name, emoji, status, line: `${formatCurrency(_currency, remaining)} left — keep today under ${formatCurrency(_currency, perDay)}` };
    })
    .sort((a, b) => (a.status === 'over' ? -1 : b.status === 'over' ? 1 : a.status === 'tight' ? -1 : 1))
    .slice(0, 5);

  const totalBudget = categories.reduce((s, c) => s + num(c.budget), 0);
  const monthUsedPct = totalBudget > 0 ? Math.round((monthSpent / totalBudget) * 100) : 0;
  const onTrack = monthUsedPct <= monthElapsedPct;
  return { totalSpent, totalIncome, topCategories, todos, monthUsedPct, monthElapsedPct, onTrack };
}

// ── Row + section builders ───────────────────────────────────────────────────
function categoryRows(cats: TopCat[], sym: string): string {
  if (!cats.length) return `<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#6b7288;padding:8px 0;">No spending logged.</td></tr>`;
  return cats.map((c, i) => {
    const bt = i === 0 ? '' : 'border-top:1px solid #161a28;';
    return `<tr>
      <td align="left" style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#e6e8f0;padding:8px 0;${bt}">${c.emoji}&nbsp;&nbsp;${c.name}</td>
      <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#ffffff;font-weight:600;padding:8px 0;${bt}">${sym}${formatAmount(c.amount)} <span style="color:#6b7288;font-weight:400;">&middot; ${c.pct}%</span></td>
    </tr>`;
  }).join('');
}

function gamePlanSection(todos: Todo[]): string {
  if (!todos.length) return '';
  const rows = todos.map((td, i) => {
    const dot = td.status === 'over' ? '#ff5e7e' : td.status === 'tight' ? '#fbbf24' : '#34d399';
    const bt = i === 0 ? '' : 'border-top:1px solid #161a28;';
    return `<tr><td style="padding:11px 0;${bt}font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#9aa1b4;">
      <span style="color:${dot};font-size:15px;">&#9679;</span>&nbsp;&nbsp;${td.emoji}&nbsp;<strong style="color:#ffffff;font-weight:700;">${td.name}</strong> &mdash; ${td.line}</td></tr>`;
  }).join('');
  return `
        <tr><td class="px" style="padding:30px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #1b2030;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
        <tr><td class="px" style="padding:30px 40px 6px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#6b7288;">Today's game plan</p></td></tr>
        <tr><td class="px" style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
}

// ── Templates (user's designs, parameterized) ────────────────────────────────
const HEAD = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark light">
  <title>Finni</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
    body{margin:0;padding:0;width:100%!important;background-color:#0b0e17;}
    a{color:#9d8cff;}
    @media only screen and (max-width:600px){.container{width:100%!important;}.px{padding-left:24px!important;padding-right:24px!important;}.bignum{font-size:40px!important;}}
  </style>
</head>`;

function shell(periodLabel: string, heroLabel: string, spentVar: string, greetingVar: string, body: string): string {
  return `${HEAD}
<body style="margin:0;padding:0;background-color:#0b0e17;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0b0e17;">${greetingVar}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0b0e17;"><tr><td align="center" style="padding:40px 12px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
      <tr><td class="px" style="padding:0 40px 36px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="left" style="font-family:Helvetica,Arial,sans-serif;font-size:21px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">finni</td>
        <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6b7288;">${periodLabel}</td>
      </tr></table></td></tr>
      <tr><td class="px" style="padding:0 40px 4px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;color:#ffffff;">Hey {{firstName}} <span style="font-weight:400;">&#128075;</span></p></td></tr>
      <tr><td class="px" style="padding:0 40px 34px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#9aa1b4;">${greetingVar}</p></td></tr>
      <tr><td class="px" style="padding:0 40px 0 40px;">
        <p style="margin:0 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#6b7288;">${heroLabel}</p>
        <p class="bignum" style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:46px;font-weight:800;letter-spacing:-1px;color:#ffffff;">{{currency}}${spentVar}</p>
      </td></tr>
      <tr><td class="px" style="padding:14px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1b2030;border-radius:99px;"><tr><td style="font-size:0;line-height:0;border-radius:99px;">
        <table role="presentation" width="{{budgetBarWidth}}%" cellpadding="0" cellspacing="0" border="0" style="background-color:{{paceColor}};border-radius:99px;"><tr><td style="height:4px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
      </td></tr></table></td></tr>
      <tr><td class="px" style="padding:10px 40px 36px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6b7288;">{{budgetUsedPct}}% of monthly budget &middot; <span style="color:{{paceColor}};font-weight:600;">{{paceLabel}}</span></p></td></tr>
      <tr><td class="px" style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #1b2030;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr><td class="px" style="padding:30px 40px 16px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#6b7288;">Where it went</p></td></tr>
      <tr><td class="px" style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{{categoryRows}}</table></td></tr>
      {{gamePlan}}
      <tr><td class="px" style="padding:30px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #1b2030;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr><td class="px" style="padding:30px 40px 6px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#9d8cff;">&#10024;&nbsp; Finni coach</p></td></tr>
      ${body}
      <tr><td align="center" style="padding:0 40px 40px 40px;">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{appUrl}}" style="height:50px;v-text-anchor:middle;width:200px;" arcsize="50%" fillcolor="#7c6cf5" strokecolor="#7c6cf5"><w:anchorlock/><center style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;">Open Finni</center></v:roundrect><![endif]-->
        <!--[if !mso]><!-- --><a href="{{appUrl}}" style="display:inline-block;background-color:#7c6cf5;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:15px 46px;border-radius:99px;">Open Finni</a><!--<![endif]-->
      </td></tr>
      <tr><td class="px" style="padding:0 40px;" align="center"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#4f566a;">{{periodWord}} insights from Finni &middot; <a href="{{appUrl}}/settings" style="color:#6b7288;text-decoration:underline;">manage notifications</a></p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const DAILY_BODY = `<tr><td class="px" style="padding:0 40px 38px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#e6e8f0;">{{aiInsight}}</p></td></tr>`;
const WEEKLY_BODY = `<tr><td class="px" style="padding:0 40px 16px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#e6e8f0;">{{aiInsight}}</p></td></tr>
      <tr><td class="px" style="padding:0 40px 38px 40px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#9aa1b4;"><span style="color:#9d8cff;font-weight:600;">Next week &mdash;</span> {{aiFocus}}</p></td></tr>`;

export function renderEmail(
  freq: Freq, name: string, code: string, a: EmailAnalytics, ai: AiFields, appUrl: string,
): string {
  const sym = symbolOf(code);
  const paceColor = a.onTrack ? '#34d399' : '#ff5e7e';
  const paceLabel = a.onTrack ? 'On track' : 'Over pace';
  const barWidth = Math.min(100, Math.max(3, a.monthUsedPct));

  const tpl = freq === 'daily'
    ? shell('Today', 'Spent today', '{{spent}}', '{{aiGreeting}}', DAILY_BODY)
    : shell('This week', 'Spent this week', '{{spent}}', '{{aiGreeting}}', WEEKLY_BODY);

  const vars: Record<string, string> = {
    firstName: name,
    currency: sym,
    spent: formatAmount(a.totalSpent),
    budgetBarWidth: String(barWidth),
    paceColor,
    budgetUsedPct: String(a.monthUsedPct),
    paceLabel,
    categoryRows: categoryRows(a.topCategories, sym),
    gamePlan: freq === 'daily' ? gamePlanSection(a.todos) : '',
    aiGreeting: ai.greeting,
    aiInsight: ai.insight,
    aiFocus: ai.focus ?? '',
    appUrl,
    periodWord: freq === 'daily' ? 'Daily' : 'Weekly',
  };
  let html = tpl;
  for (const [k, v] of Object.entries(vars)) html = html.split(`{{${k}}}`).join(v);
  return html;
}
