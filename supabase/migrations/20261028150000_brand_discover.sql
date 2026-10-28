-- Brand Discovery: brand logins search every creator (Geek OS + Instagram pool) from their own sidebar (Social → Discovery),
-- describe who they need in plain words ("male creators in Jaipur with dogs, 10k–50k") and shortlist creators for a
-- campaign; the Geek team sees each shortlist in Brand CRM → Brand portal and invites them.
--
-- 1. api.creator_search_base learns two filters (patched in place, so every earlier change to it stays):
--      words       — [[synonyms…], [synonyms…]]: every group must match the creator's name / bio / captions / hashtags
--                    (any word of the group; words of 4 letters or less match whole words only, so "cat" ≠ "category"); a group with "pet" also matches a creator who says they have a pet
--      gender_soft — 'yes': creators found on Instagram (gender unknown) stay in the results when a gender is asked
-- 2. intel.ci_brand_pick + api.brand_discover_brief / brand_discover_pick / brand_discover_picks / brand_discover_unpick
-- 3. Super Admin: api.admin_brand_picks / admin_brand_pick_set

do $$
declare d text;
begin
  d := pg_get_functiondef('api.creator_search_base(jsonb,int,int,uuid)'::regprocedure);
  if position('v_words' in d) = 0 then
    if position('v_emax numeric; v_done boolean;' in d) = 0
       or position('v_emax   := nullif(p_filters->>''max_engagement'','''')::numeric;' in d) = 0
       or position('and (v_emax is null or engagement <= v_emax)),' in d) = 0
       or position('and (v_gender is null or gender = v_gender)' in d) = 0 then
      raise exception 'creator_search_base has changed — update 20261028150000_brand_discover.sql';
    end if;
    d := replace(d, 'v_emax numeric; v_done boolean;', 'v_emax numeric; v_done boolean; v_words jsonb; v_gsoft boolean;');
    d := replace(d, 'v_emax   := nullif(p_filters->>''max_engagement'','''')::numeric;',
      'v_emax   := nullif(p_filters->>''max_engagement'','''')::numeric;
  v_words  := case when jsonb_typeof(p_filters->''words'') = ''array'' and jsonb_array_length(p_filters->''words'') > 0 then p_filters->''words'' end;
  v_gsoft  := coalesce(p_filters->>''gender_soft'', '''') in (''yes'',''true'');');
    d := replace(d, 'and (v_gender is null or gender = v_gender)',
      'and (v_gender is null or gender = v_gender or (v_gsoft and gender is null and kind = ''external''))');
    d := replace(d, 'and (v_emax is null or engagement <= v_emax)),',
      'and (v_emax is null or engagement <= v_emax)
      and (v_words is null or not exists (
            select 1 from jsonb_array_elements(v_words) g
             where jsonb_typeof(g) = ''array'' and jsonb_array_length(g) > 0
               and not exists (select 1 from jsonb_array_elements_text(g) w
                                where (length(btrim(w)) > 4 and blob like ''%'' || lower(btrim(w)) || ''%'')
                                   or (length(btrim(w)) between 2 and 4 and blob ~ (''\m'' || regexp_replace(lower(btrim(w)), ''[^a-z0-9 ]'', '''', ''g'') || ''s?\M''))
                                   or (lower(btrim(w)) in (''pet'',''pets'') and pet is true))))),');
    execute d;
  end if;
end $$;

-- ------------------------------------------------------------------ shortlist ("I want this creator for that campaign")
create table if not exists intel.ci_brand_pick (
  pick_id     uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references intel.ci_brand(brand_id) on delete cascade,
  campaign_id uuid references intel.ci_campaign(campaign_id) on delete set null,
  member_id   uuid references auth.users(id) on delete cascade,      -- a creator on Geek OS
  handle      text not null,                                          -- their Instagram username
  snapshot    jsonb not null default '{}'::jsonb,                     -- what the brand saw (followers, city, picture…)
  note        text,
  status      text not null default 'new' check (status in ('new','invited','declined')),
  admin_note  text,
  added_by    uuid references auth.users(id) on delete set null,
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists ci_brand_pick_uq on intel.ci_brand_pick(brand_id, coalesce(campaign_id::text, '-'), handle);
create index if not exists ci_brand_pick_brand on intel.ci_brand_pick(brand_id, added_at desc);
alter table intel.ci_brand_pick enable row level security;
revoke all on intel.ci_brand_pick from public, anon, authenticated;

-- a brand campaign's details, to search creators for it
create or replace function api.brand_discover_brief(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c intel.ci_campaign%rowtype; v_ids uuid[]; br jsonb;
begin
  select * into c from intel.ci_campaign where campaign_id = intel.ci_resolve_campaign(p_campaign);
  if c.campaign_id is null then raise exception 'campaign not found' using errcode = 'P0002'; end if;
  v_ids := intel.ci_portal_brands(case when public.is_platform_admin() or intel.ci_is_agency_operator() then c.brand_id end);
  if c.brand_id is null or not (c.brand_id = any(v_ids)) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select requirements into br from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1;
  return jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'product', c.product, 'category', c.category,
    'cities', to_jsonb(c.cities), 'ideal', coalesce(br->'ideal_profile', '{}'::jsonb), 'creators_needed', br->'creators_needed', 'brief', br->>'brief');
end $$;
revoke all on function api.brand_discover_brief(uuid) from public, anon;
grant execute on function api.brand_discover_brief(uuid) to authenticated;

create or replace function api.brand_discover_pick(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[] := intel.ci_portal_brands(null); v_brand uuid; v_camp uuid; v_member uuid; v_ident uuid; v_handle text; v_bname text; v_cname text; v_id uuid;
begin
  if intel.ci_brand_role() is null then raise exception 'Shortlisting is for brand logins.' using errcode = '42501'; end if;
  if intel.ci_brand_role() in ('viewer','removed') then raise exception 'This login can only view — ask your team''s admin to shortlist.' using errcode = '42501'; end if;
  v_handle := nullif(lower(btrim(regexp_replace(coalesce(p->>'handle',''), '^@', ''))), '');
  if v_handle is null or v_handle !~ '^[a-z0-9._]{1,30}$' then raise exception 'Pick a creator with an Instagram username.' using errcode = '22023'; end if;
  v_camp := nullif(p->>'campaign_id','')::uuid;
  if v_camp is not null then
    select c.brand_id, c.name into v_brand, v_cname from intel.ci_campaign c where c.campaign_id = intel.ci_resolve_campaign(v_camp);
    v_camp := intel.ci_resolve_campaign(v_camp);
    if v_brand is null or not (v_brand = any(v_ids)) then raise exception 'not your campaign' using errcode = '42501'; end if;
  else
    v_brand := coalesce(nullif(p->>'brand_id','')::uuid, v_ids[1]);
    if v_brand is null or not (v_brand = any(v_ids)) then raise exception 'not your brand' using errcode = '42501'; end if;
  end if;
  -- a creator on Geek OS: only a real creator account
  v_member := nullif(p->>'member_id','')::uuid;
  if v_member is not null and not exists (select 1 from public.members m where m.id = v_member and m.role = 'creator') then v_member := null; end if;
  if v_member is not null then
    select a.identity_id into v_ident from intel.ci_identity_actor_access a where a.member_id = v_member and a.access_role = 'self' and a.revoked_at is null limit 1;
  end if;
  insert into intel.ci_brand_pick(brand_id, campaign_id, member_id, handle, snapshot, note, added_by)
  values (v_brand, v_camp, v_member, v_handle,
          coalesce((select jsonb_strip_nulls(jsonb_build_object('name', left(p->'snapshot'->>'name', 120), 'followers', nullif(p->'snapshot'->>'followers','')::numeric,
                     'engagement', nullif(p->'snapshot'->>'engagement','')::numeric, 'city', left(p->'snapshot'->>'city', 80),
                     'profile_picture_url', left(p->'snapshot'->>'profile_picture_url', 1000), 'on_geek', v_member is not null))), '{}'::jsonb),
          left(nullif(btrim(p->>'note'),''), 500), auth.uid())
  on conflict (brand_id, coalesce(campaign_id::text, '-'), handle) do update
     set note = coalesce(excluded.note, intel.ci_brand_pick.note), status = case when intel.ci_brand_pick.status = 'declined' then 'new' else intel.ci_brand_pick.status end,
         updated_at = now()
  returning pick_id into v_id;
  -- also in ⭐ Saved creators
  insert into intel.ci_brand_favorite(brand_id, identity_id, handle, added_by)
  values (v_brand, v_ident, case when v_ident is null then v_handle end, auth.uid()) on conflict do nothing;
  select name into v_bname from intel.ci_brand where brand_id = v_brand;
  insert into intel.ci_notification(recipient_member_id, kind, title, body, action_route, action_label, dedupe_key)
  select a.user_id, 'action_required', '⭐ ' || coalesce(v_bname, 'A brand') || ' shortlisted creators',
         '@' || v_handle || coalesce(' for ' || v_cname, '') || '. Open Brand CRM → ' || coalesce(v_bname, 'the brand') || ' → Brand portal to invite them.',
         'app.html?go=brands', 'Open Brand CRM', 'brandpick:' || v_brand || ':' || to_char(now(), 'YYYYMMDDHH24')
    from public.platform_admins a
   where not exists (select 1 from intel.ci_notification n where n.recipient_member_id = a.user_id and n.dedupe_key = 'brandpick:' || v_brand || ':' || to_char(now(), 'YYYYMMDDHH24'));
  return jsonb_build_object('pick_id', v_id);
end $$;
revoke all on function api.brand_discover_pick(jsonb) from public, anon;
grant execute on function api.brand_discover_pick(jsonb) to authenticated;

create or replace function intel.ci_pick_json(k intel.ci_brand_pick)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('pick_id', k.pick_id, 'campaign_id', k.campaign_id, 'campaign', (select c.name from intel.ci_campaign c where c.campaign_id = k.campaign_id),
    'legacy_campaign_id', (select c.legacy_campaign_id from intel.ci_campaign c where c.campaign_id = k.campaign_id),
    'member_id', k.member_id, 'handle', k.handle, 'snapshot', k.snapshot, 'note', k.note, 'status', k.status, 'admin_note', k.admin_note,
    'added_at', k.added_at, 'by', (select m.name from public.members m where m.id = k.added_by),
    'on_campaign', case when k.campaign_id is null then null
      when k.member_id is not null then (select p.stage from intel.ci_campaign_participation p
              join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.access_role = 'self'
             where p.campaign_id = k.campaign_id and a.member_id = k.member_id limit 1)
      else (select 'invited' from intel.ci_campaign_invite i where i.campaign_id = k.campaign_id and lower(i.handle) = k.handle limit 1) end) $$;
revoke all on function intel.ci_pick_json(intel.ci_brand_pick) from public, anon, authenticated;

create or replace function api.brand_discover_picks(p_brand uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ids uuid[] := intel.ci_portal_brands(p_brand);
begin
  return coalesce((select jsonb_agg(intel.ci_pick_json(k) order by k.added_at desc) from intel.ci_brand_pick k where k.brand_id = any(v_ids)), '[]'::jsonb);
end $$;
revoke all on function api.brand_discover_picks(uuid) from public, anon;
grant execute on function api.brand_discover_picks(uuid) to authenticated;

create or replace function api.brand_discover_unpick(p_pick uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(intel.ci_brand_role(), '') in ('viewer','removed') then raise exception 'This login can only view.' using errcode = '42501'; end if;
  delete from intel.ci_brand_pick k where k.pick_id = p_pick and k.status = 'new' and k.brand_id = any(intel.ci_portal_brands(null));
  return jsonb_build_object('removed', found);
end $$;
revoke all on function api.brand_discover_unpick(uuid) from public, anon;
grant execute on function api.brand_discover_unpick(uuid) to authenticated;

-- ------------------------------------------------------------------ Super Admin (Brand CRM → Brand portal)
create or replace function api.admin_brand_picks(p_brand uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(intel.ci_pick_json(k) order by k.added_at desc) from intel.ci_brand_pick k where k.brand_id = p_brand), '[]'::jsonb);
end $$;
revoke all on function api.admin_brand_picks(uuid) from public, anon;
grant execute on function api.admin_brand_picks(uuid) to authenticated;

create or replace function api.admin_brand_pick_set(p_pick uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k intel.ci_brand_pick%rowtype;
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  if p_status not in ('new','invited','declined') then raise exception 'bad status' using errcode = '22023'; end if;
  update intel.ci_brand_pick set status = p_status, admin_note = coalesce(nullif(btrim(p_note),''), admin_note), updated_at = now()
   where pick_id = p_pick returning * into k;
  if k.added_by is not null and p_status <> 'new' then
    insert into intel.ci_notification(recipient_member_id, kind, title, body, action_route, action_label, dedupe_key)
    values (k.added_by, 'info', case p_status when 'invited' then '✅ @' || k.handle || ' invited' else '@' || k.handle || ' — not this time' end,
            case p_status when 'invited' then 'The Geek team invited the creator you shortlisted' || coalesce(' to ' || (select c.name from intel.ci_campaign c where c.campaign_id = k.campaign_id), '') || '.'
                          else 'The Geek team can''t add this creator right now.' end || coalesce(' Note: ' || nullif(btrim(p_note),''), ''),
            'app.html?go=discover', 'Open', 'brandpickst:' || k.pick_id || ':' || p_status);
  end if;
  return jsonb_build_object('status', p_status);
end $$;
revoke all on function api.admin_brand_pick_set(uuid, text, text) from public, anon;
grant execute on function api.admin_brand_pick_set(uuid, text, text) to authenticated;
