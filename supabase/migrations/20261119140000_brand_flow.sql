-- Brand flow (19 Nov 2026)
-- 1) Brand activity shows who decided: the brand's own login ("you") or the Geek team / automatic ("geek").
do $x$ declare d text := pg_get_functiondef('api.brand_campaign(uuid)'::regprocedure); o text; begin
  if position('''by'', case when e.actor_member_id' in d) > 0 then return; end if;
  o := $o$'creator', intel.ci_brand_card(p.identity_id, p.applied_profile)->>'name') order by e.at desc)$o$;
  if position(o in d) = 0 then raise exception 'timeline anchor not found'; end if;
  d := replace(d, o, $n$'creator', intel.ci_brand_card(p.identity_id, p.applied_profile)->>'name',
                   -- who decided: the brand's own login ("you") or the Geek team / automatic ("geek")
                   'by', case when e.actor_member_id is not null and not exists (select 1 from intel.ci_agency_operator ao where ao.member_id = e.actor_member_id and ao.active)
                                   and not exists (select 1 from public.platform_admins pa where pa.user_id = e.actor_member_id) then 'you' else 'geek' end) order by e.at desc)$n$);
  execute d;
end $x$;

-- 2) brand_portal: applicant counts only for campaigns still running, plus how many wait for Geek's screening.
--    brand_campaign: no "N applied" banner on a finished campaign.
do $x$ declare d text; o text; begin
  d := pg_get_functiondef('api.brand_portal(uuid)'::regprocedure);
  if position('''screening''' in d) = 0 then
    o := $o$jsonb_build_object('applied', x.applied, 'shared', x.shared))$o$;
    if position(o in d) = 0 then raise exception 'portal anchor 1'; end if;
    d := replace(d, o, $n$jsonb_build_object('applied', x.applied, 'shared', x.shared, 'screening', x.screening))$n$);
    o := $o$count(*) filter (where p.stage = 'sent_to_brand') shared$o$;
    if position(o in d) = 0 then raise exception 'portal anchor 2'; end if;
    d := replace(d, o, o || $n$, count(*) filter (where p.stage in ('applied','eligible')) screening$n$);
    o := $o$where c.brand_id = any(v_ids) group by c.campaign_id) x)$o$;
    if position(o in d) = 0 then raise exception 'portal anchor 3'; end if;
    d := replace(d, o, $n$where c.brand_id = any(v_ids) and c.lifecycle_status is distinct from 'completed' group by c.campaign_id) x)$n$);
    execute d;
  end if;
  d := pg_get_functiondef('api.brand_campaign(uuid)'::regprocedure);
  o := $o$'applied_count', (select count(*) from intel.ci_campaign_participation p where p.campaign_id = v_id and p.stage not in ('invited','shortlisted')),$o$;
  if position(o in d) > 0 then
    d := replace(d, o, $n$'applied_count', (select count(*) from intel.ci_campaign_participation p where p.campaign_id = v_id and p.stage not in ('invited','shortlisted')
                         and (select cx.lifecycle_status from intel.ci_campaign cx where cx.campaign_id = v_id) is distinct from 'completed'),$n$);
    execute d;
  end if;
end $x$;

-- 3) engagement = median post (likes + comments) / followers — one viral post no longer gives 1000%
do $x$
declare r record; d text;
  o text := $o$avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))$o$;
  nw text := $n$(percentile_cont(0.5) within group (order by coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0)))::numeric$n$;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('api','intel') and p.proname in ('creator_search_base','ci_public_creator_card','ci_public_creator_card_v1','discover_creators','campaign_matches','ci_eligibility')
              and position(o in p.prosrc) > 0 loop
    d := replace(pg_get_functiondef(r.oid), o, nw);
    execute d;
  end loop;
end $x$;

-- 4) discovery: engagement above 100% is bad data (e.g. followers read as 31 instead of 31K) → unknown, never on top
do $x$ declare d text := pg_get_functiondef('api.creator_search_base(jsonb,integer,integer,uuid)'::regprocedure); o text; begin
  o := $o$e.followers::bigint, e.engagement, e.avg_likes$o$;
  if position(o in d) > 0 then d := replace(d, o, $n$e.followers::bigint, case when e.engagement <= 100 then e.engagement end, e.avg_likes$n$); end if;
  o := $o$sa.followers_count::bigint followers, x.eng engagement$o$;
  if position(o in d) > 0 then d := replace(d, o, $n$sa.followers_count::bigint followers, case when x.eng <= 100 then x.eng end engagement$n$); end if;
  execute d;
end $x$;

-- 5) an "action needed" alert about a creator is done once that creator's step moves on after the alert
create or replace function intel.ci_notif_settle_tg() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.entity = 'participation' and NEW.participation_id is not null then
    update intel.ci_notification n set acted_at = now(), read_at = coalesce(n.read_at, now())
     where n.participation_id = NEW.participation_id and n.kind = 'action_required' and n.acted_at is null and n.created_at < NEW.at;
  end if;
  return null;
exception when others then
  raise warning 'ci_notif_settle_tg: %', sqlerrm;
  return null;
end $$;
drop trigger if exists zz_notif_settle on intel.ci_campaign_event;
create trigger zz_notif_settle after insert on intel.ci_campaign_event for each row execute function intel.ci_notif_settle_tg();
update intel.ci_notification n set acted_at = now(), read_at = coalesce(n.read_at, now())
 where n.kind = 'action_required' and n.acted_at is null and n.participation_id is not null
   and exists (select 1 from intel.ci_campaign_event e where e.participation_id = n.participation_id and e.entity = 'participation' and e.at > n.created_at);

-- brand "video ready for review" alert is done once that video is no longer waiting
create or replace function intel.ci_notif_settle_stage_tg() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.stage is distinct from OLD.stage and NEW.stage <> 'content_submitted' then
    update intel.ci_notification n set acted_at = now(), read_at = coalesce(n.read_at, now())
     where n.participation_id = NEW.participation_id and n.dedupe_key like 'brand:video:%' and n.acted_at is null;
  end if;
  return null;
exception when others then
  raise warning 'ci_notif_settle_stage_tg: %', sqlerrm;
  return null;
end $$;
drop trigger if exists zz_notif_settle_stage on intel.ci_campaign_participation;
create trigger zz_notif_settle_stage after update of stage on intel.ci_campaign_participation for each row execute function intel.ci_notif_settle_stage_tg();
update intel.ci_notification n set acted_at = now(), read_at = coalesce(n.read_at, now())
  from intel.ci_campaign_participation p
 where p.participation_id = n.participation_id and n.dedupe_key like 'brand:video:%' and n.acted_at is null and p.stage <> 'content_submitted';
