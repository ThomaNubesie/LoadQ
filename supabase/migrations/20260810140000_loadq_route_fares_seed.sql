-- Populate loadq_route_fares (per departure zone → destination) from the real
-- city-pair seat prices used app-side (constants/pricing.ts ROUTES). Zone region
-- → origin city (gatineau→ottawa, laval→montreal, etc.). Applied to remote via
-- MCP 2026-08-10; backfilled here. Idempotent (upsert).
insert into public.loadq_route_fares (zone_id, destination_region, fare_cents)
select z.zone_id, f.dest, f.cents
from (values
  ('gatineau-mcdonald-s-saint-raymond','ottawa'),
  ('ottawa-st-laurent-shopping-mall','ottawa'),
  ('ottawa-universal-grocery','ottawa'),
  ('montreal-berri-uquam-metro-station-sainte-catheri','montreal'),
  ('montreal-burger-king','montreal'),
  ('quebec-mcdonald-s-blvd-laurier','quebec'),
  ('quebec-shell-laurier','quebec'),
  ('universite-laval-pavillon-desjardins','quebec'),
  ('toronto-scarborough','toronto'),
  ('toronto-union','toronto'),
  ('toronto-yorkdale','toronto')
) as z(zone_id, origin_city)
join (values
  ('ottawa','montreal',3000),('ottawa','toronto',6000),('ottawa','kingston',3000),('ottawa','quebec',6500),('ottawa','chicoutimi',9500),('ottawa','moncton',16500),('ottawa','trois-rivieres',5000),('ottawa','sherbrooke',5000),
  ('montreal','ottawa',3000),('montreal','quebec',3500),('montreal','toronto',8000),('montreal','kingston',4000),('montreal','chicoutimi',6500),('montreal','moncton',14000),('montreal','trois-rivieres',2000),('montreal','sherbrooke',2000),
  ('quebec','montreal',3500),('quebec','ottawa',6500),('quebec','chicoutimi',3000),('quebec','kingston',9000),('quebec','toronto',11500),('quebec','moncton',10000),('quebec','trois-rivieres',2000),('quebec','sherbrooke',3500),
  ('toronto','montreal',8000),('toronto','ottawa',6000),('toronto','kingston',4000),('toronto','quebec',11500),('toronto','chicoutimi',14500),('toronto','moncton',22500),('toronto','trois-rivieres',10000),('toronto','sherbrooke',10000)
) as f(origin_city, dest, cents)
on f.origin_city = z.origin_city
on conflict (zone_id, destination_region) do update set fare_cents = excluded.fare_cents;
