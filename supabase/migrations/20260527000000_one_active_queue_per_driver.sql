-- P109: Defense-in-depth — a driver can only have ONE active queue entry at
-- a time, regardless of zone. Ended (historical) rows are not constrained;
-- this lets queue persistence keep yesterday's archived entries around.
-- Without this, a driver could double-register across devices or via a
-- race condition between the client check and the insert.

drop index if exists queue_entries_one_active_per_driver;

create unique index queue_entries_one_active_per_driver
  on public.queue_entries (driver_id)
  where status <> 'ended';
