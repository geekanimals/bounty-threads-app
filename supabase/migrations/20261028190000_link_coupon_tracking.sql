-- 🔗 Link & coupon tracking — free, no third party.
-- Every creator on a campaign gets their own short link (…/go/<slug>) and, if the campaign uses coupons, a code:
--   * one code for everyone (common), or a different code per creator (typed by the Super Admin, pasted as a list,
--     or made automatically from a prefix + the creator's handle)
-- The link opens a small page that shows the code (tap = copied) and sends the shopper to the brand's shop.
-- We count every open (click), unique visitor, code copy and "go to shop". Orders / sales come from the brand's
-- own report (CSV) or are typed in — matched to the creator by their code or handle. Nothing is missed:
-- every creator (Geek OS or uploaded sheet) gets a link, and a link moves with the creator when they sign up.
--
-- campaign setting:  public.campaigns.tracking  {enabled, dest_url, mode: none|common|per_creator, common_code, discount, prefix}
-- tables:            intel.ci_track_link · intel.ci_track_event · intel.ci_track_sale
-- public (anon):     public.track_open(slug, kind, visitor, device, referrer)    — the link page
-- api:               track_report · track_link_set · track_codes_bulk · track_sales_add · track_sale_delete · my_track_links

alter table public.campaigns add column if not exists tracking jsonb not null default '{}'::jsonb;

create table if not exists intel.ci_track_link (
  link_id          uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]{5,16}$'),
  campaign_id      uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  participation_id uuid unique references intel.ci_campaign_participation(participation_id) on delete cascade,
  invite_id        uuid unique references intel.ci_campaign_invite(invite_id) on delete cascade,
  handle           text,
  code             text check (code is null or code ~ '^[A-Z0-9_-]{2,30}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ci_track_link_camp on intel.ci_track_link(campaign_id);
alter table intel.ci_track_link enable row level security;
revoke all on intel.ci_track_link from public, anon, authenticated;

create table if not exists intel.ci_track_event (
  event_id  bigint generated always as identity primary key,
  link_id   uuid not null references intel.ci_track_link(link_id) on delete cascade,
  kind      text not null check (kind in ('click','copy','shop')),
  at        timestamptz not null default now(),
  visitor   text,
  device    text,
  referrer  text
);
create index if not exists ci_track_event_link on intel.ci_track_event(link_id, kind, at desc);
alter table intel.ci_track_event enable row level security;
revoke all on intel.ci_track_event from public, anon, authenticated;

create table if not exists intel.ci_track_sale (
  sale_id     uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  link_id     uuid references intel.ci_track_link(link_id) on delete set null,
  code        text,
  order_ref   text,
  orders      int not null default 1 check (orders > 0 and orders <= 100000),
  amount      numeric(14,2),
  ordered_on  date,
  source      text not null default 'manual' check (source in ('manual','csv')),
  note        text,
  entered_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists ci_track_sale_order on intel.ci_track_sale(campaign_id, lower(order_ref)) where order_ref is not null;
create index if not exists ci_track_sale_camp on intel.ci_track_sale(campaign_id);
alter table intel.ci_track_sale enable row level security;
revoke all on intel.ci_track_sale from public, anon, authenticated;

-- ------------------------------------------------------------------ helpers
create or replace function intel.ci_track_cfg(p_campaign uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(pc.tracking, '{}'::jsonb)
         || jsonb_build_object('product_link', pc.product_link, 'brand', coalesce(pc.brand, (select b.name from intel.ci_brand b where b.brand_id = c.brand_id)), 'campaign', c.name)
    from intel.ci_campaign c left join public.campaigns pc on pc.id = c.legacy_campaign_id
   where c.campaign_id = p_campaign $$;
revoke all on function intel.ci_track_cfg(uuid) from public, anon, authenticated;

create or replace function intel.ci_track_slug()
returns text language sql volatile set search_path = '' as $$
  select substr(md5(random()::text || clock_timestamp()::text), 1, 7) $$;
revoke all on function intel.ci_track_slug() from public, anon, authenticated;

-- the code a creator shares: their own, else the campaign's common one
create or replace function intel.ci_track_code(l intel.ci_track_link, cfg jsonb)
returns text language sql immutable set search_path = '' as $$
  select coalesce(l.code, case when cfg->>'mode' in ('common','per_creator') then nullif(upper(btrim(cfg->>'common_code')), '') end) $$;
revoke all on function intel.ci_track_code(intel.ci_track_link, jsonb) from public, anon, authenticated;

create or replace function intel.ci_track_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or intel.ci_is_agency_operator() $$;
revoke all on function intel.ci_track_admin() from public, anon;
grant execute on function intel.ci_track_admin() to authenticated;

-- who may see a campaign's tracking: the Geek team, or the brand's own login
create or replace function intel.ci_track_can_view(p_campaign uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select intel.ci_track_admin() or exists (select 1 from intel.ci_campaign c where c.campaign_id = p_campaign and c.brand_id = any(intel.ci_my_brand_ids())) $$;
revoke all on function intel.ci_track_can_view(uuid) from public, anon, authenticated;

-- every creator on the campaign gets a link (Geek OS creators and uploaded sheet creators); a sheet creator's link
-- moves to their Geek OS participation once they sign up, so the clicks stay with them. Auto codes from the prefix.
create or replace function intel.ci_track_ensure(p_campaign uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare cfg jsonb := intel.ci_track_cfg(p_campaign); v_prefix text; r record; v_code text; n int;
begin
  update intel.ci_track_link l set participation_id = i.participation_id, invite_id = null, updated_at = now()
    from intel.ci_campaign_invite i
   where l.invite_id = i.invite_id and i.campaign_id = p_campaign and i.participation_id is not null
     and not exists (select 1 from intel.ci_track_link x where x.participation_id = i.participation_id);
  insert into intel.ci_track_link(slug, campaign_id, participation_id, handle)
  select intel.ci_track_slug(), p.campaign_id, p.participation_id,
         nullif(lower(regexp_replace(coalesce(p.applied_profile, intel.ci_brand_card(p.identity_id, p.applied_profile)->>'username', ''), '^@', '')), '')
    from intel.ci_campaign_participation p
   where p.campaign_id = p_campaign and p.stage not in ('ineligible','brand_declined','rejected','dropped')
     and not exists (select 1 from intel.ci_track_link x where x.participation_id = p.participation_id)
  on conflict (slug) do nothing;
  insert into intel.ci_track_link(slug, campaign_id, invite_id, handle)
  select intel.ci_track_slug(), i.campaign_id, i.invite_id, lower(i.handle)
    from intel.ci_campaign_invite i
   where i.campaign_id = p_campaign and i.participation_id is null
     and coalesce(i.status, '') not in ('rejected','dropped','declined','brand_declined')
     and not exists (select 1 from intel.ci_track_link x where x.invite_id = i.invite_id)
  on conflict (slug) do nothing;
  -- a different code per creator, made from a prefix: OLIO + RIYASHARMA → OLIORIYASHARMA
  v_prefix := upper(regexp_replace(coalesce(cfg->>'prefix', ''), '[^A-Za-z0-9]', '', 'g'));
  if cfg->>'mode' = 'per_creator' and coalesce(cfg->>'auto_codes', '') = 'true' and v_prefix <> '' then
    for r in select l.link_id, l.handle from intel.ci_track_link l where l.campaign_id = p_campaign and l.code is null and coalesce(l.handle, '') <> '' loop
      v_code := left(v_prefix || upper(regexp_replace(r.handle, '[^A-Za-z0-9]', '', 'g')), 26);
      select count(*) into n from intel.ci_track_link x where x.campaign_id = p_campaign and x.code = v_code;
      if n > 0 then v_code := left(v_code, 24) || upper(substr(md5(r.link_id::text), 1, 2)); end if;
      if length(v_code) >= 2 then update intel.ci_track_link set code = v_code, updated_at = now() where link_id = r.link_id; end if;
    end loop;
  end if;
end $$;
revoke all on function intel.ci_track_ensure(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ the link page (anyone with the link)
create or replace function public.track_open(p_slug text, p_kind text default 'click', p_visitor text default null, p_device text default null, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l intel.ci_track_link%rowtype; cfg jsonb; v_vis text; v_ip text; v_dest text; v_kind text := coalesce(nullif(p_kind,''), 'click');
begin
  select * into l from intel.ci_track_link where slug = lower(btrim(coalesce(p_slug, '')));
  if l.link_id is null then return jsonb_build_object('ok', false); end if;
  cfg := intel.ci_track_cfg(l.campaign_id);
  v_dest := coalesce(nullif(btrim(cfg->>'dest_url'), ''), nullif(btrim(cfg->>'product_link'), ''));
  if v_kind not in ('click','copy','shop','peek') then v_kind := 'click'; end if;
  if v_kind <> 'peek' then
    begin v_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1); exception when others then v_ip := ''; end;
    v_vis := md5(coalesce(left(p_visitor, 64), '') || '|' || v_ip);
    -- the same person tapping again within 20 seconds is one action
    if not exists (select 1 from intel.ci_track_event e where e.link_id = l.link_id and e.kind = v_kind and e.visitor = v_vis and e.at > now() - interval '20 seconds') then
      insert into intel.ci_track_event(link_id, kind, visitor, device, referrer)
      values (l.link_id, v_kind, v_vis, left(nullif(p_device, ''), 20), left(nullif(p_ref, ''), 200));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'dest', v_dest, 'code', intel.ci_track_code(l, cfg), 'discount', nullif(btrim(cfg->>'discount'), ''),
    'brand', cfg->>'brand', 'creator', l.handle, 'tracking', coalesce(cfg->>'enabled', '') = 'true');
end $$;
revoke all on function public.track_open(text, text, text, text, text) from public;
grant execute on function public.track_open(text, text, text, text, text) to anon, authenticated;

-- ------------------------------------------------------------------ the report (Geek team + the brand)
create or replace function api.track_report(p_campaign uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); cfg jsonb;
begin
  if v_id is null then raise exception 'campaign not found' using errcode = 'P0002'; end if;
  if not intel.ci_track_can_view(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  perform intel.ci_track_ensure(v_id);
  cfg := intel.ci_track_cfg(v_id);
  return jsonb_build_object(
    'campaign_id', v_id, 'config', cfg, 'can_edit', intel.ci_track_admin(),
    'can_add_sales', intel.ci_track_admin() or coalesce(intel.ci_brand_role(), '') in ('owner','approver'),
    'links', coalesce((select jsonb_agg(x order by (x->>'clicks')::int desc, x->>'handle') from (
        select jsonb_build_object('link_id', l.link_id, 'slug', l.slug, 'handle', coalesce(l.handle, card->>'username'), 'name', coalesce(card->>'name', i.full_name),
                 'kind', case when l.participation_id is not null then 'geek' else 'sheet' end,
                 'stage', coalesce(p.stage, i.status, 'registered'), 'followers', coalesce((card->>'followers')::bigint, i.followers),
                 'picture', card->>'profile_picture_url', 'own_code', l.code, 'code', intel.ci_track_code(l, cfg),
                 'clicks', (select count(*) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'click'),
                 'unique', (select count(distinct e.visitor) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'click'),
                 'copies', (select count(*) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'copy'),
                 'shop', (select count(*) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'shop'),
                 'mobile', (select count(*) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'click' and e.device = 'mobile'),
                 'last_click', (select max(e.at) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'click'),
                 'orders', (select coalesce(sum(s.orders), 0) from intel.ci_track_sale s where s.link_id = l.link_id),
                 'sales', (select coalesce(sum(s.amount), 0) from intel.ci_track_sale s where s.link_id = l.link_id)) x
          from intel.ci_track_link l
          left join intel.ci_campaign_participation p on p.participation_id = l.participation_id
          left join intel.ci_campaign_invite i on i.invite_id = l.invite_id
          left join lateral (select case when p.participation_id is not null then intel.ci_brand_card(p.identity_id, p.applied_profile) end card) cc on true
         where l.campaign_id = v_id) q), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'clicks', n, 'copies', c) order by d) from (
        select (e.at at time zone 'Asia/Kolkata')::date d, count(*) filter (where e.kind = 'click') n, count(*) filter (where e.kind = 'copy') c
          from intel.ci_track_event e join intel.ci_track_link l on l.link_id = e.link_id where l.campaign_id = v_id group by 1) z), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(jsonb_build_object('sale_id', s.sale_id, 'code', s.code, 'order_ref', s.order_ref, 'orders', s.orders, 'amount', s.amount,
                 'ordered_on', s.ordered_on, 'source', s.source, 'note', s.note, 'created_at', s.created_at, 'handle', l.handle,
                 'by', (select m.name from public.members m where m.id = s.entered_by)) order by coalesce(s.ordered_on, s.created_at::date) desc, s.created_at desc)
              from intel.ci_track_sale s left join intel.ci_track_link l on l.link_id = s.link_id where s.campaign_id = v_id), '[]'::jsonb));
end $$;
revoke all on function api.track_report(uuid) from public, anon;
grant execute on function api.track_report(uuid) to authenticated;

-- one creator's code (Super Admin); null clears it
create or replace function api.track_link_set(p_link uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
begin
  if not intel.ci_track_admin() then raise exception 'Only the Geek team sets codes.' using errcode = '42501'; end if;
  if v_code is not null and v_code !~ '^[A-Z0-9_-]{2,30}$' then raise exception 'A code is 2–30 letters / numbers (no spaces).' using errcode = '22023'; end if;
  update intel.ci_track_link set code = v_code, updated_at = now() where link_id = p_link;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('code', v_code);
end $$;
revoke all on function api.track_link_set(uuid, text) from public, anon;
grant execute on function api.track_link_set(uuid, text) to authenticated;

-- many codes at once: [{handle, code}] → that creator; [{code}] → the next creator without a code (a pasted list)
create or replace function api.track_codes_bulk(p_campaign uuid, p_rows jsonb, p_overwrite boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); r jsonb; v_code text; v_h text; v_link uuid; n_set int := 0; n_skip int := 0; bad text[] := '{}';
begin
  if not intel.ci_track_admin() then raise exception 'Only the Geek team sets codes.' using errcode = '42501'; end if;
  if v_id is null then raise exception 'campaign not found' using errcode = 'P0002'; end if;
  perform intel.ci_track_ensure(v_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_code := nullif(upper(btrim(coalesce(r->>'code', ''))), '');
    v_h := nullif(lower(regexp_replace(btrim(coalesce(r->>'handle', '')), '^@', '')), '');
    if v_code is null or v_code !~ '^[A-Z0-9_-]{2,30}$' then n_skip := n_skip + 1; if v_code is not null then bad := bad || v_code; end if; continue; end if;
    v_link := null;
    if v_h is not null then
      select l.link_id into v_link from intel.ci_track_link l where l.campaign_id = v_id and l.handle = v_h and (p_overwrite or l.code is null) limit 1;
    else
      select l.link_id into v_link from intel.ci_track_link l
       where l.campaign_id = v_id and l.code is null and not exists (select 1 from intel.ci_track_link x where x.campaign_id = v_id and x.code = v_code)
       order by l.created_at, l.handle limit 1;
    end if;
    if v_link is null then n_skip := n_skip + 1; continue; end if;
    update intel.ci_track_link set code = v_code, updated_at = now() where link_id = v_link; n_set := n_set + 1;
  end loop;
  return jsonb_build_object('set', n_set, 'skipped', n_skip, 'bad', to_jsonb(bad));
end $$;
revoke all on function api.track_codes_bulk(uuid, jsonb, boolean) from public, anon;
grant execute on function api.track_codes_bulk(uuid, jsonb, boolean) to authenticated;

-- orders / sales from the brand's report (CSV) or typed in: [{code?, handle?, order_ref?, orders?, amount?, date?, note?}]
-- matched to the creator by handle, else by their code (a shared / common code stays "not split by creator")
create or replace function api.track_sales_add(p_campaign uuid, p_rows jsonb, p_source text default 'manual')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); cfg jsonb; r jsonb; v_code text; v_h text; v_link uuid; n_link int; v_ref text; v_amt numeric; v_n int; v_d date;
        added int := 0; dup int := 0; matched int := 0; unmatched int := 0;
begin
  if v_id is null then raise exception 'campaign not found' using errcode = 'P0002'; end if;
  if not (intel.ci_track_admin() or (intel.ci_track_can_view(v_id) and coalesce(intel.ci_brand_role(), '') in ('owner','approver'))) then
    raise exception 'You can''t add sales to this campaign.' using errcode = '42501'; end if;
  perform intel.ci_track_ensure(v_id);
  cfg := intel.ci_track_cfg(v_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_code := nullif(upper(btrim(coalesce(r->>'code', ''))), '');
    v_h := nullif(lower(regexp_replace(btrim(coalesce(r->>'handle', '')), '^@', '')), '');
    v_ref := nullif(left(btrim(coalesce(r->>'order_ref', '')), 80), '');
    v_amt := nullif(regexp_replace(coalesce(r->>'amount', ''), '[^0-9.]', '', 'g'), '')::numeric;
    v_n := greatest(coalesce(nullif(regexp_replace(coalesce(r->>'orders', ''), '[^0-9]', '', 'g'), '')::int, 1), 1);
    begin v_d := nullif(r->>'date', '')::date; exception when others then v_d := null; end;
    if v_code is null and v_h is null then unmatched := unmatched + 1; continue; end if;
    v_link := null;
    if v_h is not null then select l.link_id into v_link from intel.ci_track_link l where l.campaign_id = v_id and l.handle = v_h limit 1; end if;
    if v_link is null and v_code is not null then
      select count(*), min(l.link_id::text)::uuid into n_link, v_link from intel.ci_track_link l where l.campaign_id = v_id and l.code = v_code;
      if n_link <> 1 then v_link := null; end if;
    end if;
    insert into intel.ci_track_sale(campaign_id, link_id, code, order_ref, orders, amount, ordered_on, source, note, entered_by)
    values (v_id, v_link, v_code, v_ref, v_n, v_amt, v_d, case when p_source = 'csv' then 'csv' else 'manual' end, left(nullif(btrim(r->>'note'), ''), 300), auth.uid())
    on conflict (campaign_id, lower(order_ref)) where order_ref is not null do nothing;
    if found then added := added + 1; if v_link is not null then matched := matched + 1; end if; else dup := dup + 1; end if;
  end loop;
  return jsonb_build_object('added', added, 'matched', matched, 'not_split', added - matched, 'duplicates', dup, 'skipped', unmatched);
end $$;
revoke all on function api.track_sales_add(uuid, jsonb, text) from public, anon;
grant execute on function api.track_sales_add(uuid, jsonb, text) to authenticated;

create or replace function api.track_sale_delete(p_sale uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s intel.ci_track_sale%rowtype;
begin
  select * into s from intel.ci_track_sale where sale_id = p_sale;
  if s.sale_id is null then return jsonb_build_object('deleted', false); end if;
  if not (intel.ci_track_admin() or (s.entered_by = auth.uid() and intel.ci_track_can_view(s.campaign_id))) then
    raise exception 'You can only remove entries you added.' using errcode = '42501'; end if;
  delete from intel.ci_track_sale where sale_id = p_sale;
  return jsonb_build_object('deleted', true);
end $$;
revoke all on function api.track_sale_delete(uuid) from public, anon;
grant execute on function api.track_sale_delete(uuid) to authenticated;

-- ------------------------------------------------------------------ the creator's own links (My Campaigns → post instructions)
create or replace function api.my_track_links()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  -- make sure every campaign I'm on has my link
  for r in select distinct p.campaign_id from intel.ci_campaign_participation p
             join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.member_id = auth.uid() and a.access_role = 'self' and a.revoked_at is null
            where coalesce(intel.ci_track_cfg(p.campaign_id)->>'enabled', '') = 'true'
              and not exists (select 1 from intel.ci_track_link l where l.participation_id = p.participation_id) loop
    perform intel.ci_track_ensure(r.campaign_id);
  end loop;
  return coalesce((select jsonb_agg(jsonb_build_object('participation_id', p.participation_id, 'campaign_id', p.campaign_id, 'slug', l.slug,
            'code', intel.ci_track_code(l, cfg.c), 'discount', nullif(btrim(cfg.c->>'discount'), ''), 'dest', coalesce(nullif(btrim(cfg.c->>'dest_url'), ''), cfg.c->>'product_link'),
            'clicks', (select count(*) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'click'),
            'copies', (select count(*) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'copy'),
            'orders', (select coalesce(sum(s.orders), 0) from intel.ci_track_sale s where s.link_id = l.link_id)))
     from intel.ci_campaign_participation p
     join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.member_id = auth.uid() and a.access_role = 'self' and a.revoked_at is null
     join intel.ci_track_link l on l.participation_id = p.participation_id
     cross join lateral (select intel.ci_track_cfg(p.campaign_id) c) cfg
    where coalesce(cfg.c->>'enabled', '') = 'true'), '[]'::jsonb);
end $$;
revoke all on function api.my_track_links() from public, anon;
grant execute on function api.my_track_links() to authenticated;
