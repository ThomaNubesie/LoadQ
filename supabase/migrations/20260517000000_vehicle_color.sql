-- Car color for vehicles. Free text constrained to a known palette client-side.
alter table public.vehicles
  add column if not exists color text;
