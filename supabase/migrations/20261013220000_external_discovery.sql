-- Discover creators who are NOT on Geek OS yet, straight from Instagram.
-- Every connected Instagram account (agency, brand or Super Admin) feeds the pool: the accounts that tagged
-- or mentioned it, and the @handles inside the posts of creators we already sync. Each handle is kept with the
-- hashtags, caption words and places it was found in, so it can be matched by content type and location —
-- then invited with one tap, and the invite opens the campaign the moment they sign up.

create table if not exists intel.ci_external_creator (
  external_id   uuid primary key default gen_random_uuid(),
  platform      text not null default 'instagram',
  handle        text not null check (handle ~ '^[a-z0-9._]{1,60}$'),
  display_name  text,
  bio           text,
  followers     integer check (followers is null or followers >= 0),
  media_count   integer,
  profile_picture_url text,
  categories    text[] not null default '{}',
  hashtags      text[] not null default '{}',
  city          text,
  sample_permalink text,
  mention_count integer not null default 1,
  sources       text[] not null default '{}',     -- tagged_brand | creator_caption | manual
  found_by_org  uuid,
  enriched_at   timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  constraint ci_external_creator_uq unique (platform, handle)
);
create index if not exists ci_external_creator_seen_idx on intel.ci_external_creator(last_seen_at desc);
alter table intel.ci_external_creator enable row level security;
revoke all on intel.ci_external_creator from anon, authenticated;
grant select, insert, update, delete on intel.ci_external_creator to service_role;

-- who may use discovery at all (agency, brand, manager, corporate, Super Admin)
create or replace function intel.ci_can_discover()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.members m where m.id = auth.uid()
      and m.role in ('owner','brand','manager','corporate') and coalesce(m.status,'active') = 'active') $$;
revoke all on function intel.ci_can_discover() from public, anon, authenticated;

-- caption → content categories (same vocabulary the creator profile uses)
create or replace function intel.ci_guess_categories(p_text text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(c), '{}') from (
    select c from (values
      ('Food','(food|foodie|recipe|cafe|restaurant|eats|cook|chef|bak(e|ing)|street ?food)'),
      ('Fashion','(fashion|outfit|ootd|style|saree|ethnic|streetwear|thrift)'),
      ('Beauty','(makeup|skincare|beauty|grwm|haircare|lipstick|glowup)'),
      ('Fitness','(fitness|gym|workout|yoga|fitfam|health)'),
      ('Travel','(travel|trip|wanderlust|explore|vacation|backpack|tourism)'),
      ('Tech','(tech|gadget|unboxing|smartphone|laptop|coding|gaming ?pc)'),
      ('Comedy','(comedy|funny|meme|skit|reelitfeelit)'),
      ('Lifestyle','(lifestyle|vlog|dailyvlog|routine)'),
      ('Parenting','(mom|momlife|dad|parent|baby|kids)'),
      ('Gaming','(gaming|gamer|bgmi|valorant|esports)'),
      ('Finance','(finance|stock|invest|money|crypto|mutualfund)'),
      ('Music','(music|singer|song|cover|dj|guitar)'),
      ('Dance','(dance|choreo|dancer)'),
      ('Art','(art|artist|paint|sketch|doodle|illustration)'),
      ('Pets','(dog|cat|pet|puppy|petlover)'),
      ('Home decor','(decor|interior|hometour|homedecor)'),
      ('Auto','(car|bike|automobile|motovlog)')) v(c, re)
    where coalesce(p_text,'') ~* v.re) s $$;
revoke all on function intel.ci_guess_categories(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Build the pool from everything Instagram has already given us
--   · accounts that TAGGED a connected account (their username comes back on the tags edge)
--   · @handles inside the captions of every creator we sync
-- Hashtags and caption words travel with the handle, so the same brief that screens platform creators
-- (category, city, content type) screens these too.
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_harvest_external(p_org uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  with mine as (select lower(username) h from public.social_accounts where platform = 'instagram' and username is not null),
  tagged as (   -- creators who tagged one of our connected accounts
    select lower(e->>'username') handle, e->>'caption' cap, e->>'permalink' link, sa.org_id, 'tagged_brand' src
      from public.social_accounts sa
      cross join lateral jsonb_array_elements(case when jsonb_typeof(sa.mentions) = 'array' then sa.mentions else '[]'::jsonb end) e
     where sa.platform = 'instagram' and coalesce(e->>'username','') <> ''
       and (p_org is null or sa.org_id = p_org)),
  captions as ( -- @handles mentioned inside creators' own posts
    select lower(regexp_replace(m[1], '^@', '')) handle, e->>'caption' cap, e->>'permalink' link, sa.org_id, 'creator_caption' src
      from public.social_accounts sa
      cross join lateral jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e
      cross join lateral regexp_matches(coalesce(e->>'caption',''), '(@[A-Za-z0-9._]{2,30})', 'g') m
     where sa.platform = 'instagram'),
  all_rows as (select * from tagged union all select * from captions),
  clean as (
    select handle, max(cap) cap, max(link) link, max(org_id::text)::uuid org_id, array_agg(distinct src) srcs, count(*)::int n
      from all_rows
     where handle ~ '^[a-z0-9._]{2,30}$'
       and handle not in (select h from mine)
       and handle not in (select lower(handle) from intel.ci_external_creator where enriched_at is not null and followers is null)
     group by handle)
  insert into intel.ci_external_creator(platform, handle, bio, sample_permalink, mention_count, sources, found_by_org,
                                        hashtags, categories, last_seen_at)
  select 'instagram', c.handle, left(c.cap, 300), c.link, c.n, c.srcs, coalesce(p_org, c.org_id),
         coalesce((select array_agg(distinct lower(t[1])) from regexp_matches(coalesce(c.cap,''), '#([A-Za-z0-9_]{2,30})', 'g') t), '{}'),
         intel.ci_guess_categories(c.cap), now()
    from clean c
  on conflict (platform, handle) do update set
    mention_count = intel.ci_external_creator.mention_count + excluded.mention_count,
    sample_permalink = coalesce(excluded.sample_permalink, intel.ci_external_creator.sample_permalink),
    hashtags = (select coalesce(array_agg(distinct x), '{}') from unnest(intel.ci_external_creator.hashtags || excluded.hashtags) x),
    categories = (select coalesce(array_agg(distinct x), '{}') from unnest(intel.ci_external_creator.categories || excluded.categories) x),
    sources = (select coalesce(array_agg(distinct x), '{}') from unnest(intel.ci_external_creator.sources || excluded.sources) x),
    last_seen_at = now();
  get diagnostics v_n = row_count;
  -- anyone who has since joined drops out of the pool
  delete from intel.ci_external_creator e
   where exists (select 1 from public.social_accounts sa where sa.platform = 'instagram' and lower(sa.username) = e.handle);
  return v_n;
end $$;
revoke all on function intel.ci_harvest_external(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Discovery API for agencies, brands and Super Admin
-- ---------------------------------------------------------------------------------------------------
create or replace function api.refresh_external_pool()
returns int language plpgsql security definer set search_path = '' as $$
begin
  if not intel.ci_can_discover() then raise exception 'discovery is for approved agencies, brands and the Super Admin' using errcode = '42501'; end if;
  return intel.ci_harvest_external(null);
end $$;
revoke all on function api.refresh_external_pool() from public, anon;
grant execute on function api.refresh_external_pool() to authenticated;

-- enrich / add handles the app fetched from Instagram (tags edge, or a handle the operator typed)
create or replace function api.save_external_candidates(p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare e jsonb; v_h text; v_n int := 0; v_org uuid;
begin
  if not intel.ci_can_discover() then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' then return 0; end if;
  select org_id into v_org from public.members where id = auth.uid();
  for e in select * from jsonb_array_elements(p_items) limit 200 loop
    v_h := lower(regexp_replace(coalesce(e->>'handle',''), '^@', ''));
    continue when v_h !~ '^[a-z0-9._]{2,30}$';
    continue when exists (select 1 from public.social_accounts sa where sa.platform = 'instagram' and lower(sa.username) = v_h);
    insert into intel.ci_external_creator(platform, handle, display_name, bio, followers, media_count, profile_picture_url,
                                          sample_permalink, categories, hashtags, city, sources, found_by_org, enriched_at, last_seen_at)
    values ('instagram', v_h, nullif(e->>'name',''), left(nullif(e->>'bio',''), 300),
            nullif(e->>'followers','')::int, nullif(e->>'media_count','')::int, nullif(e->>'profile_picture_url',''),
            nullif(e->>'permalink',''), intel.ci_guess_categories(concat_ws(' ', e->>'bio', e->>'caption')),
            coalesce((select array_agg(distinct lower(t[1])) from regexp_matches(concat_ws(' ', e->>'bio', e->>'caption'), '#([A-Za-z0-9_]{2,30})', 'g') t), '{}'),
            nullif(e->>'city',''), array[coalesce(nullif(e->>'source',''),'manual')], v_org,
            case when e ? 'followers' then now() end, now())
    on conflict (platform, handle) do update set
      display_name = coalesce(excluded.display_name, intel.ci_external_creator.display_name),
      bio = coalesce(excluded.bio, intel.ci_external_creator.bio),
      followers = coalesce(excluded.followers, intel.ci_external_creator.followers),
      media_count = coalesce(excluded.media_count, intel.ci_external_creator.media_count),
      profile_picture_url = coalesce(excluded.profile_picture_url, intel.ci_external_creator.profile_picture_url),
      sample_permalink = coalesce(excluded.sample_permalink, intel.ci_external_creator.sample_permalink),
      categories = (select coalesce(array_agg(distinct x), '{}') from unnest(intel.ci_external_creator.categories || excluded.categories) x),
      hashtags = (select coalesce(array_agg(distinct x), '{}') from unnest(intel.ci_external_creator.hashtags || excluded.hashtags) x),
      city = coalesce(excluded.city, intel.ci_external_creator.city),
      sources = (select coalesce(array_agg(distinct x), '{}') from unnest(intel.ci_external_creator.sources || excluded.sources) x),
      enriched_at = coalesce(excluded.enriched_at, intel.ci_external_creator.enriched_at),
      last_seen_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function api.save_external_candidates(jsonb) from public, anon;
grant execute on function api.save_external_candidates(jsonb) to authenticated;

-- the search itself: hashtag / category / city / followers, scored, with the invite state for a campaign
create or replace function api.discover_external(p_filters jsonb default '{}'::jsonb, p_campaign uuid default null, p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tag text; v_cat text; v_loc text; v_q text; v_min int; v_max int; v_camp uuid;
begin
  if not intel.ci_can_discover() then raise exception 'discovery is for approved agencies, brands and the Super Admin' using errcode = '42501'; end if;
  v_tag := nullif(lower(regexp_replace(coalesce(p_filters->>'hashtag',''), '^#', '')), '');
  v_cat := nullif(lower(btrim(coalesce(p_filters->>'category',''))), '');
  v_loc := nullif(lower(btrim(coalesce(p_filters->>'location',''))), '');
  v_q   := nullif(lower(btrim(coalesce(p_filters->>'q',''))), '');
  v_min := nullif(p_filters->>'min_followers','')::int; v_max := nullif(p_filters->>'max_followers','')::int;
  v_camp := intel.ci_resolve_campaign(p_campaign);

  return coalesce((select jsonb_agg(r order by (r->>'score')::int desc, (r->>'mention_count')::int desc) from (
    select jsonb_build_object(
      'handle', e.handle, 'name', e.display_name, 'bio', e.bio, 'followers', e.followers, 'media_count', e.media_count,
      'profile_picture_url', e.profile_picture_url, 'categories', to_jsonb(e.categories), 'hashtags', to_jsonb(e.hashtags),
      'city', e.city, 'permalink', e.sample_permalink, 'mention_count', e.mention_count, 'sources', to_jsonb(e.sources),
      'enriched', e.enriched_at is not null, 'last_seen_at', e.last_seen_at,
      'invited', v_camp is not null and exists (select 1 from intel.ci_campaign_invite i
                    where i.campaign_id = v_camp and lower(i.handle) = e.handle),
      'why', (select coalesce(jsonb_agg(w), '[]'::jsonb) from (
            select '#' || v_tag w where v_tag is not null and e.hashtags @> array[v_tag]
            union all select 'Tagged your brand' where e.sources @> array['tagged_brand']
            union all select c2 from unnest(e.categories) c2 where v_cat is not null and lower(c2) like '%'||v_cat||'%'
            union all select 'Mentioned ' || e.mention_count || '×' where e.mention_count > 1
            union all select e.city where v_loc is not null and lower(coalesce(e.city,'')) like '%'||v_loc||'%') q(w)),
      'score', (case when v_tag is not null and e.hashtags @> array[v_tag] then 30 else 0 end
              + case when e.sources @> array['tagged_brand'] then 25 else 0 end
              + case when v_cat is not null and exists (select 1 from unnest(e.categories) c3 where lower(c3) like '%'||v_cat||'%') then 20
                     when v_cat is null and array_length(e.categories,1) > 0 then 8 else 0 end
              + case when v_loc is not null and (lower(coalesce(e.city,'')) like '%'||v_loc||'%' or lower(coalesce(e.bio,'')) like '%'||v_loc||'%') then 15 else 0 end
              + least(e.mention_count * 3, 10)) ) r
      from intel.ci_external_creator e
     where not exists (select 1 from public.social_accounts sa where sa.platform = 'instagram' and lower(sa.username) = e.handle)
       and (v_tag is null or e.hashtags @> array[v_tag] or lower(coalesce(e.bio,'')) like '%'||v_tag||'%')
       and (v_cat is null or exists (select 1 from unnest(e.categories) c4 where lower(c4) like '%'||v_cat||'%')
            or lower(coalesce(e.bio,'')) like '%'||v_cat||'%')
       and (v_loc is null or lower(coalesce(e.city,'')) like '%'||v_loc||'%' or lower(coalesce(e.bio,'')) like '%'||v_loc||'%')
       and (v_q is null or e.handle like '%'||v_q||'%' or lower(coalesce(e.display_name,'')) like '%'||v_q||'%')
       and (v_min is null or coalesce(e.followers, v_min) >= v_min)
       and (v_max is null or coalesce(e.followers, v_max) <= v_max)
     order by (case when v_tag is not null and e.hashtags @> array[v_tag] then 30 else 0 end
             + case when e.sources @> array['tagged_brand'] then 25 else 0 end) desc, e.mention_count desc, e.last_seen_at desc
     limit greatest(coalesce(p_limit,60), 1)) s), '[]'::jsonb);
end $$;
revoke all on function api.discover_external(jsonb, uuid, int) from public, anon;
grant execute on function api.discover_external(jsonb, uuid, int) to authenticated;

-- how big the pool is + when it was last refreshed (shown above the results)
create or replace function api.external_pool_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not intel.ci_can_discover() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from intel.ci_external_creator),
    'tagged_brand', (select count(*) from intel.ci_external_creator where sources @> array['tagged_brand']),
    'enriched', (select count(*) from intel.ci_external_creator where enriched_at is not null),
    'last_seen_at', (select max(last_seen_at) from intel.ci_external_creator),
    'invited', (select count(*) from intel.ci_campaign_invite));
end $$;
revoke all on function api.external_pool_stats() from public, anon;
grant execute on function api.external_pool_stats() to authenticated;

-- keep the pool fresh on its own
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-harvest-external', '27 */6 * * *', $c$select intel.ci_harvest_external(null)$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

select intel.ci_harvest_external(null);
