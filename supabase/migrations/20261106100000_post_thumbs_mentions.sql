-- 🖼 Media kit Mentions (other accounts' posts that tag a creator) get permanent pictures too: the post-thumb function
-- may now fetch a link that is in a creator's saved mentions — by the creator's own token (media id), else business
-- discovery of the account that posted it — and keeps our own copy, so the picture never breaks again.
create or replace function api.ops_post_thumb_jobs(p_permalinks text[])
returns jsonb language sql stable security definer set search_path = '' as $$
  with req as (
    select distinct intel.ci_ig_code(l) as code, l as permalink from unnest(coalesce(p_permalinks, '{}')) l
     where intel.ci_ig_code(l) is not null and intel.ci_ig_code(l) !~ '^story:' limit 30),
  own as (
    select distinct on (intel.ci_ig_code(po.permalink)) intel.ci_ig_code(po.permalink) as code, po.external_media_id as media_id,
           intel.ci_member_of_identity(cp.identity_id) as member_id, intel.ci_participation_handle(po.participation_id) as handle
      from intel.ci_campaign_post po join intel.ci_campaign_participation cp on cp.participation_id = po.participation_id
     where intel.ci_ig_code(po.permalink) in (select code from req)
     order by intel.ci_ig_code(po.permalink), po.external_media_id nulls last),
  inv as (
    select distinct on (intel.ci_ig_code(l)) intel.ci_ig_code(l) as code, i.handle
      from intel.ci_campaign_invite i cross join lateral unnest(i.post_links) l
     where intel.ci_ig_code(l) in (select code from req) and i.handle is not null
     order by intel.ci_ig_code(l), i.created_at desc),
  men as (
    select distinct on (intel.ci_ig_code(e->>'permalink')) intel.ci_ig_code(e->>'permalink') as code, nullif(e->>'id', '') as media_id,
           s.member_id, lower(nullif(e->>'username', '')) as handle
      from public.social_accounts s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.mentions) = 'array' then s.mentions else '[]'::jsonb end) e
     where s.platform = 'instagram' and intel.ci_ig_code(e->>'permalink') in (select code from req)
     order by intel.ci_ig_code(e->>'permalink'), s.updated_at desc nulls last)
  select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'permalink', r.permalink,
           'cached', c.url, 'tries', coalesce(c.tries, 0), 'last_try', c.fetched_at,
           'media_id', coalesce(o.media_id, m.media_id), 'member_id', coalesce(o.member_id, m.member_id),
           'handle', coalesce(o.handle, iv.handle, m.handle, s.handle))), '[]'::jsonb)
    from req r
    left join intel.ci_post_thumb_cache c on c.code = r.code
    left join own o on o.code = r.code
    left join inv iv on iv.code = r.code
    left join men m on m.code = r.code
    left join intel.ci_public_post_stats s on s.code = r.code
   where o.code is not null or iv.code is not null or m.code is not null or s.code is not null $$;
revoke all on function api.ops_post_thumb_jobs(text[]) from public, anon, authenticated;
grant execute on function api.ops_post_thumb_jobs(text[]) to service_role;

-- the media kit (public page too) shows our saved copy for any post we have one for — posts and mentions — so brands
-- opening a kit link never see an expired picture
create or replace function intel.ci_kit_media_fix(p jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when jsonb_typeof(p) <> 'array' then p else coalesce((
    select jsonb_agg(case when c.url is not null then e || jsonb_build_object('media_url', c.url, 'thumbnail_url', c.url, 'saved_pic', true) else e end order by n)
      from jsonb_array_elements(p) with ordinality x(e, n)
      left join intel.ci_post_thumb_cache c on c.code = intel.ci_ig_code(e->>'permalink') and c.url is not null), '[]'::jsonb) end $$;
revoke all on function intel.ci_kit_media_fix(jsonb) from public, anon, authenticated;

do $p$
declare d text; n text;
begin
  d := pg_get_functiondef('public.public_profile(text)'::regprocedure);
  if position('ci_kit_media_fix' in d) > 0 then return; end if;
  n := replace(d, 's.profile_picture_url, s.biography, s.website, s.recent_media, s.audience, s.mentions, s.edits',
                  's.profile_picture_url, s.biography, s.website, intel.ci_kit_media_fix(s.recent_media), s.audience, intel.ci_kit_media_fix(s.mentions), s.edits');
  n := replace(n, $a$coalesce(l.account->'recent_media','[]'::jsonb), coalesce(l.account->'audience','{}'::jsonb),
           coalesce(l.account->'mentions','[]'::jsonb)$a$,
                  $a$intel.ci_kit_media_fix(coalesce(l.account->'recent_media','[]'::jsonb)), coalesce(l.account->'audience','{}'::jsonb),
           intel.ci_kit_media_fix(coalesce(l.account->'mentions','[]'::jsonb))$a$);
  if (length(n) - length(replace(n, 'ci_kit_media_fix', ''))) / length('ci_kit_media_fix') <> 4 then raise exception 'public_profile not patched'; end if;
  execute n;
end $p$;
