-- Moving a participation to the stage it is already at is a no-op, not an error.
-- Since "posting completes the campaign" (20261017030000) a published post moves the creator to `completed`
-- on its own, so the team's own "Completed" click (or a double click) right after publishing hit
-- "illegal transition completed -> completed". Same stage → return it unchanged, no extra event.
-- ADDITIVE: same signature, same checks.
create or replace function api.advance_participation(p_participation uuid, p_to text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_now text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode='42501'; end if;
  select stage into v_now from intel.ci_campaign_participation where participation_id = p_participation;
  if v_now is not null and v_now = p_to then return jsonb_build_object('stage', v_now, 'unchanged', true); end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation, p_to, auth.uid(), p_reason));
end $$;
