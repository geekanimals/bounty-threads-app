-- "💬 WhatsApp to selected" preview (old app's "Each creator's own step" groups): what WOULD go to the picked creators —
-- how many get which new Utility drip, and who is left out and why. Sends nothing. Same step → drip rules as
-- api.snapto_send_current_step.
create or replace function api.snapto_preview_current_step(p_campaign uuid, p_invites uuid[] default '{}', p_parts uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_camp uuid; r record; v_drip text; v_ship text; v_due timestamptz; v_days int; v_first text;
        v_groups jsonb := '{}'; v_skip jsonb := '[]';
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_camp := intel.ci_resolve_campaign(p_campaign);
  if v_camp is null or not intel.ci_can_manage_campaign(v_camp) then raise exception 'not your campaign' using errcode = '42501'; end if;

  for r in select i.* from intel.ci_campaign_invite i where i.invite_id = any(coalesce(p_invites, '{}')) and i.campaign_id = v_camp loop
    if r.claimed_at is not null then v_skip := v_skip || jsonb_build_object('who', coalesce(r.full_name, r.handle), 'why', 'already joined');
    elsif nullif(btrim(coalesce(r.phone_e164, '')), '') is null then v_skip := v_skip || jsonb_build_object('who', coalesce(r.full_name, r.handle), 'why', 'no WhatsApp number');
    elsif exists (select 1 from private.snapto_drip_queue q where q.dedupe like 'start:01:' || r.invite_id || '%' and q.created_at > now() - interval '2 hours') then
      v_skip := v_skip || jsonb_build_object('who', coalesce(r.full_name, r.handle), 'why', 'invite sent in the last 2 hours');
    else v_groups := jsonb_set(v_groups, '{01}', to_jsonb(coalesce((v_groups->>'01')::int, 0) + 1)); end if;
  end loop;

  for r in select p.participation_id, p.identity_id, p.stage, p.blocked_at from intel.ci_campaign_participation p
            where p.participation_id = any(coalesce(p_parts, '{}')) and p.campaign_id = v_camp loop
    v_first := coalesce(nullif(private.snapto_first_name(intel.ci_member_of_identity(r.identity_id)), ''), 'creator');
    v_drip := null;
    select s.status into v_ship from intel.ci_campaign_shipment s where s.participation_id = r.participation_id order by s.created_at desc limit 1;
    if r.stage = 'contract_sent' then v_drip := '10';
    elsif r.stage = 'contract_signed' then v_drip := '12';
    elsif r.stage = 'product_sent' and coalesce(v_ship, '') <> 'delivered' then v_drip := '07';
    elsif r.stage in ('product_sent', 'content_created', 'changes_requested') then
      select min(d.expected_by) into v_due from intel.ci_campaign_deliverable d where d.participation_id = r.participation_id;
      if v_due is null then
        select k.content_days into v_days from intel.ci_campaign_contract k where k.participation_id = r.participation_id order by k.issued_at desc nulls last limit 1;
        v_due := now() + make_interval(days => coalesce(v_days, 3));
      end if;
      v_drip := case when v_due < now() then '09' else '08' end;
    elsif r.stage in ('content_approved', 'published') then v_drip := '13';
    elsif r.stage = 'completed' then v_drip := '14';
    end if;
    if v_drip is null then v_skip := v_skip || jsonb_build_object('who', v_first, 'why', 'no message for the step “' || replace(r.stage, '_', ' ') || '”');
    elsif r.blocked_at is not null and v_drip <> '09' then v_skip := v_skip || jsonb_build_object('who', v_first, 'why', 'blocked');
    elsif exists (select 1 from private.snapto_drip_queue q where q.dedupe like 'start:' || v_drip || ':' || r.participation_id || '%' and q.created_at > now() - interval '2 hours') then
      v_skip := v_skip || jsonb_build_object('who', v_first, 'why', 'this message went in the last 2 hours');
    else v_groups := jsonb_set(v_groups, array[v_drip], to_jsonb(coalesce((v_groups->>v_drip)::int, 0) + 1)); end if;
  end loop;

  return jsonb_build_object('groups', v_groups, 'skipped', v_skip);
end $$;
revoke all on function api.snapto_preview_current_step(uuid, uuid[], uuid[]) from public, anon;
grant execute on function api.snapto_preview_current_step(uuid, uuid[], uuid[]) to authenticated;
