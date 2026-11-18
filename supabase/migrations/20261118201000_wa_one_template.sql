-- 📋 "One template for everyone" (campaign → WhatsApp to selected), like the old site — but only the NEW Snapto
-- Utility templates (made on / after 16 Nov 2026), sent through the Snapto API with each creator's own name,
-- the campaign name, their own button link and the campaign's WhatsApp photo for photo templates.
--  * private.wa_utility_templates — synced from Snapto by ops-notify-dispatch (every 15 min)
--  * api.wa_utility_templates(campaign) — the list for the panel: which ones can go to everyone, which need
--    per-creator details (due date, courier, address…) and only go with "Each creator's own step"
--  * api.wa_send_template(campaign, invites, parts, template) — queues one message per creator (kind 'tpl')
-- Also: the WhatsApp photo of a campaign is used only when "Send the WhatsApp invite with a photo" is ticked.

alter table public.campaigns add column if not exists wa_invite_photo_on boolean not null default false;

create or replace function private.campaign_wa_image(p_campaign uuid) returns text
language sql stable security definer set search_path = '' as $f$
  select u from (
    select nullif(btrim(c.wa_invite_image), '') u
    from intel.ci_campaign ic join public.campaigns c on c.id = coalesce(ic.legacy_campaign_id, ic.campaign_id)
    where ic.campaign_id = private.campaign_intel_id(p_campaign) and c.wa_invite_photo_on
  ) x
  where u ~* '^https://[^[:space:]]+[.](jpe?g|png)([?][^[:space:]]*)?$'
  limit 1
$f$;
revoke all on function private.campaign_wa_image(uuid) from public, anon, authenticated;

create table if not exists private.wa_utility_templates (
  name text primary key,
  lang text not null default 'en',
  header text,               -- IMAGE / TEXT / null
  body text not null,
  url text,                  -- URL button (may end in {{1}})
  url_button text,
  quick text[] not null default '{}',
  made_at timestamptz,
  active boolean not null default true,
  synced_at timestamptz not null default now()
);
revoke all on private.wa_utility_templates from public, anon, authenticated;

alter table private.snapto_drip_queue drop constraint if exists snapto_drip_queue_kind_check;
alter table private.snapto_drip_queue add constraint snapto_drip_queue_kind_check check (kind in ('start', 'done', 'tpl'));

-- what each {{n}} of a body is: name · campaign · due · courier · tracking · address · ig · null (unknown)
create or replace function private.wa_tpl_roles(p_body text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare v_out text[] := '{}'; v_max int; n int; i int; v_before text; v_after text;
begin
  select max((m[1])::int) into v_max from regexp_matches(coalesce(p_body, ''), '\{\{(\d+)\}\}', 'g') m;
  if v_max is null then return v_out; end if;
  for n in 1..v_max loop
    i := position('{{' || n || '}}' in p_body);
    v_before := lower(substr(p_body, greatest(1, i - 40), least(i - 1, 40)));
    v_after := lower(substr(p_body, i + length('{{' || n || '}}'), 30));
    v_out := v_out || case
      when v_before ~ '(hi|hello|dear|thank you,|thanks,|thank you)\s*$' then 'name'
      when v_before ~ '(bounty|geek),\s*$' then 'name'
      when v_before ~ 'joining\s*$' then 'campaign'
      when v_after ~ '^\s*campaign' then 'campaign'
      when v_before ~ '(due on|due|by|before)\s*$' then 'due'
      when v_before ~ 'track[a-z ]*(id|number)?[: ]*$' then 'tracking'
      when v_before ~ '(courier|via)\s*[: ]*$' then 'courier'
      when v_before ~ 'address[^.]*$' then 'address'
      when v_before ~ '(@|instagram[a-z ]*)\s*$' then 'ig'
      when v_before ~ '(for|your|the)\s*$' then 'campaign'
      else null end;
  end loop;
  return v_out;
end $$;

-- dispatcher: is a sync due? (every 15 minutes)
create or replace function api.ops_wa_tpl_sync_due() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select max(synced_at) from private.wa_utility_templates) < now() - interval '15 minutes', true)
$$;
revoke all on function api.ops_wa_tpl_sync_due() from public, anon, authenticated;
grant execute on function api.ops_wa_tpl_sync_due() to service_role;

-- dispatcher: the approved Utility templates Snapto has now (made on / after 16 Nov 2026)
create or replace function api.ops_wa_tpl_upsert(p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; r jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into private.wa_utility_templates(name, lang, header, body, url, url_button, quick, made_at, active, synced_at)
    values (r->>'name', coalesce(r->>'lang', 'en'), nullif(r->>'header', ''), coalesce(r->>'body', ''), nullif(r->>'url', ''), nullif(r->>'url_button', ''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'quick', '[]')) x), '{}'),
            to_timestamp(nullif(r->>'made_ms', '')::double precision / 1000), true, now())
    on conflict (name) do update set lang = excluded.lang, header = excluded.header, body = excluded.body, url = excluded.url,
      url_button = excluded.url_button, quick = excluded.quick, made_at = excluded.made_at, active = true, synced_at = now();
    v_n := v_n + 1;
  end loop;
  -- gone from Snapto (deleted / not approved any more) → hidden
  update private.wa_utility_templates set active = false, synced_at = now()
   where name not in (select x->>'name' from jsonb_array_elements(p_rows) x);
  return v_n;
end $$;
revoke all on function api.ops_wa_tpl_upsert(jsonb) from public, anon, authenticated;
grant execute on function api.ops_wa_tpl_upsert(jsonb) to service_role;

-- the list for the panel
create or replace function api.wa_utility_templates(p_campaign uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_img text; v_c text;
begin
  if not public.is_platform_admin() then raise exception 'Only the super admin can do this' using errcode = '42501'; end if;
  if p_campaign is not null then
    v_img := private.campaign_wa_image(p_campaign);
    select name into v_c from intel.ci_campaign where campaign_id = private.campaign_intel_id(p_campaign);
  end if;
  return jsonb_build_object('campaign', v_c, 'photo', v_img, 'templates', coalesce((select jsonb_agg(jsonb_build_object(
      'name', t.name, 'header', t.header, 'body', t.body, 'url', t.url, 'url_button', t.url_button, 'quick', t.quick,
      'roles', private.wa_tpl_roles(t.body),
      'ok', (select bool_and(coalesce(x, '?') in ('name', 'campaign')) from unnest(private.wa_tpl_roles(t.body)) x) is not false
            and (t.header is distinct from 'IMAGE' or v_img is not null),
      'why', case when exists (select 1 from unnest(private.wa_tpl_roles(t.body)) x where x is null or x not in ('name', 'campaign'))
                    then 'needs each creator''s own details — use "Each creator''s own step"'
                  when t.header = 'IMAGE' and v_img is null then 'photo template — tick "WhatsApp invite with photo" and add a photo in Edit brief'
                  else null end)
    order by (t.header = 'IMAGE') desc nulls last, t.made_at desc nulls last, t.name)
    from private.wa_utility_templates t where t.active), '[]'::jsonb));
end $$;
revoke all on function api.wa_utility_templates(uuid) from public, anon;
grant execute on function api.wa_utility_templates(uuid) to authenticated;

-- one template to the ticked creators
create or replace function api.wa_send_template(p_campaign uuid, p_invites uuid[] default '{}', p_parts uuid[] default '{}', p_template text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t private.wa_utility_templates; v_roles text[]; v_img text; v_c text; v_on boolean; r record; v_vars jsonb; v_btn text;
        v_q int := 0; v_skip jsonb := '[]'; v_stamp text := to_char(now(), 'YYYYMMDDHH24MI'); v_phone text; v_seen text[] := '{}'; v_mem uuid;
begin
  if not public.is_platform_admin() then raise exception 'Only the super admin can do this' using errcode = '42501'; end if;
  p_campaign := private.campaign_intel_id(p_campaign);
  if p_campaign is null then return jsonb_build_object('ok', false, 'error', 'Campaign not found.'); end if;
  select * into t from private.wa_utility_templates where name = p_template and active;
  if t.name is null then return jsonb_build_object('ok', false, 'error', 'That template is not available.'); end if;
  v_roles := private.wa_tpl_roles(t.body);
  if exists (select 1 from unnest(v_roles) x where x is null or x not in ('name', 'campaign')) then
    return jsonb_build_object('ok', false, 'error', 'This template needs each creator''s own details. Use "Each creator''s own step".');
  end if;
  v_img := private.campaign_wa_image(p_campaign);
  if t.header = 'IMAGE' and v_img is null then
    return jsonb_build_object('ok', false, 'error', 'Photo template: tick "WhatsApp invite with photo" and add a photo in Edit brief first.');
  end if;
  if not private.snapto_campaign_on(p_campaign) or not private.snapto_on() then
    return jsonb_build_object('ok', false, 'error', 'WhatsApp is OFF for this campaign — turn it on in Overview first.');
  end if;
  select name into v_c from intel.ci_campaign where campaign_id = p_campaign;

  for r in
    select 'i:' || i.invite_id k, i.invite_id::text ref, i.phone_e164 phone, null::uuid member,
           coalesce(nullif(split_part(btrim(coalesce(i.full_name, '')), ' ', 1), ''), 'there') nm,
           coalesce('@' || i.handle, i.full_name, i.phone_e164) who,
           case when i.claimed_at is null and i.token is not null then 'login?cinv=' || i.token::text else 'login' end inv_path,
           null::text pid
      from intel.ci_campaign_invite i where i.campaign_id = p_campaign and i.invite_id = any(coalesce(p_invites, '{}'))
    union all
    select 'p:' || p.participation_id, p.participation_id::text, null, intel.ci_member_of_identity(p.identity_id),
           coalesce(nullif(private.snapto_first_name(intel.ci_member_of_identity(p.identity_id)), ''), 'there'),
           p.participation_id::text, null, p.participation_id::text
      from intel.ci_campaign_participation p where p.campaign_id = p_campaign and p.participation_id = any(coalesce(p_parts, '{}'))
  loop
    v_phone := r.phone;
    if v_phone is null and r.member is not null then
      select coalesce((select w.phone_e164 from public.wa_contacts w where w.user_id = r.member and w.verified_at is not null limit 1), nullif(m.whatsapp_e164, ''))
        into v_phone from public.members m where m.id = r.member;
    end if;
    if v_phone is null then v_skip := v_skip || jsonb_build_object('who', r.who, 'why', 'no WhatsApp number'); continue; end if;
    if v_phone = any(v_seen) then continue; end if;
    if exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.opt_out_at is not null)
       or exists (select 1 from public.wa_phone_optout o where o.phone_e164 = v_phone and o.opt_out_at is not null) then
      v_skip := v_skip || jsonb_build_object('who', r.who, 'why', 'said STOP'); continue;
    end if;
    -- button link: …/creator/{{1}} → invite path or my-campaigns/<id>; …/my-campaigns/{{1}} → the campaign of this creator
    v_btn := null;
    if t.url like '%{{1}}' then
      if t.url like '%/my-campaigns/{{1}}' then
        if r.pid is null then v_skip := v_skip || jsonb_build_object('who', r.who, 'why', 'not in the campaign yet (this template opens their campaign page)'); continue; end if;
        v_btn := r.pid;
      elsif t.url like '%/creator/{{1}}' then
        v_btn := coalesce(r.inv_path, 'my-campaigns/' || r.pid);
      else
        v_btn := coalesce(r.inv_path, 'login');
      end if;
    end if;
    select coalesce(jsonb_agg(case x when 'name' then left(r.nm, 40) else coalesce(v_c, 'your campaign') end order by o), '[]')
      into v_vars from unnest(v_roles) with ordinality u(x, o);
    insert into private.snapto_drip_queue(kind, drip, member_id, phone, attrs, dedupe)
    values ('tpl', t.name, r.member, v_phone,
            jsonb_build_object('vars', v_vars, 'button', v_btn, 'image', case when t.header = 'IMAGE' then v_img end, 'lang', t.lang),
            'tpl:' || t.name || ':' || r.k || ':' || v_stamp)
    on conflict (dedupe) do nothing;
    v_seen := v_seen || v_phone;
    v_q := v_q + 1;
  end loop;
  return jsonb_build_object('ok', true, 'queued', v_q, 'skipped', v_skip, 'template', t.name);
end $$;
revoke all on function api.wa_send_template(uuid, uuid[], uuid[], text) from public, anon;
grant execute on function api.wa_send_template(uuid, uuid[], uuid[], text) to authenticated;
