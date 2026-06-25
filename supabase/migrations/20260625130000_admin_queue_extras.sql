-- Admin queue extras:
--   1) Per-entry loading-time override (load_minutes_override) the admin pins
--      when adding a driver — wins over the zone default when loading starts.
--   2) loadq_admin_add gains p_minutes to set that override on insert.
--   3) loadq_set_queue_window — admin-gated setter for public.queue_window.

alter table public.queue_entries add column if not exists load_minutes_override int;

-- Add a driver to the line at a position (or at the end when p_pos is null),
-- optionally pinning a per-entry loading time (p_minutes). Keeps the existing
-- collision-safe renumber behaviour from the original definition.
create or replace function public.loadq_admin_add(p_zone text, p_dest text, p_driver_id uuid, p_pos int default null, p_minutes int default null)
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
  insert into public.queue_entries (zone_id, driver_id, vehicle_id, destination_region, status, position, load_minutes_override)
  values (p_zone, p_driver_id, v, p_dest, 'waiting', 1000000 + floor(random()*900000)::int, p_minutes)
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

-- Admin-gated setter for the daily queue window (single row id=1).
create or replace function public.loadq_set_queue_window(p_register int, p_load int, p_close int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.loadq_is_admin() then raise exception 'not authorized'; end if;
  update public.queue_window
     set register_open_hour = p_register,
         load_open_hour     = p_load,
         close_hour         = p_close
   where id = 1;
end; $$;

grant execute on function public.loadq_admin_add(text, text, uuid, int, int) to authenticated;
grant execute on function public.loadq_set_queue_window(int, int, int) to authenticated;
