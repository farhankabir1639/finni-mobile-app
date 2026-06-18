# Push Notifications — Engagement Plan

Status: current function fixed + deployed; this is the **growth plan** for what to
add. Goal: activate new users, build the daily-logging habit, and win back
lapsed users — without notification fatigue.

## Current state (live after fix)
`send-push-notifications`, one notification/user/day, priority order:
1. Mon → weekly summary  2. inactive 2–4d → reactivation  3. inactive 5+d →
win-back  4. active → budget alert (≥80%, now computed from real transactions).
Sent via Expo Push; fires from pg_cron (see cron SQL).

## Non-negotiable principles (so we don't get muted/uninstalled)
- **Max 1/day** (already enforced) + **quiet hours** (never 10pm–8am local).
- **Grounded & personalized** — real numbers/names, never generic spam (same rule as the emails).
- **Per-type opt-out** — users pick which kinds they get (not just one on/off). Notifications people can't control get the whole app muted.
- **Permission priming** — ask for OS push permission *after* a value moment (first expense logged), not on cold first launch.
- **Deep links** — every tap lands on the relevant screen, pre-filled.
- **Measure everything** — tag sends + opens in PostHog; kill types with low open / high mute.
- **Timing** — single daily job; pick an hour that fits a daily money check-in (evening local). Per-user timezone is a later upgrade (only BDT today).

## Notification catalog (grouped by job-to-be-done)

**A. Activate (first 7 days — the make-or-break window)**
- Day 0 (no expense yet): "Log your first expense — takes 5 seconds."
- Day 2 (no budget set): "Set a budget and Finni starts coaching you."
- First-streak spark: "🔥 2 days in a row — you're building a habit."

**B. Habit / streak (retention engine)**
- Streak milestones: 3/7/14/30 days ("🔥 7-day streak!").
- **Streak-at-risk** (logged yesterday, not today, evening): "Don't break your 6-day streak — log today." *(highest-ROI retention nudge.)*

**C. Value / awareness (why they keep it)**
- Budget ≥80% (live), and **over-budget** ("You've passed your Food budget").
- Positive reinforcement: "You're under pace this week — nice 👍" (don't only nag).
- Payday detected (income logged): "Income in — want to allocate it across your budget?"
- "Finni noticed" insight push (reuse the grounded insights engine).

**D. Recurring & goals (tie into features we built)**
- Recurring due / "we auto-logged your rent today."
- Goal milestone: "🎉 50% to your Eid goal!" · goal contribution reminder.
- Month rollover: "New month — your budgets reset. Here's last month's recap."

**E. Win-back (lapsed)**
- 2–4d (live), 5+d (live), plus deeper 14d / 30d with a specific hook (their top category, or "you saved ৳X last time you tracked").

**F. Auto-capture (when that feature ships)**
- "3 new transactions to review" when push/email-captured items are pending → deep-link to the Review tab.

## Controls to build (client)
Expand `NotificationsModal` from a single toggle to **per-category switches**:
Budget alerts · Streaks & reminders · Weekly summary · Tips & insights ·
Win-back. Store as flags on `profiles`; the function checks them before sending.

## Measurement
- Track `push_sent {type}` and `push_opened {type}` in PostHog (deep link carries the type).
- Weekly review: open-rate and mute-rate per type → cut losers, double down on winners.
- Guard metric: **notification-driven uninstall / push-disable rate.**

## Phasing
- **P1 (now):** existing 4 types working (done) + schedule the cron + per-type prefs + quiet hours.
- **P2:** streak engine (B) + activation series (A) — the biggest retention levers.
- **P3:** payday/positive/insight pushes (C) + goal/recurring (D).
- **P4:** deeper win-back (E) + auto-capture review nudges (F).

## Open decisions
1. Daily send time (UTC) — recommend evening BDT (e.g. 13:00 UTC = 7pm) for a day-end check-in.
2. Per-type preferences in v1, or ship the cron first and add prefs in P2?
3. Streak tracking needs a `streak_count` / `last_log_date` on profiles (or computed) — confirm before building B.
