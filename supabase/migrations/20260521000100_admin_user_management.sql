-- Admin-only RPCs to edit user profile basics (name/email/phone) and create
-- new driver or passenger accounts from the admin console.
--
-- Pattern mirrors set_driver_verified / set_user_blocked: SECURITY DEFINER,
-- callable by authenticated, gated on drivers.is_admin = true.

create or replace function public.admin_update_user_basics(
  p_id        uuid,
  p_table     text,        -- 'drivers' | 'passengers'
  p_full_name text,
  p_email     text,
  p_phone     text
) returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;

  if p_table = 'drivers' then
    update public.drivers
       set full_name = nullif(trim(p_full_name), ''),
           email     = nullif(trim(p_email),     ''),
           phone     = nullif(trim(p_phone),     '')
     where id = p_id;
  elsif p_table = 'passengers' then
    update public.passengers
       set full_name = nullif(trim(p_full_name), ''),
           email     = nullif(trim(p_email),     ''),
           phone     = nullif(trim(p_phone),     '')
     where id = p_id;
  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$func$;

grant execute on function public.admin_update_user_basics(uuid, text, text, text, text) to authenticated;


-- Update vehicle basics (admin-only): plate, make/model/year, color, seats.
create or replace function public.admin_update_vehicle_basics(
  p_vehicle_id uuid,
  p_plate      text,
  p_make       text,
  p_model      text,
  p_year       int,
  p_color      text,
  p_seats      int
) returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;

  update public.vehicles
     set plate = nullif(trim(p_plate), ''),
         make  = nullif(trim(p_make),  ''),
         model = nullif(trim(p_model), ''),
         year  = coalesce(p_year, year),
         color = nullif(trim(p_color), ''),
         seats = coalesce(p_seats, seats)
   where id = p_vehicle_id;
end;
$func$;

grant execute on function public.admin_update_vehicle_basics(uuid, text, text, text, int, text, int) to authenticated;


-- Create a new driver or passenger profile row WITHOUT an auth.users entry.
-- For office-onboarding flow — admin creates the placeholder row, user later
-- signs in with the same email and Supabase will create the auth user. The
-- profile row's primary key is generated; we tie it back when the user signs
-- in by email.
--
-- We use a `pending_email` column to remember which email is expected so the
-- profile gets claimed when that user finally signs in.
alter table public.drivers    add column if not exists pending_email text;
alter table public.passengers add column if not exists pending_email text;

create or replace function public.admin_create_user(
  p_table     text,        -- 'drivers' | 'passengers'
  p_full_name text,
  p_email     text,
  p_phone     text
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_new_id uuid;
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;

  v_new_id := gen_random_uuid();

  if p_table = 'drivers' then
    insert into public.drivers (id, full_name, email, phone, pending_email, created_at)
    values (v_new_id, nullif(trim(p_full_name), ''),
            nullif(trim(p_email), ''),
            nullif(trim(p_phone), ''),
            nullif(trim(p_email), ''),
            now());
  elsif p_table = 'passengers' then
    insert into public.passengers (id, full_name, email, phone, pending_email, created_at)
    values (v_new_id, nullif(trim(p_full_name), ''),
            nullif(trim(p_email), ''),
            nullif(trim(p_phone), ''),
            nullif(trim(p_email), ''),
            now());
  else
    raise exception 'invalid table: %', p_table;
  end if;

  return v_new_id;
end;
$func$;

grant execute on function public.admin_create_user(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
