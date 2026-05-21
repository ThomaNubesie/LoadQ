-- Allow drivers to DM each other (not just admin <-> user).
-- Passengers still only ever talk to admin.

drop policy if exists messages_insert_admin_or_to_admin on public.messages;
create policy messages_insert_driver_or_admin on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id and (
      -- both sender and recipient are drivers
      (
        exists (select 1 from public.drivers where id = sender_id)
        and exists (select 1 from public.drivers where id = recipient_id)
      )
      -- or sender is admin (admin can DM anyone)
      or exists (select 1 from public.drivers d where d.id = auth.uid() and d.is_admin = true)
      -- or recipient is admin (any user can DM admin)
      or exists (select 1 from public.drivers d where d.id = recipient_id and d.is_admin = true)
    )
  );

notify pgrst, 'reload schema';
