-- 🏢 Brand portal: creators uploaded on a campaign's sheet (bulk invite) who haven't joined Geek OS yet are part of the
-- campaign too — they now show in the brand's creator list, counts, posts and CSV / PDF (they were only in analytics,
-- so the numbers didn't match). Public profile only, same as everyone else. ADDITIVE.
create or replace function intel.ci_brand_sheet_rows(p_campaign uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r order by (r->'status'->>'step')::int desc, r->>'updated_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('participation_id', null, 'invite_id', i.invite_id, 'on_sheet', true,
             'stage', case when ps.n > 0 then 'completed' else 'invited' end,
             'status', case when ps.n > 0 then '{"key":"posted","label":"Posted","step":6}'::jsonb
                            when i.video_url is not null then '{"key":"making","label":"Video sent to the team","step":3}'::jsonb
                            else '{"key":"invited","label":"Invited — not on Geek OS yet","step":0}'::jsonb end,
             'applied_at', i.created_at, 'updated_at', coalesce(i.last_invited_at, i.created_at),
             'creator', jsonb_strip_nulls(jsonb_build_object('name', coalesce(i.full_name, ex.display_name), 'username', i.handle,
                          'followers', coalesce(ex.followers, i.followers), 'city', i.city, 'profile_picture_url', ex.profile_picture_url)),
             'video', case when i.video_url is not null then jsonb_build_object('url', i.video_url) end,
             'posts', ps.posts) r
      from intel.ci_campaign_invite i
      left join intel.ci_external_creator ex on ex.platform = 'instagram' and ex.handle = i.handle
      cross join lateral (select count(*) n, coalesce(jsonb_agg(jsonb_build_object('permalink', l, 'stats', coalesce(
                    (select jsonb_strip_nulls(ip.metrics) from intel.ci_invite_post ip where ip.invite_id = i.invite_id and ip.permalink is not null
                        and ip.metrics <> '{}'::jsonb and intel.ci_norm_permalink(ip.permalink) = intel.ci_norm_permalink(l) order by ip.created_at desc limit 1),
                    (select jsonb_strip_nulls(jsonb_build_object('likes', s.likes, 'comments', s.comments, 'views', s.views))
                       from intel.ci_public_post_stats s where s.code = intel.ci_ig_code(l) and s.error is null and s.fetched_at is not null), '{}'::jsonb))), '[]'::jsonb) posts
                   from unnest(coalesce(i.post_links, '{}')) l) ps
     where i.campaign_id = p_campaign and i.participation_id is null) q $$;
revoke all on function intel.ci_brand_sheet_rows(uuid) from public, anon, authenticated;

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
                 'counts', (select jsonb_object_agg(k, n) from (select k, count(*) n from (
                              select intel.ci_brand_stage(p.stage)->>'key' k from intel.ci_campaign_participation p where p.campaign_id = c.campaign_id
                              union all select x->'status'->>'key' from jsonb_array_elements(intel.ci_brand_sheet_rows(c.campaign_id)) x) q group by 1) s),
                 'posts', (select count(*) from intel.ci_campaign_participation p, jsonb_array_elements(intel.ci_participation_posts(p.participation_id)) e
                            where p.campaign_id = c.campaign_id and p.stage in ('content_approved','published','completed'))
                         + (select coalesce(sum(jsonb_array_length(x->'posts')),0) from jsonb_array_elements(intel.ci_brand_sheet_rows(c.campaign_id)) x)) x
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
              from intel.ci_campaign_participation p where p.campaign_id = v_id), '[]'::jsonb) || intel.ci_brand_sheet_rows(v_id),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'to', e.to_status, 'status', intel.ci_brand_stage(e.to_status)->>'label',
                   'creator', intel.ci_brand_card(p.identity_id, p.applied_profile)->>'name') order by e.at desc)
              from (select * from intel.ci_campaign_event e where e.campaign_id = v_id and e.entity = 'participation' order by e.at desc limit 60) e
              left join intel.ci_campaign_participation p on p.participation_id = e.participation_id), '[]'::jsonb));
end $$;
