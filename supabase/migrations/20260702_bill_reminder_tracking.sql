-- Bill reminders: track the last occurrence we reminded for, so the cron can
-- fire once within a window (0..reminder_days_before days before due) instead of
-- an exact-day match that a skipped cron run would miss entirely. Idempotent.

alter table public.recurring_transactions
  add column if not exists reminder_last_sent date;
