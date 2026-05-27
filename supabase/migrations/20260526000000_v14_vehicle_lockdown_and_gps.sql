-- v14: (P107) lock vehicle edit to admin only,
--      (P108) cap each driver at 2 vehicles,
--      (P105) per-user location for GPS proximity matching.

-- ─────────────────────────────────────────────────────────────
-- P107: Vehicle UPDATE restricted to admin
-- ─────────────────────────────────────────────────────────────
-- Drop any existing UPDATE policies on vehicles.
drop policy if exists vehicles_update_own        on public.vehicles;
drop policy if exists vehicles_update_self       on public.vehicles;
drop policy if exists vehicles_update_admin      on public.vehicles;

-- New: only admins can UPDATE rows directly. Drivers can no longer self-edit;
-- the admin path (admin_update_vehicle_basics RPC) is security definer so it
-- bypasses this policy.
create policy vehicles_update_admin on public.vehicles
  for update to authenticated
  using (
    exists (select 1 from public.drivers d
            where d.id = auth.uid() and d.is_admin = true)
  );

-- ─────────────────────────────────────────────────────────────
-- P108: Max 2 vehicles per driver
-- ─────────────────────────────────────────────────────────────
create or replace function public.enforce_vehicle_limit()
returns trigger language plpgsql as $func$
declare v_count int;
begin
  select count(*) into v_count
    from public.vehicles
   where driver_id = new.driver_id;
  if v_count >= 2 then
    raise exception 'A driver can have at most 2 vehicles.';
  end if;
  return new;
end;
$func$;

drop trigger if exists vehicles_limit_trigger on public.vehicles;
create trigger vehicles_limit_trigger
  before insert on public.vehicles
  for each row execute function public.enforce_vehicle_limit();


-- ─────────────────────────────────────────────────────────────
-- P105: GPS proximity location tracking
-- ─────────────────────────────────────────────────────────────
alter table public.drivers
  add column if not exists current_lat   double precision,
  add column if not exists current_lng   double precision,
  add column if not exists last_seen_at  timestamptz;

alter table public.passengers
  add column if not exists current_lat   double precision,
  add column if not exists current_lng   double precision,
  add column if not exists last_seen_at  timestamptz;

-- RPC: update the caller's current position. Used by both drivers + passengers
-- while the app is foreground.
create or replace function public.update_my_location(
  p_lat double precision,
  p_lng double precision
) returns void
language plpgsql
security definer
set search_path = public
as $func$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  update public.drivers
     set current_lat = p_lat, current_lng = p_lng, last_seen_at = now()
   where id = v_uid;
  update public.passengers
     set current_lat = p_lat, current_lng = p_lng, last_seen_at = now()
   where id = v_uid;
end;
$func$;
grant execute on function public.update_my_location(double precision, double precision) to authenticated;

-- Haversine distance helper in meters.
create or replace function public.haversine_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable parallel safe
as $func$
  select 2 * 6371000 * asin(sqrt(
    sin(radians((lat2 - lat1) / 2)) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) *
    sin(radians((lng2 - lng1) / 2)) ^ 2
  ));
$func$;

-- RPC: detect which currently-loading driver the calling passenger is most
-- likely IN, based on GPS proximity within the last 2 minutes and <100m.
-- Returns at most one match (the closest).
create or replace function public.match_my_active_trip()
returns table(
  queue_entry_id     uuid,
  driver_id          uuid,
  driver_name        text,
  destination_region text,
  distance_m         double precision
)
language plpgsql
security definer
set search_path = public
as $func$
declare v_uid uuid := auth.uid();
declare v_lat double precision; declare v_lng double precision;
declare v_seen timestamptz;
begin
  if v_uid is null then return; end if;
  select current_lat, current_lng, last_seen_at into v_lat, v_lng, v_seen
    from public.passengers where id = v_uid;
  if v_lat is null or v_lng is null or v_seen is null or v_seen < now() - interval '5 minutes' then
    return;
  end if;

  return query
    select qe.id, d.id, d.full_name, qe.destination_region,
           public.haversine_m(v_lat, v_lng, d.current_lat, d.current_lng) as dist
      from public.queue_entries qe
      join public.drivers d on d.id = qe.driver_id
     where qe.status in ('loading', 'called_back')
       and d.current_lat is not null and d.current_lng is not null
       and d.last_seen_at > now() - interval '5 minutes'
       and public.haversine_m(v_lat, v_lng, d.current_lat, d.current_lng) < 100
     order by dist asc
     limit 1;
end;
$func$;
grant execute on function public.match_my_active_trip() to authenticated;

notify pgrst, 'reload schema';
