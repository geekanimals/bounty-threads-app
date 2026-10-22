-- Discovery + Creator Intelligence are one page now. Creator search gets every profile filter:
--   state, language, content format, skill, accepts barter, pet parent, age range, WhatsApp verified,
--   active in the last N days, worked with brands, ready to travel, done campaigns before, max engagement,
--   sort by last active / campaigns done. Each Geek OS row also carries identity_id (opens the intelligence card)
--   and last_seen. Same signatures; the api.creator_search wrapper (profile %) stays as it is.
-- Plus api.creator_search_options() (values for the filter dropdowns) and api.creator_activity(member) — the
-- cookie / activity log of one creator for the Super Admin, shown on every creator details card.

create or replace function api.creator_search_base(p_filters jsonb default '{}'::jsonb, p_page int default 1, p_size int default 24, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text; v_loc text; v_min int; v_max int; v_eng numeric; v_gender text; v_src text; v_sort text; v_cats text[];
        v_camp uuid; v_size int := least(greatest(coalesce(p_size,24),1),60); v_page int := greatest(coalesce(p_page,1),1);
        v_out jsonb;
        v_state text; v_lang text; v_fmt text; v_skill text; v_barter boolean; v_pet boolean; v_amin int; v_amax int;
        v_wa boolean; v_active int; v_brands boolean; v_travel boolean; v_emax numeric; v_done boolean;
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
  -- profile filters (Geek OS creators only — an Instagram-only creator has none of this, so setting one hides them)
  v_state  := nullif(lower(btrim(coalesce(p_filters->>'state',''))), '');
  v_lang   := nullif(lower(btrim(coalesce(p_filters->>'language',''))), '');
  v_fmt    := nullif(lower(btrim(coalesce(p_filters->>'content_format',''))), '');
  v_skill  := nullif(lower(btrim(coalesce(p_filters->>'skill',''))), '');
  v_barter := case when p_filters->>'barter' in ('yes','true') then true end;
  v_pet    := case when p_filters->>'pet' in ('yes','true') then true end;
  v_wa     := case when p_filters->>'whatsapp' in ('yes','true') then true end;
  v_brands := case when p_filters->>'brands_worked' in ('yes','true') then true end;
  v_travel := case when p_filters->>'travel' in ('yes','true') then true end;
  v_done   := case when p_filters->>'campaigns_done' in ('yes','true') then true end;
  v_amin   := nullif(regexp_replace(coalesce(p_filters->>'min_age',''), '[^0-9]', '', 'g'), '')::int;
  v_amax   := nullif(regexp_replace(coalesce(p_filters->>'max_age',''), '[^0-9]', '', 'g'), '')::int;
  v_active := nullif(regexp_replace(coalesce(p_filters->>'active_days',''), '[^0-9]', '', 'g'), '')::int;
  v_emax   := nullif(p_filters->>'max_engagement','')::numeric;

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
           (select string_agg(m5->>'caption', ' · ') from jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) m5) caps,
           acc.identity_id,
           case when per.date_of_birth is not null then extract(year from age(per.date_of_birth))::int end age,
           cp.accepts_barter barter, per.has_pet pet,
           (select coalesce(array_agg(lower(l)), '{}') from unnest(pp.languages) l) langs,
           (select coalesce(array_agg(lower(l)), '{}') from unnest(pp.content_formats) l) fmts,
           (select coalesce(array_agg(lower(s.skill_key)), '{}') from intel.ci_creator_skill s where s.identity_id = acc.identity_id) skills,
           (con.whatsapp_verified_at is not null
              or exists (select 1 from public.wa_contacts w where w.user_id = sa.member_id and w.verified_at is not null)) wa_ok,
           (select max(al.created_at) from public.activity_log al where al.member_id = sa.member_id) last_seen,
           (select count(*)::int from intel.ci_creator_brand_experience b where b.identity_id = acc.identity_id and b.creator_rejected_at is null) worked,
           cp.travel_ready travel,
           (select count(*)::int from intel.ci_campaign_participation x where x.identity_id = acc.identity_id and x.stage in ('published','completed')) done
      from src sa
      left join nacc na on na.member_id = sa.member_id
      join public.members m on m.id = sa.member_id and m.role = 'creator'
      left join intel.ci_identity_actor_access acc on acc.member_id = sa.member_id and acc.access_role = 'self' and acc.revoked_at is null
      left join intel.ci_creator_professional_profile pp on pp.identity_id = acc.identity_id
      left join private.creator_personal_profile per on per.identity_id = acc.identity_id
      left join intel.ci_creator_commercial_preference cp on cp.identity_id = acc.identity_id
      left join private.creator_contact con on con.identity_id = acc.identity_id
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
           null::text, null::boolean, null::int, e.captions,
           null::uuid, null::int, null::boolean, null::boolean, null::text[], null::text[], null::text[], null::boolean,
           null::timestamptz, null::int, null::boolean, null::int
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
      and (v_gender is null or gender = v_gender)
      and (v_state is null or lower(coalesce(state,'') || ' ' || coalesce(city,'')) like '%'||v_state||'%')
      and (v_lang is null or exists (select 1 from unnest(langs) l where l like '%'||v_lang||'%'))
      and (v_fmt is null or exists (select 1 from unnest(fmts || skills) l where l like '%'||v_fmt||'%'))
      and (v_skill is null or exists (select 1 from unnest(skills) l where l like '%'||v_skill||'%'))
      and (v_barter is null or barter is true)
      and (v_pet is null or pet is true)
      and (v_amin is null or age >= v_amin)
      and (v_amax is null or age <= v_amax)
      and (v_wa is null or wa_ok is true)
      and (v_active is null or last_seen > now() - make_interval(days => v_active))
      and (v_brands is null or worked > 0)
      and (v_travel is null or travel is true)
      and (v_done is null or done > 0)
      and (v_emax is null or engagement <= v_emax)),
  o as (
    select f.*, count(*) over () tot, row_number() over (order by
            case when v_sort = 'followers_asc' then f.followers end asc nulls last,
            case when v_sort = 'engagement_desc' then f.engagement end desc nulls last,
            case when v_sort = 'recent' then f.found_at end desc nulls last,
            case when v_sort = 'active' then f.last_seen end desc nulls last,
            case when v_sort = 'campaigns' then f.done end desc nulls last,
            case when v_sort = 'engagement_asc' then f.engagement end asc nulls last,
            f.followers desc nulls last, f.handle) ord
      from f)
  select jsonb_build_object('total', coalesce(max(o.tot), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'kind', o.kind, 'member_id', o.member_id, 'handle', o.handle, 'name', o.name, 'profile_picture_url', o.pic,
      'followers', o.followers, 'engagement', o.engagement, 'avg_likes', round(o.avg_likes), 'posts', o.posts, 'bio', o.bio,
      'categories', to_jsonb(o.categories), 'city', o.city, 'state', o.state,
      'ig_user_id', o.igid, 'is_active_account', o.is_active, 'accounts', o.n_accts,
      'identity_id', o.identity_id, 'age', o.age, 'accepts_barter', o.barter, 'has_pet', o.pet, 'languages', to_jsonb(o.langs),
      'content_formats', to_jsonb(o.fmts), 'skills', to_jsonb(o.skills), 'wa_verified', o.wa_ok, 'last_seen', o.last_seen,
      'brands_worked', o.worked, 'travel_ready', o.travel, 'campaigns_done', o.done,
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

revoke all on function api.creator_search_base(jsonb, int, int, uuid) from public, anon, authenticated;

-- values for the filter dropdowns (only what creators actually have)
create or replace function api.creator_search_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not intel.ci_can_discover() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'languages', coalesce((select jsonb_agg(x order by x) from (select distinct initcap(btrim(l)) x from intel.ci_creator_professional_profile p, unnest(p.languages) l where btrim(l) <> '') s), '[]'::jsonb),
    'content_formats', coalesce((select jsonb_agg(x order by x) from (select distinct lower(btrim(l)) x from intel.ci_creator_professional_profile p, unnest(p.content_formats) l where btrim(l) <> '') s), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(x order by x) from (select distinct lower(btrim(s.skill_key)) x from intel.ci_creator_skill s where btrim(coalesce(s.skill_key,'')) <> '') s), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(x order by x) from (select distinct initcap(btrim(state_coarse)) x from intel.ci_creator_professional_profile where btrim(coalesce(state_coarse,'')) <> '') s), '[]'::jsonb));
end $$;
revoke all on function api.creator_search_options() from public, anon;
grant execute on function api.creator_search_options() to authenticated;

-- one creator's activity (sign-ins, pages, time spent, devices, places) — Super Admin only.
-- Pages and time exist only for people who accepted analytics cookies; security events are always there.
create or replace function api.creator_activity(p_member uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days,30),1),365));
begin
  if not public.is_platform_admin() then raise exception 'only the Super Admin sees activity' using errcode = '42501'; end if;
  if p_member is null then return null; end if;
  return jsonb_build_object(
    'days', least(greatest(coalesce(p_days,30),1),365),
    'consent', public.activity_consent_of(p_member),
    'joined_at', (select u.created_at from auth.users u where u.id = p_member),
    'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = p_member),
    'last_seen', (select max(a.created_at) from public.activity_log a where a.member_id = p_member),
    'sessions', (select count(distinct a.session_id) from public.activity_log a where a.member_id = p_member and a.created_at > v_from),
    'active_days', (select count(distinct (a.created_at at time zone 'Asia/Kolkata')::date) from public.activity_log a where a.member_id = p_member and a.created_at > v_from),
    'minutes', (select round(coalesce(sum(a.duration_ms), 0) / 60000.0, 1) from public.activity_log a where a.member_id = p_member and a.created_at > v_from and a.event = 'time'),
    'page_views', (select count(*) from public.activity_log a where a.member_id = p_member and a.created_at > v_from and a.event = 'page_view'),
    'last_place', (select jsonb_build_object('city', a.city, 'region', a.region, 'country', a.country, 'ip', a.ip, 'at', a.created_at)
                     from public.activity_log a where a.member_id = p_member and (a.city is not null or a.country is not null) order by a.created_at desc limit 1),
    'last_device', (select a.user_agent from public.activity_log a where a.member_id = p_member and a.user_agent is not null order by a.created_at desc limit 1),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('page', s.page, 'views', s.v, 'minutes', s.m) order by s.v desc, s.m desc)
                         from (select a.page, count(*) filter (where a.event = 'page_view') v,
                                      round(coalesce(sum(a.duration_ms) filter (where a.event = 'time'), 0) / 60000.0, 1) m
                                 from public.activity_log a where a.member_id = p_member and a.created_at > v_from and a.page is not null
                                group by a.page order by 2 desc, 3 desc limit 8) s), '[]'::jsonb),
    'places', coalesce((select jsonb_agg(jsonb_build_object('place', s.p, 'times', s.n) order by s.n desc)
                          from (select concat_ws(', ', a.city, a.region, a.country) p, count(*) n from public.activity_log a
                                 where a.member_id = p_member and a.created_at > v_from and (a.city is not null or a.country is not null)
                                 group by 1 order by 2 desc limit 5) s), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'kind', e.kind, 'event', e.event, 'page', e.page,
                          'seconds', case when e.duration_ms > 0 then round(e.duration_ms / 1000.0) end, 'detail', nullif(e.detail, '{}'::jsonb),
                          'place', nullif(concat_ws(', ', e.city, e.country), ''), 'ip', e.ip) order by e.created_at desc)
                         from (select * from public.activity_log a where a.member_id = p_member order by a.created_at desc limit 40) e), '[]'::jsonb));
end $$;
revoke all on function api.creator_activity(uuid, int) from public, anon;
grant execute on function api.creator_activity(uuid, int) to authenticated;

-- names + Instagram handle for creator identities (brief matches showed only an ID). Only creators the caller may view.
create or replace function api.creator_names(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((select jsonb_object_agg(i.id, jsonb_build_object('name', coalesce(nullif(btrim(m.name),''), sa.name), 'handle', sa.username,
                    'pic', sa.profile_picture_url, 'followers', sa.followers_count, 'member_id', a.member_id))
     from unnest(coalesce(p_ids, '{}')) i(id)
     join intel.ci_identity_actor_access a on a.identity_id = i.id and a.access_role = 'self' and a.revoked_at is null
     left join public.members m on m.id = a.member_id
     left join public.social_accounts sa on sa.member_id = a.member_id and sa.platform = 'instagram'
    where intel.ci_brand_can_view(i.id)), '{}'::jsonb);
end $$;
revoke all on function api.creator_names(uuid[]) from public, anon;
grant execute on function api.creator_names(uuid[]) to authenticated;
