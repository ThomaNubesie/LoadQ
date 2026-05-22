-- P84 + P86: Admin queue operations + driver vehicle creation.

-- Admin removes a driver from the queue entirely (delete their queue_entries row).
create or replace function public.admin_remove_from_queue(
  p_entry_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;

  delete from public.queue_entries where id = p_entry_id;
end;
$func$;

grant execute on function public.admin_remove_from_queue(uuid) to authenticated;


-- Admin places a driver at the back of a zone+destination queue. Uses the
-- driver's active vehicle. Will not double-add if the driver already has a
-- queue entry anywhere.
create or replace function public.admin_add_to_queue(
  p_driver_id          uuid,
  p_zone_id            text,
  p_destination_region text
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_vehicle_id uuid;
  v_position   int;
  v_new_id     uuid;
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;

  -- Already in some queue?
  if exists (select 1 from public.queue_entries where driver_id = p_driver_id) then
    raise exception 'driver already in queue';
  end if;

  select id into v_vehicle_id
    from public.vehicles
   where driver_id = p_driver_id and is_active = true
   limit 1;
  if v_vehicle_id is null then
    raise exception 'driver has no active vehicle';
  end if;

  select coalesce(max(position), 0) + 1 into v_position
    from public.queue_entries
   where zone_id = p_zone_id and destination_region = p_destination_region;

  insert into public.queue_entries (
    zone_id, driver_id, vehicle_id, destination_region, position, status
  ) values (
    p_zone_id, p_driver_id, v_vehicle_id, p_destination_region, v_position, 'waiting'
  ) returning id into v_new_id;

  return v_new_id;
end;
$func$;

grant execute on function public.admin_add_to_queue(uuid, text, text) to authenticated;


-- P86: Admin creates a vehicle for a driver who never completed sign-up.
create or replace function public.admin_create_vehicle_for_driver(
  p_driver_id uuid,
  p_make      text,
  p_model     text,
  p_year      int,
  p_plate     text,
  p_color     text,
  p_seats     int
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_new_id uuid;
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;

  -- Deactivate any existing active vehicle so we don't end up with two actives.
  update public.vehicles set is_active = false
   where driver_id = p_driver_id and is_active = true;

  insert into public.vehicles (
    driver_id, make, model, year, plate, color, seats, is_active
  ) values (
    p_driver_id,
    nullif(trim(p_make),  ''),
    nullif(trim(p_model), ''),
    coalesce(p_year, extract(year from now())::int),
    nullif(trim(p_plate), ''),
    nullif(trim(p_color), ''),
    coalesce(p_seats, 4),
    true
  ) returning id into v_new_id;

  return v_new_id;
end;
$func$;

grant execute on function public.admin_create_vehicle_for_driver(uuid, text, text, int, text, text, int) to authenticated;

notify pgrst, 'reload schema';
