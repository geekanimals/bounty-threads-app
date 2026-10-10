-- Phase 6 (barter pipeline) — post from app → caption/tag check → 15-day analytics → live report. ADDITIVE + DARK.
-- The creator records the reel/story they posted; we run the caption/tag check and advance to 'published'.
-- ops-post-metrics-worker then snapshots each post's insights for 15 days. api.get_campaign_report is the
-- live brand-campaign dashboard feed (funnel counts + per-creator post + latest metrics + check verdicts).
-- Gated by operational_pilot. No PII; nothing activated.

create table if not exists intel.ci_campaign_post (
  post_id          uuid primary key default gen_random_uuid(),
  participation_id uuid not null references intel.ci_campaign_participation(participation_id) on delete cascade,
  campaign_id      uuid references intel.ci_campaign(campaign_id) on delete cascade,
  media_type       text not null check (media_type in ('reel','story','post','live')),
  permalink        text,
  caption          text,
  external_media_id text,
  posted_at        timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists ci_campaign_post_part_idx on intel.ci_campaign_post(participation_id);
create index if not exists ci_campaign_post_posted_idx on intel.ci_campaign_post(posted_at);
alter table intel.ci_campaign_post enable row level security;
revoke all on table intel.ci_campaign_post from anon, authenticated;
grant select, insert on table intel.ci_campaign_post to service_role;

-- per-post metric snapshots (one row per capture; append-only history over the 15-day window)
create table if not exists intel.ci_campaign_post_metric (
  metric_id   uuid primary key default gen_random_uuid(),
  post_id     uuid not null references intel.ci_campaign_post(post_id) on delete cascade,
  captured_at timestamptz not null default now(),
  reach       bigint, impressions bigint, likes bigint, comments bigint,
  shares      bigint, saves bigint, views bigint,
  raw         jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ci_post_metric_post_idx on intel.ci_campaign_post_metric(post_id, captured_at desc);
alter table intel.ci_campaign_post_metric enable row level security;
revoke all on table intel.ci_campaign_post_metric from anon, authenticated;
grant select, insert on table intel.ci_campaign_post_metric to service_role;

-- creator records a post made for the campaign; runs the caption/tag check and advances to published
create or replace function api.record_campaign_post(p_participation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_owner uuid; v_camp uuid; v_stage text; v_pid uuid; v_mt text; v_verdict text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  select identity_id, campaign_id, stage into v_owner, v_camp, v_stage from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your participation' using errcode='42501'; end if;
  v_mt := lower(coalesce(p_payload->>'media_type','reel'));
  if v_mt not in ('reel','story','post','live') then raise exception 'invalid media_type %', v_mt using errcode='22023'; end if;
  insert into intel.ci_campaign_post(participation_id, campaign_id, media_type, permalink, caption, external_media_id)
    values (p_participation, v_camp, v_mt, nullif(p_payload->>'permalink',''), nullif(p_payload->>'caption',''), nullif(p_payload->>'external_media_id',''))
    returning post_id into v_pid;
  v_verdict := intel.ci_check_caption_tags(p_participation, 'post', v_pid, p_payload->>'caption', v_uid);
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'submission', null, 'posted', v_uid, v_mt);
  if v_stage='content_approved' then perform intel.ci_participation_advance(p_participation, 'published', v_uid, 'posted from app'); end if;
  return jsonb_build_object('post_id', v_pid, 'caption_check', v_verdict);
end $$;
revoke all on function api.record_campaign_post(uuid,jsonb) from public, anon;
grant execute on function api.record_campaign_post(uuid,jsonb) to authenticated, service_role;

-- worker input: posts still inside their 15-day tracking window, least-recently captured first
create or replace function intel.ci_posts_to_track(p_limit int default 200)
returns table(post_id uuid, participation_id uuid, external_media_id text, media_type text)
language sql stable security definer set search_path = '' as $$
  select p.post_id, p.participation_id, p.external_media_id, p.media_type
  from intel.ci_campaign_post p
  where p.posted_at > now() - interval '15 days'
  order by (select max(m.captured_at) from intel.ci_campaign_post_metric m where m.post_id=p.post_id) asc nulls first
  limit greatest(p_limit,1)
$$;
revoke all on function intel.ci_posts_to_track(int) from public, anon, authenticated;
grant execute on function intel.ci_posts_to_track(int) to service_role;

-- metrics writer used by ops-post-metrics-worker
create or replace function intel.ci_record_post_metric(p_post uuid, p_metrics jsonb, p_actor uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into intel.ci_campaign_post_metric(post_id, reach, impressions, likes, comments, shares, saves, views, raw)
    values (p_post, nullif(p_metrics->>'reach','')::bigint, nullif(p_metrics->>'impressions','')::bigint, nullif(p_metrics->>'likes','')::bigint,
      nullif(p_metrics->>'comments','')::bigint, nullif(p_metrics->>'shares','')::bigint, nullif(p_metrics->>'saves','')::bigint, nullif(p_metrics->>'views','')::bigint, p_metrics)
    returning metric_id into v_id;
  return v_id;
end $$;
revoke all on function intel.ci_record_post_metric(uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function intel.ci_record_post_metric(uuid,jsonb,uuid) to service_role;

-- live brand-campaign report: funnel counts + per-creator post + latest metrics + check verdicts
create or replace function api.get_campaign_report(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_org uuid; v_camp_org uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  if not exists(select 1 from intel.ci_campaign where campaign_id=p_campaign) then raise exception 'campaign not found' using errcode='42501'; end if;
  select org_id into v_camp_org from intel.ci_campaign where campaign_id=p_campaign;
  v_org := intel.ci_caller_org();
  if not (intel.ci_is_agency_operator() or (v_org is not null and v_org=v_camp_org)) then
    raise exception 'not authorised to view this report' using errcode='42501'; end if;
  return jsonb_build_object(
    'funnel', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from intel.ci_campaign_participation where campaign_id=p_campaign group by stage) s),'{}'::jsonb),
    'creators', coalesce((select jsonb_agg(jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage,
        'posts', coalesce((select jsonb_agg(jsonb_build_object('media_type',po.media_type,'permalink',po.permalink,'posted_at',po.posted_at,
            'latest', (select jsonb_build_object('reach',m.reach,'likes',m.likes,'comments',m.comments,'views',m.views,'saves',m.saves,'at',m.captured_at)
                       from intel.ci_campaign_post_metric m where m.post_id=po.post_id order by m.captured_at desc limit 1))
            order by po.posted_at) from intel.ci_campaign_post po where po.participation_id=p.participation_id),'[]'::jsonb),
        'checks', coalesce((select jsonb_agg(jsonb_build_object('kind',k.kind,'verdict',k.verdict) order by k.created_at desc)
                   from intel.ci_content_check k where k.participation_id=p.participation_id),'[]'::jsonb))
        order by p.created_at)
      from intel.ci_campaign_participation p where p.campaign_id=p_campaign),'[]'::jsonb));
end $$;
revoke all on function api.get_campaign_report(uuid) from public, anon;
grant execute on function api.get_campaign_report(uuid) to authenticated, service_role;
