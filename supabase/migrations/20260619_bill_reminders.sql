-- Bill reminders: opt-in push reminder before a recurring expense is due.
-- Extends recurring_transactions; the daily push cron fires a reminder when an
-- active expense template's next_run is exactly reminder_days_before days out.
-- Idempotent.

alter table public.recurring_transactions
  add column if not exists reminder_enabled     boolean  not null default false,
  add column if not exists reminder_days_before smallint not null default 1;
