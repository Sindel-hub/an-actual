-- USC Storage hardening
-- Run in the Supabase SQL editor after making a backup/export of existing objects.
-- The legacy mixed bucket is made private at the end of this migration.

insert into storage.buckets (id, name, public)
values ('usc-public-media', 'usc-public-media', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('usc-private-documents', 'usc-private-documents', false)
on conflict (id) do update set public = false;

-- Defense in depth: signed upload tickets are also validated by the Firebase backend,
-- but bucket limits prevent a stolen/abused upload token from becoming an arbitrary file drop.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'usc-public-media';

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp']
where id = 'usc-private-documents';

-- Remove permissive policies from every earlier project revision.
drop policy if exists "Public uploads for USC folders" on storage.objects;
drop policy if exists "uscstorage public uploads" on storage.objects;
drop policy if exists "uscstorage anonymous uploads" on storage.objects;
drop policy if exists "uscstorage public read" on storage.objects;
drop policy if exists "Allow anon uploads to uscstorage announcements" on storage.objects;
drop policy if exists "Allow anon uploads to uscstorage candidates" on storage.objects;
drop policy if exists "Allow anon uploads to uscstorage events" on storage.objects;
drop policy if exists "Allow anon uploads to uscstorage complaints" on storage.objects;
drop policy if exists "usc public media read" on storage.objects;

-- Only approved public media is world-readable. Browser uploads do not receive a direct
-- INSERT policy; the trusted backend issues a short-lived signed upload token instead.
create policy "usc public media read"
on storage.objects for select
to public
using (bucket_id = 'usc-public-media');

-- No SELECT/INSERT/UPDATE/DELETE policy is granted for usc-private-documents to anon or
-- authenticated Supabase browser identities. Firebase Cloud Functions use the service role
-- after validating Firebase identity/ownership and return a five-minute signed download URL.

-- Fail closed immediately for the old mixed-content bucket. Historical public posters should
-- be migrated to usc-public-media; complaint/candidacy files belong in usc-private-documents.
update storage.buckets set public = false where id = 'uscstorage';
