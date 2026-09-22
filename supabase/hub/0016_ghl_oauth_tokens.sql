-- 0016 · A sub-account's GoHighLevel Marketplace connection. One row each.
--
-- WHY
--
-- Today every contractor's sub-account needs its own Private Integration token,
-- created by hand and pasted into GHL_LOCATION_TOKENS, because a PIT only opens
-- the sub-account it was made in (measured 17 Sep: each of our two tokens gets
-- `401 This location is not accessible from this token!` on the other's
-- sub-account). That is four manual steps per contractor — create the token,
-- copy it, add it to the deployment, redeploy — and forgetting any of them
-- fails their invoices silently.
--
-- The Marketplace app replaces all of it with one click. Installing it on a
-- sub-account hands us that sub-account's tokens, and this table is where they
-- live. Nobody ever handles a credential again.
--
-- WHY PER SUB-ACCOUNT AND NOT ONE AGENCY ROW
--
-- This was designed as a single agency install, which would have made
-- onboarding zero-click. GoHighLevel does not allow it: the scopes we need —
-- contacts, conversations, invoices — are marked *"This scope works with
-- Location-level tokens only, which are issued when a Sub-Account installs your
-- app"*, and are greyed out on an agency-targeted app (confirmed in the scope
-- picker, 2026-09-23). So the app targets sub-accounts, and each one is
-- installed once.
--
-- WHY A TABLE AND NOT ENVIRONMENT VARIABLES
--
-- Because these rotate. GoHighLevel returns a NEW refresh token on every
-- refresh and invalidates the old one, so the value cannot live anywhere a
-- person has to paste it. That also means two server instances refreshing the
-- same row at the same moment would invalidate each other — hence the claim
-- columns, the same durable single-winner pattern as 0014.
--
-- SAFE TO RUN BEFORE OR AFTER THE DEPLOY, AND SAFE NOT TO RUN AT ALL.
-- It creates a new table and touches nothing that exists. The app probes for
-- the table once per process: without it, every request uses the Private
-- Integration tokens exactly as it does today. Re-running is harmless.
--
-- TO UNDO: `drop table if exists public.hub_ghl_oauth;` — it is referenced by
-- nothing and references nothing.

create table if not exists public.hub_ghl_oauth (
  -- The sub-account. One install, one row.
  location_id             text primary key,

  -- The agency the sub-account belongs to, as GoHighLevel reports it. Recorded
  -- for the trail; nothing is decided by it.
  company_id              text,

  -- Which Marketplace app this install belongs to. If the app is ever rebuilt
  -- with a new client id, the old rows are ignored rather than silently reused
  -- with credentials that no longer match them.
  client_id               text not null,

  -- The only long-lived secret here. Replaced on every refresh.
  refresh_token           text not null,

  -- Short-lived, re-minted from the refresh token. Null is normal — it means
  -- nobody has needed one since the install.
  access_token            text,
  access_expires_at       timestamptz,

  -- What GoHighLevel actually granted, as it reported it. Recorded so a missing
  -- scope can be diagnosed from the row rather than from a 401 months later.
  scopes                  text,

  -- Durable single-winner claim, held only for the seconds a refresh takes.
  -- Unlike 0014's invoice claim this one EXPIRES: a refresh that never finishes
  -- must not lock a contractor out permanently, and a repeated refresh is
  -- recoverable in a way a repeated invoice is not.
  claim_id                uuid,
  claimed_at              timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Who installed it, for the trail. A name, never a token.
  installed_by            text
);

create index if not exists hub_ghl_oauth_client on public.hub_ghl_oauth (client_id);

-- RLS on, no policies, like every other Hub table since 0010. The only client
-- is this server holding the service role, which RLS does not apply to. A
-- permissive policy here would expose a contractor's refresh token to the
-- publishable key, which is the worst row in this database to leak.
alter table public.hub_ghl_oauth enable row level security;

revoke all on public.hub_ghl_oauth from anon;
revoke all on public.hub_ghl_oauth from authenticated;

notify pgrst, 'reload schema';
