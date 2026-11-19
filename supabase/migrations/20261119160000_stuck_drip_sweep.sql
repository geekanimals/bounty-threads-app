-- 1) Join link bug: an unregistered creator's WhatsApp join drip (Snapto) only fired when an email or an
--    old-template WhatsApp row got queued. Old WhatsApp templates are off, so creators with no email never
--    got the join link. Now a Snapto-enabled campaign counts the WhatsApp drip as sent.
do $mig$
declare d text := pg_get_functiondef('intel.ci_send_bulk_invite(uuid)'::regprocedure);
begin
  if position('snapto drip counts' in d) = 0 then
    d := regexp_replace(d, '(if v_n > 0 then\s+update intel\.ci_campaign_invite set invites_sent)',
      E'-- snapto drip counts: the WhatsApp join link goes through Snapto when the campaign has it on\n  if v_n = 0 and i.phone_e164 is not null and private.snapto_campaign_on(i.campaign_id)\n     and not exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null) then v_n := 1; end if;\n  \\1');
    if position('snapto drip counts' in d) = 0 then raise exception 'ci_send_bulk_invite: patch point not found'; end if;
    execute d;
  end if;
end $mig$;

-- 2) Stuck creators: once an hour (10am–8pm IST), in live campaigns with WhatsApp on, a creator who is on a
--    step where THEY must act but whose drip for that step never started gets that step's message once
--    (same path as the team "send step" button → Snapto drip, which then does its own follow-ups).
--    Unregistered creators who never got a Snapto join link get it once. Drips already started are never
--    restarted; completed / rejected / deleted creators are never touched.
create or replace function private.ci_stuck_drip_sweep(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r record; v_p int := 0; v_i int := 0; v_list jsonb := '[]'::jsonb;
begin
  if not p_dry and extract(hour from now() at time zone 'Asia/Kolkata') not between 10 and 19 then
    return jsonb_build_object('skipped', 'quiet hours');
  end if;
  if not intel.ci_feature_enabled('operational_pilot') then return jsonb_build_object('skipped', 'off'); end if;

  for r in
    with m(stage, key, drips) as (values
      ('contract_sent',    'contract_sent',    array['10']),
      ('contract_signed',  'confirm_address',  array['12']),
      ('product_sent',     'product_shipped',  array['07']),
      ('content_created',  'video_due',        array['08','09']),
      ('content_approved', 'content_approved', array['13'])),
    c as (select campaign_id, name from intel.ci_campaign
           where lifecycle_status = 'in_execution' and private.snapto_campaign_on(campaign_id))
    select p.participation_id, p.campaign_id, c.name cname, m.key, intel.ci_member_of_identity(p.identity_id) mem
      from intel.ci_campaign_participation p join c using (campaign_id) join m on m.stage = p.stage
     where p.updated_at < now() - interval '30 minutes'
       and not exists (select 1 from private.snapto_drip_queue q
                        where q.kind = 'start' and q.drip = any (m.drips)
                          and q.dedupe like 'start:' || q.drip || ':' || p.participation_id || '%')
     limit 50
  loop
    continue when r.mem is null;
    if not p_dry then
      perform intel.ci_notify(r.mem, r.campaign_id, r.participation_id, r.key,
        jsonb_build_object('campaign', coalesce(r.cname, 'your campaign'), 'participation_id', r.participation_id::text));
    end if;
    v_p := v_p + 1;
    v_list := v_list || jsonb_build_object('participation', r.participation_id, 'step', r.key);
  end loop;

  for r in
    select i.invite_id from intel.ci_campaign_invite i join intel.ci_campaign c using (campaign_id)
     where c.lifecycle_status = 'in_execution' and private.snapto_campaign_on(c.campaign_id)
       and i.claimed_at is null and i.participation_id is null and i.phone_e164 is not null
       and intel.ci_bulk_rank(coalesce(i.status, 'registered')) between 1 and 12
       and (i.last_invited_at is null or i.last_invited_at < now() - interval '2 hours')
       and not exists (select 1 from private.snapto_drip_queue q
                        where q.kind = 'start' and q.drip = '01' and q.dedupe like 'start:01:' || i.invite_id || '%')
       and not exists (select 1 from public.members mm where mm.whatsapp_e164 = i.phone_e164)
       and not exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164
                        and (w.opt_out_at is not null or w.user_id is not null))
     limit 50
  loop
    if not p_dry then
      -- the invite trigger turns a fresh last_invited_at into the Snapto join drip
      update intel.ci_campaign_invite set last_invited_at = now(), invites_sent = invites_sent + 1 where invite_id = r.invite_id;
    end if;
    v_i := v_i + 1;
    v_list := v_list || jsonb_build_object('invite', r.invite_id, 'step', 'join_link');
  end loop;

  return jsonb_build_object('dry', p_dry, 'steps', v_p, 'join_links', v_i, 'items', v_list);
end $fn$;
revoke all on function private.ci_stuck_drip_sweep(boolean) from public, anon, authenticated;

select cron.schedule('ci-stuck-drips', '7 * * * *', 'select private.ci_stuck_drip_sweep()');
