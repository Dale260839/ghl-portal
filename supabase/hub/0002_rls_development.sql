-- ============================================================================
-- PROJECT HUB — RLS OFF FOR DEVELOPMENT (migration 0002)
--
-- Run in: the Project Hub Supabase project → SQL Editor.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS AND WHY
--
-- `0001_initial.sql` enabled RLS on all 16 tables with no policy, which is the
-- correct end state but means the application can neither read nor write.
-- Writing 16 tables' worth of policies before a single screen exists would
-- block the build for a day to protect a database with nothing in it.
--
-- Owner's decision, 2026-08-31: RLS off while we are rolling changes, policies
-- written once the access patterns are settled and stop moving.
--
-- ---------------------------------------------------------------------------
-- WHAT IS TRUE WHILE THIS IS IN EFFECT
--
-- Anything holding the Hub's key can read and write every Hub table. The three
-- things that keep that acceptable, and they are not nothing:
--
--   1. `HUB_SUPABASE_KEY` is a SERVER-ONLY environment variable. It is not
--      prefixed `NEXT_PUBLIC_`, so it is never sent to a browser. A guardrail
--      test in the web app fails the build if that ever changes.
--   2. Tenancy is enforced in application code. Every Hub read and write takes
--      a scope as a required argument and will not compile without one — the
--      same discipline that governs the BuildSuite reads.
--   3. The database holds no production data yet. That stops being true the
--      day a real contractor uses it, which is the deadline for 0003.
--
-- ---------------------------------------------------------------------------
-- THE EXIT
--
-- `0003_rls_policies.sql` re-enables RLS with real policies. Write it BEFORE a
-- real contractor's data lands here, not after. The re-enable statements are at
-- the bottom of this file so nobody has to reconstruct them.
-- ============================================================================

alter table public.hub_milestones               disable row level security;
alter table public.hub_schedule_items           disable row level security;
alter table public.hub_tasks                    disable row level security;
alter table public.hub_daily_updates            disable row level security;
alter table public.hub_update_acknowledgements  disable row level security;
alter table public.hub_update_comments          disable row level security;
alter table public.hub_issues                   disable row level security;
alter table public.hub_messages                 disable row level security;
alter table public.hub_documents                disable row level security;
alter table public.hub_photos                   disable row level security;
alter table public.hub_visibility_settings      disable row level security;
alter table public.hub_project_state            disable row level security;
alter table public.hub_activity                 disable row level security;
alter table public.hub_memberships              disable row level security;
alter table public.hub_invitations              disable row level security;
alter table public.hub_grants                   disable row level security;


-- ============================================================================
-- TO PUT IT BACK — run this block, then add policies.
--
--   alter table public.hub_milestones               enable row level security;
--   alter table public.hub_schedule_items           enable row level security;
--   alter table public.hub_tasks                    enable row level security;
--   alter table public.hub_daily_updates            enable row level security;
--   alter table public.hub_update_acknowledgements  enable row level security;
--   alter table public.hub_update_comments          enable row level security;
--   alter table public.hub_issues                   enable row level security;
--   alter table public.hub_messages                 enable row level security;
--   alter table public.hub_documents                enable row level security;
--   alter table public.hub_photos                   enable row level security;
--   alter table public.hub_visibility_settings      enable row level security;
--   alter table public.hub_project_state            enable row level security;
--   alter table public.hub_activity                 enable row level security;
--   alter table public.hub_memberships              enable row level security;
--   alter table public.hub_invitations              enable row level security;
--   alter table public.hub_grants                   enable row level security;
--
-- Check the current state at any time with:
--
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename like 'hub_%'
--   order by tablename;
-- ============================================================================
