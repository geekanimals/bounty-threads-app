-- 🎟️ Code flow fixes (end-to-end review):
-- 1) a sheet creator's code sits on their invite link; when they join and a campaign link was already made for them
--    (e.g. they opened the app first), the code stayed behind on the old link → copy it onto their campaign link.
-- 2) ci_brief_code: their link exists but has no code yet → look again after moving the sheet link's code.
-- 3) WhatsApp panel targets: a creator on the campaign whose code is still on their sheet link gets it too.
-- ADDITIVE.

do $$ declare d text; n text; begin
  d := pg_get_functiondef('intel.ci_track_ensure(uuid)'::regprocedure);
  if position('carry the sheet code' in d) > 0 then raise notice 'ci_track_ensure: already patched'; return; end if;
  n := replace(d, 'update intel.ci_track_link l set participation_id = i.participation_id, invite_id = null',
$x$-- carry the sheet code: they joined but already had a campaign link — the code on their invite link goes onto it
  update intel.ci_track_link pl set code = il.code, updated_at = now()
    from intel.ci_track_link il join intel.ci_campaign_invite i on i.invite_id = il.invite_id
   where i.campaign_id = p_campaign and i.participation_id is not null and pl.participation_id = i.participation_id
     and pl.code is null and il.code is not null;
  update intel.ci_track_link l set participation_id = i.participation_id, invite_id = null$x$);
  if n = d then raise exception 'ci_track_ensure anchor not found'; end if;
  execute n;
end $$;

create or replace function intel.ci_brief_code(p_participation uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; cfg jsonb; l intel.ci_track_link%rowtype;
begin
  select campaign_id into v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_camp is null then return null; end if;
  cfg := intel.ci_track_cfg(v_camp);
  if coalesce(cfg->>'say_code', '') <> 'true' or coalesce(cfg->>'mode', 'none') = 'none' then return null; end if;
  select * into l from intel.ci_track_link where participation_id = p_participation;
  if l.link_id is null or l.code is null then
    begin perform intel.ci_track_ensure(v_camp); exception when others then null; end;   -- makes / moves their link + code
    select * into l from intel.ci_track_link where participation_id = p_participation;
  end if;
  return nullif(btrim(coalesce(l.code, case when cfg->>'mode' in ('common','per_creator') then upper(btrim(cfg->>'common_code')) end, '')), '');
end $$;
revoke all on function intel.ci_brief_code(uuid) from public, anon, authenticated;

do $$ declare d text; n text; begin
  d := pg_get_functiondef('api.campaign_wa_targets(uuid,uuid[],uuid[])'::regprocedure);
  if position('il.invite_id = i2.invite_id' in d) > 0 then raise notice 'targets: already patched'; return; end if;
  n := replace(d, $a$'code', nullif(btrim(coalesce((select l.code from intel.ci_track_link l where l.participation_id = p.participation_id),$a$,
                  $a$'code', nullif(btrim(coalesce((select l.code from intel.ci_track_link l where l.participation_id = p.participation_id),
                         (select il.code from intel.ci_track_link il join intel.ci_campaign_invite i2 on il.invite_id = i2.invite_id
                           where i2.participation_id = p.participation_id and il.code is not null limit 1),$a$);
  if n = d then raise exception 'targets anchor not found'; end if;
  execute n;
end $$;

-- 4) the same message twice in one go: when a sheet creator joins, the step events and the step fast-forward both
--    asked for "their step's message" → two WhatsApps + two emails. One message per step per creator per transaction.
do $$ declare d text; n text; begin
  d := pg_get_functiondef('intel.ci_notify(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  if position('one message per step per go' in d) > 0 then raise notice 'ci_notify: dedupe already in'; return; end if;
  n := replace(d, '  insert into intel.ci_notification(recipient_member_id, campaign_id, participation_id, kind, title, body, action_route, action_label, dedupe_key)',
$x$  -- one message per step per go: the same step message already made in this transaction is not made again
  select n0.notification_id into v_nid from intel.ci_notification n0
   where n0.dedupe_key = v_dedupe and n0.recipient_member_id = p_recipient and n0.created_at = now() limit 1;
  if v_nid is not null then return v_nid; end if;
  insert into intel.ci_notification(recipient_member_id, campaign_id, participation_id, kind, title, body, action_route, action_label, dedupe_key)$x$);
  if n = d then raise exception 'ci_notify insert anchor not found'; end if;
  execute n;
end $$;
