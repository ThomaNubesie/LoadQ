-- A7 passenger status reader — own recent ride requests + matched driver/vehicle.
-- (Applied to remote via MCP 2026-08-10; backfilled here.)
drop function if exists public.loadq_my_ride_requests();
create or replace function public.loadq_my_ride_requests()
returns table(
  id uuid, kind text, status text, payment_status text, payment_method text,
  pickup_label text, origin_address text, dest_region text, dest_address text,
  fare_cents int, pay_ref text, driver_id uuid,
  driver_name text, driver_phone text,
  vehicle_make text, vehicle_model text, vehicle_color text, vehicle_plate text, vehicle_seats int,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.status, r.payment_status, r.payment_method,
         r.pickup_label, r.origin_address, r.dest_region, r.dest_address,
         r.fare_cents, r.pay_ref, r.driver_id, d.full_name, d.phone,
         v.make, v.model, v.color, v.plate, v.seats, r.created_at
  from public.loadq_ride_requests r
  left join public.drivers d on d.id = r.driver_id
  left join lateral (
    select make, model, color, plate, seats from public.vehicles
    where driver_id = r.driver_id order by is_active desc nulls last limit 1
  ) v on true
  where r.passenger_id = auth.uid()
  order by r.created_at desc limit 10;
$$;
grant execute on function public.loadq_my_ride_requests() to authenticated;
