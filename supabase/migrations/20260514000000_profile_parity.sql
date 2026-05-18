-- Add date-of-birth and sex to both drivers and passengers so signup
-- forms collect the same identity info on both sides.

alter table public.drivers
  add column if not exists dob date,
  add column if not exists sex text check (sex in ('male','female','other'));

alter table public.passengers
  add column if not exists dob date,
  add column if not exists sex text check (sex in ('male','female','other'));
