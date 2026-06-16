-- Security fix: 7 user-owned tables had RLS disabled (publicly readable/writable
-- via the anon key). All have a user_id column, so lock each to its owner.
-- Idempotent: safe to re-run.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_configs','insights','missions','transaction_mapping_patterns',
    'upload_transactions','user_activities','user_onboarding'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_all ON public.%I;', t);
    EXECUTE format($f$CREATE POLICY owner_all ON public.%I
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);$f$, t);
  END LOOP;
END $$;
