-- A7 on-demand: passenger sets the departure (loading) zone on their own pending
-- ride request (dispatch requires departure_zone_id; create() doesn't set it and
-- there is no passenger UPDATE policy). Applied to remote via MCP 2026-08-10.
create or replace function public.loadq_ride_set_departure(p_request_id uuid, p_zone_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'auth required'; end if;
  update public.loadq_ride_requests
     set departure_zone_id = p_zone_id
   where id = p_request_id and passenger_id = uid
     and status not in ('assigned','en_route','picked_up','completed','cancelled','expired');
  if not found then raise exception 'request not found or not editable'; end if;
end $$;
grant execute on function public.loadq_ride_set_departure(uuid, text) to authenticated;
