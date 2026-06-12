-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Notifications infrastructure
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. app_config table (for in-app update prompt — Feature 3)
CREATE TABLE IF NOT EXISTS public.app_config (
  id                          INT PRIMARY KEY DEFAULT 1,
  android_latest_version_code INT  NOT NULL DEFAULT 26,
  android_min_version_code    INT  NOT NULL DEFAULT 1,
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with current version so existing users see no prompt immediately
INSERT INTO public.app_config (id, android_latest_version_code, android_min_version_code)
VALUES (1, 26, 1)
ON CONFLICT (id) DO NOTHING;

-- Only the service role should write to this table; reads are public (anon OK)
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read app_config" ON public.app_config FOR SELECT USING (true);

-- 2. Notification preferences on profiles (Features 1 & 2)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_insights  TEXT      DEFAULT 'off'
    CHECK (email_insights IN ('off', 'daily', 'weekly')),
  ADD COLUMN IF NOT EXISTS push_token      TEXT,
  ADD COLUMN IF NOT EXISTS push_enabled    BOOLEAN   DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_active_at  TIMESTAMPTZ DEFAULT NOW();

-- 3. Enable cron extension (requires Supabase pg_cron — enable in Dashboard → Extensions first)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- 4. Schedule email insights: daily at 08:00 UTC
-- Replace <YOUR_PROJECT_REF> and <SERVICE_ROLE_KEY> with real values.
-- SELECT cron.schedule(
--   'finni-send-insights-email',
--   '0 8 * * *',
--   $$
--   SELECT net.http_post(
--     url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/send-insights-email',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
--     body    := '{}'::jsonb
--   )
--   $$
-- );

-- 5. Schedule push notifications: daily at 09:00 UTC
-- SELECT cron.schedule(
--   'finni-send-push-notifications',
--   '0 9 * * *',
--   $$
--   SELECT net.http_post(
--     url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/send-push-notifications',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
--     body    := '{}'::jsonb
--   )
--   $$
-- );
