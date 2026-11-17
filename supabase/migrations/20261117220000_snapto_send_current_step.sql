-- "💬 WhatsApp to selected" (Creators tab): instead of the old geek_* templates, each picked creator gets the NEW
-- Utility message for the step they are on right now (one drip, through Snapto). Not registered yet → invite drip 01.
-- Steps without a message (applied, waiting, address confirmed …) are skipped and reported. Same drip for the same
-- creator not again within 2 hours (double clicks). The send-time check (snapto_start_valid) still applies.

create or replace function api.snapto_send_current_step(p_campaign uuid, p_invites uuid[] default '{}', p_parts uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_cname text; r record; v_drip text; v_attrs jsonb; v_member uuid; v_first text; v_pid text;
        v_queued int := 0; v_skip jsonb := '[]'; v_addr text; v_courier text; v_track text; v_ship text; v_due timestamptz; v_days int;
        v_stamp text := extract(epoch from now())::bigint::text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_camp := intel.ci_resolve_campaign(p_campaign);
  select c.name into v_cname from intel.ci_campaign c where c.campaign_id = v_camp;
  if v_camp is null or not intel.ci_can_manage_campaign(v_camp) then raise exception 'not your campaign' using errcode = '42501'; end if;
  v_cname := coalesce(v_cname, 'your campaign');

  -- not registered yet → invite drip
  for r in select i.* from intel.ci_campaign_invite i where i.invite_id = any(coalesce(p_invites, '{}')) and i.campaign_id = v_camp loop
    if r.claimed_at is not null then v_skip := v_skip || jsonb_build_object('who', coalesce(r.full_name, r.handle), 'why', 'already joined'); continue; end if;
    if nullif(btrim(coalesce(r.phone_e164, '')), '') is null then v_skip := v_skip || jsonb_build_object('who', coalesce(r.full_name, r.handle), 'why', 'no WhatsApp number'); continue; end if;
    if exists (select 1 from private.snapto_drip_queue q where q.dedupe like 'start:01:' || r.invite_id || '%' and q.created_at > now() - interval '2 hours') then
      v_skip := v_skip || jsonb_build_object('who', coalesce(r.full_name, r.handle), 'why', 'invite sent in the last 2 hours'); continue;
    end if;
    perform private.snapto_enqueue_phone('start', '01', r.phone_e164,
      jsonb_build_object('creator_name', left(coalesce(nullif(split_part(btrim(coalesce(r.full_name, '')), ' ', 1), ''), 'there'), 40),
                         'campaign_name', v_cname,
                         'invite_path', case when r.token is not null then 'login?cinv=' || r.token::text else 'login' end),
      'start:01:' || r.invite_id || ':m' || v_stamp);
    if exists (select 1 from private.snapto_drip_queue q where q.dedupe = 'start:01:' || r.invite_id || ':m' || v_stamp) then v_queued := v_queued + 1;
    else v_skip := v_skip || jsonb_build_object('who', coalesce(r.full_name, r.handle), 'why', 'said STOP, or WhatsApp reminders are off'); end if;
  end loop;

  -- on the campaign → the message of their current step
  for r in select p.participation_id, p.identity_id, p.stage, p.blocked_at from intel.ci_campaign_participation p
            where p.participation_id = any(coalesce(p_parts, '{}')) and p.campaign_id = v_camp loop
    v_member := intel.ci_member_of_identity(r.identity_id);
    v_first := coalesce(nullif(private.snapto_first_name(v_member), ''), 'there');
    v_pid := r.participation_id::text;
    v_drip := null; v_attrs := null;
    select s.status, s.courier, s.tracking_ref into v_ship, v_courier, v_track from intel.ci_campaign_shipment s
     where s.participation_id = r.participation_id order by s.created_at desc limit 1;

    if r.stage = 'contract_sent' then
      v_drip := '10'; v_attrs := jsonb_build_object('campaign_name', v_cname, 'agreement_path', v_pid || '/agreement');
    elsif r.stage = 'contract_signed' then
      select concat_ws(', ', nullif(a.line1, ''), nullif(a.line2, ''), nullif(a.landmark, ''), nullif(a.city, ''), nullif(a.state, ''), nullif(a.postal_code, ''))
        into v_addr from private.creator_address a where a.identity_id = r.identity_id and a.deleted_at is null order by a.is_default desc, a.updated_at desc limit 1;
      v_drip := '12'; v_attrs := jsonb_build_object('campaign_name', v_cname, 'delivery_address', coalesce(nullif(v_addr, ''), 'not added yet'), 'address_path', v_pid || '/address');
    elsif r.stage = 'product_sent' and coalesce(v_ship, '') <> 'delivered' then
      v_drip := '07'; v_attrs := jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname,
        'courier', coalesce(nullif(btrim(v_courier), ''), 'our courier partner'), 'tracking_id', coalesce(nullif(btrim(v_track), ''), 'on your campaign page'),
        'campaign_path', v_pid || '/package');
    elsif r.stage in ('product_sent', 'content_created', 'changes_requested') then
      select min(d.expected_by) into v_due from intel.ci_campaign_deliverable d where d.participation_id = r.participation_id;
      if v_due is null then
        select k.content_days into v_days from intel.ci_campaign_contract k where k.participation_id = r.participation_id order by k.issued_at desc nulls last limit 1;
        v_due := now() + make_interval(days => coalesce(v_days, 3));
      end if;
      v_drip := case when v_due < now() then '09' else '08' end;
      v_attrs := jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname, 'due_date', private.snapto_day(v_due),
        'campaign_path', v_pid || case when r.stage = 'product_sent' then '/package' else '/draft' end);
    elsif r.stage in ('content_approved', 'published') then
      v_drip := '13'; v_attrs := jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname, 'campaign_path', v_pid || '/post');
    elsif r.stage = 'completed' then
      v_drip := '14'; v_attrs := jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname, 'campaign_path', v_pid);
    end if;

    if v_drip is null then
      v_skip := v_skip || jsonb_build_object('who', v_first, 'why', 'no message for the step “' || replace(r.stage, '_', ' ') || '”'); continue;
    end if;
    if r.blocked_at is not null and v_drip <> '09' then
      v_skip := v_skip || jsonb_build_object('who', v_first, 'why', 'blocked'); continue;
    end if;
    if exists (select 1 from private.snapto_drip_queue q where q.dedupe like 'start:' || v_drip || ':' || v_pid || '%' and q.created_at > now() - interval '2 hours') then
      v_skip := v_skip || jsonb_build_object('who', v_first, 'why', 'this message went in the last 2 hours'); continue;
    end if;
    perform private.snapto_enqueue('start', v_drip, v_member, v_attrs, 'start:' || v_drip || ':' || v_pid || ':m' || v_stamp);
    if exists (select 1 from private.snapto_drip_queue q where q.dedupe = 'start:' || v_drip || ':' || v_pid || ':m' || v_stamp) then v_queued := v_queued + 1;
    else v_skip := v_skip || jsonb_build_object('who', v_first, 'why', 'no WhatsApp number, said STOP, or WhatsApp reminders are off'); end if;
  end loop;

  return jsonb_build_object('queued', v_queued, 'skipped', v_skip);
end $$;
revoke all on function api.snapto_send_current_step(uuid, uuid[], uuid[]) from public, anon;
grant execute on function api.snapto_send_current_step(uuid, uuid[], uuid[]) to authenticated;
