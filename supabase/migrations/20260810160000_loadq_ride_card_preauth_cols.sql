-- A7 on-demand card pre-authorization (manual capture). Applied to remote via
-- MCP 2026-08-10; backfilled here.
alter table public.passengers add column if not exists stripe_customer_id text;
alter table public.loadq_ride_requests add column if not exists stripe_pi_id text;
