-- Discovery finds creators by what they POST, not only by name / bio:
--   • every Instagram profile we fetch keeps the captions of its latest posts (ci_external_creator.captions)
--   • the search box matches those captions (Geek OS creators already matched their posts) and each result says
--     which post matched ("matched_post")
-- ADDITIVE: one nullable column + two functions redefined (same signatures).
alter table intel.ci_external_creator add column if not exists captions text;

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
      sample_permalink, categories, hashtags, city, state, avg_likes, avg_comments, engagement, sources, found_by_org, enriched_at, last_seen_at, captions)
  values ('instagram', v_h, nullif(btrim(e->>'name'),''), left(nullif(e->>'bio',''), 300), v_f,
      nullif(regexp_replace(coalesce(e->>'media_count',''), '[^0-9]', '', 'g'), '')::int, nullif(e->>'profile_picture_url',''),
      nullif(e->>'permalink',''), v_cats,
      coalesce((select array_agg(distinct lower(t[1])) from regexp_matches(v_txt, '#([A-Za-z0-9_]{2,30})', 'g') t), '{}'),
      coalesce(nullif(btrim(e->>'city'),''), intel.ci_guess_city(v_txt)), nullif(btrim(e->>'state'),''),
      nullif(e->>'avg_likes','')::numeric, nullif(e->>'avg_comments','')::numeric, v_eng,
      array[coalesce(nullif(p_source,''),'manual')], p_org, case when v_f is not null then now() end, now(),
      case when v_f is not null then left(nullif(btrim(e->>'caption'),''), 3000) end)
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
      captions = coalesce(excluded.captions, intel.ci_external_creator.captions),
      last_seen_at = now();
  return true;
end $$;
revoke all on function intel.ci_upsert_external(jsonb, uuid, text) from public, anon, authenticated;

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

  with src as (
    -- every Instagram account a creator has connected: the active one + the others kept in the vault
    select s.member_id, s.ig_user_id, s.username, s.name, s.profile_picture_url, s.followers_count::bigint followers_count, s.media_count::int media_count,
           s.biography, coalesce(s.recent_media,'[]'::jsonb) recent_media, s.connected_at, true is_active
      from public.social_accounts s where s.platform = 'instagram' and s.username is not null
    union all
    select l.member_id, l.ig_user_id, coalesce(l.username, l.account->>'username'), l.account->>'name', l.account->>'profile_picture_url',
           nullif(l.account->>'followers_count','')::bigint, nullif(l.account->>'media_count','')::int, l.account->>'biography',
           case when jsonb_typeof(l.account->'recent_media') = 'array' then l.account->'recent_media' else '[]'::jsonb end,
           coalesce(nullif(l.account->>'connected_at','')::timestamptz, l.linked_at), false
      from private.ig_linked_accounts l
     where coalesce(l.username, l.account->>'username') is not null
       and not exists (select 1 from public.social_accounts s2 where s2.member_id = l.member_id and s2.platform = 'instagram'
                        and s2.ig_user_id is not distinct from l.ig_user_id)),
  nacc as (select member_id, count(*)::int n from src group by member_id),
  plat as (
    select 'platform'::text kind, sa.member_id, lower(sa.username) handle, coalesce(nullif(btrim(m.name),''), sa.name) name, sa.profile_picture_url pic,
           sa.followers_count::bigint followers, x.eng engagement, x.likes avg_likes, sa.media_count posts, left(sa.biography, 220) bio,
           (select coalesce(array_agg(distinct lower(c)), '{}') from unnest(coalesce(nullif(pp.categories,'{}'), intel.ci_guess_categories(x.blob))) c) categories,
           coalesce(pp.city_coarse, intel.ci_guess_city(sa.biography)) city, pp.state_coarse state, lower(per.gender) gender, x.blob, sa.connected_at found_at,
           sa.ig_user_id igid, sa.is_active, coalesce(na.n, 1) n_accts,
           (select string_agg(m5->>'caption', ' · ') from jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) m5) caps
      from src sa
      left join nacc na on na.member_id = sa.member_id
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
     where v_src in ('all','platform')
       -- blocked creators are unlisted until the team unblocks them
       and not exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = acc.identity_id and b.lifted_at is null)),
  ext as (
    select 'external'::text, null::uuid, e.handle, e.display_name, e.profile_picture_url, e.followers::bigint, e.engagement, e.avg_likes, e.media_count, e.bio,
           (select coalesce(array_agg(distinct lower(c)), '{}') from unnest(e.categories) c), e.city, e.state, null::text,
           lower(e.handle || ' ' || coalesce(e.display_name,'') || ' ' || coalesce(e.bio,'') || ' ' || array_to_string(e.hashtags, ' ') || ' ' || coalesce(e.captions,'')), e.first_seen_at,
           null::text, null::boolean, null::int, e.captions
      from intel.ci_external_creator e
     where v_src in ('all','external')
       and not exists (select 1 from public.social_accounts sa where sa.platform = 'instagram' and lower(sa.username) = e.handle)
       and not exists (select 1 from private.ig_linked_accounts l where lower(coalesce(l.username, l.account->>'username')) = e.handle)),
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
      'ig_user_id', o.igid, 'is_active_account', o.is_active, 'accounts', o.n_accts,
      'matched_post', case when v_q is not null and strpos(lower(coalesce(o.caps,'')), v_q) > 0
          then btrim(substr(o.caps, greatest(strpos(lower(o.caps), v_q) - 50, 1), 150)) end,
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
