-- Stripe checkout / subscription tracking on the drivers table.
-- The driver subscription flow uses an external Stripe Checkout page hosted
-- on loadq.ca (Apple 3.1.5(a) real-world service path: app deep-links to
-- web checkout, web processes Stripe Checkout, Stripe webhook updates these
-- columns). The existing subscription_status / trial_ends_at / grace_ends_at
-- / subscription_ends_at columns remain the source of truth for access
-- gating in services/drivers.ts hasActiveSubscription(); the Stripe IDs
-- below let the webhook handler upsert against a known customer/subscription
-- without an extra lookup table.

alter table public.drivers
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;

create index if not exists drivers_stripe_customer_idx
  on public.drivers (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists drivers_stripe_subscription_idx
  on public.drivers (stripe_subscription_id)
  where stripe_subscription_id is not null;
