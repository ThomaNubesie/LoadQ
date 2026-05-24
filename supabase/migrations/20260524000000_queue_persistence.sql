-- P96: Queue persistence — when a driver leaves the queue (cancel, depart,
-- 2-strike timeout, admin removal), we no longer DELETE their queue_entries
-- row. Instead we mark it status='ended' with an end_reason. Today's queue
-- view shows all entries — active ones in normal style, ended ones greyed
-- with the reason. Next day at 4 AM the EOD purge wipes everything for a
-- fresh start.

alter table public.queue_entries
  add column if not exists end_reason text;

-- Update admin_remove_from_queue: change from DELETE to mark as ended.
create or replace function public.admin_remove_from_queue(
  p_entry_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from public.drivers where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;
  update public.queue_entries
     set status = 'ended', end_reason = 'removed_by_admin'
   where id = p_entry_id;
end;
$func$;

notify pgrst, 'reload schema';
