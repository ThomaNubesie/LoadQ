-- A7: assigned driver marks their ride completed → cascade captures the card
-- hold (or releases it on cancel/expiry). Applied to remote via MCP 2026-08-10.
create or replace function public.loadq_ride_complete(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  update public.loadq_ride_requests
     set status = 'completed'
   where id = p_request_id and driver_id = uid
     and status in ('assigned','en_route','picked_up');
  if not found then raise exception 'ride not found or not yours'; end if;
end $$;
grant execute on function public.loadq_ride_complete(uuid) to authenticated;
