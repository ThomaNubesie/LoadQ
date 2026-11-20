-- Raffle at every active lot + a reserved #1 on chosen days.
--
-- 1. Three more lots get their own raffle, in TEST MODE (dry run — the line is not
--    touched), on Universal Grocery's times. Their check-in circle starts at the lot's
--    saved location with the zone's 300 m radius, so we can see where drivers really
--    stand and re-centre/tighten later (UG's saved point turned out ~45 m off).
--
-- 2. Reserved #1: loadq_raffle_reserved holds "this driver gets #1 at this lot on this
--    weekday (or this date)". Rules (Thomas, 2026-11-20):
--      * the reserved driver must still check in at the lot (05:00–06:01);
--      * if they did, they get #1 automatically when the hat seals at 06:02 and the
--        others draw from 2…N;
--      * if they didn't, #1 simply stays in the hat.
--    Swap names/days with the two helpers below — no code change needed:
--      select loadq_raffle_reserve('ottawa-universal-grocery', 'monday', 'Dolly Kilimba');
--      select loadq_raffle_reserve('ottawa-universal-grocery', '2026-12-24', '6138571148');
--      select loadq_raffle_unreserve('ottawa-universal-grocery', 'monday');
--      select * from loadq_raffle_reserved_v;
--
-- 3. The 06:02 line clear now only clears the raffle's own destination, so another
--    run loading from the same lot (e.g. a Québec car at Universal Grocery) is left alone.

-- ── 1. New lots (test mode) ─────────────────────────────────────────────────────
insert into public.loadq_raffle_config (
  zone_id, enabled, destination_region, checkin_opens_local, checkin_closes_local, draw_opens_local,
  draw_at_local, timezone, geofence_lat, geofence_lng, geofence_radius_m, max_gps_accuracy_m,
  require_geofence, require_code, code_len, late_policy, one_checkin_per_device, max_slots,
  test_mode, allowed_driver_ids, raffle_admin_ids, lead_admin_id)
select z.id, true, v.dest, u.checkin_opens_local, u.checkin_closes_local, u.draw_opens_local,
       u.draw_at_local, coalesce(z.timezone, u.timezone), z.latitude, z.longitude, coalesce(z.radius_meters, 300),
       u.max_gps_accuracy_m, true, u.require_code, u.code_len, u.late_policy, u.one_checkin_per_device, null,
       true, u.allowed_driver_ids, u.raffle_admin_ids, u.lead_admin_id
  from (values ('montreal-berri-uquam-metro-station-sainte-catheri', 'ottawa'),
               ('montreal-burger-king',                              'ottawa'),
               ('quebec-shell-laurier',                              'montreal')) v(zone, dest)
  join public.zones z on z.id = v.zone
  cross join (select * from public.loadq_raffle_config where zone_id = 'ottawa-universal-grocery') u
on conflict (zone_id) do nothing;

-- ── 2. Reserved #1 ──────────────────────────────────────────────────────────────
create table if not exists public.loadq_raffle_reserved (
  id         uuid primary key default gen_random_uuid(),
  zone_id    text not null references public.zones(id),
  driver_id  uuid not null references public.drivers(id) on delete cascade,
  weekday    smallint check (weekday between 1 and 7),   -- ISO: 1 = Monday … 7 = Sunday
  on_date    date,
  note       text,
  created_at timestamptz not null default now(),
  check ((weekday is null) <> (on_date is null))          -- exactly one of the two
);
create unique index if not exists loadq_raffle_reserved_weekday_uniq on public.loadq_raffle_reserved(zone_id, weekday) where weekday is not null;
create unique index if not exists loadq_raffle_reserved_date_uniq    on public.loadq_raffle_reserved(zone_id, on_date) where on_date is not null;
alter table public.loadq_raffle_reserved enable row level security;   -- no policies: functions only

-- Who has #1 at this lot on this date? A specific date beats the weekly rule.
create or replace function public.loadq_raffle_reserved_driver(p_zone text, p_date date)
returns uuid language sql stable security definer set search_path = public as $$
  select driver_id from public.loadq_raffle_reserved
   where zone_id = p_zone and (on_date = p_date or (on_date is null and weekday = extract(isodow from p_date)::int))
   order by on_date nulls last limit 1;
$$;

-- Readable list for checking what's set.
create or replace view public.loadq_raffle_reserved_v as
select r.zone_id, coalesce(z.name, r.zone_id) as lot,
       case when r.on_date is not null then to_char(r.on_date, 'YYYY-MM-DD')
            else (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[r.weekday] end as day,
       d.full_name as driver, d.phone, r.note, r.driver_id
  from public.loadq_raffle_reserved r
  join public.drivers d on d.id = r.driver_id
  left join public.zones z on z.id = r.zone_id
 order by r.zone_id, r.on_date nulls first, r.weekday;
revoke all on public.loadq_raffle_reserved_v from anon, authenticated;

-- Day words: monday/lundi/mon/lun … or an ISO date.
create or replace function public.loadq_raffle_parse_day(p_day text, out weekday smallint, out on_date date)
language plpgsql immutable as $$
declare d text := lower(btrim(p_day));
begin
  if d ~ '^\d{4}-\d{2}-\d{2}$' then on_date := d::date; return; end if;
  weekday := case
    when d in ('monday','mon','lundi','lun')        then 1
    when d in ('tuesday','tue','mardi','mar')       then 2
    when d in ('wednesday','wed','mercredi','mer')  then 3
    when d in ('thursday','thu','jeudi','jeu')      then 4
    when d in ('friday','fri','vendredi','ven')     then 5
    when d in ('saturday','sat','samedi','sam')     then 6
    when d in ('sunday','sun','dimanche','dim')     then 7 end;
  if weekday is null then raise exception 'unknown day "%": use a weekday (monday…/lundi…) or YYYY-MM-DD', p_day; end if;
end $$;

-- Set (or replace) the reserved driver for a lot + day. p_driver = full or partial
-- name, or phone digits; it must match exactly one driver.
create or replace function public.loadq_raffle_reserve(p_zone text, p_day text, p_driver text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w smallint; dt date; ids uuid[]; digits text := regexp_replace(coalesce(p_driver,''), '\D', '', 'g');
begin
  if auth.uid() is not null and not public.loadq_raffle_is_admin(p_zone) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.loadq_raffle_config where zone_id = p_zone) then
    raise exception 'no raffle at lot "%"', p_zone; end if;
  select x.weekday, x.on_date into w, dt from public.loadq_raffle_parse_day(p_day) x;
  select array_agg(id) into ids from public.drivers
   where (length(digits) >= 7 and regexp_replace(coalesce(phone,''), '\D', '', 'g') like '%' || right(digits, 10))
      or (length(digits) < 7 and full_name ilike '%' || btrim(p_driver) || '%');
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'no driver matches "%"', p_driver; end if;
  if array_length(ids, 1) > 1 then
    raise exception '"%" matches % drivers: % — be more specific', p_driver, array_length(ids, 1),
      (select string_agg(full_name, ', ') from public.drivers where id = any(ids));
  end if;
  if w is not null then delete from public.loadq_raffle_reserved where zone_id = p_zone and weekday = w;
  else delete from public.loadq_raffle_reserved where zone_id = p_zone and on_date = dt; end if;
  insert into public.loadq_raffle_reserved(zone_id, driver_id, weekday, on_date, note) values (p_zone, ids[1], w, dt, p_note);
  return jsonb_build_object('ok', true, 'lot', p_zone, 'day', coalesce(dt::text, p_day),
    'driver', (select full_name from public.drivers where id = ids[1]));
end $$;

create or replace function public.loadq_raffle_unreserve(p_zone text, p_day text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w smallint; dt date; n int;
begin
  if auth.uid() is not null and not public.loadq_raffle_is_admin(p_zone) then raise exception 'forbidden'; end if;
  select x.weekday, x.on_date into w, dt from public.loadq_raffle_parse_day(p_day) x;
  delete from public.loadq_raffle_reserved
   where zone_id = p_zone and ((w is not null and weekday = w) or (dt is not null and on_date = dt));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'removed', n);
end $$;
revoke execute on function public.loadq_raffle_reserve(text,text,text,text), public.loadq_raffle_unreserve(text,text) from anon;

-- ── Seal → reserved #1 → clear (own destination only) ───────────────────────────
create or replace function public.loadq_raffle_tick(p_round uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.loadq_raffle_round; test boolean; res uuid; e public.loadq_raffle_entry;
begin
  select * into r from public.loadq_raffle_round where id = p_round for update;
  if not found or r.status <> 'open' then return; end if;
  test := coalesce((select test_mode from public.loadq_raffle_config where zone_id = r.zone_id), true);
  if r.hat_size is null and r.checkin_closes_at is not null and now() >= r.checkin_closes_at then
    update public.loadq_raffle_round
       set hat_size = (select count(*) from public.loadq_raffle_entry where round_id = r.id), sealed_at = now()
     where id = r.id;
    -- Reserved #1: only if that driver checked in; otherwise #1 stays in the hat.
    res := public.loadq_raffle_reserved_driver(r.zone_id, r.service_date);
    if res is not null then
      update public.loadq_raffle_entry
         set assigned_number = 1, drawn_at = now(), code_ok = true, status = 'drawn'
       where round_id = r.id and driver_id = res and assigned_number is null
         and not exists (select 1 from public.loadq_raffle_entry x where x.round_id = r.id and x.assigned_number = 1);
    end if;
  end if;
  if r.line_cleared_at is null and r.draw_opens_at is not null and now() >= r.draw_opens_at then
    if not test then
      delete from public.queue_entries
       where zone_id = r.zone_id and status <> 'ended'
         and destination_region is not distinct from r.destination_region;
      -- The reserved #1 (if any) goes straight onto the fresh line.
      select * into e from public.loadq_raffle_entry where round_id = r.id and assigned_number = 1;
      if e.id is not null then
        perform set_config('loadq.raffle_insert', '1', true);
        insert into public.queue_entries(zone_id, driver_id, vehicle_id, position, status,
              destination_region, seats_boarded, seats_locked, seat_states, joined_at)
        values (r.zone_id, e.driver_id, e.vehicle_id, 1, 'waiting', r.destination_region, 0, 0, '[]'::jsonb, now());
      end if;
    end if;
    update public.loadq_raffle_round set line_cleared_at = now() where id = r.id;
  end if;
end $$;

-- ── For the app: which lots run a raffle, and where they are ──────────────────────
create or replace function public.loadq_raffle_lots()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'zone_id', c.zone_id, 'name', coalesce(z.name, c.zone_id), 'destination', c.destination_region,
           'lat', c.geofence_lat, 'lng', c.geofence_lng, 'test_mode', c.test_mode)
         order by c.zone_id), '[]'::jsonb)
    from public.loadq_raffle_config c left join public.zones z on z.id = c.zone_id
   where c.enabled;
$$;
grant execute on function public.loadq_raffle_lots() to authenticated;
