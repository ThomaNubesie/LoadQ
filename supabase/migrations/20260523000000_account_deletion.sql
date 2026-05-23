-- P93: Self-service account deletion. Apple Guideline 5.1.1(v) requires apps
-- that support sign-up to also support in-app account deletion.
--
-- This RPC deletes the caller's drivers/passengers row + all owned data
-- (vehicles, queue_entries, loading_history, trips, messages, push tokens, etc).
-- It does NOT delete the auth.users entry — Supabase auth records remain so
-- we can detect re-signup with the same email. After running this, the client
-- should call supabase.auth.signOut() and return the user to the welcome
-- screen. If they sign in again with the same email, they'll get a fresh
-- profile row (driver_setup / vehicle_setup flow runs again).

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Order matters: dependent rows first, then the profile row.
  -- Queue / loading
  delete from public.queue_entries    where driver_id    = v_uid;
  delete from public.loading_history  where driver_id    = v_uid;

  -- Trips / claims (passenger or driver side)
  delete from public.trips            where passenger_id = v_uid or driver_id = v_uid;

  -- Messages (both sender and recipient sides)
  delete from public.messages         where sender_id    = v_uid or recipient_id = v_uid;

  -- User reports + blocks (both sides)
  delete from public.user_reports     where reporter_id  = v_uid or reported_id  = v_uid;
  delete from public.user_blocks      where blocker_id   = v_uid or blocked_id   = v_uid;

  -- Vehicles
  delete from public.vehicles         where driver_id    = v_uid;

  -- Profile rows (whichever role)
  delete from public.drivers          where id           = v_uid;
  delete from public.passengers       where id           = v_uid;
end;
$func$;

grant execute on function public.delete_my_account() to authenticated;

notify pgrst, 'reload schema';
