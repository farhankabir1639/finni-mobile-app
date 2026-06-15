-- Recurring transactions: templates + idempotent materialization support.
-- See docs/recurring-transactions-spec.md.

create table if not exists public.recurring_transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  amount         numeric not null check (amount > 0),
  description    text,
  category_id    uuid references public.categories(id) on delete set null,
  type           text not null check (type in ('expense','income')),
  frequency      text not null check (frequency in ('daily','weekly','biweekly','monthly')),
  anchor_day     smallint,   -- monthly: 1..31 (31 = last day of month)
  anchor_weekday smallint,   -- weekly/biweekly: 0..6 (0=Sun)
  next_run       date not null,
  last_run       date,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Idempotency: tag materialized transactions and forbid duplicates per occurrence.
alter table public.transactions
  add column if not exists recurring_id uuid references public.recurring_transactions(id) on delete set null;

-- Non-partial: manual transactions have recurring_id=NULL and Postgres treats
-- NULLs as distinct, so multiple manual rows on the same date never conflict.
-- Auto-created occurrences (recurring_id NOT NULL) get true uniqueness per date,
-- which makes upsert(onConflict: 'recurring_id,date', ignoreDuplicates) safe.
create unique index if not exists transactions_recurring_occurrence
  on public.transactions(recurring_id, date);

create index if not exists recurring_active_due
  on public.recurring_transactions(user_id, active, next_run);

-- RLS: each user sees/manages only their own templates.
alter table public.recurring_transactions enable row level security;

drop policy if exists rt_owner on public.recurring_transactions;
create policy rt_owner on public.recurring_transactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
