-- Admin "god powers" over passengers: force-cancel a passenger's active seat
-- reservations, and hard-delete a passenger account. Both are admin-gated via
-- the is_admin flag on the caller's drivers row, matching the existing admin
-- RPC pattern (set_user_blocked, admin_remove_from_queue, …).

-- 1. Force-cancel every active (pending OR confirmed) seat claim a passenger
--    holds. For confirmed claims we also free the seat on the driver's queue
--    entry (decrement counts, flip one locked slot back to empty) and remove
--    the recorded trip, so the seat reopens for someone else. Returns the
--    number of reservations cancelled.
create or replace function public.admin_cancel_passenger_claims(
  p_id uuid
) returns int
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_claim  record;
  v_states jsonb;
  v_idx    int;
  v_count  int := 0;
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized: admin only';
  end if;

  for v_claim in
    select id, queue_entry_id, status
      from public.seat_claims
     where passenger_id = p_id
       and status in ('pending', 'confirmed')
  loop
    if v_claim.status = 'confirmed' then
      -- Free the seat on the driver's queue entry. Wrapped so a seat-state
      -- hiccup can never block the cancellation itself.
      begin
        select seat_states into v_states
          from public.queue_entries
         where id = v_claim.queue_entry_id
         for update;

        if v_states is not null and jsonb_typeof(v_states) = 'array' then
          select g.i into v_idx
            from generate_series(0, jsonb_array_length(v_states) - 1) as g(i)
           where v_states ->> g.i = 'locked'
           limit 1;
          if v_idx is not null then
            v_states := jsonb_set(v_states, array[v_idx::text], '"empty"'::jsonb);
          end if;
        end if;

        update public.queue_entries
           set seats_boarded = greatest(coalesce(seats_boarded, 0) - 1, 0),
               seats_locked  = greatest(coalesce(seats_locked, 0) - 1, 0),
               seat_states   = coalesce(v_states, seat_states)
         where id = v_claim.queue_entry_id;
      exception when others then
        null;
      end;

      -- Drop the analytics trip tied to this reservation.
      delete from public.trips
       where passenger_id = p_id
         and queue_entry_id = v_claim.queue_entry_id;
    end if;

    update public.seat_claims
       set status = 'cancelled', cancelled_at = now()
     where id = v_claim.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$func$;

grant execute on function public.admin_cancel_passenger_claims(uuid) to authenticated;


-- 2. Hard-delete a passenger account + all passenger-side data. Mirrors
--    delete_my_account() but admin-gated and targeted at p_id. Like the
--    self-delete, it leaves the auth.users row intact (so re-signup with the
--    same email stays detectable); only the public profile + owned rows go.
create or replace function public.admin_delete_passenger(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized: admin only';
  end if;

  delete from public.trips        where passenger_id = p_id;
  delete from public.seat_claims  where passenger_id = p_id;
  delete from public.messages     where sender_id  = p_id or recipient_id = p_id;
  delete from public.user_reports where reporter_id = p_id or reported_id = p_id;
  delete from public.user_blocks  where blocker_id  = p_id or blocked_id  = p_id;
  delete from public.passengers   where id = p_id;
end;
$func$;

grant execute on function public.admin_delete_passenger(uuid) to authenticated;

notify pgrst, 'reload schema';
