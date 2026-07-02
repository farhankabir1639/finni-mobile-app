-- Metering fix: add a dry-run mode to consume_ai_action so the proxy can CHECK
-- the cap before calling Gemini (reject at cap without cost) and only INCREMENT
-- after a successful 2xx response — so 503/timeout retries no longer over-count
-- the quota and bounce users to the paywall early.

drop function if exists public.consume_ai_action(int, int);

create or replace function public.consume_ai_action(
  p_free_limit int     default 50,
  p_pro_limit  int     default 500,
  p_dry_run    boolean default false
)
returns table(allowed boolean, used int, action_limit int, plan text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_plan   text;
  v_used   int;
  v_period date;
  v_exp    timestamptz;
  v_limit  int;
  v_month  date := date_trunc('month', (now() AT TIME ZONE 'utc'))::date;
  v_is_pro boolean;
begin
  if v_uid is null then
    return query select false, 0, p_free_limit, 'free'::text;
    return;
  end if;

  select pr.plan, pr.ai_actions_used, pr.ai_actions_period_start, pr.plan_expires_at
    into v_plan, v_used, v_period, v_exp
  from public.profiles pr
  where pr.id = v_uid
  for update;

  if not found then
    return query select true, 0, p_free_limit, 'free'::text;
    return;
  end if;

  v_is_pro := (coalesce(v_plan, 'free') = 'pro') and (v_exp is null or v_exp > now());
  v_limit  := case when v_is_pro then p_pro_limit else p_free_limit end;

  if v_period is null or v_period < v_month then
    v_used := 0;
    v_period := v_month;
  end if;

  -- Over cap → deny (persist any monthly reset).
  if v_used >= v_limit then
    update public.profiles set ai_actions_used = v_used, ai_actions_period_start = v_period where id = v_uid;
    return query select false, v_used, v_limit, case when v_is_pro then 'pro' else 'free' end;
    return;
  end if;

  -- Dry run → allowed, but do NOT increment (persist reset only).
  if p_dry_run then
    update public.profiles set ai_actions_used = v_used, ai_actions_period_start = v_period where id = v_uid;
    return query select true, v_used, v_limit, case when v_is_pro then 'pro' else 'free' end;
    return;
  end if;

  -- Real consume → increment.
  v_used := v_used + 1;
  update public.profiles set ai_actions_used = v_used, ai_actions_period_start = v_period where id = v_uid;
  return query select true, v_used, v_limit, case when v_is_pro then 'pro' else 'free' end;
end;
$$;

revoke all on function public.consume_ai_action(int, int, boolean) from public;
grant execute on function public.consume_ai_action(int, int, boolean) to authenticated;
