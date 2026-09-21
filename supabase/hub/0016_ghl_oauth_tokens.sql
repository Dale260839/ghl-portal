-- 0016 · The agency's GoHighLevel Marketplace connection.
--
-- WHY
--
-- Today every contractor's sub-account needs its own Private Integration token,
-- created by hand and pasted into GHL_LOCATION_TOKENS, because a PIT only opens
-- the sub-account it was made in (measured 17 Sep: each of our two tokens gets
-- `401 This location is not accessible from this token!` on the other's
-- sub-account). That is a manual step per contractor, and forgetting it fails
-- their invoices silently.
--
-- An agency-level Marketplace install replaces all of them: one refresh token,
-- from which a short-lived token for ANY installed sub-account can be minted on
-- demand. This table is where that one connection lives. Nothing else in the
-- Hub changes.
--
-- WHY A TABLE AND NOT AN ENVIRONMENT VARIABLE
--
-- Because it rotates. GoHighLevel returns a NEW refresh token on every refresh
-- and invalidates the old one, so the value cannot live anywhere a human has to
-- paste it. That also means two server instances refreshing at the same moment
-- would invalidate each other — hence the claim columns, the same durable
-- single-winner pattern as 0014.
--
-- ONE ROW, EVER. Keyed by the agency's company id.
--
-- SAFE TO RUN BEFORE OR AFTER THE DEPLOY, AND SAFE NOT TO RUN AT ALL.
-- It creates a new table and touches nothing that exists. The app probes for
-- the table once per process: without it, the OAuth path reports "not
-- installed" and every request uses the Private Integration tokens exactly as
-- it does today. Re-running is harmless.
--
-- TO UNDO: `drop table if exists public.hub_ghl_oauth;` — it is referenced by
-- nothing and referenced from nothing.

create table if not exists public.hub_ghl_oauth (
  -- The agency (GHL "companyId"). One install, one row.
  company_id              text primary key,

  -- Which Marketplace app this install belongs to. If the app is rebuilt with a
  -- new client id, the old row is ignored rather than silently reused with
  -- credentials that no longer match.
  client_id               text not null,

  -- The only long-lived secret here. Replaced on every refresh.
  refresh_token           text not null,

  -- Agency-level access token and its expiry. Short-lived; re-minted from the
  -- refresh token. Null is normal — it means "nobody has needed one yet".
  access_token            text,
  access_expires_at       timestamptz,

  -- The sub-accounts this app is installed on, cached from
  -- GET /oauth/installedLocations. An array of GHL location ids. This is a
  -- CACHE, never the authority on who may sign in: that stays with BuildSuite's
  -- auth_profiles, exactly as it is today.
  installed_locations     jsonb not null default '[]'::jsonb,
  installed_refreshed_at  timestamptz,

  -- Durable single-winner claim, held only for the seconds a refresh takes.
  -- Unlike 0014's invoice claim this one DOES expire: a refresh that never
  -- finishes must not lock every contractor out permanently, and a repeated
  -- refresh is recoverable in a way a repeated invoice is not.
  claim_id                uuid,
  claimed_at              timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Who installed it, for the trail. A name, never a token.
  installed_by            text
);

-- RLS on, no policies, like every other Hub table since 0010. The only client
-- is this server holding the service role, which RLS does not apply to. A
-- permissive policy here would expose the agency's refresh token to the
-- publishable key, which is the single worst row in the database to leak.
alter table public.hub_ghl_oauth enable row level security;

revoke all on public.hub_ghl_oauth from anon;
revoke all on public.hub_ghl_oauth from authenticated;

notify pgrst, 'reload schema';
