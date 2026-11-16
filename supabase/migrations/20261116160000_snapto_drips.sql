-- Snapto drips (WhatsApp reminder sequences live in Snapto, not here).
-- The backend only tells Snapto two things, each ONCE per event (dedupe key):
--   start  → save the creator's details on the Snapto contact, then call that drip's chatbot webhook
--   done   → set done_<task> on the Snapto contact (the drip's stop condition) when the creator finishes the task
-- Drips: 02 profile · 04 instagram connect · 05 instagram sync failed · 06 instagram reconnect · 10 contract · 12 address
-- The webhook URLs + Snapto attribute ids are in the SNAPTO_DRIP_CONFIG secret (not in this public repo).
-- Nothing changes until the switch row is added:  insert into private.snapto_drip_switch(on_) values (true);
-- While the switch is on, the old WhatsApp step message for contract_sent / confirm_address is not sent (the drip replaces it).

create table if not exists private.snapto_drip_switch (on_ boolean primary key default true);
alter table private.snapto_drip_switch enable row level security;
revoke all on private.snapto_drip_switch from public, anon, authenticated;

create table if not exists private.snapto_drip_queue (
  id         bigserial primary key,
  kind       text not null check (kind in ('start','done')),
  drip       text not null,                -- '02','04','05','06','10','12' (start) or 'profile','instagram','contract','address' (done)
  member_id  uuid,
  phone      text not null,                -- +E.164
  attrs      jsonb not null default '{}',  -- creator_name, campaign_name, delivery_address, ig_username, agreement_path, address_path
  dedupe     text not null unique,         -- one row per event → never sent twice
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at    timestamptz,
  tries      int not null default 0,
  error      text
);
alter table private.snapto_drip_queue enable row level security;
revoke all on private.snapto_drip_queue from public, anon, authenticated;
create index if not exists snapto_drip_queue_pending_idx on private.snapto_drip_queue(created_at) where sent_at is null;

create or replace function private.snapto_on() returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from private.snapto_drip_switch where on_) $$;

create or replace function private.snapto_identity_of(p_member uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select a.identity_id from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null
   order by a.granted_at limit 1 $$;

create or replace function private.snapto_first_name(p_member uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(coalesce(pp.display_name, '')), '') from intel.ci_creator_professional_profile pp where pp.identity_id = private.snapto_identity_of(p_member) limit 1),
    (select nullif(split_part(btrim(coalesce(m.name, '')), ' ', 1), '') from public.members m where m.id = p_member and coalesce(m.name, '') !~ '^wa_\d+@'),
    'Creator') $$;

-- queue one message for Snapto (no-op when switched off, no WhatsApp number, opted out, or already queued)
create or replace function private.snapto_enqueue(p_kind text, p_drip text, p_member uuid, p_attrs jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if not private.snapto_on() or p_member is null then return; end if;
  select w.phone_e164 into v_phone from public.wa_contacts w
   where w.user_id = p_member and w.verified_at is not null and w.opt_out_at is null limit 1;
  if v_phone is null then return; end if;
  insert into private.snapto_drip_queue(kind, drip, member_id, phone, attrs, dedupe)
  values (p_kind, p_drip, p_member, v_phone, coalesce(p_attrs, '{}'), p_dedupe)
  on conflict (dedupe) do nothing;
exception when others then
  raise warning 'snapto enqueue skipped: %', sqlerrm;   -- never block the app on a reminder
end $$;
revoke all on function private.snapto_enqueue(text, text, uuid, jsonb, text) from public, anon, authenticated;

-- ---------- 02 + 04: new creator signs in with WhatsApp ----------
create or replace function private.tg_snapto_new_creator() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role text; v_name text;
begin
  if NEW.verified_at is null then return null; end if;
  if TG_OP = 'UPDATE' and OLD.verified_at is not null then return null; end if;
  select role into v_role from public.members where id = NEW.user_id;
  if coalesce(v_role, 'creator') <> 'creator' then return null; end if;
  v_name := private.snapto_first_name(NEW.user_id);
  perform private.snapto_enqueue('start', '02', NEW.user_id, jsonb_build_object('creator_name', v_name), 'start:02:' || NEW.user_id);
  -- 04 (connect Instagram) only when no Instagram is linked yet; its first message waits 49 h in Snapto
  if not exists (select 1 from public.social_accounts s where s.member_id = NEW.user_id and s.platform = 'instagram' and s.ig_user_id is not null) then
    perform private.snapto_enqueue('start', '04', NEW.user_id, jsonb_build_object('creator_name', v_name), 'start:04:' || NEW.user_id);
  end if;
  return null;
end $$;
drop trigger if exists snapto_new_creator on public.wa_contacts;
create trigger snapto_new_creator after insert or update of verified_at on public.wa_contacts
  for each row execute function private.tg_snapto_new_creator();

-- ---------- done: profile complete → stops 02 ----------
create or replace function private.tg_snapto_profile_done() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(NEW.completion_pct, 0) >= 100 and (TG_OP = 'INSERT' or coalesce(OLD.completion_pct, 0) < 100) then
    perform private.snapto_enqueue('done', 'profile', intel.ci_member_of_identity(NEW.identity_id), '{}', 'done:profile:' || NEW.identity_id);
  end if;
  return null;
end $$;
drop trigger if exists snapto_profile_done on intel.ci_profile_completion;
create trigger snapto_profile_done after insert or update of completion_pct on intel.ci_profile_completion
  for each row execute function private.tg_snapto_profile_done();

-- ---------- done: Instagram (re)connected or token renewed → stops 04 / 05 / 06 ----------
create or replace function private.tg_snapto_ig_done() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.platform <> 'instagram' or NEW.expires_at is null then return null; end if;
  if TG_OP = 'UPDATE' and OLD.expires_at is not null and NEW.expires_at <= OLD.expires_at then return null; end if;
  perform private.snapto_enqueue('done', 'instagram', NEW.member_id, '{}', 'done:instagram:' || NEW.member_id || ':' || to_char(now(), 'YYYYMMDD'));
  return null;
end $$;
drop trigger if exists snapto_ig_done on public.social_tokens;
create trigger snapto_ig_done after insert or update of expires_at on public.social_tokens
  for each row execute function private.tg_snapto_ig_done();

-- ---------- 10 / 12 / done contract / done address: campaign steps ----------
create or replace function private.tg_snapto_campaign_step() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_key text := split_part(coalesce(NEW.dedupe_key, ''), ':', 1); v_member uuid; v_identity uuid; v_cname text; v_addr text;
begin
  if NEW.participation_id is null or v_key not in ('contract_sent', 'confirm_address', 'contract_signed_ops', 'address_confirmed') then return null; end if;
  select identity_id into v_identity from intel.ci_campaign_participation where participation_id = NEW.participation_id;
  v_member := intel.ci_member_of_identity(v_identity);
  select c.name into v_cname from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
  if v_key = 'contract_sent' then
    perform private.snapto_enqueue('start', '10', v_member,
      jsonb_build_object('campaign_name', coalesce(v_cname, 'your campaign'), 'agreement_path', NEW.participation_id || '/agreement'),
      'start:10:' || NEW.participation_id);
  elsif v_key = 'confirm_address' then
    perform private.snapto_enqueue('done', 'contract', v_member, '{}', 'done:contract:' || NEW.participation_id);
    select concat_ws(', ', nullif(a.line1, ''), nullif(a.line2, ''), nullif(a.landmark, ''), nullif(a.city, ''), nullif(a.state, ''), nullif(a.postal_code, ''))
      into v_addr from private.creator_address a
     where a.identity_id = v_identity and a.deleted_at is null order by a.is_default desc, a.updated_at desc limit 1;
    perform private.snapto_enqueue('start', '12', v_member,
      jsonb_build_object('campaign_name', coalesce(v_cname, 'your campaign'), 'delivery_address', coalesce(nullif(v_addr, ''), 'not added yet'),
                         'address_path', NEW.participation_id || '/address'),
      'start:12:' || NEW.participation_id);
  elsif v_key = 'contract_signed_ops' then
    perform private.snapto_enqueue('done', 'contract', v_member, '{}', 'done:contract:' || NEW.participation_id);
  elsif v_key = 'address_confirmed' then
    perform private.snapto_enqueue('done', 'address', v_member, '{}', 'done:address:' || NEW.participation_id);
  end if;
  return null;
exception when others then
  raise warning 'snapto campaign step skipped: %', sqlerrm;
  return null;
end $$;
drop trigger if exists snapto_campaign_step on intel.ci_notification;
create trigger snapto_campaign_step after insert on intel.ci_notification
  for each row execute function private.tg_snapto_campaign_step();

-- the drip replaces the old single WhatsApp for these two steps (email + in-app still go)
create or replace function private.tg_snapto_skip_old_wa() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.channel = 'whatsapp' and NEW.template_key in ('contract_sent', 'confirm_address') and private.snapto_on() then
    return null;
  end if;
  return NEW;
end $$;
drop trigger if exists snapto_skip_old_wa on intel.ci_outbox;
create trigger snapto_skip_old_wa before insert on intel.ci_outbox
  for each row execute function private.tg_snapto_skip_old_wa();

-- ---------- 05 / 06: called by instagram-refresh when a creator's sync fails ----------
create or replace function api.snapto_ig_problem(p_member uuid, p_kind text, p_username text, p_ref text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('sync_failed', 'reconnect') then return; end if;
  perform private.snapto_enqueue('start', case when p_kind = 'reconnect' then '06' else '05' end, p_member,
    jsonb_build_object('ig_username', coalesce(nullif(ltrim(coalesce(p_username, ''), '@'), ''), 'your account')),
    'start:' || p_kind || ':' || p_member || ':' || coalesce(p_ref, to_char(now(), 'YYYYMMDD')));
end $$;
revoke all on function api.snapto_ig_problem(uuid, text, text, text) from public, anon, authenticated;
grant execute on function api.snapto_ig_problem(uuid, text, text, text) to service_role;

-- ---------- "Confirm address" button in the 12 drip (wa-webhook) ----------
-- confirms the creator's saved default address for their campaign that is waiting for it (same as the app's Confirm)
create or replace function api.snapto_confirm_address(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_identity uuid; v_part uuid; a private.creator_address%rowtype;
begin
  select user_id into v_member from public.wa_contacts where phone_e164 = p_phone limit 1;
  if v_member is null then return jsonb_build_object('ok', false, 'why', 'unknown number'); end if;
  v_identity := private.snapto_identity_of(v_member);
  select p.participation_id into v_part from intel.ci_campaign_participation p
   where p.identity_id = v_identity and p.stage = 'contract_signed' order by p.updated_at desc limit 1;
  if v_part is null then return jsonb_build_object('ok', false, 'why', 'nothing waiting for an address'); end if;
  select * into a from private.creator_address
   where identity_id = v_identity and deleted_at is null order by is_default desc, updated_at desc limit 1;
  if a.address_id is null or not intel.ci_address_complete(a) then
    return jsonb_build_object('ok', false, 'why', 'address incomplete — the creator edits it in the app');
  end if;
  update intel.ci_campaign_participation set shipping_address_id = a.address_id where participation_id = v_part;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (intel.ci_campaign_of_participation(v_part), v_part, 'address', null, 'confirmed', v_member, 'confirmed on WhatsApp');
  perform intel.ci_participation_advance(v_part, 'address_confirmed', v_member, 'address confirmed on WhatsApp');
  return jsonb_build_object('ok', true, 'participation_id', v_part);
end $$;
revoke all on function api.snapto_confirm_address(text) from public, anon, authenticated;
grant execute on function api.snapto_confirm_address(text) to service_role;

-- ---------- worker side (ops-notify-dispatch) ----------
create or replace function api.ops_snapto_claim(p_limit int default 30)
returns setof private.snapto_drip_queue language sql security definer set search_path = '' as $$
  update private.snapto_drip_queue q set claimed_at = now(), tries = q.tries + 1
   where q.id in (select id from private.snapto_drip_queue
                   where sent_at is null and tries < 5 and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                   order by created_at limit p_limit for update skip locked)
  returning q.* $$;
revoke all on function api.ops_snapto_claim(int) from public, anon, authenticated;
grant execute on function api.ops_snapto_claim(int) to service_role;

create or replace function api.ops_snapto_result(p_id bigint, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update private.snapto_drip_queue set sent_at = case when p_ok then now() end, error = case when p_ok then null else left(p_error, 500) end,
         claimed_at = case when p_ok then claimed_at end
   where id = p_id $$;
revoke all on function api.ops_snapto_result(bigint, boolean, text) from public, anon, authenticated;
grant execute on function api.ops_snapto_result(bigint, boolean, text) to service_role;
