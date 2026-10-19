-- The team can put ANY creator on ANY later step by hand — from the campaign page, the Barter board or the creator's
-- story — whether the creator did it in the app or not:
--   • every step in between is filled in for them (contract signed offline, address, courier…), quietly
--   • the creator gets ONE message for the step they land on (can be switched off)
--   • a video link given by the team becomes the creator's submitted video (they see it in My Campaigns)
--   • an Instagram post link given by the team is recorded as their post — the campaign then completes
--   • courier + tracking given by the team go on the shipment
-- Creators who aren't registered yet are moved on their invite (api.bulk_set_status) and land on that step when they join.
-- ADDITIVE: one new function.
create or replace function api.team_set_step(p_participation uuid, p_status text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p intel.ci_campaign_participation%rowtype; v_st text := intel.ci_bulk_status(p_status); v_inv uuid; v_mid uuid;
        v_handle text; v_stage text; v_video text := btrim(coalesce(p_payload->>'video_url', ''));
        v_post text := btrim(coalesce(p_payload->>'post_url', '')); v_del uuid; v_notify boolean := coalesce((p_payload->>'notify')::boolean, true);
        v_rank_now int; v_rank_to int;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or not intel.ci_can_manage_participation(p_participation) then
    raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_st is null then raise exception 'unknown step "%"', p_status using errcode = '22023'; end if;
  if p.stage in ('rejected','dropped','ineligible','brand_declined') then
    raise exception 'this creator was % — they can''t be moved on', replace(p.stage, '_', ' ') using errcode = '22023'; end if;
  -- where they are now, on the same 13-step scale as the sheet
  v_rank_now := case p.stage when 'invited' then 1 when 'shortlisted' then 1 when 'applied' then 1 when 'eligible' then 2
      when 'sent_to_brand' then 3 when 'brand_confirmed' then 4 when 'accepted' then 4 when 'contract_sent' then 5
      when 'contract_signed' then 6 when 'address_confirmed' then 7 when 'product_sent' then 8 when 'content_created' then 10
      when 'changes_requested' then 10 when 'content_submitted' then 11 when 'content_approved' then 12 else 13 end;
  v_rank_to := intel.ci_bulk_rank(v_st);
  if v_rank_to < v_rank_now then
    raise exception 'steps only move forward — they are already on a later step' using errcode = '22023'; end if;
  if v_video <> '' and v_video !~* '^https?://' then raise exception 'the video link must start with https://' using errcode = '22023'; end if;
  v_mid := intel.ci_member_of_identity(p.identity_id);

  -- the invite row carries the step (bulk upload rows already have one; others get one now)
  select invite_id into v_inv from intel.ci_campaign_invite where participation_id = p_participation limit 1;
  if v_inv is null then
    v_handle := lower(coalesce(nullif(regexp_replace(coalesce(p.applied_profile, ''), '[^A-Za-z0-9._]', '', 'g'), ''),
                 (select regexp_replace(coalesce(sa.username, ''), '[^A-Za-z0-9._]', '', 'g') from public.social_accounts sa where sa.member_id = v_mid and sa.platform = 'instagram' limit 1),
                 'creator.' || left(replace(p_participation::text, '-', ''), 12)));
    select invite_id into v_inv from intel.ci_campaign_invite where campaign_id = p.campaign_id and platform = 'instagram' and lower(handle) = v_handle;
    if v_inv is null then
      insert into intel.ci_campaign_invite(campaign_id, platform, handle, source, status, approved, claimed_by, claimed_at, reserved_by,
                                           participation_id, invited_by, status_messaged)
      values (p.campaign_id, 'instagram', v_handle, 'manual', v_st, intel.ci_bulk_rank(v_st) >= 4, v_mid, now(), v_mid,
              p_participation, auth.uid(), case when v_notify then null else v_st end)
      returning invite_id into v_inv;
    else
      update intel.ci_campaign_invite set participation_id = coalesce(participation_id, p_participation), claimed_by = coalesce(claimed_by, v_mid),
             claimed_at = coalesce(claimed_at, now()) where invite_id = v_inv;
    end if;
  end if;
  update intel.ci_campaign_invite set status = v_st, approved = intel.ci_bulk_rank(v_st) >= 4,
         courier = coalesce(nullif(btrim(p_payload->>'courier'), ''), courier),
         tracking_ref = coalesce(nullif(btrim(p_payload->>'tracking'), ''), tracking_ref),
         tracking_url = coalesce(nullif(btrim(p_payload->>'tracking_url'), ''), tracking_url)
   where invite_id = v_inv;

  -- walk them there (quiet), then one message for where they land
  v_stage := intel.ci_bulk_fastforward(p_participation, v_inv, auth.uid(), v_notify);

  -- the team's video link = the creator's submitted video
  if v_video <> '' then
    select deliverable_id into v_del from intel.ci_campaign_deliverable where participation_id = p_participation order by created_at limit 1;
    if v_del is null then
      insert into intel.ci_campaign_deliverable(participation_id, content_format, quantity, status)
      values (p_participation, 'reel', 1, 'submitted') returning deliverable_id into v_del;
    end if;
    if not exists (select 1 from intel.ci_campaign_submission s where s.deliverable_id = v_del and s.content_url = v_video) then
      insert into intel.ci_campaign_submission(deliverable_id, content_url, note, status, submitted_at)
      values (v_del, v_video, 'added by the team', 'submitted', now());
      update intel.ci_campaign_deliverable set status = case when status in ('expected','missed') then 'submitted' else status end, updated_at = now()
       where deliverable_id = v_del;
    end if;
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
      values (p.campaign_id, p_participation, 'submission', null, 'submitted', auth.uid(), 'video link added by the team');
  end if;

  -- the team's Instagram link = their post (completes the campaign)
  if v_post <> '' then
    perform api.bp_add_post_link(p_participation, jsonb_build_object('permalink', v_post, 'media_type', coalesce(p_payload->>'media_type', 'reel')));
  end if;

  return jsonb_build_object('stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation), 'status', v_st);
end $$;
revoke all on function api.team_set_step(uuid, text, jsonb) from public, anon;
grant execute on function api.team_set_step(uuid, text, jsonb) to authenticated;
