-- 0010 · Row Level Security back on, for every Hub table.
--
-- 0002 switched RLS off for development (owner decision 2026-08-31). The Hub
-- now holds schedule, milestones, documents, photos, change orders, selections,
-- messages and invoice drafts for a real contractor, so "anyone holding the
-- anon key can read every contractor's rows" is no longer an acceptable state.
--
-- READ THIS BEFORE RUNNING.
--
-- EVIDENCE FROM PRODUCTION, 10 Sep: 0009 enabled RLS on two tables by mistake
-- and the app immediately lost them (empty lists, refused inserts). RLS only
-- bites a non-service key, so HUB_SUPABASE_KEY on the deployment IS the anon
-- key today. Running this file before swapping that key would take the whole
-- Hub down. Do step 2 first. 0011 undoes the 0009 accident in the meantime.
--
-- The app talks to the Hub with HUB_SUPABASE_KEY. If that key is the
-- **service_role** key, RLS does not apply to it and this migration changes
-- nothing for the app: every read and write keeps working, and only the anon
-- key is shut out. If that key is the **anon** key, enabling RLS with no
-- permissive policy blocks the app completely. So:
--
--   1. Confirm which key HUB_SUPABASE_KEY is (Vercel > project-hub > Settings >
--      Environment Variables; the JWT payload's "role" claim says which).
--   2. If it is anon, swap it for the service_role key FIRST, redeploy, verify
--      one screen saves, then run this file.
--   3. Run this file in the Supabase SQL editor for project nexpqqxarimqmntnvzff.
--   4. Reload /dashboard/team and /dashboard/projects/<id>/schedule on the
--      live site. Both should still render their rows.
--
-- Tenancy stays where it has always been enforced: in the application, which
-- filters every query on the asserted contractor_id (see lib/tenancy.ts). RLS
-- here is the second lock, not a replacement for the first. No policies are
-- created on purpose: the only client of these tables is the server, holding
-- the service role, and a permissive policy for anon would reopen the door
-- this file closes.

alter table public.hub_project_state          enable row level security;
alter table public.hub_activity               enable row level security;
alter table public.hub_milestones             enable row level security;
alter table public.hub_tasks                  enable row level security;
alter table public.hub_daily_updates          enable row level security;
alter table public.hub_update_comments        enable row level security;
alter table public.hub_update_acknowledgements enable row level security;
alter table public.hub_issues                 enable row level security;
alter table public.hub_messages               enable row level security;
alter table public.hub_documents              enable row level security;
alter table public.hub_photos                 enable row level security;
alter table public.hub_visibility_settings    enable row level security;
alter table public.hub_schedule_items         enable row level security;
alter table public.hub_memberships            enable row level security;
alter table public.hub_invitations            enable row level security;
alter table public.hub_grants                 enable row level security;
alter table public.hub_invoice_drafts         enable row level security;
alter table public.hub_selections             enable row level security;
alter table public.hub_change_orders          enable row level security;

-- Belt and braces: even with RLS on, revoke the anon role's table privileges so
-- a future permissive policy cannot accidentally expose a table to the public
-- key. The service role is unaffected.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
