-- Hub database only. Browser roles never need whole-table deletion.
-- Preserve ordinary grants, RLS and every service_role privilege.
begin;
do $$
declare
  item record;
begin
  for item in
    select schemaname, tablename from pg_tables
    where schemaname = 'public' and left(tablename, 4) = 'hub_'
  loop
    execute format('revoke truncate on table %I.%I from public, anon, authenticated',
      item.schemaname, item.tablename);
  end loop;
end;
$$;
commit;
