// ── Recurring schedule math (pure, transport-free) ──────────────────────────
//
// All date logic lives here as pure functions over `YYYY-MM-DD` local-date
// strings, so it's deterministic and unit-testable without React Native or the
// network. See docs/recurring-transactions-spec.md §3–§5.

export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

const pad = (n: number) => String(n).padStart(2, '0');

export function fmt(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseLocal(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

// Days in month, m is 1-12. Handles leap years via the Date(0-day) trick.
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function weekdayOf(dateStr: string): number {
  const { y, m, d } = parseLocal(dateStr);
  return new Date(y, m - 1, d).getDay(); // 0=Sun
}

export function addDays(dateStr: string, n: number): string {
  const { y, m, d } = parseLocal(dateStr);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// Add one month preserving the anchor day, CLAMPED to the target month length
// (anchorDay 31 -> Feb 28/29, Apr 30, …).
function addMonthClamped(dateStr: string, anchorDay: number): string {
  const { y, m } = parseLocal(dateStr);
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  const day = Math.min(anchorDay, daysInMonth(ny, nm));
  return fmt(ny, nm, day);
}

// Next occurrence after `dateStr` for the given frequency.
export function advance(dateStr: string, frequency: Frequency, anchorDay?: number): string {
  switch (frequency) {
    case 'daily': return addDays(dateStr, 1);
    case 'weekly': return addDays(dateStr, 7);
    case 'biweekly': return addDays(dateStr, 14);
    case 'monthly': return addMonthClamped(dateStr, anchorDay ?? parseLocal(dateStr).d);
  }
}

// The first occurrence strictly AFTER `today`. Used at template creation so the
// just-logged transaction stays as the current period's instance and the first
// AUTO occurrence is the next period (no back-dating, no double-count).
export function nextFutureOccurrence(
  today: string,
  frequency: Frequency,
  opts?: { anchorDay?: number; anchorWeekday?: number }
): string {
  if (frequency === 'monthly') {
    const anchorDay = opts?.anchorDay ?? parseLocal(today).d;
    const { y, m } = parseLocal(today);
    let cand = fmt(y, m, Math.min(anchorDay, daysInMonth(y, m)));
    while (cand <= today) cand = addMonthClamped(cand, anchorDay);
    return cand;
  }
  if (frequency === 'weekly' || frequency === 'biweekly') {
    const step = frequency === 'weekly' ? 7 : 14;
    const target = opts?.anchorWeekday ?? weekdayOf(today);
    let cand = today;
    // walk forward to the next matching weekday strictly after today
    do { cand = addDays(cand, 1); } while (weekdayOf(cand) !== target);
    // for biweekly, the above lands on the next matching weekday (a week out);
    // that's an acceptable v1 anchor — subsequent steps are +14.
    if (frequency === 'biweekly') { /* keep first hit; step applies after */ void step; }
    return cand;
  }
  // daily
  return addDays(today, 1);
}

export interface OccurrencePlan {
  occurrences: string[]; // dates to materialize (<= today)
  newNextRun: string;    // next scheduled date after planning
  skipped: number;       // occurrences dropped due to the cap
}

// Plan all due occurrences from `nextRun` up to and including `today`, capped.
// Pure: callers pass `today` so this is fully testable.
export function planOccurrences(
  nextRun: string,
  today: string,
  frequency: Frequency,
  anchorDay: number | undefined,
  cap: number
): OccurrencePlan {
  const occurrences: string[] = [];
  let cursor = nextRun;
  while (cursor <= today && occurrences.length < cap) {
    occurrences.push(cursor);
    cursor = advance(cursor, frequency, anchorDay);
  }
  // Cap hit but more are still due → fast-forward past the gap, count skipped.
  let skipped = 0;
  while (cursor <= today) {
    cursor = advance(cursor, frequency, anchorDay);
    skipped++;
  }
  return { occurrences, newNextRun: cursor, skipped };
}
