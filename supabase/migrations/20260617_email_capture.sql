-- Email-forwarding auto-capture v1 — clean schema.
-- See docs/email-forwarding-v1-spec.md §3. Idempotent.

-- Per-user forwarding connection + unguessable alias.
create table if not exists public.email_sms_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_type text not null default 'email' check (connection_type in ('email','push')),
  forwarding_alias text unique,            -- e.g. u-9f3a2b7c@in.heyfinni.com
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Staging queue for auto-captured transactions awaiting user review.
-- (Supersedes the old prototype shape; one writer, one schema.)
create table if not exists public.extracted_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'email' check (source in ('email','push')),
  source_hash text not null,               -- dedup key (provider message-id or from|amount|ts)
  raw_snippet text,                        -- REDACTED minimum; OTP-scrubbed
  amount numeric,
  direction text check (direction in ('expense','income')),
  merchant text,
  currency text,
  occurred_at timestamptz,
  suggested_category_id uuid references public.categories(id) on delete set null,
  confidence numeric,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  unique (user_id, source_hash)            -- same email can never be imported twice
);

-- RLS: each user sees/manages only their own rows.
alter table public.email_sms_connections enable row level security;
drop policy if exists owner_all on public.email_sms_connections;
create policy owner_all on public.email_sms_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.extracted_transactions enable row level security;
drop policy if exists owner_all on public.extracted_transactions;
create policy owner_all on public.extracted_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists extracted_pending_idx
  on public.extracted_transactions(user_id, status, created_at desc);
