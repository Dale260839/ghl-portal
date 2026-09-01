-- ============================================================================
-- PROJECT HUB — storage access for hub-media (migration 0006)
--
-- Run in: the Project Hub Supabase project → SQL Editor. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHY A SECOND STORAGE MIGRATION
--
-- 0005 created the bucket and deliberately created no policies. `storage.objects`
-- has RLS of its own, always on, and it is NOT affected by 0002 turning RLS off
-- on our tables — that migration named tables, and storage is a different one.
--
-- So the bucket exists, listing it works, and every upload fails with
-- "new row violates row-level security policy". Which is correct behaviour and
-- an unhelpful place to stop.
--
-- ---------------------------------------------------------------------------
-- THE POSTURE HERE MATCHES 0002, AND INHERITS ITS DEADLINE
--
-- These policies allow the anon role to work with objects in `hub-media` and
-- **only** that bucket. They do not scope by contractor, for the same reason
-- 0002 turned table RLS off: the access patterns are still moving, and writing
-- a policy per screen before the screens are settled means writing it twice.
--
-- **The application does the scoping in the meantime, and it is not nothing.**
-- Every path is `contractor/project/kind/file`, the contractor segment comes
-- from an asserted scope rather than from the caller, and `signedUrl` and
-- `remove` both refuse a path that does not start with the caller's own
-- contractor id. What is missing is the database enforcing that too.
--
-- When table RLS goes back on, these get rewritten in the same pass as a prefix
-- match on the contractor segment — which is exactly why the contractor id is
-- the FIRST segment of every path. Nothing has to be re-filed.
-- ============================================================================

-- Postgres has no `create policy if not exists`, so each one is dropped first.
-- That is safe: dropping a policy that does not exist is a no-op with `if
-- exists`, and re-running this file simply recreates them identically.

drop policy if exists "hub_media_read" on storage.objects;
create policy "hub_media_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'hub-media');

drop policy if exists "hub_media_insert" on storage.objects;
create policy "hub_media_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'hub-media');

drop policy if exists "hub_media_update" on storage.objects;
create policy "hub_media_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'hub-media')
  with check (bucket_id = 'hub-media');

drop policy if exists "hub_media_delete" on storage.objects;
create policy "hub_media_delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'hub-media');


-- ============================================================================
-- WHAT THIS DOES NOT DO
--
--   · It does not make the bucket public. `hub-media.public` stays false, so a
--     file is still only reachable through a signed URL the application mints,
--     and those expire in ten minutes.
--   · It does not grant access to any other bucket.
--   · It does not scope by contractor. That is the debt, and it comes due with
--     the table policies in 0002.
--
-- VERIFY
--
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like 'hub_media%'
--   order by policyname;
--
--   -- expect four rows
-- ============================================================================
