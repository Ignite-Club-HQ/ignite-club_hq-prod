-- LOCAL TEST INFRASTRUCTURE ONLY. Never deploy this migration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'club-media-local',
  'club-media-local',
  false,
  262144,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function local_test.storage_club_id(object_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

create policy local_club_media_select
on storage.objects for select to authenticated
using (
  bucket_id = 'club-media-local'
  and public.is_club_member(auth.uid(), local_test.storage_club_id(name))
);

create policy local_club_media_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'club-media-local'
  and public.is_club_member(auth.uid(), local_test.storage_club_id(name))
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy local_club_media_update
on storage.objects for update to authenticated
using (
  bucket_id = 'club-media-local'
  and public.is_club_member(auth.uid(), local_test.storage_club_id(name))
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.has_role(auth.uid(), 'club_admin', local_test.storage_club_id(name), null)
  )
)
with check (
  bucket_id = 'club-media-local'
  and public.is_club_member(auth.uid(), local_test.storage_club_id(name))
);

create policy local_club_media_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'club-media-local'
  and public.is_club_member(auth.uid(), local_test.storage_club_id(name))
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.has_role(auth.uid(), 'club_admin', local_test.storage_club_id(name), null)
  )
);
