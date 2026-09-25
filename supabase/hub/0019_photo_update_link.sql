-- 0019 · A photo belongs to the update it was sent with.
--
-- WHY
--
-- `hub_photos` records the project, and since 0015 the task, and nothing about
-- the daily update a photo arrived with. So the homeowner's update feed had no
-- way to know which photographs belonged to which update, and did the only
-- thing it could: it took the two most recent photos on the project and pinned
-- them to the newest update, with a comment in the code admitting that was
-- fixture behaviour.
--
-- The effect on a real project: every update either shows somebody else's
-- photographs or none at all. For a homeowner watching their house being
-- rebuilt, the photographs are the product.
--
-- This is the same fix as 0015 made for tasks, and for the same reason (§3.6):
-- a cross-record link is never keyed on a caption, a timestamp or "the most
-- recent thing".
--
-- WHAT IT DOES NOT CHANGE
--
-- Whether a homeowner may SEE a photo. That is still `client_visible`, still
-- false by default, and still released one photograph at a time by the
-- contractor (Dale's decision, 2026-09-25). Linking a photo to an update says
-- where it belongs, never who may look at it.
--
-- SAFE TO RUN BEFORE OR AFTER THE DEPLOY. The column is nullable, nothing is
-- rewritten, and the app probes for it: without it, photos are written exactly
-- as they were yesterday and the feed shows the text of an update with no
-- photographs rather than the wrong ones. Re-running is harmless.

alter table public.hub_photos
  add column if not exists update_id uuid references public.hub_daily_updates(id) on delete set null;

create index if not exists hub_photos_update on public.hub_photos (update_id);

-- `on delete set null`, not cascade, exactly as 0015 reasoned for tasks: the
-- photograph of the work outlives the paperwork it arrived with. Removing an
-- update must never remove the site record of what was done that day.

notify pgrst, 'reload schema';
