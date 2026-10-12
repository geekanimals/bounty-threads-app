-- Super Admin powers + campaign form v2 + structured rejection reasons + creator discovery. ADDITIVE.

-- ===================================================================================================
-- 1) Super Admin = operator everywhere. Every pipeline action an agency operator can take (screen, send
--    shortlist, decide for the brand, contracts, shipments, content approval) the Super Admin can take too —
--    for when the agency or brand can't. Platform admins are listed in public.platform_admins.
-- ===================================================================================================
create or replace function intel.ci_is_agency_operator()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := auth.uid(); if v_uid is null then return false; end if;
  return exists (select 1 from intel.ci_agency_operator where member_id = v_uid and active)
      or exists (select 1 from public.platform_admins where user_id = v_uid);
end $$;
revoke all on function intel.ci_is_agency_operator() from public, anon, authenticated;
grant execute on function intel.ci_is_agency_operator() to service_role;

-- ===================================================================================================
-- 2) Campaign form v2 (admin panel campaigns: public.campaigns)
-- ===================================================================================================
alter table public.campaigns add column if not exists campaign_type text
  check (campaign_type is null or campaign_type in ('barter','paid','barter_paid'));
alter table public.campaigns add column if not exists barter_subtype text
  check (barter_subtype is null or barter_subtype in ('celebrity_story','normal_barter','pr_package'));
alter table public.campaigns add column if not exists product_link text;
alter table public.campaigns add column if not exists product_value numeric check (product_value is null or product_value >= 0);
alter table public.campaigns add column if not exists attachments jsonb not null default '[]'::jsonb;   -- [{name,url,type,size}]
alter table public.campaigns add column if not exists ideal_profile jsonb not null default '{}'::jsonb;  -- {min_followers,max_followers,locations[],gender,categories[],min_engagement,audience_notes}

-- campaign attachments bucket (public read so creators can open brief files; upload only into your org's folder)
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-files', 'campaign-files', true, 10485760, array[
  'application/pdf','image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/quicktime','text/csv','text/plain',
  'application/zip','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "org upload campaign-files" on storage.objects;
create policy "org upload campaign-files" on storage.objects for insert to authenticated
  with check (bucket_id = 'campaign-files' and (storage.foldername(name))[1] = public.my_org()::text);
drop policy if exists "org delete campaign-files" on storage.objects;
create policy "org delete campaign-files" on storage.objects for delete to authenticated
  using (bucket_id = 'campaign-files' and (storage.foldername(name))[1] = public.my_org()::text);
drop policy if exists "public read campaign-files" on storage.objects;
create policy "public read campaign-files" on storage.objects for select using (bucket_id = 'campaign-files');

-- bridge v2: carry type, product and the creator-facing brief (attachments) into the pipeline; the ideal
-- profile goes into the brief requirements (used for screening/discovery, never shown to creators)
create or replace function intel.ci_sync_legacy_campaign(p_legacy uuid, p_status_changed boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c record; v_id uuid; v_creator uuid; v_life text; v_req jsonb; v_prev jsonb; v_comp text; v_cat text;
begin
  execute 'select id, org_id, org_name, name, brand, type, status, objective, platforms, deliverables, brief, hashtags,
                  start_date, end_date, campaign_type, barter_subtype, product_link, product_value, attachments, ideal_profile, creators
             from public.campaigns where id = $1' into c using p_legacy;
  if c.id is null then return null; end if;

  v_creator := auth.uid();
  if v_creator is null or not exists (select 1 from auth.users where id = v_creator) then
    execute 'select id from public.members where org_id = $1 order by (role = ''owner'') desc, created_at limit 1'
      into v_creator using c.org_id;
  end if;
  if v_creator is null then return null; end if;

  v_life := intel.ci_legacy_lifecycle(c.status);
  v_comp := case c.campaign_type when 'barter' then 'barter' when 'paid' then 'cash' when 'barter_paid' then 'hybrid'
                 else intel.ci_legacy_comp_type(c.type) end;
  v_cat  := coalesce(nullif((c.ideal_profile->'categories'->>0), ''), nullif(c.type, ''));
  select campaign_id into v_id from intel.ci_campaign where legacy_campaign_id = c.id;

  if v_id is null then
    insert into intel.ci_campaign(legacy_campaign_id, org_id, created_by, name, submitted_brand_name, category,
                                  comp_type, budget, starts_on, ends_on, lifecycle_status, cities)
    values (c.id, c.org_id, v_creator, coalesce(nullif(c.name, ''), 'Campaign'),
            coalesce(nullif(c.brand, ''), nullif(c.org_name, ''), nullif(c.name, ''), 'Brand'),
            v_cat, v_comp, null, c.start_date,
            case when c.end_date >= c.start_date or c.start_date is null then c.end_date end, v_life,
            (select array_agg(x) from jsonb_array_elements_text(coalesce(c.ideal_profile->'locations','[]'::jsonb)) x))
    returning campaign_id into v_id;
  else
    update intel.ci_campaign set
      name = coalesce(nullif(c.name, ''), name),
      submitted_brand_name = coalesce(nullif(c.brand, ''), submitted_brand_name),
      category = coalesce(v_cat, category),
      comp_type = coalesce(v_comp, comp_type),
      starts_on = c.start_date,
      ends_on = case when c.end_date >= c.start_date or c.start_date is null then c.end_date end,
      cities = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(c.ideal_profile->'locations','[]'::jsonb)) x), cities),
      lifecycle_status = case when p_status_changed then v_life else lifecycle_status end
    where campaign_id = v_id;
  end if;

  v_req := jsonb_strip_nulls(jsonb_build_object(
    'hashtags', intel.ci_legacy_tags(c.hashtags, '#'),
    'mentions', intel.ci_legacy_tags(c.hashtags, '@'),
    'brief', nullif(c.brief, ''), 'deliverables_text', nullif(c.deliverables, ''),
    'platforms', nullif(c.platforms, ''), 'objective_text', nullif(c.objective, ''),
    'campaign_type', c.campaign_type, 'barter_subtype', c.barter_subtype,
    'product_link', nullif(c.product_link, ''), 'product_value', c.product_value,
    'creators_needed', nullif(c.creators, 0),
    'attachments', case when jsonb_array_length(coalesce(c.attachments,'[]'::jsonb)) > 0 then c.attachments end,
    'ideal_profile', case when c.ideal_profile <> '{}'::jsonb then c.ideal_profile end,
    'category', case when jsonb_array_length(coalesce(c.ideal_profile->'categories','[]'::jsonb)) > 0 then c.ideal_profile->'categories' end,
    'location', case when jsonb_array_length(coalesce(c.ideal_profile->'locations','[]'::jsonb)) > 0 then c.ideal_profile->'locations' end,
    'source', 'admin_panel'));
  select requirements into v_prev from intel.ci_campaign_brief where campaign_id = v_id order by created_at desc limit 1;
  if v_prev is distinct from v_req then
    insert into intel.ci_campaign_brief(campaign_id, requirements) values (v_id, v_req);
  end if;
  return v_id;
end $$;
revoke all on function intel.ci_sync_legacy_campaign(uuid, boolean) from public, anon, authenticated;
grant execute on function intel.ci_sync_legacy_campaign(uuid, boolean) to service_role;

-- creators see type, product link/value, number of creators and attachments in Open campaigns (never the
-- ideal profile, budget or contacts)
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
      'my_stage', p.stage, 'my_participation_id', p.participation_id)
      order by c.created_at desc)
    from intel.ci_campaign c
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    left join intel.ci_campaign_participation p on p.campaign_id = c.campaign_id and v_identity is not null and p.identity_id = v_identity
    where c.lifecycle_status in ('creator_discovery', 'in_execution') and (c.ends_on is null or c.ends_on >= current_date)), '[]'::jsonb);
end $$;
revoke all on function api.list_open_campaigns() from public, anon;
grant execute on function api.list_open_campaigns() to authenticated, service_role;

-- ===================================================================================================
-- 3) Structured rejection reasons (training data for matching / ML)
-- ===================================================================================================
create table if not exists public.rejection_reason_vocab (code text primary key, label text not null, sort int not null default 100);
insert into public.rejection_reason_vocab(code, label, sort) values
  ('low_engagement','Low engagement rate',10), ('low_followers','Follower count too low',20),
  ('audience_mismatch','Audience doesn''t match the brand',30), ('location_mismatch','Wrong city / region',40),
  ('category_mismatch','Content category doesn''t fit',50), ('content_quality','Content quality / aesthetics',60),
  ('brand_safety','Brand-safety concern',70), ('fake_followers_suspected','Suspicious followers / engagement',80),
  ('budget_mismatch','Rate / budget mismatch',90), ('incomplete_profile','Profile or media kit incomplete',100),
  ('slots_full','Campaign slots already filled',110), ('other','Other',999)
on conflict (code) do update set label = excluded.label, sort = excluded.sort;
grant select on public.rejection_reason_vocab to authenticated;

alter table intel.ci_campaign_participation add column if not exists reason_code text references public.rejection_reason_vocab(code);
alter table public.applications add column if not exists decline_reason_code text references public.rejection_reason_vocab(code);
alter table public.applications add column if not exists decline_note text;
alter table public.applications add column if not exists decided_by uuid;
alter table public.applications add column if not exists decided_at timestamptz;

-- pipeline screening with a reason code (reason text stays required for "not eligible")
create or replace function api.screen_participation_v2(p_participation uuid, p_eligible boolean, p_reason_code text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_label text;
begin
  if not p_eligible then
    select label into v_label from public.rejection_reason_vocab where code = p_reason_code;
    if v_label is null then raise exception 'pick a rejection reason' using errcode = '22023'; end if;
  end if;
  v := api.screen_participation(p_participation, p_eligible,
         case when p_eligible then nullif(p_note,'') else v_label || coalesce(' — ' || nullif(p_note,''), '') end);
  if not p_eligible then
    update intel.ci_campaign_participation set reason_code = p_reason_code where participation_id = p_participation;
  end if;
  return v;
end $$;
revoke all on function api.screen_participation_v2(uuid, boolean, text, text) from public, anon;
grant execute on function api.screen_participation_v2(uuid, boolean, text, text) to authenticated;

create or replace function api.rejection_reasons()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label) order by sort), '[]'::jsonb) from public.rejection_reason_vocab $$;
grant execute on function api.rejection_reasons() to authenticated;

-- legacy marketplace applications: decide with a reason (agency of the campaign, or the Super Admin)
create or replace function public.decide_application(p_id uuid, p_approve boolean, p_reason_code text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_id;
  if a.id is null then raise exception 'application not found'; end if;
  if not (a.agency_org_id = my_org() or public.is_platform_admin()) then raise exception 'Not authorized'; end if;
  if not p_approve and not exists (select 1 from public.rejection_reason_vocab where code = p_reason_code) then
    raise exception 'pick a rejection reason';
  end if;
  update public.applications set status = case when p_approve then 'Approved' else 'Declined' end,
         decline_reason_code = case when p_approve then null else p_reason_code end,
         decline_note = case when p_approve then null else nullif(p_note,'') end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end $$;
revoke all on function public.decide_application(uuid, boolean, text, text) from public, anon;
grant execute on function public.decide_application(uuid, boolean, text, text) to authenticated;

-- ===================================================================================================
-- 4) Super Admin: every campaign and application across all orgs, live; override status / decisions
-- ===================================================================================================
create or replace function public.admin_campaigns(p_status text default null)
returns table(id uuid, name text, brand text, org_name text, status text, campaign_type text, barter_subtype text,
              budget numeric, creators int, start_date date, end_date date, created_at timestamptz,
              applied bigint, approved bigint, declined bigint, pipeline_stage_counts jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return query
  select c.id, c.name, c.brand, c.org_name, c.status, c.campaign_type, c.barter_subtype, c.budget, c.creators,
         c.start_date, c.end_date, c.created_at,
         (select count(*) from public.applications a where a.campaign_id = c.id),
         (select count(*) from public.applications a where a.campaign_id = c.id and a.status = 'Approved'),
         (select count(*) from public.applications a where a.campaign_id = c.id and a.status = 'Declined'),
         (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
            select p.stage, count(*) n from intel.ci_campaign ic join intel.ci_campaign_participation p on p.campaign_id = ic.campaign_id
             where ic.legacy_campaign_id = c.id group by p.stage) s)
    from public.campaigns c
   where p_status is null or c.status = p_status
   order by c.created_at desc;
end $$;
revoke all on function public.admin_campaigns(text) from public, anon;
grant execute on function public.admin_campaigns(text) to authenticated;

create or replace function public.admin_set_campaign_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if p_status not in ('Draft','Sourcing','Approval','In Production','Live','Completed') then raise exception 'invalid status'; end if;
  update public.campaigns set status = p_status where id = p_id;     -- bridge trigger syncs the pipeline
end $$;
revoke all on function public.admin_set_campaign_status(uuid, text) from public, anon;
grant execute on function public.admin_set_campaign_status(uuid, text) to authenticated;

create or replace function public.admin_applications(p_campaign uuid default null, p_status text default null)
returns table(id uuid, campaign_id uuid, campaign_name text, creator_name text, creator_org text, agency_org text,
              status text, decline_reason_code text, decline_note text, created_at timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return query
  select a.id, a.campaign_id, a.campaign_name, a.creator_name, a.org_name,
         (select c.org_name from public.campaigns c where c.id = a.campaign_id), a.status,
         a.decline_reason_code, a.decline_note, a.created_at, a.decided_at
    from public.applications a
   where (p_campaign is null or a.campaign_id = p_campaign) and (p_status is null or a.status = p_status)
   order by a.created_at desc limit 500;
end $$;
revoke all on function public.admin_applications(uuid, text) from public, anon;
grant execute on function public.admin_applications(uuid, text) to authenticated;

-- ===================================================================================================
-- 5) Creator discovery for agencies, brands and the Super Admin: #hashtag, keyword and filters over the
--    creators on the platform. Public-profile data only (Instagram stats, categories, coarse city);
--    never contact details, address, DOB or other private fields. Gender is filterable, not displayed.
-- ===================================================================================================
create or replace function api.discover_creators(p_query text default null, p_hashtag text default null, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_role text; v_tag text; v_q text;
        f_min int; f_max int; f_loc text; f_gender text; f_cat text; f_eng numeric; f_aud text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select role into v_role from public.members where id = v_uid and coalesce(status,'active') = 'active';
  if not (coalesce(v_role,'') in ('owner','brand','manager','corporate') or public.is_platform_admin()) then
    raise exception 'discovery is for approved agencies, brands and the Super Admin' using errcode = '42501';
  end if;
  v_tag := nullif(lower(regexp_replace(coalesce(p_hashtag,''), '^#', '')), '');
  v_q := nullif(lower(trim(coalesce(p_query,''))), '');
  f_min := nullif(p_filters->>'min_followers','')::int; f_max := nullif(p_filters->>'max_followers','')::int;
  f_loc := nullif(lower(p_filters->>'location'),''); f_gender := nullif(lower(p_filters->>'gender'),'');
  f_cat := nullif(lower(p_filters->>'category'),''); f_eng := nullif(p_filters->>'min_engagement','')::numeric;
  f_aud := nullif(lower(p_filters->>'audience'),'');

  return coalesce((select jsonb_agg(r order by (r->>'followers')::bigint desc nulls last) from (
    select jsonb_build_object(
      'member_id', sa.member_id, 'username', sa.username, 'name', sa.name, 'profile_picture_url', sa.profile_picture_url,
      'followers', sa.followers_count, 'posts', sa.media_count, 'avg_reach', sa.avg_reach,
      'engagement', x.eng, 'bio', left(sa.biography, 200),
      'categories', coalesce(to_jsonb(pp.categories), '[]'::jsonb), 'city', pp.city_coarse, 'state', pp.state_coarse,
      'top_hashtags', x.tags) r
    from public.social_accounts sa
    join public.members m on m.id = sa.member_id and m.role = 'creator'
    left join intel.ci_identity_actor_access acc on acc.member_id = sa.member_id and acc.access_role = 'self' and acc.revoked_at is null
    left join intel.ci_creator_professional_profile pp on pp.identity_id = acc.identity_id
    left join private.creator_personal_profile per on per.identity_id = acc.identity_id
    cross join lateral (
      select case when coalesce(sa.followers_count,0) > 0 and jsonb_array_length(coalesce(sa.recent_media,'[]'::jsonb)) > 0 then
               round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                               from jsonb_array_elements(sa.recent_media) m2) / sa.followers_count, 2) end as eng,
             (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
                select lower(h[1]) t, count(*) n from jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) m3,
                       regexp_matches(coalesce(m3->>'caption',''), '#([[:alnum:]_]+)', 'g') h
                 group by 1 order by 2 desc limit 8) tt) as tags,
             lower(coalesce(sa.biography,'') || ' ' || coalesce((select string_agg(m4->>'caption', ' ') from jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) m4), '')) as text_blob
    ) x
    where sa.platform = 'instagram'
      and (v_tag is null or x.text_blob like '%#' || v_tag || '%')
      and (v_q is null or lower(coalesce(sa.username,'') || ' ' || coalesce(sa.name,'') || ' ' || array_to_string(coalesce(pp.categories,'{}'), ' ')) like '%' || v_q || '%'
                       or x.text_blob like '%' || v_q || '%')
      and (f_min is null or sa.followers_count >= f_min)
      and (f_max is null or sa.followers_count <= f_max)
      and (f_loc is null or lower(coalesce(pp.city_coarse,'') || ' ' || coalesce(pp.state_coarse,'')) like '%' || f_loc || '%')
      and (f_cat is null or exists (select 1 from unnest(coalesce(pp.categories,'{}')) c where lower(c) like '%' || f_cat || '%'))
      and (f_gender is null or lower(coalesce(per.gender,'')) = f_gender)
      and (f_eng is null or coalesce(x.eng,0) >= f_eng)
      and (f_aud is null or lower(coalesce(sa.audience::text,'')) like '%' || f_aud || '%')
    order by sa.followers_count desc nulls last
    limit 60) q), '[]'::jsonb);
end $$;
revoke all on function api.discover_creators(text, text, jsonb) from public, anon;
grant execute on function api.discover_creators(text, text, jsonb) to authenticated;

-- ===================================================================================================
-- 6) Agency / Brand run their OWN campaigns: see who applied, approve or decline (with a reason code), and
--    reports. Scoped to campaigns whose org is the caller's org (active owner / brand / manager); internal
--    operators and the Super Admin can act on every campaign. Approve = final yes for the campaign owner:
--    applied → eligible → sent_to_brand → brand_confirmed (each step lands in the event ledger), after which
--    contracts / shipping continue as before.
-- ===================================================================================================
create or replace function intel.ci_can_manage_campaign(p_campaign uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if intel.ci_is_agency_operator() then return true; end if;
  return exists (select 1 from intel.ci_campaign c join public.members m on m.id = v_uid
                  where c.campaign_id = p_campaign and c.org_id is not null and c.org_id = m.org_id
                    and m.role in ('owner','brand','manager') and coalesce(m.status,'active') = 'active');
end $$;
revoke all on function intel.ci_can_manage_campaign(uuid) from public, anon, authenticated;
grant execute on function intel.ci_can_manage_campaign(uuid) to service_role;

-- creator's public card (Instagram stats + coarse city/categories) for applicant lists
create or replace function intel.ci_public_creator_card(p_identity uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('member_id', sa.member_id, 'username', sa.username, 'name', sa.name,
             'profile_picture_url', sa.profile_picture_url, 'followers', sa.followers_count, 'avg_reach', sa.avg_reach,
             'engagement', case when coalesce(sa.followers_count,0) > 0 and jsonb_array_length(coalesce(sa.recent_media,'[]'::jsonb)) > 0 then
                 round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                                  from jsonb_array_elements(sa.recent_media) m2) / sa.followers_count, 2) end,
             'city', pp.city_coarse, 'categories', coalesce(to_jsonb(pp.categories), '[]'::jsonb))
      from intel.ci_identity_actor_access a
      join public.social_accounts sa on sa.member_id = a.member_id and sa.platform = 'instagram'
      left join intel.ci_creator_professional_profile pp on pp.identity_id = a.identity_id
     where a.identity_id = p_identity and a.access_role = 'self' and a.revoked_at is null
     limit 1), '{}'::jsonb) $$;
revoke all on function intel.ci_public_creator_card(uuid) from public, anon, authenticated;
grant execute on function intel.ci_public_creator_card(uuid) to service_role;

create or replace function api.org_applicants(p_campaign uuid default null, p_stage text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_all boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_all := intel.ci_is_agency_operator();
  if p_campaign is not null and not intel.ci_can_manage_campaign(p_campaign) then
    raise exception 'not authorised for this campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(rr order by (rr->>'applied_at') desc) from (
    select jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id,
             'legacy_campaign_id', c.legacy_campaign_id, 'campaign_name', c.name,
             'brand', c.submitted_brand_name, 'stage', p.stage, 'reason', p.reason, 'reason_code', p.reason_code,
             'applied_at', p.created_at, 'updated_at', p.updated_at, 'creator', intel.ci_public_creator_card(p.identity_id)) rr
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
     where (p_campaign is null or c.campaign_id = p_campaign)
       and (p_stage is null or p.stage = p_stage)
       and (v_all or intel.ci_can_manage_campaign(c.campaign_id))
     order by p.created_at desc limit 500) s), '[]'::jsonb);
end $$;
revoke all on function api.org_applicants(uuid, text) from public, anon;
grant execute on function api.org_applicants(uuid, text) to authenticated;

create or replace function api.org_decide_applicant(p_participation uuid, p_approve boolean, p_reason_code text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_camp uuid; v_stage text; v_label text; v_reason text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select campaign_id, stage into v_camp, v_stage from intel.ci_campaign_participation where participation_id = p_participation for update;
  if v_camp is null or not intel.ci_can_manage_campaign(v_camp) then
    raise exception 'not authorised for this application' using errcode = '42501'; end if;
  if not p_approve then
    select label into v_label from public.rejection_reason_vocab where code = p_reason_code;
    if v_label is null then raise exception 'pick a rejection reason' using errcode = '22023'; end if;
    v_reason := v_label || coalesce(' — ' || nullif(btrim(p_note), ''), '');
  end if;

  if p_approve then
    if v_stage = 'applied' then v_stage := intel.ci_participation_advance(p_participation, 'eligible', v_uid, nullif(btrim(p_note),'')); end if;
    if v_stage = 'eligible' then v_stage := intel.ci_participation_advance(p_participation, 'sent_to_brand', v_uid, 'approved by campaign owner'); end if;
    if v_stage = 'sent_to_brand' then v_stage := intel.ci_participation_advance(p_participation, 'brand_confirmed', v_uid, 'approved by campaign owner');
    else raise exception 'this application is already past the approval step (%)', v_stage using errcode = '22023'; end if;
  else
    v_stage := intel.ci_participation_advance(p_participation,
      case v_stage when 'applied' then 'ineligible' when 'sent_to_brand' then 'brand_declined' when 'eligible' then 'dropped'
                   else 'dropped' end, v_uid, v_reason);
    update intel.ci_campaign_participation set reason_code = p_reason_code where participation_id = p_participation;
  end if;
  return jsonb_build_object('stage', v_stage);
end $$;
revoke all on function api.org_decide_applicant(uuid, boolean, text, text) from public, anon;
grant execute on function api.org_decide_applicant(uuid, boolean, text, text) to authenticated;

-- Reports: one row per campaign the caller manages (all campaigns for operators / Super Admin)
create or replace function api.org_reports()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_all boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_all := intel.ci_is_agency_operator();
  return coalesce((select jsonb_agg(r order by (r->>'created_at') desc) from (
    select jsonb_build_object('campaign_id', c.campaign_id, 'legacy_campaign_id', c.legacy_campaign_id, 'name', c.name,
      'brand', c.submitted_brand_name, 'lifecycle_status', c.lifecycle_status, 'comp_type', c.comp_type,
      'starts_on', c.starts_on, 'ends_on', c.ends_on, 'created_at', c.created_at,
      'creators_needed', (select requirements->'creators_needed' from intel.ci_campaign_brief b where b.campaign_id = c.campaign_id order by b.created_at desc limit 1),
      'funnel', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from intel.ci_campaign_participation
                            where campaign_id = c.campaign_id group by stage) f), '{}'::jsonb),
      'declines', coalesce((select jsonb_object_agg(reason_code, n) from (select reason_code, count(*) n from intel.ci_campaign_participation
                            where campaign_id = c.campaign_id and reason_code is not null group by reason_code) d), '{}'::jsonb),
      'posts', (select count(*) from intel.ci_campaign_post po join intel.ci_campaign_participation pp on pp.participation_id = po.participation_id
                 where pp.campaign_id = c.campaign_id),
      'metrics', (select jsonb_build_object('reach', coalesce(sum(m.reach),0), 'views', coalesce(sum(m.views),0),
                     'likes', coalesce(sum(m.likes),0), 'comments', coalesce(sum(m.comments),0), 'saves', coalesce(sum(m.saves),0))
                    from intel.ci_campaign_post po join intel.ci_campaign_participation pp on pp.participation_id = po.participation_id
                    cross join lateral (select * from intel.ci_campaign_post_metric mm where mm.post_id = po.post_id order by mm.captured_at desc limit 1) m
                   where pp.campaign_id = c.campaign_id)) r
    from intel.ci_campaign c
    where v_all or intel.ci_can_manage_campaign(c.campaign_id)
    order by c.created_at desc limit 200) s), '[]'::jsonb);
end $$;
revoke all on function api.org_reports() from public, anon;
grant execute on function api.org_reports() to authenticated;
