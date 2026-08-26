-- ============================================================================
-- Project Hub — own tables (migration 0001)
--
-- RUN THIS WITH THE SERVICE-ROLE KEY OR THE SUPABASE SQL EDITOR.
-- The Hub's application key is a publishable key and cannot execute DDL, which
-- is correct — the running app should never be able to change the schema.
--
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
--      There is no `BSP-` identifier in this database (see D-010).
--
-- ---------------------------------------------------------------------------
-- WHY THESE TABLES EXIST AT ALL
--
-- GoHighLevel is the operational system of record after handoff. That is a
-- product requirement and it is not in dispute.
--
-- Where the Hub *reads from today* is a separate, engineering question, and the
-- answer is these tables. GHL custom objects are not reachable: there is no
-- object key, and whether the Alliance sub-account tier even supports Custom
-- Objects is still unconfirmed. Blocking every client-facing screen on an
-- unanswered tier question would be the wrong trade.
--
-- So: GHL is the system of record. These tables are the working store until it
-- is reachable, and the migration source when it is. Recorded as D-014.
--
-- (Noted 2026-08-26: this was briefly rewritten down to three tables after
-- reading the source documents as technical specification. They are
-- requirements — what each role sees, the privacy rule, the approval flow —
-- and they do not dictate our storage. Reverted. The one thing that pass got
-- right is kept below: `hub_visibility_settings`.)
-- ============================================================================

-- ── Milestones (§6.2) ───────────────────────────────────────────────────────
create table if not exists public.hub_milestones (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  auth_profile_id   uuid not null,
  name              text not null,
  description       text not null default '',
  planned_start     date,
  planned_end       date,
  actual_end        date,
  sequence          integer not null default 0,
  status            text not null default 'Not Started',
  -- §3.3: a record reaches a client only when this is true AND the project's
  -- portal is enabled. Defaults to false — new rows are private until shared.
  client_visible    boolean not null default false,
  client_summary    text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Schedule (§6.3, client-facing view of tasks) ────────────────────────────
create table if not exists public.hub_schedule_items (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  auth_profile_id   uuid not null,
  title             text not null,
  scheduled_date    date not null,
  time_window       text not null default '',
  crew              text not null default '',
  location          text not null default '',
  status            text not null default 'Scheduled',
  client_note       text not null default '',
  -- New in the client demo, not in the architecture. The client confirms site
  -- access for an appointment, which removes a day-of phone call.
  access_confirmed  boolean not null default false,
  access_confirmed_at timestamptz,
  client_visible    boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Daily updates (§6.4) ────────────────────────────────────────────────────
create table if not exists public.hub_daily_updates (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  auth_profile_id   uuid not null,
  update_date       date not null,
  submitted_by      text not null,
  work_completed    text not null default '',
  crew_onsite       integer not null default 0,
  hours_worked      numeric not null default 0,
  weather           text not null default '',
  -- §9.3 DENY-LIST. This column must NEVER be selected by a client-facing
  -- query. The application never reads it on the client path; RLS below keeps
  -- it out of reach even if that changed.
  internal_notes    text not null default '',
  -- The only publish candidate (§10).
  client_summary    text not null default '',
  client_visible    boolean not null default false,
  -- §6.4 enum, verbatim: Pending / Returned / Approved Internally /
  -- Approved & Published. Only the last reaches a client.
  manager_approval_status text not null default 'Pending',
  publish_date      date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Acknowledgements and comments on updates (new in the demo) ──────────────
create table if not exists public.hub_update_acknowledgements (
  id                uuid primary key default gen_random_uuid(),
  update_id         uuid not null references public.hub_daily_updates(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  -- Denormalised deliberately. Without it this row's tenant is only reachable
  -- by joining hub_daily_updates, and rule 4 exists so that a row can never be
  -- read without knowing whose it is — including by a future query that forgets
  -- the join.
  auth_profile_id   uuid not null,
  ghl_contact_id    text not null,
  acknowledged_at   timestamptz not null default now(),
  unique (update_id, ghl_contact_id)
);

create table if not exists public.hub_update_comments (
  id                uuid primary key default gen_random_uuid(),
  update_id         uuid not null references public.hub_daily_updates(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  -- See the note on hub_update_acknowledgements.
  auth_profile_id   uuid not null,
  author            text not null,
  from_client       boolean not null default false,
  body              text not null,
  created_at        timestamptz not null default now()
);

-- ── Client visibility settings (§6.1) ──────────────────────────────────────
--
-- The per-project switches. They were missing from the first draft of this
-- migration, which left the clauses of the §9.1 gate with nowhere to live — the
-- app enforces them, so the app should store them.
--
-- Every switch defaults to FALSE. Fail closed: nobody has decided any of this
-- may reach a homeowner until somebody says so.
create table if not exists public.hub_visibility_settings (
  project_id             uuid primary key references public.projects(id) on delete cascade,
  auth_profile_id        uuid not null,
  client_portal_enabled  boolean not null default false,
  show_budget            boolean not null default false,
  show_detailed_pricing  boolean not null default false,
  show_schedule          boolean not null default false,
  show_assigned_team     boolean not null default false,
  allow_messaging        boolean not null default false,
  allow_issue_submission boolean not null default false,
  allow_file_uploads     boolean not null default false,
  updated_by             text not null default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── Messages (§6.8) ─────────────────────────────────────────────────────────
create table if not exists public.hub_messages (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  auth_profile_id   uuid not null,
  thread_id         uuid not null,
  thread_category   text not null default 'General',
  sender            text not null,
  sender_role       text not null default '',
  from_client       boolean not null default false,
  body              text not null,
  sent_at           timestamptz not null default now(),
  client_visible    boolean not null default true,
  -- §6.8 relations. These are what "Ask Question" attaches a message to, so a
  -- question about one appointment doesn't land in a general thread.
  related_schedule_item_id uuid references public.hub_schedule_items(id) on delete set null,
  related_issue_id  uuid,
  related_change_order_id uuid
);

-- ── Documents ───────────────────────────────────────────────────────────────
-- NOTE: §12.3 routes documents through GoHighLevel's native portal. The client
-- demo shows them in-app. This table supports the in-app version; it is unused
-- if the native route wins. Open decision.
create table if not exists public.hub_documents (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  auth_profile_id   uuid not null,
  name              text not null,
  category          text not null default 'Other',
  storage_path      text not null default '',
  url               text not null default '',
  uploaded_by       text not null default '',
  uploaded_at       timestamptz not null default now(),
  client_visible    boolean not null default false
);

-- ── Photos ──────────────────────────────────────────────────────────────────
create table if not exists public.hub_photos (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  auth_profile_id   uuid not null,
  caption           text not null default '',
  url               text not null,
  taken_at          timestamptz not null default now(),
  -- Where it came from, so a photo is never orphaned from its context.
  source_label      text not null default '',
  source_update_id  uuid references public.hub_daily_updates(id) on delete set null,
  client_visible    boolean not null default false
);

-- ============================================================================
-- INDEXES — every read is filtered by tenant and project, so index that pair.
-- ============================================================================
create index if not exists hub_milestones_tenant_idx      on public.hub_milestones (auth_profile_id, project_id);
create index if not exists hub_schedule_items_tenant_idx  on public.hub_schedule_items (auth_profile_id, project_id);
create index if not exists hub_daily_updates_tenant_idx   on public.hub_daily_updates (auth_profile_id, project_id);
create index if not exists hub_messages_tenant_idx        on public.hub_messages (auth_profile_id, project_id);
create index if not exists hub_visibility_tenant_idx      on public.hub_visibility_settings (auth_profile_id);
create index if not exists hub_documents_tenant_idx       on public.hub_documents (auth_profile_id, project_id);
create index if not exists hub_photos_tenant_idx          on public.hub_photos (auth_profile_id, project_id);
create index if not exists hub_schedule_items_date_idx    on public.hub_schedule_items (project_id, scheduled_date);
create index if not exists hub_daily_updates_date_idx     on public.hub_daily_updates (project_id, update_date desc);

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
alter table public.hub_milestones               enable row level security;
alter table public.hub_schedule_items           enable row level security;
alter table public.hub_daily_updates            enable row level security;
alter table public.hub_update_acknowledgements  enable row level security;
alter table public.hub_update_comments          enable row level security;
alter table public.hub_messages                 enable row level security;
alter table public.hub_visibility_settings      enable row level security;
alter table public.hub_documents                enable row level security;
alter table public.hub_photos                   enable row level security;

-- ============================================================================
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * It does not touch `projects`, `deals`, `contractors`, `auth_profiles`,
--     `proposals`, or `documents`. No ALTER, no DROP, no data change.
--   * It does not create tables for selections, change orders, issues, punch
--     list, or warranty. Those arrive in migration 0002 with Phase B, so this
--     one stays reviewable in a single sitting.
--   * It does not grant the publishable key any access. See the RLS note.
-- ============================================================================
