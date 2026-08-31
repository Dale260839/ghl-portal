-- ============================================================================
-- PROJECT HUB — a membership needs to know what it can read (migration 0004)
--
-- Run in: the Project Hub Supabase project → SQL Editor. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- A Hub membership carried `contractor_id` — whose team you are on — and that
-- is enough for a field user or a homeowner, whose records all live in the
-- Hub's own tables.
--
-- It is not enough for a contractor. Their projects, clients and proposals live
-- in BuildSuite, and every BuildSuite read is filtered by `auth_profiles.id`.
-- A contractor signing in through the Hub had no way to say which profile they
-- read under, so `signIn` was putting the contractor id in that slot — two
-- different ids again, the same mistake as 2026-09-01.
--
-- So: store it. A membership now says both "whose team" and "what you may read
-- on the BuildSuite side".
--
-- Empty is the normal case. Field crew and clients have no business reading
-- BuildSuite directly and get an empty array, which reads as "nothing", not as
-- "everything".
-- ============================================================================

alter table public.hub_memberships
  add column if not exists auth_profile_ids uuid[] not null default '{}';

comment on column public.hub_memberships.auth_profile_ids is
  'BuildSuite auth_profiles.id values this member may read under. Empty for field and client members, who read only Hub tables. NOT the same id as contractor_id.';


-- ============================================================================
-- VERIFY
--
--   select column_name, data_type from information_schema.columns
--   where table_name = 'hub_memberships' and column_name = 'auth_profile_ids';
-- ============================================================================
