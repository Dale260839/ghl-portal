-- An agency can install both the location app and the sign-in app. Their
-- credentials must not overwrite each other for the same company.
-- Run before deploying the matching HubGhlAgency upsert change. Existing
-- reads and token refreshes keep working; install callbacks should not run
-- during the short interval between this migration and the deployment.

do $$
declare
  pk_name text;
  pk_columns text[];
begin
  select c.conname, array_agg(a.attname::text order by k.position)
    into pk_name, pk_columns
  from pg_constraint c
  join lateral unnest(c.conkey) with ordinality as k(attnum, position) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'public.hub_ghl_agency'::regclass and c.contype = 'p'
  group by c.conname;

  if pk_columns = array['company_id', 'client_id']::text[] then
    return;
  end if;
  if pk_columns is distinct from array['company_id']::text[] then
    raise exception 'Unexpected primary key on public.hub_ghl_agency: %', pk_columns;
  end if;

  execute format('alter table public.hub_ghl_agency drop constraint %I', pk_name);
  alter table public.hub_ghl_agency add primary key (company_id, client_id);
end $$;

notify pgrst, 'reload schema';
