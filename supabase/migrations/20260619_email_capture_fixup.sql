-- Email-capture fixup — reconcile the LEGACY prototype tables (which already
-- exist in prod with a different shape: email_address/access_token/provider…)
-- up to the v1 email-forwarding schema. Purely ADDITIVE + idempotent: only adds
-- missing columns/constraints/policies, never drops or rewrites existing rows.
-- On a fresh DB (where 20260617 created the clean tables) every statement here
-- is a harmless no-op.

-- ── email_sms_connections ────────────────────────────────────────────────────
alter table public.email_sms_connections
  add column if not exists connection_type  text not null default 'email',
  add column if not exists forwarding_alias  text,
  add column if not exists is_active         boolean not null default true;

do $$ begin
  alter table public.email_sms_connections
    add constraint email_sms_connections_forwarding_alias_key unique (forwarding_alias);
exception when duplicate_object then null; end $$;

-- ── extracted_transactions ───────────────────────────────────────────────────
alter table public.extracted_transactions
  add column if not exists source                text not null default 'email',
  add column if not exists source_hash           text,
  add column if not exists raw_snippet           text,
  add column if not exists amount                numeric,
  add column if not exists direction             text,
  add column if not exists merchant              text,
  add column if not exists currency              text,
  add column if not exists occurred_at           timestamptz,
  add column if not exists suggested_category_id uuid references public.categories(id) on delete set null,
  add column if not exists confidence            numeric,
  add column if not exists status                text not null default 'pending',
  add column if not exists created_at            timestamptz not null default now();

do $$ begin
  alter table public.extracted_transactions
    add constraint extracted_transactions_user_id_source_hash_key unique (user_id, source_hash);
exception when duplicate_object then null; end $$;

create index if not exists extracted_pending_idx
  on public.extracted_transactions(user_id, status, created_at desc);

-- ── RLS (idempotent) ─────────────────────────────────────────────────────────
alter table public.email_sms_connections enable row level security;
drop policy if exists owner_all on public.email_sms_connections;
create policy owner_all on public.email_sms_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.extracted_transactions enable row level security;
drop policy if exists owner_all on public.extracted_transactions;
create policy owner_all on public.extracted_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
