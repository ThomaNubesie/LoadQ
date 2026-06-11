-- LoadQ queue escalation support. (Applied live 2026-06-11.)

-- 1. loadq_load_minutes must take a TEXT zone id (zones.id is text, not uuid).
--    Returns 240 (4h) for the first two loading sessions of the day in a zone,
--    else 180 (3h).
drop function if exists public.loadq_load_minutes(uuid);
create or replace function public.loadq_load_minutes(p_zone text)
returns integer
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  tz text;
  day_start timestamptz;
  cnt integer;
begin
  select timezone into tz from public.zones where id = p_zone;
  tz := coalesce(tz, 'America/Toronto');
  day_start := date_trunc('day', now() at time zone tz) at time zone tz;
  select count(*) into cnt from public.loading_history
   where zone_id = p_zone and load_start_at >= day_start;
  cnt := cnt + (select count(*) from public.queue_entries
                where zone_id = p_zone and status = 'loading');
  return case when cnt < 2 then 240 else 180 end;
end; $$;
grant execute on function public.loadq_load_minutes(text) to authenticated, anon, service_role;

-- 2. Driver live location — only used to TAILOR the wording of a release
--    message (near the zone vs. away). The release itself happens either way.
alter table public.drivers
  add column if not exists current_lat double precision,
  add column if not exists current_lng double precision,
  add column if not exists location_at  timestamptz;

-- 3. Self-service location reporter. A driver can only update their own row.
create or replace function public.loadq_report_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  update public.drivers
     set current_lat = p_lat, current_lng = p_lng, location_at = now()
   where id = auth.uid();
end; $$;
grant execute on function public.loadq_report_location(double precision, double precision) to authenticated;
