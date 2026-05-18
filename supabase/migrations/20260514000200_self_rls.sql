-- Make sure authenticated users can update their OWN drivers/passengers row.
-- Without this, avatar uploads silently fail at the DB-update step (the
-- storage upload succeeds, but the `update drivers set avatar_url = ...`
-- writes 0 rows because RLS blocks it).

-- Drivers: read self, insert self, update self
drop policy if exists "driver reads self" on public.drivers;
create policy "driver reads self"
  on public.drivers for select to authenticated
  using (id = auth.uid());

drop policy if exists "driver inserts self" on public.drivers;
create policy "driver inserts self"
  on public.drivers for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "driver updates self" on public.drivers;
create policy "driver updates self"
  on public.drivers for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Public read for drivers so passengers can see driver info in the queue.
drop policy if exists "anyone reads drivers" on public.drivers;
create policy "anyone reads drivers"
  on public.drivers for select to authenticated
  using (true);

alter table public.drivers enable row level security;

-- Same for passengers (already added in earlier migration but re-asserting
-- in case anything got rolled back).
drop policy if exists "passenger updates self" on public.passengers;
create policy "passenger updates self"
  on public.passengers for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
