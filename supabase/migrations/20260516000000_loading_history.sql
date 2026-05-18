-- Permanent log of every loading session (one row per driver loading stint).
-- Written when a driver departs OR the watchdog moves/removes them at the
-- 2h cap or EOD close. Kept forever; drivers see their own last 7 days,
-- admins see the entire history.

create table if not exists public.loading_history (
  id                 uuid primary key default gen_random_uuid(),
  driver_id          uuid not null references public.drivers(id) on delete cascade,
  zone_id            text not null,
  destination_region text,
  vehicle_id         uuid,
  load_start_at      timestamptz,
  ended_at           timestamptz not null default now(),
  end_reason         text not null check (end_reason in ('departed','timeout_2h','eod_close')),
  seats_filled       int  not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists loading_history_driver_ended_idx on public.loading_history (driver_id, ended_at desc);
create index if not exists loading_history_ended_idx        on public.loading_history (ended_at desc);
create index if not exists loading_history_zone_ended_idx   on public.loading_history (zone_id, ended_at desc);

alter table public.loading_history enable row level security;

-- Driver reads their own history.
drop policy if exists "driver reads own history" on public.loading_history;
create policy "driver reads own history"
  on public.loading_history for select to authenticated
  using (driver_id = auth.uid());

-- Admins read everything.
drop policy if exists "admin reads all history" on public.loading_history;
create policy "admin reads all history"
  on public.loading_history for select to authenticated
  using (exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin = true));

-- A driver can insert their own history row (on Depart).
drop policy if exists "driver inserts own history" on public.loading_history;
create policy "driver inserts own history"
  on public.loading_history for insert to authenticated
  with check (driver_id = auth.uid());
