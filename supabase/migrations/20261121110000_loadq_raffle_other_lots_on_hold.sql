-- Raffle on hold everywhere except Universal Grocery (Thomas, 2026-11-21). enabled=false
-- means: no 05:00 round, no code picture, no 06:01 code text, no line clear, and the
-- lot is not offered in the app. Settings, admins and code recipients are kept —
-- re-enable a lot with:
--   update loadq_raffle_config set enabled = true where zone_id = '<zone>';
update public.loadq_raffle_config set enabled = false where zone_id <> 'ottawa-universal-grocery';
