-- Lets authenticated passengers read all loading_history rows so the
-- passenger History tab (added in v1.1.5) can show a board-wide activity
-- feed. The rows are post-departure events with no live location data —
-- already exposed to the driver themselves and to admins, so widening
-- read access to all authenticated users adds no new sensitive surface.

drop policy if exists "passenger reads all history" on public.loading_history;
create policy "passenger reads all history"
  on public.loading_history for select to authenticated
  using (true);
