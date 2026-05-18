-- Passenger user type and trip log.
-- Passengers are a separate account class from drivers (no overlap).
-- A trip row is created when a passenger boards a driver's van.

create table if not exists public.passengers (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  phone          text,
  email          text,
  avatar_url     text,
  created_at     timestamptz not null default now()
);

create index if not exists passengers_phone_idx on public.passengers (phone);
create index if not exists passengers_email_idx on public.passengers (email);

alter table public.passengers enable row level security;

drop policy if exists "passenger reads self" on public.passengers;
create policy "passenger reads self"
  on public.passengers for select to authenticated
  using (id = auth.uid());

drop policy if exists "passenger upserts self" on public.passengers;
create policy "passenger upserts self"
  on public.passengers for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "passenger updates self" on public.passengers;
create policy "passenger updates self"
  on public.passengers for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Drivers can read passenger profile when looking at someone in their van.
drop policy if exists "drivers read passengers" on public.passengers;
create policy "drivers read passengers"
  on public.passengers for select to authenticated
  using (exists (select 1 from public.drivers d where d.id = auth.uid()));

-- Trip log: one row per passenger boarding event.
create table if not exists public.trips (
  id                 uuid primary key default gen_random_uuid(),
  passenger_id      uuid not null references public.passengers(id) on delete cascade,
  driver_id         uuid not null references public.drivers(id)    on delete restrict,
  queue_entry_id    uuid          references public.queue_entries(id) on delete set null,
  zone_id           text not null,
  destination_region text not null,
  price_paid        numeric not null,
  created_at        timestamptz not null default now()
);

create index if not exists trips_passenger_created_idx on public.trips (passenger_id, created_at desc);
create index if not exists trips_zone_created_idx     on public.trips (zone_id, created_at desc);
create index if not exists trips_driver_created_idx   on public.trips (driver_id, created_at desc);

alter table public.trips enable row level security;

-- Passenger can read their own trips.
drop policy if exists "passenger reads own trips" on public.trips;
create policy "passenger reads own trips"
  on public.trips for select to authenticated
  using (passenger_id = auth.uid());

-- Driver can read trips they hosted.
drop policy if exists "driver reads own trips" on public.trips;
create policy "driver reads own trips"
  on public.trips for select to authenticated
  using (driver_id = auth.uid());

-- Anyone authenticated can read aggregate stats. We use a view for "network"
-- analytics that exposes only counts and aggregates, never personal ids.
drop view if exists public.network_trip_stats;
create view public.network_trip_stats as
select
  zone_id,
  destination_region,
  date_trunc('day', created_at) as day,
  count(*)             as trip_count,
  sum(price_paid)      as gross,
  avg(price_paid)      as avg_price
from public.trips
where created_at >= now() - interval '7 days'
group by zone_id, destination_region, date_trunc('day', created_at);

grant select on public.network_trip_stats to authenticated;

-- Driver inserts a trip row when marking a passenger boarded.
drop policy if exists "driver inserts trips" on public.trips;
create policy "driver inserts trips"
  on public.trips for insert to authenticated
  with check (driver_id = auth.uid()
              and exists (select 1 from public.drivers d where d.id = auth.uid()));
