-- Super Admin → Creators: one live directory of every creator (Instagram, profile status, location, rates,
-- campaigns) and a "Creator 360" view with every detail + their campaigns + Instagram posts. ADDITIVE.
-- Platform admins only; every 360 view is written to the audit/activity log.

-- ---------------------------------------------------------------------------------------------------
-- 1) Directory: one row per creator
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_creators()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'joined_at') desc nulls last) from (
    select jsonb_build_object(
      'member_id', m.id,
      'name', coalesce(nullif(btrim(m.name),''), nullif(btrim(concat_ws(' ', per.first_name, per.last_name)),''), sa.name, sa.username, 'Creator'),
      'status', m.status,
      'joined_at', coalesce(m.created_at, u.created_at),
      'last_sign_in_at', u.last_sign_in_at,
      'last_seen', (select max(l.created_at) from public.activity_log l where l.member_id = m.id),
      'whatsapp', coalesce(m.whatsapp_e164, case when coalesce(u.phone,'') <> '' then '+' || u.phone end),
      'email', case when coalesce(con.email,'') ~* '@creators\.bountythreads\.app$' then null else nullif(con.email,'') end,
      'email_verified', con.email_verified_at is not null,
      'ig_username', sa.username, 'followers', sa.followers_count, 'media_count', sa.media_count,
      'pic', sa.profile_picture_url, 'ig_synced_at', sa.updated_at,
      'engagement', (select round(avg(coalesce((e->>'like_count')::numeric,0) + coalesce((e->>'comments_count')::numeric,0))
                                  / nullif(sa.followers_count,0) * 100, 2)
                       from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e),
      'identity_id', idn.identity_id,
      'city', coalesce(ad.city, pr.city_coarse), 'state', coalesce(ad.state, pr.state_coarse),
      'categories', coalesce(to_jsonb(pr.categories), '[]'::jsonb),
      'gender', per.gender,
      'accepts_barter', cp.accepts_barter,
      'reel_rate', (select min(i.amount) from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                     where rc.identity_id = idn.identity_id and rc.status = 'active' and i.deliverable_type ilike '%reel%' and i.amount > 0),
      'skills', coalesce((select jsonb_agg(s.skill_key order by s.skill_key) from intel.ci_creator_skill s where s.identity_id = idn.identity_id), '[]'::jsonb),
      'pets', (select count(*) from private.creator_pet p where p.identity_id = idn.identity_id),
      'pages', (select count(*) from intel.ci_creator_managed_profile g where g.identity_id = idn.identity_id),
      'travel_city', (select t.city from intel.ci_creator_travel t where t.identity_id = idn.identity_id),
      'complete', (rq.req->>'complete')::boolean, 'done', (rq.req->>'done')::int, 'total', (rq.req->>'total')::int,
      'applied', (select count(*) from intel.ci_campaign_participation p where p.identity_id = idn.identity_id)
               + (select count(*) from public.applications a where m.org_id is not null and a.org_id = m.org_id),
      'pending', (select count(*) from intel.ci_campaign_participation p where p.identity_id = idn.identity_id
                    and p.stage in ('applied','eligible','sent_to_brand','shortlisted','invited')),
      'approved', (select count(*) from intel.ci_campaign_participation p where p.identity_id = idn.identity_id
                    and p.stage not in ('applied','eligible','sent_to_brand','shortlisted','invited','ineligible','brand_declined','rejected','dropped'))
                + (select count(*) from public.applications a where m.org_id is not null and a.org_id = m.org_id and a.status = 'Approved'),
      'completed', (select count(*) from intel.ci_campaign_participation p where p.identity_id = idn.identity_id and p.stage = 'completed')) x
    from public.members m
    join auth.users u on u.id = m.id
    left join public.social_accounts sa on sa.member_id = m.id and sa.platform = 'instagram'
    left join lateral (select a.identity_id from intel.ci_identity_actor_access a
                        where a.member_id = m.id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) idn on true
    left join private.creator_personal_profile per on per.identity_id = idn.identity_id
    left join private.creator_contact con on con.identity_id = idn.identity_id
    left join intel.ci_creator_professional_profile pr on pr.identity_id = idn.identity_id
    left join intel.ci_creator_commercial_preference cp on cp.identity_id = idn.identity_id
    left join lateral (select a.city, a.state from private.creator_address a where a.identity_id = idn.identity_id and a.deleted_at is null
                        order by a.is_default desc, a.created_at limit 1) ad on true
    left join lateral (select case when idn.identity_id is not null then intel.ci_profile_requirements(idn.identity_id) end as req) rq on true
   where m.role = 'creator') s), '[]'::jsonb);
end $$;
revoke all on function public.admin_creators() from public, anon;
grant execute on function public.admin_creators() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2) Creator 360: every profile detail + account + Instagram + campaigns + marketplace applications
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_creator_profile(p_member uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_org uuid;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  select m.org_id into v_org from public.members m where m.id = p_member;
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', 'admin_view_profile', jsonb_build_object('member_id', p_member));
  return jsonb_build_object(
    'identity_id', v_identity,
    'member', (select jsonb_build_object('name', m.name, 'role', m.role, 'status', m.status, 'org_name', m.org_name,
                 'joined_at', coalesce(m.created_at, u.created_at), 'last_sign_in_at', u.last_sign_in_at,
                 'whatsapp', coalesce(m.whatsapp_e164, case when coalesce(u.phone,'') <> '' then '+' || u.phone end),
                 'consent', public.activity_consent_of(m.id),
                 'logins', (select count(*) from public.activity_log l where l.member_id = m.id and l.kind = 'security' and l.event in ('login','session_start')),
                 'last_seen', (select max(l.created_at) from public.activity_log l where l.member_id = m.id),
                 'last_city', (select concat_ws(', ', l.city, l.region) from public.activity_log l where l.member_id = m.id and l.city is not null order by l.created_at desc limit 1))
               from public.members m join auth.users u on u.id = m.id where m.id = p_member),
    'instagram', (select jsonb_build_object('username', sa.username, 'name', sa.name, 'account_type', sa.account_type,
                    'followers', sa.followers_count, 'follows', sa.follows_count, 'media_count', sa.media_count,
                    'pic', sa.profile_picture_url, 'biography', sa.biography, 'website', sa.website, 'avg_reach', sa.avg_reach,
                    'connected_at', sa.connected_at, 'synced_at', sa.updated_at,
                    'media', coalesce((select jsonb_agg(jsonb_build_object('media_type', e->>'media_type',
                                'img', coalesce(e->>'thumbnail_url', e->>'media_url'), 'permalink', e->>'permalink',
                                'likes', (e->>'like_count')::int, 'comments', (e->>'comments_count')::int, 'at', e->>'timestamp',
                                'caption', left(coalesce(e->>'caption',''), 160)))
                              from (select e from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e limit 12) q), '[]'::jsonb))
                  from public.social_accounts sa where sa.member_id = p_member and sa.platform = 'instagram' limit 1),
    'requirements', case when v_identity is not null then intel.ci_profile_requirements(v_identity) end,
    'personal', (select to_jsonb(p) - 'identity_id' from private.creator_personal_profile p where p.identity_id = v_identity),
    'contact',  (select to_jsonb(c) - 'identity_id' from private.creator_contact c where c.identity_id = v_identity),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) - 'identity_id' order by a.is_default desc, a.created_at)
                           from private.creator_address a where a.identity_id = v_identity and a.deleted_at is null), '[]'::jsonb),
    'professional', (select to_jsonb(pr) - 'identity_id' from intel.ci_creator_professional_profile pr where pr.identity_id = v_identity),
    'skills', coalesce((select jsonb_agg(s.skill_key order by s.skill_key) from intel.ci_creator_skill s where s.identity_id = v_identity), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(s.resource_key order by s.resource_key) from intel.ci_creator_resource s where s.identity_id = v_identity), '[]'::jsonb),
    'commercial_preference', (select to_jsonb(cp) - 'identity_id' from intel.ci_creator_commercial_preference cp where cp.identity_id = v_identity),
    'rate_items', coalesce((select jsonb_agg(jsonb_build_object('deliverable_type', i.deliverable_type, 'amount', i.amount, 'unit_quantity', i.unit_quantity) order by i.deliverable_type)
                            from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                           where rc.identity_id = v_identity and rc.status = 'active'), '[]'::jsonb),
    'pets', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'pet_type', x.pet_type) order by x.created_at) from private.creator_pet x where x.identity_id = v_identity), '[]'::jsonb),
    'managed_profiles', coalesce((select jsonb_agg(jsonb_build_object('platform', g.platform, 'handle', g.handle, 'followers', g.followers, 'category', g.category, 'relation', g.relation) order by g.created_at)
                                  from intel.ci_creator_managed_profile g where g.identity_id = v_identity), '[]'::jsonb),
    'travel', (select to_jsonb(t) - 'identity_id' from intel.ci_creator_travel t where t.identity_id = v_identity),
    'fav_brands', coalesce((select jsonb_agg(a.submitted_brand_name order by a.priority_rank nulls last) from intel.ci_creator_brand_aspiration a
                            where a.identity_id = v_identity and a.active), '[]'::jsonb),
    'brands_worked', coalesce((select jsonb_agg(jsonb_build_object('brand', b.submitted_brand_name, 'type', coalesce(b.compensation_type, b.relationship_type),
                                 'detected', b.source_type = 'content_detected_suggestion') order by b.created_at)
                               from intel.ci_creator_brand_experience b where b.identity_id = v_identity and b.creator_rejected_at is null), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id,
                             'campaign', c.name, 'brand', c.submitted_brand_name, 'stage', p.stage, 'reason', p.reason,
                             'applied_profile', p.applied_profile, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'status', c.lifecycle_status,
                             'campaign_type', coalesce(br.requirements->>'campaign_type',
                                case c.comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' when 'barter' then 'barter' end),
                             'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
                             'applied_at', p.created_at, 'updated_at', p.updated_at) order by p.created_at desc)
                           from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
                           left join lateral (select b.requirements from intel.ci_campaign_brief b where b.campaign_id = c.campaign_id order by b.created_at desc limit 1) br on true
                          where p.identity_id = v_identity), '[]'::jsonb),
    'marketplace', coalesce((select jsonb_agg(jsonb_build_object('campaign', a.campaign_name, 'status', a.status, 'applied_at', a.created_at) order by a.created_at desc)
                             from public.applications a where v_org is not null and a.org_id = v_org), '[]'::jsonb));
end $$;
revoke all on function public.admin_creator_profile(uuid) from public, anon;
grant execute on function public.admin_creator_profile(uuid) to authenticated;
