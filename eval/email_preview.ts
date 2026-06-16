/**
 * Email preview generator — renders the redesigned insight email with mock data
 * so you can open it in a browser before deploying the edge function.
 *   npx tsx eval/email_preview.ts
 * Writes .verify/email-preview-daily.html and -weekly.html (open in a browser).
 */
import { writeFileSync } from 'node:fs';
import { computeAnalytics, buildEmailHtml, type Txn, type Cat } from '../supabase/functions/send-insights-email/_email_template';

const today = new Date('2026-06-16T12:00:00');
const cats: Cat[] = [
  { id: 'f', name: 'Food', emoji: '🍔', budget: 8000 },
  { id: 't', name: 'Transport', emoji: '🚗', budget: 4000 },
  { id: 'b', name: 'Bills', emoji: '⚡', budget: 12000 },
  { id: 's', name: 'Shopping', emoji: '🛍️', budget: 5000 },
  { id: 'e', name: 'Entertainment', emoji: '🎬' },
];
const ex = (cid: string, amt: number, date: string): Txn => ({ description: '', withdrawal: amt, deposit: 0, type: 'expense', date, category_id: cid });
const inc = (amt: number, date: string): Txn => ({ description: 'salary', withdrawal: 0, deposit: amt, type: 'income', date, category_id: null });

// Month-to-date spread (some categories pacing hot).
const monthTxns: Txn[] = [
  inc(60000, '2026-06-01'),
  ex('b', 11500, '2026-06-02'), // Bills nearly maxed
  ex('f', 5200, '2026-06-05'), ex('f', 1800, '2026-06-16'),
  ex('t', 900, '2026-06-10'), ex('t', 600, '2026-06-16'),
  ex('s', 5600, '2026-06-12'), // Shopping over budget
  ex('e', 700, '2026-06-14'),
];
const dailyPeriod = monthTxns.filter((t) => t.date === '2026-06-16');
const weeklyPeriod = monthTxns.filter((t) => t.date >= '2026-06-09');

const daily = computeAnalytics(dailyPeriod, monthTxns, cats, 'BDT', today);
const weekly = computeAnalytics(weeklyPeriod, monthTxns, cats, 'BDT', today);

writeFileSync('.verify/email-preview-daily.html',
  buildEmailHtml('Farhan', 'BDT', daily, "You're pacing well — 41% of your monthly budget used. Nice and steady.", 'daily'));
writeFileSync('.verify/email-preview-weekly.html',
  buildEmailHtml('Farhan', 'BDT', weekly, "Solid week — spending stayed under control across most categories.", 'weekly'));

console.log('Wrote .verify/email-preview-daily.html and .verify/email-preview-weekly.html');
console.log('Daily todos:', daily.todos.map((t) => `${t.name}:${t.status}`).join(', '));
