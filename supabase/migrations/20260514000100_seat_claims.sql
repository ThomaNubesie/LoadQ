-- Passenger-initiated seat claims. Workflow:
--   1. Passenger taps "Claim seat" on a driver's loading card → row inserted, status='pending'
--   2. Driver sees pending claim, confirms → status='confirmed', trip row created, seat count incremented
--   3. Driver can reject → status='rejected'
--   4. Passenger can cancel before confirmation → status='cancelled'

create table if not exists public.seat_claims (
  id              uuid primary key default gen_random_uuid(),
  passenger_id    uuid not null references public.passengers(id) on delete cascade,
  queue_entry_id  uuid not null references public.queue_entries(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','confirmed','rejected','cancelled')),
  claimed_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  rejected_at     timestamptz,
  cancelled_at    timestamptz
);

create index if not exists seat_claims_entry_status_idx on public.seat_claims (queue_entry_id, status);
create index if not exists seat_claims_passenger_idx    on public.seat_claims (passenger_id, status);

-- Only one PENDING claim per (passenger, queue_entry) at a time.
create unique index if not exists seat_claims_one_pending_per_passenger_idx
  on public.seat_claims (passenger_id, queue_entry_id)
  where status = 'pending';

alter table public.seat_claims enable row level security;

-- Passenger reads & manages their own claims.
drop policy if exists "passenger reads own claims" on public.seat_claims;
create policy "passenger reads own claims"
  on public.seat_claims for select to authenticated
  using (passenger_id = auth.uid());

drop policy if exists "passenger inserts own claim" on public.seat_claims;
create policy "passenger inserts own claim"
  on public.seat_claims for insert to authenticated
  with check (passenger_id = auth.uid());

drop policy if exists "passenger cancels own claim" on public.seat_claims;
create policy "passenger cancels own claim"
  on public.seat_claims for update to authenticated
  using (passenger_id = auth.uid() and status = 'pending')
  with check (passenger_id = auth.uid() and status = 'cancelled');

-- Driver sees claims for their own queue entries and can confirm/reject.
drop policy if exists "driver reads claims on own entry" on public.seat_claims;
create policy "driver reads claims on own entry"
  on public.seat_claims for select to authenticated
  using (exists (select 1 from public.queue_entries e where e.id = queue_entry_id and e.driver_id = auth.uid()));

drop policy if exists "driver updates claims on own entry" on public.seat_claims;
create policy "driver updates claims on own entry"
  on public.seat_claims for update to authenticated
  using      (exists (select 1 from public.queue_entries e where e.id = queue_entry_id and e.driver_id = auth.uid()))
  with check (exists (select 1 from public.queue_entries e where e.id = queue_entry_id and e.driver_id = auth.uid()));
