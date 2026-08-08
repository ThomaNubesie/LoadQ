-- Admin "relocate" powers: move a DRIVER between zones/destinations, or move a
-- PASSENGER to a different driver's van. Both admin-gated (loadq_is_admin) and
-- SECURITY DEFINER, reusing the existing renumber machinery so the
-- (zone, dest, position) unique index is never tripped.
-- (Applied to the remote via MCP on 2026-08-08; backfilled here for the repo.)

-- ── Move a driver to a different zone and/or destination ────────────────────
-- Keeps the SAME queue_entries row (so any riders that travel with the van keep
-- their claims/trips). Passenger handling: p_release_passengers overrides; when
-- null it auto-decides — a pure zone move carries riders along, a destination
-- change releases them (their booked route no longer exists).
create or replace function public.loadq_admin_relocate_driver(
  p_entry_id           uuid,
  p_new_zone           text,
  p_new_dest           text,
  p_new_pos            int     default null,
  p_release_passengers boolean default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  r         public.queue_entries;
  v_release boolean;
  old_ids   uuid[];
  new_ids   uuid[];
  n int; np int;
begin
  if not public.loadq_is_admin() then raise exception 'not authorized'; end if;

  select * into r from public.queue_entries where id = p_entry_id;
  if r.id is null then raise exception 'entry not found'; end if;
  if r.status not in ('loading','waiting','standby') then
    raise exception 'driver is not active in a line';
  end if;

  -- Same target line → just reposition.
  if p_new_zone = r.zone_id and (p_new_dest is not distinct from r.destination_region) then
    perform public.loadq_admin_move(p_entry_id, coalesce(p_new_pos, 2147483647));
    return;
  end if;

  if exists (select 1 from public.queue_entries
             where zone_id = p_new_zone and (destination_region is not distinct from p_new_dest)
               and driver_id = r.driver_id and status in ('loading','waiting','standby')
               and id <> p_entry_id) then
    raise exception 'driver already in the target line';
  end if;

  v_release := coalesce(p_release_passengers, (p_new_dest is distinct from r.destination_region));

  if v_release then
    delete from public.trips where queue_entry_id = p_entry_id;
    update public.seat_claims set status = 'cancelled', cancelled_at = now()
      where queue_entry_id = p_entry_id and status in ('pending','confirmed');
    update public.queue_entries
       set seats_boarded = 0, seats_locked = 0,
           seat_states = case
             when seat_states is not null and jsonb_typeof(seat_states) = 'array'
             then (select jsonb_agg('empty'::jsonb) from jsonb_array_elements(seat_states))
             else seat_states end
     where id = p_entry_id;
  end if;

  -- Move the entry in place, parking its position in the high range.
  update public.queue_entries
     set zone_id = p_new_zone, destination_region = p_new_dest,
         position = 1000000 + floor(random()*900000)::int
   where id = p_entry_id;

  -- Close the gap in the OLD sub-queue.
  select array_agg(id order by position) into old_ids from public.queue_entries
   where zone_id = r.zone_id and (destination_region is not distinct from r.destination_region)
     and status in ('loading','waiting','standby');
  perform public.loadq_admin_renumber(r.zone_id, r.destination_region, coalesce(old_ids, '{}'::uuid[]));

  -- Insert into the NEW sub-queue at p_new_pos (or the end).
  select array_agg(id order by position) into new_ids from public.queue_entries
   where zone_id = p_new_zone and (destination_region is not distinct from p_new_dest)
     and status in ('loading','waiting','standby') and id <> p_entry_id;
  new_ids := coalesce(new_ids, '{}'::uuid[]);
  n  := coalesce(array_length(new_ids, 1), 0);
  np := greatest(1, least(coalesce(p_new_pos, n + 1), n + 1));
  new_ids := new_ids[1:np-1] || p_entry_id || new_ids[np:];
  perform public.loadq_admin_renumber(p_new_zone, p_new_dest, new_ids);
end; $$;

-- ── Move a passenger to a different driver's van ────────────────────────────
-- Releases the passenger's current reservation (frees the old seat, drops the
-- old trip) then books a confirmed seat on the target driver's queue entry,
-- carrying the previously-paid fare / seat count forward.
create or replace function public.loadq_admin_relocate_passenger(
  p_passenger_id   uuid,
  p_target_entry_id uuid,
  p_seats          int default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  t        public.queue_entries;
  v_price  numeric;
  v_seats  int;
  v_pay    text;
  v_status text;
  v_states jsonb;
  v_idx    int;
  n_seats  int;
  i        int;
begin
  if not public.loadq_is_admin() then raise exception 'not authorized'; end if;

  select * into t from public.queue_entries where id = p_target_entry_id;
  if t.id is null then raise exception 'target entry not found'; end if;
  if t.status not in ('loading','waiting','standby') then
    raise exception 'target driver is not active';
  end if;

  -- Carry forward the passenger's existing reservation details, if any.
  select price_paid, seats, pay_mode, status
    into v_price, v_seats, v_pay, v_status
    from public.trips where passenger_id = p_passenger_id
   order by created_at desc limit 1;

  n_seats := greatest(coalesce(nullif(p_seats, 0), v_seats, 1), 1);

  -- Release current reservation(s): frees old seats + removes old trips.
  perform public.admin_cancel_passenger_claims(p_passenger_id);

  -- Occupy n_seats on the target van.
  select seat_states into v_states from public.queue_entries where id = p_target_entry_id for update;
  for i in 1 .. n_seats loop
    if v_states is not null and jsonb_typeof(v_states) = 'array' then
      select g.i into v_idx from generate_series(0, jsonb_array_length(v_states) - 1) as g(i)
       where v_states ->> g.i = 'empty' limit 1;
      if v_idx is null then raise exception 'target van is full'; end if;
      v_states := jsonb_set(v_states, array[v_idx::text], '"locked"'::jsonb);
    end if;
  end loop;

  update public.queue_entries
     set seats_locked = coalesce(seats_locked, 0) + n_seats,
         seat_states  = coalesce(v_states, seat_states)
   where id = p_target_entry_id;

  insert into public.seat_claims (passenger_id, queue_entry_id, status, claimed_at, confirmed_at)
  values (p_passenger_id, p_target_entry_id, 'confirmed', now(), now());

  insert into public.trips
    (passenger_id, driver_id, queue_entry_id, zone_id, destination_region, price_paid, seats, pay_mode, status, created_at)
  values
    (p_passenger_id, t.driver_id, p_target_entry_id, t.zone_id, t.destination_region,
     coalesce(v_price, 0), n_seats, v_pay, coalesce(v_status, 'held'), now());
end; $$;

grant execute on function public.loadq_admin_relocate_driver(uuid, text, text, int, boolean) to authenticated;
grant execute on function public.loadq_admin_relocate_passenger(uuid, uuid, int) to authenticated;

notify pgrst, 'reload schema';
