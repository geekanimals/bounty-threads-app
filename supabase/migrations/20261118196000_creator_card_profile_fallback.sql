-- creator card: Instagram first; when Instagram isn't connected, what the creator (or the team's sheet) put in the profile.
-- Before: creators without Instagram had an empty card (no name / followers / city anywhere) — 57 of 81 on Wedding.
create or replace function intel.ci_public_creator_card(p_identity uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $f$
begin
  return (select coalesce((
    select jsonb_strip_nulls(jsonb_build_object('member_id', a.member_id,
      'username', coalesce(sa.username, nullif(ltrim(pp.ig_handle_self, '@'), '')),
      'name', coalesce(nullif(sa.name, ''), nullif(pp.display_name, ''), sa.username),
      'profile_picture_url', sa.profile_picture_url,
      'followers', coalesce(sa.followers_count, pp.followers_self),
      'followers_from', case when sa.followers_count is not null then 'instagram' when pp.followers_self is not null then 'profile' end,
      'avg_reach', sa.avg_reach,
      'engagement', case when coalesce(sa.followers_count,0) > 0 and jsonb_array_length(coalesce(sa.recent_media,'[]'::jsonb)) > 0 then
          round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0)) from jsonb_array_elements(sa.recent_media) m2) / sa.followers_count, 2) end,
      'city', pp.city_coarse,
      'categories', coalesce(to_jsonb(pp.categories), '[]'::jsonb)))
      from intel.ci_identity_actor_access a
      left join lateral (select s.* from public.social_accounts s where s.member_id = a.member_id and s.platform = 'instagram' order by s.followers_count desc nulls last limit 1) sa on true
      left join intel.ci_creator_professional_profile pp on pp.identity_id = a.identity_id
     where a.identity_id = p_identity and a.access_role = 'self' and a.revoked_at is null
     limit 1), '{}'::jsonb));
end $f$;
