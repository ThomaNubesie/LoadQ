-- SECURITY FIX (2026-06-15): authorization was enforced only in the client.
-- The drivers UPDATE policy (auth.uid() = id, no column restriction) let any
-- signed-in driver self-grant a subscription, self-verify, self-promote to
-- admin, or hand themselves a referral waiver via a single direct API call.
-- queue_entries had no entitlement gate at all, so the client-side canJoin()
-- check could be skipped entirely with a direct insert.
--
-- This migration moves the guards into the database:
--   1. A BEFORE UPDATE trigger on drivers pins privileged columns to their
--      existing values for ordinary self-updates (profile edits still work).
--      Only the service role (Stripe webhook / cron — no end-user JWT) and
--      admins may change them. A SECURITY DEFINER helper can opt in per-txn
--      via the loadq.priv_write flag.
--   2. loadq_consume_waiver(): the one legitimate client write to a protected
--      column (banked referral month) moves to a SECURITY DEFINER RPC.
--   3. A BEFORE INSERT trigger on queue_entries rejects joining unless the
--      driver is verified and not blocked. (The subscription portion of the
--      gate is intentionally NOT enforced here yet: RevenueCat store
--      entitlement lives only in the client until a RevenueCat webhook syncs
--      it to the DB, so a DB-level subscription gate would wrongly block
--      legitimately-paid iOS drivers. Tracked as follow-up.)

-- ── 1. Privileged-column guard on drivers ──────────────────────────────────
create or replace function public.drivers_guard_privileged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / cron / webhook (no end-user JWT) may change anything.
  if auth.uid() is null then
    return new;
  end if;
  -- Admins may change anything.
  if exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin) then
    return new;
  end if;
  -- A SECURITY DEFINER helper can opt into a privileged write for this txn.
  -- Ordinary PostgREST requests cannot set this GUC (each request is its own
  -- transaction and no generic set_config RPC is exposed), so it is not
  -- forgeable by a client.
  if current_setting('loadq.priv_write', true) = '1' then
    return new;
  end if;
  -- Otherwise: pin every privileged column to its current value. Profile
  -- fields (name, phone, avatar, dob, sex, push_token, location, …) are left
  -- untouched so normal self-updates keep working.
  new.subscription_status     := old.subscription_status;
  new.subscription_plan       := old.subscription_plan;
  new.trial_ends_at           := old.trial_ends_at;
  new.grace_ends_at           := old.grace_ends_at;
  new.subscription_ends_at    := old.subscription_ends_at;
  new.stripe_customer_id      := old.stripe_customer_id;
  new.stripe_subscription_id  := old.stripe_subscription_id;
  new.verified                := old.verified;
  new.is_admin                := old.is_admin;
  new.blocked                 := old.blocked;
  new.trust_score             := old.trust_score;
  new.waiver_months           := old.waiver_months;
  new.waiver_until            := old.waiver_until;
  new.referral_waiver_granted := old.referral_waiver_granted;
  return new;
end; $$;

drop trigger if exists drivers_guard_privileged_trg on public.drivers;
create trigger drivers_guard_privileged_trg
  before update on public.drivers
  for each row execute function public.drivers_guard_privileged();

-- ── 2. Server-side waiver consumption ──────────────────────────────────────
-- Starts a banked referral free month. Replaces the client-side direct write
-- to waiver_until/waiver_months (services/drivers.ts hasActiveSubscription).
create or replace function public.loadq_consume_waiver()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.drivers;
begin
  select * into d from public.drivers where id = auth.uid();
  if d.id is null then return false; end if;
  -- Already inside a running waiver → access already granted.
  if d.waiver_until is not null and d.waiver_until > now() then
    return true;
  end if;
  -- Nothing banked → no access from this path.
  if coalesce(d.waiver_months, 0) <= 0 then
    return false;
  end if;
  perform set_config('loadq.priv_write', '1', true);  -- allow the guarded write
  update public.drivers
     set waiver_until  = now() + interval '30 days',
         waiver_months = 0
   where id = auth.uid();
  return true;
end; $$;

grant execute on function public.loadq_consume_waiver() to authenticated;

-- ── 3. Eligibility gate on queue_entries (verified + not blocked) ──────────
create or replace function public.queue_entries_require_eligible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.drivers;
begin
  -- Service role / cron may write freely (watchdog promotion, purges).
  if auth.uid() is null then
    return new;
  end if;
  -- Admins may place/adjust entries on a driver's behalf.
  if exists (select 1 from public.drivers a where a.id = auth.uid() and a.is_admin) then
    return new;
  end if;
  select * into d from public.drivers where id = new.driver_id;
  if d.id is null then
    raise exception 'driver profile required to join the queue';
  end if;
  if d.blocked then
    raise exception 'account is blocked';
  end if;
  if not coalesce(d.verified, false) then
    raise exception 'account must be verified to join the queue';
  end if;
  return new;
end; $$;

drop trigger if exists queue_entries_require_eligible_trg on public.queue_entries;
create trigger queue_entries_require_eligible_trg
  before insert on public.queue_entries
  for each row execute function public.queue_entries_require_eligible();
