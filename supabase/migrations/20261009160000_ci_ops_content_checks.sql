-- Phase 5 (barter pipeline) — video-vs-brief + caption/tag checks. ADDITIVE + DARK.
-- Caption/tag compliance is deterministic (brief-required hashtags/mentions must appear in the caption).
-- Brief-adherence ("does the video match the brief") is an AI review written by the ops-content-review edge
-- function (Claude) into the same table. Operators/owners read the results; the creator gets a fix-it push
-- when the caption is missing required tags. Gated by operational_pilot. No PII; nothing activated.

create table if not exists intel.ci_content_check (
  check_id         uuid primary key default gen_random_uuid(),
  participation_id uuid not null references intel.ci_campaign_participation(participation_id) on delete cascade,
  campaign_id      uuid references intel.ci_campaign(campaign_id) on delete cascade,
  subject_kind     text not null check (subject_kind in ('submission','post')),
  subject_id       uuid,                 -- submission_id or post_id (no FK: decoupled across phases)
  kind             text not null check (kind in ('caption_tags','brief_adherence')),
  verdict          text not null check (verdict in ('pass','issues','error')),
  findings         jsonb not null default '[]'::jsonb,
  model            text,                 -- AI model for brief_adherence; null for deterministic checks
  created_at       timestamptz not null default now()
);
create index if not exists ci_content_check_part_idx on intel.ci_content_check(participation_id, created_at desc);
alter table intel.ci_content_check enable row level security;   -- service-role write; read via api definer
revoke all on table intel.ci_content_check from anon, authenticated;
grant select, insert on table intel.ci_content_check to service_role;

-- deterministic caption/tag check against the campaign brief (requirements.hashtags / .mentions / .caption_must_include)
create or replace function intel.ci_check_caption_tags(p_participation uuid, p_subject_kind text, p_subject_id uuid, p_caption text, p_actor uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_req jsonb; v_missing jsonb := '[]'::jsonb; t text; v_cap text := lower(coalesce(p_caption,'')); v_verdict text; v_infl uuid;
begin
  v_camp := intel.ci_campaign_of_participation(p_participation);
  select requirements into v_req from intel.ci_campaign_brief where campaign_id=v_camp order by created_at desc limit 1;
  v_req := coalesce(v_req,'{}'::jsonb);
  for t in select value from jsonb_array_elements_text(coalesce(v_req->'hashtags','[]'::jsonb)) loop
    if position(lower(t) in v_cap)=0 then v_missing := v_missing || to_jsonb('Missing hashtag '||t); end if; end loop;
  for t in select value from jsonb_array_elements_text(coalesce(v_req->'mentions','[]'::jsonb)) loop
    if position(lower(t) in v_cap)=0 then v_missing := v_missing || to_jsonb('Missing mention '||t); end if; end loop;
  for t in select value from jsonb_array_elements_text(coalesce(v_req->'caption_must_include','[]'::jsonb)) loop
    if position(lower(t) in v_cap)=0 then v_missing := v_missing || to_jsonb('Caption must include "'||t||'"'); end if; end loop;
  v_verdict := case when jsonb_array_length(v_missing)=0 then 'pass' else 'issues' end;
  insert into intel.ci_content_check(participation_id, campaign_id, subject_kind, subject_id, kind, verdict, findings, model)
    values (p_participation, v_camp, p_subject_kind, p_subject_id, 'caption_tags', v_verdict, v_missing, null);
  if v_verdict='issues' then
    v_infl := intel.ci_member_of_identity((select identity_id from intel.ci_campaign_participation where participation_id=p_participation));
    perform intel.ci_notify(v_infl, v_camp, p_participation, 'caption_fix',
      jsonb_build_object('campaign', coalesce((select name from intel.ci_campaign where campaign_id=v_camp),'your campaign'), 'participation_id', p_participation::text));
  end if;
  return v_verdict;
end $$;
revoke all on function intel.ci_check_caption_tags(uuid,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function intel.ci_check_caption_tags(uuid,text,uuid,text,uuid) to service_role;

-- generic writer used by the AI reviewer (ops-content-review) to store a brief-adherence verdict
create or replace function intel.ci_record_content_check(p_participation uuid, p_subject_kind text, p_subject_id uuid, p_kind text, p_verdict text, p_findings jsonb, p_model text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into intel.ci_content_check(participation_id, campaign_id, subject_kind, subject_id, kind, verdict, findings, model)
    values (p_participation, intel.ci_campaign_of_participation(p_participation), p_subject_kind, p_subject_id, p_kind, p_verdict, coalesce(p_findings,'[]'::jsonb), p_model)
    returning check_id into v_id;
  return v_id;
end $$;
revoke all on function intel.ci_record_content_check(uuid,text,uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function intel.ci_record_content_check(uuid,text,uuid,text,text,jsonb,text) to service_role;

-- operator / owning-brand / owner-creator read of the checks for a participation
create or replace function api.get_content_checks(p_participation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_org uuid; v_camp uuid; v_camp_org uuid; v_owner uuid; v_me uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  select campaign_id, identity_id into v_camp, v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_camp is null then raise exception 'participation not found' using errcode='42501'; end if;
  select org_id into v_camp_org from intel.ci_campaign where campaign_id=v_camp;
  v_org := intel.ci_caller_org(); begin v_me := intel.ci_caller_identity(); exception when others then v_me := null; end;
  if not (intel.ci_is_agency_operator() or (v_org is not null and v_org=v_camp_org) or (v_me is not null and v_me=v_owner)) then
    raise exception 'not authorised' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind',k.kind,'verdict',k.verdict,'findings',k.findings,'model',k.model,'at',k.created_at) order by k.created_at desc)
    from intel.ci_content_check k where k.participation_id=p_participation), '[]'::jsonb);
end $$;
revoke all on function api.get_content_checks(uuid) from public, anon;
grant execute on function api.get_content_checks(uuid) to authenticated, service_role;

-- creator fix-it push when the caption is missing required tags
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('caption_fix','action_required','Fix your caption for {{campaign}}','Your caption is missing some required tags or mentions from the brief. Please update it in the app.','mycampaigns','Fix caption')
on conflict (template_key) do nothing;
