-- ============================================================================
-- PROJECT HUB — material selections and change orders (migration 0009)
--
-- Run in: the Project Hub Supabase project → SQL Editor. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHY THESE TWO AND NOTHING ELSE
--
-- Six screens existed with no write path. Four were wired on 2026-09-09 against
-- tables that already existed since 0001 — schedule, milestones, documents,
-- photos. These are the two that had no table at all, which is the only reason
-- they were left.
--
-- The columns are transcribed from `MaterialSelection` (§6.5) and `ChangeOrder`
-- (§6.6) in `lib/data/types.ts`. Nothing is invented: where the type has a
-- field, there is a column; where it does not, there is not.
--
-- ---------------------------------------------------------------------------
-- MONEY IS numeric(14,2), NEVER float
--
-- A float would make $1,773.75 into 1773.7500000000002 somewhere down the line,
-- and that figure ends up on an invoice a homeowner is asked to pay. Same type
-- the invoice drafts table already uses.
--
-- ---------------------------------------------------------------------------
-- ONE INTERNAL FIELD, AND IT IS MARKED
--
-- `hub_selections.actual_cost` is on the §9.3 deny-list. It lives here because
-- the contractor's own screen needs it, and it must never be serialized into a
-- client response. `stripInternalFields` drops it by name, `clientSelection()`
-- drops it by construction, and a guardrail test fails if a client-facing
-- projection ever carries it. The column comment says so too, because the next
-- person to write a query will read the schema before they read the tests.
-- ============================================================================


-- ── Material selections (§6.5) ───────────────────────────────────────────────
create table if not exists public.hub_selections (
  id                uuid primary key default gen_random_uuid(),

  -- Tenancy. `contractor_id` is `contractors.id`, NOT an auth profile id — the
  -- two were conflated once and it hid a contractor's own records.
  project_id        uuid not null,
  contractor_id     uuid not null,

  selection_name    text not null,
  category          text,
  room_or_area      text,
  manufacturer      text,
  product           text,
  color_finish      text,
  supplier          text,

  -- The client-visible money (§9.3 allow-list).
  allowance         numeric(14,2),
  upgrade_amount    numeric(14,2),
  credit_amount     numeric(14,2),

  -- §9.3 DENY-LIST. Never serialized into a client response, under any path.
  actual_cost       numeric(14,2),

  lead_time         text,
  approval_deadline date,

  status            text not null default 'Pending'
                      check (status in ('Pending', 'Awaiting Client', 'Approved',
                                        'Rejected', 'Ordered', 'Installed')),

  -- What the homeowner said, when they have said anything.
  client_decision   text,
  client_comments   text,
  approved_date     date,

  -- Off by default. A new selection is the contractor's until they release it.
  client_visible    boolean not null default false,

  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text
);

comment on column public.hub_selections.actual_cost is
  'INTERNAL (section 9.3). What the contractor actually pays. Never send this to a client.';


-- ── Change orders (§6.6) ─────────────────────────────────────────────────────
create table if not exists public.hub_change_orders (
  id                uuid primary key default gen_random_uuid(),

  project_id        uuid not null,
  contractor_id     uuid not null,

  -- Numbered per project, not globally. "CO-3" means the third on THIS job,
  -- which is what a contractor and a homeowner both say out loud.
  change_order_number text not null,
  title             text not null,
  description       text,
  reason            text,
  requested_by      text,

  added_cost        numeric(14,2) not null default 0,
  credit_amount     numeric(14,2) not null default 0,
  tax               numeric(14,2) not null default 0,

  schedule_impact_days      integer not null default 0,
  revised_completion_date   date,
  approval_deadline         date,
  payment_requirement       text,

  status            text not null default 'Draft'
                      check (status in ('Draft', 'Awaiting Client', 'Approved', 'Rejected')),

  client_comments   text,
  approved_by       text,
  approval_date     date,
  invoice_status    text,
  payment_status    text,

  client_visible    boolean not null default false,

  archived_at       timestamptz,
  archived_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text
);

-- A change order number is unique within its project. Two "CO-3"s on one job is
-- two documents a homeowner could be asked to approve, believing they are one.
create unique index if not exists hub_change_orders_number_idx
  on public.hub_change_orders (project_id, change_order_number)
  where archived_at is null;


-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Every list read filters on contractor + project, in that order.
create index if not exists hub_selections_tenant_idx
  on public.hub_selections (contractor_id, project_id)
  where archived_at is null;

create index if not exists hub_change_orders_tenant_idx
  on public.hub_change_orders (contractor_id, project_id)
  where archived_at is null;


-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Enabled, then left with no policies — exactly what 0001 does for every other
-- table, and what 0002 relaxes for development. These two must not be the
-- exception that is quietly open when the rest are closed.
alter table public.hub_selections enable row level security;
alter table public.hub_change_orders enable row level security;


-- ============================================================================
-- VERIFY
--
--   select table_name from information_schema.tables
--    where table_name in ('hub_selections', 'hub_change_orders');
--
-- Expect two rows. If you get none, the script did not run.
-- ============================================================================
