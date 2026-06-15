# Recurring Transactions — Engineering Spec

Status: **proposal / not implemented**. Author: Claude (planning pass).
Scope: let a user mark a logged transaction as recurring from its chat card,
define a schedule, and have Finni create the transactions automatically.

---

## 1. Goals & non-goals

**Goals (v1)**
- From the transaction card in chat, mark it recurring with a frequency and a
  schedule anchor (day-of-month / weekday / start date).
- Auto-create the transactions on schedule, reliably and **idempotently** (never
  double-log, never silently drop).
- A management surface to view / pause / delete recurring templates.

**Non-goals (v1)**
- Server cron (see §4 — client catch-up first; pg_cron is the scale upgrade).
- AI auto-detection of "every month" (phase 2, §9).
- Variable amounts, end dates, or full RRULE/iCal custom rules (phase 2).

---

## 2. Data model

```sql
create table recurring_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      numeric not null check (amount > 0),
  description text,
  category_id uuid references categories(id) on delete set null,
  type        text not null check (type in ('expense','income')),
  frequency   text not null check (frequency in ('daily','weekly','biweekly','monthly')),
  -- schedule anchor, interpreted per frequency:
  --   monthly  -> anchor_day = 1..31 (31 means "last day of month")
  --   weekly   -> anchor_weekday = 0..6 (0=Sun)
  --   daily/biweekly -> ignored; cadence comes from start date
  anchor_day     smallint,   -- monthly
  anchor_weekday smallint,   -- weekly
  next_run    date not null,        -- next date to materialize (local date)
  last_run    date,                 -- last materialized occurrence
  active      boolean not null default true,
  created_at  timestamptz default now()
);

-- Idempotency: tag materialized transactions and forbid duplicates per occurrence.
alter table transactions add column recurring_id uuid references recurring_transactions(id) on delete set null;
create unique index transactions_recurring_occurrence
  on transactions(recurring_id, date) where recurring_id is not null;

-- RLS (mirror the other tables): user sees/edits only their own rows.
alter table recurring_transactions enable row level security;
create policy rt_owner on recurring_transactions
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index recurring_active_due on recurring_transactions(user_id, active, next_run);
```

**Why `recurring_id` + unique index on transactions:** it makes materialization
idempotent at the database layer. We insert occurrences with
`ON CONFLICT (recurring_id, date) DO NOTHING`, so a re-run after a mid-batch
crash can never double-log. This is the single most important correctness
decision in the design.

---

## 3. Schedule semantics

`advance(date, frequency, template)` → next occurrence date:

| Frequency | Rule |
|-----------|------|
| daily     | `date + 1 day` |
| weekly    | `date + 7 days` (anchored to `anchor_weekday`) |
| biweekly  | `date + 14 days` |
| monthly   | same `anchor_day` next month, **clamped** to that month's length |

**Monthly clamping (the classic bug):** if `anchor_day = 31`, then in a 30-day
month the occurrence is the 30th, and in February the 28th (29th in leap years).
Rule: `day = min(anchor_day, daysInMonth(targetYear, targetMonth))`. Storing
`anchor_day = 31` is the canonical "last day of month" sentinel.

`next_run` and all occurrence dates are **local dates** (`YYYY-MM-DD`), matching
how the app already stores `transactions.date`. No times, no UTC conversion —
this avoids off-by-one-day timezone bugs. (Trade-off: a user who hops timezones
may see a boundary occurrence shift by a day. Acceptable for v1.)

---

## 4. Materialization engine (client catch-up)

Runs on the same lifecycle hooks as the category-proposal resolver
(`useFocusEffect` on Home, `AppState` background→active, app launch), guarded by
a **once-per-local-day** flag so it doesn't run on every screen focus.

```
materializeDueRecurring(userId):
  today = localToday()
  templates = select * from recurring_transactions
              where user_id = userId and active and next_run <= today
  for t in templates:
    occurrences = []
    cursor = t.next_run
    guard = 0
    while cursor <= today and guard < CAP:
      occurrences.push(cursor)
      cursor = advance(cursor, t.frequency, t)
      guard++
    # insert all due occurrences idempotently
    insert into transactions (user_id, amount, description, category_id, type,
                              date, recurring_id, withdrawal/deposit…)
      values (… one row per occurrence …)
      on conflict (recurring_id, date) do nothing
    update recurring_transactions
      set last_run = max(occurrences), next_run = cursor
      where id = t.id
  refresh app stats/context if anything was inserted
```

**Catch-up cap (`CAP`):** if the app hasn't been opened for a long time, a daily
template could owe ~180 occurrences. Cap per-template inserts per run (proposal:
`CAP = 90`). If exceeded, insert the most recent `CAP` occurrences and
fast-forward `next_run` past the gap, then `log()` the skipped count. (Rationale:
flooding the ledger with 6 months of back-dated daily coffees helps no one;
recent history is what matters for budgeting.)

**Idempotency guarantees:**
- DB unique `(recurring_id, date)` → `ON CONFLICT DO NOTHING` makes re-runs safe.
- We advance `next_run` only after inserts; a crash causes a safe re-run, not
  duplicates.

**Concurrency:** guard with an in-flight ref (like `isFetchingCtxRef`) so two
focus events don't run it twice in one session.

---

## 4b. First occurrence, double-counting, and the ledger write shape

**The originating transaction already exists.** When the user taps "make
recurring" on a card, that transaction was *already saved* as a one-off. The
template must NOT immediately re-create it. Rule:

- On `createRecurring()`, **adopt** the originating transaction as occurrence #0:
  set its `recurring_id` to the new template, and set the template's
  `last_run = that transaction's date` and `next_run = advance(date, …)`.
- This means the first *auto*-created occurrence is the **next** scheduled date,
  never a duplicate of what the user just logged. The `(recurring_id, date)`
  unique index is the backstop if anything races.

**Write shape — `withdrawal` / `deposit`, not a signed `amount`.** The app's
`transactions` table stores `withdrawal` (expense) and `deposit` (income), with
`type`. Materialization must mirror that exactly:
- expense → `{ withdrawal: amount, deposit: 0|null, type: 'expense' }`
- income  → `{ deposit: amount, withdrawal: 0|null, type: 'income' }`
- `date` = occurrence local date, `description` carried from the template,
  `category_id` resolved at insert time (may be null → app shows "Other").

**`categories.spent` consistency.** Investigated: **no app code increments
`categories.spent`** — it's set to `0` at category creation and never updated
client-side, and Analytics computes per-category spend directly from the
`transactions` rows. So `spent` is either (a) maintained by a **DB trigger** on
`transactions`, or (b) effectively vestigial. **Action: confirm in Supabase
whether such a trigger exists.**
- If a trigger maintains it → recurring inserts get correct `spent` for free
  (no extra work; one more reason the DB-level insert is the right path).
- If not → either ignore `spent` (Analytics already recomputes), or have the
  catch-up engine recompute affected categories after inserting. Cheapest:
  treat `spent` as derived everywhere and stop writing it. (Open item — §10.)

## 5. Edge cases (the checklist)

| Case | Handling |
|------|----------|
| Day-31 monthly in Feb/Apr | clamp to last day of month (§3) |
| Leap year Feb 29 | `daysInMonth` handles it; Feb 29 monthly anchor clamps to 28 in non-leap years |
| App unopened for months | catch-up loop + `CAP`, fast-forward `next_run` |
| Crash mid-insert | `ON CONFLICT DO NOTHING` + re-run |
| Category deleted | `ON DELETE SET NULL`; occurrence logs as uncategorized → app shows "Other" |
| Template paused | `active=false` → skipped; resuming does NOT back-fill the paused gap (advance `next_run` to today on resume) |
| Frequency/anchor edited | recompute `next_run` from today forward |
| Duplicate user taps "Set recurring" | one template per (card → confirm); editing updates in place |
| DST / timezone shift | local-date model sidesteps DST; cross-tz travel may shift a boundary day (documented) |
| Income recurring (salary) | `type='income'`; writes `deposit` instead of `withdrawal` |
| Amount = 0 / negative | rejected at creation (`check amount > 0`) |

---

## 6. UI / UX

**Transaction card (chat output) — `src/components/TransactionCard.tsx`**

State machine on the card:
1. **Default:** a slim banner — `🔁 Repeat this?  [Weekly] [Monthly]`
2. **Frequency tapped:** inline compact picker —
   - monthly → "on the [15th ▾] of each month" (1–28, plus "last day")
   - weekly → "every [Tuesday ▾]"
   - a `[Set recurring]` confirm button
3. **Set:** banner collapses to `🔁 Repeats monthly · next Jul 15  ✕` (✕ = cancel)

Per-card, so a bulk log lets each transaction be made recurring independently.
Only shown on freshly-logged cards in chat (not historical renders) for v1.

**Management — `Settings → Recurring transactions`** (new screen/modal)
- List of active templates: emoji + description + amount + "monthly · next Jul 15".
- Row actions: **Pause** (toggle `active`) and **Delete**.
- Empty state explains the feature.

---

## 7. Code integration points

- **`src/lib/recurring.ts`** (new): `advance()`, `materializeDueRecurring()`,
  `createRecurring()`, `cancelRecurring()`, `pauseRecurring()`, `listRecurring()`.
  Pure date math (`advance`, `daysInMonth`, catch-up planning) split into a
  transport-free module so it's unit-testable.
- **`TransactionCard.tsx`**: the banner + picker; calls `createRecurring()`.
- **`HomeScreen.tsx`**: add `materializeDueRecurring(user.id)` to the existing
  focus/AppState/launch hooks (next to `resolvePendingProposals`), once-per-day
  guarded; refresh stats on insert.
- **`SettingsScreen.tsx`**: entry point to the management screen.
- **`agents.ts`** (phase 2): optional `recurring` hint in `TRANSACTION_DATA`.

---

## 8. Testing / eval

A pure, deterministic `eval/recurring_eval.ts` (no network) covering the date
math — this is where recurring features fail:
- monthly day-31 clamping across Jan→Feb→Mar (28/29/31)
- leap vs non-leap February
- weekly/biweekly across month and year boundaries
- catch-up: N missed months/weeks produces exactly N occurrences
- `CAP` behavior: 200 missed daily → capped inserts + fast-forwarded `next_run`
- idempotency: running catch-up twice yields the same ledger (simulated conflict)

---

## 9. Phase 2 (after v1 ships)

- **AI auto-detection:** prompt emits `"recurring": {"frequency":"monthly","anchor_day":15}`
  inside `TRANSACTION_DATA` when the user says "every month / weekly / each week",
  pre-filling the card toggle. (Eval-gate it with the bulk harness.)
- **Server cron (pg_cron + edge function):** fire at 00:05 local-ish even when
  the app is closed; client catch-up becomes a safety net. Migrate when "appears
  when you open the app" isn't good enough.
- **End dates, variable amounts, custom RRULE.**

---

## 10. Open decisions for you

1. **Resume-after-pause:** back-fill the paused gap, or skip it? (Proposed: skip
   — paused means "don't charge me for that time".)
2. **Catch-up cap value** (proposed 90) and the "skip older" behavior.
3. **Where management lives:** Settings vs a section in the Wallet tab.
4. **Show recurring toggle on historical cards too**, or only fresh chat logs?
   (Proposed: fresh only for v1.)

---

## 11. Notifications

Two distinct moments, two different tools:

**(a) "Logged while you were away" — client catch-up (v1).** Because catch-up
runs *on app open*, the user is already in the app — a push is pointless. Show
an **in-app summary** instead: a small banner/toast or a system chat message
*"🔁 Logged 3 recurring transactions while you were away: Rent ৳20,000, Internet
৳1,200, Gym ৳1,500."* Silent if nothing was due. No push token needed.

**(b) Push on auto-log — server cron (phase 2).** When pg_cron materializes at
midnight with the app closed, send one push via the existing
`profiles.push_token` + `send-push-notifications` edge function — batched into a
single "Finni logged your recurring transactions today" rather than one per item.

**(c) Optional "remind, don't auto-log" mode (future).** Some users prefer a
nudge over silent logging. `expo-notifications` local scheduling
(`scheduleNotificationAsync`) can fire *"Rent is due today — log it?"* with a
deep link to a pre-filled card. This is a per-template preference
(`auto` vs `remind`), out of scope for v1 but the schema should leave room
(add `mode text default 'auto'` later).

**Settings:** a master "Notify me about recurring transactions" toggle; respect
the existing notification permission flow (don't re-prompt).

## 12. Edit / delete semantics

The ledger is immutable history; templates govern the future. Rules:

| Action on a template | Past (already-materialized) occurrences | Future |
|----------------------|------------------------------------------|--------|
| Edit amount / description / category | unchanged (edit those individually via the card/Wallet) | applied from `next_run` onward |
| Edit frequency / anchor | unchanged | `next_run` recomputed from **today** forward |
| Pause (`active=false`) | unchanged | suspended; resume does not back-fill the gap (advance `next_run` to today) |
| Delete template | unchanged; their `recurring_id` set null (orphaned but kept) | stops entirely |
| Delete a single materialized transaction | that row only (existing delete flow) | template unaffected; next occurrence still comes |

Editing never rewrites history → no surprise budget shifts on past months. A
confirmation on destructive edits ("This stops future Rent entries — past ones
stay."). One open question: offer "delete future occurrences too" when deleting
a template? (Proposed: no — future ones don't exist yet; deleting the template
is sufficient.)

## 13. AI auto-detection (phase 2)

When the user's phrasing implies recurrence ("rent 20000 **every month**",
"**weekly** grocery 3000", "salary 80000 **monthly**"), the model emits an
optional hint inside the existing tag — no new parsing tag, just a field:

```
TRANSACTION_DATA:{"amount":20000,"description":"rent","category_id":"Rent","type":"expense",
                  "recurring":{"frequency":"monthly","anchor_day":15}}
```

- `recurring` is OPTIONAL; absent for one-off transactions.
- `anchor_day` defaults to the transaction's day-of-month; `anchor_weekday` for
  weekly. Model infers from "1st", "every Friday", etc.
- The card renders **pre-checked** recurring with those values; the user still
  confirms (no silent recurring creation from a guess).

Prompt: a new `RECURRING DETECTION` block (action intent only) with 4-5
examples, mirroring the bulk-logging rule style. **Eval-gated:** extend
`bulk_eval.ts` with recurrence cases asserting (a) the hint is emitted only when
recurrence is stated, (b) correct `frequency`/`anchor`, (c) NO false positives
on one-off phrasing ("bought coffee 200" must NOT be recurring).

## 14. Observability & eval

**Observability**
- Per-template `try/catch` in the catch-up loop → one malformed template can't
  block the others; failures go to `captureError(e, { context: 'recurring.materialize', templateId })`.
- `log`/breadcrumb the count materialized per run (and skipped-by-cap count).
- Surface a soft error if `next_run` advancement ever fails to progress (guards
  against an infinite catch-up loop — the `guard < CAP` check is the backstop).

**`eval/recurring_eval.ts` (pure, deterministic — no network)**
Enumerated `advance()` / catch-up cases:
1. monthly anchor 15 across Jan→Dec (12 occurrences, correct dates)
2. monthly anchor 31 → Jan 31, Feb 28, Mar 31, Apr 30 (clamping)
3. monthly anchor 29 in a leap year (Feb 29) vs non-leap (Feb 28)
4. weekly anchored to Friday across a month boundary
5. biweekly across a year boundary (Dec→Jan)
6. daily catch-up of 10 missed days → exactly 10 occurrences
7. catch-up of 200 missed days → capped at `CAP`, `next_run` fast-forwarded past
   the gap, skipped-count reported
8. idempotency: run catch-up twice over the same window → identical occurrence
   set (simulating the `(recurring_id, date)` conflict)
9. paused template → zero occurrences; resume advances `next_run` to today
10. adoption: creating a template from a transaction sets `last_run` = that
    date and `next_run` = the next occurrence (no duplicate of occurrence #0)

`npm run eval:recurring`. This suite must be green before the engine ships —
date math is exactly where recurring features rot.
