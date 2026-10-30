-- loadq_raffle_admin_ctx
-- One-shot admin context for the in-app raffle control panel: the caller's tier
-- plus the current config/round state (enabled, test_mode, today's code, status,
-- entrant_count) in a single round-trip, without touching the driver-facing
-- loadq_raffle_status. Admin-gated; see 20261030120000_loadq_raffle_admin_controls.
create or replace function public.loadq_raffle_admin_ctx(p_zone text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c public.loadq_raffle_config; r public.loadq_raffle_round; v_round uuid;
begin
  if not public.loadq_raffle_is_admin(p_zone) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from public.loadq_raffle_config where zone_id = p_zone;
  select id into v_round from public.loadq_raffle_round
    where zone_id = p_zone
      and service_date = (now() at time zone coalesce(c.timezone, 'America/Toronto'))::date;
  if v_round is not null then
    select * into r from public.loadq_raffle_round where id = v_round;
  end if;
  return jsonb_build_object(
    'is_admin', true,
    'is_lead', public.loadq_raffle_is_lead(p_zone),
    'enabled', coalesce(c.enabled, false),
    'test_mode', coalesce(c.test_mode, false),
    'code_len', coalesce(c.code_len, 4),
    'checkin_opens_local', c.checkin_opens_local,
    'draw_at_local', c.draw_at_local,
    'has_round', v_round is not null,
    'status', coalesce(r.status, 'none'),
    'service_date', r.service_date,
    'code', r.code,
    'draw_at', r.draw_at,
    'entrant_count', coalesce((select count(*) from public.loadq_raffle_entry where round_id = v_round), 0)
  );
end; $$;
grant execute on function public.loadq_raffle_admin_ctx(text) to anon, authenticated, service_role;
