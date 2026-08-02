-- Bucket + policies set up ahead of need — Phase 4/10 write the actual
-- upload code, but SEC-04 (household isolation on Storage, not just the
-- database) belongs with the rest of this phase's security boundary
-- work. Path convention: every object key is prefixed
-- "<household_id>/...", e.g. "<household_id>/<recipe_id>/hero.jpg" —
-- the policies below key off that first path segment.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- storage.foldername(name)[1] is untrusted (any authenticated caller can
-- send any string as the object key) — a plain ::uuid cast raises a hard
-- Postgres error on a malformed path rather than evaluating to false, so
-- this coerces failure to null instead. is_household_member(null) is
-- already false (household_id = null never matches), so a malformed path
-- degrades to a clean permission denial, not a 500.
create or replace function public.safe_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create policy "Household members can read their household's recipe images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "Household members can upload their household's recipe images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "Household members can update their household's recipe images"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.safe_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "Household members can delete their household's recipe images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.safe_uuid((storage.foldername(name))[1]))
  );
