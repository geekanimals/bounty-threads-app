-- Campaign report: every creator who posted shows up with their numbers.
--  • Creators who never connected Instagram (or are only on the bulk sheet) had a blank "@" row and no numbers.
--    Their handle now comes from the bulk sheet / Instagram link, their followers from their public profile, and
--    their post numbers (likes, comments, and views when Instagram shares them) from the public profile through
--    Instagram business discovery — read with the Super Admin's connected Instagram by ci-post-insights-worker.
--  • Creators with Instagram connected keep their full numbers (views, reach, shares, saves) from insights.
--  • Bulk-sheet creators who are posted but haven't registered are in the report too.

create table if not exists intel.ci_public_post_stats (
  code text primary key,                  -- the post's code from its link (reel / p / tv) or story:<id>
  permalink text,
  handle text,
  media_type text,
  likes bigint,
  comments bigint,
  views bigint,
  posted_at timestamptz,
  fetched_at timestamptz,
  error text,
  tries int not null default 0
);
alter table intel.ci_public_post_stats enable row level security;
revoke all on intel.ci_public_post_stats from public, anon, authenticated;

-- the Instagram handle of whoever made a campaign post / is on a bulk row
create or replace function intel.ci_participation_handle(p_participation uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select lower(sa.username) from public.social_accounts sa
      where sa.member_id = intel.ci_member_of_identity(p.identity_id) and sa.platform = 'instagram' and coalesce(sa.username,'') <> '' limit 1),
    intel.ci_norm_handle(p.applied_profile),
    (select i.handle from intel.ci_campaign_invite i where i.participation_id = p.participation_id and i.handle is not null limit 1),
    (select i.handle from intel.ci_campaign_invite i where i.campaign_id = p.campaign_id and i.claimed_by = intel.ci_member_of_identity(p.identity_id)
        and i.handle is not null limit 1))
  from intel.ci_campaign_participation p where p.participation_id = p_participation $$;
revoke all on function intel.ci_participation_handle(uuid) from public, anon, authenticated;

-- post numbers: insights first, then the public numbers, then the creator's synced media
create or replace function intel.ci_post_stats(p_post uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; po record; v_member uuid; m jsonb; ps record;
begin
  select jsonb_build_object('reach', x.reach, 'impressions', x.impressions, 'views', x.views, 'likes', x.likes,
           'comments', x.comments, 'shares', x.shares, 'saves', x.saves, 'at', x.captured_at, 'source', 'insights')
    into r from intel.ci_campaign_post_metric x where x.post_id = p_post order by x.captured_at desc limit 1;
  if r is not null then return r; end if;
  select * into po from intel.ci_campaign_post where post_id = p_post;
  if po.post_id is null then return '{}'::jsonb; end if;
  select * into ps from intel.ci_public_post_stats s where s.code = intel.ci_ig_code(po.permalink) and s.fetched_at is not null and s.error is null;
  if ps.code is not null then
    return jsonb_strip_nulls(jsonb_build_object('likes', ps.likes, 'comments', ps.comments, 'views', ps.views, 'at', ps.fetched_at, 'source', 'public'));
  end if;
  select intel.ci_member_of_identity(p.identity_id) into v_member from intel.ci_campaign_participation p where p.participation_id = po.participation_id;
  select e into m from public.social_accounts sa, jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) e
   where sa.member_id = v_member and sa.platform = 'instagram'
     and ((po.external_media_id is not null and e->>'id' = po.external_media_id)
          or intel.ci_norm_permalink(e->>'permalink') = intel.ci_norm_permalink(po.permalink))
   limit 1;
  if m is null then return '{}'::jsonb; end if;
  return jsonb_strip_nulls(jsonb_build_object('likes', nullif(m->>'like_count','')::bigint, 'comments', nullif(m->>'comments_count','')::bigint,
           'reach', nullif(m->>'reach','')::bigint, 'views', coalesce(nullif(m->>'plays','')::bigint, nullif(m->>'views','')::bigint),
           'source', 'public'));
end $$;
revoke all on function intel.ci_post_stats(uuid) from public, anon, authenticated;

-- worker: which public profiles to read (handles with campaign posts that have no insights), with their post codes
create or replace function api.ops_public_post_targets(p_limit int default 40)
returns jsonb language sql stable security definer set search_path = '' as $$
  with posts as (
    -- campaign posts without insights (creator's Instagram not connected / not resolved)
    select intel.ci_participation_handle(po.participation_id) as handle, intel.ci_ig_code(po.permalink) as code, po.permalink, po.posted_at
      from intel.ci_campaign_post po
     where po.posted_at > now() - interval '60 days' and po.permalink is not null
       and not exists (select 1 from intel.ci_campaign_post_metric x where x.post_id = po.post_id)
    union all
    -- bulk-sheet rows (not registered) that are posted
    select i.handle, intel.ci_ig_code(l), l, coalesce(i.last_invited_at, i.created_at)
      from intel.ci_campaign_invite i cross join lateral unnest(i.post_links) l
     where i.participation_id is null and i.handle is not null and i.created_at > now() - interval '60 days'),
  due as (
    select p.handle, p.code, p.permalink from posts p
      left join intel.ci_public_post_stats s on s.code = p.code
     where p.handle is not null and p.code is not null and p.code !~ '^story:'
       and (s.code is null or s.fetched_at is null or s.fetched_at < now() - case when p.posted_at > now() - interval '3 days' then interval '3 hours' else interval '12 hours' end)
       and coalesce(s.tries, 0) < 20)
  select coalesce(jsonb_agg(jsonb_build_object('handle', handle, 'codes', codes, 'links', links)), '[]'::jsonb)
    from (select handle, array_agg(distinct code) codes, array_agg(distinct permalink) links from due group by handle
           order by handle limit greatest(1, least(coalesce(p_limit, 40), 100))) g $$;
revoke all on function api.ops_public_post_targets(int) from public, anon, authenticated;
grant execute on function api.ops_public_post_targets(int) to service_role;

-- worker: save what the public profile showed (followers + the campaign posts found in its latest media)
create or replace function api.ops_public_post_save(p_handle text, p_profile jsonb, p_codes text[], p_items jsonb, p_error text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_h text := intel.ci_norm_handle(p_handle); it jsonb; c text; n int := 0; v_code text;
begin
  if v_h is null then return 0; end if;
  if p_profile is not null and (p_profile->>'followers_count') is not null then
    insert into intel.ci_external_creator(platform, handle, display_name, followers, media_count, profile_picture_url, enriched_at, sources)
    values ('instagram', v_h, p_profile->>'name', (p_profile->>'followers_count')::int, nullif(p_profile->>'media_count','')::int,
            p_profile->>'profile_picture_url', now(), array['campaign_report'])
    on conflict (platform, handle) do update set followers = excluded.followers, media_count = coalesce(excluded.media_count, intel.ci_external_creator.media_count),
      display_name = coalesce(excluded.display_name, intel.ci_external_creator.display_name),
      profile_picture_url = coalesce(excluded.profile_picture_url, intel.ci_external_creator.profile_picture_url), enriched_at = now(), last_seen_at = now();
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_code := intel.ci_ig_code(it->>'permalink');
    if v_code is null or not (v_code = any(coalesce(p_codes, '{}'))) then continue; end if;
    insert into intel.ci_public_post_stats(code, permalink, handle, media_type, likes, comments, views, posted_at, fetched_at, error, tries)
    values (v_code, it->>'permalink', v_h, lower(coalesce(it->>'media_product_type', it->>'media_type')),
            nullif(it->>'like_count','')::bigint, nullif(it->>'comments_count','')::bigint,
            coalesce(nullif(it->>'view_count','')::bigint, nullif(it->>'play_count','')::bigint, nullif(it->>'video_view_count','')::bigint),
            nullif(it->>'timestamp','')::timestamptz, now(), null, 0)
    on conflict (code) do update set likes = excluded.likes, comments = excluded.comments, views = coalesce(excluded.views, intel.ci_public_post_stats.views),
      media_type = excluded.media_type, posted_at = coalesce(excluded.posted_at, intel.ci_public_post_stats.posted_at), handle = excluded.handle,
      fetched_at = now(), error = null, tries = 0;
    n := n + 1;
  end loop;
  -- codes not found in the profile's latest posts (or the whole read failed): remember the try
  foreach c in array coalesce(p_codes, '{}') loop
    insert into intel.ci_public_post_stats(code, handle, fetched_at, error, tries)
    values (c, v_h, now(), coalesce(p_error, 'not among this profile''s latest 50 posts'), 1)
    on conflict (code) do update set tries = intel.ci_public_post_stats.tries + 1,
      error = case when intel.ci_public_post_stats.likes is null then excluded.error else intel.ci_public_post_stats.error end,
      fetched_at = case when intel.ci_public_post_stats.likes is null then now() else intel.ci_public_post_stats.fetched_at end
     where intel.ci_public_post_stats.fetched_at is null or intel.ci_public_post_stats.fetched_at < now() - interval '1 minute';
  end loop;
  return n;
end $$;
revoke all on function api.ops_public_post_save(text, jsonb, text[], jsonb, text) from public, anon, authenticated;
grant execute on function api.ops_public_post_save(text, jsonb, text[], jsonb, text) to service_role;

-- the report: every creator who posted (app + bulk sheet), never a blank "@"
create or replace function api.campaign_analytics(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); v_rows jsonb; v_tot jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r order by (r->'totals'->>'views')::bigint desc nulls last, (r->'totals'->>'likes')::bigint desc nulls last), '[]'::jsonb) into v_rows from (
    -- creators in the app
    select jsonb_build_object('participation_id', p.participation_id, 'stage', p.stage,
             'creator', cc.card || jsonb_strip_nulls(jsonb_build_object(
                 'username', coalesce(nullif(cc.card->>'username',''), h.handle),
                 'followers', coalesce(nullif(cc.card->>'followers','')::bigint, ex.followers),
                 'name', coalesce(nullif(cc.card->>'name',''), ex.display_name, (select m.name from public.members m where m.id = intel.ci_member_of_identity(p.identity_id))))),
             'posts', x.posts,
             'totals', (select jsonb_build_object(
                  'reach', sum((e->'stats'->>'reach')::bigint), 'views', sum((e->'stats'->>'views')::bigint),
                  'likes', sum((e->'stats'->>'likes')::bigint), 'comments', sum((e->'stats'->>'comments')::bigint),
                  'shares', sum((e->'stats'->>'shares')::bigint), 'saves', sum((e->'stats'->>'saves')::bigint))
                from jsonb_array_elements(x.posts) e)) r
      from intel.ci_campaign_participation p
      cross join lateral (select intel.ci_public_creator_card(p.identity_id, p.applied_profile) card) cc
      cross join lateral (select intel.ci_participation_handle(p.participation_id) handle) h
      left join intel.ci_external_creator ex on ex.platform = 'instagram' and ex.handle = coalesce(nullif(lower(cc.card->>'username'),''), h.handle)
      cross join lateral (select intel.ci_participation_posts(p.participation_id) posts) x
     where p.campaign_id = v_id and p.stage in ('content_approved','published','completed')
    union all
    -- bulk-sheet creators who posted but haven't registered yet
    select jsonb_build_object('participation_id', null, 'invite_id', i.invite_id, 'stage', 'completed', 'on_sheet', true,
             'creator', jsonb_strip_nulls(jsonb_build_object('username', i.handle, 'name', coalesce(i.full_name, ex.display_name),
                          'followers', coalesce(ex.followers, i.followers), 'profile_picture_url', ex.profile_picture_url)),
             'posts', ps.posts,
             'totals', (select jsonb_build_object('reach', null, 'views', sum((e->'stats'->>'views')::bigint),
                  'likes', sum((e->'stats'->>'likes')::bigint), 'comments', sum((e->'stats'->>'comments')::bigint), 'shares', null, 'saves', null)
                from jsonb_array_elements(ps.posts) e))
      from intel.ci_campaign_invite i
      left join intel.ci_external_creator ex on ex.platform = 'instagram' and ex.handle = i.handle
      cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('permalink', l, 'media_type',
                   case when l ~* '/stories/' then 'story' when l ~* '/reels?/' then 'reel' else 'post' end,
                   'stats', coalesce((select jsonb_strip_nulls(jsonb_build_object('likes', s.likes, 'comments', s.comments, 'views', s.views, 'at', s.fetched_at, 'source', 'public'))
                                        from intel.ci_public_post_stats s where s.code = intel.ci_ig_code(l) and s.error is null and s.fetched_at is not null), '{}'::jsonb))), '[]'::jsonb) posts
                   from unnest(i.post_links) l) ps
     where i.campaign_id = v_id and i.participation_id is null and cardinality(i.post_links) > 0) s;
  select jsonb_build_object(
      'creators_live', (select count(*) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0),
      'posts', (select coalesce(sum(jsonb_array_length(e->'posts')),0) from jsonb_array_elements(v_rows) e),
      'followers', (select coalesce(sum((e->'creator'->>'followers')::bigint),0) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0),
      'reach', (select sum((e->'totals'->>'reach')::bigint) from jsonb_array_elements(v_rows) e),
      'views', (select sum((e->'totals'->>'views')::bigint) from jsonb_array_elements(v_rows) e),
      'likes', (select sum((e->'totals'->>'likes')::bigint) from jsonb_array_elements(v_rows) e),
      'comments', (select sum((e->'totals'->>'comments')::bigint) from jsonb_array_elements(v_rows) e),
      'shares', (select sum((e->'totals'->>'shares')::bigint) from jsonb_array_elements(v_rows) e),
      'saves', (select sum((e->'totals'->>'saves')::bigint) from jsonb_array_elements(v_rows) e),
      'waiting_numbers', (select count(*) from jsonb_array_elements(v_rows) e, jsonb_array_elements(e->'posts') pp where coalesce(pp->'stats', '{}'::jsonb) = '{}'::jsonb),
      -- creators whose numbers can only come from their public profile (Instagram not connected / only on the sheet)
      'not_connected', (select count(*) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0
                          and not exists (select 1 from jsonb_array_elements(e->'posts') pp where pp->'stats'->>'source' = 'insights')),
      'public_ready', exists (select 1 from public.social_tokens t where t.platform = 'facebook' and t.ig_user_id is not null
                                and (t.expires_at is null or t.expires_at > now()))) into v_tot;
  return jsonb_build_object(
    'campaign', (select jsonb_build_object('name', c.name, 'brand', c.submitted_brand_name, 'starts_on', c.starts_on, 'ends_on', c.ends_on)
                   from intel.ci_campaign c where c.campaign_id = v_id),
    'funnel', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from intel.ci_campaign_participation
                          where campaign_id = v_id group by stage) f), '{}'::jsonb),
    'totals', v_tot, 'creators', v_rows);
end $$;
revoke all on function api.campaign_analytics(uuid) from public, anon;
grant execute on function api.campaign_analytics(uuid) to authenticated;

-- read the numbers within the hour after this goes live
do $$ begin perform private.ci_kick_worker('ci-post-insights-worker'); exception when others then null; end $$;
