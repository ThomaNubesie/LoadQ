-- Direct messages between admin and any user. Admin can DM anyone; non-admin
-- users can only DM an admin (in either direction). Mark-as-read is recipient-side.

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body         text not null check (length(trim(body)) > 0),
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists messages_recipient_created_idx
  on public.messages (recipient_id, created_at desc);
create index if not exists messages_sender_created_idx
  on public.messages (sender_id, created_at desc);
create index if not exists messages_recipient_unread_idx
  on public.messages (recipient_id) where read_at is null;

alter table public.messages enable row level security;

drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists messages_insert_admin_or_to_admin on public.messages;
create policy messages_insert_admin_or_to_admin on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id and (
      exists (select 1 from public.drivers d where d.id = auth.uid()    and d.is_admin = true)
      or exists (select 1 from public.drivers d where d.id = recipient_id and d.is_admin = true)
    )
  );

drop policy if exists messages_update_read on public.messages;
create policy messages_update_read on public.messages
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

notify pgrst, 'reload schema';
