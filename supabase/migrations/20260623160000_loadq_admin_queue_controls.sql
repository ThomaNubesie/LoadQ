-- Admin queue controls: add a driver, change their queue number / reorder, and
-- mark departed — all admin-gated (drivers.is_admin) and SECURITY DEFINER so
-- they bypass RLS. They respect the unique index on
-- (zone_id, COALESCE(destination_region,''), position) by offsetting the whole
-- sub-queue into a high range before reassigning 1..n (dodges transient
-- collisions). Positions reset nightly at the midnight purge.

create or replace function public.loadq_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.drivers where id = auth.uid() and is_admin);
$$;

-- Internal: renumber a sub-queue's ACTIVE line to the given order (pos 1..n).
-- Frees the low range first so the unique index never trips.
create or replace function public.loadq_admin_renumber(p_zone text, p_dest text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare i int;
begin
  if not public.loadq_is_admin() then raise exception 'not authorized'; end if;
  update public.queue_entries
     set position = position + 1000000
   where zone_id = p_zone and (destination_region is not distinct from p_dest);
  if p_ids is not null then
    for i in 1 .. array_length(p_ids, 1) loop
      update public.queue_entries set position = i where id = p_ids[i];
    end loop;
  end if;
end; $$;

-- Move one driver to a new queue number within its sub-queue.
create or replace function public.loadq_admin_move(p_entry_id uuid, p_new_pos int)
returns void language plpgsql security definer set search_path = public as $$
declare z text; d text; ids uuid[]; n int; np int;
begin
  if not public.loadq_is_admin() then raise exception 'not authorized'; end if;
  select zone_id, destination_region into z, d from public.queue_entries where id = p_entry_id;
  if z is null then raise exception 'entry not found'; end if;
  select array_agg(id order by position) into ids from public.queue_entries
   where zone_id = z and (destination_region is not distinct from d)
     and status in ('loading','waiting','standby') and id <> p_entry_id;
  ids := coalesce(ids, '{}'::uuid[]);
  n := coalesce(array_length(ids, 1), 0);
  np := greatest(1, least(p_new_pos, n + 1));
  ids := ids[1:np-1] || p_entry_id || ids[np:];
  perform public.loadq_admin_renumber(z, d, ids);
end; $$;

-- Add a driver to the line at a position (or at the end when p_pos is null).
create or replace function public.loadq_admin_add(p_zone text, p_dest text, p_driver_id uuid, p_pos int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; new_id uuid; ids uuid[]; n int; np int;
begin
  if not public.loadq_is_admin() then raise exception 'not authorized'; end if;
  if exists(select 1 from public.queue_entries
            where zone_id = p_zone and (destination_region is not distinct from p_dest)
              and driver_id = p_driver_id and status in ('loading','waiting','standby')) then
    raise exception 'driver already in this line';
  end if;
  select id into v from public.vehicles where driver_id = p_driver_id order by is_active desc nulls last limit 1;
  insert into public.queue_entries (zone_id, driver_id, vehicle_id, destination_region, status, position)
  values (p_zone, p_driver_id, v, p_dest, 'waiting', 1000000 + floor(random()*900000)::int)
  returning id into new_id;
  select array_agg(id order by position) into ids from public.queue_entries
   where zone_id = p_zone and (destination_region is not distinct from p_dest)
     and status in ('loading','waiting','standby') and id <> new_id;
  ids := coalesce(ids, '{}'::uuid[]);
  n := coalesce(array_length(ids, 1), 0);
  np := greatest(1, least(coalesce(p_pos, n + 1), n + 1));
  ids := ids[1:np-1] || new_id || ids[np:];
  perform public.loadq_admin_renumber(p_zone, p_dest, ids);
  return new_id;
end; $$;

-- Mark a driver departed: log to history, set ended/departed (+ seats), and
-- vacate their position into the high range so it never blocks a renumber.
create or replace function public.loadq_admin_depart(p_entry_id uuid, p_seats int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare r public.queue_entries;
begin
  if not public.loadq_is_admin() then raise exception 'not authorized'; end if;
  select * into r from public.queue_entries where id = p_entry_id;
  if r.id is null then raise exception 'entry not found'; end if;
  insert into public.loading_history
    (driver_id, zone_id, destination_region, vehicle_id, load_start_at, ended_at, end_reason, seats_filled)
  values (r.driver_id, r.zone_id, r.destination_region, r.vehicle_id, r.load_start_at, now(), 'departed', coalesce(p_seats, 0));
  update public.queue_entries
     set status = 'ended', end_reason = 'departed',
         seats_boarded = coalesce(p_seats, seats_boarded),
         position = position + 1000000
   where id = p_entry_id;
end; $$;

grant execute on function public.loadq_is_admin() to authenticated;
grant execute on function public.loadq_admin_renumber(text, text, uuid[]) to authenticated;
grant execute on function public.loadq_admin_move(uuid, int) to authenticated;
grant execute on function public.loadq_admin_add(text, text, uuid, int) to authenticated;
grant execute on function public.loadq_admin_depart(uuid, int) to authenticated;
