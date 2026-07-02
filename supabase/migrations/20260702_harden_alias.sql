-- Security hardening for email auto-capture.

-- 1. Generate the forwarding alias DB-side (unguessable, gen_random_uuid) instead
--    of client-side Math.random. New connections created without an alias get an
--    unpredictable one; the client now omits the field and reads it back.
alter table public.email_sms_connections
  alter column forwarding_alias set default ('u-' || replace(gen_random_uuid()::text, '-', '') || '@in.heyfinni.com');

-- 2. Retire legacy prototype staging rows so they don't surface in the Review tab.
--    (The old prototype shape had null amount; the additive fixup stamped them
--    status='pending'. The app also filters amount>0, but clean them up too.)
update public.extracted_transactions
  set status = 'rejected'
  where status = 'pending' and (amount is null or amount <= 0);
