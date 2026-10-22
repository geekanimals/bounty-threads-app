-- Super Admin → Creators: more facts per creator for the filter bar (age, marital status, pets, parent / mom,
-- languages, content types, WhatsApp verified, blocklisted, bio).
-- Super Admin → All users: delete a user completely (account + creator profile + campaign history) so the
-- same phone / email / Instagram can sign up again fresh.

-- ============================== 1. creator facts for filters ==============================
create or replace function public.admin_creator_facts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(m.id, jsonb_strip_nulls(jsonb_build_object(
      'age', case when per.date_of_birth is not null then extract(year from age(per.date_of_birth))::int end,
      'marital', per.marital_status,
      'has_pet', coalesce(per.has_pet, false) or exists (select 1 from private.creator_pet p where p.identity_id = idn.identity_id),
      'pet_types', (select jsonb_agg(distinct lower(t)) from (select p.pet_type t from private.creator_pet p where p.identity_id = idn.identity_id
                      union select per.pet_type) x where coalesce(btrim(t),'') <> ''),
      'languages', to_jsonb(pr.languages),
      'formats', to_jsonb(pr.content_formats),
      'wa_verified', (con.whatsapp_verified_at is not null or exists (select 1 from public.wa_contacts w where w.user_id = m.id and w.verified_at is not null)),
      'blocked', exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = idn.identity_id and b.lifted_at is null),
      -- parent: says so in their niche, bio or captions (mom, mommy, mumma, momlife, dad, baby, toddler, kids, parenting…)
      'parent', (exists (select 1 from unnest(coalesce(pr.categories, '{}')) c where c ~* 'parent|mom|kid|baby')
                 or lower(coalesce(sa.biography,'') || ' ' || coalesce(pr.bio,'') || ' ' ||
                          coalesce((select string_agg(e->>'caption', ' ') from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e), ''))
                    ~ '(\m(mom|moms|mommy|mumma|mama|mommyblogger|momlife|momblogger|mother|mum|dad|daddy|dadlife|father|parent|parenting|toddler|newborn|baby|babies|kids|motherhood|fatherhood)\M)'),
      'bio', left(coalesce(nullif(sa.biography,''), pr.bio), 200))))
    from public.members m
    left join public.social_accounts sa on sa.member_id = m.id and sa.platform = 'instagram'
    left join lateral (select a.identity_id from intel.ci_identity_actor_access a
                        where a.member_id = m.id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) idn on true
    left join private.creator_personal_profile per on per.identity_id = idn.identity_id
    left join private.creator_contact con on con.identity_id = idn.identity_id
    left join intel.ci_creator_professional_profile pr on pr.identity_id = idn.identity_id
   where m.role = 'creator'), '{}'::jsonb);
end $$;
revoke all on function public.admin_creator_facts() from public, anon;
grant execute on function public.admin_creator_facts() to authenticated;

-- ============================== 2. delete a user completely ==============================
-- append-only history tables allow a DELETE / actor-blanking UPDATE only inside a Super Admin user delete (flag set for that one transaction)
create or replace function intel.tg_block_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' and tg_table_schema = 'intel' and tg_table_name = 'ci_campaign_event'
     and coalesce(current_setting('geek.campaign_purge', true), '') = 'on' then
    return old;
  end if;
  -- deleting the user removes their rows and blanks their name on other rows' "who did it" (FK set null)
  if tg_op in ('DELETE','UPDATE') and coalesce(current_setting('geek.user_purge', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'append-only table %.% — % is not permitted', tg_table_schema, tg_table_name, tg_op;
  return null;
end $$;

-- Super Admin only, typed confirmation "DELETE". Never yourself or another Super Admin.
-- Removes: the login (auth user → member, WhatsApp link, Instagram accounts + tokens, notifications, activity),
-- the creator identity (profile, contact, addresses, pets, rates, skills, every campaign participation with its
-- contract, shipment, posts, messages). Campaign invites / uploaded rows they claimed are released, so the same
-- phone / email / Instagram can sign up again and join fresh. Campaigns they created move to the Super Admin.
-- A snapshot of who was deleted goes to the audit log.
create or replace function public.admin_delete_user(p_member uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_ids uuid[]; v_snap jsonb; v_parts int; v_camps int;
begin
  if not public.is_platform_admin() then raise exception 'only the Super Admin can delete users' using errcode = '42501'; end if;
  if p_member is null or not exists (select 1 from auth.users u where u.id = p_member) then raise exception 'user not found' using errcode = 'P0002'; end if;
  if coalesce(p_confirm, '') <> 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;
  if p_member = v_me then raise exception 'you cannot delete yourself' using errcode = '42501'; end if;
  if exists (select 1 from public.platform_admins a where a.user_id = p_member) then
    raise exception 'this user is a Super Admin — remove them from Super admins first' using errcode = '42501'; end if;

  select coalesce(array_agg(distinct a.identity_id), '{}') into v_ids
    from intel.ci_identity_actor_access a where a.member_id = p_member and a.access_role = 'self';
  -- an identity shared with another login stays (only this login's access goes)
  v_ids := coalesce((select array_agg(i) from unnest(v_ids) i
                      where not exists (select 1 from intel.ci_identity_actor_access a where a.identity_id = i and a.access_role = 'self' and a.member_id <> p_member)), '{}');

  select jsonb_build_object('member_id', p_member, 'name', m.name, 'role', m.role, 'email', u.email, 'phone', u.phone,
           'whatsapp', m.whatsapp_e164, 'instagram', (select string_agg(s.username, ', ') from public.social_accounts s where s.member_id = p_member),
           'joined_at', u.created_at, 'identities', to_jsonb(v_ids))
    into v_snap from auth.users u left join public.members m on m.id = u.id where u.id = p_member;
  select count(*) into v_parts from intel.ci_campaign_participation p where p.identity_id = any(v_ids);

  -- campaigns they created would be deleted with them: keep the campaign, move it to the Super Admin
  update intel.ci_campaign set created_by = v_me where created_by = p_member;
  get diagnostics v_camps = row_count;
  -- release what they claimed so they can claim it again after signing up anew
  update intel.ci_campaign_invite set claimed_by = null, claimed_at = null where claimed_by = p_member;
  update intel.ci_creator_upload set joined_member = null, joined_at = null where joined_member = p_member;
  perform set_config('geek.user_purge', 'on', true);
  delete from intel.ci_identity_merge_event e where e.source_identity_id = any(v_ids) or e.target_identity_id = any(v_ids);

  delete from intel.ci_creator_identity where identity_id = any(v_ids);   -- profile, addresses, campaigns, posts… (cascade)
  delete from auth.users where id = p_member;                              -- member, WhatsApp, Instagram, alerts, activity (cascade)

  perform set_config('geek.user_purge', '', true);
  insert into public.audit_log(actor, actor_email, action, table_name, row_id, old_data)
  values (v_me, (select u.email from auth.users u where u.id = v_me), 'DELETE_USER', 'auth.users', p_member, v_snap);

  return jsonb_build_object('deleted', true, 'name', v_snap->>'name', 'campaigns_removed_from', v_parts, 'campaigns_moved_to_you', v_camps);
end $$;
revoke all on function public.admin_delete_user(uuid, text) from public, anon;
grant execute on function public.admin_delete_user(uuid, text) to authenticated;
