-- Several Instagram accounts per creator, everywhere:
--   1) Media Kit shows ONLY the account that is open — connecting / switching to another account clears the old
--      account's cached archive, stories and sync stamp (they were being carried over and mixed in)
--   2) Discovery / campaign invite search lists every connected account of a creator (each its own card, with
--      how many accounts that creator has); a click shows all of them
--   3) Super Admin: per creator, every Instagram account they added
-- ADDITIVE.

-- 1) a different account takes the active slot → keep the previous one AND drop what belonged to it
create or replace function public.tg_ig_keep_previous()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.platform = 'instagram' and old.ig_user_id is not null and new.ig_user_id is distinct from old.ig_user_id then
    begin perform private.ig_stash(old.member_id, old); exception when others then null; end;
    -- whatever the writer did not set for the NEW account still belongs to the old one → clear it
    if new.archive_media is not distinct from old.archive_media then new.archive_media := null; new.archive_synced_at := null; end if;
    if new.recent_stories is not distinct from old.recent_stories then new.recent_stories := '[]'::jsonb; end if;
    if new.mentions is not distinct from old.mentions then new.mentions := '[]'::jsonb; end if;
    if new.audience is not distinct from old.audience then new.audience := '{}'::jsonb; end if;
    if new.avg_reach is not distinct from old.avg_reach then new.avg_reach := null; end if;
    if new.recent_media is not distinct from old.recent_media then new.recent_media := '[]'::jsonb; end if;
    new.last_media_sync_at := null;          -- the next open re-syncs the new account
  end if;
  return new;
exception when others then return new;     -- never block a connect
end $$;

-- clean up kits that were already mixed: creators with more than one account re-scan their archive
update public.social_accounts sa set archive_media = null, archive_synced_at = null, last_media_sync_at = null
 where sa.platform = 'instagram' and sa.archive_media is not null
   and exists (select 1 from private.ig_linked_accounts l where l.member_id = sa.member_id and l.ig_user_id is distinct from sa.ig_user_id);
update private.ig_linked_accounts set account = account - 'archive_media' - 'archive_synced_at' where account ? 'archive_media';

-- 2) discovery: every connected account
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
           sa.ig_user_id igid, sa.is_active, coalesce(na.n, 1) n_accts
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
           lower(e.handle || ' ' || coalesce(e.display_name,'') || ' ' || coalesce(e.bio,'') || ' ' || array_to_string(e.hashtags, ' ')), e.first_seen_at,
           null::text, null::boolean, null::int
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

-- all Instagram accounts of one Geek OS creator (Discovery / campaign team / Super Admin)
create or replace function api.creator_ig_accounts(p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_platform_admin() or intel.ci_can_discover() or auth.uid() = p_member) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'active')::boolean desc, (x->>'followers')::bigint desc nulls last) from (
      select jsonb_build_object('ig_user_id', s.ig_user_id, 'username', s.username, 'name', s.name, 'profile_picture_url', s.profile_picture_url,
               'followers', s.followers_count, 'posts', s.media_count, 'active', true, 'connected_at', s.connected_at) x
        from public.social_accounts s where s.member_id = p_member and s.platform = 'instagram' and s.username is not null
      union all
      select jsonb_build_object('ig_user_id', l.ig_user_id, 'username', coalesce(l.username, l.account->>'username'), 'name', l.account->>'name',
               'profile_picture_url', l.account->>'profile_picture_url', 'followers', nullif(l.account->>'followers_count','')::bigint,
               'posts', nullif(l.account->>'media_count','')::int, 'active', false, 'connected_at', l.linked_at)
        from private.ig_linked_accounts l
       where l.member_id = p_member
         and not exists (select 1 from public.social_accounts s2 where s2.member_id = l.member_id and s2.platform = 'instagram'
                          and s2.ig_user_id is not distinct from l.ig_user_id)) q), '[]'::jsonb);
end $$;
revoke all on function api.creator_ig_accounts(uuid) from public, anon;
grant execute on function api.creator_ig_accounts(uuid) to authenticated;

-- 3) Super Admin: every creator's Instagram accounts in one call  { member_id: [ {username, followers, active, …} ] }
create or replace function public.admin_ig_accounts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(member_id, accts) from (
      select member_id, jsonb_agg(x order by (x->>'active')::boolean desc, (x->>'followers')::bigint desc nulls last) accts from (
        select s.member_id, jsonb_build_object('ig_user_id', s.ig_user_id, 'username', s.username, 'name', s.name,
                 'profile_picture_url', s.profile_picture_url, 'followers', s.followers_count, 'posts', s.media_count, 'active', true,
                 'connected_at', s.connected_at) x
          from public.social_accounts s where s.platform = 'instagram' and s.username is not null and s.member_id is not null
        union all
        select l.member_id, jsonb_build_object('ig_user_id', l.ig_user_id, 'username', coalesce(l.username, l.account->>'username'),
                 'name', l.account->>'name', 'profile_picture_url', l.account->>'profile_picture_url',
                 'followers', nullif(l.account->>'followers_count','')::bigint, 'posts', nullif(l.account->>'media_count','')::int,
                 'active', false, 'connected_at', l.linked_at)
          from private.ig_linked_accounts l
         where not exists (select 1 from public.social_accounts s2 where s2.member_id = l.member_id and s2.platform = 'instagram'
                            and s2.ig_user_id is not distinct from l.ig_user_id)) q
      group by member_id) g), '{}'::jsonb);
end $$;
revoke all on function public.admin_ig_accounts() from public, anon;
grant execute on function public.admin_ig_accounts() to authenticated;
