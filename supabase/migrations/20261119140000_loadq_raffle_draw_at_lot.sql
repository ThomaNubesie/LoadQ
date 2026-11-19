-- The draw must happen AT the lot, not just the check-in.
--
-- Check-in proves a driver arrived; nothing proved he was still there when he typed
-- the code. Simulated 2026-11-19: check in at the lot, drive 55 km away, draw on a
-- forwarded code — it worked. The same geofence the check-in uses now guards the draw.
--
-- Ships with the app change that sends a GPS fix on the draw tap as well
-- (app/(app)/raffle.tsx: needsLocation covers checkin AND draw). Applying this
-- without that build returns location_required to every draw.
create or replace function public.loadq_raffle_enter(
  p_zone text, p_lat double precision, p_lng double precision,
  p_accuracy double precision, p_code text, p_device text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $fn$

declare uid uuid := auth.uid(); c public.loadq_raffle_config; r public.loadq_raffle_round;
        veh record; dist double precision; k text; rid uuid; new_id uuid; ticket int; phase text;
        mine public.loadq_raffle_entry; admin boolean; svc date; opens timestamptz;
begin
  if uid is null then return jsonb_build_object('error','auth_required'); end if;
  select * into c from public.loadq_raffle_config where zone_id = p_zone and enabled;
  if not found then return jsonb_build_object('error','not_open'); end if;
  admin := public.loadq_raffle_is_admin(p_zone);

  rid := public.loadq_raffle_ensure_round(p_zone);
  if rid is not null then perform public.loadq_raffle_tick(rid); end if;
  phase := public.loadq_raffle_phase(rid);

  if phase not in ('checkin','draw') then
    if admin and phase <> 'sealing' then
      return jsonb_build_object('ok',true,'test',true,'registered',false,
        'provisional_position', (1 + floor(random()*9))::int,
        'note','Test tap — not registered (check-in 05:00–06:01, draw 06:02–07:00).');
    end if;
    return jsonb_build_object('error', case phase when 'sealing' then 'draw_not_open'
                                                  when 'closed'  then 'window_closed'
                                                  else 'not_open' end);
  end if;

  select * into r from public.loadq_raffle_round where id = rid for update;
  select * into mine from public.loadq_raffle_entry where round_id = r.id and driver_id = uid;

  if phase = 'checkin' then
    if mine.id is not null then return jsonb_build_object('error','already_checked_in'); end if;
    if not public.loadq_raffle_eligible(uid) then return jsonb_build_object('error','not_eligible'); end if;
    if c.test_mode and not (uid = any(c.allowed_driver_ids)) then return jsonb_build_object('error','not_eligible'); end if;
    select v.id, v.seats into veh from public.vehicles v where v.driver_id = uid and v.is_active order by v.id limit 1;
    if veh.id is null then return jsonb_build_object('error','no_vehicle'); end if;
    if c.require_geofence then
      if p_lat is null or p_lng is null then return jsonb_build_object('error','location_required'); end if;
      if p_accuracy is not null and p_accuracy > c.max_gps_accuracy_m then return jsonb_build_object('error','low_gps_accuracy'); end if;
      dist := public.loadq_haversine_m(p_lat, p_lng, c.geofence_lat, c.geofence_lng);
      if dist > c.geofence_radius_m then return jsonb_build_object('error','not_at_lot','distance_m',round(dist)); end if;
    end if;
    if c.one_checkin_per_device and p_device is not null
       and exists(select 1 from public.loadq_raffle_entry e where e.round_id = r.id and e.device_id = p_device and e.driver_id <> uid) then
      return jsonb_build_object('error','duplicate_device');
    end if;
    k := encode(extensions.digest(r.seed_reveal || uid::text, 'sha256'),'hex');
    insert into public.loadq_raffle_entry(round_id, driver_id, vehicle_id, raffle_key, device_id,
          geo_lat, geo_lng, geo_accuracy_m, geo_ok, code_ok, status)
    values (r.id, uid, veh.id, k, p_device, p_lat, p_lng, p_accuracy, true, false, 'checked_in')
    on conflict (round_id, driver_id) do nothing returning id into new_id;
    if new_id is null then return jsonb_build_object('error','already_checked_in'); end if;
    return jsonb_build_object('ok',true,'registered',true,'checked_in',true,'entry_id',new_id,
      'provisional_position', null,
      'entrant_count',(select count(*) from public.loadq_raffle_entry where round_id = r.id),
      'note','Checked in. The draw opens at '||to_char(r.draw_opens_at at time zone c.timezone,'HH24:MI')||' — come back and draw your number with the code of the day.');
  end if;

  if mine.id is null then return jsonb_build_object('error','not_checked_in'); end if;
  -- Still at the lot? Check-in proved arrival; this proves you did not drive off and
  -- draw on a code someone texted you. (A simulation on 2026-11-19 drew successfully
  -- from 55 km away because this check was missing.)
  if c.require_geofence then
    if p_lat is null or p_lng is null then return jsonb_build_object('error','location_required'); end if;
    if p_accuracy is not null and p_accuracy > c.max_gps_accuracy_m then return jsonb_build_object('error','low_gps_accuracy'); end if;
    dist := public.loadq_haversine_m(p_lat, p_lng, c.geofence_lat, c.geofence_lng);
    if dist > c.geofence_radius_m then return jsonb_build_object('error','not_at_lot','distance_m',round(dist)); end if;
  end if;
  if mine.assigned_number is not null then return jsonb_build_object('error','already_raffled','assigned_number',mine.assigned_number); end if;
  if c.require_code and not (p_code is not null and btrim(p_code) = r.code) then return jsonb_build_object('error','bad_code'); end if;

  ticket := public.loadq_raffle_ticket(r.id);
  update public.loadq_raffle_entry
     set assigned_number = ticket, drawn_at = now(), code_ok = true, status = 'drawn'
   where id = mine.id;

  if not c.test_mode then
    perform set_config('loadq.raffle_insert', '1', true);
    delete from public.queue_entries where driver_id = uid and status <> 'ended';
    insert into public.queue_entries(zone_id, driver_id, vehicle_id, position, status,
          destination_region, seats_boarded, seats_locked, seat_states, joined_at)
    values (r.zone_id, uid, mine.vehicle_id, ticket, 'waiting', r.destination_region, 0, 0, '[]'::jsonb, now());
    -- No loading during the draw: everyone waits; finalize at 07:00 starts the lowest number.
  end if;

  return jsonb_build_object('ok',true,'registered',true,'entry_id',mine.id,
    'provisional_position',ticket, 'assigned_number',ticket,'final',true,
    'entrant_count',(select count(*) from public.loadq_raffle_entry where round_id = r.id and assigned_number is not null),
    'note','Your number is '||ticket||' — you are #'||ticket||' on the line.');
end 
$fn$;
