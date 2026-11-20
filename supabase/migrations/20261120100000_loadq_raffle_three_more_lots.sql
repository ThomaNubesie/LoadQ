-- Seven raffle lots in all (Thomas, 2026-11-20): 2 Ottawa, 1 Gatineau, 2 Montréal,
-- 2 Québec City. Adds the last three, in TEST MODE, main line → Montréal, on Universal
-- Grocery's times; check-in circle = the lot's saved point + zone radius (re-centre later).
-- Other destinations at a lot keep joining normally (one raffle per lot, main line only).
insert into public.loadq_raffle_config (
  zone_id, enabled, destination_region, checkin_opens_local, checkin_closes_local, draw_opens_local,
  draw_at_local, timezone, geofence_lat, geofence_lng, geofence_radius_m, max_gps_accuracy_m,
  require_geofence, require_code, code_len, late_policy, one_checkin_per_device, max_slots,
  test_mode, allowed_driver_ids, raffle_admin_ids, lead_admin_id)
select z.id, true, 'montreal', u.checkin_opens_local, u.checkin_closes_local, u.draw_opens_local,
       u.draw_at_local, coalesce(z.timezone, u.timezone), z.latitude, z.longitude, coalesce(z.radius_meters, 300),
       u.max_gps_accuracy_m, true, u.require_code, u.code_len, u.late_policy, u.one_checkin_per_device, null,
       true, u.allowed_driver_ids, u.raffle_admin_ids, u.lead_admin_id
  from public.zones z
  cross join (select * from public.loadq_raffle_config where zone_id = 'ottawa-universal-grocery') u
 where z.id in ('ottawa-st-laurent-shopping-mall', 'gatineau-mcdonald-s-saint-raymond', 'universite-laval-pavillon-desjardins')
on conflict (zone_id) do nothing;
