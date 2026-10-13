begin;

create table if not exists public.hub_browser_handoffs (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  owner_hash text not null check (owner_hash ~ '^[0-9a-f]{64}$'),
  session_token text not null check (length(session_token) between 1 and 16000),
  expires_at timestamptz not null
);
create index if not exists hub_browser_handoffs_owner on public.hub_browser_handoffs(owner_hash);
alter table public.hub_browser_handoffs enable row level security;
revoke all on public.hub_browser_handoffs from public, anon, authenticated;
grant all on public.hub_browser_handoffs to service_role;

create or replace function public.hub_create_browser_handoff(
  p_token_hash text, p_owner_hash text, p_session_token text, p_expires_at timestamptz
) returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or
     p_owner_hash is null or p_owner_hash !~ '^[0-9a-f]{64}$' or
     p_session_token is null or length(p_session_token) not between 1 and 16000 or
     p_expires_at is null or p_expires_at <= clock_timestamp() or
     p_expires_at > clock_timestamp() + interval '2 minutes' then
    raise exception 'Invalid browser handoff';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_hash, 0));
  delete from public.hub_browser_handoffs where expires_at <= clock_timestamp() or owner_hash = p_owner_hash;
  insert into public.hub_browser_handoffs values(p_token_hash,p_owner_hash,p_session_token,p_expires_at);
end;
$$;

create or replace function public.hub_consume_browser_handoff(p_token_hash text)
returns text language plpgsql security invoker set search_path = public, pg_temp as $$
declare claimed text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  -- DELETE RETURNING claims once even when separate server processes contend.
  delete from public.hub_browser_handoffs
    where token_hash = p_token_hash and expires_at > clock_timestamp()
    returning session_token into claimed;
  return claimed;
end;
$$;
revoke all on function public.hub_create_browser_handoff(text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.hub_consume_browser_handoff(text) from public, anon, authenticated;
grant execute on function public.hub_create_browser_handoff(text,text,text,timestamptz) to service_role;
grant execute on function public.hub_consume_browser_handoff(text) to service_role;

commit;
notify pgrst, 'reload schema';
