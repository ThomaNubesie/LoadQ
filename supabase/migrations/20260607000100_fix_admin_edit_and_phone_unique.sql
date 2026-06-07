-- Fix two causes of "Could not update" errors when an admin edits a user:
--
-- 1. full_name is NOT NULL on both drivers and passengers, but the edit RPC
--    did `full_name = nullif(trim(p_full_name), '')` — so saving with a blank
--    name tried to write NULL and failed (23502). Now a blank name keeps the
--    existing value instead of nulling a required field.
--
-- 2. drivers.phone carries a UNIQUE constraint (drivers_phone_key). During
--    testing with placeholder/duplicate numbers, editing a driver whose phone
--    collides with another raised a unique violation. This was always meant to
--    be dropped for testing — RESTORE BEFORE GOING LIVE:
--      alter table public.drivers add constraint drivers_phone_key unique (phone);
alter table public.drivers drop constraint if exists drivers_phone_key;

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
       set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
           email     = nullif(trim(p_email), ''),
           phone     = nullif(trim(p_phone), '')
     where id = p_id;
  elsif p_table = 'passengers' then
    update public.passengers
       set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
           email     = nullif(trim(p_email), ''),
           phone     = nullif(trim(p_phone), '')
     where id = p_id;
  else
    raise exception 'invalid table: %', p_table;
  end if;
end;
$func$;

grant execute on function public.admin_update_user_basics(uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
