-- 🔗 Link tracking — every way a brand gives links:
--   * one shop link for the whole campaign (as before), OR the brand's own link for EACH creator (a different product,
--     a brand-made affiliate link…) — set per creator, typed or pasted as "@handle, https://…" — the creator still
--     shares only their Geek link (…/go/<slug>), so every click is counted, whichever link it finally opens
--   * UTM tags added to the brand's link (utm_source=geek, utm_medium=influencer, utm_campaign, utm_content=@handle),
--     so the brand sees the same visits in its own Google Analytics / Shopify reports (on unless switched off)
--   * Shopify: the creator's code is applied automatically at checkout (…/discount/CODE?redirect=…)
--   * a new link for a creator (🔄) when a link was shared in the wrong place; the old one stops working
alter table intel.ci_track_link add column if not exists dest_url text check (dest_url is null or dest_url ~* '^https?://[^\s]+$');

-- the link page gets the creator's own link (else the campaign's) + how to finish it
create or replace function public.track_open(p_slug text, p_kind text default 'click', p_visitor text default null, p_device text default null, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l intel.ci_track_link%rowtype; cfg jsonb; v_vis text; v_ip text; v_dest text; v_kind text := coalesce(nullif(p_kind,''), 'click');
begin
  select * into l from intel.ci_track_link where slug = lower(btrim(coalesce(p_slug, '')));
  if l.link_id is null then return jsonb_build_object('ok', false); end if;
  cfg := intel.ci_track_cfg(l.campaign_id);
  v_dest := coalesce(nullif(btrim(l.dest_url), ''), nullif(btrim(cfg->>'dest_url'), ''), nullif(btrim(cfg->>'product_link'), ''));
  if v_kind not in ('click','copy','shop','peek') then v_kind := 'click'; end if;
  if v_kind <> 'peek' then
    begin v_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1); exception when others then v_ip := ''; end;
    v_vis := md5(coalesce(left(p_visitor, 64), '') || '|' || v_ip);
    if not exists (select 1 from intel.ci_track_event e where e.link_id = l.link_id and e.kind = v_kind and e.visitor = v_vis and e.at > now() - interval '20 seconds') then
      insert into intel.ci_track_event(link_id, kind, visitor, device, referrer)
      values (l.link_id, v_kind, v_vis, left(nullif(p_device, ''), 20), left(nullif(p_ref, ''), 200));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'dest', v_dest, 'code', intel.ci_track_code(l, cfg), 'discount', nullif(btrim(cfg->>'discount'), ''),
    'brand', cfg->>'brand', 'creator', l.handle, 'tracking', coalesce(cfg->>'enabled', '') = 'true',
    'utm', coalesce(cfg->>'utm', 'true') <> 'false', 'utm_campaign', lower(regexp_replace(coalesce(cfg->>'campaign', 'campaign'), '[^A-Za-z0-9]+', '-', 'g')),
    'shopify_code', coalesce(cfg->>'shopify_code', '') = 'true');
end $$;
revoke all on function public.track_open(text, text, text, text, text) from public;
grant execute on function public.track_open(text, text, text, text, text) to anon, authenticated;

-- the report shows each creator's own link
do $$
declare d text;
begin
  d := pg_get_functiondef('api.track_report(uuid)'::regprocedure);
  if position('''dest_url'', l.dest_url' in d) = 0 then
    if position('''slug'', l.slug,' in d) = 0 then raise exception 'track_report has changed — update 20261028220000_track_links_more.sql'; end if;
    d := replace(d, '''slug'', l.slug,', '''slug'', l.slug, ''dest_url'', l.dest_url,');
    execute d;
  end if;
end $$;

-- one creator's own brand link (Super Admin); null = use the campaign's link
create or replace function api.track_link_set_dest(p_link uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not intel.ci_track_admin() then raise exception 'Only the Geek team sets links.' using errcode = '42501'; end if;
  if v_url is not null and v_url !~* '^https?://[^\s]+$' then raise exception 'The link must start with https://' using errcode = '22023'; end if;
  update intel.ci_track_link set dest_url = v_url, updated_at = now() where link_id = p_link;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('dest_url', v_url);
end $$;
revoke all on function api.track_link_set_dest(uuid, text) from public, anon;
grant execute on function api.track_link_set_dest(uuid, text) to authenticated;

-- many at once: [{handle, code?, url?}] — each row's code and / or brand link goes to that creator
create or replace function api.track_links_bulk(p_campaign uuid, p_rows jsonb, p_overwrite boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); r jsonb; v_h text; v_code text; v_url text; v_link uuid; n_code int := 0; n_url int := 0; n_skip int := 0;
begin
  if not intel.ci_track_admin() then raise exception 'Only the Geek team sets links.' using errcode = '42501'; end if;
  if v_id is null then raise exception 'campaign not found' using errcode = 'P0002'; end if;
  perform intel.ci_track_ensure(v_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_h := nullif(lower(regexp_replace(btrim(coalesce(r->>'handle', '')), '^@', '')), '');
    v_code := nullif(upper(btrim(coalesce(r->>'code', ''))), '');
    v_url := nullif(btrim(coalesce(r->>'url', '')), '');
    select l.link_id into v_link from intel.ci_track_link l where l.campaign_id = v_id and l.handle = v_h limit 1;
    if v_link is null then n_skip := n_skip + 1; continue; end if;
    if v_code is not null and v_code ~ '^[A-Z0-9_-]{2,30}$' then
      update intel.ci_track_link set code = v_code, updated_at = now() where link_id = v_link and (p_overwrite or code is null);
      if found then n_code := n_code + 1; end if;
    end if;
    if v_url is not null and v_url ~* '^https?://[^\s]+$' then
      update intel.ci_track_link set dest_url = v_url, updated_at = now() where link_id = v_link and (p_overwrite or dest_url is null);
      if found then n_url := n_url + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('codes', n_code, 'links', n_url, 'skipped', n_skip);
end $$;
revoke all on function api.track_links_bulk(uuid, jsonb, boolean) from public, anon;
grant execute on function api.track_links_bulk(uuid, jsonb, boolean) to authenticated;

-- a fresh link for one creator; the old one stops working (its clicks stay with the creator)
create or replace function api.track_link_regen(p_link uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_slug text; n int := 0;
begin
  if not intel.ci_track_admin() then raise exception 'Only the Geek team makes new links.' using errcode = '42501'; end if;
  loop
    v_slug := intel.ci_track_slug(); n := n + 1;
    exit when not exists (select 1 from intel.ci_track_link where slug = v_slug) or n > 5;
  end loop;
  update intel.ci_track_link set slug = v_slug, updated_at = now() where link_id = p_link;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('slug', v_slug);
end $$;
revoke all on function api.track_link_regen(uuid) from public, anon;
grant execute on function api.track_link_regen(uuid) to authenticated;
