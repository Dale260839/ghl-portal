-- ============================================================================
-- PROJECT HUB — columns the operational records actually need (migration 0003)
--
-- Run in: the Project Hub Supabase project → SQL Editor.
-- Safe to re-run: every statement is `add column if not exists`.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- `0001_initial.sql` created the tables from the schema sketch. When the field
-- update form was wired to them it turned out four fields a crew member
-- actually fills in had no column: what work was done, how many people were on
-- site, hours, and weather. Same for a few on tasks, milestones and issues.
--
-- That is what happens when a schema is written from a design rather than from
-- the form people type into. Adding them rather than pretending the form was
-- wrong.
--
-- These are the Hub's OWN tables. `ALTER` here is not the guardrail violation —
-- that rule is about BuildSuite's database, which this is not, and which we
-- still never touch.
-- ============================================================================

-- ── Daily updates: what the crew actually submits ───────────────────────────
alter table public.hub_daily_updates add column if not exists work_completed text;
alter table public.hub_daily_updates add column if not exists crew_onsite integer;
alter table public.hub_daily_updates add column if not exists hours_worked numeric;
alter table public.hub_daily_updates add column if not exists weather text;

-- ── Milestones: the planned window, not just a target date ──────────────────
alter table public.hub_milestones add column if not exists planned_start date;
alter table public.hub_milestones add column if not exists planned_end date;

-- ── Tasks: when it is meant to happen ───────────────────────────────────────
alter table public.hub_tasks add column if not exists scheduled_date date;
alter table public.hub_tasks add column if not exists client_visible boolean not null default false;

-- ── Issues: the fields the form and the client portal both use ──────────────
--
-- `client_update` and `internal_notes` are separate columns for the same reason
-- they are on daily updates: what the office writes about a problem and what
-- the homeowner is told about it are different texts, and nothing copies one
-- into the other.
alter table public.hub_issues add column if not exists issue_number text;
alter table public.hub_issues add column if not exists project_area text;
alter table public.hub_issues add column if not exists assigned_to text;
alter table public.hub_issues add column if not exists target_resolution_date date;
alter table public.hub_issues add column if not exists internal_notes text;
alter table public.hub_issues add column if not exists client_update text;
alter table public.hub_issues add column if not exists resolution text;
alter table public.hub_issues add column if not exists client_confirmation boolean not null default false;


-- ============================================================================
-- VERIFY
--
--   select column_name from information_schema.columns
--   where table_name = 'hub_daily_updates' order by ordinal_position;
--
--   -- expect work_completed, crew_onsite, hours_worked, weather among them
-- ============================================================================
