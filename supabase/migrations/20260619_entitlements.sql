-- Monetization Phase 0: entitlements on profiles + atomic AI-action metering.
-- Single Pro tier (free | pro). Free = 50 AI actions/mo, Pro = 500 (fair use).
-- Idempotent: safe to re-run.

-- ── Entitlement columns on profiles ────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan                    text        NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_source             text,                       -- 'iap' | 'appsumo' | 'web' | 'comp'
  ADD COLUMN IF NOT EXISTS plan_expires_at         timestamptz,                -- null = never expires (lifetime/free)
  ADD COLUMN IF NOT EXISTS ai_actions_used         int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_actions_period_start date;

-- ── Atomic consume-one-AI-action RPC ───────────────────────────────────────
-- Called by the gemini-proxy edge function (which runs as the signed-in user,
-- so auth.uid() resolves and RLS applies). Resets the monthly counter on month
-- rollover, then either increments + allows, or denies when the cap is hit.
-- An expired Pro subscription is treated as free here (defensive; the webhook
-- also flips plan='free' on expiry).
CREATE OR REPLACE FUNCTION public.consume_ai_action(
  p_free_limit int DEFAULT 50,
  p_pro_limit  int DEFAULT 500
)
RETURNS TABLE(allowed boolean, used int, action_limit int, plan text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_plan   text;
  v_used   int;
  v_period date;
  v_exp    timestamptz;
  v_limit  int;
  v_month  date := date_trunc('month', (now() AT TIME ZONE 'utc'))::date;
  v_is_pro boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 0, p_free_limit, 'free'::text;
    RETURN;
  END IF;

  SELECT pr.plan, pr.ai_actions_used, pr.ai_actions_period_start, pr.plan_expires_at
    INTO v_plan, v_used, v_period, v_exp
  FROM public.profiles pr
  WHERE pr.id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Profile not created yet; allow (free) without persisting.
    RETURN QUERY SELECT true, 0, p_free_limit, 'free'::text;
    RETURN;
  END IF;

  v_is_pro := (COALESCE(v_plan, 'free') = 'pro')
              AND (v_exp IS NULL OR v_exp > now());
  v_limit  := CASE WHEN v_is_pro THEN p_pro_limit ELSE p_free_limit END;

  -- Monthly reset
  IF v_period IS NULL OR v_period < v_month THEN
    v_used   := 0;
    v_period := v_month;
  END IF;

  IF v_used >= v_limit THEN
    UPDATE public.profiles
      SET ai_actions_used = v_used, ai_actions_period_start = v_period
      WHERE id = v_uid;
    RETURN QUERY SELECT false, v_used, v_limit, CASE WHEN v_is_pro THEN 'pro' ELSE 'free' END;
    RETURN;
  END IF;

  v_used := v_used + 1;
  UPDATE public.profiles
    SET ai_actions_used = v_used, ai_actions_period_start = v_period
    WHERE id = v_uid;

  RETURN QUERY SELECT true, v_used, v_limit, CASE WHEN v_is_pro THEN 'pro' ELSE 'free' END;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_action(int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.consume_ai_action(int, int) TO authenticated;
