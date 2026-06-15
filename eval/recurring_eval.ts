/**
 * Recurring schedule eval — pure, deterministic, no network.
 *   npx tsx eval/recurring_eval.ts
 *
 * Date math is where recurring features rot, so this must be green before the
 * engine ships. Covers clamping, leap years, catch-up, cap, idempotency, and
 * next-future-occurrence semantics. See docs/recurring-transactions-spec.md §14.
 */

import {
  advance, daysInMonth, nextFutureOccurrence, planOccurrences, weekdayOf, addDays,
} from '../src/lib/recurring_schedule';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } }

console.log('\n[1] monthly anchor 15 across months');
eq('Jun15→Jul15', advance('2025-06-15', 'monthly', 15), '2025-07-15');
eq('Dec15→Jan15 (year roll)', advance('2025-12-15', 'monthly', 15), '2026-01-15');

console.log('\n[2] monthly anchor 31 clamping');
eq('Jan31→Feb28 (2025)', advance('2025-01-31', 'monthly', 31), '2025-02-28');
eq('Feb28→Mar31', advance('2025-02-28', 'monthly', 31), '2025-03-31');
eq('Mar31→Apr30', advance('2025-03-31', 'monthly', 31), '2025-04-30');

console.log('\n[3] leap-year February');
eq('daysInMonth Feb 2024 = 29', daysInMonth(2024, 2), 29);
eq('daysInMonth Feb 2025 = 28', daysInMonth(2025, 2), 28);
eq('Jan29→Feb29 (leap)', advance('2024-01-29', 'monthly', 29), '2024-02-29');
eq('Jan29→Feb28 (non-leap)', advance('2025-01-29', 'monthly', 29), '2025-02-28');

console.log('\n[4] weekly across month boundary');
eq('Jan29→Feb05', advance('2025-01-29', 'weekly'), '2025-02-05');

console.log('\n[5] biweekly across year boundary');
eq('Dec25→Jan08', advance('2025-12-25', 'biweekly'), '2026-01-08');

console.log('\n[6] daily catch-up of 10 days');
{
  const p = planOccurrences('2025-06-01', '2025-06-10', 'daily', undefined, 90);
  eq('10 occurrences', p.occurrences.length, 10);
  eq('first/last', [p.occurrences[0], p.occurrences[9]], ['2025-06-01', '2025-06-10']);
  eq('newNextRun = Jun11', p.newNextRun, '2025-06-11');
  eq('skipped = 0', p.skipped, 0);
}

console.log('\n[7] cap: 365 due daily, cap 90');
{
  const p = planOccurrences('2025-01-01', '2025-12-31', 'daily', undefined, 90);
  eq('capped at 90', p.occurrences.length, 90);
  eq('skipped = 275', p.skipped, 275);
  eq('fast-forwarded past today', p.newNextRun, '2026-01-01');
}

console.log('\n[8] idempotency: same plan twice');
{
  const a = planOccurrences('2025-06-01', '2025-06-10', 'daily', undefined, 90);
  const b = planOccurrences('2025-06-01', '2025-06-10', 'daily', undefined, 90);
  eq('deterministic occurrences', a.occurrences, b.occurrences);
}

console.log('\n[9] nextFutureOccurrence is strictly after today');
eq('monthly anchor15, today Jun10 → Jun15', nextFutureOccurrence('2025-06-10', 'monthly', { anchorDay: 15 }), '2025-06-15');
eq('monthly anchor15, today Jun20 → Jul15', nextFutureOccurrence('2025-06-20', 'monthly', { anchorDay: 15 }), '2025-07-15');
eq('monthly anchor15, today IS the 15th → next month', nextFutureOccurrence('2025-06-15', 'monthly', { anchorDay: 15 }), '2025-07-15');

console.log('\n[10] weekly nextFutureOccurrence semantics');
{
  const today = '2025-06-10';
  const r = nextFutureOccurrence(today, 'weekly', { anchorWeekday: weekdayOf(today) });
  ok('strictly after today', r > today);
  ok('within 7 days', r <= addDays(today, 7));
  ok('lands on the anchor weekday', weekdayOf(r) === weekdayOf(today));
}

console.log(`\n── ${pass} passed, ${fail} failed ──`);
process.exit(fail ? 1 : 0);
