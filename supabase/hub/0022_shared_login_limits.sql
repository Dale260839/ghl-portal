-- Hub database only. Apply before deploying shared-login-limit.ts.
begin;

create table if not exists public.hub_login_attempts (
  kind text not null check (kind in ('code', 'password')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  attempts integer not null check (attempts > 0),
  resets_at timestamptz not null,
  primary key (kind, key_hash)
);
create index if not exists hub_login_attempts_expiry on public.hub_login_attempts (resets_at);
alter table public.hub_login_attempts enable row level security;
revoke all on public.hub_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.hub_login_attempts to service_role;

create or replace function public.hub_consume_login_attempt(p_kind text, p_keys text[])
returns jsonb language plpgsql security invoker
set search_path = public, pg_temp as $$
declare
  cap integer;
  window_length interval;
  stamp timestamptz := clock_timestamp();
  key_value text;
  used integer;
  expires timestamptz;
  retry_seconds integer := 0;
begin
  if p_kind = 'code' then cap := 5; window_length := interval '1 hour';
  elsif p_kind = 'password' then cap := 10; window_length := interval '15 minutes';
  else raise exception 'Invalid login limit kind';
  end if;
  if p_keys is null or cardinality(p_keys) not between 1 and 2 or
     exists (select 1 from unnest(p_keys) k where k is null or k !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid login limit keys';
  end if;

  -- Stable lock order prevents overlapping email/IP claims deadlocking.
  -- ON CONFLICT locks each existing counter before testing or incrementing it.
  for key_value in select distinct k from unnest(p_keys) k order by k loop
    insert into public.hub_login_attempts as a (kind, key_hash, attempts, resets_at)
      values (p_kind, key_value, 1, stamp + window_length)
      on conflict (kind, key_hash) do update set
        attempts = case when a.resets_at <= stamp then 1 else least(a.attempts + 1, cap + 1) end,
        resets_at = case when a.resets_at <= stamp then stamp + window_length else a.resets_at end
      returning attempts, resets_at into used, expires;
    if used > cap then
      retry_seconds := greatest(retry_seconds, greatest(1, ceil(extract(epoch from expires - stamp))::integer));
    end if;
  end loop;

  -- Bounded cleanup of expired counters only; no client/project records touched.
  delete from public.hub_login_attempts where (kind, key_hash) in (
    select kind, key_hash from public.hub_login_attempts where resets_at <= stamp
      order by resets_at limit 100 for update skip locked
  );
  return jsonb_build_object('allowed', retry_seconds = 0, 'retryAfterSeconds', retry_seconds);
end;
$$;
revoke all on function public.hub_consume_login_attempt(text, text[]) from public, anon, authenticated;
grant execute on function public.hub_consume_login_attempt(text, text[]) to service_role;
commit;
notify pgrst, 'reload schema';
