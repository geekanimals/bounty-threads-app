-- WhatsApp invite with the campaign's photo (Snapto image templates campaign_invite_pic_1 / _2 / _3).
--  * public.campaigns.wa_invite_image — optional photo just for the WhatsApp invite (JPG/PNG). Empty → the campaign photo.
--  * WhatsApp image headers take only JPG / PNG, so a WebP / other photo → no image → the normal drip 01.
--  * Snapto drips can't take a different photo per campaign, so the photo invite is 3 timed queue rows, each sent by a
--    Snapto chatbot (webhook → template with header link {{start_node.campaign_image}}):
--      '01i'  pic_1  +10 min · '01i2' pic_2  +3 h 10 min · '01i3' pic_3  +23 h 10 min   (same timing as drip 01)
--    Each row is checked again when it is due: creator joined → skipped (private.snapto_start_valid).
--  * Campaign has a usable photo → this sequence; no photo → drip '01' exactly as before.
--  * api.snapto_image_invite_once(campaign, send) — one photo message (pic_1, key '01ix') to everyone invited to that
--    campaign who has not joined yet, and stops their old drip 01. send=false only counts. Once per invite.
-- Webhook ids live in the SNAPTO_IMG_HOOKS secret {"01i","01i2","01i3","01ix"} (never in the repo).

alter table private.snapto_drip_queue add column if not exists not_before timestamptz;

create or replace function private.snapto_enqueue_phone_at(p_kind text, p_drip text, p_phone text, p_attrs jsonb, p_dedupe text, p_not_before timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_phone is null then return; end if;
  if left(v_phone, 1) <> '+' then
    v_phone := regexp_replace(v_phone, '\D', '', 'g');
    if length(v_phone) = 10 then v_phone := '+91' || v_phone; else v_phone := '+' || v_phone; end if;
  end if;
  if p_kind = 'start' and not private.snapto_on() then return; end if;
  if exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.opt_out_at is not null) then return; end if;
  insert into private.snapto_drip_queue(kind, drip, member_id, phone, attrs, dedupe, not_before)
  values (p_kind, p_drip, null, v_phone, coalesce(p_attrs, '{}'), p_dedupe, p_not_before)
  on conflict (dedupe) do nothing;
exception when others then
  raise warning 'snapto enqueue (phone, at) skipped: %', sqlerrm;
end $$;
revoke all on function private.snapto_enqueue_phone_at(text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;

-- rows with a future not_before wait in the queue
create or replace function api.ops_snapto_claim(p_limit int default 30)
returns setof private.snapto_drip_queue language plpgsql security definer set search_path = '' as $$
begin
  update private.snapto_drip_queue q
     set tries = 99, error = 'skipped: creator already moved past this step'
   where q.sent_at is null and q.tries < 5 and q.kind = 'start'
     and not private.snapto_start_valid(q.drip, q.dedupe);

  return query
  update private.snapto_drip_queue q set claimed_at = now(), tries = q.tries + 1
   where q.id in (select id from private.snapto_drip_queue
                   where sent_at is null and tries < 5 and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                     and (not_before is null or not_before <= now())
                   order by coalesce(not_before, created_at) limit p_limit for update skip locked)
  returning q.*;
end $$;

alter table public.campaigns add column if not exists wa_invite_image text;

-- p_campaign: intel campaign_id (invites / drips) or public.campaigns.id (the form) — both work
create or replace function private.campaign_intel_id(p_campaign uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((select ic.campaign_id from intel.ci_campaign ic where ic.campaign_id = p_campaign),
                  (select ic.campaign_id from intel.ci_campaign ic where ic.legacy_campaign_id = p_campaign limit 1))
$$;
revoke all on function private.campaign_intel_id(uuid) from public, anon, authenticated;

create or replace function private.campaign_wa_image(p_campaign uuid) returns text
language sql stable security definer set search_path = '' as $$
  with ids as (
    select ic.campaign_id, coalesce(ic.legacy_campaign_id, ic.campaign_id) legacy, ic.cover_url
    from intel.ci_campaign ic where ic.campaign_id = private.campaign_intel_id(p_campaign)
  )
  select u from (
    select 1 o, nullif(btrim(c.wa_invite_image), '') u from ids join public.campaigns c on c.id = ids.legacy
    union all
    select 2, nullif(btrim(c.cover_url), '') from ids join public.campaigns c on c.id = ids.legacy
    union all
    select 3, nullif(btrim(ids.cover_url), '') from ids
  ) x
  where u ~* '^https://[^[:space:]]+[.](jpe?g|png)([?][^[:space:]]*)?$'
  order by o limit 1
$$;
revoke all on function private.campaign_wa_image(uuid) from public, anon, authenticated;

create or replace function private.tg_snapto_invite() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cname text; v_phone text := nullif(btrim(coalesce(NEW.phone_e164, '')), ''); v_first text; v_attrs jsonb;
begin
  if v_phone is null then return null; end if;

  if TG_OP = 'UPDATE' and NEW.claimed_at is not null and OLD.claimed_at is null then
    perform private.snapto_enqueue_phone('done', 'join', v_phone, '{}', 'done:join:' || NEW.invite_id);
    return null;
  end if;
  if NEW.claimed_at is not null then return null; end if;
  if TG_OP = 'UPDATE' and NEW.last_invited_at is not distinct from OLD.last_invited_at then return null; end if;

  -- already has an account with this number → they get the step drips instead
  if exists (select 1 from public.members m where m.whatsapp_e164 = v_phone)
     or exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.user_id is not null) then
    return null;
  end if;
  -- resend: not again within 2 hours of the last invite drip for this invite
  if TG_OP = 'UPDATE' and exists (select 1 from private.snapto_drip_queue q
       where q.dedupe like 'start:01:' || NEW.invite_id || '%' and q.created_at > now() - interval '2 hours') then
    return null;
  end if;

  select c.name into v_cname from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
  v_first := coalesce(nullif(split_part(btrim(coalesce(NEW.full_name, '')), ' ', 1), ''), 'there');
  v_attrs := jsonb_build_object('creator_name', left(v_first, 40), 'campaign_name', coalesce(v_cname, 'your campaign'),
                                'invite_path', case when NEW.token is not null then 'login?cinv=' || NEW.token::text else 'login' end);
  -- campaign with a photo → snapto_enqueue_phone_c turns this into the 3-step photo invite
  perform private.snapto_enqueue_phone_c(NEW.campaign_id, 'start', '01', v_phone, v_attrs,
    'start:01:' || NEW.invite_id || case when TG_OP = 'UPDATE' then ':r' || extract(epoch from now())::bigint else '' end);
  return null;
exception when others then
  raise warning 'snapto invite skipped: %', sqlerrm;
  return null;
end $$;

create or replace function api.snapto_image_invite_once(p_campaign uuid, p_send boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_img text; v_cname text; v_n int := 0; v_done int := 0; r record;
begin
  if not public.is_platform_admin() then raise exception 'Only the super admin can do this'; end if;
  p_campaign := private.campaign_intel_id(p_campaign);
  if p_campaign is null then return jsonb_build_object('ok', false, 'error', 'Campaign not found.'); end if;
  v_img := private.campaign_wa_image(p_campaign);
  if v_img is null then
    return jsonb_build_object('ok', false, 'error', 'This campaign has no JPG / PNG photo for WhatsApp. Add one under Edit brief → WhatsApp invite photo.');
  end if;
  select c.name into v_cname from intel.ci_campaign c where c.campaign_id = p_campaign;
  for r in
    select distinct on (i.phone_e164) i.invite_id, i.phone_e164, i.full_name, i.token
    from intel.ci_campaign_invite i
    where i.campaign_id = p_campaign and i.claimed_at is null and nullif(btrim(coalesce(i.phone_e164, '')), '') is not null
      and not exists (select 1 from public.members m where m.whatsapp_e164 = i.phone_e164)
      and not exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and (w.user_id is not null or w.opt_out_at is not null))
    order by i.phone_e164, i.last_invited_at desc nulls last
  loop
    if exists (select 1 from private.snapto_drip_queue q where q.dedupe = 'start:01ix:' || r.invite_id) then
      v_done := v_done + 1; continue;
    end if;
    v_n := v_n + 1;
    if p_send then
      -- stop the old drip 01 (Snapto: done_join changes → drip 01 stops), then one photo message
      perform private.snapto_enqueue_phone('done', 'join', r.phone_e164, '{}', 'done:join:img:' || r.invite_id);
      perform private.snapto_enqueue_phone_c(p_campaign, 'start', '01ix', r.phone_e164,
        jsonb_build_object('creator_name', left(coalesce(nullif(split_part(btrim(coalesce(r.full_name, '')), ' ', 1), ''), 'there'), 40),
                           'campaign_name', coalesce(v_cname, 'your campaign'), 'campaign_image', v_img,
                           'invite_path', case when r.token is not null then 'login?cinv=' || r.token::text else 'login' end),
        'start:01ix:' || r.invite_id);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'sent', p_send, 'people', v_n, 'already_sent', v_done, 'image', v_img, 'campaign', v_cname);
end $$;
revoke all on function api.snapto_image_invite_once(uuid, boolean) from public, anon;
grant execute on function api.snapto_image_invite_once(uuid, boolean) to authenticated;

-- the image drips are invite drips too: same "still not joined?" check, and they show in the campaign's delivery log
do $do$
declare v_def text; v_oid oid;
begin
  select pg_get_functiondef('private.snapto_start_valid(text, text)'::regprocedure) into v_def;
  if position($x$p_drip in ('01', '01i', '01i2', '01i3', '01ix')$x$ in v_def) = 0 then
    v_def := replace(v_def, $x$if p_drip = '01' then$x$, $x$if p_drip in ('01', '01i', '01i2', '01i3', '01ix') then$x$);
    v_def := replace(v_def, $x$p_drip not in ('01', '07'$x$, $x$p_drip not in ('01', '01i', '01i2', '01i3', '01ix', '07'$x$);
    execute v_def;
  end if;
  for v_oid in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = 'campaign_delivery_log' loop
    v_def := pg_get_functiondef(v_oid);
    if position($x$('01', '01i', '01i2', '01i3', '01ix', 'join')$x$ in v_def) = 0 then
      v_def := replace(v_def, $x$q.drip in ('01', 'join')$x$, $x$q.drip in ('01', '01i', '01i2', '01i3', '01ix', 'join')$x$);
      v_def := replace(v_def, $x$q.drip not in ('01', 'join')$x$, $x$q.drip not in ('01', '01i', '01i2', '01i3', '01ix', 'join')$x$);
      execute v_def;
    end if;
  end loop;
end $do$;

-- every other path that sends the invite drip ("WhatsApp all / Resend" on the campaign) also gets the photo
create or replace function private.snapto_enqueue_phone_c(p_campaign uuid, p_kind text, p_drip text, p_phone text, p_attrs jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_img text; v_attrs jsonb := coalesce(p_attrs, '{}');
begin
  if p_kind = 'start' and p_campaign is not null and not private.snapto_campaign_on(p_campaign) then return; end if;
  if p_kind = 'start' and p_drip = '01' and p_campaign is not null then
    v_img := private.campaign_wa_image(p_campaign);
    if v_img is not null then
      v_attrs := v_attrs || jsonb_build_object('campaign_image', v_img);
      perform private.snapto_enqueue_phone_at('start', '01i',  p_phone, v_attrs, p_dedupe,           now() + interval '10 minutes');
      perform private.snapto_enqueue_phone_at('start', '01i2', p_phone, v_attrs, p_dedupe || ':s2', now() + interval '3 hours 10 minutes');
      perform private.snapto_enqueue_phone_at('start', '01i3', p_phone, v_attrs, p_dedupe || ':s3', now() + interval '23 hours 10 minutes');
      return;
    end if;
  end if;
  perform private.snapto_enqueue_phone(p_kind, p_drip, p_phone, v_attrs, p_dedupe);
end $$;
revoke all on function private.snapto_enqueue_phone_c(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
