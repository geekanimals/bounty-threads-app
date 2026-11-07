-- Creator self-service "Delete my account" (Settings & privacy, Figma M32).
-- Same steps as public.admin_delete_user, but only for the signed-in creator, only themselves,
-- typed confirmation "DELETE". Never for Super Admins or agency / brand logins.
-- Releases what they claimed (invites / uploaded rows) so the same phone / Instagram can sign up fresh.
create or replace function public.creator_delete_me(p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p_member uuid := auth.uid(); v_ids uuid[]; v_snap jsonb; v_role text;
begin
  if p_member is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if coalesce(p_confirm, '') <> 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;
  select m.role into v_role from public.members m where m.id = p_member;
  if coalesce(v_role, '') <> 'creator' then raise exception 'only creator accounts can be deleted here — contact support' using errcode = '42501'; end if;
  if exists (select 1 from public.platform_admins a where a.user_id = p_member) then raise exception 'Super Admins cannot delete themselves here' using errcode = '42501'; end if;

  select coalesce(array_agg(distinct a.identity_id), '{}') into v_ids
    from intel.ci_identity_actor_access a where a.member_id = p_member and a.access_role = 'self';
  v_ids := coalesce((select array_agg(i) from unnest(v_ids) i
                      where not exists (select 1 from intel.ci_identity_actor_access a where a.identity_id = i and a.access_role = 'self' and a.member_id <> p_member)), '{}');

  select jsonb_build_object('member_id', p_member, 'name', m.name, 'role', m.role, 'email', u.email, 'phone', u.phone,
           'whatsapp', m.whatsapp_e164, 'instagram', (select string_agg(s.username, ', ') from public.social_accounts s where s.member_id = p_member),
           'joined_at', u.created_at, 'identities', to_jsonb(v_ids), 'via', 'self-service delete')
    into v_snap from auth.users u left join public.members m on m.id = u.id where u.id = p_member;

  update intel.ci_campaign_invite set claimed_by = null, claimed_at = null where claimed_by = p_member;
  update intel.ci_creator_upload set joined_member = null, joined_at = null where joined_member = p_member;
  perform set_config('geek.user_purge', 'on', true);
  delete from intel.ci_identity_merge_event e where e.source_identity_id = any(v_ids) or e.target_identity_id = any(v_ids);
  delete from intel.ci_creator_identity where identity_id = any(v_ids);
  delete from auth.users where id = p_member;
  perform set_config('geek.user_purge', '', true);
  insert into public.audit_log(actor, actor_email, action, table_name, row_id, old_data)
  values (null, v_snap->>'email', 'DELETE_USER', 'auth.users', p_member, v_snap);
  return jsonb_build_object('deleted', true);
end $$;
revoke all on function public.creator_delete_me(text) from public, anon;
grant execute on function public.creator_delete_me(text) to authenticated;
