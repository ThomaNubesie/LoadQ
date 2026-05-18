-- Per-route queues: each entry tracks where the driver is going.
-- Positions are now scoped per (zone_id, destination_region).

alter table public.queue_entries
  add column if not exists destination_region text;

-- Helpful index for the position math the app and watchdog do
-- (`order by position desc limit 1` filtered on these two columns).
create index if not exists queue_entries_zone_dest_position_idx
  on public.queue_entries (zone_id, destination_region, position desc);
