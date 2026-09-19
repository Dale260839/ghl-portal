-- 0015 · A task's own photos and updates, and the two client switches the
-- Visibility screen has always implied but the table never stored.
--
-- WHY
--
-- 1. `hub_photos` and `hub_daily_updates` carry no task column, so a photo taken
--    on a task and an update sent from it were tied to the task only by the
--    words "Task: …" in their caption and text. Readable by a person, matchable
--    by nothing — and §3.6 is explicit that a cross-record link is never keyed
--    on a title. These two nullable columns make the link real, so a task can
--    list its own photos and updates.
--
-- 2. `hub_visibility_settings` stores seven switches. Two more have existed on
--    `Project` and in the portal for months with nowhere to be stored, so
--    "Raise an issue" and "Upload File" could never be turned on for a
--    homeowner: they were permanently off in code.
--
-- SAFE TO RUN BEFORE OR AFTER THE DEPLOY. Every column is nullable or has a
-- default, nothing is rewritten, and the app probes for these columns rather
-- than assuming them: without them it writes photos and updates as before
-- (unlinked) and treats both switches as off, which is what it did yesterday.
-- Re-running is harmless.

alter table public.hub_photos
  add column if not exists task_id uuid references public.hub_tasks(id) on delete set null;

alter table public.hub_daily_updates
  add column if not exists task_id uuid references public.hub_tasks(id) on delete set null;

create index if not exists hub_photos_task on public.hub_photos (task_id);
create index if not exists hub_daily_updates_task on public.hub_daily_updates (task_id);

-- `on delete set null`, not cascade: a photo of the work outlives the task it
-- was filed under. Removing a task must never remove the site record of it.

alter table public.hub_visibility_settings
  add column if not exists allow_issue_submission boolean not null default false,
  add column if not exists allow_file_uploads boolean not null default false;

-- Both default FALSE, like every other switch: no homeowner gains a way to
-- write into a project until a contractor deliberately turns it on.

notify pgrst, 'reload schema';
