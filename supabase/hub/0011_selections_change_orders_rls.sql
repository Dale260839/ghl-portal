-- 0011 · Selections and change orders: match the RLS posture of every other Hub table.
--
-- 0009 created hub_selections and hub_change_orders and ENABLED row level
-- security on both, with no policies. Every other Hub table has RLS disabled
-- (0002, 0007) because the app reaches the Hub with a key that RLS applies to.
-- The effect on production, seen 10 Sep on the APS pilot project: both screens
-- rendered, both lists were always empty, and every Add silently failed with
-- a row-level-security refusal. Nothing was lost; nothing was ever written.
--
-- Run this in the Supabase SQL editor for project nexpqqxarimqmntnvzff, then
-- reload a project's Change Orders tab and add one. It should appear.
--
-- When 0010 is eventually applied (RLS back on everywhere, after the key is
-- swapped for the service role), it re-enables these two along with the rest.

alter table public.hub_selections    disable row level security;
alter table public.hub_change_orders disable row level security;
