-- 🏢 Brand login portal. ADDITIVE.
-- A brand's own login (made by the Super Admin in Brand CRM → 🔑 Login, or "Continue with Facebook" once linked)
-- sees ONLY its own campaigns: progress, creators (public profile only — no phone, email, address or fees),
-- videos to approve, creators to approve, posts and analytics. Nothing else on the platform.
-- * api.brand_portal(p_brand?)            dashboard: campaigns + what's waiting for the brand
-- * api.brand_campaign(p_campaign)        one campaign: brief, every creator and where they are, videos, posts
-- * the two approval RPCs (creator confirm / video review) now accept the brand's own login for campaigns the
--   agency runs for that brand (they only accepted the campaign's own workspace before)
-- * api.ops_brand_fb_* (service role): Facebook Login for Business ↔ brand login link, used by brand-fb-login

-- ---------------------------------------------------------------------------------------------------------------
-- who is looking: a brand login → its brand(s); the Super Admin may preview any brand
-- ---------------------------------------------------------------------------------------------------------------
create or replace function intel.ci_portal_brands(p_brand uuid)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_brand is not null and (public.is_platform_admin() or intel.ci_is_agency_operator()) then return array[p_brand]; end if;
  if not exists (select 1 from public.members m where m.id = auth.uid() and m.role = 'brand' and coalesce(m.status, 'active') = 'active') then
    raise exception 'This page is for brand logins.' using errcode = '42501'; end if;
  if p_brand is not null then
    if p_brand = any(intel.ci_my_brand_ids()) then return array[p_brand]; end if;
    raise exception 'not your brand' using errcode = '42501';
  end if;
  return intel.ci_my_brand_ids();
end $$;
revoke all on function intel.ci_portal_brands(uuid) from public, anon;
grant execute on function intel.ci_portal_brands(uuid) to authenticated;

-- what a brand sees about a creator: their public profile only
create or replace function intel.ci_brand_card(p_identity uuid, p_profile text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('name', c->>'name', 'username', c->>'username', 'followers', c->'followers',
           'city', c->>'city', 'categories', c->'categories', 'engagement', c->'engagement', 'avg_reach', c->'avg_reach',
           'profile_picture_url', c->>'profile_picture_url'))
    from (select intel.ci_public_creator_card(p_identity, p_profile) c) x $$;
revoke all on function intel.ci_brand_card(uuid, text) from public, anon, authenticated;

-- the stage in the brand's words
create or replace function intel.ci_brand_stage(p_stage text)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when p_stage in ('applied','eligible','sent_to_brand') then '{"key":"to_approve","label":"Waiting for your approval","step":1}'
    when p_stage in ('brand_confirmed','contract_sent','contract_signed','address_confirmed','accepted','invited','shortlisted') then '{"key":"approved","label":"Approved — getting ready","step":2}'
    when p_stage = 'product_sent' then '{"key":"shipped","label":"Product shipped","step":3}'
    when p_stage = 'content_created' then '{"key":"making","label":"Making the video","step":3}'
    when p_stage = 'changes_requested' then '{"key":"making","label":"Fixing the video","step":3}'
    when p_stage = 'content_submitted' then '{"key":"video_review","label":"Video to review","step":4}'
    when p_stage = 'content_approved' then '{"key":"posting","label":"Video approved — posting","step":5}'
    when p_stage in ('published','completed') then '{"key":"posted","label":"Posted","step":6}'
    else '{"key":"not_selected","label":"Not selected","step":0}' end::jsonb $$;

-- ---------------------------------------------------------------------------------------------------------------
-- dashboard
-- ---------------------------------------------------------------------------------------------------------------
create or replace function api.brand_portal(p_brand uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ids uuid[] := intel.ci_portal_brands(p_brand);
begin
  return jsonb_build_object(
    'brands', coalesce((select jsonb_agg(jsonb_build_object('brand_id', b.brand_id, 'name', b.name) order by b.name) from intel.ci_brand b where b.brand_id = any(v_ids)), '[]'::jsonb),
    'me', (select jsonb_build_object('name', m.name, 'email', m.email) from public.members m where m.id = auth.uid()),
    'campaigns', coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (
        select jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'brand', (select b.name from intel.ci_brand b where b.brand_id = c.brand_id),
                 'status', c.lifecycle_status, 'product', c.product, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'created_at', c.created_at,
                 'campaign_type', coalesce(br.requirements->>'campaign_type', case c.comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' else 'barter' end),
                 'creators_needed', br.requirements->'creators_needed',
                 'counts', (select jsonb_object_agg(k, n) from (select intel.ci_brand_stage(p.stage)->>'key' k, count(*) n
                              from intel.ci_campaign_participation p where p.campaign_id = c.campaign_id group by 1) s),
                 'posts', (select count(*) from intel.ci_campaign_participation p, jsonb_array_elements(intel.ci_participation_posts(p.participation_id)) e
                            where p.campaign_id = c.campaign_id and p.stage in ('content_approved','published','completed'))) x
          from intel.ci_campaign c
          left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
         where c.brand_id = any(v_ids) and coalesce(c.lifecycle_status, '') not in ('archived','deleted')) q), '[]'::jsonb),
    'to_approve', coalesce((select jsonb_agg(jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
                   'stage', p.stage, 'applied_at', p.created_at, 'creator', intel.ci_brand_card(p.identity_id, p.applied_profile)) order by p.created_at)
              from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
             where c.brand_id = any(v_ids) and p.stage in ('applied','eligible','sent_to_brand')), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
                   'creator', intel.ci_brand_card(p.identity_id, p.applied_profile), 'video_url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at)
                   order by s.submitted_at)
              from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
              cross join lateral (select s.* from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                                   where d.participation_id = p.participation_id and s.status = 'submitted' order by s.submitted_at desc limit 1) s
             where c.brand_id = any(v_ids) and p.stage = 'content_submitted'), '[]'::jsonb),
    'facebook', (select t.meta - 'fb_user_id' from public.social_tokens t where t.member_id = auth.uid() and t.platform = 'facebook_brand'));
end $$;
revoke all on function api.brand_portal(uuid) from public, anon;
grant execute on function api.brand_portal(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- one campaign
-- ---------------------------------------------------------------------------------------------------------------
create or replace function api.brand_campaign(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); c intel.ci_campaign%rowtype; br jsonb; v_ids uuid[];
begin
  select * into c from intel.ci_campaign where campaign_id = v_id;
  if c.campaign_id is null then raise exception 'campaign not found' using errcode = 'P0002'; end if;
  v_ids := intel.ci_portal_brands(case when public.is_platform_admin() or intel.ci_is_agency_operator() then c.brand_id end);
  if c.brand_id is null or not (c.brand_id = any(v_ids)) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select requirements into br from intel.ci_campaign_brief x where x.campaign_id = v_id order by x.created_at desc limit 1;
  return jsonb_build_object(
    'campaign', jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'brand', (select b.name from intel.ci_brand b where b.brand_id = c.brand_id),
        'status', c.lifecycle_status, 'product', c.product, 'category', c.category, 'cities', c.cities, 'starts_on', c.starts_on, 'ends_on', c.ends_on,
        'objective', c.objective, 'campaign_type', coalesce(br->>'campaign_type', case c.comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' else 'barter' end),
        'brief', br->>'brief', 'deliverables_text', br->>'deliverables_text', 'platforms', br->>'platforms', 'hashtags', br->'hashtags', 'mentions', br->'mentions',
        'creators_needed', br->'creators_needed', 'video_brief', intel.ci_playbook(c.campaign_id)->'brief'),
    'creators', coalesce((select jsonb_agg(jsonb_build_object('participation_id', p.participation_id, 'stage', p.stage, 'status', intel.ci_brand_stage(p.stage),
                   'applied_at', p.created_at, 'updated_at', p.updated_at, 'creator', intel.ci_brand_card(p.identity_id, p.applied_profile),
                   'video', (select jsonb_build_object('url', s.content_url, 'note', s.note, 'status', s.status, 'submitted_at', s.submitted_at)
                               from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                              where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
                   'posts', case when p.stage in ('content_approved','published','completed') then intel.ci_participation_posts(p.participation_id) else '[]'::jsonb end)
                   order by (intel.ci_brand_stage(p.stage)->>'step')::int desc, p.updated_at desc)
              from intel.ci_campaign_participation p where p.campaign_id = v_id), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'to', e.to_status, 'status', intel.ci_brand_stage(e.to_status)->>'label',
                   'creator', intel.ci_brand_card(p.identity_id, p.applied_profile)->>'name') order by e.at desc)
              from (select * from intel.ci_campaign_event e where e.campaign_id = v_id and e.entity = 'participation' order by e.at desc limit 60) e
              left join intel.ci_campaign_participation p on p.participation_id = e.participation_id), '[]'::jsonb));
end $$;
revoke all on function api.brand_campaign(uuid) from public, anon;
grant execute on function api.brand_campaign(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- approvals: a brand login may decide on its own brand's campaigns
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare d text;
begin
  d := pg_get_functiondef('api.brand_decide_participation(uuid,boolean,text)'::regprocedure);
  if position('ci_can_manage_campaign(v_camp)' in d) = 0 then
    d := replace(d, 'if not (intel.ci_is_agency_operator() or (v_org is not null and v_org = v_camp_org)) then',
                    'if not (intel.ci_is_agency_operator() or (v_org is not null and v_org = v_camp_org) or intel.ci_can_manage_campaign(v_camp)) then');
    execute d;
  end if;
  d := pg_get_functiondef('api.approve_content(uuid,text,text)'::regprocedure);
  if position('ci_can_manage_campaign(v_camp)' in d) = 0 then
    d := replace(d, 'if not (intel.ci_is_agency_operator() or (v_org is not null and v_org = v_camp_org)) then',
                    'if not (intel.ci_is_agency_operator() or (v_org is not null and v_org = v_camp_org) or intel.ci_can_manage_campaign(v_camp)) then');
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Facebook Login for Business ↔ brand login (service role only; used by the brand-fb-login function)
-- stored in public.social_tokens, platform 'facebook_brand' (token sealed by the function)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function api.ops_brand_fb_find(p_fb_user text, p_email text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('member_id', m.id, 'email', u.email)
    from public.members m join auth.users u on u.id = m.id
   where m.role = 'brand' and coalesce(m.status, 'active') = 'active'
     and exists (select 1 from intel.ci_brand b where b.org_id = m.org_id)
     and (exists (select 1 from public.social_tokens t where t.member_id = m.id and t.platform = 'facebook_brand' and t.meta->>'fb_user_id' = p_fb_user)
          or (p_email is not null and lower(u.email) = lower(btrim(p_email))))
   order by (exists (select 1 from public.social_tokens t where t.member_id = m.id and t.platform = 'facebook_brand' and t.meta->>'fb_user_id' = p_fb_user)) desc
   limit 1 $$;
revoke all on function api.ops_brand_fb_find(text, text) from public, anon, authenticated;
grant execute on function api.ops_brand_fb_find(text, text) to service_role;

create or replace function api.ops_is_brand_login(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.id = p_member and m.role = 'brand' and coalesce(m.status, 'active') = 'active'
                   and exists (select 1 from intel.ci_brand b where b.org_id = m.org_id)) $$;
revoke all on function api.ops_is_brand_login(uuid) from public, anon, authenticated;
grant execute on function api.ops_is_brand_login(uuid) to service_role;

-- Brand CRM shows which brand logins have Facebook linked
create or replace function api.brand_logins(p_brand uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'email', m.email, 'created_at', m.created_at,
             'facebook', (select t.meta->>'fb_name' from public.social_tokens t where t.member_id = m.id and t.platform = 'facebook_brand'),
             'last_sign_in', (select u.last_sign_in_at from auth.users u where u.id = m.id)) order by m.created_at)
     from public.members m join intel.ci_brand b on b.org_id = m.org_id
    where b.brand_id = p_brand and m.role = 'brand'), '[]'::jsonb);
end $$;
revoke all on function api.brand_logins(uuid) from public, anon;
grant execute on function api.brand_logins(uuid) to authenticated;
