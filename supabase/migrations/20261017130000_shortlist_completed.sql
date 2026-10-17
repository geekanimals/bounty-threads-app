-- Campaign status "Shortlist completed": the campaign keeps running for everyone already on it, but no new creator can
-- apply (it leaves the creators' Campaigns list; anyone already on it still sees it). Bulk upload Resend sends the same
-- message again (also to people who registered but haven't finished their profile), at most every 2 minutes. ADDITIVE.

alter table intel.ci_campaign add column if not exists applications_closed boolean not null default false;

create or replace function intel.ci_legacy_lifecycle(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case lower(coalesce(p_status, ''))
    when 'sourcing' then 'creator_discovery'
    when 'live' then 'in_execution'
    when 'shortlist completed' then 'in_execution'
    when 'in production' then 'in_execution'
    when 'completed' then 'completed'
    else 'draft' end $$;

-- runs after the pipeline sync (trigger names fire in alphabetical order)
create or replace function public.tg_campaign_shortlist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    update intel.ci_campaign set applications_closed = (lower(coalesce(new.status,'')) = 'shortlist completed')
     where legacy_campaign_id = new.id and applications_closed is distinct from (lower(coalesce(new.status,'')) = 'shortlist completed');
  exception when others then raise warning 'shortlist flag skipped for %: %', new.id, sqlerrm; end;
  return new;
end $$;
revoke all on function public.tg_campaign_shortlist() from public, anon, authenticated;
drop trigger if exists campaign_zz_shortlist on public.campaigns;
create trigger campaign_zz_shortlist after insert or update of status on public.campaigns
  for each row execute function public.tg_campaign_shortlist();
update intel.ci_campaign c set applications_closed = true from public.campaigns l
 where l.id = c.legacy_campaign_id and lower(coalesce(l.status,'')) = 'shortlist completed';

create or replace function api.apply_to_campaign(p_campaign uuid, p_role text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_pid uuid; v_life text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  if v_id is null then raise exception 'not a creator' using errcode='42501'; end if;
  select lifecycle_status into v_life from intel.ci_campaign where campaign_id=p_campaign;
  if v_life is null then raise exception 'campaign not found' using errcode='42501'; end if;
  if v_life not in ('creator_discovery','in_execution') then raise exception 'campaign is not open for applications' using errcode='22023'; end if;
  if exists (select 1 from intel.ci_campaign where campaign_id = p_campaign and coalesce(applications_closed, false)) then
    raise exception 'The shortlist for this campaign is complete — it is no longer taking applications.' using errcode = '22023'; end if;
  insert into intel.ci_campaign_participation(campaign_id, identity_id, role, stage)
    values (p_campaign, v_id, nullif(p_role,''), 'applied')
    on conflict (campaign_id, identity_id) do nothing returning participation_id into v_pid;
  if v_pid is null then raise exception 'you have already applied to or are on this campaign' using errcode='23505'; end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (p_campaign, v_pid, 'participation', null, 'applied', v_uid, 'creator applied');
  return jsonb_build_object('participation_id', v_pid, 'stage', 'applied');
end $$;

create or replace function api.list_open_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'campaign_id', c.campaign_id, 'name', c.name, 'brand', coalesce(b.name, c.submitted_brand_name),
      'product', c.product, 'category', c.category, 'comp_type', c.comp_type,
      'cities', coalesce(to_jsonb(c.cities), '[]'::jsonb), 'languages', coalesce(to_jsonb(c.languages), '[]'::jsonb),
      'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb), 'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'brief', br.requirements->>'brief', 'deliverables_text', br.requirements->>'deliverables_text', 'platforms', br.requirements->>'platforms',
      'campaign_type', br.requirements->>'campaign_type', 'barter_subtype', br.requirements->>'barter_subtype',
      'product_link', br.requirements->>'product_link', 'product_value', br.requirements->'product_value',
      'creators_needed', br.requirements->'creators_needed', 'attachments', coalesce(br.requirements->'attachments', '[]'::jsonb),
      'my_stage', p.stage, 'my_participation_id', p.participation_id, 'applications_closed', c.applications_closed)
      order by c.created_at desc)
    from intel.ci_campaign c
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    left join intel.ci_campaign_participation p on p.campaign_id = c.campaign_id and v_identity is not null and p.identity_id = v_identity
    where c.lifecycle_status in ('creator_discovery', 'in_execution') and (c.ends_on is null or c.ends_on >= current_date)
      and (not coalesce(c.applications_closed, false) or p.participation_id is not null)), '[]'::jsonb);
end $$;

create or replace function public.admin_set_campaign_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if p_status not in ('Draft','Sourcing','Approval','In Production','Live','Shortlist completed','Completed') then raise exception 'invalid status'; end if;
  update public.campaigns set status = p_status where id = p_id;
end $$;

create or replace function api.bulk_resend_invite(p_invite uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_m uuid; i intel.ci_campaign_invite%rowtype; v_res jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or not intel.ci_can_manage_campaign(i.campaign_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if i.claimed_at is not null then return jsonb_build_object('already', 'joined'); end if;
  v_m := intel.ci_find_creator(i.phone_e164, lower(i.email), lower(i.handle));
  if i.last_invited_at > now() - interval '2 minutes' then raise exception 'Sent just now — wait a couple of minutes before sending again.' using errcode = '22023'; end if;
  if v_m is not null then
    v_res := coalesce(intel.ci_bulk_attach(p_invite, v_m, auth.uid()), '{}'::jsonb);
    if v_res->>'status' is distinct from 'waiting_profile' then return v_res; end if;   -- they're in the campaign now
    -- registered but their profile / Instagram isn't done yet → the same message again, with the link
    return v_res || jsonb_build_object('messages', intel.ci_send_bulk_invite(p_invite));
  end if;
  return jsonb_build_object('messages', intel.ci_send_bulk_invite(p_invite));
end $$;

-- the creator's professional profile for the campaign team (no private details: no birthday, family, pets or address here)
create or replace function api.creator_profile_card(p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (public.is_platform_admin() or intel.ci_can_discover() or auth.uid() = p_member) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  select a.identity_id into v_id from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  if v_id is null then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'display_name', (select p.display_name from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'content_formats', (select to_jsonb(p.content_formats) from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'categories', (select to_jsonb(p.categories) from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'availability', (select p.availability_status from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'availability_limit', (select p.availability_limit from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'travel_willingness', (select p.travel_willingness from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'management', (select p.management_status from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'city', (select p.city_coarse from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'state', (select p.state_coarse from intel.ci_creator_professional_profile p where p.identity_id = v_id),
    'skills', (select jsonb_agg(s.skill_key order by s.skill_key) from intel.ci_creator_skill s where s.identity_id = v_id),
    'resources', (select jsonb_agg(r.resource_key order by r.resource_key) from intel.ci_creator_resource r where r.identity_id = v_id),
    'travelling', (select jsonb_build_object('city', t.city, 'state', t.state, 'country', t.country, 'until', t.until_date)
                     from intel.ci_creator_travel t where t.identity_id = v_id and (t.until_date is null or t.until_date >= current_date)),
    'campaigns_done', (select count(*) from intel.ci_campaign_participation x where x.identity_id = v_id and x.stage in ('published','completed')),
    'joined_at', (select m.created_at from public.members m where m.id = p_member)));
end $$;
revoke all on function api.creator_profile_card(uuid) from public, anon;
grant execute on function api.creator_profile_card(uuid) to authenticated;
