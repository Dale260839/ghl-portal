-- ============================================================================
-- PROJECT HUB — storage for client photos and documents (migration 0005)
--
-- Run in: the Project Hub Supabase project → SQL Editor. Safe to re-run.
--
-- Chris, 2026-09-01: "I am ok with what Sing says. If it is ok on Supabase I
-- think that would be the cleanest."
--
-- ---------------------------------------------------------------------------
-- WHY SUPABASE AND NOT GOHIGHLEVEL MEDIA
--
-- Two reasons, and the second is the one that decided it:
--
--   1. The files sit beside the rows that reference them. `hub_documents` and
--      `hub_photos` already carry a `storage_path`; this gives that column
--      somewhere to point.
--
--   2. **The field crew never touches GoHighLevel** (D4 §5). A crew member
--      photographing a job on site has to be able to upload it. If the photo
--      lived in GHL media, the upload would have to pass through a system that
--      rule says they never see.
--
-- ---------------------------------------------------------------------------
-- THE BUCKET IS PRIVATE, AND THAT IS THE WHOLE POINT
--
-- `public = false`. A public bucket hands out permanent unguessable URLs, and
-- "unguessable" is not a permission — a link that leaks stays valid forever and
-- cannot be revoked.
--
-- Instead every file is served through a SIGNED URL minted per request, after
-- the §9.1 gate has decided this person may see this record. The gate already
-- governs whether a homeowner sees a document; this makes the file itself obey
-- the same answer rather than being protected only by the page that links to it.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hub-media',
  'hub-media',
  false,
  -- 50 MB. Large enough for a site photo from a modern phone and a scanned
  -- contract; small enough that a mistake is not a bill.
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do nothing;


-- ============================================================================
-- ACCESS
--
-- No storage policies are created here, deliberately.
--
-- RLS is currently off on this project's tables, and storage.objects has its
-- own policies which default to denying everything. Rather than write policies
-- now that would have to be rewritten when table RLS comes back, the
-- application reaches storage server-side and mints short-lived signed URLs.
--
-- When RLS is turned back on (see 0002_rls_development.sql), storage policies
-- get written in the same pass, keyed on the same contractor id the tables use.
-- ============================================================================


-- ============================================================================
-- VERIFY
--
--   select id, public, file_size_limit from storage.buckets where id = 'hub-media';
--
--   -- expect one row, public = false
-- ============================================================================
