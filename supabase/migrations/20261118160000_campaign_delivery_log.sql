-- Campaign → Messages → 📋 Delivery log
-- Every message we tried to send for a campaign, with a plain reason when it did not go:
--   WhatsApp = Snapto drips (private.snapto_drip_queue) · Email / old WhatsApp = intel.ci_outbox
-- "Sent" for a drip = handed to Snapto; delivered / read is tracked in Snapto Reports.
-- a phone that can really get WhatsApp (catches sheet dates/times saved as numbers, e.g. +108202616451)
create or replace function private.phone_looks_real(p text) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p, '') <> '' and case
    when p ~ '^\+91' then p ~ '^\+91[6-9][0-9]{9}$'
    when p ~ '^\+1' then p ~ '^\+1[2-9][0-9]{9}$'
    else p ~ '^\+[2-9][0-9]{7,12}$' end
  and p !~ '^\+[0-9]{1,4}20(2[4-9])[0-9]*$'
$$;

create or replace function api.campaign_delivery_log(p_campaign uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid := intel.ci_resolve_campaign(p_campaign); v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
begin
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return jsonb_build_object(
    'campaign_id', v_c,
    'switches', jsonb_build_object(
      'wa', coalesce((select m.wa_on from intel.ci_campaign_messaging m where m.campaign_id = v_c), true),
      'email', coalesce((select m.email_on from intel.ci_campaign_messaging m where m.campaign_id = v_c), true),
      'wa_global', coalesce((select s.wa_on from public.messaging_switches s limit 1), true),
      'email_global', coalesce((select s.email_on from public.messaging_switches s limit 1), true)),
    'rows', coalesce((select jsonb_agg(r order by r->>'at' desc) from (
      -- 1) Snapto drips (WhatsApp)
      select jsonb_build_object(
        'id', 'd' || q.id, 'source', 'drip', 'channel', 'whatsapp', 'kind', q.kind, 'drip', q.drip,
        'to', q.phone, 'at', q.created_at, 'sent_at', q.sent_at, 'tries', q.tries,
        'who', coalesce(nullif(i.full_name, ''), nullif(mm.name, ''), i.handle, q.attrs->>'creator_name'),
        'handle', coalesce(i.handle, sa.username),
        'member_id', coalesce(q.member_id, i.claimed_by),
        'phone_ok', private.phone_looks_real(q.phone),
        'opted_out', exists (select 1 from public.wa_contacts w where w.phone_e164 = q.phone and w.opt_out_at is not null),
        'status', case when q.kind = 'done' then (case when q.sent_at is not null then 'stopped' else 'queued' end)
                       when q.error is not null then (case when q.error ilike 'skipped%' then 'skipped' else 'failed' end)
                       when q.sent_at is not null then 'sent' else 'queued' end,
        'error', q.error, 'attrs', q.attrs) r
      from private.snapto_drip_queue q
      left join intel.ci_campaign_invite i
        on q.drip in ('01', 'join') and i.invite_id::text = split_part(q.dedupe, ':', 3)
      left join intel.ci_campaign_participation p
        on q.drip not in ('01', 'join') and p.participation_id::text = split_part(q.dedupe, ':', 3)
      left join public.members mm on mm.id = coalesce(q.member_id, i.claimed_by)
      left join lateral (select s.username from public.social_accounts s where s.member_id = coalesce(q.member_id, i.claimed_by) and s.platform = 'instagram' limit 1) sa on true
      where q.created_at >= v_since
        and ((i.campaign_id = v_c) or (p.campaign_id = v_c)
             -- account drips (profile / Instagram) for this campaign's creators
             or (q.drip in ('02','04','05','06','profile','instagram') and q.member_id in (
                  select intel.ci_member_of_identity(pp.identity_id) from intel.ci_campaign_participation pp where pp.campaign_id = v_c)))
      union all
      -- 2) step emails / WhatsApp from the outbox
      select jsonb_build_object(
        'id', 'o' || o.outbox_id, 'source', 'outbox', 'channel', o.channel, 'kind', 'step', 'template', o.template_key,
        'to', o.to_address, 'at', o.created_at, 'sent_at', o.sent_at, 'tries', o.attempts,
        'who', coalesce(nullif(mm.name, ''), o.payload->>'name', o.to_address),
        'member_id', o.recipient_member_id,
        'phone_ok', o.channel <> 'whatsapp' or private.phone_looks_real(case when o.to_address like '+%' then o.to_address else '+' || o.to_address end),
        'opted_out', false,
        'status', case when o.status = 'skipped' and o.last_error ilike 'paused:%' then 'held' else o.status end,
        'error', o.last_error, 'title', coalesce(o.payload->>'title', o.payload->>'subject')) r
      from intel.ci_outbox o
      left join public.members mm on mm.id = o.recipient_member_id
      where o.campaign_id = v_c and o.created_at >= v_since
      limit 3000
    ) x), '[]'::jsonb));
end $$;
revoke all on function api.campaign_delivery_log(uuid, int) from public, anon;
grant execute on function api.campaign_delivery_log(uuid, int) to authenticated, service_role;
