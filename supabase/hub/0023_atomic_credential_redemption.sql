begin;

alter table public.hub_memberships
  add column if not exists credential_version integer not null default 0
  check (credential_version >= 0);

create or replace function public.hub_bump_credential_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.credential_version := old.credential_version +
    case when new.password_hash is distinct from old.password_hash then 1 else 0 end;
  return new;
end;
$$;
revoke all on function public.hub_bump_credential_version() from public, anon, authenticated;
drop trigger if exists hub_membership_credentials on public.hub_memberships;
create trigger hub_membership_credentials before update on public.hub_memberships
  for each row execute function public.hub_bump_credential_version();

create or replace function public.hub_redeem_invitation(
  p_token_hash text, p_contractor_id uuid, p_email text, p_password_hash text
) returns jsonb language plpgsql security invoker
set search_path = public, pg_temp as $$
declare
  invitation public.hub_invitations%rowtype;
  member public.hub_memberships%rowtype;
  member_id uuid;
  accepted_time timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or
     p_password_hash is null or
     p_password_hash !~ '^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select membership_id into member_id from public.hub_invitations
    where token_hash = p_token_hash;
  if member_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- All redemptions lock the membership first, including distinct reset links.
  select * into member from public.hub_memberships where id = member_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into invitation from public.hub_invitations
    where token_hash = p_token_hash and membership_id = member.id for update;
  if not found or p_contractor_id is null or p_email is null or
     invitation.contractor_id <> p_contractor_id or member.contractor_id <> p_contractor_id or
     lower(invitation.email) <> lower(p_email) or lower(member.email) <> lower(p_email) or
     invitation.role <> 'field' or member.role <> 'field' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if invitation.revoked_at is not null or member.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if invitation.accepted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already-used');
  end if;
  accepted_time := clock_timestamp();
  if invitation.expires_at <= accepted_time then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  update public.hub_memberships set password_hash = p_password_hash,
    activated_at = coalesce(activated_at, accepted_time), updated_at = accepted_time
    where id = member.id returning * into member;
  update public.hub_invitations set accepted_at = accepted_time where id = invitation.id;
  update public.hub_invitations set revoked_at = accepted_time
    where membership_id = member.id and id <> invitation.id
      and accepted_at is null and revoked_at is null;
  return jsonb_build_object('ok', true, 'membership', to_jsonb(member) - 'password_hash');
end;
$$;
revoke all on function public.hub_redeem_invitation(text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.hub_redeem_invitation(text,uuid,text,text) to service_role;

commit;
notify pgrst, 'reload schema';
