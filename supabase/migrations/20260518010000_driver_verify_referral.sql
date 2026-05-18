-- P53: driver verification gate + QR referral waiver.
-- - drivers.verified         : admin one-time verification flag (join gate)
-- - drivers.waiver_months    : banked free months (lifetime-capped at 1)
-- - drivers.waiver_until      : active free-access window (set lazily by app)
-- - drivers.referral_waiver_granted : lifetime guard so the waiver is earned once
-- - passengers.referred_by    : the driver whose QR the passenger signed up with

alter table public.drivers   add column if not exists verified                boolean     not null default false;
alter table public.drivers   add column if not exists waiver_months           int         not null default 0;
alter table public.drivers   add column if not exists waiver_until            timestamptz;
alter table public.drivers   add column if not exists referral_waiver_granted boolean     not null default false;

alter table public.passengers add column if not exists referred_by uuid references public.drivers(id) on delete set null;
create index if not exists passengers_referred_by_idx on public.passengers (referred_by);

-- Safe, anon-callable driver card for the QR verification screen. A passenger
-- who has NOT signed up yet has no auth, so direct table reads are blocked by
-- RLS; this exposes only non-sensitive fields + the active vehicle.
create or replace function public.driver_card(p_id uuid)
returns table (
  id uuid, full_name text, verified boolean, trust_score numeric,
  vehicle_make text, vehicle_model text, vehicle_plate text,
  vehicle_type text, vehicle_seats int
)
language sql stable security definer set search_path = public as $$
  select d.id, d.full_name, d.verified, d.trust_score,
         v.make, v.model, v.plate, v.type::text, v.seats
  from public.drivers d
  left join lateral (
    select make, model, plate, type, seats
    from public.vehicles
    where driver_id = d.id and is_active = true
    order by created_at desc limit 1
  ) v on true
  where d.id = p_id;
$$;
revoke all on function public.driver_card(uuid) from public;
grant execute on function public.driver_card(uuid) to anon, authenticated;

-- Referral progress for the signed-in driver (drives the QR/referral screen).
create or replace function public.my_referral_progress()
returns table (referred_total int, qualified int, waiver_until timestamptz, waiver_months int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.passengers where referred_by = auth.uid()),
    (select count(*)::int from (
       select p.id from public.passengers p
       where p.referred_by = auth.uid()
         and (select count(*) from public.trips t where t.passenger_id = p.id) >= 3
     ) q),
    (select waiver_until  from public.drivers where id = auth.uid()),
    (select waiver_months from public.drivers where id = auth.uid());
$$;
revoke all on function public.my_referral_progress() from public;
grant execute on function public.my_referral_progress() to authenticated;

-- Waiver rule: 10 referred passengers who have EACH completed >= 3 trips
-- (any driver). Lifetime-capped at one free month via referral_waiver_granted.
-- Re-evaluated whenever a trip is logged.
create or replace function public.evaluate_referral_waiver()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_driver    uuid;
  v_qualified int;
begin
  select referred_by into v_driver from public.passengers where id = NEW.passenger_id;
  if v_driver is null then
    return NEW;
  end if;

  if (select referral_waiver_granted from public.drivers where id = v_driver) then
    return NEW;
  end if;

  select count(*) into v_qualified from (
    select p.id from public.passengers p
    where p.referred_by = v_driver
      and (select count(*) from public.trips t where t.passenger_id = p.id) >= 3
  ) q;

  if v_qualified >= 10 then
    update public.drivers
       set referral_waiver_granted = true,
           waiver_months           = least(waiver_months + 1, 1)
     where id = v_driver;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trips_referral_waiver on public.trips;
create trigger trips_referral_waiver
  after insert on public.trips
  for each row execute function public.evaluate_referral_waiver();

-- Admins flip the verification flag for a driver. RLS only allows self-update,
-- so this SECURITY DEFINER RPC is the only sanctioned write path.
create or replace function public.set_driver_verified(p_id uuid, p_val boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;
  update public.drivers set verified = p_val where id = p_id;
end;
$$;
revoke all on function public.set_driver_verified(uuid, boolean) from public;
grant execute on function public.set_driver_verified(uuid, boolean) to authenticated;
