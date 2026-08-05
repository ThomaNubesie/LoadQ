-- LoadQ passenger board upgrades (applied via MCP; recorded here for traceability):
--  • Driver Interac fields (passengers pay the driver directly).
--  • Reserve hold 10 → 15 minutes.
--  • loadq_update_reservation_seats(): add/decrease seats on a held reservation.
--  • loadq_my_trip(): add driver phone/Interac + pickup-zone location.
--  • loadq_city_zones(region): active zones in a city with live car counts, busiest first.
--  • trips → alerts trigger: "reservation_sent" on hold, "driver_accepted" on board.

alter table public.drivers add column if not exists interac_email text;
alter table public.drivers add column if not exists interac_phone text;

create or replace function public.loadq_reserve_seat(p_queue_entry_id uuid, p_seats integer default 1)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare qe public.queue_entries; v public.vehicles; v_left int; v_trip uuid; v_hold timestamptz; v_fare numeric;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into qe from public.queue_entries where id=p_queue_entry_id for update;
  if qe.id is null then raise exception 'car_not_found'; end if;
  if qe.status <> 'loading' then raise exception 'not_loading_car'; end if;
  select * into v from public.vehicles where id=qe.vehicle_id;
  v_left := coalesce(v.seats,0) - coalesce(qe.seats_locked,0);
  if p_seats < 1 or p_seats > v_left then raise exception 'seats_full'; end if;
  if exists(select 1 from public.trips where passenger_id=auth.uid() and queue_entry_id=p_queue_entry_id and status in ('held','boarded')) then
    raise exception 'already_reserved';
  end if;
  select coalesce(
    (select f.fare_cents::numeric/100 from public.loadq_route_fares f
       where f.zone_id=qe.zone_id and f.destination_region=qe.destination_region),
    (select max(t.price_paid) from public.trips t
       where t.zone_id=qe.zone_id and t.destination_region=qe.destination_region and t.price_paid is not null)
  ) into v_fare;
  if v_fare is null then raise exception 'route_not_priced'; end if;
  v_hold := now() + interval '15 minutes';
  insert into public.trips (passenger_id, driver_id, zone_id, queue_entry_id, destination_region, seats, pay_mode, status, hold_expires_at, price_paid)
  values (auth.uid(), qe.driver_id, qe.zone_id, p_queue_entry_id, qe.destination_region, p_seats, 'on_board', 'held', v_hold, v_fare)
  returning id into v_trip;
  update public.queue_entries set seats_locked = coalesce(seats_locked,0) + p_seats where id=p_queue_entry_id;
  return json_build_object('trip_id',v_trip,'hold_expires_at',v_hold,'seats',p_seats,'seats_left',v_left-p_seats);
end $function$;

create or replace function public.loadq_update_reservation_seats(p_trip_id uuid, p_seats integer)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare tr public.trips; qe public.queue_entries; v public.vehicles; v_delta int; v_avail int;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_seats < 1 then raise exception 'min_one_seat'; end if;
  select * into tr from public.trips where id=p_trip_id and passenger_id=auth.uid() for update;
  if tr.id is null then raise exception 'trip_not_found'; end if;
  if tr.status <> 'held' then raise exception 'not_held'; end if;
  select * into qe from public.queue_entries where id=tr.queue_entry_id for update;
  select * into v from public.vehicles where id=qe.vehicle_id;
  v_delta := p_seats - tr.seats;
  v_avail := coalesce(v.seats,0) - coalesce(qe.seats_locked,0);
  if v_delta > v_avail then raise exception 'seats_full'; end if;
  update public.trips set seats=p_seats where id=tr.id;
  update public.queue_entries set seats_locked = greatest(0, coalesce(seats_locked,0) + v_delta) where id=qe.id;
  return json_build_object('trip_id',tr.id,'seats',p_seats,'seats_left', v_avail - v_delta);
end $function$;

create or replace function public.loadq_my_trip()
returns json language sql stable security definer set search_path to 'public' as $function$
  select row_to_json(t) from (
    select tr.id as trip_id, tr.status, tr.seats, tr.pay_mode, tr.hold_expires_at,
           tr.destination_region, tr.zone_id, tr.price_paid,
           qe.id as queue_entry_id, qe.position, qe.status as car_status, qe.load_deadline,
           d.id as driver_id, d.full_name as driver_name, d.phone as driver_phone,
           d.interac_email as driver_interac_email, d.interac_phone as driver_interac_phone,
           d.rating_avg, d.avatar_url,
           v.make, v.model, v.plate, v.type, v.seats as vehicle_seats,
           z.name as zone_name, z.address as zone_address, z.latitude as zone_lat, z.longitude as zone_lng
    from public.trips tr
    join public.queue_entries qe on qe.id=tr.queue_entry_id
    join public.drivers d on d.id=tr.driver_id
    left join public.vehicles v on v.id=qe.vehicle_id
    left join public.zones z on z.id=tr.zone_id
    where tr.passenger_id=auth.uid() and tr.status in ('held','boarded')
    order by tr.created_at desc limit 1) t;
$function$;

create or replace function public.loadq_city_zones(p_region text)
returns json language sql stable security definer set search_path to 'public' as $function$
  select coalesce(json_agg(row_to_json(z) order by z.car_count desc, z.name), '[]'::json)
  from (
    select zn.id, zn.name, zn.region, zn.latitude, zn.longitude, zn.address,
      (select count(*) from public.queue_entries qe where qe.zone_id=zn.id and qe.status in ('waiting','loading'))::int as car_count,
      exists(select 1 from public.queue_entries qe where qe.zone_id=zn.id and qe.status='loading') as has_loading
    from public.zones zn
    where zn.is_active and zn.region = p_region
  ) z;
$function$;

create or replace function public.loadq_trip_alert() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if TG_OP='INSERT' and NEW.status='held' then
    insert into public.alerts(user_id, kind, title, body, ref)
    select NEW.passenger_id, 'reservation_sent', 'Reservation sent',
           'Your seat request was sent to the driver. You have 15 minutes to board.', NEW.id::text||':sent'
    where not exists (select 1 from public.alerts a where a.user_id=NEW.passenger_id and a.ref=NEW.id::text||':sent');
  elsif TG_OP='UPDATE' and NEW.status='boarded' and OLD.status='held' then
    insert into public.alerts(user_id, kind, title, body, ref)
    select NEW.passenger_id, 'driver_accepted', 'Driver confirmed you',
           'The driver accepted your seats. Have a safe trip!', NEW.id::text||':accepted'
    where not exists (select 1 from public.alerts a where a.user_id=NEW.passenger_id and a.ref=NEW.id::text||':accepted');
  end if;
  return NEW;
end $function$;

drop trigger if exists loadq_trip_alert_trg on public.trips;
create trigger loadq_trip_alert_trg
  after insert or update on public.trips
  for each row execute function public.loadq_trip_alert();

grant execute on function public.loadq_update_reservation_seats(uuid,integer) to authenticated;
grant execute on function public.loadq_city_zones(text) to authenticated;
