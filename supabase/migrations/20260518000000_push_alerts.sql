-- Push notifications + in-app alert history.
--
-- Adds an Expo push token column to drivers and passengers, and an `alerts`
-- table that records every notification sent. The watchdog Edge Function
-- inserts alert rows (it runs as service_role, which bypasses RLS) and pushes
-- to the device. The (user_id, ref) unique index makes inserts idempotent:
-- the watchdog runs every minute, so `ref` dedupes a given event to one push.

alter table public.drivers    add column if not exists push_token text;
alter table public.passengers add column if not exists push_token text;

create table if not exists public.alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  kind       text not null check (kind in ('return','slot_open','moved_back','removed')),
  title      text not null,
  body       text not null,
  ref        text not null,                         -- dedupe key (one push per event)
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

-- One row per (user, event) — the watchdog upserts with ON CONFLICT DO NOTHING
-- and only pushes when a new row was actually created.
create unique index if not exists alerts_user_ref_uidx on public.alerts (user_id, ref);
create index if not exists alerts_user_created_idx on public.alerts (user_id, created_at desc);

alter table public.alerts enable row level security;

-- Each user reads only their own alerts.
drop policy if exists "user reads own alerts" on public.alerts;
create policy "user reads own alerts"
  on public.alerts for select to authenticated
  using (user_id = auth.uid());

-- Each user can mark their own alerts read.
drop policy if exists "user updates own alerts" on public.alerts;
create policy "user updates own alerts"
  on public.alerts for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());
