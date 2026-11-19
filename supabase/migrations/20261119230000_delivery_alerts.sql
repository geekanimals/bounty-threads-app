-- Undelivered WhatsApp alerts for admins: checked 6 times a day (9, 11, 1, 3, 5, 7 IST), shown in the admin
-- bell and as a pop-up inside the campaign.

-- 1) every "failed" status from WhatsApp (Snapto drips included) is kept, with the number when we know it
create table if not exists private.wa_failed (
  wamid text primary key,
  phone_e164 text,
  code int,
  error text,
  at timestamptz not null default now()
);
alter table private.wa_failed enable row level security;

do $mig$
declare d text := pg_get_functiondef('api.ops_outbox_wa_status(text,text,integer,text)'::regprocedure);
begin
  if position('private.wa_failed' in d) = 0 then
    d := regexp_replace(d, '(if p_ref is null or p_status is distinct from ''failed'' then return; end if;)',
      E'\\1\n  insert into private.wa_failed(wamid, phone_e164, code, error)\n  values (p_ref, (select s.phone_e164 from private.wa_outbound_seen s where s.wa_message_id = p_ref limit 1), p_code, v_msg)\n  on conflict (wamid) do nothing;');
    if position('private.wa_failed' in d) = 0 then raise exception 'ops_outbox_wa_status: patch point not found'; end if;
    execute d;
  end if;
end $mig$;

-- 2) alerts
create table if not exists private.delivery_alert (
  id bigserial primary key,
  ref text unique not null,          -- 'wa:<wamid>' | 'q:<queue id>'
  campaign_id uuid not null,
  who text,
  phone_e164 text,
  what text,
  reason text,
  happened_at timestamptz not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  seen_by uuid
);
alter table private.delivery_alert enable row level security;
create index if not exists delivery_alert_open_idx on private.delivery_alert (campaign_id, created_at desc) where seen_at is null;

create or replace function private.ci_delivery_check() returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_wa int := 0; v_q int := 0;
begin
  -- a) WhatsApp said "failed" → the creator's live campaign (by number)
  with f as (
    select w.* from private.wa_failed w where w.at > now() - interval '3 days' and w.phone_e164 is not null),
  c as (
    select f.wamid, f.phone_e164, f.code, f.error, f.at, i.campaign_id, coalesce(i.full_name, i.handle) who
      from f join intel.ci_campaign_invite i on i.phone_e164 = f.phone_e164
      join intel.ci_campaign cc on cc.campaign_id = i.campaign_id and cc.lifecycle_status = 'in_execution'
    union
    select f.wamid, f.phone_e164, f.code, f.error, f.at, p.campaign_id, coalesce(m.name, f.phone_e164)
      from f join public.members m on m.whatsapp_e164 = f.phone_e164
      join intel.ci_campaign_participation p on intel.ci_member_of_identity(p.identity_id) = m.id
      join intel.ci_campaign cc on cc.campaign_id = p.campaign_id and cc.lifecycle_status = 'in_execution'
     where p.stage not in ('ineligible','brand_declined','dropped','rejected','completed'))
  insert into private.delivery_alert(ref, campaign_id, who, phone_e164, what, reason, happened_at)
  select distinct on (wamid) 'wa:' || wamid, campaign_id, who, phone_e164, 'WhatsApp message',
         coalesce(error, 'failed') , at
    from c order by wamid
  on conflict (ref) do nothing;
  get diagnostics v_wa = row_count;

  -- b) a drip Snapto refused, or one stuck unsent for 30+ minutes
  insert into private.delivery_alert(ref, campaign_id, who, phone_e164, what, reason, happened_at)
  select 'q:' || q.id, coalesce(ii.campaign_id, pp.campaign_id),
         coalesce(ii.full_name, ii.handle, ip.full_name, ip.handle, q.phone), q.phone,
         'WhatsApp drip ' || q.drip,
         case when q.error is not null then q.error else 'Not sent yet — stuck for over 30 minutes' end,
         q.created_at
    from private.snapto_drip_queue q
    left join intel.ci_campaign_invite ii on ii.invite_id::text = split_part(q.dedupe, ':', 3)
    left join intel.ci_campaign_participation pp on pp.participation_id::text = split_part(q.dedupe, ':', 3)
    left join intel.ci_campaign_invite ip on ip.participation_id = pp.participation_id
   where q.kind = 'start' and q.created_at > now() - interval '3 days'
     and coalesce(ii.campaign_id, pp.campaign_id) is not null
     and ((q.error is not null and q.error !~* '^skipped') or (q.sent_at is null and q.error is null and q.created_at < now() - interval '30 minutes'))
     and (pp.stage is null or pp.stage not in ('ineligible','brand_declined','dropped','rejected'))
  on conflict (ref) do nothing;
  get diagnostics v_q = row_count;
  return jsonb_build_object('whatsapp_failed', v_wa, 'drips', v_q, 'at', now());
end $fn$;

-- 3) admin: open alerts (all campaigns, or one) + mark seen + check now
create or replace function api.admin_delivery_alerts(p_campaign uuid default null, p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_c uuid := case when p_campaign is null then null else intel.ci_resolve_campaign(p_campaign) end;
begin
  if not public.is_platform_admin() and (v_c is null or not intel.ci_can_operate_campaign(v_c)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'open', (select count(*) from private.delivery_alert a where a.seen_at is null and (v_c is null or a.campaign_id = v_c)),
    'last_check', (select max(created_at) from private.delivery_alert),
    'items', coalesce((select jsonb_agg(x order by x.happened_at desc) from (
        select a.id, a.campaign_id, (select name from intel.ci_campaign where campaign_id = a.campaign_id) campaign,
               (select c2.legacy_campaign_id from intel.ci_campaign c2 where c2.campaign_id = a.campaign_id) public_id,
               a.who, a.phone_e164 phone, a.what, a.reason, a.happened_at
          from private.delivery_alert a
         where a.seen_at is null and (v_c is null or a.campaign_id = v_c)
         order by a.happened_at desc limit greatest(1, least(p_limit, 200))) x), '[]'::jsonb));
end $fn$;

create or replace function api.admin_delivery_alerts_seen(p_campaign uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_c uuid := case when p_campaign is null then null else intel.ci_resolve_campaign(p_campaign) end; v_n int;
begin
  if not public.is_platform_admin() and (v_c is null or not intel.ci_can_operate_campaign(v_c)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update private.delivery_alert set seen_at = now(), seen_by = auth.uid()
   where seen_at is null and (v_c is null or campaign_id = v_c);
  get diagnostics v_n = row_count;
  return jsonb_build_object('seen', v_n);
end $fn$;

create or replace function api.admin_delivery_check_now()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return private.ci_delivery_check();
end $fn$;

revoke all on function api.admin_delivery_alerts(uuid, int), api.admin_delivery_alerts_seen(uuid), api.admin_delivery_check_now() from public, anon;
grant execute on function api.admin_delivery_alerts(uuid, int), api.admin_delivery_alerts_seen(uuid), api.admin_delivery_check_now() to authenticated;
revoke all on function private.ci_delivery_check() from public, anon, authenticated;

-- 9, 11, 1, 3, 5, 7 o'clock IST
select cron.schedule('ci-delivery-check', '30 3,5,7,9,11,13 * * *', 'select private.ci_delivery_check()');

-- WhatsApp message ids carry the number (wamid.HBgM + base64 of the number) — used when a message fails
-- before any "sent" status told us who it was for
create or replace function private.wamid_phone(p text) returns text language plpgsql immutable set search_path='' as $f$
declare v text;
begin
  if p is null or p !~ '^wamid\.HBgM' then return null; end if;
  begin v := convert_from(decode(substr(p, 11, 16), 'base64'), 'UTF8'); exception when others then return null; end;
  return case when v ~ '^\d{11,13}$' then '+' || v end;
end $f$;
do $m$ declare d text := pg_get_functiondef('api.ops_outbox_wa_status(text,text,integer,text)'::regprocedure);
begin
  if position('wamid_phone' in d) = 0 then
    d := replace(d, '(select s.phone_e164 from private.wa_outbound_seen s where s.wa_message_id = p_ref limit 1)', 'coalesce((select s.phone_e164 from private.wa_outbound_seen s where s.wa_message_id = p_ref limit 1), private.wamid_phone(p_ref))');
    if position('wamid_phone' in d) = 0 then raise exception 'patch failed'; end if;
    execute d;
  end if;
end $m$;
