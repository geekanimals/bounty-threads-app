-- Every creator gets their profile identity straight away.
-- Bug: a brand-new creator opened "Creator Profile" and saw
--   "Couldn't load your profile. no creator identity for caller"
-- because the identity was only made by a button flow (bootstrap) that the page never reached.
-- Now: made when the creator's member row appears, when their Instagram connects, and for everyone missing one today.

create or replace function private.ci_ensure_identity_for(p_member uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  if p_member is null then return null; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null
   order by a.granted_at limit 1;
  if v_identity is null then
    insert into intel.ci_creator_identity(display_name, kind, is_claimed)
      values (null, 'creator', true) returning identity_id into v_identity;
    insert into intel.ci_identity_actor_access(identity_id, member_id, access_role, granted_by)
      values (v_identity, p_member, 'self', p_member)
      on conflict (identity_id, member_id, access_role) do nothing;
  end if;
  insert into intel.ci_creator_professional_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into intel.ci_creator_commercial_preference(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into intel.ci_profile_completion(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into private.creator_personal_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into private.creator_contact(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  return v_identity;
end $$;
revoke all on function private.ci_ensure_identity_for(uuid) from public, anon, authenticated;

-- never block a sign-up or an Instagram connect if this fails
create or replace function private.tg_ci_identity_for_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_m uuid;
begin
  if tg_table_name = 'members' then
    if coalesce(new.role, 'creator') <> 'creator' then return new; end if;
    v_m := new.id;
  else
    if coalesce(new.platform, 'instagram') <> 'instagram' then return new; end if;
    v_m := new.member_id;
    if not exists (select 1 from public.members m where m.id = v_m and coalesce(m.role, 'creator') = 'creator') then return new; end if;
  end if;
  begin perform private.ci_ensure_identity_for(v_m); exception when others then null; end;
  return new;
end $$;

drop trigger if exists ci_identity_on_member on public.members;
create trigger ci_identity_on_member after insert or update of role on public.members
  for each row execute function private.tg_ci_identity_for_creator();
drop trigger if exists ci_identity_on_instagram on public.social_accounts;
create trigger ci_identity_on_instagram after insert on public.social_accounts
  for each row execute function private.tg_ci_identity_for_creator();

-- everyone who is a creator today but has no identity yet
do $$
declare r record;
begin
  for r in select m.id from public.members m
            where coalesce(m.role, 'creator') = 'creator'
              and not exists (select 1 from intel.ci_identity_actor_access a
                               where a.member_id = m.id and a.access_role = 'self' and a.revoked_at is null)
  loop
    begin perform private.ci_ensure_identity_for(r.id); exception when others then null; end;
  end loop;
end $$;
