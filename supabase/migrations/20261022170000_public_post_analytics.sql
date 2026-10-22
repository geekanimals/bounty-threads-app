-- Post links → analytics for every creator, registered or not.
--  • ig-discover { action: "public_stats" } reads the creator's public profile (business discovery, through the
--    platform's Facebook connection) the moment a post link is added: followers, engagement rate, avg likes /
--    comments, latest posts, and that post's likes / comments / views. Saved here.
--  • ops_public_post_save now also keeps avg likes / comments / engagement / bio of the profile.
--  • api.creator_public_stats(handle): what we hold for a handle (profile + its post numbers) for the cards.
--  • api.public_stats_status(): is the Facebook connection there (public numbers need it), for the UI banner.

create or replace function api.ops_public_post_save(p_handle text, p_profile jsonb, p_codes text[], p_items jsonb, p_error text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_h text := intel.ci_norm_handle(p_handle); it jsonb; c text; n int := 0; v_code text;
begin
  if v_h is null then return 0; end if;
  if p_profile is not null and (p_profile->>'followers_count') is not null then
    insert into intel.ci_external_creator(platform, handle, display_name, followers, media_count, profile_picture_url, enriched_at, sources,
                                          avg_likes, avg_comments, engagement, bio)
    values ('instagram', v_h, p_profile->>'name', (p_profile->>'followers_count')::int, nullif(p_profile->>'media_count','')::int,
            p_profile->>'profile_picture_url', now(), array['campaign_report'],
            nullif(p_profile->>'avg_likes','')::numeric, nullif(p_profile->>'avg_comments','')::numeric, nullif(p_profile->>'engagement','')::numeric,
            left(nullif(p_profile->>'bio',''), 300))
    on conflict (platform, handle) do update set followers = excluded.followers, media_count = coalesce(excluded.media_count, intel.ci_external_creator.media_count),
      avg_likes = coalesce(excluded.avg_likes, intel.ci_external_creator.avg_likes), avg_comments = coalesce(excluded.avg_comments, intel.ci_external_creator.avg_comments),
      engagement = coalesce(excluded.engagement, intel.ci_external_creator.engagement), bio = coalesce(excluded.bio, intel.ci_external_creator.bio),
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

create or replace function api.creator_public_stats(p_handle text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_h text := intel.ci_norm_handle(p_handle);
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not (intel.ci_can_discover() or intel.ci_is_agency_operator()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_h is null then return null; end if;
  return jsonb_build_object(
    'profile', (select jsonb_strip_nulls(jsonb_build_object('handle', e.handle, 'name', e.display_name, 'followers', e.followers, 'media_count', e.media_count,
                  'profile_picture_url', e.profile_picture_url, 'avg_likes', e.avg_likes, 'avg_comments', e.avg_comments, 'engagement', e.engagement,
                  'bio', e.bio, 'fetched_at', e.enriched_at))
                  from intel.ci_external_creator e where e.platform = 'instagram' and e.handle = v_h),
    'posts', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('code', s.code, 'permalink', s.permalink, 'media_type', s.media_type, 'likes', s.likes,
                  'comments', s.comments, 'views', s.views, 'posted_at', s.posted_at, 'fetched_at', s.fetched_at, 'error', s.error)) order by s.posted_at desc nulls last)
                  from intel.ci_public_post_stats s where s.handle = v_h), '[]'::jsonb));
end $$;
revoke all on function api.creator_public_stats(text) from public, anon;
grant execute on function api.creator_public_stats(text) to authenticated;

create or replace function api.public_stats_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('facebook', exists (select 1 from public.social_tokens t where t.platform = 'facebook' and t.ig_user_id is not null
                                                  and (t.expires_at is null or t.expires_at > now())),
                            'is_admin', public.is_platform_admin()) $$;
revoke all on function api.public_stats_status() from public, anon;
grant execute on function api.public_stats_status() to authenticated;
