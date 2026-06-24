-- Fix: evaluate_referral_waiver() (grants a free subscription month once a driver
-- has 10 referred passengers who each completed 3+ trips) existed as a trigger
-- function but had NO trigger attached to any table. Result: the referral counter
-- showed progress (e.g. 10/10) but the free month was never actually granted.
-- Wire it to fire after each trip insert so the grant evaluates as referrals
-- qualify. evaluate_referral_waiver no-ops when the trip's passenger has no
-- referrer or the driver was already granted, so it's safe on every trip.
drop trigger if exists trg_evaluate_referral_waiver on public.trips;
create trigger trg_evaluate_referral_waiver
  after insert on public.trips
  for each row execute function public.evaluate_referral_waiver();
