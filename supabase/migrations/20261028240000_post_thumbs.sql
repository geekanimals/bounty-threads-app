-- 🖼 Post pictures that never break (brand Top posts, reports):
--   * a post's picture used to come only from the creator's connected Instagram "recent posts" list — creators not
--     connected (bulk sheet, public numbers) had none, and Instagram's picture links expire after a few days → blank cards
--   * now the post-thumb Edge Function fetches the picture LIVE from Instagram (the creator's own token by media id, else
--     business discovery of the public profile), saves a copy in our own storage (bucket post-thumbs) and remembers it here
--   * intel.ci_post_thumb reads this saved copy first, so every page that shows a post picture gets the permanent one
create table if not exists intel.ci_post_thumb_cache (
  code       text primary key,                 -- the post's code from its link (reel / p / tv)
  permalink  text,
  url        text,                             -- public URL of our saved copy
  source     text,                             -- 'own_token' | 'business_discovery'
  error      text,
  tries      int not null default 0,
  fetched_at timestamptz not null default now()
);
alter table intel.ci_post_thumb_cache enable row level security;
revoke all on table intel.ci_post_thumb_cache from public, anon, authenticated;
grant select, insert, update on table intel.ci_post_thumb_cache to service_role;

-- public read (pictures of public posts); only the server (service role) uploads
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('post-thumbs', 'post-thumbs', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- the saved copy first, then the connected creator's recent media (as before)
create or replace function intel.ci_post_thumb(p_permalink text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.url from intel.ci_post_thumb_cache c where p_permalink is not null and c.code = intel.ci_ig_code(p_permalink) and c.url is not null),
    (select coalesce(e->>'thumbnail_url', e->>'media_url')
       from public.social_accounts s, jsonb_array_elements(case when jsonb_typeof(s.recent_media) = 'array' then s.recent_media else '[]'::jsonb end) e
      where s.platform = 'instagram' and p_permalink is not null and intel.ci_norm_permalink(e->>'permalink') = intel.ci_norm_permalink(p_permalink)
      limit 1)) $$;
revoke all on function intel.ci_post_thumb(text) from public, anon, authenticated;

-- for the Edge Function: what it needs to fetch each picture. Only links that are real campaign posts (or bulk-sheet
-- post links) are served — the function never fetches arbitrary URLs.
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
     order by intel.ci_ig_code(l), i.created_at desc)
  select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'permalink', r.permalink,
           'cached', c.url, 'tries', coalesce(c.tries, 0), 'last_try', c.fetched_at,
           'media_id', o.media_id, 'member_id', o.member_id,
           'handle', coalesce(o.handle, iv.handle, s.handle))), '[]'::jsonb)
    from req r
    left join intel.ci_post_thumb_cache c on c.code = r.code
    left join own o on o.code = r.code
    left join inv iv on iv.code = r.code
    left join intel.ci_public_post_stats s on s.code = r.code
   where o.code is not null or iv.code is not null or s.code is not null $$;
revoke all on function api.ops_post_thumb_jobs(text[]) from public, anon, authenticated;
grant execute on function api.ops_post_thumb_jobs(text[]) to service_role;

create or replace function api.ops_post_thumb_save(p_code text, p_permalink text, p_url text, p_source text, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  insert into intel.ci_post_thumb_cache(code, permalink, url, source, error, tries, fetched_at)
  values (p_code, p_permalink, p_url, p_source, left(p_error, 300), case when p_url is null then 1 else 0 end, now())
  on conflict (code) do update set
    url = coalesce(excluded.url, intel.ci_post_thumb_cache.url),
    source = coalesce(excluded.source, intel.ci_post_thumb_cache.source),
    permalink = coalesce(excluded.permalink, intel.ci_post_thumb_cache.permalink),
    error = case when excluded.url is null then excluded.error else null end,
    tries = case when excluded.url is null then intel.ci_post_thumb_cache.tries + 1 else 0 end,
    fetched_at = now() $$;
revoke all on function api.ops_post_thumb_save(text, text, text, text, text) from public, anon, authenticated;
grant execute on function api.ops_post_thumb_save(text, text, text, text, text) to service_role;
