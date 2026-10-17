-- Instagram creators who aren't on Geek OS yet: everything we already know about them, not only the numbers.
--   • where we found them — mentioned in a Geek OS creator's post, tagged one of our accounts, a #hashtag search,
--     added by hand — and WHO mentioned / tagged them
--   • the post they were seen in (caption + link), their hashtags, how often they were mentioned, when first seen
--   • "bio" is only a real bio once their profile has been fetched; before that the text we hold is the caption of
--     the post they were mentioned in, so it is returned as seen_in_post instead (no fake bios on the card)
-- ADDITIVE · read-only · same gate as Discovery · same signature as 20261017150000.
create or replace function api.external_profiles(p_handles text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not intel.ci_can_discover() then raise exception 'discovery is for approved agencies, brands and the Super Admin' using errcode = '42501'; end if;
  return coalesce((
    with h as (select distinct lower(regexp_replace(btrim(x), '^@', '')) handle from unnest(coalesce(p_handles, '{}')) x limit 300)
    select jsonb_agg(jsonb_build_object(
      'handle', e.handle, 'name', e.display_name,
      'bio', case when e.enriched_at is not null or e.followers is not null then left(e.bio, 220) end,
      'seen_in_post', case when e.enriched_at is null and e.followers is null then left(e.bio, 220) end,
      'post_link', e.sample_permalink,
      'followers', e.followers, 'posts', e.media_count, 'engagement', e.engagement, 'avg_likes', round(e.avg_likes),
      'profile_picture_url', e.profile_picture_url, 'city', e.city, 'categories', to_jsonb(e.categories),
      'hashtags', to_jsonb(e.hashtags[1:8]), 'sources', to_jsonb(e.sources), 'mention_count', e.mention_count,
      'first_seen_at', e.first_seen_at, 'last_seen_at', e.last_seen_at,
      'mentioned_by', (select coalesce(jsonb_agg(distinct lower(sa.username)), '[]'::jsonb) from (
            select sa.username from public.social_accounts sa
             where sa.platform = 'instagram' and sa.username is not null
               and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) m
                            where lower(coalesce(m->>'caption','')) like '%@' || e.handle || '%')
             limit 5) sa),
      'tagged', (select coalesce(jsonb_agg(distinct lower(sa.username)), '[]'::jsonb) from (
            select sa.username from public.social_accounts sa
             where sa.platform = 'instagram' and sa.username is not null
               and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(sa.mentions) = 'array' then sa.mentions else '[]'::jsonb end) m
                            where lower(coalesce(m->>'username','')) = e.handle)
             limit 5) sa),
      'fetched', e.followers is not null, 'error', e.enrich_error))
      from intel.ci_external_creator e join h on h.handle = e.handle
     where e.platform = 'instagram'), '[]'::jsonb);
end $$;
revoke all on function api.external_profiles(text[]) from public, anon;
grant execute on function api.external_profiles(text[]) to authenticated;
