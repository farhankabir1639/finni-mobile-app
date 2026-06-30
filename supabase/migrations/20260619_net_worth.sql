-- Net-worth tracker: manual assets + liabilities. Net worth =
-- (sum of asset values + live investment portfolio) − sum of liability values.
-- Investments are pulled live from the investments table, not duplicated here.
-- Idempotent.

create table if not exists public.net_worth_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('asset','liability')),
  name       text not null,
  item_type  text,                         -- asset: cash/savings/property/vehicle/other
                                            -- liability: debt/loan/credit_card/mortgage/other
  value      numeric not null default 0 check (value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists net_worth_items_owner_idx
  on public.net_worth_items(user_id, kind);

-- RLS: each user sees/manages only their own items.
alter table public.net_worth_items enable row level security;
drop policy if exists owner_all on public.net_worth_items;
create policy owner_all on public.net_worth_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
