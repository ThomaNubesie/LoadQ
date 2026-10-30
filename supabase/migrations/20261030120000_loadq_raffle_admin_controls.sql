-- loadq_raffle_admin_controls
-- In-app raffle admin controls, tiered. A single pinned LEAD admin gets full
-- control (enable/disable the zone, toggle test mode, force the draw); ANY raffle
-- admin (lead or sub) can set / rotate today's lot code. The existing
-- loadq_raffle_set_enabled / loadq_raffle_finalize are left untouched so the
-- auto-draw cron (service_role, which has no auth.uid()) keeps working — the
-- lead-only actions are separate, lead-gated wrappers over them.

-- 1) Pin the lead admin on the zone config (one account for now; data-driven so
--    it can be reassigned later without a code change).
alter table public.loadq_raffle_config add column if not exists lead_admin_id uuid;
update public.loadq_raffle_config
   set lead_admin_id = '329b4603-355c-4058-895c-37826ef147ca'
 where zone_id = 'ottawa-universal-grocery';

-- 2) Lead predicate — the caller IS the lead admin for this zone.
create or replace function public.loadq_raffle_is_lead(p_zone text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select auth.uid() = lead_admin_id
                     from public.loadq_raffle_config where zone_id = p_zone), false);
$$;

-- 3) Set / rotate today's lot code — ANY raffle admin (lead or sub).
create or replace function public.loadq_raffle_set_code(p_zone text, p_code text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tz text; v_len int; v_round uuid;
begin
  if not public.loadq_raffle_is_admin(p_zone) then
    return jsonb_build_object('error', 'not_admin');
  end if;
  select timezone, code_len into v_tz, v_len
    from public.loadq_raffle_config where zone_id = p_zone;
  if p_code is null or p_code !~ ('^[0-9]{' || coalesce(v_len, 4) || '}$') then
    return jsonb_build_object('error', 'bad_code', 'expected_len', coalesce(v_len, 4));
  end if;
  select id into v_round from public.loadq_raffle_round
    where zone_id = p_zone
      and service_date = (now() at time zone coalesce(v_tz, 'America/Toronto'))::date;
  if v_round is null then
    return jsonb_build_object('error', 'no_round');
  end if;
  update public.loadq_raffle_round set code = p_code where id = v_round;
  insert into public.loadq_raffle_audit(round_id, actor_id, action, detail)
    values (v_round, auth.uid(), 'set_code', jsonb_build_object('zone', p_zone));
  return jsonb_build_object('ok', true, 'round_id', v_round, 'code', p_code);
end; $$;

-- 4) Toggle test mode — LEAD only.
create or replace function public.loadq_raffle_set_test_mode(p_zone text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.loadq_raffle_is_lead(p_zone) then
    return jsonb_build_object('error', 'not_lead');
  end if;
  update public.loadq_raffle_config
     set test_mode = p_enabled, updated_at = now()
   where zone_id = p_zone;
  insert into public.loadq_raffle_audit(round_id, actor_id, action, detail)
    values (null, auth.uid(), 'set_test_mode',
            jsonb_build_object('zone', p_zone, 'test_mode', p_enabled));
  return jsonb_build_object('ok', true, 'test_mode', p_enabled);
end; $$;

-- 5) Enable / disable the zone (open/close the raffle) — LEAD only.
create or replace function public.loadq_raffle_set_enabled_lead(p_zone text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.loadq_raffle_is_lead(p_zone) then
    return jsonb_build_object('error', 'not_lead');
  end if;
  return public.loadq_raffle_set_enabled(p_zone, p_enabled);
end; $$;

-- 6) Force the draw/lock for today's round — LEAD only.
create or replace function public.loadq_raffle_finalize_lead(p_zone text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tz text; v_round uuid;
begin
  if not public.loadq_raffle_is_lead(p_zone) then
    return jsonb_build_object('error', 'not_lead');
  end if;
  select timezone into v_tz from public.loadq_raffle_config where zone_id = p_zone;
  select id into v_round from public.loadq_raffle_round
    where zone_id = p_zone
      and service_date = (now() at time zone coalesce(v_tz, 'America/Toronto'))::date;
  if v_round is null then
    return jsonb_build_object('error', 'no_round');
  end if;
  return public.loadq_raffle_finalize(v_round);
end; $$;

-- 7) Grants mirror the existing raffle RPCs; the internal auth.uid() checks gate them.
grant execute on function public.loadq_raffle_is_lead(text)                   to anon, authenticated, service_role;
grant execute on function public.loadq_raffle_set_code(text, text)            to anon, authenticated, service_role;
grant execute on function public.loadq_raffle_set_test_mode(text, boolean)    to anon, authenticated, service_role;
grant execute on function public.loadq_raffle_set_enabled_lead(text, boolean) to anon, authenticated, service_role;
grant execute on function public.loadq_raffle_finalize_lead(text)             to anon, authenticated, service_role;
