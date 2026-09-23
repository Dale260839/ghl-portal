-- 0017 · The agency's own Marketplace install. One row, for signing people in.
--
-- WHY A SECOND INSTALL, AFTER 0016
--
-- Two different jobs need two different credentials, because GoHighLevel will
-- not issue one credential that does both.
--
--   · **Signing a contractor in** makes exactly one API call: GET /locations/
--     {id}, to prove the sub-account in their menu link is real and ours.
--     `locations.readonly` is available to an AGENCY-level app — it carries the
--     "Sub + agency" badge in the scope picker and can be ticked there.
--
--   · **Invoices and emails** need contacts, conversations and invoices, which
--     are location-level only: *"This scope works with Location-level tokens
--     only, which are issued when a Sub-Account installs your app."* Those live
--     in 0016, one row per sub-account, installed once by the contractor.
--
-- The consequence is the point of this file. With an agency install, EVERY
-- sub-account in the agency can be verified — including ones that have never
-- installed anything. So a brand-new contractor signs in immediately and sees
-- their projects, clients, budgets and schedules, none of which come from
-- GoHighLevel anyway. Approving the sub-account app stops being a door they
-- cannot open and becomes a prompt at the moment they first send an invoice.
--
-- ONE ROW, EVER. Keyed by the agency's company id, with the same rotating
-- refresh token and the same single-winner claim as 0016.
--
-- SAFE TO RUN BEFORE OR AFTER THE DEPLOY, AND SAFE NOT TO RUN AT ALL.
-- It creates a new table and touches nothing that exists. The app probes for
-- it: without the table, sign-in verifies exactly as it does today, with the
-- sub-account's own token or its Private Integration token.
--
-- TO UNDO: `drop table if exists public.hub_ghl_agency;`

create table if not exists public.hub_ghl_agency (
  -- The agency (GoHighLevel "companyId"). One install, one row.
  company_id              text primary key,

  -- Which Marketplace app this install belongs to. A row left by a previous app
  -- holds a refresh token the current secret cannot redeem, and is ignored
  -- rather than silently reused.
  client_id               text not null,

  -- The only long-lived secret here. Replaced on every refresh.
  refresh_token           text not null,

  -- Short-lived, re-minted from the refresh token.
  access_token            text,
  access_expires_at       timestamptz,

  -- What GoHighLevel granted, as it reported it. Recorded so a missing scope is
  -- diagnosable from the row rather than from a 401 months later.
  scopes                  text,

  -- Durable single-winner claim, held only for the seconds a refresh takes.
  -- Expires, for the same reason as 0016: a crashed refresh must not lock
  -- everyone out, and a duplicate refresh only wastes a token.
  claim_id                uuid,
  claimed_at              timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  installed_by            text
);

-- RLS on, no policies, like every Hub table since 0010. This row is the single
-- most powerful credential the system holds: it can read every sub-account in
-- the agency. The service role is the only thing that may touch it.
alter table public.hub_ghl_agency enable row level security;

revoke all on public.hub_ghl_agency from anon;
revoke all on public.hub_ghl_agency from authenticated;

notify pgrst, 'reload schema';
