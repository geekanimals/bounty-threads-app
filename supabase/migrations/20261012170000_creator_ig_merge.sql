-- Creator login is WhatsApp-only from now on. Creators who previously signed in with Instagram have an
-- Instagram-only placeholder account (email ig_<id>@creators.bountythreads.app). When they log in with
-- WhatsApp and connect the SAME Instagram, instagram-auth calls this to move that account over instead of
-- refusing with "already connected to another login". ADDITIVE; service_role only.
--
-- Moves: the Instagram connection (social_accounts / social_tokens) and the creator identity (profile,
-- campaigns, contracts, posts — everything keyed on the identity). Disables the old placeholder login.
-- Refuses unless the old account is a placeholder that never verified WhatsApp (a real, separate person's
-- account is never merged).
create or replace function public.ci_merge_ig_placeholder(p_old uuid, p_new uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text; v_new_identity uuid; v_old_identity uuid; v_moved_identity boolean := false;
begin
  if p_old is null or p_new is null or p_old = p_new then raise exception 'bad merge args' using errcode = '22023'; end if;
  select email into v_email from auth.users where id = p_old;
  if v_email is null or v_email !~ '^ig_[0-9]+@creators\.bountythreads\.app$' then
    return jsonb_build_object('merged', false, 'reason', 'not an Instagram-only placeholder');
  end if;
  if exists (select 1 from public.wa_contacts where user_id = p_old and verified_at is not null) then
    return jsonb_build_object('merged', false, 'reason', 'old account has its own verified WhatsApp');
  end if;

  -- 1) Instagram connection: drop the old rows (the caller re-saves them for the new account)
  delete from public.social_tokens   where member_id = p_old and platform = 'instagram';
  delete from public.social_accounts where member_id = p_old and platform = 'instagram';

  -- 2) creator identity: move the old one over unless the new account already has real campaign history
  select identity_id into v_old_identity from intel.ci_identity_actor_access
   where member_id = p_old and access_role = 'self' and revoked_at is null order by granted_at limit 1;
  select identity_id into v_new_identity from intel.ci_identity_actor_access
   where member_id = p_new and access_role = 'self' and revoked_at is null order by granted_at limit 1;
  if v_old_identity is not null then
    if v_new_identity is null or not exists (select 1 from intel.ci_campaign_participation where identity_id = v_new_identity) then
      update intel.ci_identity_actor_access set revoked_at = now()
       where member_id = p_new and access_role = 'self' and revoked_at is null;          -- empty fresh identity
      update intel.ci_identity_actor_access set member_id = p_new
       where member_id = p_old and access_role = 'self' and revoked_at is null;
      v_moved_identity := true;
    end if;
  end if;

  -- 3) the placeholder can no longer sign in
  update auth.users set banned_until = 'infinity'::timestamptz where id = p_old;
  begin execute 'update public.members set status = ''merged'' where id = $1' using p_old; exception when others then null; end;

  return jsonb_build_object('merged', true, 'identity_moved', v_moved_identity, 'old', p_old);
end $$;
revoke all on function public.ci_merge_ig_placeholder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ci_merge_ig_placeholder(uuid, uuid) to service_role;

-- Roll the barter pipeline out to every creator (pilot allowlist no longer enforced). The master switch
-- stays operational_pilot; operators are still only those in intel.ci_agency_operator.
update intel.ci_feature_flag set enabled = false where flag = 'pilot_cohort_enforced';
update intel.ci_feature_flag set enabled = true  where flag in ('operational_pilot', 'creator_profile_api');
