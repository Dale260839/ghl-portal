-- ============================================================================
-- Project Hub — own tables (migration 0001)
--
-- RUN THIS WITH THE SERVICE-ROLE KEY OR THE SUPABASE SQL EDITOR.
-- The Hub's application key is a publishable key and cannot execute DDL, which
-- is correct — the running app should never be able to change the schema.
--
-- ---------------------------------------------------------------------------
-- REWRITTEN 2026-08-22. This migration has never been run, so there is no
-- deployed state to migrate from and correcting it in place is safe.
--
-- The earlier version created eight tables — milestones, schedule, daily
-- updates, acknowledgements, comments, messages, documents, photos — on the
-- reasoning that GHL custom objects were not reachable yet and the client
-- needed those screens now (D-014).
--
-- The adopted source documents settle it the other way, and unanimously:
--
--   D1 p2   after handoff, GHL creates and manages milestones, tasks, daily
--           updates, selections, change orders, documents, invoices
--   D2 §5   the same list, as GHL custom objects
--   D3 §3   "everything else is created inside GHL after handoff ... that
--           separation is what keeps both systems clean"
--   D4 §2   GHL owns operational state; Supabase is for media and tagging
--
-- Those tables would have been a second home for records GHL owns. Two systems
-- writing the same operational record is how a project ends up in two states
-- with no way to say which is right — the reason D1 makes the handoff
-- one-directional in the first place.
--
-- So this migration now creates only what the Hub genuinely owns and GHL does
-- not model. D4 §5 is explicit about what that is: "the PM decision buttons
-- live in the Hub only — nothing in GHL." Deciding what a homeowner sees is the
-- Hub's job. Everything else it reflects.
--
-- Reconciliation: docs/SOURCE-OF-TRUTH.md §1 C-1.
-- ---------------------------------------------------------------------------
-- RULES THIS MIGRATION FOLLOWS
--
--   1. It CREATES ONLY. No ALTER, no DROP, no changes to any existing table.
--      BuildSuite's tables are untouched.
--   2. Every table is prefixed `hub_`, so ownership is obvious at a glance and
--      nothing can collide with a future BuildSuite table.
--   3. Every table has RLS ENABLED with an explicit deny-by-default posture.
--      This is deliberate: the existing publishable key can already read
--      `contractors` including names and phone numbers, because those tables
--      have no RLS. We are not repeating that.
--   4. Every table carries BOTH tenancy keys — `auth_profile_id` (which
--      contractor owns it) and `project_id` (which project) — so a row can
--      never be read without knowing whose it is.
--   5. Foreign keys reference `projects(id)`, BuildSuite's real primary key.
--      There is no `BSP-` identifier in this database, and `ghl_opportunity_id`
--      is empty on every live row (measured 2026-08-20). The shared key is an
--      open decision — SOURCE-OF-TRUTH.md C-3 — and this migration deliberately
--      does not pre-empt it.
-- ============================================================================


-- ── The publish decision ────────────────────────────────────────────────────
--
-- The one thing the Hub owns outright (D4 §5). A field update lives in GHL; the
-- PM's judgement about what the homeowner should read about it lives here.
--
-- `client_summary` is stored because it is the PM's own words, not the crew's —
-- §12.2 keeps them as two separate fields and nothing copies one into the
-- other. The crew's `internal_notes` are NOT stored here: they belong to the
-- GHL record, and a value we never hold cannot leak from us.
create table if not exists public.hub_publication_decisions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  auth_profile_id   uuid not null,

  -- Which GHL record this decision is about. Text rather than a foreign key:
  -- the record lives in GoHighLevel, not in this database.
  ghl_record_id     text not null,
  ghl_record_type   text not null default 'daily_update',

  -- §6.4 enum, verbatim: Pending / Returned / Approved Internally /
  -- Approved & Published. Only the last reaches a client, and the two that
  -- contain the word "Approved" are the easiest pair in the system to confuse.
  manager_approval_status text not null default 'Pending',

  -- The PM's edit — the only publish candidate (§12.2).
  client_summary    text not null default '',

  -- Who decided, and when. §10 and §12.1 assume a named project manager; an
  -- approval nobody signed is the one record you would want in a dispute.
  decided_by        text not null default '',
  decided_at        timestamptz,
  publish_date      date,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (ghl_record_type, ghl_record_id)
);


-- ── Client visibility settings ──────────────────────────────────────────────
--
-- The §6.1 switches, per project. Held here rather than on the GHL custom
-- object for one reason: they are clauses of the §9.1 gate, which is enforced
-- in this application's code. A switch the Hub enforces should be a switch the
-- Hub stores.
--
-- If the GHL project object turns out to carry these fields, this table becomes
-- a cache and the object becomes the source. That is a smaller decision than it
-- looks — the gate reads one function either way.
create table if not exists public.hub_visibility_settings (
  project_id            uuid primary key references public.projects(id) on delete cascade,
  auth_profile_id       uuid not null,

  -- Every switch defaults to FALSE. Fail closed: nobody has decided any of this
  -- may reach a homeowner until somebody says so.
  client_portal_enabled boolean not null default false,
  show_budget           boolean not null default false,
  show_detailed_pricing boolean not null default false,
  show_schedule         boolean not null default false,
  show_assigned_team    boolean not null default false,
  allow_messaging       boolean not null default false,
  allow_issue_submission boolean not null default false,
  allow_file_uploads    boolean not null default false,

  updated_by            text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);


-- ── Media ───────────────────────────────────────────────────────────────────
--
-- D4 §2 and §8: photos and documents, stored and "tagged to the contractor,
-- recallable". The only operational content the Hub holds, and it holds it
-- because storage is the one thing GHL is not the natural home for.
--
-- NOTE: D4 §11 lists media storage as an OPEN QUESTION — the contractor's own
-- GHL media storage versus Supabase. This table stores metadata and a pointer,
-- not the bytes, so either answer works: `storage_path` becomes a Supabase
-- object path or a GHL media URL. Do not build the upload path until that is
-- decided.
create table if not exists public.hub_media (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  auth_profile_id   uuid not null,

  kind              text not null default 'photo',   -- photo | document | video
  file_name         text not null,
  storage_path      text not null,
  content_type      text not null default '',
  size_bytes        bigint,

  caption           text not null default '',
  project_area      text not null default '',
  category          text not null default '',

  -- Default-deny, same as everything else the client can see. An item uploaded
  -- and never reviewed does not reach a homeowner by sitting there.
  client_visible    boolean not null default false,

  uploaded_by       text not null default '',
  uploaded_at       timestamptz not null default now()
);


-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Tenant-first on every one: the leading column is what every read filters on.
create index if not exists hub_publication_decisions_tenant_idx
  on public.hub_publication_decisions (auth_profile_id, project_id);
create index if not exists hub_publication_decisions_record_idx
  on public.hub_publication_decisions (ghl_record_type, ghl_record_id);
create index if not exists hub_visibility_settings_tenant_idx
  on public.hub_visibility_settings (auth_profile_id);
create index if not exists hub_media_tenant_idx
  on public.hub_media (auth_profile_id, project_id);
create index if not exists hub_media_visible_idx
  on public.hub_media (project_id, client_visible);


-- ============================================================================
-- ROW LEVEL SECURITY — deny by default.
--
-- Enabling RLS with no permissive policy denies everything, including to the
-- publishable key. That is the intended starting state: the Hub reaches these
-- tables through the service role from its own server, where the §9.1 gate and
-- tenant scoping are already enforced in application code and tested.
--
-- We do NOT add a permissive policy for the publishable key. Doing so would
-- make these tables readable from any browser that has ever loaded the app —
-- which is exactly the exposure `contractors` has today.
-- ============================================================================
alter table public.hub_publication_decisions enable row level security;
alter table public.hub_visibility_settings   enable row level security;
alter table public.hub_media                 enable row level security;


-- ============================================================================
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * It does not touch `projects`, `deals`, `contractors`, `auth_profiles`,
--     `proposals`, or `documents`. No ALTER, no DROP, no data change.
--   * It does not create tables for milestones, schedule, daily updates,
--     messages, selections, change orders, issues, punch list or warranty.
--     GoHighLevel owns those after handoff (D1 p2, D2 §5, D3 §3, D4 §2). The
--     Hub reads them; it does not keep a second copy.
--   * It does not grant the publishable key any access. See the RLS note.
--   * It does not decide the shared cross-system key. See SOURCE-OF-TRUTH C-3.
-- ============================================================================
