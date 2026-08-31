-- ============================================================================
-- PROJECT HUB — initial schema for the Hub's OWN database
--
-- Target: the standalone Supabase project (NOT BuildSuite's).
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run.
--
-- The Hub's application key is a PUBLISHABLE key. It cannot execute DDL, and
-- that is correct: a running app should never be able to change its own schema.
-- So a human runs this once, by hand.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A SEPARATE DATABASE
--
-- BuildSuite's Supabase is production and we never alter a table in it. Rather
-- than ask for write access to someone else's production database, the Hub owns
-- its own. BuildSuite stays read-only, forever, and everything the Hub writes
-- lands here.
--
-- ---------------------------------------------------------------------------
-- THE ONE STRUCTURAL DIFFERENCE FROM THE EARLIER DRAFT
--
-- The version written for BuildSuite's database declared
-- `references public.projects(id)`. That table does not exist here, so those
-- foreign keys are gone. `project_id` is a plain indexed uuid.
--
-- Referential integrity across two databases is the application's job, and the
-- application already does it: every Hub read is filtered by a project id that
-- was itself resolved through a tenant-scoped BuildSuite read. Nothing is
-- weakened by dropping the constraint, because the constraint was never
-- enforceable across a network boundary anyway. It is called out here so nobody
-- later reads the absence as an oversight.
--
-- ---------------------------------------------------------------------------
-- RULES
--
--   1. CREATE ONLY. No ALTER, no DROP, nothing destructive. Safe to re-run.
--   2. Every table is `hub_` prefixed — ownership obvious at a glance.
--   3. RLS ENABLED on every table, with NO permissive policy. Deny by default.
--      The publishable key therefore reads nothing until policies are added
--      deliberately. That is the opposite of BuildSuite's `contractors` table,
--      which the key can read in full because it has no RLS. Not repeating it.
--   4. Every row carries its tenancy: `contractor_id` AND `project_id`.
--   5. Archive, never delete: `archived_at`, plus who archived it and when.
-- ============================================================================


-- ============================================================================
-- SECTION 1 · OPERATIONAL RECORDS
-- The things a project manager creates and the other two experiences display.
-- ============================================================================

-- ── Milestones ──────────────────────────────────────────────────────────────
create table if not exists public.hub_milestones (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  contractor_id     uuid not null,
  milestone_name    text not null,
  sequence          integer not null default 0,
  status            text not null default 'Not Started',
  target_date       date,
  completed_date    date,
  -- The client sees a milestone only when this is true AND the project's
  -- visibility settings allow it. Two switches, both must pass.
  client_visible    boolean not null default false,
  notes             text,
  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text
);

-- ── Schedule ────────────────────────────────────────────────────────────────
create table if not exists public.hub_schedule_items (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  contractor_id     uuid not null,
  title             text not null,
  starts_at         timestamptz,
  ends_at           timestamptz,
  trade             text,
  status            text not null default 'Scheduled',
  client_visible    boolean not null default false,
  notes             text,
  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text
);

-- ── Tasks ───────────────────────────────────────────────────────────────────
create table if not exists public.hub_tasks (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  contractor_id     uuid not null,
  task_name         text not null,
  assigned_trade    text,
  -- The field user this is assigned to, as a Hub membership id. Nullable: an
  -- unassigned task is legitimate and must not be forced onto someone.
  assigned_to       uuid,
  pm_note           text,
  status            text not null default 'Not Started',
  -- The "ding": set when assigned, cleared when the field user acknowledges.
  assigned_at       timestamptz,
  seen_at           timestamptz,
  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text
);

-- ── Daily updates — the review queue, and the spine of the product ──────────
create table if not exists public.hub_daily_updates (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  contractor_id     uuid not null,
  update_date       date not null default current_date,
  submitted_by      text,
  -- TWO SEPARATE FIELDS, AND NOTHING COPIES ONE INTO THE OTHER.
  -- `internal_notes` is what the crew wrote. `client_summary` is what the PM
  -- decided the homeowner reads. Keeping them apart at the column level is why
  -- an internal complaint provably cannot leak into the portal.
  internal_notes    text,
  client_summary    text,
  -- 'Pending' | 'Approved Internally' | 'Approved & Published'.
  -- "Approved Internally" is NOT approved for the client. Only the third value
  -- reaches a homeowner. Both read as approval in English, which is exactly why
  -- the distinction lives in data rather than in a UI convention.
  manager_approval_status text not null default 'Pending',
  client_visible    boolean not null default false,
  published_date    date,
  blocker           text,
  safety_concern    boolean not null default false,
  client_decision_needed boolean not null default false,
  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.hub_update_acknowledgements (
  id                uuid primary key default gen_random_uuid(),
  update_id         uuid not null references public.hub_daily_updates(id) on delete cascade,
  project_id        uuid not null,
  acknowledged_by   text not null,
  acknowledged_at   timestamptz not null default now()
);

create table if not exists public.hub_update_comments (
  id                uuid primary key default gen_random_uuid(),
  update_id         uuid not null references public.hub_daily_updates(id) on delete cascade,
  project_id        uuid not null,
  author            text not null,
  author_role       text not null,
  body              text not null,
  -- A client comment is visible to staff; an internal one is never visible to
  -- the client. Default false means a new comment is internal until someone
  -- says otherwise.
  client_visible    boolean not null default false,
  archived_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- ── Issues ──────────────────────────────────────────────────────────────────
create table if not exists public.hub_issues (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  contractor_id     uuid not null,
  issue_title       text not null,
  category          text,
  description       text,
  priority          text not null default 'Normal',
  status            text not null default 'Open',
  raised_by         text,
  raised_by_role    text,
  client_visible    boolean not null default false,
  resolved_at       timestamptz,
  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Messages ────────────────────────────────────────────────────────────────
create table if not exists public.hub_messages (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  contractor_id     uuid not null,
  author            text not null,
  author_role       text not null,
  body              text not null,
  -- Internal by default. A crew↔PM thread must never surface to a homeowner,
  -- and a homeowner's message must never surface to the crew unless a PM says.
  client_visible    boolean not null default false,
  archived_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- ── Documents and photos ────────────────────────────────────────────────────
create table if not exists public.hub_documents (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  contractor_id     uuid not null,
  title             text not null,
  category          text,
  storage_path      text,
  external_url      text,
  client_visible    boolean not null default false,
  uploaded_by       text,
  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now()
);

create table if not exists public.hub_photos (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  contractor_id     uuid not null,
  caption           text,
  storage_path      text,
  external_url      text,
  taken_at          timestamptz,
  client_visible    boolean not null default false,
  uploaded_by       text,
  related_schedule_item_id uuid references public.hub_schedule_items(id) on delete set null,
  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now()
);

-- ── Per-project visibility switches ─────────────────────────────────────────
-- The contractor's master controls. Every one defaults to FALSE: a new project
-- shows the homeowner nothing until someone decides otherwise.
create table if not exists public.hub_visibility_settings (
  project_id           uuid primary key,
  contractor_id        uuid not null,
  client_portal_enabled boolean not null default false,
  show_schedule        boolean not null default false,
  show_budget          boolean not null default false,
  show_documents       boolean not null default false,
  show_photos          boolean not null default false,
  show_daily_updates   boolean not null default false,
  show_change_orders   boolean not null default false,
  updated_at           timestamptz not null default now(),
  updated_by           text
);


-- ============================================================================
-- SECTION 2 · THE HUB'S OVERLAY ON BUILDSUITE RECORDS
--
-- A project belongs to BuildSuite and we never write there. When a contractor
-- edits or archives one, the change is stored HERE as an overlay and rendered
-- on top of the BuildSuite row, marked as edited in the Hub.
--
-- This is what makes "edit and archive" possible without touching production.
-- ============================================================================

create table if not exists public.hub_project_state (
  project_id        uuid primary key,
  contractor_id     uuid not null,
  -- Field-level overrides. Null means "defer to BuildSuite", which is different
  -- from an empty string meaning "the contractor cleared it".
  title_override    text,
  address_override  text,
  client_name_override text,
  notes             text,
  -- Archiving a job removes it from the default list. Nothing is destroyed and
  -- BuildSuite never learns about it.
  archived_at       timestamptz,
  archived_by       text,
  archive_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text
);

-- ── Activity: who changed what, and when ────────────────────────────────────
-- Append-only by convention. The approval model rests on being able to say who
-- published something, so an edit trail is not optional decoration.
create table if not exists public.hub_activity (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid,
  contractor_id     uuid not null,
  actor             text not null,
  actor_role        text not null,
  action            text not null,
  resource          text not null,
  resource_id       text,
  summary           text,
  created_at        timestamptz not null default now()
);


-- ============================================================================
-- SECTION 3 · TEAM, INVITATIONS AND PERMISSIONS
--
-- The contractor invites their crew and their homeowner. Nothing here lives in
-- BuildSuite: `auth_profiles.user_type` has no `field` value, and adding one
-- would be a write to someone else's production table.
-- ============================================================================

-- ── Who has access ──────────────────────────────────────────────────────────
create table if not exists public.hub_memberships (
  id                uuid primary key default gen_random_uuid(),
  -- The contractor whose team this is. Tenancy key for the whole section.
  contractor_id     uuid not null,
  email             text not null,
  full_name         text,
  -- 'contractor' | 'field' | 'client'. The ROLE IS THE CEILING; per-user grants
  -- below can only narrow it, never widen it.
  role              text not null,
  -- A client is scoped to specific projects; a field user to assigned work; a
  -- contractor to everything of theirs. Empty array = all of the contractor's.
  project_ids       uuid[] not null default '{}',
  -- Set once they accept and choose a password.
  activated_at      timestamptz,
  password_hash     text,
  last_seen_at      timestamptz,
  -- Revoking is instant and reversible; it is not a delete.
  revoked_at        timestamptz,
  revoked_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  invited_by        text
);

-- One live membership per email per contractor. A revoked row keeps its history
-- and does not block a fresh invitation.
create unique index if not exists hub_memberships_live_email
  on public.hub_memberships (contractor_id, lower(email))
  where revoked_at is null;

-- ── Invitations ─────────────────────────────────────────────────────────────
create table if not exists public.hub_invitations (
  id                uuid primary key default gen_random_uuid(),
  contractor_id     uuid not null,
  membership_id     uuid references public.hub_memberships(id) on delete cascade,
  email             text not null,
  role              text not null,
  -- ONLY THE HASH IS STORED. The raw token exists in the emailed link and
  -- nowhere else, so a leak of this table cannot be used to accept invitations.
  token_hash        text not null,
  expires_at        timestamptz not null,
  -- Single use: set the moment it is redeemed, and checked before redemption.
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  created_by        text
);

create unique index if not exists hub_invitations_token_hash
  on public.hub_invitations (token_hash);

-- ── Per-user permission ticks ───────────────────────────────────────────────
-- What the contractor ticked for this person.
--
-- EFFECTIVE PERMISSION = ROLE MATRIX **AND** GRANT. NEVER OR.
--
-- The role decides the maximum; these rows can only remove from it. A field
-- user cannot be ticked into seeing margins, because the role forbids it and
-- the application matrix is closed by default. If this were an OR, a tick box
-- would become a way to grant something dangerous by accident — which is
-- exactly how a homeowner ends up seeing a contractor's margin.
create table if not exists public.hub_grants (
  id                uuid primary key default gen_random_uuid(),
  membership_id     uuid not null references public.hub_memberships(id) on delete cascade,
  contractor_id     uuid not null,
  -- e.g. 'dailyUpdate', 'document', 'photo', 'schedule', 'task', 'issue'
  resource          text not null,
  -- true = ticked (allowed, if the role also allows it); false = explicitly off
  allowed           boolean not null default true,
  updated_at        timestamptz not null default now(),
  updated_by        text
);

create unique index if not exists hub_grants_unique
  on public.hub_grants (membership_id, resource);


-- ============================================================================
-- SECTION 4 · INDEXES
-- Every read is filtered by tenancy first, so that is what gets indexed.
-- ============================================================================

create index if not exists hub_milestones_project      on public.hub_milestones (project_id);
create index if not exists hub_milestones_contractor   on public.hub_milestones (contractor_id);
create index if not exists hub_schedule_project        on public.hub_schedule_items (project_id);
create index if not exists hub_schedule_contractor     on public.hub_schedule_items (contractor_id);
create index if not exists hub_tasks_project           on public.hub_tasks (project_id);
create index if not exists hub_tasks_contractor        on public.hub_tasks (contractor_id);
create index if not exists hub_tasks_assigned          on public.hub_tasks (assigned_to);
create index if not exists hub_updates_project         on public.hub_daily_updates (project_id);
create index if not exists hub_updates_contractor      on public.hub_daily_updates (contractor_id);
create index if not exists hub_updates_status          on public.hub_daily_updates (manager_approval_status);
create index if not exists hub_ack_update              on public.hub_update_acknowledgements (update_id);
create index if not exists hub_comments_update         on public.hub_update_comments (update_id);
create index if not exists hub_issues_project          on public.hub_issues (project_id);
create index if not exists hub_issues_contractor       on public.hub_issues (contractor_id);
create index if not exists hub_messages_project        on public.hub_messages (project_id);
create index if not exists hub_documents_project       on public.hub_documents (project_id);
create index if not exists hub_photos_project          on public.hub_photos (project_id);
create index if not exists hub_visibility_contractor   on public.hub_visibility_settings (contractor_id);
create index if not exists hub_project_state_contractor on public.hub_project_state (contractor_id);
create index if not exists hub_activity_project        on public.hub_activity (project_id, created_at desc);
create index if not exists hub_activity_contractor     on public.hub_activity (contractor_id, created_at desc);
create index if not exists hub_memberships_contractor  on public.hub_memberships (contractor_id);
create index if not exists hub_memberships_email       on public.hub_memberships (lower(email));
create index if not exists hub_invitations_contractor  on public.hub_invitations (contractor_id);
create index if not exists hub_grants_membership       on public.hub_grants (membership_id);


-- ============================================================================
-- SECTION 5 · ROW LEVEL SECURITY — ENABLED, WITH NO POLICY
--
-- Deliberate and it is not an omission. RLS on with no permissive policy means
-- the publishable key can read and write NOTHING. The application reaches these
-- tables through a server-side path that supplies the tenant, and policies get
-- added one at a time as each screen needs them — each one reviewed on its own.
--
-- The alternative, shipping a permissive policy now "to be tightened later", is
-- how BuildSuite's `contractors` table ended up readable in full by a key that
-- should never have seen it.
-- ============================================================================

alter table public.hub_milestones               enable row level security;
alter table public.hub_schedule_items           enable row level security;
alter table public.hub_tasks                    enable row level security;
alter table public.hub_daily_updates            enable row level security;
alter table public.hub_update_acknowledgements  enable row level security;
alter table public.hub_update_comments          enable row level security;
alter table public.hub_issues                   enable row level security;
alter table public.hub_messages                 enable row level security;
alter table public.hub_documents                enable row level security;
alter table public.hub_photos                   enable row level security;
alter table public.hub_visibility_settings      enable row level security;
alter table public.hub_project_state            enable row level security;
alter table public.hub_activity                 enable row level security;
alter table public.hub_memberships              enable row level security;
alter table public.hub_invitations              enable row level security;
alter table public.hub_grants                   enable row level security;


-- ============================================================================
-- WHAT THIS MIGRATION DOES NOT DO
--
--   · It does not touch BuildSuite. Different database entirely.
--   · It does not create RLS policies. Deny-by-default is the starting point.
--   · It does not store a raw invitation token — only a hash.
--   · It does not delete anything, ever. Archive and revoke are timestamps.
--
-- AFTER RUNNING, verify with:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name like 'hub_%'
--   order by table_name;
--
--   -- expect 16 rows
-- ============================================================================
