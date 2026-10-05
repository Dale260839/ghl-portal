-- Hub database only. Run 0019 first. No project records are rewritten.
begin;

create table if not exists public.hub_upload_budgets (
  contractor_id uuid not null,
  actor_key text not null,
  bucket_start timestamptz not null,
  uploads integer not null default 0,
  bytes bigint not null default 0,
  primary key (contractor_id, actor_key, bucket_start),
  check (uploads >= 0 and bytes >= 0)
);
alter table public.hub_upload_budgets enable row level security;
revoke all on public.hub_upload_budgets from public, anon, authenticated;
grant select, insert, update, delete on public.hub_upload_budgets to service_role;

-- 60 attempts/person/hour and 500 MB of attempted bytes/tenant/UTC day.
-- Failed uploads consume the allowance too, so retry storms remain bounded.
create or replace function public.hub_claim_upload(
  p_contractor_id uuid, p_actor_key text, p_bytes bigint
) returns jsonb language plpgsql security invoker
set search_path = public, pg_temp as $$
declare
  hourly timestamptz := date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC';
  daily timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  claimed integer;
begin
  if p_contractor_id is null or p_actor_key is null or length(p_actor_key) <> 64 or
     p_actor_key !~ '^[a-f0-9]+$' or p_bytes is null or p_bytes <= 0 or p_bytes > 3500000 then
    return jsonb_build_object('allowed', false);
  end if;
  -- One tenant lock makes concurrent reservations across users atomic.
  perform pg_advisory_xact_lock(hashtextextended(p_contractor_id::text, 0));
  begin
    insert into public.hub_upload_budgets as b
      (contractor_id, actor_key, bucket_start, uploads, bytes)
      values (p_contractor_id, p_actor_key, hourly, 1, p_bytes)
      on conflict (contractor_id, actor_key, bucket_start)
      do update set uploads = b.uploads + 1, bytes = b.bytes + excluded.bytes
      where b.uploads < 60
      returning uploads into claimed;
    if claimed is null then raise exception 'upload quota' using errcode = 'P0001'; end if;
    claimed := null;
    insert into public.hub_upload_budgets as b
      (contractor_id, actor_key, bucket_start, uploads, bytes)
      values (p_contractor_id, 'tenant', daily, 1, p_bytes)
      on conflict (contractor_id, actor_key, bucket_start)
      do update set uploads = b.uploads + 1, bytes = b.bytes + excluded.bytes
      where b.bytes + excluded.bytes <= 500000000
      returning uploads into claimed;
    if claimed is null then raise exception 'upload quota' using errcode = 'P0001'; end if;
  exception when sqlstate 'P0001' then
    -- The nested block rolls back both counters on refusal.
    return jsonb_build_object('allowed', false);
  end;
  delete from public.hub_upload_budgets
    where contractor_id = p_contractor_id and bucket_start < now() - interval '7 days';
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.hub_claim_upload(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.hub_claim_upload(uuid, text, bigint) to service_role;

create or replace function public.hub_check_photo_update()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  if new.update_id is not null then
    if not exists (
      select 1 from public.hub_daily_updates u
      where u.id = new.update_id and u.project_id = new.project_id
        and u.contractor_id = new.contractor_id and u.archived_at is null
    ) then raise exception 'Photo update must belong to the same contractor and project'; end if;
    if tg_op = 'UPDATE' and old.update_id is not null and old.update_id <> new.update_id then
      raise exception 'Photo is already linked to another update';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger hub_photo_update_guard
  before insert or update of update_id, project_id, contractor_id on public.hub_photos
  for each row execute function public.hub_check_photo_update();
commit;
notify pgrst, 'reload schema';
