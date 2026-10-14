-- Creator search (Qoruz-style) for agencies, brands and the Super Admin — one search across EVERY creator we know:
--   • creators on Geek OS (live Instagram numbers), and
--   • the discovery pool of Instagram creators who aren't on Geek OS yet (tagged / mentioned / imported / snowballed).
-- Filters: category (multi), location, follower tier / range, min engagement, gender, on-platform or not, keyword;
-- sort + real pagination with a total count. Inside a campaign it also says who is already invited / on it.
--
-- Growing the pool (Meta gives no "list every creator in a category" API, so we build our own database):
--   • bulk import — paste handles or upload a CSV (handle, name, followers, engagement, category, city …)
--   • enrichment worker (ig-discover-worker, hourly) — public numbers via Instagram business discovery for pool
--     handles without stats, and every @handle found in their recent captions joins the pool (snowball).
--     Runs only when Meta has granted business discovery; the app shows whether it's active.
-- ADDITIVE.

-- ---------- pool: richer columns ----------
alter table intel.ci_external_creator
  add column if not exists avg_likes     numeric,
  add column if not exists avg_comments  numeric,
  add column if not exists engagement    numeric,
  add column if not exists state         text,
  add column if not exists enrich_attempts int not null default 0,
  add column if not exists enrich_error  text;
create index if not exists ci_external_creator_followers_idx on intel.ci_external_creator(followers desc nulls last);

-- ---------- categories + city from bio / captions ----------
create or replace function intel.ci_guess_categories(p_text text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(c), '{}') from (
    select c from (values
      ('Lifestyle','(lifestyle|vlog|dailyvlog|routine|dayinmylife|aesthetic)'),
      ('Fashion','(fashion|outfit|ootd|style|saree|ethnic|streetwear|thrift|lookbook)'),
      ('Beauty','(makeup|skincare|beauty|grwm|haircare|lipstick|glowup|nails)'),
      ('Food','(food|foodie|recipe|cafe|restaurant|eats|cook|chef|bak(e|ing)|street ?food|foodblog)'),
      ('Travel','(travel|trip|wanderlust|explore|vacation|backpack|tourism|traveller)'),
      ('Fitness','(fitness|gym|workout|fitfam|bodybuilding|crossfit)'),
      ('Health','(health|wellness|yoga|nutrition|dietitian|mentalhealth|ayurveda)'),
      ('Tech','(tech|gadget|unboxing|smartphone|laptop|coding|developer|ai )'),
      ('Comedy','(comedy|funny|meme|skit|reelitfeelit|standup)'),
      ('Entertainment','(actor|actress|bollywood|movie|film|celebrity|tv)'),
      ('Parenting','(mom|momlife|mommy|dad|parent|baby|kids|toddler)'),
      ('Gaming','(gaming|gamer|bgmi|valorant|esports|pubg|freefire)'),
      ('Finance','(finance|stock|invest|money|crypto|mutualfund|trading)'),
      ('Business','(entrepreneur|startup|business|founder|marketing)'),
      ('Education','(education|teacher|study|upsc|neet|jee|learn|tutor)'),
      ('Music','(music|singer|song|cover|dj|guitar|rapper|musician)'),
      ('Dance','(dance|choreo|dancer|bharatanatyam|kathak)'),
      ('Art','(art|artist|paint|sketch|doodle|illustration|craft|diy)'),
      ('Photography','(photography|photographer|photo|portrait|clicks)'),
      ('Sports','(cricket|football|athlete|sports|runner|marathon|badminton)'),
      ('Pets','(dog|cat|pet|puppy|petlover|doggo)'),
      ('Home decor','(decor|interior|hometour|homedecor|gardening|plants)'),
      ('Auto','(car|bike|automobile|motovlog|supercar)'),
      ('Spirituality','(spiritual|meditation|astrology|devotional|bhakti)')) v(c, re)
    where coalesce(p_text,'') ~* v.re) s $$;

create or replace function intel.ci_guess_city(p_text text)
returns text language sql immutable set search_path = '' as $$
  select c from (values
    (1,'Delhi NCR','(new ?delhi|\mdelhi\M|\mncr\M|gurgaon|gurugram|noida|ghaziabad|faridabad)'),
    (2,'Mumbai','(mumbai|bombay|navi mumbai|thane)'), (3,'Bengaluru','(bengaluru|bangalore|blr)'),
    (4,'Hyderabad','(hyderabad|secunderabad)'), (5,'Chennai','(chennai|madras)'), (6,'Kolkata','(kolkata|calcutta)'),
    (7,'Pune','\mpune\M'), (8,'Ahmedabad','(ahmedabad|amdavad)'), (9,'Jaipur','jaipur'), (10,'Lucknow','lucknow'),
    (11,'Chandigarh','(chandigarh|mohali|panchkula)'), (12,'Indore','indore'), (13,'Bhopal','bhopal'), (14,'Surat','surat'),
    (15,'Kochi','(kochi|cochin)'), (16,'Goa','\mgoa\M'), (17,'Nagpur','nagpur'), (18,'Patna','patna'), (19,'Ludhiana','ludhiana'),
    (20,'Amritsar','amritsar'), (21,'Dehradun','dehradun'), (22,'Varanasi','(varanasi|banaras)'), (23,'Vadodara','(vadodara|baroda)'),
    (24,'Coimbatore','coimbatore'), (25,'Visakhapatnam','(visakhapatnam|vizag)'), (26,'Bhubaneswar','bhubaneswar'),
    (27,'Guwahati','guwahati'), (28,'Ranchi','ranchi'), (29,'Kanpur','kanpur'), (30,'Mysuru','(mysuru|mysore)'),
    (31,'Udaipur','udaipur'), (32,'Thiruvananthapuram','(thiruvananthapuram|trivandrum)'), (33,'Raipur','raipur'),
    (34,'Dubai','dubai'), (35,'London','london')) v(o, c, re)
   where coalesce(p_text,'') ~* v.re order by o limit 1 $$;

-- ---------- import / save (used by the lookup, the worker and bulk import) ----------
create or replace function intel.ci_upsert_external(e jsonb, p_org uuid, p_source text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_h text := lower(regexp_replace(btrim(coalesce(e->>'handle', e->>'username', '')), '^(https?://(www\.)?instagram\.com/)?@?', ''));
        v_txt text := concat_ws(' ', e->>'bio', e->>'caption', e->>'category');
        v_cats text[]; v_f int; v_eng numeric;
begin
  v_h := split_part(split_part(v_h, '/', 1), '?', 1);
  if v_h !~ '^[a-z0-9._]{2,30}$' then return false; end if;
  if exists (select 1 from public.social_accounts sa where sa.platform = 'instagram' and lower(sa.username) = v_h) then return false; end if;
  v_cats := (select coalesce(array_agg(distinct initcap(btrim(x))), '{}') from unnest(string_to_array(coalesce(e->>'category', e->>'categories',''), ',')) x where btrim(x) <> '')
            || intel.ci_guess_categories(v_txt);
  v_cats := (select coalesce(array_agg(distinct x), '{}') from unnest(v_cats) x);
  v_f := nullif(regexp_replace(coalesce(e->>'followers',''), '[^0-9]', '', 'g'), '')::int;
  v_eng := nullif(regexp_replace(coalesce(e->>'engagement',''), '[^0-9.]', '', 'g'), '')::numeric;
  if v_eng is null and v_f > 0 and nullif(e->>'avg_likes','') is not null then
    v_eng := round(100.0 * (coalesce((e->>'avg_likes')::numeric,0) + coalesce(nullif(e->>'avg_comments','')::numeric,0)) / v_f, 2);
  end if;
  insert into intel.ci_external_creator(platform, handle, display_name, bio, followers, media_count, profile_picture_url,
      sample_permalink, categories, hashtags, city, state, avg_likes, avg_comments, engagement, sources, found_by_org, enriched_at, last_seen_at)
  values ('instagram', v_h, nullif(btrim(e->>'name'),''), left(nullif(e->>'bio',''), 300), v_f,
      nullif(regexp_replace(coalesce(e->>'media_count',''), '[^0-9]', '', 'g'), '')::int, nullif(e->>'profile_picture_url',''),
      nullif(e->>'permalink',''), v_cats,
      coalesce((select array_agg(distinct lower(t[1])) from regexp_matches(v_txt, '#([A-Za-z0-9_]{2,30})', 'g') t), '{}'),
      coalesce(nullif(btrim(e->>'city'),''), intel.ci_guess_city(v_txt)), nullif(btrim(e->>'state'),''),
      nullif(e->>'avg_likes','')::numeric, nullif(e->>'avg_comments','')::numeric, v_eng,
      array[coalesce(nullif(p_source,''),'manual')], p_org, case when v_f is not null then now() end, now())
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
      state = coalesce(excluded.state, intel.ci_external_creator.state),
      avg_likes = coalesce(excluded.avg_likes, intel.ci_external_creator.avg_likes),
      avg_comments = coalesce(excluded.avg_comments, intel.ci_external_creator.avg_comments),
      engagement = coalesce(excluded.engagement, intel.ci_external_creator.engagement),
      sources = (select coalesce(array_agg(distinct x), '{}') from unnest(intel.ci_external_creator.sources || excluded.sources) x),
      enriched_at = coalesce(excluded.enriched_at, intel.ci_external_creator.enriched_at),
      enrich_error = case when excluded.followers is not null then null else intel.ci_external_creator.enrich_error end,
      last_seen_at = now();
  return true;
end $$;
revoke all on function intel.ci_upsert_external(jsonb, uuid, text) from public, anon, authenticated;

-- the existing lookup / tagged harvest keep working, now with engagement + city + snowball handles
create or replace function api.save_external_candidates(p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare e jsonb; v_n int := 0; v_org uuid; m text;
begin
  if not intel.ci_can_discover() then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' then return 0; end if;
  select org_id into v_org from public.members where id = auth.uid();
  for e in select * from jsonb_array_elements(p_items) limit 200 loop
    if intel.ci_upsert_external(e, v_org, coalesce(nullif(e->>'source',''),'manual')) then v_n := v_n + 1; end if;
    for m in select jsonb_array_elements_text(coalesce(e->'mentions','[]'::jsonb)) limit 30 loop
      perform intel.ci_upsert_external(jsonb_build_object('handle', m), v_org, 'snowball');
    end loop;
  end loop;
  return v_n;
end $$;

-- bulk import (paste / CSV): up to 500 rows a call
create or replace function api.import_creators(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e jsonb; v_ok int := 0; v_bad int := 0; v_org uuid;
begin
  if not intel.ci_can_discover() then raise exception 'discovery is for approved agencies, brands and the Super Admin' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'send a list of creators' using errcode = '22023'; end if;
  select org_id into v_org from public.members where id = auth.uid();
  for e in select * from jsonb_array_elements(p_rows) limit 500 loop
    if intel.ci_upsert_external(e, v_org, 'import') then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;
  end loop;
  return jsonb_build_object('added', v_ok, 'skipped', v_bad);
end $$;
revoke all on function api.import_creators(jsonb) from public, anon;
grant execute on function api.import_creators(jsonb) to authenticated;

-- ---------- THE search ----------
create or replace function api.creator_search(p_filters jsonb default '{}'::jsonb, p_page int default 1, p_size int default 24, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text; v_loc text; v_min int; v_max int; v_eng numeric; v_gender text; v_src text; v_sort text; v_cats text[];
        v_camp uuid; v_size int := least(greatest(coalesce(p_size,24),1),60); v_page int := greatest(coalesce(p_page,1),1);
        v_out jsonb;
begin
  if not intel.ci_can_discover() then raise exception 'discovery is for approved agencies, brands and the Super Admin' using errcode = '42501'; end if;
  v_q := nullif(lower(btrim(regexp_replace(coalesce(p_filters->>'q',''), '^[@#]', ''))), '');
  v_loc := nullif(lower(btrim(coalesce(p_filters->>'location',''))), '');
  v_min := nullif(p_filters->>'min_followers','')::int; v_max := nullif(p_filters->>'max_followers','')::int;
  v_eng := nullif(p_filters->>'min_engagement','')::numeric;
  v_gender := nullif(lower(coalesce(p_filters->>'gender','')), '');
  v_src := coalesce(nullif(p_filters->>'source',''), 'all');
  v_sort := coalesce(nullif(p_filters->>'sort',''), 'followers_desc');
  select array_agg(lower(btrim(x))) into v_cats from jsonb_array_elements_text(case when jsonb_typeof(p_filters->'categories') = 'array' then p_filters->'categories' else '[]'::jsonb end) x where btrim(x) <> '';
  v_camp := intel.ci_resolve_campaign(p_campaign);

  with plat as (
    select 'platform'::text kind, sa.member_id, lower(sa.username) handle, coalesce(nullif(btrim(m.name),''), sa.name) name, sa.profile_picture_url pic,
           sa.followers_count::bigint followers, x.eng engagement, x.likes avg_likes, sa.media_count posts, left(sa.biography, 220) bio,
           (select coalesce(array_agg(distinct lower(c)), '{}') from unnest(coalesce(nullif(pp.categories,'{}'), intel.ci_guess_categories(x.blob))) c) categories,
           coalesce(pp.city_coarse, intel.ci_guess_city(sa.biography)) city, pp.state_coarse state, lower(per.gender) gender, x.blob, sa.connected_at found_at
      from public.social_accounts sa
      join public.members m on m.id = sa.member_id and m.role = 'creator'
      left join intel.ci_identity_actor_access acc on acc.member_id = sa.member_id and acc.access_role = 'self' and acc.revoked_at is null
      left join intel.ci_creator_professional_profile pp on pp.identity_id = acc.identity_id
      left join private.creator_personal_profile per on per.identity_id = acc.identity_id
      cross join lateral (
        select (select avg(coalesce((m2->>'like_count')::numeric,0)) from jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) m2) likes,
               case when coalesce(sa.followers_count,0) > 0 and jsonb_array_length(coalesce(sa.recent_media,'[]'::jsonb)) > 0 then
                 round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                                  from jsonb_array_elements(sa.recent_media) m2) / sa.followers_count, 2) end eng,
               lower(coalesce(sa.username,'') || ' ' || coalesce(sa.name,'') || ' ' || coalesce(sa.biography,'') || ' ' ||
                     coalesce((select string_agg(m4->>'caption', ' ') from jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) m4), '')) blob) x
     where v_src in ('all','platform') and sa.platform = 'instagram' and sa.username is not null),
  ext as (
    select 'external'::text, null::uuid, e.handle, e.display_name, e.profile_picture_url, e.followers::bigint, e.engagement, e.avg_likes, e.media_count, e.bio,
           (select coalesce(array_agg(distinct lower(c)), '{}') from unnest(e.categories) c), e.city, e.state, null::text,
           lower(e.handle || ' ' || coalesce(e.display_name,'') || ' ' || coalesce(e.bio,'') || ' ' || array_to_string(e.hashtags, ' ')), e.first_seen_at
      from intel.ci_external_creator e
     where v_src in ('all','external')
       and not exists (select 1 from public.social_accounts sa where sa.platform = 'instagram' and lower(sa.username) = e.handle)),
  u as (select * from plat union all select * from ext),
  f as (
    select * from u where
          (v_q is null or blob like '%'||v_q||'%' or exists (select 1 from unnest(categories) c where c like '%'||v_q||'%'))
      and (v_cats is null or categories && v_cats or exists (select 1 from unnest(v_cats) w where blob like '%'||w||'%'))
      and (v_loc is null or lower(coalesce(city,'') || ' ' || coalesce(state,'')) like '%'||v_loc||'%' or blob like '%'||v_loc||'%')
      and (v_min is null or followers >= v_min)
      and (v_max is null or followers <= v_max)
      and (v_eng is null or engagement >= v_eng)
      and (v_gender is null or gender = v_gender)),
  o as (
    select f.*, count(*) over () tot, row_number() over (order by
            case when v_sort = 'followers_asc' then f.followers end asc nulls last,
            case when v_sort = 'engagement_desc' then f.engagement end desc nulls last,
            case when v_sort = 'recent' then f.found_at end desc nulls last,
            f.followers desc nulls last, f.handle) ord
      from f)
  select jsonb_build_object('total', coalesce(max(o.tot), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'kind', o.kind, 'member_id', o.member_id, 'handle', o.handle, 'name', o.name, 'profile_picture_url', o.pic,
      'followers', o.followers, 'engagement', o.engagement, 'avg_likes', round(o.avg_likes), 'posts', o.posts, 'bio', o.bio,
      'categories', to_jsonb(o.categories), 'city', o.city, 'state', o.state,
      'state_in_campaign', case when v_camp is null then null
          when o.kind = 'platform' then (select p.stage from intel.ci_campaign_participation p
                  join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.access_role = 'self'
                 where p.campaign_id = v_camp and a.member_id = o.member_id limit 1)
          else (select 'invited' from intel.ci_campaign_invite i where i.campaign_id = v_camp and lower(i.handle) = o.handle limit 1) end)
      order by o.ord) filter (where o.ord > (v_page - 1) * v_size and o.ord <= v_page * v_size), '[]'::jsonb))
    into v_out from o;

  return v_out || jsonb_build_object('page', v_page, 'size', v_size,
    'pages', greatest(ceil((v_out->>'total')::numeric / v_size)::int, 1));
end $$;
revoke all on function api.creator_search(jsonb, int, int, uuid) from public, anon;
grant execute on function api.creator_search(jsonb, int, int, uuid) to authenticated;

-- ---------- pool + enrichment status ----------
create table if not exists intel.ci_discovery_status (
  id boolean primary key default true check (id),
  last_run_at timestamptz, last_enriched int, last_error text, needs_permission boolean not null default false
);
insert into intel.ci_discovery_status(id) values (true) on conflict (id) do nothing;
alter table intel.ci_discovery_status enable row level security;
revoke all on intel.ci_discovery_status from anon, authenticated;
grant select, insert, update on intel.ci_discovery_status to service_role;

create or replace function api.discovery_pool_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not intel.ci_can_discover() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pool', (select count(*) from intel.ci_external_creator),
    'with_stats', (select count(*) from intel.ci_external_creator where followers is not null),
    'on_platform', (select count(*) from public.social_accounts sa join public.members m on m.id = sa.member_id and m.role = 'creator' where sa.platform = 'instagram'),
    'waiting_stats', (select count(*) from intel.ci_external_creator where followers is null and enrich_attempts < 3),
    'last_run_at', (select last_run_at from intel.ci_discovery_status), 'last_enriched', (select last_enriched from intel.ci_discovery_status),
    'needs_permission', (select needs_permission from intel.ci_discovery_status), 'last_error', (select last_error from intel.ci_discovery_status));
end $$;
revoke all on function api.discovery_pool_status() from public, anon;
grant execute on function api.discovery_pool_status() to authenticated;

-- worker API (service role)
create or replace function api.ops_discovery_claim(p_limit int default 40)
returns jsonb language sql security definer set search_path = '' as $$
  with c as (
    select handle from intel.ci_external_creator
     where enrich_attempts < 3 and (followers is null or enriched_at < now() - interval '14 days')
     order by (followers is null) desc, mention_count desc, last_seen_at desc
     limit greatest(p_limit,1) for update skip locked)
  update intel.ci_external_creator e set enrich_attempts = e.enrich_attempts + 1
    from c where e.handle = c.handle
  returning to_jsonb(e.handle) $$;
create or replace function api.ops_discovery_token()
returns jsonb language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('access_token', t.access_token, 'ig_user_id', t.ig_user_id)
            from public.social_tokens t
           where t.platform = 'instagram' and t.ig_user_id is not null and (t.expires_at is null or t.expires_at > now())
           order by exists (select 1 from public.platform_admins pa where pa.user_id = t.member_id) desc, t.updated_at desc nulls last
           limit 1) $$;
create or replace function api.ops_discovery_save(p_items jsonb, p_failed jsonb, p_needs_permission boolean, p_error text)
returns int language plpgsql security definer set search_path = '' as $$
declare e jsonb; v_n int := 0; m text; h text;
begin
  for e in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    if intel.ci_upsert_external(e, null, 'enriched') then v_n := v_n + 1; end if;
    for m in select jsonb_array_elements_text(coalesce(e->'mentions','[]'::jsonb)) limit 30 loop
      perform intel.ci_upsert_external(jsonb_build_object('handle', m), null, 'snowball');
    end loop;
  end loop;
  for h in select jsonb_array_elements_text(coalesce(p_failed,'[]'::jsonb)) loop
    update intel.ci_external_creator set enrich_error = left(coalesce(p_error,'not a public Business/Creator account'),200) where handle = h;
  end loop;
  update intel.ci_discovery_status set last_run_at = now(), last_enriched = v_n, needs_permission = coalesce(p_needs_permission,false), last_error = p_error;
  if coalesce(p_needs_permission,false) then   -- give the handles back; nothing was really tried
    update intel.ci_external_creator set enrich_attempts = greatest(enrich_attempts - 1, 0)
     where handle in (select jsonb_array_elements_text(coalesce(p_failed,'[]'::jsonb)));
  end if;
  return v_n;
end $$;
revoke all on function api.ops_discovery_claim(int) from public, anon, authenticated;
revoke all on function api.ops_discovery_token() from public, anon, authenticated;
revoke all on function api.ops_discovery_save(jsonb, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function api.ops_discovery_claim(int), api.ops_discovery_token(), api.ops_discovery_save(jsonb, jsonb, boolean, text) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-discovery-enrich', '41 * * * *', $c$select private.ci_kick_worker('ig-discover-worker')$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- backfill city / categories for the pool we already have
update intel.ci_external_creator set city = coalesce(city, intel.ci_guess_city(coalesce(bio,''))),
  categories = (select coalesce(array_agg(distinct x), '{}') from unnest(categories || intel.ci_guess_categories(coalesce(bio,'') || ' ' || array_to_string(hashtags,' '))) x);
