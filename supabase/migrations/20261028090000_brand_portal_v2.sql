-- 🏢 Brand portal v2. ADDITIVE.
-- * team logins: a brand login can be owner / approver / viewer (viewers can't approve anything); owners add up to
--   5 logins in all from Settings (the brand-login function makes the account)
-- * ⭐ saved creators: the brand shortlists creators to use again
-- * creator profile card: followers, engagement, average reach / views, audience (city / age / gender from Instagram
--   insights), recent posts, past work — never phone / email / address / fees
-- * request a new campaign: the brand sends a brief, the Super Admin gets it (bell + Brand CRM)
-- * alerts: in the app always; by email when Brand CRM → Brand portal → Email alerts is on (default on)
--   "N creators waiting for your approval" / "N videos ready for review" (at most one email an hour each) /
--   "campaign report ready" (campaign completed)
-- * top posts with thumbnails for the campaign report

-- ------------------------------------------------------------------ tables
alter table intel.ci_brand add column if not exists notify_email boolean not null default true;

create table if not exists intel.ci_brand_member_role (
  member_id  uuid primary key references auth.users(id) on delete cascade,
  brand_id   uuid not null references intel.ci_brand(brand_id) on delete cascade,
  role       text not null default 'approver' check (role in ('owner','approver','viewer','removed')),
  added_by   uuid references auth.users(id) on delete set null,
  added_at   timestamptz not null default now()
);
alter table intel.ci_brand_member_role enable row level security;
revoke all on intel.ci_brand_member_role from public, anon, authenticated;

create table if not exists intel.ci_brand_favorite (
  favorite_id uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references intel.ci_brand(brand_id) on delete cascade,
  identity_id uuid references intel.ci_creator_identity(identity_id) on delete cascade,
  handle      text,
  note        text,
  added_by    uuid references auth.users(id) on delete set null,
  added_at    timestamptz not null default now(),
  check (identity_id is not null or handle is not null)
);
create unique index if not exists ci_brand_favorite_uq on intel.ci_brand_favorite(brand_id, coalesce(identity_id::text, 'h:' || handle));
alter table intel.ci_brand_favorite enable row level security;
revoke all on intel.ci_brand_favorite from public, anon, authenticated;

create table if not exists intel.ci_brand_campaign_request (
  request_id      uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references intel.ci_brand(brand_id) on delete cascade,
  requested_by    uuid references auth.users(id) on delete set null,
  name            text not null,
  product         text,
  campaign_type   text check (campaign_type in ('barter','paid','barter_paid')),
  creators_needed int,
  cities          text,
  starts_on       date,
  ends_on         date,
  budget          text,
  deliverables    text,
  brief           text,
  status          text not null default 'new' check (status in ('new','in_review','converted','declined')),
  admin_note      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table intel.ci_brand_campaign_request enable row level security;
revoke all on intel.ci_brand_campaign_request from public, anon, authenticated;

-- ------------------------------------------------------------------ who is this brand login
-- 'owner' | 'approver' | 'viewer' for a brand login (no row = the first login the Super Admin made = owner); null otherwise
create or replace function intel.ci_brand_role(p_member uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select case when m.id is null then null else coalesce(r.role, 'owner') end
    from public.members m
    left join intel.ci_brand_member_role r on r.member_id = m.id
   where m.id = coalesce(p_member, auth.uid()) and m.role = 'brand' and coalesce(m.status, 'active') = 'active'
     and exists (select 1 from intel.ci_brand b where b.org_id = m.org_id) $$;
revoke all on function intel.ci_brand_role(uuid) from public, anon;
grant execute on function intel.ci_brand_role(uuid) to authenticated;

-- removed teammates lose access everywhere brand access is checked
create or replace function intel.ci_my_brand_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(b.brand_id), '{}') from intel.ci_brand b
   where b.org_id is not null and b.org_id = (select m.org_id from public.members m where m.id = auth.uid() and coalesce(m.status,'active') = 'active')
     and coalesce(intel.ci_brand_role(), 'owner') <> 'removed' $$;

-- the three approval actions: a view-only brand login can't use them
do $$
declare f text; d text; v_guard text := E'\n  if intel.ci_brand_role() in (''viewer'',''removed'') then raise exception ''This login can only view — ask your team''''s admin to approve.'' using errcode = ''42501''; end if;';
begin
  foreach f in array array['api.org_decide_applicant(uuid,boolean,text,text)', 'api.bp_review_video(uuid,boolean,text)', 'api.brand_decide_participation(uuid,boolean,text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('ci_brand_role()' in d) = 0 then
      d := regexp_replace(d, '(\$function\$.*?\mbegin\M)', '\1' || v_guard);
      execute d;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ dashboard (adds role, alerts, saved count, requests)
create or replace function api.brand_portal(p_brand uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ids uuid[] := intel.ci_portal_brands(p_brand);
begin
  return jsonb_build_object(
    'brands', coalesce((select jsonb_agg(jsonb_build_object('brand_id', b.brand_id, 'name', b.name, 'notify_email', b.notify_email) order by b.name) from intel.ci_brand b where b.brand_id = any(v_ids)), '[]'::jsonb),
    'me', (select jsonb_build_object('name', m.name, 'email', m.email) from public.members m where m.id = auth.uid()),
    'role', case when p_brand is not null and (public.is_platform_admin() or intel.ci_is_agency_operator()) then 'owner' else coalesce(intel.ci_brand_role(), 'owner') end,
    'saved', (select count(*) from intel.ci_brand_favorite f where f.brand_id = any(v_ids)),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('request_id', r.request_id, 'name', r.name, 'status', r.status, 'created_at', r.created_at, 'admin_note', r.admin_note) order by r.created_at desc)
                  from intel.ci_brand_campaign_request r where r.brand_id = any(v_ids)), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (
        select jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'brand', (select b.name from intel.ci_brand b where b.brand_id = c.brand_id),
                 'status', c.lifecycle_status, 'product', c.product, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'created_at', c.created_at,
                 'campaign_type', coalesce(br.requirements->>'campaign_type', case c.comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' else 'barter' end),
                 'creators_needed', br.requirements->'creators_needed',
                 'counts', (select jsonb_object_agg(k, n) from (select k, count(*) n from (
                              select intel.ci_brand_stage(p.stage)->>'key' k from intel.ci_campaign_participation p where p.campaign_id = c.campaign_id
                              union all select x->'status'->>'key' from jsonb_array_elements(intel.ci_brand_sheet_rows(c.campaign_id)) x) q group by 1) s),
                 'posts', (select count(*) from intel.ci_campaign_participation p, jsonb_array_elements(intel.ci_participation_posts(p.participation_id)) e
                            where p.campaign_id = c.campaign_id and p.stage in ('content_approved','published','completed'))
                         + (select coalesce(sum(jsonb_array_length(x->'posts')),0) from jsonb_array_elements(intel.ci_brand_sheet_rows(c.campaign_id)) x)) x
          from intel.ci_campaign c
          left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
         where c.brand_id = any(v_ids) and coalesce(c.lifecycle_status, '') not in ('archived','deleted')) q), '[]'::jsonb),
    'to_approve', coalesce((select jsonb_agg(jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
                   'stage', p.stage, 'applied_at', p.created_at, 'creator', intel.ci_brand_card(p.identity_id, p.applied_profile)) order by p.created_at)
              from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
             where c.brand_id = any(v_ids) and p.stage in ('applied','eligible','sent_to_brand')), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
                   'creator', intel.ci_brand_card(p.identity_id, p.applied_profile), 'video_url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at)
                   order by s.submitted_at)
              from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
              cross join lateral (select s.* from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                                   where d.participation_id = p.participation_id and s.status = 'submitted' order by s.submitted_at desc limit 1) s
             where c.brand_id = any(v_ids) and p.stage = 'content_submitted'), '[]'::jsonb),
    'facebook', (select t.meta - 'fb_user_id' from public.social_tokens t where t.member_id = auth.uid() and t.platform = 'facebook_brand'));
end $$;

-- ------------------------------------------------------------------ creator profile card
-- p_participation (a creator in the app) or p_invite (a creator on a campaign sheet); must be on one of the brand's campaigns
create or replace function api.brand_creator_card(p_participation uuid default null, p_invite uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_camp uuid; v_brand uuid; v_ident uuid; v_prof text; v_handle text; v_mid uuid; v_acc uuid; card jsonb; sa record; v_ids uuid[];
begin
  if p_participation is not null then
    select p.campaign_id, p.identity_id, p.applied_profile into v_camp, v_ident, v_prof from intel.ci_campaign_participation p where p.participation_id = p_participation;
  elsif p_invite is not null then
    select i.campaign_id, i.handle into v_camp, v_handle from intel.ci_campaign_invite i where i.invite_id = p_invite;
  end if;
  select c.brand_id into v_brand from intel.ci_campaign c where c.campaign_id = v_camp;
  if v_brand is null then raise exception 'creator not found' using errcode = 'P0002'; end if;
  v_ids := intel.ci_portal_brands(case when public.is_platform_admin() or intel.ci_is_agency_operator() then v_brand end);
  if not (v_brand = any(v_ids)) then raise exception 'not your campaign' using errcode = '42501'; end if;

  if v_ident is not null then
    card := intel.ci_brand_card(v_ident, v_prof);
    v_mid := intel.ci_member_of_identity(v_ident);
    v_handle := lower(card->>'username');
    select ipa.platform_account_id into v_acc from intel.ci_identity_platform_account ipa where ipa.identity_id = v_ident and ipa.valid_to is null order by ipa.valid_from limit 1;
  else
    select jsonb_strip_nulls(jsonb_build_object('name', coalesce(i.full_name, ex.display_name), 'username', i.handle, 'followers', coalesce(ex.followers, i.followers),
             'city', i.city, 'profile_picture_url', ex.profile_picture_url)) into card
      from intel.ci_campaign_invite i left join intel.ci_external_creator ex on ex.platform = 'instagram' and ex.handle = i.handle where i.invite_id = p_invite;
  end if;
  select s.followers_count, s.media_count, s.avg_reach, s.biography, s.recent_media into sa
    from public.social_accounts s where s.platform = 'instagram' and ((v_mid is not null and s.member_id = v_mid) or (v_handle is not null and lower(s.username) = v_handle))
   order by (s.member_id = v_mid) desc nulls last limit 1;

  return jsonb_build_object(
    'creator', card || jsonb_strip_nulls(jsonb_build_object('followers', coalesce((card->>'followers')::bigint, sa.followers_count), 'posts', sa.media_count,
                 'avg_reach', coalesce((card->>'avg_reach')::bigint, sa.avg_reach), 'bio', left(sa.biography, 300))),
    'brand_id', v_brand,
    'saved', exists (select 1 from intel.ci_brand_favorite f where f.brand_id = v_brand and ((v_ident is not null and f.identity_id = v_ident) or (v_ident is null and f.handle = v_handle))),
    -- averages from their recent Instagram posts
    'recent', coalesce((select jsonb_agg(jsonb_build_object('img', coalesce(e->>'thumbnail_url', e->>'media_url'), 'permalink', e->>'permalink',
                   'type', e->>'media_type', 'likes', (e->>'like_count')::int, 'comments', (e->>'comments_count')::int, 'at', e->>'timestamp'))
                 from (select e from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e limit 9) q), '[]'::jsonb),
    'avg_likes', (select round(avg((e->>'like_count')::numeric)) from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e),
    'avg_comments', (select round(avg((e->>'comments_count')::numeric)) from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e),
    'avg_views', (select round(avg(nullif(coalesce(e->>'video_views', e->>'plays', e->>'views'), '')::numeric)) from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e),
    -- who follows them (Instagram insights, latest numbers; only when Meta shares them)
    'audience', case when v_acc is null then null else (
        select jsonb_object_agg(bt, top) from (
          select a.breakdown_type bt, jsonb_agg(jsonb_build_object('key', a.dimension_key, 'pct', a.pct) order by a.pct desc) filter (where a.rn <= 5) top
            from (select x.breakdown_type, x.dimension_key,
                         round(100.0 * x.value_count / nullif(sum(x.value_count) over (partition by x.breakdown_type), 0), 1) pct,
                         row_number() over (partition by x.breakdown_type order by x.value_count desc) rn
                    from (select distinct on (o.breakdown_type, o.dimension_key) o.breakdown_type, o.dimension_key, o.value_count
                            from intel.ci_audience_observations o
                           where o.platform_account_id = v_acc and o.audience_type = 'follower' and o.status = 'available' and o.value_count is not null
                             and o.breakdown_type in ('age','gender','city','country')
                           order by o.breakdown_type, o.dimension_key, o.captured_at desc) x) a
           group by a.breakdown_type) z) end,
    -- past work: how many Geek campaigns they finished, and what they did for this brand
    'campaigns_done', case when v_ident is null then null else (select count(distinct p.campaign_id) from intel.ci_campaign_participation p where p.identity_id = v_ident and p.stage in ('published','completed')) end,
    'for_brand', coalesce((select jsonb_agg(jsonb_build_object('campaign', c.name, 'status', intel.ci_brand_stage(p.stage)->>'label', 'posts', intel.ci_participation_posts(p.participation_id)) order by p.created_at desc)
                  from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
                 where v_ident is not null and p.identity_id = v_ident and c.brand_id = v_brand), '[]'::jsonb));
end $$;
revoke all on function api.brand_creator_card(uuid, uuid) from public, anon;
grant execute on function api.brand_creator_card(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ ⭐ saved creators
create or replace function api.brand_favorite_set(p_participation uuid default null, p_invite uuid default null, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_brand uuid; v_ident uuid; v_handle text; v_ids uuid[];
begin
  if p_participation is not null then
    select p.campaign_id, p.identity_id, lower(intel.ci_brand_card(p.identity_id, p.applied_profile)->>'username') into v_camp, v_ident, v_handle
      from intel.ci_campaign_participation p where p.participation_id = p_participation;
  elsif p_invite is not null then
    select i.campaign_id, i.handle into v_camp, v_handle from intel.ci_campaign_invite i where i.invite_id = p_invite;
  end if;
  select c.brand_id into v_brand from intel.ci_campaign c where c.campaign_id = v_camp;
  if v_brand is null then raise exception 'creator not found' using errcode = 'P0002'; end if;
  v_ids := intel.ci_portal_brands(case when public.is_platform_admin() or intel.ci_is_agency_operator() then v_brand end);
  if not (v_brand = any(v_ids)) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p_on then
    insert into intel.ci_brand_favorite(brand_id, identity_id, handle, added_by) values (v_brand, v_ident, v_handle, auth.uid()) on conflict do nothing;
  else
    delete from intel.ci_brand_favorite f where f.brand_id = v_brand and ((v_ident is not null and f.identity_id = v_ident) or (v_ident is null and f.handle = v_handle));
  end if;
  return jsonb_build_object('saved', p_on);
end $$;
revoke all on function api.brand_favorite_set(uuid, uuid, boolean) from public, anon;
grant execute on function api.brand_favorite_set(uuid, uuid, boolean) to authenticated;

create or replace function api.brand_favorites(p_brand uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ids uuid[] := intel.ci_portal_brands(p_brand);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('favorite_id', f.favorite_id, 'added_at', f.added_at,
             'creator', coalesce(case when f.identity_id is not null then intel.ci_brand_card(f.identity_id, null) end,
                                 (select jsonb_strip_nulls(jsonb_build_object('username', ex.handle, 'name', ex.display_name, 'followers', ex.followers,
                                           'city', ex.city, 'profile_picture_url', ex.profile_picture_url)) from intel.ci_external_creator ex where ex.platform = 'instagram' and ex.handle = f.handle),
                                 jsonb_build_object('username', f.handle)),
             -- open the profile card through their latest campaign with this brand
             'participation_id', (select p.participation_id from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
                                   where f.identity_id is not null and p.identity_id = f.identity_id and c.brand_id = f.brand_id order by p.created_at desc limit 1),
             'invite_id', (select i.invite_id from intel.ci_campaign_invite i join intel.ci_campaign c on c.campaign_id = i.campaign_id
                            where f.identity_id is null and i.handle = f.handle and c.brand_id = f.brand_id order by i.created_at desc limit 1),
             'campaigns', (select string_agg(distinct c.name, ', ') from intel.ci_campaign c where c.brand_id = f.brand_id and (
                             exists (select 1 from intel.ci_campaign_participation p where p.campaign_id = c.campaign_id and f.identity_id is not null and p.identity_id = f.identity_id)
                             or exists (select 1 from intel.ci_campaign_invite i where i.campaign_id = c.campaign_id and f.identity_id is null and i.handle = f.handle))))
           order by f.added_at desc)
     from intel.ci_brand_favorite f where f.brand_id = any(v_ids)), '[]'::jsonb);
end $$;
revoke all on function api.brand_favorites(uuid) from public, anon;
grant execute on function api.brand_favorites(uuid) to authenticated;

-- ------------------------------------------------------------------ request a new campaign
create or replace function api.brand_campaign_request(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[] := intel.ci_portal_brands(null); v_brand uuid; v_id uuid; v_bname text; v_name text := nullif(btrim(coalesce(p->>'name','')), '');
begin
  if coalesce(intel.ci_brand_role(), '') in ('viewer','removed') then raise exception 'This login can only view — ask your team''s admin to send the request.' using errcode = '42501'; end if;
  v_brand := coalesce(nullif(p->>'brand_id','')::uuid, v_ids[1]);
  if v_brand is null or not (v_brand = any(v_ids)) then raise exception 'not your brand' using errcode = '42501'; end if;
  if v_name is null then raise exception 'Give the campaign a name.' using errcode = '22023'; end if;
  insert into intel.ci_brand_campaign_request(brand_id, requested_by, name, product, campaign_type, creators_needed, cities, starts_on, ends_on, budget, deliverables, brief)
  values (v_brand, auth.uid(), left(v_name, 160), left(nullif(btrim(p->>'product'),''), 200),
          case when p->>'campaign_type' in ('barter','paid','barter_paid') then p->>'campaign_type' end,
          nullif(regexp_replace(coalesce(p->>'creators_needed',''), '[^0-9]', '', 'g'), '')::int, left(nullif(btrim(p->>'cities'),''), 300),
          nullif(p->>'starts_on','')::date, nullif(p->>'ends_on','')::date, left(nullif(btrim(p->>'budget'),''), 120),
          left(nullif(btrim(p->>'deliverables'),''), 400), left(nullif(btrim(p->>'brief'),''), 6000))
  returning request_id into v_id;
  select name into v_bname from intel.ci_brand where brand_id = v_brand;
  -- every Super Admin hears about it
  insert into intel.ci_notification(recipient_member_id, kind, title, body, action_route, action_label, dedupe_key)
  select a.user_id, 'action_required', '📝 New campaign request: ' || coalesce(v_bname, 'a brand'),
         v_name || coalesce(' — ' || nullif(btrim(p->>'product'),''), '') || '. Open Brand CRM → ' || coalesce(v_bname, 'the brand') || ' → Brand portal.',
         'app.html?go=brands', 'Open Brand CRM', 'brandreq:' || v_id
    from public.platform_admins a;
  return jsonb_build_object('request_id', v_id);
end $$;
revoke all on function api.brand_campaign_request(jsonb) from public, anon;
grant execute on function api.brand_campaign_request(jsonb) to authenticated;

-- ------------------------------------------------------------------ Super Admin: the brand portal tab in Brand CRM
create or replace function api.admin_brand_portal(p_brand uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'notify_email', (select b.notify_email from intel.ci_brand b where b.brand_id = p_brand),
    'logins', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'email', m.email, 'role', coalesce(r.role, 'owner'),
                 'facebook', (select t.meta->>'fb_name' from public.social_tokens t where t.member_id = m.id and t.platform = 'facebook_brand'),
                 'last_sign_in', (select u.last_sign_in_at from auth.users u where u.id = m.id)) order by m.created_at)
               from public.members m join intel.ci_brand b on b.org_id = m.org_id left join intel.ci_brand_member_role r on r.member_id = m.id
              where b.brand_id = p_brand and m.role = 'brand'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('by', (select m.name from public.members m where m.id = r.requested_by)) order by r.created_at desc)
               from intel.ci_brand_campaign_request r where r.brand_id = p_brand), '[]'::jsonb),
    'saved', api.brand_favorites(p_brand));
end $$;
revoke all on function api.admin_brand_portal(uuid) from public, anon;
grant execute on function api.admin_brand_portal(uuid) to authenticated;

create or replace function api.admin_brand_notify(p_brand uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  update intel.ci_brand set notify_email = coalesce(p_on, true), updated_at = now() where brand_id = p_brand;
  return jsonb_build_object('notify_email', p_on);
end $$;
revoke all on function api.admin_brand_notify(uuid, boolean) from public, anon;
grant execute on function api.admin_brand_notify(uuid, boolean) to authenticated;

create or replace function api.admin_campaign_request_set(p_request uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r intel.ci_brand_campaign_request%rowtype;
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  if p_status not in ('new','in_review','converted','declined') then raise exception 'bad status' using errcode = '22023'; end if;
  update intel.ci_brand_campaign_request set status = p_status, admin_note = coalesce(nullif(btrim(p_note),''), admin_note), updated_at = now()
   where request_id = p_request returning * into r;
  if r.requested_by is not null then
    insert into intel.ci_notification(recipient_member_id, kind, title, body, action_route, action_label, dedupe_key)
    values (r.requested_by, 'info', 'Your campaign request: ' || r.name,
            case p_status when 'in_review' then 'The Geek team is working on it.' when 'converted' then 'It is set up — you can see it under Campaigns.'
                          when 'declined' then 'The Geek team can''t take it on right now.' else 'Status updated.' end || coalesce(' Note: ' || nullif(btrim(p_note),''), ''),
            'app.html?go=campaigns', 'Open', 'brandreqst:' || r.request_id || ':' || p_status);
  end if;
  return jsonb_build_object('status', p_status);
end $$;
revoke all on function api.admin_campaign_request_set(uuid, text, text) from public, anon;
grant execute on function api.admin_campaign_request_set(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------ team logins (the brand-login function calls these)
create or replace function api.brand_team()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := intel.ci_brand_role();
begin
  if v_role is null then raise exception 'This page is for brand logins.' using errcode = '42501'; end if;
  return jsonb_build_object('me', auth.uid(), 'my_role', v_role, 'max', 5,
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'email', m.email, 'role', coalesce(r.role, 'owner'),
                 'last_sign_in', (select u.last_sign_in_at from auth.users u where u.id = m.id)) order by m.created_at)
               from public.members m left join intel.ci_brand_member_role r on r.member_id = m.id
              where m.org_id = (select x.org_id from public.members x where x.id = auth.uid()) and m.role = 'brand' and coalesce(r.role, 'owner') <> 'removed'), '[]'::jsonb));
end $$;
revoke all on function api.brand_team() from public, anon;
grant execute on function api.brand_team() to authenticated;

-- service role: may p_by (a brand owner) add one more teammate? → brand + org + an invite token
create or replace function api.ops_brand_team_prepare(p_by uuid, p_email text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_brand uuid; v_n int;
begin
  if coalesce(intel.ci_brand_role(p_by), '') <> 'owner' then raise exception 'Only your team''s admin (owner) can add logins.' using errcode = '42501'; end if;
  select m.org_id into v_org from public.members m where m.id = p_by;
  select b.brand_id into v_brand from intel.ci_brand b where b.org_id = v_org limit 1;
  select count(*) into v_n from public.members m left join intel.ci_brand_member_role r on r.member_id = m.id
   where m.org_id = v_org and m.role = 'brand' and coalesce(r.role, 'owner') <> 'removed';
  if v_n >= 5 then raise exception 'Your team already has 5 logins — remove one first.' using errcode = '22023'; end if;
  return api.ops_brand_login_prepare(v_brand, p_email, p_name, p_by) || jsonb_build_object('brand_id', v_brand);
end $$;
revoke all on function api.ops_brand_team_prepare(uuid, text, text) from public, anon, authenticated;
grant execute on function api.ops_brand_team_prepare(uuid, text, text) to service_role;

create or replace function api.ops_brand_role_set(p_by uuid, p_member uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_brand uuid; v_by_admin boolean := exists (select 1 from public.platform_admins a where a.user_id = p_by);
begin
  if p_role not in ('owner','approver','viewer','removed') then raise exception 'bad role' using errcode = '22023'; end if;
  select b.brand_id into v_brand from public.members m join intel.ci_brand b on b.org_id = m.org_id where m.id = p_member and m.role = 'brand' limit 1;
  if v_brand is null then raise exception 'That login isn''t a brand login.' using errcode = '22023'; end if;
  if not v_by_admin then
    if coalesce(intel.ci_brand_role(p_by), '') <> 'owner' then raise exception 'Only your team''s admin (owner) can change logins.' using errcode = '42501'; end if;
    if (select org_id from public.members where id = p_by) is distinct from (select org_id from public.members where id = p_member) then raise exception 'not your team' using errcode = '42501'; end if;
    if p_member = p_by and p_role <> 'owner' then raise exception 'You can''t change your own access.' using errcode = '22023'; end if;
  end if;
  insert into intel.ci_brand_member_role(member_id, brand_id, role, added_by) values (p_member, v_brand, p_role, p_by)
  on conflict (member_id) do update set role = excluded.role;
  return jsonb_build_object('member_id', p_member, 'role', p_role);
end $$;
revoke all on function api.ops_brand_role_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function api.ops_brand_role_set(uuid, uuid, text) to service_role;

-- ------------------------------------------------------------------ top posts (with thumbnails) for the report
create or replace function intel.ci_post_thumb(p_permalink text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(e->>'thumbnail_url', e->>'media_url')
    from public.social_accounts s, jsonb_array_elements(case when jsonb_typeof(s.recent_media) = 'array' then s.recent_media else '[]'::jsonb end) e
   where s.platform = 'instagram' and p_permalink is not null and intel.ci_norm_permalink(e->>'permalink') = intel.ci_norm_permalink(p_permalink)
   limit 1 $$;
revoke all on function intel.ci_post_thumb(text) from public, anon, authenticated;

create or replace function api.brand_top_posts(p_campaign uuid, p_limit int default 5)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a jsonb;
begin
  perform api.brand_campaign(p_campaign);                 -- same access check as the campaign page
  a := api.campaign_analytics(p_campaign);
  return coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('permalink', e->>'permalink', 'type', e->>'media_type', 'thumb', intel.ci_post_thumb(e->>'permalink'),
               'creator', jsonb_strip_nulls(jsonb_build_object('username', r->'creator'->>'username', 'name', r->'creator'->>'name',
                            'followers', r->'creator'->'followers', 'profile_picture_url', r->'creator'->>'profile_picture_url')),
               'views', (e->'stats'->>'views')::bigint, 'reach', (e->'stats'->>'reach')::bigint, 'likes', (e->'stats'->>'likes')::bigint,
               'comments', (e->'stats'->>'comments')::bigint, 'shares', (e->'stats'->>'shares')::bigint, 'saves', (e->'stats'->>'saves')::bigint,
               'er', case when coalesce((e->'stats'->>'views')::numeric, 0) > 0 and (e->'stats'->>'likes') is not null then round(100 * (coalesce((e->'stats'->>'likes')::numeric,0) + coalesce((e->'stats'->>'comments')::numeric,0)
                            + coalesce((e->'stats'->>'shares')::numeric,0) + coalesce((e->'stats'->>'saves')::numeric,0)) / (e->'stats'->>'views')::numeric, 2) end) x
        from jsonb_array_elements(a->'creators') r, jsonb_array_elements(r->'posts') e
       where e->>'permalink' is not null
       order by coalesce((e->'stats'->>'views')::bigint, 0) desc, coalesce((e->'stats'->>'likes')::bigint, 0) desc
       limit greatest(1, least(coalesce(p_limit, 5), 20))) q), '[]'::jsonb);
end $$;
revoke all on function api.brand_top_posts(uuid, int) from public, anon;
grant execute on function api.brand_top_posts(uuid, int) to authenticated;

-- ------------------------------------------------------------------ alerts for the brand team
-- in the app always; by email when the brand's Email alerts are on (one email an hour per kind per person)
create or replace function intel.ci_brand_alert(p_campaign uuid, p_kind text, p_participation uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c intel.ci_campaign%rowtype; b intel.ci_brand%rowtype; m record; v_n int; v_title text; v_body text; v_route text; v_hour text := to_char(now(), 'YYYYMMDDHH24');
begin
  select * into c from intel.ci_campaign where campaign_id = p_campaign;
  if c.brand_id is null then return; end if;
  select * into b from intel.ci_brand where brand_id = c.brand_id;
  if b.org_id is null then return; end if;
  if p_kind = 'to_approve' then
    select count(*) into v_n from intel.ci_campaign_participation where campaign_id = p_campaign and stage in ('applied','eligible','sent_to_brand');
    v_title := v_n || ' creator' || case when v_n = 1 then '' else 's' end || ' waiting for your approval';
    v_body := 'Campaign: ' || c.name || '. Open Approvals to approve or decline.'; v_route := 'app.html?go=approvals';
  elsif p_kind = 'video' then
    select count(*) into v_n from intel.ci_campaign_participation where campaign_id = p_campaign and stage = 'content_submitted';
    v_title := v_n || ' new video' || case when v_n = 1 then '' else 's' end || ' ready for review';
    v_body := 'Campaign: ' || c.name || '. Watch and approve, or ask for changes.'; v_route := 'app.html?go=approvals';
  elsif p_kind = 'report' then
    v_title := 'Campaign report ready: ' || c.name;
    v_body := 'The campaign is complete. See the results and download the report (Excel / PDF) under Reports.'; v_route := 'app.html?go=reports';
  else return; end if;
  if p_kind <> 'report' and coalesce(v_n, 0) = 0 then return; end if;
  for m in select x.id, x.email, x.name from public.members x left join intel.ci_brand_member_role r on r.member_id = x.id
            where x.org_id = b.org_id and x.role = 'brand' and coalesce(x.status, 'active') = 'active' and coalesce(r.role, 'owner') <> 'removed' loop
    insert into intel.ci_notification(recipient_member_id, campaign_id, participation_id, kind, title, body, action_route, action_label, dedupe_key)
    select m.id, p_campaign, p_participation, case when p_kind = 'report' then 'info' else 'action_required' end, v_title, v_body, v_route, 'Open',
           'brand:' || p_kind || ':' || coalesce(p_participation::text, p_campaign::text)
     where not exists (select 1 from intel.ci_notification n where n.recipient_member_id = m.id
                         and n.dedupe_key = 'brand:' || p_kind || ':' || coalesce(p_participation::text, p_campaign::text));
    if b.notify_email and m.email is not null and m.email !~* '@creators\.bountythreads\.app$' then
      insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
      values ('email', m.id, m.email, p_campaign, 'brand_alert_' || p_kind,
              jsonb_build_object('subject', v_title || ' — ' || c.name, 'html', 'Hi ' || coalesce(nullif(split_part(m.name, ' ', 1), ''), 'there') || ',' || E'\n\n' || v_title || '.' || E'\n' || v_body,
                                 'to_name', m.name, 'action_route', '/app.html?door=brand&go=' || split_part(v_route, 'go=', 2), 'action_label', 'Open Geek OS'),
              'brand:' || m.id || ':' || p_kind || ':' || p_campaign || ':' || case when p_kind = 'report' then 'once' else v_hour end)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;
exception when others then
  raise warning 'brand alert skipped: %', sqlerrm;      -- an alert must never block the campaign step
end $$;
revoke all on function intel.ci_brand_alert(uuid, text, uuid) from public, anon, authenticated;

create or replace function intel.tg_brand_alert_participation() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage is distinct from coalesce(old.stage, '') then
    if new.stage in ('applied','sent_to_brand') then perform intel.ci_brand_alert(new.campaign_id, 'to_approve', new.participation_id);
    elsif new.stage = 'content_submitted' then perform intel.ci_brand_alert(new.campaign_id, 'video', new.participation_id); end if;
  end if;
  return null;
end $$;
drop trigger if exists brand_alert_participation on intel.ci_campaign_participation;
create trigger brand_alert_participation after insert or update of stage on intel.ci_campaign_participation
  for each row execute function intel.tg_brand_alert_participation();

create or replace function intel.tg_brand_alert_campaign() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lifecycle_status = 'completed' and old.lifecycle_status is distinct from 'completed' then perform intel.ci_brand_alert(new.campaign_id, 'report', null); end if;
  return null;
end $$;
drop trigger if exists brand_alert_campaign on intel.ci_campaign;
create trigger brand_alert_campaign after update of lifecycle_status on intel.ci_campaign
  for each row execute function intel.tg_brand_alert_campaign();

revoke all on function intel.tg_brand_alert_participation(), intel.tg_brand_alert_campaign(), intel.ci_brand_role(uuid) from public, anon;
grant execute on function intel.ci_brand_role(uuid) to authenticated;
