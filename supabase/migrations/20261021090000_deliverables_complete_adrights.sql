-- Campaign deliverables, end to end
--  1) A creator's campaign is COMPLETE only when every deliverable is up: 1 Reel + 2 Stories = 3 post links (each one a
--     reel / story / feed post). The first post moves them to "posted"; each new link is counted; the last one completes it.
--     Until then the creator is told exactly what is left. The team can still close it by hand (Mark done / Set step).
--  2) Every post link (added by the creator, found on their Instagram, or added by the team) gets its numbers fetched from
--     the creator's own connected Instagram (the media kit token) — right away, then every few hours.
--  3) Ad rights: for the ad-rights months in the contract (counted from the day of posting) every reel / post is checked
--     twice a day. If it's gone (deleted / archived), the creator is reminded to restore it (WhatsApp UTILITY template
--     geek_step_restore_post + email + app) and the team is told; when it's back the team is told it's restored.
--  4) Video due: the reminders follow the campaign's own "content due" days (not a fixed 7): daily at 9:00, then 9:00 +
--     18:30 for the last 3 days and on the due day; the block (only if the blacklist clause is on) the morning after.
--  5) Campaign end date close (3 days before → the end date): every creator with something still to do gets a reminder at
--     9:00 and 18:30 (geek_step_deadline), saying what is pending; the team gets one summary in the morning.
--  6) The contract carries the hashtags + mentions and the "keep it live" rule, and the blacklist clause uses the
--     campaign's own number of days.
--  7) New WhatsApp step templates are created as UTILITY templates (automatically when Meta is connected), listed for the
--     Super Admin with their exact text.
-- ADDITIVE: new functions / columns / tables; existing functions redefined with the same signatures.

-- ---------------------------------------------------------------------------------------------------
-- 1) what has to go up vs what is up
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_deliverables_progress(p_participation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_camp uuid; v_req jsonb; v_items jsonb; v_need int; v_done int;
begin
  select campaign_id into v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_camp is null then return null; end if;
  -- the deliverables: this creator's own rows → their contract → the campaign's terms
  select coalesce(jsonb_agg(jsonb_build_object('format_key', d.content_format, 'quantity', greatest(coalesce(d.quantity,1),1))), null)
    into v_req from intel.ci_campaign_deliverable d where d.participation_id = p_participation;
  if v_req is null then
    select case when jsonb_array_length(coalesce(k.deliverables,'[]'::jsonb)) > 0 then k.deliverables end into v_req
      from intel.ci_campaign_contract k where k.participation_id = p_participation;
  end if;
  if v_req is null then
    v_req := intel.ci_parse_deliverables((intel.ci_playbook(v_camp)->'contract')->>'deliverables');
  end if;
  with req as (
    select case when x->>'format_key' = 'reel' then 'reel' when x->>'format_key' = 'story' then 'story'
                when x->>'format_key' in ('static_post','carousel') then 'feed' end as kind,
           greatest(coalesce(nullif(x->>'quantity','')::int, 1), 1) as q
      from jsonb_array_elements(coalesce(v_req, '[]'::jsonb)) x),
  need as (select kind, sum(q)::int as need from req where kind is not null group by kind
           union all select 'reel', 1 where not exists (select 1 from req)),
  done as (select case po.media_type when 'reel' then 'reel' when 'story' then 'story' else 'feed' end as kind, count(*)::int as n
             from intel.ci_campaign_post po where po.participation_id = p_participation group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind,
           'label', case n.kind when 'reel' then 'Reel' when 'story' then 'Story' else 'Post' end,
           'need', n.need, 'done', least(coalesce(d.n, 0), n.need)) order by case n.kind when 'reel' then 1 when 'feed' then 2 else 3 end), '[]'::jsonb),
         coalesce(sum(n.need), 0)::int, coalesce(sum(least(coalesce(d.n, 0), n.need)), 0)::int
    into v_items, v_need, v_done
    from need n left join done d on d.kind = n.kind;
  return jsonb_build_object('items', v_items, 'need', v_need, 'done', v_done, 'all_done', v_done >= v_need,
    'left', (select coalesce(string_agg((i->>'need')::int - (i->>'done')::int || ' ' ||
               case when (i->>'need')::int - (i->>'done')::int > 1 then case i->>'kind' when 'story' then 'Stories' else (i->>'label') || 's' end else i->>'label' end, ' + '), '')
               from jsonb_array_elements(v_items) i where (i->>'done')::int < (i->>'need')::int));
end $$;
revoke all on function intel.ci_deliverables_progress(uuid) from public, anon, authenticated;

-- posted → complete, but only when everything is up
create or replace function intel.ci_try_complete(p_participation uuid, p_actor uuid, p_reason text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_stage text; pr jsonb;
begin
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage is distinct from 'published' then return false; end if;
  pr := intel.ci_deliverables_progress(p_participation);
  if not coalesce((pr->>'all_done')::boolean, false) then return false; end if;
  update intel.ci_campaign_participation set feedback_requested_at = coalesce(feedback_requested_at, now()) where participation_id = p_participation;
  perform intel.ci_participation_advance(p_participation, 'completed', p_actor,
    coalesce(p_reason, 'every deliverable posted (' || (pr->>'done') || ' of ' || (pr->>'need') || ') — campaign complete'));
  return true;
end $$;
revoke all on function intel.ci_try_complete(uuid, uuid, text) from public, anon, authenticated;

-- after any new post: complete when it was the last one, else tell the creator what's still to post
create or replace function intel.ci_after_post(p_participation uuid, p_actor uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p record; pr jsonb; v_name text;
begin
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.stage is distinct from 'published' then return; end if;
  -- the team put them on "Posted" by hand (bulk sheet / Set step): that's their call — complete now
  if coalesce(current_setting('geek.bulk_quiet', true), '') = 'on' then
    update intel.ci_campaign_participation set feedback_requested_at = coalesce(feedback_requested_at, now()) where participation_id = p_participation;
    perform intel.ci_participation_advance(p_participation, 'completed', p_actor, 'marked posted by the team');
    return;
  end if;
  if intel.ci_try_complete(p_participation, p_actor) then return; end if;
  pr := intel.ci_deliverables_progress(p_participation);
  select name into v_name from intel.ci_campaign where campaign_id = p.campaign_id;
  perform intel.ci_notify(intel.ci_member_of_identity(p.identity_id), p.campaign_id, p_participation, 'posts_pending',
    jsonb_build_object('campaign', coalesce(v_name, 'your campaign'), 'done', pr->>'done', 'need', pr->>'need', 'left', coalesce(nullif(pr->>'left',''), 'your remaining posts')));
end $$;
revoke all on function intel.ci_after_post(uuid, uuid) from public, anon, authenticated;


-- the autopilot: 'posted' no longer means 'complete' on its own (same function as 20261017030000, one branch changed)
create or replace function intel.tg_barter_autoflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
      -- posted = done: the campaign completes now; feedback is optional (asked in the app, reminded on the next apply)
      update intel.ci_campaign_participation set feedback_requested_at = coalesce(feedback_requested_at, now())
       where participation_id = new.participation_id;
      -- complete only when EVERY deliverable is up (e.g. 1 Reel + 2 Stories = 3 links); otherwise tell them what's left
      perform intel.ci_after_post(new.participation_id, new.actor_member_id);
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

-- feedback no longer closes a campaign that still has posts to go up
create or replace function api.submit_campaign_feedback(p_participation uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_id uuid; p record; v_rating int;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.identity_id is distinct from v_id then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p.stage not in ('published','completed') then raise exception 'feedback opens once your post is live' using errcode = '22023'; end if;
  v_rating := nullif(p_payload->>'rating','')::int;
  if v_rating is null or v_rating not between 1 and 5 then raise exception 'pick a rating from 1 to 5' using errcode = '22023'; end if;
  update intel.ci_campaign_participation
     set feedback = jsonb_build_object('rating', v_rating, 'brief_clear', p_payload->'brief_clear', 'smooth', p_payload->'smooth',
                                       'again', p_payload->'again', 'comment', left(nullif(btrim(p_payload->>'comment'),''), 1000)),
         feedback_at = now(), feedback_requested_at = coalesce(feedback_requested_at, now())
   where participation_id = p_participation;
  if p.stage = 'published' then perform intel.ci_try_complete(p_participation, auth.uid(), 'creator feedback submitted'); end if;
  return jsonb_build_object('stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation), 'feedback', true);
end $$;
-- numbers arriving no longer close it on their own either (only when every deliverable is up)
create or replace function intel.tg_metric_completes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_part uuid;
begin
  select po.participation_id into v_part from intel.ci_campaign_post po where po.post_id = new.post_id;
  perform intel.ci_try_complete(v_part, null, 'every deliverable posted — analytics collected');
  return null;
exception when others then
  raise warning 'auto-complete skipped: %', sqlerrm; return null;
end $$;

-- every new post link: count it (complete on the last one) and fetch its numbers right away
create or replace function intel.tg_post_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin perform intel.ci_after_post(new.participation_id, null);
  exception when others then raise warning 'post count skipped: %', sqlerrm; end;
  begin perform private.ci_kick_worker('ci-post-insights-worker');
  exception when others then null; end;
  return null;
end $$;
revoke all on function intel.tg_post_after_insert() from public, anon, authenticated;
drop trigger if exists ci_post_after_insert on intel.ci_campaign_post;
create trigger ci_post_after_insert after insert on intel.ci_campaign_post
  for each row execute function intel.tg_post_after_insert();

-- the team's view: posts up vs needed, per creator on a campaign
create or replace function api.campaign_deliverable_progress(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then return '{}'::jsonb; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(p.participation_id::text, intel.ci_deliverables_progress(p.participation_id)
           || jsonb_build_object('posts', coalesce((select jsonb_agg(jsonb_build_object('post_id', po.post_id, 'media_type', po.media_type,
                 'permalink', po.permalink, 'posted_at', po.posted_at, 'tracked', po.external_media_id is not null,
                 'missing_since', po.missing_since, 'live_checked_at', po.live_checked_at, 'stats', intel.ci_post_stats(po.post_id)) order by po.posted_at)
               from intel.ci_campaign_post po where po.participation_id = p.participation_id), '[]'::jsonb)))
         from intel.ci_campaign_participation p
        where p.campaign_id = p_campaign and p.stage in ('content_created','content_submitted','changes_requested','content_approved','published','completed')), '{}'::jsonb);
end $$;
revoke all on function api.campaign_deliverable_progress(uuid) from public, anon;
grant execute on function api.campaign_deliverable_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2) + 3) numbers from the creator's own Instagram, and the "still live?" check during the ad-rights months
-- ---------------------------------------------------------------------------------------------------
alter table intel.ci_campaign_post add column if not exists insights_at        timestamptz;   -- last time numbers were fetched
alter table intel.ci_campaign_post add column if not exists insights_error     text;
alter table intel.ci_campaign_post add column if not exists live_checked_at    timestamptz;   -- last "is it still up?" check
alter table intel.ci_campaign_post add column if not exists missing_since      timestamptz;   -- gone from Instagram since
alter table intel.ci_campaign_post add column if not exists restore_reminded_at timestamptz;
alter table intel.ci_campaign_post add column if not exists restore_reminders  int not null default 0;

-- the window the post must stay live: posted_at + the contract's ad-rights months
create or replace function intel.ci_post_live_until(p_post uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select po.posted_at + make_interval(months => greatest(coalesce(k.ad_rights_months,
           nullif((intel.ci_playbook(po.campaign_id)->'contract')->>'ad_rights_months','')::int, 1), 0))
    from intel.ci_campaign_post po left join intel.ci_campaign_contract k on k.participation_id = po.participation_id
   where po.post_id = p_post $$;
revoke all on function intel.ci_post_live_until(uuid) from public, anon, authenticated;

-- worker input: what to do for which post (the worker reads each creator's own token itself)
create or replace function api.ops_post_targets(p_limit int default 150)
returns jsonb language sql stable security definer set search_path = '' as $$
  with base as (
    select po.*, intel.ci_member_of_identity(p.identity_id) as member_id, intel.ci_post_live_until(po.post_id) as live_until
      from intel.ci_campaign_post po join intel.ci_campaign_participation p on p.participation_id = po.participation_id
     where po.posted_at > now() - interval '25 months'),
  t as (
    select b.*,
           (b.media_type <> 'story' or b.posted_at > now() - interval '24 hours') and b.posted_at > now() - interval '30 days'
             and (b.insights_at is null or b.insights_at < now() - case when b.posted_at > now() - interval '3 days' then interval '2 hours' else interval '12 hours' end) as need_insights,
           b.media_type <> 'story' and now() < b.live_until
             and (b.live_checked_at is null or b.live_checked_at < now() - interval '11 hours') as need_live
      from base b where b.member_id is not null)
  select coalesce(jsonb_agg(jsonb_build_object('post_id', t.post_id, 'participation_id', t.participation_id, 'member_id', t.member_id,
           'media_type', t.media_type, 'permalink', t.permalink, 'external_media_id', t.external_media_id, 'posted_at', t.posted_at,
           'insights', t.need_insights, 'live_check', t.need_live)), '[]'::jsonb)
    from (select * from t where t.need_insights or t.need_live
           order by (t.insights_at is null) desc, (t.missing_since is not null) desc, t.posted_at desc
           limit greatest(coalesce(p_limit, 150), 1)) t $$;
revoke all on function api.ops_post_targets(int) from public, anon, authenticated;
grant execute on function api.ops_post_targets(int) to service_role;

-- worker found the post among the creator's media → remember its Instagram id (numbers + live check use it)
create or replace function api.ops_post_resolved(p_post uuid, p_media_id text, p_media_type text default null)
returns void language sql security definer set search_path = '' as $$
  update intel.ci_campaign_post set external_media_id = coalesce(external_media_id, nullif(btrim(p_media_id),'')),
         media_type = case when p_media_type in ('reel','story','post') and external_media_id is null then p_media_type else media_type end
   where post_id = p_post $$;
revoke all on function api.ops_post_resolved(uuid, text, text) from public, anon, authenticated;
grant execute on function api.ops_post_resolved(uuid, text, text) to service_role;

-- numbers fetched (or why not)
create or replace function api.ops_post_insights(p_post uuid, p_metrics jsonb, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update intel.ci_campaign_post set insights_at = now(), insights_error = left(p_error, 300) where post_id = p_post;
  if p_error is null and p_metrics is not null and p_metrics <> '{}'::jsonb then
    perform intel.ci_record_post_metric(p_post, p_metrics || jsonb_build_object('source', 'creator_token'), null);
  end if;
end $$;
revoke all on function api.ops_post_insights(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function api.ops_post_insights(uuid, jsonb, text) to service_role;

-- "is it still up?" — gone → remind the creator to restore it (twice a day at most) + tell the team; back → tell the team
create or replace function api.ops_post_live(p_post uuid, p_live boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare po record; p record; v_name text; v_org uuid; v_member uuid; v_who text; v_until timestamptz;
begin
  select * into po from intel.ci_campaign_post where post_id = p_post;
  if po.post_id is null then return null; end if;
  select * into p from intel.ci_campaign_participation where participation_id = po.participation_id;
  select c.name, c.org_id into v_name, v_org from intel.ci_campaign c where c.campaign_id = po.campaign_id;
  v_member := intel.ci_member_of_identity(p.identity_id);
  select '@' || lower(sa.username) into v_who from public.social_accounts sa where sa.member_id = v_member and sa.platform = 'instagram' limit 1;
  v_until := intel.ci_post_live_until(p_post);
  update intel.ci_campaign_post set live_checked_at = now() where post_id = p_post;
  if p_live then
    if po.missing_since is not null then
      update intel.ci_campaign_post set missing_since = null, restore_reminders = 0, restore_reminded_at = null where post_id = p_post;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
        values (po.campaign_id, po.participation_id, 'submission', 'missing', 'restored', null, po.media_type || ' is live again');
      begin perform intel.ci_alert_org(v_org, 'Post restored — ' || coalesce(v_who, 'creator'), coalesce(v_who, 'The creator') || '''s ' || po.media_type
              || ' for ' || coalesce(v_name, 'the campaign') || ' is live again.', 'campaigns', 'Open', 'info', null);
      exception when others then null; end;
    end if;
    return jsonb_build_object('live', true);
  end if;
  if now() >= v_until then return jsonb_build_object('live', false, 'outside_window', true); end if;
  if po.missing_since is null then
    update intel.ci_campaign_post set missing_since = now() where post_id = p_post;
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
      values (po.campaign_id, po.participation_id, 'submission', 'posted', 'missing', null,
              po.media_type || ' not found on Instagram (deleted or archived) — must stay live until ' || to_char(v_until at time zone 'Asia/Kolkata', 'DD Mon YYYY'));
    begin perform intel.ci_alert_org(v_org, 'Post taken down — ' || coalesce(v_who, 'creator'), coalesce(v_who, 'The creator') || '''s ' || po.media_type
            || ' for ' || coalesce(v_name, 'the campaign') || ' is no longer on Instagram. Ad rights run until ' || to_char(v_until at time zone 'Asia/Kolkata', 'DD Mon YYYY')
            || ' — we''ve asked them to restore it.', 'campaigns', 'Open', 'action_required', null);
    exception when others then null; end;
  end if;
  -- the creator is reminded to restore it at the next 9:00 / 18:30 (intel.ci_run_restore_reminders)
  return jsonb_build_object('live', false, 'until', v_until);
end $$;
revoke all on function api.ops_post_live(uuid, boolean, text) from public, anon, authenticated;
grant execute on function api.ops_post_live(uuid, boolean, text) to service_role;

-- the database kicks the new worker too
create or replace function private.ci_kick_worker(p_fn text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text;
begin
  if p_fn not in ('ops-notify-dispatch','ops-reminder-worker','wa-template-sync','ig-discover-worker','ci-post-insights-worker') then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ci_worker_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ci_project_url' limit 1;
  if v_secret is null or v_url is null then return null; end if;
  return net.http_post(url := v_url || '/functions/v1/' || p_fn, body := '{}'::jsonb,
                       headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', v_secret),
                       timeout_milliseconds := 25000);
exception when others then
  raise warning 'ci_kick_worker(%) skipped: %', p_fn, sqlerrm; return null;
end $$;
revoke all on function private.ci_kick_worker(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6) the contract, written from the campaign form
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_contract_clauses(p_terms jsonb, p_brand text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v jsonb := '[]'::jsonb; n int := coalesce(nullif(p_terms->>'ad_rights_months','')::int,1);
        d int := coalesce(nullif(p_terms->>'content_days','')::int,7); val text; v_days text; v_tags text;
begin
  v_days := d || ' day' || case when d > 1 then 's' else '' end;
  val := case when nullif(p_terms->>'product_value','') is not null then ' (worth ₹'||(p_terms->>'product_value')||')' else '' end;
  v := v || jsonb_build_array(jsonb_build_object('key','product','title','Product',
        'text', 'You will receive '||coalesce(p_terms->>'product','the product')||val||' from '||coalesce(p_brand,'the brand')
                ||' free of cost, in exchange for the content below. Once your content is posted, the product is yours to keep.'));
  v := v || jsonb_build_array(jsonb_build_object('key','deliverables','title','What you will make',
        'text', 'You will create and post: '||coalesce(nullif(p_terms->>'deliverables',''),'1 Reel')
                ||', within '||v_days||' of receiving the product, following the video brief shared in the app. '
                ||'Every one of them counts — the campaign is complete only when all of them are posted and their links are on the app.'));
  v_tags := btrim(coalesce(p_terms->>'hashtags','') || ' ' || coalesce(p_terms->>'mentions',''));
  if v_tags <> '' then
    v := v || jsonb_build_array(jsonb_build_object('key','tags','title','Hashtags & mentions',
          'text', 'Every post must use: '||v_tags||'.'));
  end if;
  v := v || jsonb_build_array(jsonb_build_object('key','approval','title','Post only after approval',
        'text', 'First submit your video in the app for review. You may post it on Instagram only after '||coalesce(p_brand,'the brand')
                ||' approves it in the app. Posting before approval, or posting a different cut, is a breach of this contract.'));
  v := v || jsonb_build_array(jsonb_build_object('key','asci','title','ASCI disclosure',
        'text', 'Every post must clearly disclose the collaboration as per the ASCI Guidelines for Influencer Advertising in Digital Media — '
                ||'use the "Paid partnership" label and/or #ad / #collab at the start of the caption. Do not make claims the brand has not approved.'));
  v := v || jsonb_build_array(jsonb_build_object('key','ad_rights','title','Ad rights — keep it live',
        'text', coalesce(p_brand,'The brand')||' may use your content (organic and as paid ads, including whitelisting) for '||n||' month'
                ||case when n>1 then 's' else '' end||' from the date you post. For those '||n||' month'||case when n>1 then 's' else '' end
                ||' your posts and reels for this campaign must stay live on your profile — do not delete or archive them. '
                ||'We check this automatically and remind you if one is missing.'));
  if coalesce((p_terms->>'collab_rights')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','collab','title','Collab rights',
          'text', 'You will add '||coalesce(p_brand,'the brand')||' as an Instagram collaborator on the post so it also appears on their profile.'));
  end if;
  if coalesce((p_terms->>'blacklist_clause')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','non_delivery','title','If you don''t deliver — blacklist',
          'text', 'If you receive the product and do not submit your video within '||v_days||' of delivery (we remind you on WhatsApp, email and in the app), '
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

create or replace function intel.ci_issue_contract(p_participation uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_stage text; v_pb jsonb; v_k jsonb; v_brand text; v_cid uuid; v_months int; v_signed timestamptz;
begin
  select p.campaign_id, p.stage into v_camp, v_stage from intel.ci_campaign_participation p where p.participation_id = p_participation;
  if v_camp is null then return null; end if;
  if v_stage not in ('brand_confirmed','accepted','contract_sent') then return null; end if;
  select signed_at into v_signed from intel.ci_campaign_contract where participation_id = p_participation;
  if v_signed is not null then return null; end if;

  v_pb := intel.ci_playbook(v_camp); v_k := v_pb->'contract';
  -- the contract also carries what the post must say: the campaign's hashtags + mentions
  v_k := v_k || jsonb_strip_nulls(jsonb_build_object('hashtags', nullif(btrim(v_pb->'brief'->>'hashtags'),''),
                                                     'mentions', nullif(btrim(v_pb->'brief'->>'mentions'),'')));
  select coalesce(b.name, c.submitted_brand_name) into v_brand
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = v_camp;
  v_months := coalesce((v_k->>'ad_rights_months')::int, 1);

  insert into intel.ci_campaign_contract(participation_id, campaign_id, terms_version, ad_rights_months, ad_rights_until,
      collab_rights, product, product_value, deliverables, content_days, clauses, issued_by)
  values (p_participation, v_camp, 'geek-barter-v2', v_months, (current_date + make_interval(months => v_months))::date,
      coalesce((v_k->>'collab_rights')::boolean, true), v_k->>'product', nullif(v_k->>'product_value','')::numeric,
      intel.ci_parse_deliverables(v_k->>'deliverables'), (v_k->>'content_days')::int,
      intel.ci_contract_clauses(v_k, v_brand), p_actor)
  on conflict (participation_id) do update set
      terms_version = excluded.terms_version, ad_rights_months = excluded.ad_rights_months, ad_rights_until = excluded.ad_rights_until,
      collab_rights = excluded.collab_rights, product = excluded.product, product_value = excluded.product_value,
      deliverables = excluded.deliverables, content_days = excluded.content_days, clauses = excluded.clauses,
      issued_by = excluded.issued_by, issued_at = now(), updated_at = now()
  returning contract_id into v_cid;

  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'contract', null, 'issued', p_actor, 'issued automatically from the campaign terms');
  if v_stage in ('brand_confirmed','accepted') then
    perform intel.ci_participation_advance(p_participation, 'contract_sent', p_actor, 'contract sent automatically');
  end if;
  return v_cid;
end $$;
-- ---------------------------------------------------------------------------------------------------
-- 4) video reminders follow the campaign's own "content due" days
--    daily 9:00 · last 3 days + the due day 9:00 and 18:30 · the morning after: block (only if the blacklist clause is on)
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_schedule_video_reminders(p_participation uuid, p_from timestamptz default now())
returns int language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; d0 date := (p_from at time zone 'Asia/Kolkata')::date; v_n int := 0; v_days int; v_black boolean; i int; v_left int;
begin
  select campaign_id into v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_camp is null then return 0; end if;
  select k.content_days into v_days from intel.ci_campaign_contract k where k.participation_id = p_participation;
  v_days := least(greatest(coalesce(v_days, nullif((intel.ci_playbook(v_camp)->'contract')->>'content_days','')::int, 7), 1), 60);
  v_black := coalesce(((intel.ci_playbook(v_camp)->'contract')->>'blacklist_clause')::boolean, true);
  update intel.ci_reminder set cancelled_at = now()
   where participation_id = p_participation and fired_at is null and cancelled_at is null
     and (kind like 'video%' or kind = 'auto_block');
  for i in 1..v_days loop
    v_left := v_days - i;                      -- days left after day i (0 = the due day)
    insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, cancel_on_stage)
    select p_participation, v_camp, 'video_d' || i || x.slot, x.tpl, x.at, 'content_submitted'
      from (values ('am', intel.ci_ist(d0 + i, '09:00'), case when v_left = 0 then 'video_final_warning' when v_left <= 2 then 'video_warning' else 'video_nudge' end),
                   ('pm', intel.ci_ist(d0 + i, '18:30'), case when v_left = 0 then 'video_final_warning' else 'video_warning' end)) x(slot, at, tpl)
     where x.at > now() and (x.slot = 'am' or v_left <= 2);
  end loop;
  if v_black then
    insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, cancel_on_stage)
    select p_participation, v_camp, 'auto_block', 'video_blocked', intel.ci_ist(d0 + v_days + 1, '09:00'), 'content_submitted'
     where intel.ci_ist(d0 + v_days + 1, '09:00') > now();
  end if;
  select count(*) into v_n from intel.ci_reminder where participation_id = p_participation and fired_at is null and cancelled_at is null
     and (kind like 'video%' or kind = 'auto_block');
  return v_n;
end $$;
revoke all on function intel.ci_schedule_video_reminders(uuid, timestamptz) from public, anon, authenticated;
grant execute on function intel.ci_schedule_video_reminders(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 5) the campaign's end date is close → everyone with something still to do hears about it at 9:00 and 18:30
-- ---------------------------------------------------------------------------------------------------
create table if not exists private.ci_deadline_reminder (
  participation_id uuid not null references intel.ci_campaign_participation(participation_id) on delete cascade,
  slot text not null,                    -- e.g. 2026-10-21:am
  sent_at timestamptz not null default now(),
  primary key (participation_id, slot)
);
alter table private.ci_deadline_reminder enable row level security;
revoke all on private.ci_deadline_reminder from public, anon, authenticated;
create table if not exists private.ci_deadline_team (
  campaign_id uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  slot text not null, sent_at timestamptz not null default now(), primary key (campaign_id, slot));
alter table private.ci_deadline_team enable row level security;
revoke all on private.ci_deadline_team from public, anon, authenticated;

-- what this creator still has to do, in words (null = nothing they can do right now)
create or replace function intel.ci_pending_action(p_participation uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare p record; pr jsonb;
begin
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or p.blocked_at is not null then return null; end if;
  if p.stage in ('brand_confirmed','accepted','contract_sent') then return 'sign your contract in the app'; end if;
  if p.stage = 'contract_signed' then return 'confirm your delivery address'; end if;
  if p.stage = 'product_sent' then return 'tap Received once your parcel arrives'; end if;
  if p.stage = 'content_created' then return 'submit your video'; end if;
  if p.stage = 'changes_requested' then return 'submit your video with the changes the brand asked for'; end if;
  if p.stage = 'content_approved' then
    pr := intel.ci_deliverables_progress(p_participation);
    return 'post your approved content (' || coalesce(nullif(pr->>'left',''), '1 Reel') || ') and add the links';
  end if;
  if p.stage = 'published' then
    pr := intel.ci_deliverables_progress(p_participation);
    if coalesce((pr->>'all_done')::boolean, false) then return null; end if;
    return 'post the rest — ' || coalesce(nullif(pr->>'left',''), 'your remaining posts') || ' — and add the links';
  end if;
  return null;
end $$;
revoke all on function intel.ci_pending_action(uuid) from public, anon, authenticated;

create or replace function intel.ci_run_deadline_reminders()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_slot text := v_today::text || ':' || case when extract(hour from now() at time zone 'Asia/Kolkata') < 14 then 'am' else 'pm' end;
        c record; r record; v_act text; v_n int := 0; v_team int := 0; v_left int; v_who text[]; v_cnt int;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return jsonb_build_object('skipped', 'off'); end if;
  for c in select cc.campaign_id, cc.name, cc.org_id, cc.ends_on from intel.ci_campaign cc
            where cc.ends_on is not null and cc.ends_on between v_today and v_today + 3
              and cc.lifecycle_status not in ('completed','cancelled') loop
    v_left := c.ends_on - v_today; v_who := '{}'; v_cnt := 0;
    for r in select p.participation_id, p.identity_id from intel.ci_campaign_participation p
              where p.campaign_id = c.campaign_id
                and p.stage in ('brand_confirmed','accepted','contract_sent','contract_signed','product_sent','content_created',
                                'changes_requested','content_approved','published') loop
      v_act := intel.ci_pending_action(r.participation_id);
      continue when v_act is null;
      v_cnt := v_cnt + 1;
      if cardinality(v_who) < 5 then
        v_who := v_who || coalesce((select '@' || lower(sa.username) from public.social_accounts sa
                                     where sa.member_id = intel.ci_member_of_identity(r.identity_id) and sa.platform = 'instagram' limit 1), 'a creator');
      end if;
      continue when exists (select 1 from private.ci_deadline_reminder x where x.participation_id = r.participation_id and x.slot = v_slot);
      begin
        perform intel.ci_notify(intel.ci_member_of_identity(r.identity_id), c.campaign_id, r.participation_id, 'deadline_reminder',
          jsonb_build_object('campaign', coalesce(c.name, 'your campaign'), 'pending', v_act,
                             'ends', to_char(c.ends_on, 'DD Mon'),
                             'when', case v_left when 0 then 'today' when 1 then 'tomorrow' else 'in ' || v_left || ' days' end));
        insert into private.ci_deadline_reminder(participation_id, slot) values (r.participation_id, v_slot) on conflict do nothing;
        v_n := v_n + 1;
      exception when others then raise warning 'deadline reminder skipped: %', sqlerrm;
      end;
    end loop;
    -- the team: one summary per campaign in the morning
    if v_cnt > 0 and v_slot like '%:am' and not exists (select 1 from private.ci_deadline_team x where x.campaign_id = c.campaign_id and x.slot = v_slot) then
      begin
        insert into private.ci_deadline_team(campaign_id, slot) values (c.campaign_id, v_slot) on conflict do nothing;
        perform intel.ci_alert_org(c.org_id, coalesce(c.name, 'Campaign') || ' ends ' || case v_left when 0 then 'today' when 1 then 'tomorrow' else 'in ' || v_left || ' days' end,
          v_cnt || ' creator' || case when v_cnt > 1 then 's' else '' end || ' still to finish: ' || array_to_string(v_who, ', ')
          || case when v_cnt > cardinality(v_who) then ' and ' || (v_cnt - cardinality(v_who)) || ' more' else '' end
          || '. They get a reminder at 9:00 and 18:30.', 'campaigns', 'Open', 'action_required', null);
        v_team := v_team + 1;
      exception when others then null; end;
    end if;
  end loop;
  return jsonb_build_object('slot', v_slot, 'creators', v_n, 'teams', v_team);
end $$;
revoke all on function intel.ci_run_deadline_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- messages: app + email + WhatsApp (new fixed-text UTILITY templates)
-- ---------------------------------------------------------------------------------------------------
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label, active) values
  ('posts_pending', 'action_required', '{{campaign}}: {{done}} of {{need}} posted — keep going',
   'Your post is recorded ✓. To complete **{{campaign}}**, post {{left}} and add the links in the app. The campaign completes when every post is up.',
   'mycampaigns', 'Post the rest', true),
  ('deadline_reminder', 'action_required', '{{campaign}} ends {{when}} ⏰',
   '**{{campaign}}** ends {{when}} ({{ends}}). Still to do: **{{pending}}**. Please finish it in the app before the end date.',
   'mycampaigns', 'Finish now', true),
  ('post_restore', 'action_required', 'Please restore your {{campaign}} {{kind}}',
   'We can''t find your {{kind}} for **{{campaign}}** on Instagram any more. As per your contract it must stay live until **{{until}}** (ad rights). Please restore it (unarchive) or post it again, and keep it live.',
   'mycampaigns', 'Open campaign', true)
on conflict (template_key) do update set kind = excluded.kind, title = excluded.title, body_md = excluded.body_md,
  action_route = excluded.action_route, action_label = excluded.action_label, active = true;

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('posts_pending', 'geek_step_posts_pending', 'Hi *{{1}}*,

Thank you for posting your content for the campaign *{{2}}* with *{{3}}*. Some posts from your deliverables are still pending.

Next, please post the remaining content and add the links on the app. Once that is done, we will complete your campaign.

Post the rest here: {{4}}

Thank you!
Team Geek Animals', null),
('deadline_reminder', 'geek_step_deadline', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. The campaign end date is close and some of your steps are still pending.

Next, please open the app and complete your pending steps for this campaign. Once that is done, we will update your campaign status.

Finish your steps here: {{4}}

Thank you!
Team Geek Animals', null),
('post_restore', 'geek_step_restore_post', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. We could not find your campaign post or reel on your Instagram profile.

Next, please restore it (unarchive) or post it again, and keep it live for the ad rights period in your contract. Once that is done, we will update your campaign status.

See the details here: {{4}}

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body, update_text = excluded.update_text;

-- ---------------------------------------------------------------------------------------------------
-- 7) step templates are created at Meta as UTILITY (when WHATSAPP_WABA_ID + token are set) — status kept here
-- ---------------------------------------------------------------------------------------------------
create table if not exists private.ci_step_wa_status (
  wa_template text primary key,
  status text not null default 'queued',      -- queued | submitted | approved | rejected | failed | manual
  error text,
  updated_at timestamptz not null default now()
);
alter table private.ci_step_wa_status enable row level security;
revoke all on private.ci_step_wa_status from public, anon, authenticated;
insert into private.ci_step_wa_status(wa_template, status)
  select distinct wa_template, case when wa_template in ('geek_step_posts_pending','geek_step_deadline','geek_step_restore_post') then 'queued' else 'approved' end
    from intel.ci_step_wa
on conflict (wa_template) do nothing;

create or replace function api.ops_step_templates_claim()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('wa_template', s.wa_template, 'status', s.status,
           'body', (select w.body from intel.ci_step_wa w where w.wa_template = s.wa_template order by w.template_key limit 1))), '[]'::jsonb)
    from private.ci_step_wa_status s where s.status in ('queued','submitted','manual') $$;
revoke all on function api.ops_step_templates_claim() from public, anon, authenticated;
grant execute on function api.ops_step_templates_claim() to service_role;

create or replace function api.ops_step_template_set(p_name text, p_status text, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update private.ci_step_wa_status set status = p_status, error = left(p_error, 300), updated_at = now() where wa_template = p_name $$;
revoke all on function api.ops_step_template_set(text, text, text) from public, anon, authenticated;
grant execute on function api.ops_step_template_set(text, text, text) to service_role;

-- Super Admin: every step template with its exact text + status (to create in snapto / Meta by hand when needed)
create or replace function public.admin_step_templates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', s.wa_template, 'status', s.status, 'error', s.error, 'at', s.updated_at,
            'body', (select w.body from intel.ci_step_wa w where w.wa_template = s.wa_template order by w.template_key limit 1),
            'used_for', (select array_agg(w.template_key order by w.template_key) from intel.ci_step_wa w where w.wa_template = s.wa_template))
          order by (s.status = 'approved'), s.wa_template) from private.ci_step_wa_status s), '[]'::jsonb);
end $$;
revoke all on function public.admin_step_templates() from public, anon;
grant execute on function public.admin_step_templates() to authenticated;

create or replace function public.admin_step_template_mark(p_name text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  if p_status not in ('approved','queued') then raise exception 'status must be approved or queued' using errcode = '22023'; end if;
  update private.ci_step_wa_status set status = p_status, error = null, updated_at = now() where wa_template = p_name;
end $$;
revoke all on function public.admin_step_template_mark(text, text) from public, anon;
grant execute on function public.admin_step_template_mark(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- schedules (UTC): 03:30 = 9:00 IST · 13:00 = 18:30 IST · posts every hour
-- ---------------------------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-deadline-am', '30 3 * * *', $c$select intel.ci_run_deadline_reminders()$c$);
    perform cron.schedule('ci-deadline-pm', '0 13 * * *', $c$select intel.ci_run_deadline_reminders()$c$);
    perform cron.schedule('ci-post-insights', '17 * * * *', $c$select private.ci_kick_worker('ci-post-insights-worker')$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- campaigns already running: video reminders re-planned on the new rule (only future ones; nothing is sent now)
do $$ declare r record; begin
  for r in select distinct m.participation_id, min(m.created_at) as since from intel.ci_reminder m
             join intel.ci_campaign_participation p on p.participation_id = m.participation_id
            where m.kind like 'video%' and m.fired_at is null and m.cancelled_at is null
              and p.stage in ('content_created','changes_requested')
            group by m.participation_id loop
    begin perform intel.ci_schedule_video_reminders(r.participation_id, r.since);
    exception when others then raise warning 'reminder re-plan skipped: %', sqlerrm; end;
  end loop;
end $$;

-- the creator adds a post link: it must be an Instagram link, and the same post isn't counted twice
create or replace function api.record_campaign_post(p_participation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_owner uuid; v_camp uuid; v_stage text; v_pid uuid; v_mt text; v_verdict text;
        v_link text := nullif(btrim(coalesce(p_payload->>'permalink','')), ''); v_mid text := nullif(btrim(coalesce(p_payload->>'external_media_id','')), '');
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  select identity_id, campaign_id, stage into v_owner, v_camp, v_stage from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your participation' using errcode='42501'; end if;
  v_mt := lower(coalesce(p_payload->>'media_type','reel'));
  if v_mt not in ('reel','story','post','live') then raise exception 'invalid media_type %', v_mt using errcode='22023'; end if;
  if v_link is not null and v_link !~* '^https?://(www\.|m\.)?instagram\.com/' then
    raise exception 'paste the Instagram link of the post (instagram.com/reel/… , /p/… or /stories/…)' using errcode = '22023'; end if;
  if v_link is null and v_mid is null then raise exception 'add the link of your post' using errcode = '22023'; end if;
  if v_link ~* '/stories/' then v_mt := 'story'; end if;
  select post_id into v_pid from intel.ci_campaign_post
   where participation_id = p_participation
     and ((v_mid is not null and external_media_id = v_mid) or (v_link is not null and intel.ci_norm_permalink(permalink) = intel.ci_norm_permalink(v_link)))
   limit 1;
  if v_pid is not null then
    return jsonb_build_object('post_id', v_pid, 'already', true, 'progress', intel.ci_deliverables_progress(p_participation));
  end if;
  insert into intel.ci_campaign_post(participation_id, campaign_id, media_type, permalink, caption, external_media_id)
    values (p_participation, v_camp, v_mt, v_link, nullif(p_payload->>'caption',''), v_mid)
    returning post_id into v_pid;
  v_verdict := intel.ci_check_caption_tags(p_participation, 'post', v_pid, p_payload->>'caption', v_uid);
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'submission', null, 'posted', v_uid, v_mt);
  if v_stage='content_approved' then perform intel.ci_participation_advance(p_participation, 'published', v_uid, 'posted from app'); end if;
  return jsonb_build_object('post_id', v_pid, 'caption_check', v_verdict,
    'stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation),
    'progress', intel.ci_deliverables_progress(p_participation));
end $$;
revoke all on function api.record_campaign_post(uuid,jsonb) from public, anon;
grant execute on function api.record_campaign_post(uuid,jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 8) posts are found on their own — by the server, every hour, from the creator's own Instagram (no app open needed)
--    For a creator whose video is approved: every post after the approval that carries the campaign's #hashtag /
--    @mention is this campaign's post and its link is saved. Stories (Instagram gives no caption for stories) and
--    campaigns without tags: the first posts of the kinds still needed count (e.g. 2 Reels + 1 Post → the first 2 reels
--    and the first feed post after approval). The same Instagram post never counts for two campaigns.
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_ig_code(p text)
returns text language sql immutable set search_path = '' as $$
  select coalesce((regexp_match(coalesce(p,''), 'instagram\.com/(?:[^/]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)', 'i'))[1],
                  'story:' || (regexp_match(coalesce(p,''), 'instagram\.com/stories/[^/]+/([0-9]+)', 'i'))[1],
                  intel.ci_norm_permalink(p)) $$;

create or replace function intel.ci_media_kind(m jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when upper(coalesce(m->>'media_product_type','')) = 'STORY' then 'story'
              when upper(coalesce(m->>'media_product_type','')) = 'REELS' then 'reel'
              when upper(coalesce(m->>'media_type','')) in ('VIDEO','REELS') then 'reel'
              else 'post' end $$;

create or replace function intel.ci_autodetect_from(p_member uuid, p_media jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; m jsonb; v_tags text[]; v_since timestamptz; v_pid uuid; v_n int := 0; v_kind text; v_cap text;
        v_left jsonb; v_need int; v_tagged boolean; v_code text;
begin
  if p_member is null or jsonb_typeof(coalesce(p_media,'null'::jsonb)) <> 'array' then return 0; end if;
  for r in select p.participation_id, p.campaign_id, p.stage from intel.ci_campaign_participation p
             join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.access_role = 'self' and a.revoked_at is null
            where a.member_id = p_member and p.stage in ('content_approved','published') and p.blocked_at is null
            order by p.updated_at loop
    v_tags := intel.ci_campaign_tags(r.campaign_id);
    select min(ev.at) into v_since from intel.ci_campaign_event ev
     where ev.participation_id = r.participation_id and ev.entity = 'participation' and ev.to_status = 'content_approved';
    v_since := coalesce(v_since, now() - interval '2 days') - interval '10 minutes';
    -- what is still needed, per kind: {"reel":1,"story":2,"post":0}
    select coalesce(jsonb_object_agg(case i->>'kind' when 'feed' then 'post' else i->>'kind' end, greatest((i->>'need')::int - (i->>'done')::int, 0)), '{}'::jsonb)
      into v_left from jsonb_array_elements(coalesce(intel.ci_deliverables_progress(r.participation_id)->'items','[]'::jsonb)) i;
    for m in select e from jsonb_array_elements(p_media) e
              where nullif(e->>'timestamp','') is not null and (e->>'timestamp')::timestamptz >= v_since
              order by (e->>'timestamp')::timestamptz loop
      v_code := intel.ci_ig_code(m->>'permalink');
      -- already on a campaign (this one or another)
      continue when exists (select 1 from intel.ci_campaign_post po
                             where (nullif(m->>'id','') is not null and po.external_media_id = m->>'id')
                                or (v_code is not null and intel.ci_ig_code(po.permalink) = v_code));
      v_kind := intel.ci_media_kind(m);
      v_need := coalesce((v_left->>v_kind)::int, 0);
      v_cap := lower(coalesce(m->>'caption',''));
      v_tagged := cardinality(v_tags) > 0 and exists (select 1 from unnest(v_tags) t where position(t in v_cap) > 0);
      if v_kind = 'story' or cardinality(v_tags) = 0 then
        continue when v_need <= 0 and not v_tagged;        -- no caption to match: only the kinds still needed
      else
        continue when not v_tagged;                         -- feed posts / reels must carry the campaign's tags
      end if;
      insert into intel.ci_campaign_post(participation_id, campaign_id, media_type, permalink, caption, external_media_id, posted_at)
      values (r.participation_id, r.campaign_id, v_kind, nullif(m->>'permalink',''), nullif(m->>'caption',''), nullif(m->>'id',''),
              coalesce(nullif(m->>'timestamp','')::timestamptz, now()))
      returning post_id into v_pid;
      v_left := v_left || jsonb_build_object(v_kind, greatest(v_need - 1, 0));
      begin perform intel.ci_check_caption_tags(r.participation_id, 'post', v_pid, m->>'caption', null); exception when others then null; end;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
      values (r.campaign_id, r.participation_id, 'submission', null, 'posted', null, v_kind || ' found on Instagram automatically');
      if r.stage = 'content_approved' then
        perform intel.ci_participation_advance(r.participation_id, 'published', null, 'post found on Instagram automatically');
        r.stage := 'published';
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_autodetect_from(uuid, jsonb) from public, anon, authenticated;

-- the Media Kit sync (creator opens the app) uses the same rules
create or replace function intel.ci_autodetect_posts(p_member uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_media jsonb;
begin
  -- links the team added by hand: match them to the creator's synced Instagram media so the numbers load
  update intel.ci_campaign_post po set external_media_id = mm.e->>'id'
    from public.social_accounts sa, jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb) || coalesce(sa.recent_stories,'[]'::jsonb)) as mm(e)
   where po.external_media_id is null and po.permalink is not null and sa.member_id = p_member and sa.platform = 'instagram'
     and intel.ci_ig_code(mm.e->>'permalink') = intel.ci_ig_code(po.permalink)
     and intel.ci_member_of_identity((select identity_id from intel.ci_campaign_participation x where x.participation_id = po.participation_id)) = p_member;
  select coalesce(sa.recent_media,'[]'::jsonb)
         || coalesce((select jsonb_agg(s || '{"media_product_type":"STORY"}'::jsonb) from jsonb_array_elements(coalesce(sa.recent_stories,'[]'::jsonb)) s), '[]'::jsonb)
    into v_media from public.social_accounts sa where sa.member_id = p_member and sa.platform = 'instagram' limit 1;
  return intel.ci_autodetect_from(p_member, coalesce(v_media, '[]'::jsonb));
end $$;
revoke all on function intel.ci_autodetect_posts(uuid) from public, anon, authenticated;

-- the worker: which creators to look at (video approved / posting, still something to post) …
create or replace function api.ops_detect_members(p_limit int default 200)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(distinct m.member_id), '[]'::jsonb) from (
    select intel.ci_member_of_identity(p.identity_id) as member_id
      from intel.ci_campaign_participation p
     where p.stage in ('content_approved','published') and p.blocked_at is null
       and not coalesce((intel.ci_deliverables_progress(p.participation_id)->>'all_done')::boolean, false)
     limit greatest(coalesce(p_limit, 200), 1)) m
  where m.member_id is not null $$;
revoke all on function api.ops_detect_members(int) from public, anon, authenticated;
grant execute on function api.ops_detect_members(int) to service_role;

-- … and what it found on their Instagram (posts + live stories, newest 50)
create or replace function api.ops_detect_posts(p_member uuid, p_media jsonb)
returns int language sql security definer set search_path = '' as $$
  select intel.ci_autodetect_from(p_member, p_media) $$;
revoke all on function api.ops_detect_posts(uuid, jsonb) from public, anon, authenticated;
grant execute on function api.ops_detect_posts(uuid, jsonb) to service_role;
