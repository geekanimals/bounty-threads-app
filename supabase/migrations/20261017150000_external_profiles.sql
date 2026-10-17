-- Instagram creators who aren't on Geek OS yet: their saved public numbers by handle, so lists that only know a
-- handle (a campaign's off-platform invites) can show proper cards — picture, followers, engagement, bio.
-- ADDITIVE · read-only · same gate as Discovery.
create or replace function api.external_profiles(p_handles text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not intel.ci_can_discover() then raise exception 'discovery is for approved agencies, brands and the Super Admin' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'handle', e.handle, 'name', e.display_name, 'bio', left(e.bio, 220), 'followers', e.followers, 'posts', e.media_count,
      'engagement', e.engagement, 'avg_likes', round(e.avg_likes), 'profile_picture_url', e.profile_picture_url,
      'city', e.city, 'categories', to_jsonb(e.categories), 'fetched', e.followers is not null, 'error', e.enrich_error))
      from intel.ci_external_creator e
     where e.platform = 'instagram'
       and e.handle = any (select lower(regexp_replace(btrim(h), '^@', '')) from unnest(coalesce(p_handles, '{}')) h limit 300)), '[]'::jsonb);
end $$;
revoke all on function api.external_profiles(text[]) from public, anon;
grant execute on function api.external_profiles(text[]) to authenticated;
