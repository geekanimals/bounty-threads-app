-- Barter flow v3 — what the creator and the team asked for after the first live run:
--   • contract: "post only after the brand approves the video" clause (unsigned contracts are refreshed)
--   • video reminders after the product arrives: day 2–3 once a day · day 4–6 twice a day (morning + evening,
--     warning tone) · day 7 → the creator is blocked and unlisted automatically; the team sees their number,
--     calls them, records the reason and unblocks with a new due date
--   • "request a new video link" — as many times as needed (link not opening, wrong file …)
--   • post auto-detected: the reel/story the creator posts on Instagram after approval is found in their feed,
--     recorded on the campaign and the caption checked — no link pasting
--   • done → the creator gives feedback → only then the campaign is complete for them (and their numbers show)
-- ADDITIVE.

-- ===================================================================================================
-- 0) new columns + templates
-- ===================================================================================================
alter table intel.ci_campaign_participation
  add column if not exists blocked_at            timestamptz,
  add column if not exists block_reason          text,
  add column if not exists call_note             text,
  add column if not exists call_at               timestamptz,
  add column if not exists call_by               uuid references auth.users(id) on delete set null,
  add column if not exists feedback_requested_at timestamptz,
  add column if not exists feedback              jsonb,
  add column if not exists feedback_at           timestamptz;
alter table intel.ci_creator_blacklist add column if not exists auto boolean not null default false;

insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('video_nudge','action_required','Reminder: your {{campaign}} video','Your product arrived — please shoot and submit your video in the app. Open the brief for exactly what to make.','mycampaigns','Submit video'),
  ('video_warning','action_required','⚠️ {{campaign}} video is overdue','Your video is overdue. Please submit it today — creators who take the product and don''t deliver are blacklisted from the platform and must re-ship the product at their own cost (see your contract).','mycampaigns','Submit now'),
  ('video_final_warning','action_required','⚠️ Final warning — {{campaign}} video','Submit your video now. If it isn''t in by tomorrow your account is blocked and removed from all campaigns, as per your signed contract.','mycampaigns','Submit now'),
  ('video_blocked','action_required','Your account is blocked — {{campaign}}','You received the product but didn''t submit your video within 7 days, so your account is blocked from campaigns. Our team will call you; you can also reply here.','mycampaigns','Open'),
  ('video_unblocked','action_required','You''re unblocked — {{campaign}}','Thanks for speaking with us. Your account is active again — please submit your video by the new due date in the app.','mycampaigns','Submit video'),
  ('block_alert_ops','action_required','Creator blocked — call needed ({{campaign}})','A creator didn''t submit their video within 7 days of delivery and was blocked. Call them, note the reason and unblock if they will deliver.','campaigns','Open process'),
  ('feedback_request','action_required','Share your feedback — {{campaign}}','Your campaign is done 🎉 Tell us how it went (takes 20 seconds) — your results open right after.','mycampaigns','Give feedback'),
  ('post_detected','info','We found your {{campaign}} post ✅','Your post is live and recorded on the campaign — we''re collecting its numbers now.','mycampaigns','View')
on conflict (template_key) do update set kind = excluded.kind, title = excluded.title, body_md = excluded.body_md,
  action_route = excluded.action_route, action_label = excluded.action_label;
update intel.ci_notification_template set
  title = 'Changes needed on your {{campaign}} video',
  body_md = 'The brand needs something changed — a fix to the video or a new link that opens for everyone. Open the app to see exactly what, then resubmit.'
 where template_key = 'changes_requested';
update intel.ci_notification_template set
  body_md = 'Your video is approved 🎉 Post it now from the app — your caption, hashtags and tags are filled in for you. We pick up the post automatically.'
 where template_key = 'content_approved';

-- ===================================================================================================
-- 1) contract: post only after approval
-- ===================================================================================================
create or replace function intel.ci_contract_clauses(p_terms jsonb, p_brand text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v jsonb := '[]'::jsonb; n int := coalesce(nullif(p_terms->>'ad_rights_months','')::int,1);
        d int := coalesce(nullif(p_terms->>'content_days','')::int,7); val text;
begin
  val := case when nullif(p_terms->>'product_value','') is not null then ' (worth ₹'||(p_terms->>'product_value')||')' else '' end;
  v := v || jsonb_build_array(jsonb_build_object('key','product','title','Product',
        'text', 'You will receive '||coalesce(p_terms->>'product','the product')||val||' from '||coalesce(p_brand,'the brand')
                ||' free of cost, in exchange for the content below. Once your content is posted, the product is yours to keep.'));
  v := v || jsonb_build_array(jsonb_build_object('key','deliverables','title','What you will make',
        'text', 'You will create and post: '||coalesce(p_terms->>'deliverables','1 Reel')
                ||', within '||d||' day'||case when d>1 then 's' else '' end||' of receiving the product, following the video brief shared in the app.'));
  v := v || jsonb_build_array(jsonb_build_object('key','approval','title','Post only after approval',
        'text', 'First submit your video in the app for review. You may post it on Instagram only after '||coalesce(p_brand,'the brand')
                ||' approves it in the app. Posting before approval, or posting a different cut, is a breach of this contract.'));
  v := v || jsonb_build_array(jsonb_build_object('key','asci','title','ASCI disclosure',
        'text', 'Every post must clearly disclose the collaboration as per the ASCI Guidelines for Influencer Advertising in Digital Media — '
                ||'use the "Paid partnership" label and/or #ad / #collab at the start of the caption. Do not make claims the brand has not approved.'));
  v := v || jsonb_build_array(jsonb_build_object('key','ad_rights','title','Ad rights',
        'text', coalesce(p_brand,'The brand')||' may use your content (organic and as paid ads, including whitelisting) for '||n||' month'
                ||case when n>1 then 's' else '' end||' from the date you post.'));
  if coalesce((p_terms->>'collab_rights')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','collab','title','Collab rights',
          'text', 'You will add '||coalesce(p_brand,'the brand')||' as an Instagram collaborator on the post so it also appears on their profile.'));
  end if;
  if coalesce((p_terms->>'blacklist_clause')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','non_delivery','title','If you don''t deliver — blacklist',
          'text', 'If you receive the product and do not submit your video within 7 days of delivery (we remind you on WhatsApp, email and in the app), '
                  ||'your account is blocked and removed from all campaigns on the Geek platform until you speak with our team.'));
  end if;
  if coalesce((p_terms->>'reship_clause')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','reship','title','Return / re-ship at your own cost',
          'text', 'In that case you must also send the product, at your own cost, to another creator nominated by Geek or '
                  ||coalesce(p_brand,'the brand')||', within 7 days of being asked, in the condition you received it.'));
  end if;
  if nullif(btrim(p_terms->>'extra_terms'),'') is not null then
    v := v || jsonb_build_array(jsonb_build_object('key','extra','title','Other terms','text', btrim(p_terms->>'extra_terms')));
  end if;
  return v;
end $$;

-- ===================================================================================================
-- 2) reminders after delivery: day 2–3 daily · day 4–6 morning + evening (warning) · day 7 → block
-- ===================================================================================================
create or replace function intel.ci_ist(p_day date, p_time time)
returns timestamptz language sql immutable set search_path = '' as $$ select (p_day + p_time) at time zone 'Asia/Kolkata' $$;

create or replace function intel.ci_schedule_video_reminders(p_participation uuid, p_from timestamptz default now())
returns int language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; d0 date := (p_from at time zone 'Asia/Kolkata')::date; v_n int := 0;
begin
  select campaign_id into v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_camp is null then return 0; end if;
  update intel.ci_reminder set cancelled_at = now()
   where participation_id = p_participation and fired_at is null and cancelled_at is null
     and (kind like 'video%' or kind = 'auto_block');
  insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, cancel_on_stage)
  select p_participation, v_camp, k, t, at, 'content_submitted' from (values
    ('video_day2', 'video_nudge',         intel.ci_ist(d0 + 1, '10:00')),
    ('video_day3', 'video_nudge',         intel.ci_ist(d0 + 2, '10:00')),
    ('video_day4am','video_warning',      intel.ci_ist(d0 + 3, '10:00')),
    ('video_day4pm','video_warning',      intel.ci_ist(d0 + 3, '18:30')),
    ('video_day5am','video_warning',      intel.ci_ist(d0 + 4, '10:00')),
    ('video_day5pm','video_warning',      intel.ci_ist(d0 + 4, '18:30')),
    ('video_day6am','video_final_warning',intel.ci_ist(d0 + 5, '10:00')),
    ('video_day6pm','video_final_warning',intel.ci_ist(d0 + 5, '18:30')),
    ('auto_block',  'video_blocked',      intel.ci_ist(d0 + 7, '10:00'))) v(k, t, at)
  where at > now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function intel.ci_schedule_video_reminders(uuid, timestamptz) from public, anon, authenticated;
grant execute on function intel.ci_schedule_video_reminders(uuid, timestamptz) to service_role;

-- block (day 7): blacklisted + unlisted, team alerted with the number to call
create or replace function intel.ci_block_for_no_video(p_participation uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare p record; v_handle text; v_org uuid; v_name text; v_who text;
begin
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or p.stage not in ('product_sent','content_created','changes_requested') or p.blocked_at is not null then return false; end if;
  select c.org_id, c.name into v_org, v_name from intel.ci_campaign c where c.campaign_id = p.campaign_id;
  select lower(sa.username) into v_handle from intel.ci_identity_actor_access a
    join public.social_accounts sa on sa.member_id = a.member_id and sa.platform = 'instagram'
   where a.identity_id = p.identity_id and a.access_role = 'self' and a.revoked_at is null limit 1;
  update intel.ci_campaign_participation set blocked_at = now(), block_reason = 'Video not submitted within 7 days of delivery'
   where participation_id = p_participation;
  insert into intel.ci_creator_blacklist(identity_id, handle, reason, campaign_id, org_id, added_by, auto)
  values (p.identity_id, v_handle, 'Auto: video not submitted within 7 days of delivery — ' || coalesce(v_name,'campaign'), p.campaign_id, v_org, null, true);
  v_who := coalesce('@' || v_handle, 'A creator');
  begin
    perform intel.ci_alert_org(v_org, 'Creator blocked — call ' || v_who, 'No video 7 days after delivery on ' || coalesce(v_name,'a campaign') || '. Call them, note the reason, unblock if they''ll deliver.', 'campaigns', 'Open process', 'action_required', null);
    perform intel.ci_alert_admins('Creator blocked: ' || v_who, 'No video 7 days after delivery — ' || coalesce(v_name,'campaign') || '.', 'admin:campaigns', 'View', 'action_required', null);
  exception when others then null; end;
  return true;
end $$;
revoke all on function intel.ci_block_for_no_video(uuid) from public, anon, authenticated;
grant execute on function intel.ci_block_for_no_video(uuid) to service_role;

create or replace function intel.ci_run_due_reminders(p_limit int default 200)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_identity uuid; v_infl uuid; v_name text; v_stage text; v_oper uuid; v_n int := 0;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return 0; end if;
  for r in select * from intel.ci_reminder
            where due_at <= now() and fired_at is null and cancelled_at is null
            order by due_at limit greatest(p_limit,1)
            for update skip locked loop
    select p.identity_id, c.name, p.stage, c.created_by into v_identity, v_name, v_stage, v_oper
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
     where p.participation_id = r.participation_id;
    -- a video reminder is pointless once the video is in (or the creator left the campaign)
    if (r.kind like 'video%' or r.kind = 'auto_block')
       and coalesce(v_stage,'') not in ('product_sent','content_created','changes_requested') then
      update intel.ci_reminder set cancelled_at = now() where reminder_id = r.reminder_id;
      continue;
    end if;
    v_infl := intel.ci_member_of_identity(v_identity);
    if r.kind = 'auto_block' then
      if intel.ci_block_for_no_video(r.participation_id) then
        perform intel.ci_notify(v_infl, r.campaign_id, r.participation_id, 'video_blocked', jsonb_build_object('campaign', coalesce(v_name,'your campaign')));
        perform intel.ci_notify(v_oper, r.campaign_id, r.participation_id, 'block_alert_ops', jsonb_build_object('campaign', coalesce(v_name,'your campaign')));
      end if;
    else
      perform intel.ci_notify(v_infl, r.campaign_id, r.participation_id, r.template_key,
        jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'participation_id', coalesce(r.participation_id::text,'')));
    end if;
    update intel.ci_reminder set fired_at = now() where reminder_id = r.reminder_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_run_due_reminders(int) from public, anon, authenticated;
grant execute on function intel.ci_run_due_reminders(int) to service_role;

-- reminders don't depend on the edge worker: the database runs them itself every 10 minutes
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-reminders-sql', '*/10 * * * *', $c$select intel.ci_run_due_reminders(200)$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- the team called the creator: note the reason, unblock, new due date + fresh reminders
create or replace function api.bp_unblock_after_call(p_participation uuid, p_reason text, p_days int default 3)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; v_name text; v_days int := least(greatest(coalesce(p_days,3),1),14);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'write what the creator said on the call' using errcode = '22023'; end if;
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  update intel.ci_campaign_participation set blocked_at = null, call_note = btrim(p_reason), call_at = now(), call_by = auth.uid()
   where participation_id = p_participation;
  update intel.ci_creator_blacklist set lifted_at = now(), lifted_by = auth.uid()
   where identity_id = p.identity_id and lifted_at is null and (auto or campaign_id = p.campaign_id);
  update intel.ci_campaign_deliverable set expected_by = current_date + v_days
   where participation_id = p_participation and status in ('expected','submitted');
  -- fresh reminders from today (day 2 nudge … block again after 7 days if nothing comes)
  perform intel.ci_schedule_video_reminders(p_participation, now());
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
  values (p.campaign_id, p_participation, 'approval', 'blocked', 'unblocked', auth.uid(), 'Call: ' || btrim(p_reason));
  select name into v_name from intel.ci_campaign where campaign_id = p.campaign_id;
  perform intel.ci_notify(intel.ci_member_of_identity(p.identity_id), p.campaign_id, p_participation, 'video_unblocked',
    jsonb_build_object('campaign', coalesce(v_name,'your campaign')));
  return jsonb_build_object('ok', true, 'due', current_date + v_days);
end $$;
revoke all on function api.bp_unblock_after_call(uuid, text, int) from public, anon;
grant execute on function api.bp_unblock_after_call(uuid, text, int) to authenticated;

-- note a call without unblocking (e.g. no answer)
create or replace function api.bp_log_call(p_participation uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if coalesce(btrim(p_note),'') = '' then raise exception 'write a note' using errcode = '22023'; end if;
  update intel.ci_campaign_participation set call_note = btrim(p_note), call_at = now(), call_by = auth.uid() where participation_id = p_participation;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function api.bp_log_call(uuid, text) from public, anon;
grant execute on function api.bp_log_call(uuid, text) to authenticated;

-- ===================================================================================================
-- 3) request a new video link — any number of times
-- ===================================================================================================
create or replace function api.bp_request_relink(p_participation uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return api.bp_review_video(p_participation, false,
    'New video link needed — ' || coalesce(nullif(btrim(p_reason),''), 'the link doesn''t open for us. Upload to Google Drive and set “Anyone with the link can view”.'));
end $$;
revoke all on function api.bp_request_relink(uuid, text) from public, anon;
grant execute on function api.bp_request_relink(uuid, text) to authenticated;

-- ===================================================================================================
-- 4) post auto-detected from the creator's feed after approval
-- ===================================================================================================
create or replace function intel.ci_campaign_tags(p_campaign uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct t) filter (where t ~ '^[#@][a-z0-9._]{2,}$'), '{}') from (
    select lower(case when left(x,1) in ('#','@') then x else '#' || x end) t
      from intel.ci_campaign_brief b, jsonb_array_elements_text(coalesce(b.requirements->'hashtags','[]'::jsonb)) x
     where b.campaign_id = p_campaign and b.created_at = (select max(created_at) from intel.ci_campaign_brief where campaign_id = p_campaign)
    union all
    select lower('@' || ltrim(x,'@')) from intel.ci_campaign_brief b, jsonb_array_elements_text(coalesce(b.requirements->'mentions','[]'::jsonb)) x
     where b.campaign_id = p_campaign and b.created_at = (select max(created_at) from intel.ci_campaign_brief where campaign_id = p_campaign)
    union all
    select lower(x) from regexp_split_to_table(coalesce((intel.ci_playbook(p_campaign)->'brief'->>'hashtags'),'') || ' ' ||
                                               coalesce((intel.ci_playbook(p_campaign)->'brief'->>'mentions'),''), '[\s,]+') x where x <> '') s $$;
revoke all on function intel.ci_campaign_tags(uuid) from public, anon, authenticated;

create or replace function intel.ci_autodetect_posts(p_member uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; m jsonb; v_tags text[]; v_since timestamptz; v_pid uuid; v_n int := 0; v_mt text; v_cap text; v_name text;
begin
  for r in select p.participation_id, p.campaign_id, p.stage from intel.ci_campaign_participation p
             join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.access_role = 'self' and a.revoked_at is null
            where a.member_id = p_member and p.stage in ('content_approved','published') loop
    v_tags := intel.ci_campaign_tags(r.campaign_id);
    select min(ev.at) into v_since from intel.ci_campaign_event ev
     where ev.participation_id = r.participation_id and ev.entity = 'participation' and ev.to_status = 'content_approved';
    v_since := coalesce(v_since, now() - interval '2 days') - interval '10 minutes';
    for m in select e from public.social_accounts sa,
                    jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb) || coalesce(sa.recent_stories,'[]'::jsonb)) e
              where sa.member_id = p_member and sa.platform = 'instagram' loop
      continue when nullif(m->>'timestamp','') is null or (m->>'timestamp')::timestamptz < v_since;
      continue when exists (select 1 from intel.ci_campaign_post po where po.participation_id = r.participation_id
                             and (po.external_media_id = m->>'id' or intel.ci_norm_permalink(po.permalink) = intel.ci_norm_permalink(m->>'permalink')));
      v_cap := lower(coalesce(m->>'caption',''));
      -- it's this campaign's post if it carries one of the campaign's hashtags / mentions
      -- (a campaign without any tags: the first reel after approval counts)
      continue when cardinality(v_tags) > 0 and not exists (select 1 from unnest(v_tags) t where position(t in v_cap) > 0);
      continue when cardinality(v_tags) = 0 and coalesce(m->>'media_type','') not in ('VIDEO','REELS');
      v_mt := case when m ? 'media_product_type' and m->>'media_product_type' = 'STORY' then 'story'
                   when coalesce(m->>'media_type','') in ('VIDEO','REELS') then 'reel' else 'post' end;
      if exists (select 1 from public.social_accounts sa, jsonb_array_elements(coalesce(sa.recent_stories,'[]'::jsonb)) s2
                  where sa.member_id = p_member and s2->>'id' = m->>'id') then v_mt := 'story'; end if;
      insert into intel.ci_campaign_post(participation_id, campaign_id, media_type, permalink, caption, external_media_id, posted_at)
      values (r.participation_id, r.campaign_id, v_mt, nullif(m->>'permalink',''), nullif(m->>'caption',''), nullif(m->>'id',''),
              coalesce(nullif(m->>'timestamp','')::timestamptz, now()))
      returning post_id into v_pid;
      begin perform intel.ci_check_caption_tags(r.participation_id, 'post', v_pid, m->>'caption', null); exception when others then null; end;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
      values (r.campaign_id, r.participation_id, 'submission', null, 'posted', null, v_mt || ' (auto-detected)');
      if r.stage = 'content_approved' then
        perform intel.ci_participation_advance(r.participation_id, 'published', null, 'post auto-detected on Instagram');
        r.stage := 'published';
        select name into v_name from intel.ci_campaign where campaign_id = r.campaign_id;
        perform intel.ci_notify(p_member, r.campaign_id, r.participation_id, 'post_detected', jsonb_build_object('campaign', coalesce(v_name,'your campaign')));
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_autodetect_posts(uuid) from public, anon, authenticated;

create or replace function public.tg_social_autodetect_posts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.platform = 'instagram' and new.member_id is not null
     and (new.recent_media is distinct from old.recent_media or new.recent_stories is distinct from old.recent_stories) then
    begin perform intel.ci_autodetect_posts(new.member_id);
    exception when others then raise warning 'post auto-detect skipped: %', sqlerrm; end;
  end if;
  return new;
end $$;
revoke all on function public.tg_social_autodetect_posts() from public, anon, authenticated;
drop trigger if exists social_autodetect_posts on public.social_accounts;
create trigger social_autodetect_posts after update on public.social_accounts
  for each row execute function public.tg_social_autodetect_posts();

-- the creator can also ask "check now" from the app
create or replace function api.check_my_posts()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return jsonb_build_object('found', intel.ci_autodetect_posts(auth.uid()));
end $$;
revoke all on function api.check_my_posts() from public, anon;
grant execute on function api.check_my_posts() to authenticated;

-- ===================================================================================================
-- 5) done → feedback → complete
-- ===================================================================================================
create or replace function intel.ci_request_feedback(p_participation uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare p record; v_name text;
begin
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.stage <> 'published' or p.feedback_requested_at is not null then return false; end if;
  update intel.ci_campaign_participation set feedback_requested_at = now() where participation_id = p_participation;
  select name into v_name from intel.ci_campaign where campaign_id = p.campaign_id;
  perform intel.ci_notify(intel.ci_member_of_identity(p.identity_id), p.campaign_id, p_participation, 'feedback_request',
    jsonb_build_object('campaign', coalesce(v_name,'your campaign')));
  return true;
end $$;
revoke all on function intel.ci_request_feedback(uuid) from public, anon, authenticated;

create or replace function api.bp_mark_done(p_participation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_stage text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage <> 'published' then raise exception 'the creator has not posted yet (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  perform intel.ci_request_feedback(p_participation);
  return jsonb_build_object('stage', v_stage, 'feedback_requested', true);
end $$;

-- numbers arriving no longer close the campaign: they ask the creator for feedback
create or replace function intel.tg_metric_completes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_part uuid;
begin
  select po.participation_id into v_part from intel.ci_campaign_post po where po.post_id = new.post_id;
  perform intel.ci_request_feedback(v_part);
  return null;
exception when others then
  raise warning 'feedback request skipped: %', sqlerrm; return null;
end $$;

create or replace function api.submit_campaign_feedback(p_participation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; p record; v_rating int;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.identity_id is distinct from v_id then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p.stage <> 'published' then raise exception 'feedback opens once your post is live' using errcode = '22023'; end if;
  v_rating := nullif(p_payload->>'rating','')::int;
  if v_rating is null or v_rating not between 1 and 5 then raise exception 'pick a rating from 1 to 5' using errcode = '22023'; end if;
  update intel.ci_campaign_participation
     set feedback = jsonb_build_object('rating', v_rating, 'brief_clear', p_payload->'brief_clear', 'smooth', p_payload->'smooth',
                                       'again', p_payload->'again', 'comment', left(nullif(btrim(p_payload->>'comment'),''), 1000)),
         feedback_at = now(), feedback_requested_at = coalesce(feedback_requested_at, now())
   where participation_id = p_participation;
  perform intel.ci_participation_advance(p_participation, 'completed', auth.uid(), 'creator feedback submitted');
  return jsonb_build_object('stage', 'completed');
end $$;
revoke all on function api.submit_campaign_feedback(uuid, jsonb) from public, anon;
grant execute on function api.submit_campaign_feedback(uuid, jsonb) to authenticated;

-- ===================================================================================================
-- 6) the autopilot, reads and search — updated for blocking, feedback and reminders
-- ===================================================================================================
create or replace function intel.tg_barter_autoflow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_stage text; v_days int; v_oper uuid; v_name text; v_prod text;
begin
  if not intel.ci_feature_enabled('operational_pilot') or new.participation_id is null then return null; end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = new.participation_id;

  if new.entity = 'participation' then
    if new.to_status in ('brand_confirmed','accepted') then
      -- approved → the contract goes out on its own
      begin perform intel.ci_issue_contract(new.participation_id, new.actor_member_id);
      exception when others then raise warning 'auto contract skipped for %: %', new.participation_id, sqlerrm; end;

    elsif new.to_status = 'contract_signed' then
      perform intel.ci_ensure_deliverables(new.participation_id);
      select c.created_by, c.name into v_oper, v_name from intel.ci_campaign c where c.campaign_id = new.campaign_id;
      perform intel.ci_notify(v_oper, new.campaign_id, new.participation_id, 'contract_signed_ops',
        jsonb_build_object('campaign', coalesce(v_name,'your campaign')));

    elsif new.to_status = 'address_confirmed' then
      -- a "waiting for courier" row appears on Logistics and in the process board
      if not exists (select 1 from intel.ci_campaign_shipment where participation_id = new.participation_id and status in ('pending','shipped','delivered')) then
        select product into v_prod from intel.ci_campaign_contract where participation_id = new.participation_id;
        insert into intel.ci_campaign_shipment(participation_id, product, status)
        values (new.participation_id, coalesce(v_prod, (select product from intel.ci_campaign where campaign_id = new.campaign_id)), 'pending');
      end if;

    elsif new.to_status = 'content_created' then
      -- the video brief is out: set the due date on every deliverable
      perform intel.ci_ensure_deliverables(new.participation_id);
      select coalesce(content_days, 7) into v_days from intel.ci_campaign_contract where participation_id = new.participation_id;
      v_days := coalesce(v_days, ((intel.ci_playbook(new.campaign_id)->'contract')->>'content_days')::int, 7);
      update intel.ci_campaign_deliverable set expected_by = current_date + v_days
       where participation_id = new.participation_id and expected_by is null;
      -- day 2–3 daily · day 4–6 morning + evening · day 7 block
      perform intel.ci_schedule_video_reminders(new.participation_id, now());

    elsif new.to_status = 'product_sent' then
      -- the clock only starts when the parcel is in their hands
      update intel.ci_reminder set cancelled_at = now()
       where participation_id = new.participation_id and kind = 'video_due' and fired_at is null and cancelled_at is null;

    elsif new.to_status = 'published' then
      update intel.ci_campaign_deliverable set status = 'published'
       where participation_id = new.participation_id and status in ('expected','submitted','approved');
    end if;

  elsif new.entity = 'shipment' and new.to_status = 'delivered' then
    -- parcel in hand → video brief goes to the creator (stage "Video brief sent")
    if v_stage in ('accepted','address_confirmed') then
      perform intel.ci_participation_advance(new.participation_id, 'product_sent', new.actor_member_id, 'product delivered');
      v_stage := 'product_sent';
    end if;
    if v_stage = 'product_sent' then
      perform intel.ci_participation_advance(new.participation_id, 'content_created', new.actor_member_id, 'video brief sent automatically');
    end if;
  end if;
  return null;
end $$;
create or replace function api.get_my_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name), 'product', coalesce(k.product, c.product), 'comp_type', c.comp_type,
      'category', c.category, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'lifecycle_status', c.lifecycle_status,
      'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
      'cities', coalesce(to_jsonb(c.cities), '[]'::jsonb), 'languages', coalesce(to_jsonb(c.languages), '[]'::jsonb),
      'brief', br.requirements->>'brief', 'deliverables_text', br.requirements->>'deliverables_text',
      'platforms', br.requirements->>'platforms', 'campaign_type', br.requirements->>'campaign_type',
      'barter_subtype', br.requirements->>'barter_subtype', 'product_link', br.requirements->>'product_link',
      'product_value', coalesce(to_jsonb(k.product_value), br.requirements->'product_value'),
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb), 'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'attachments', coalesce(br.requirements->'attachments', '[]'::jsonb),
      'stage', p.stage, 'reason', p.reason, 'reason_code', p.reason_code,
      'reason_label', (select v.label from public.rejection_reason_vocab v where v.code = p.reason_code),
      'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'updated_at', p.updated_at,
      'deadline', (select min(expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
      'contract', case when k.contract_id is not null then jsonb_build_object('issued_at', k.issued_at, 'signed_at', k.signed_at,
                    'content_days', k.content_days, 'ad_rights_months', k.ad_rights_months, 'collab_rights', k.collab_rights) end,
      'shipment', (select jsonb_build_object('status', s.status, 'product', s.product, 'courier', s.courier,
                     'tracking_ref', s.tracking_ref, 'tracking_url', s.tracking_url, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at)
                     from intel.ci_campaign_shipment s where s.participation_id = p.participation_id
                    order by s.created_at desc limit 1),
      -- the video brief unlocks once the product is in their hands
      'video_brief', case when p.stage in ('content_created','content_submitted','changes_requested','content_approved','published','completed')
                          then intel.ci_playbook(c.campaign_id)->'brief' end,
      'submission', (select jsonb_build_object('url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at)
                       from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                      where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
      'review', (select jsonb_build_object('decision', ap.decision, 'reason', ap.reason, 'at', ap.decided_at)
                   from intel.ci_campaign_approval ap join intel.ci_campaign_submission s on s.submission_id = ap.submission_id
                   join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                  where d.participation_id = p.participation_id order by ap.decided_at desc limit 1),
      'posts', intel.ci_participation_posts(p.participation_id),
      'blocked_at', p.blocked_at, 'block_reason', p.block_reason,
      'feedback_requested_at', p.feedback_requested_at, 'feedback_at', p.feedback_at,
      'contract_signed', k.signed_at is not null,
      'steps', (select coalesce(jsonb_object_agg(e.to_status, e.at), '{}'::jsonb) from (
                  select distinct on (ev.to_status) ev.to_status, ev.at from intel.ci_campaign_event ev
                   where ev.participation_id = p.participation_id and ev.entity = 'participation'
                   order by ev.to_status, ev.at) e),
      'deliverables', coalesce((select jsonb_agg(jsonb_build_object(
            'deliverable_id', d.deliverable_id, 'format', d.content_format, 'quantity', d.quantity,
            'expected_by', d.expected_by, 'status', d.status,
            'permalink', m.permalink, 'media_type', m.media_type, 'posted_at', m.media_timestamp,
            'metrics', coalesce((select jsonb_object_agg(i.metric_name, i.value_count) from (
                  select distinct on (x.metric_name) x.metric_name, x.value_count
                    from intel.ci_media_insights x
                   where x.media_row_id = d.media_row_id and x.status = 'available' and x.value_count is not null
                   order by x.metric_name, x.captured_at desc) i), '{}'::jsonb)) order by d.created_at)
          from intel.ci_campaign_deliverable d
          left join intel.ci_media m on m.media_row_id = d.media_row_id
         where d.participation_id = p.participation_id), '[]'::jsonb))
      order by p.updated_at desc)
    from intel.ci_campaign_participation p
    join intel.ci_campaign c on c.campaign_id = p.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join intel.ci_campaign_contract k on k.participation_id = p.participation_id
    left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    where p.identity_id = v_id), '[]'::jsonb);
end $$;
create or replace function api.barter_tracker(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;

  return jsonb_build_object(
    'campaign', (select jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'brand', c.submitted_brand_name,
                   'product', c.product, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'status', c.lifecycle_status)
                   from intel.ci_campaign c where c.campaign_id = v_id),
    'outreach_at', (select updated_at from intel.ci_campaign_outreach o where o.campaign_id = v_id),
    'playbook', intel.ci_playbook(v_id),
    'creators', coalesce((select jsonb_agg(row order by (row->>'applied_at')) from (
      select jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage, 'reason', p.reason,
        'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'updated_at', p.updated_at,
        'creator', intel.ci_public_creator_card(p.identity_id),
        'member_id', intel.ci_member_of_identity(p.identity_id),
        'blacklisted', exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = p.identity_id and b.lifted_at is null),
        'blocked_at', p.blocked_at, 'block_reason', p.block_reason, 'call_note', p.call_note, 'call_at', p.call_at,
        'feedback_requested_at', p.feedback_requested_at, 'feedback_at', p.feedback_at, 'feedback', p.feedback,
        'phone', case when p.blocked_at is not null or p.stage in ('address_confirmed','product_sent','content_created','changes_requested')
                      then (select w.phone_e164 from public.wa_contacts w where w.user_id = intel.ci_member_of_identity(p.identity_id) and w.verified_at is not null limit 1) end,
        'reminders_sent', (select count(*) from intel.ci_reminder r where r.participation_id = p.participation_id and r.fired_at is not null and r.kind like 'video%'),
        'next_reminder', (select min(r.due_at) from intel.ci_reminder r where r.participation_id = p.participation_id and r.fired_at is null and r.cancelled_at is null),
        'has_address', p.shipping_address_id is not null,
        'ship_to', (select jsonb_build_object('name', coalesce(nullif(btrim(m.name),''), sa.name), 'line1', a.line1, 'line2', a.line2,
                       'landmark', a.landmark, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code,
                       'phone', (select w.phone_e164 from public.wa_contacts w where w.user_id = a2.member_id and w.verified_at is not null limit 1))
                      from private.creator_address a
                      join intel.ci_identity_actor_access a2 on a2.identity_id = a.identity_id and a2.access_role = 'self' and a2.revoked_at is null
                      left join public.members m on m.id = a2.member_id
                      left join public.social_accounts sa on sa.member_id = a2.member_id and sa.platform = 'instagram'
                     where a.address_id = p.shipping_address_id and p.stage in ('address_confirmed','product_sent','content_created')
                     limit 1),
        'contract', (select jsonb_build_object('issued_at', k.issued_at, 'signed_at', k.signed_at, 'asci_ack', k.asci_ack, 'terms_ack', k.terms_ack,
                       'ad_rights_months', k.ad_rights_months, 'collab_rights', k.collab_rights, 'product', k.product,
                       'deliverables', k.deliverables, 'content_days', k.content_days, 'clauses', k.clauses, 'signature_name', k.signature_name)
                       from intel.ci_campaign_contract k where k.participation_id = p.participation_id),
        'shipment', (select jsonb_build_object('status', s.status, 'courier', s.courier, 'tracking_ref', s.tracking_ref, 'tracking_url', s.tracking_url,
                       'product', s.product, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at)
                       from intel.ci_campaign_shipment s where s.participation_id = p.participation_id order by s.created_at desc limit 1),
        'due_on', (select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
        'submission', (select jsonb_build_object('url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at,
                         'rounds', (select count(*) from intel.ci_campaign_submission s2 join intel.ci_campaign_deliverable d2 on d2.deliverable_id = s2.deliverable_id
                                     where d2.participation_id = p.participation_id))
                         from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                        where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
        'review', (select jsonb_build_object('decision', ap.decision, 'reason', ap.reason, 'at', ap.decided_at)
                     from intel.ci_campaign_approval ap join intel.ci_campaign_submission s on s.submission_id = ap.submission_id
                     join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                    where d.participation_id = p.participation_id order by ap.decided_at desc limit 1),
        'posts', intel.ci_participation_posts(p.participation_id),
        'deliverables', coalesce((select jsonb_agg(jsonb_build_object('deliverable_id', d.deliverable_id, 'format', d.content_format,
                           'quantity', d.quantity, 'expected_by', d.expected_by, 'status', d.status) order by d.created_at)
                         from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id), '[]'::jsonb),
        'steps', (select coalesce(jsonb_object_agg(e.to_status, e.at), '{}'::jsonb) from (
                    select distinct on (ev.to_status) ev.to_status, ev.at from intel.ci_campaign_event ev
                     where ev.participation_id = p.participation_id and ev.entity = 'participation'
                     order by ev.to_status, ev.at) e)) row
        from intel.ci_campaign_participation p
       where p.campaign_id = v_id) s), '[]'::jsonb));
end $$;
create or replace function api.process_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin() or intel.ci_is_agency_operator();
  return coalesce((select jsonb_agg(r order by (r->>'rank')::int, (r->>'since')) from (
    select jsonb_build_object(
      'participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'legacy_campaign_id', c.legacy_campaign_id,
      'campaign_name', c.name, 'brand', c.submitted_brand_name,
      'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
      'creator', intel.ci_public_creator_card(p.identity_id), 'stage', p.stage, 'since', p.updated_at,
      'kind', k.kind, 'rank', k.rank,
      'phone', case when k.kind in ('blocked','overdue') then (select w.phone_e164 from public.wa_contacts w
                     where w.user_id = intel.ci_member_of_identity(p.identity_id) and w.verified_at is not null limit 1) end,
      'call_note', p.call_note,
      'due_on', (select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
      'video_url', (select s.content_url from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                     where d.participation_id = p.participation_id order by s.submitted_at desc limit 1)) r
      from intel.ci_campaign_participation p
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join lateral (select s.status from intel.ci_campaign_shipment s where s.participation_id = p.participation_id
                          order by s.created_at desc limit 1) sh on true
      cross join lateral (select case
          when p.blocked_at is not null then 'blocked'
          when p.stage = 'content_submitted' then 'review'
          when p.stage = 'address_confirmed' then 'ship'
          when p.stage = 'product_sent' and sh.status = 'shipped' then 'deliver'
          when p.stage in ('content_created','changes_requested')
               and exists (select 1 from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id
                            and d.expected_by < current_date) then 'overdue'
          when p.stage in ('brand_confirmed','accepted') and p.updated_at < now() - interval '10 minutes' then 'contract'
          when p.stage = 'contract_sent' and p.updated_at < now() - interval '3 days' then 'unsigned'
        end as kind,
        case when p.blocked_at is not null then 0 when p.stage = 'content_submitted' then 1 when p.stage = 'address_confirmed' then 2 when p.stage = 'product_sent' then 3 else 4 end as rank) k
     where k.kind is not null
       and c.lifecycle_status not in ('cancelled')
       and (v_admin or intel.ci_can_manage_campaign(c.campaign_id))
     limit 300) x), '[]'::jsonb);
end $$;
create or replace function api.creator_search(p_filters jsonb default '{}'::jsonb, p_page int default 1, p_size int default 24, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text; v_loc text; v_min int; v_max int; v_eng numeric; v_gender text; v_src text; v_sort text; v_cats text[];
        v_camp uuid; v_size int := least(greatest(coalesce(p_size,24),1),60); v_page int := greatest(coalesce(p_page,1),1);
        v_out jsonb;
begin
  if not intel.ci_can_discover() then raise exception 'discovery is for approved agencies, brands and the Super Admin' using errcode = '42501'; end if;
  v_q := nullif(lower(btrim(regexp_replace(coalesce(p_filters->>'q',''), '^[@#]', ''))), '');
  v_loc := nullif(lower(btrim(coalesce(p_filters->>'location',''))), '');
  v_min := nullif(p_filters->>'min_followers','')::int; v_max := nullif(p_filters->>'max_followers','')::int;
  v_eng := nullif(p_filters->>'min_engagement','')::numeric;
  v_gender := nullif(lower(coalesce(p_filters->>'gender','')), '');
  v_src := coalesce(nullif(p_filters->>'source',''), 'all');
  v_sort := coalesce(nullif(p_filters->>'sort',''), 'followers_desc');
  select array_agg(lower(btrim(x))) into v_cats from jsonb_array_elements_text(case when jsonb_typeof(p_filters->'categories') = 'array' then p_filters->'categories' else '[]'::jsonb end) x where btrim(x) <> '';
  v_camp := intel.ci_resolve_campaign(p_campaign);

  with plat as (
    select 'platform'::text kind, sa.member_id, lower(sa.username) handle, coalesce(nullif(btrim(m.name),''), sa.name) name, sa.profile_picture_url pic,
           sa.followers_count::bigint followers, x.eng engagement, x.likes avg_likes, sa.media_count posts, left(sa.biography, 220) bio,
           (select coalesce(array_agg(distinct lower(c)), '{}') from unnest(coalesce(nullif(pp.categories,'{}'), intel.ci_guess_categories(x.blob))) c) categories,
           coalesce(pp.city_coarse, intel.ci_guess_city(sa.biography)) city, pp.state_coarse state, lower(per.gender) gender, x.blob, sa.connected_at found_at
      from public.social_accounts sa
      join public.members m on m.id = sa.member_id and m.role = 'creator'
      left join intel.ci_identity_actor_access acc on acc.member_id = sa.member_id and acc.access_role = 'self' and acc.revoked_at is null
      left join intel.ci_creator_professional_profile pp on pp.identity_id = acc.identity_id
      left join private.creator_personal_profile per on per.identity_id = acc.identity_id
      cross join lateral (
        select (select avg(coalesce((m2->>'like_count')::numeric,0)) from jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) m2) likes,
               case when coalesce(sa.followers_count,0) > 0 and jsonb_array_length(coalesce(sa.recent_media,'[]'::jsonb)) > 0 then
                 round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                                  from jsonb_array_elements(sa.recent_media) m2) / sa.followers_count, 2) end eng,
               lower(coalesce(sa.username,'') || ' ' || coalesce(sa.name,'') || ' ' || coalesce(sa.biography,'') || ' ' ||
                     coalesce((select string_agg(m4->>'caption', ' ') from jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) m4), '')) blob) x
     where v_src in ('all','platform') and sa.platform = 'instagram' and sa.username is not null
       -- blocked creators are unlisted until the team unblocks them
       and not exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = acc.identity_id and b.lifted_at is null)),
  ext as (
    select 'external'::text, null::uuid, e.handle, e.display_name, e.profile_picture_url, e.followers::bigint, e.engagement, e.avg_likes, e.media_count, e.bio,
           (select coalesce(array_agg(distinct lower(c)), '{}') from unnest(e.categories) c), e.city, e.state, null::text,
           lower(e.handle || ' ' || coalesce(e.display_name,'') || ' ' || coalesce(e.bio,'') || ' ' || array_to_string(e.hashtags, ' ')), e.first_seen_at
      from intel.ci_external_creator e
     where v_src in ('all','external')
       and not exists (select 1 from public.social_accounts sa where sa.platform = 'instagram' and lower(sa.username) = e.handle)),
  u as (select * from plat union all select * from ext),
  f as (
    select * from u where
          (v_q is null or blob like '%'||v_q||'%' or exists (select 1 from unnest(categories) c where c like '%'||v_q||'%'))
      and (v_cats is null or categories && v_cats or exists (select 1 from unnest(v_cats) w where blob like '%'||w||'%'))
      and (v_loc is null or lower(coalesce(city,'') || ' ' || coalesce(state,'')) like '%'||v_loc||'%' or blob like '%'||v_loc||'%')
      and (v_min is null or followers >= v_min)
      and (v_max is null or followers <= v_max)
      and (v_eng is null or engagement >= v_eng)
      and (v_gender is null or gender = v_gender)),
  o as (
    select f.*, count(*) over () tot, row_number() over (order by
            case when v_sort = 'followers_asc' then f.followers end asc nulls last,
            case when v_sort = 'engagement_desc' then f.engagement end desc nulls last,
            case when v_sort = 'recent' then f.found_at end desc nulls last,
            f.followers desc nulls last, f.handle) ord
      from f)
  select jsonb_build_object('total', coalesce(max(o.tot), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'kind', o.kind, 'member_id', o.member_id, 'handle', o.handle, 'name', o.name, 'profile_picture_url', o.pic,
      'followers', o.followers, 'engagement', o.engagement, 'avg_likes', round(o.avg_likes), 'posts', o.posts, 'bio', o.bio,
      'categories', to_jsonb(o.categories), 'city', o.city, 'state', o.state,
      'state_in_campaign', case when v_camp is null then null
          when o.kind = 'platform' then (select p.stage from intel.ci_campaign_participation p
                  join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.access_role = 'self'
                 where p.campaign_id = v_camp and a.member_id = o.member_id limit 1)
          else (select 'invited' from intel.ci_campaign_invite i where i.campaign_id = v_camp and lower(i.handle) = o.handle limit 1) end)
      order by o.ord) filter (where o.ord > (v_page - 1) * v_size and o.ord <= v_page * v_size), '[]'::jsonb))
    into v_out from o;

  return v_out || jsonb_build_object('page', v_page, 'size', v_size,
    'pages', greatest(ceil((v_out->>'total')::numeric / v_size)::int, 1));
end $$;

do $$ declare fn text; begin
  foreach fn in array array['api.get_my_campaigns()','api.barter_tracker(uuid)','api.process_inbox()','api.creator_search(jsonb,int,int,uuid)','api.bp_mark_done(uuid)'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;

-- ===================================================================================================
-- 7) catch up: refresh unsigned contracts with the new clause; reminders for videos already due
-- ===================================================================================================
do $$ declare r record; begin
  if intel.ci_feature_enabled('operational_pilot') then
    for r in select k.participation_id from intel.ci_campaign_contract k join intel.ci_campaign_participation p on p.participation_id = k.participation_id
              where k.signed_at is null and p.stage = 'contract_sent' loop
      begin perform intel.ci_issue_contract(r.participation_id, null); exception when others then null; end;
    end loop;
    for r in select p.participation_id, coalesce((select max(s.delivered_at) from intel.ci_campaign_shipment s where s.participation_id = p.participation_id), now()) d
               from intel.ci_campaign_participation p where p.stage in ('content_created','changes_requested') loop
      perform intel.ci_schedule_video_reminders(r.participation_id, r.d);
    end loop;
  end if;
end $$;
