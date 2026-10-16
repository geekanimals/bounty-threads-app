-- Posting closes the campaign:
--   • the creator posts from the app (Let's post) — or it's auto-detected on their Instagram;
--   • can't post from the app? they send the link to the Geek team (WhatsApp / anything) and the team / Super Admin
--     adds it on the creator's card ("Add post link") — the numbers are fetched from there;
--   • the moment it's posted the campaign is COMPLETE and the numbers show everywhere (creator, campaign, reports);
--     feedback is optional — they can still give it, and when they apply to their next campaign they're reminded
--     to share feedback for the earlier one.

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
      perform intel.ci_participation_advance(new.participation_id, 'completed', new.actor_member_id, 'posted — campaign complete');
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

create or replace function intel.ci_autodetect_posts(p_member uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare r record; m jsonb; v_tags text[]; v_since timestamptz; v_pid uuid; v_n int := 0; v_mt text; v_cap text; v_name text;
begin
  -- links the team added by hand: match them to the creator's synced Instagram media so the numbers load
  update intel.ci_campaign_post po set external_media_id = mm.e->>'id'
    from public.social_accounts sa, jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb) || coalesce(sa.recent_stories,'[]'::jsonb)) as mm(e)
   where po.external_media_id is null and po.permalink is not null and sa.member_id = p_member and sa.platform = 'instagram'
     and intel.ci_norm_permalink(mm.e->>'permalink') = intel.ci_norm_permalink(po.permalink)
     and intel.ci_member_of_identity((select identity_id from intel.ci_campaign_participation x where x.participation_id = po.participation_id)) = p_member;
  for r in select p.participation_id, p.campaign_id, p.stage from intel.ci_campaign_participation p
             join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.access_role = 'self' and a.revoked_at is null
            where a.member_id = p_member and p.stage in ('content_approved','published','completed') loop
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
        -- (posting completes the campaign; the "complete" message goes from there)
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;

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
  if p.stage = 'published' then perform intel.ci_participation_advance(p_participation, 'completed', auth.uid(), 'creator feedback submitted'); end if;
  return jsonb_build_object('stage', 'completed', 'feedback', true);
end $$;

create or replace function api.bp_mark_done(p_participation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_stage text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage = 'completed' then return jsonb_build_object('stage', 'completed'); end if;
  if v_stage <> 'published' then raise exception 'the creator has not posted yet (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  update intel.ci_campaign_participation set feedback_requested_at = coalesce(feedback_requested_at, now()) where participation_id = p_participation;
  perform intel.ci_participation_advance(p_participation, 'completed', auth.uid(), 'marked complete by the team');
  return jsonb_build_object('stage', 'completed');
end $$;

create or replace function api.get_my_posting_rules()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_uid uuid; v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null
   order by a.granted_at limit 1;
  if v_identity is null then return '[]'::jsonb; end if;

  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id,
      'campaign_id', c.campaign_id,
      'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name),
      'stage', p.stage,
      'can_record_post', p.stage in ('content_approved', 'published', 'completed'),
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb),
      'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'product', pb->'contract'->>'product',
      'collab_rights', coalesce((pb->'contract'->>'collab_rights')::boolean, true),
      'caption', pb->'brief'->>'caption',
      'brief_hashtags', pb->'brief'->>'hashtags',
      'brief_mentions', pb->'brief'->>'mentions',
      'posting_note', pb->'brief'->>'posting_note',
      'deliverables_text', pb->'brief'->>'deliverables_text',
      'approved_video', (select s.content_url from intel.ci_campaign_submission s
                           join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                          where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
      -- what still has to go up: [{kind: reel|story|feed, label, need, done}]
      'formats', (
        with req as (
          select case f.k when 'reel' then 'reel' when 'story' then 'story' else 'feed' end as kind, sum(f.q)::int as need
            from (select d.content_format as k, greatest(coalesce(d.quantity,1),1) as q
                    from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id
                  union all
                  select x->>'format_key', greatest(coalesce(nullif(x->>'quantity','')::int,1),1)
                    from jsonb_array_elements(coalesce(intel.ci_parse_deliverables(pb->'contract'->>'deliverables'), '[]'::jsonb)) x
                   where not exists (select 1 from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id)) f
           where f.k in ('reel','story','static_post','carousel')
           group by 1),
        req2 as (select * from req union all select 'reel', 1 where not exists (select 1 from req)),
        done as (
          select case po.media_type when 'reel' then 'reel' when 'story' then 'story' else 'feed' end as kind, count(*)::int as n
            from intel.ci_campaign_post po where po.participation_id = p.participation_id group by 1)
        select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind,
                 'label', case r.kind when 'reel' then 'Reel' when 'story' then 'Story' else 'Post' end,
                 'need', r.need, 'done', coalesce(dn.n, 0))
               order by case r.kind when 'reel' then 1 when 'feed' then 2 else 3 end), '[]'::jsonb)
          from req2 r left join done dn on dn.kind = r.kind))
      order by p.updated_at desc)
    from intel.ci_campaign_participation p
    join intel.ci_campaign c on c.campaign_id = p.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x
                        where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    cross join lateral (select intel.ci_playbook(c.campaign_id) as pb) pl
    where p.identity_id = v_identity
      and p.stage not in ('rejected', 'dropped', 'ineligible', 'brand_declined', 'completed')), '[]'::jsonb);
end $$;

-- team / Super Admin: add the post link the creator sent (when they couldn't post from the app)
create or replace function api.bp_add_post_link(p_participation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_stage text; v_camp uuid; v_link text := btrim(coalesce(p_payload->>'permalink',''));
        v_mt text := lower(coalesce(nullif(p_payload->>'media_type',''),'reel')); v_pid uuid; v_g int := 0;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_link !~* '^https?://(www\.|m\.)?instagram\.com/(reel|reels|p|tv|stories)/' then
    raise exception 'paste the Instagram link of the post (instagram.com/reel/… or /p/…)' using errcode = '22023'; end if;
  if v_mt not in ('reel','story','post') then v_mt := 'reel'; end if;
  if v_link ~* '/stories/' then v_mt := 'story'; end if;
  select stage, campaign_id into v_stage, v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage not in ('content_created','content_submitted','changes_requested','content_approved','published','completed') then
    raise exception 'a post link can be added once the creator has the video brief (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  if exists (select 1 from intel.ci_campaign_post where participation_id = p_participation and intel.ci_norm_permalink(permalink) = intel.ci_norm_permalink(v_link)) then
    raise exception 'this link is already on the campaign' using errcode = '22023'; end if;
  insert into intel.ci_campaign_post(participation_id, campaign_id, media_type, permalink, posted_at)
  values (p_participation, v_camp, v_mt, v_link, now()) returning post_id into v_pid;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'submission', null, 'posted', v_uid, v_mt || ' — link added by the team');
  -- walk to "posted" (which completes the campaign)
  loop
    v_g := v_g + 1; exit when v_g > 5;
    select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
    if v_stage in ('content_created','changes_requested') then perform intel.ci_participation_advance(p_participation, 'content_submitted', v_uid, 'posted — link added by the team');
    elsif v_stage = 'content_submitted' then perform intel.ci_participation_advance(p_participation, 'content_approved', v_uid, 'posted — link added by the team');
    elsif v_stage = 'content_approved' then perform intel.ci_participation_advance(p_participation, 'published', v_uid, 'posted — link added by the team');
    else exit; end if;
  end loop;
  return jsonb_build_object('post_id', v_pid, 'stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation),
                            'matched', (select external_media_id is not null from intel.ci_campaign_post where post_id = v_pid));
end $$;
revoke all on function api.bp_add_post_link(uuid,jsonb) from public, anon;
grant execute on function api.bp_add_post_link(uuid,jsonb) to authenticated;

-- applying to the next campaign → a reminder to share feedback for the finished one(s)
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label, active) values
  ('feedback_pending','action_required','Share your feedback for {{campaign}}',
   'Thanks for applying again! Before your next campaign, please share your quick feedback for **{{campaign}}** — it takes 30 seconds.',
   'mycampaigns','Give feedback', true)
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md, action_route = excluded.action_route,
  action_label = excluded.action_label, active = true;
insert into intel.ci_step_copy(template_key, did, next_step, then_we) values
  ('feedback_pending', 'completing {{campaign}} with {{brand}}', 'share your quick feedback for that campaign in the app',
   'keep improving the campaigns we bring you')
on conflict (template_key) do update set did = excluded.did, next_step = excluded.next_step, then_we = excluded.then_we;

create or replace function intel.tg_feedback_pending()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; v_member uuid;
begin
  if coalesce(current_setting('geek.bulk_quiet', true), '') = 'on' then return null; end if;
  v_member := intel.ci_member_of_identity(new.identity_id);
  if v_member is null then return null; end if;
  for r in select p.participation_id, p.campaign_id, c.name from intel.ci_campaign_participation p
             join intel.ci_campaign c on c.campaign_id = p.campaign_id
            where p.identity_id = new.identity_id and p.participation_id <> new.participation_id
              and p.stage = 'completed' and p.feedback_at is null
            order by p.updated_at desc limit 3 loop
    continue when exists (select 1 from intel.ci_notification n where n.recipient_member_id = v_member
                            and n.participation_id = r.participation_id and n.dedupe_key like 'feedback_pending:%'
                            and n.created_at > now() - interval '1 day');
    perform intel.ci_notify(v_member, r.campaign_id, r.participation_id, 'feedback_pending', jsonb_build_object('campaign', coalesce(r.name, 'your last campaign')));
  end loop;
  return null;
exception when others then return null;     -- never block an application
end $$;
drop trigger if exists ci_participation_feedback_pending on intel.ci_campaign_participation;
create trigger ci_participation_feedback_pending after insert on intel.ci_campaign_participation
  for each row execute function intel.tg_feedback_pending();
