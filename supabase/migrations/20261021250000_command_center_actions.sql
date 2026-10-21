-- Campaign command center: what the team must do, done from where they see it.
--  1. api.admin_todo            — one "to do" list (the 🔔 for the team): every creator stuck on the team, every
--                                  account / campaign waiting for approval, WhatsApp chats the bot handed over,
--                                  delete requests. Live from the data, so it is never stale.
--  2. api.admin_remove_from_campaign — Super Admin removes a creator (in the campaign, or only uploaded / invited)
--  3. api.invite_messages       — every WhatsApp / email sent to an invited (not registered) creator + their chat
--  4. posts: a story can be added with its screenshot (no link needed) and the numbers read from it;
--     typed / screenshot numbers are saved on the post; invited creators get the same (kept on the invite and
--     moved onto their campaign posts the moment they join); the report shows all of it.

-- ===================================================== 1. to do =====================================================
create or replace function api.admin_todo(p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_team boolean; v_apv jsonb := '{}'::jsonb; v_proc jsonb := '[]'::jsonb;
        v_cid uuid; v_items jsonb;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin();
  v_team := v_admin or intel.ci_is_agency_operator()
            or exists (select 1 from public.members m where m.id = v_uid and m.role in ('owner','brand','manager','corporate') and coalesce(m.status,'active') = 'active');
  if not v_team then return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'campaigns', '[]'::jsonb); end if;
  if p_campaign is not null then
    v_cid := intel.ci_resolve_campaign(p_campaign);
    if v_cid is null then return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'campaigns', '[]'::jsonb); end if;
  end if;
  begin v_apv := api.approvals_inbox(); exception when others then v_apv := '{}'::jsonb; end;
  begin v_proc := api.process_inbox(); exception when others then v_proc := '[]'::jsonb; end;

  with cr as (   -- creators waiting on the team (screening / brand's list / brand decision)
    select a.value as r from jsonb_array_elements(coalesce(v_apv->'applicants','[]'::jsonb)) a
  ), items as (
    select jsonb_build_object('key', (r->>'stage') || ':' || (r->>'participation_id'),
             'kind', case r->>'stage' when 'applied' then 'screen' when 'eligible' then 'add_list' else 'brand' end,
             'rank', case r->>'stage' when 'applied' then 5 when 'eligible' then 6 else 7 end,
             'title', case r->>'stage' when 'applied' then 'Screen ' when 'eligible' then 'Add to the brand''s list: ' else 'Brand''s decision for ' end
                      || coalesce('@' || nullif(r->'creator'->>'username',''), '@' || nullif(r->>'applied_profile',''), 'a creator'),
             'body', case r->>'stage' when 'applied' then 'Applied — check them against the brief.'
                                      when 'eligible' then 'Cleared screening — add them to the list the brand signs off.'
                                      else 'On the brand''s list — record what the brand said.' end,
             'since', r->>'applied_at', 'participation_id', r->>'participation_id',
             'campaign_id', r->>'campaign_id', 'open_id', coalesce(r->>'legacy_campaign_id', r->>'campaign_id'),
             'campaign', r->>'campaign_name', 'brand', r->>'brand',
             'handle', coalesce(nullif(r->'creator'->>'username',''), r->>'applied_profile'),
             'pic', r->'creator'->>'profile_picture_url', 'followers', r->'creator'->'followers') it
      from cr
    union all
    select jsonb_build_object('key', (r->>'kind') || ':' || (r->>'participation_id'), 'kind', r->>'kind',
             'rank', (r->>'rank')::int,
             'title', case r->>'kind'
                 when 'blocked' then 'Call ' || h.h || ' — blocked (no video after delivery)'
                 when 'review' then 'Review ' || h.h || '''s video'
                 when 'ship' then 'Ship the product to ' || h.h
                 when 'deliver' then 'Did ' || h.h || '''s parcel arrive?'
                 when 'overdue' then h.h || '''s video is overdue'
                 when 'contract' then 'Send the contract to ' || h.h
                 when 'unsigned' then h.h || ' hasn''t signed the contract'
                 else h.h end,
             'body', case r->>'kind'
                 when 'blocked' then 'Call them, note what they said and unblock with a new date.' || coalesce(' Last call: “' || (r->>'call_note') || '”', '')
                 when 'review' then 'The video is in — approve it or ask for changes.'
                 when 'ship' then 'Address confirmed — book the courier and add the tracking.'
                 when 'deliver' then 'Shipped — mark delivered when it reaches them (the video brief goes out then).'
                 when 'overdue' then 'Was due ' || coalesce(to_char((r->>'due_on')::date, 'DD Mon'), 'earlier') || ' — message or call them.'
                 when 'contract' then 'The brand said yes — the contract hasn''t gone out yet.'
                 when 'unsigned' then 'Sent 3+ days ago — remind them on WhatsApp or resend it.'
                 else '' end,
             'since', r->>'since', 'participation_id', r->>'participation_id',
             'campaign_id', r->>'campaign_id', 'open_id', coalesce(r->>'legacy_campaign_id', r->>'campaign_id'),
             'campaign', r->>'campaign_name', 'brand', r->>'brand', 'handle', nullif(r->'creator'->>'username',''),
             'pic', r->'creator'->>'profile_picture_url', 'phone', r->>'phone', 'video_url', r->>'video_url') it
      from jsonb_array_elements(coalesce(v_proc,'[]'::jsonb)) x(r)
      cross join lateral (select coalesce('@' || nullif(r->'creator'->>'username',''), nullif(r->'creator'->>'name',''), 'a creator') h) h
    union all
    select jsonb_build_object('key', 'signup:' || (s->>'id'), 'kind', 'signup', 'rank', 3,
             'title', 'Approve account: ' || coalesce(s->>'name', s->>'org_name', 'new sign-up'),
             'body', initcap(coalesce(s->>'role','')) || coalesce(' · ' || (s->>'org_name'), '') || coalesce(' · ' || (s->>'email'), ''),
             'since', s->>'created_at', 'route', 'admin:approvals') it
      from jsonb_array_elements(coalesce(v_apv->'signups','[]'::jsonb)) x(s)
    union all
    select jsonb_build_object('key', 'campaign:' || (c->>'id'), 'kind', 'campaign_approval', 'rank', 4,
             'title', 'Campaign waiting for approval: ' || coalesce(c->>'name', 'untitled'),
             'body', concat_ws(' · ', nullif(c->>'brand',''), nullif(c->>'org_name','')),
             'since', c->>'created_at', 'open_id', c->>'id', 'campaign', c->>'name', 'brand', c->>'brand',
             'campaign_id', (select k.campaign_id from intel.ci_campaign k where k.legacy_campaign_id = (c->>'id')::uuid limit 1)) it
      from jsonb_array_elements(coalesce(v_apv->'campaigns','[]'::jsonb)) x(c)
    union all
    -- WhatsApp chats the bot handed to a person, nobody from the team has answered yet
    select jsonb_build_object('key', 'wa:' || j.phone_e164, 'kind', 'whatsapp', 'rank', 2,
             'title', 'Reply on WhatsApp: ' || coalesce((select m.name from public.wa_contacts w join public.members m on m.id = w.user_id
                                                          where w.phone_e164 = j.phone_e164 limit 1), j.phone_e164),
             'body', '“' || left(coalesce(j.question, ''), 160) || '” — the bot asked the team to answer.',
             'since', j.created_at, 'phone', j.phone_e164,
             'campaign_id', j.campaign_id, 'open_id', (select coalesce(k.legacy_campaign_id, k.campaign_id) from intel.ci_campaign k where k.campaign_id = j.campaign_id),
             'campaign', (select k.name from intel.ci_campaign k where k.campaign_id = j.campaign_id)) it
      from (select distinct on (b.phone_e164) b.* from private.wa_bot_job b
             where v_admin and b.handoff and b.created_at > now() - interval '3 days' and b.status in ('sent','skipped','failed')
             order by b.phone_e164, b.created_at desc) j
     where intel.ci_bot_team_replied_at(j.phone_e164, j.created_at) is null
    union all
    select jsonb_build_object('key', 'del:' || d.id, 'kind', 'delete_request', 'rank', 8,
             'title', 'Delete request: ' || coalesce(d.campaign_name, 'a campaign'),
             'body', concat_ws(' · ', d.requester, d.org_name, nullif(d.reason,'')), 'since', d.created_at,
             'open_id', d.campaign_id, 'campaign', d.campaign_name, 'brand', d.brand, 'route', 'admin:campaigns') it
      from public.campaign_delete_requests d where v_admin and d.status = 'pending'
  )
  select coalesce(jsonb_agg(it order by (it->>'rank')::int, it->>'since'), '[]'::jsonb) into v_items
    from items where v_cid is null or (it->>'campaign_id')::uuid = v_cid;

  return jsonb_build_object('items', v_items, 'total', jsonb_array_length(v_items),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign_id', cid, 'open_id', oid, 'campaign', cname, 'count', n) order by n desc)
        from (select it->>'campaign_id' cid, max(it->>'open_id') oid, max(it->>'campaign') cname, count(*) n
                from jsonb_array_elements(v_items) e(it) where it->>'campaign_id' is not null group by 1) g), '[]'::jsonb));
end $$;
revoke all on function api.admin_todo(uuid) from public, anon;
grant execute on function api.admin_todo(uuid) to authenticated;

-- ============================================ 2. remove from a campaign ============================================
create or replace function api.admin_remove_from_campaign(p_participation uuid default null, p_invite uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_n int := 0; v_inv int := 0;
begin
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can delete a creator from a campaign.' using errcode = '42501'; end if;
  if p_participation is null and p_invite is null then raise exception 'nothing to delete' using errcode = '22023'; end if;
  if p_participation is not null then
    select campaign_id into v_camp from intel.ci_campaign_participation where participation_id = p_participation;
    if v_camp is null then raise exception 'This creator is not on the campaign any more.' using errcode = 'P0002'; end if;
    perform set_config('geek.campaign_purge', 'on', true);          -- lets its event history go with it
    delete from intel.ci_campaign_invite where participation_id = p_participation;
    get diagnostics v_inv = row_count;
    delete from intel.ci_campaign_participation where participation_id = p_participation;   -- contract, courier, posts… cascade
    get diagnostics v_n = row_count;
    perform set_config('geek.campaign_purge', 'off', true);
  end if;
  if p_invite is not null then
    delete from intel.ci_campaign_invite where invite_id = p_invite;
    get diagnostics v_inv = row_count;
    v_inv := v_inv;
  end if;
  return jsonb_build_object('removed', v_n, 'invites_removed', v_inv);
end $$;
revoke all on function api.admin_remove_from_campaign(uuid, uuid) from public, anon;
grant execute on function api.admin_remove_from_campaign(uuid, uuid) to authenticated;

-- ============================================ 3. messages to an invite ============================================
create or replace function api.invite_messages(p_invite uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or not intel.ci_can_manage_campaign(i.campaign_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return jsonb_build_object(
    'invite_id', i.invite_id, 'phone', i.phone_e164, 'email', i.email, 'name', i.full_name, 'handle', i.handle,
    'session_open', exists (select 1 from public.wa_conversations c where i.phone_e164 is not null and c.contact_phone_e164 = i.phone_e164 and c.session_expires_at > now()),
    'opted_out', exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null),
    'messages', coalesce((select jsonb_agg(m order by (m->>'at')) from (
        select jsonb_build_object('at', coalesce(o.sent_at, o.created_at), 'channel', o.channel, 'dir', 'out', 'auto', true,
                 'key', o.template_key, 'status', o.status, 'error', o.last_error,
                 'text', left(coalesce(o.payload->>'text', o.payload->>'html', o.payload->>'subject', o.payload->>'title', ''), 900)) m
          from intel.ci_outbox o
         where o.channel in ('whatsapp','email') and o.campaign_id = i.campaign_id
           and ((i.phone_e164 is not null and o.to_address = i.phone_e164) or (i.email is not null and lower(o.to_address) = lower(i.email)))
        union all
        select jsonb_build_object('at', w.created_at, 'channel', 'whatsapp', 'dir', case when w.direction = 'inbound' then 'in' else 'out' end,
                 'auto', false, 'status', w.status, 'error', w.error, 'text', left(coalesce(w.body, ''), 1500),
                 'by', (select m.name from public.members m where m.id = w.sender_user_id))
          from public.wa_messages w join public.wa_conversations c on c.id = w.conversation_id
         where i.phone_e164 is not null and c.contact_phone_e164 = i.phone_e164
         order by 1 desc limit 300) q), '[]'::jsonb));
end $$;
revoke all on function api.invite_messages(uuid) from public, anon;
grant execute on function api.invite_messages(uuid) to authenticated;

-- ============================================ 4. posts: screenshots + typed numbers ============================================
-- numbers on a post: keep where they came from (insights / typed / read from a screenshot) and the screenshot itself
create or replace function intel.ci_post_stats(p_post uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; po record; v_member uuid; m jsonb; ps record;
begin
  select jsonb_strip_nulls(jsonb_build_object('reach', x.reach, 'impressions', x.impressions, 'views', x.views, 'likes', x.likes,
           'comments', x.comments, 'shares', x.shares, 'saves', x.saves, 'replies', nullif(x.raw->>'replies','')::bigint,
           'link_clicks', nullif(x.raw->>'link_clicks','')::bigint, 'sticker_taps', nullif(x.raw->>'sticker_taps','')::bigint,
           'profile_visits', nullif(x.raw->>'profile_visits','')::bigint,
           'screenshot_url', x.raw->>'screenshot_url', 'at', x.captured_at,
           'source', case when x.raw->>'source' in ('manual','screenshot') then x.raw->>'source' else 'insights' end))
    into r from intel.ci_campaign_post_metric x where x.post_id = p_post order by x.captured_at desc limit 1;
  if r is not null then return r; end if;
  select * into po from intel.ci_campaign_post where post_id = p_post;
  if po.post_id is null then return '{}'::jsonb; end if;
  select * into ps from intel.ci_public_post_stats s where s.code = intel.ci_ig_code(po.permalink) and s.fetched_at is not null and s.error is null;
  if ps.code is not null then
    return jsonb_strip_nulls(jsonb_build_object('likes', ps.likes, 'comments', ps.comments, 'views', ps.views, 'at', ps.fetched_at, 'source', 'public'));
  end if;
  select intel.ci_member_of_identity(p.identity_id) into v_member from intel.ci_campaign_participation p where p.participation_id = po.participation_id;
  select e into m from public.social_accounts sa, jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) e
   where sa.member_id = v_member and sa.platform = 'instagram'
     and ((po.external_media_id is not null and e->>'id' = po.external_media_id)
          or intel.ci_norm_permalink(e->>'permalink') = intel.ci_norm_permalink(po.permalink))
   limit 1;
  if m is null then return '{}'::jsonb; end if;
  return jsonb_strip_nulls(jsonb_build_object('likes', nullif(m->>'like_count','')::bigint, 'comments', nullif(m->>'comments_count','')::bigint,
           'reach', nullif(m->>'reach','')::bigint, 'views', coalesce(nullif(m->>'plays','')::bigint, nullif(m->>'views','')::bigint),
           'source', 'public'));
end $$;
revoke all on function intel.ci_post_stats(uuid) from public, anon, authenticated;

-- the numbers a person typed / read from a screenshot (only real, non-negative numbers)
create or replace function intel.ci_clean_metrics(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, round(v::numeric)), '{}'::jsonb)
    from jsonb_each_text(coalesce(p, '{}'::jsonb)) e(k, v)
   where k in ('views','reach','impressions','likes','comments','shares','saves','replies','link_clicks','sticker_taps','profile_visits')
     and v ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' $$;

-- add a post / story to a creator's campaign. A story can come as its screenshot only (stories have no lasting link);
-- numbers typed in or read from the screenshot are saved with it.
create or replace function api.bp_add_post_link(p_participation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_stage text; v_camp uuid; v_link text := nullif(btrim(coalesce(p_payload->>'permalink','')), '');
        v_mt text := lower(coalesce(nullif(p_payload->>'media_type',''),'reel')); v_pid uuid; v_g int := 0;
        v_shot text := nullif(btrim(coalesce(p_payload->>'screenshot_url','')), ''); v_m jsonb := intel.ci_clean_metrics(p_payload->'metrics');
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_link is not null and v_link ~* '/stories/' then v_mt := 'story'; end if;
  if v_mt not in ('reel','story','post') then v_mt := 'reel'; end if;
  if v_link is null and not (v_mt = 'story' and v_shot is not null) then
    raise exception 'paste the Instagram link of the post (instagram.com/reel/… or /p/…) — for a story the screenshot is enough' using errcode = '22023'; end if;
  if v_link is not null and v_link !~* '^https?://(www\.|m\.)?instagram\.com/([^/?#]+/)?(reel|reels|p|tv|stories)/' then
    raise exception 'paste the Instagram link of the post (instagram.com/reel/… or /p/…)' using errcode = '22023'; end if;
  if v_shot is not null and v_shot !~* '^https://' then raise exception 'the screenshot did not upload — try again' using errcode = '22023'; end if;
  select stage, campaign_id into v_stage, v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage not in ('content_created','content_submitted','changes_requested','content_approved','published','completed') then
    raise exception 'a post can be added once the creator has the video brief (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  if v_link is not null and exists (select 1 from intel.ci_campaign_post where participation_id = p_participation and intel.ci_norm_permalink(permalink) = intel.ci_norm_permalink(v_link)) then
    raise exception 'this link is already on the campaign' using errcode = '22023'; end if;
  insert into intel.ci_campaign_post(participation_id, campaign_id, media_type, permalink, posted_at)
  values (p_participation, v_camp, v_mt, v_link, coalesce(nullif(p_payload->>'posted_at','')::timestamptz, now())) returning post_id into v_pid;
  if v_m <> '{}'::jsonb or v_shot is not null then
    perform intel.ci_record_post_metric(v_pid, v_m || jsonb_strip_nulls(jsonb_build_object('source', case when v_shot is not null then 'screenshot' else 'manual' end,
                                                                   'screenshot_url', v_shot)), v_uid);
  end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'submission', null, 'posted', v_uid,
            v_mt || case when v_link is null then ' — screenshot added by the team' else ' — link added by the team' end);
  loop
    v_g := v_g + 1; exit when v_g > 5;
    select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
    if v_stage in ('content_created','changes_requested') then perform intel.ci_participation_advance(p_participation, 'content_submitted', v_uid, 'posted — added by the team');
    elsif v_stage = 'content_submitted' then perform intel.ci_participation_advance(p_participation, 'content_approved', v_uid, 'posted — added by the team');
    elsif v_stage = 'content_approved' then perform intel.ci_participation_advance(p_participation, 'published', v_uid, 'posted — added by the team');
    else exit; end if;
  end loop;
  return jsonb_build_object('post_id', v_pid, 'stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation),
                            'matched', (select external_media_id is not null from intel.ci_campaign_post where post_id = v_pid),
                            'numbers', v_m <> '{}'::jsonb);
end $$;
revoke all on function api.bp_add_post_link(uuid, jsonb) from public, anon;
grant execute on function api.bp_add_post_link(uuid, jsonb) to authenticated;

-- typed / screenshot numbers on a post already there (the screenshot is kept with them)
create or replace function api.bp_record_metrics(p_participation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_post uuid; v_shot text := nullif(btrim(coalesce(p_payload->>'screenshot_url','')), ''); v_m jsonb := intel.ci_clean_metrics(p_payload);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_m = '{}'::jsonb then raise exception 'add at least one number' using errcode = '22023'; end if;
  select post_id into v_post from intel.ci_campaign_post where participation_id = p_participation
   and (p_payload->>'post_id' is null or post_id::text = p_payload->>'post_id') order by posted_at desc limit 1;
  if v_post is null then raise exception 'the creator has not posted yet' using errcode = '22023'; end if;
  perform intel.ci_record_post_metric(v_post, v_m || jsonb_strip_nulls(jsonb_build_object('source', case when v_shot is not null then 'screenshot' else 'manual' end,
                                                     'screenshot_url', v_shot)), auth.uid());
  return jsonb_build_object('post_id', v_post, 'stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation));
end $$;
revoke all on function api.bp_record_metrics(uuid, jsonb) from public, anon;
grant execute on function api.bp_record_metrics(uuid, jsonb) to authenticated;

-- invited / bulk creators (not in the campaign yet): their posts + numbers wait on the invite
create table if not exists intel.ci_invite_post (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references intel.ci_campaign_invite(invite_id) on delete cascade,
  media_type text not null default 'story' check (media_type in ('reel','story','post')),
  permalink text,
  screenshot_url text,
  metrics jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  created_by uuid,
  created_at timestamptz not null default now(),
  moved_at timestamptz
);
create index if not exists ci_invite_post_invite on intel.ci_invite_post(invite_id);
alter table intel.ci_invite_post enable row level security;
revoke all on intel.ci_invite_post from public, anon, authenticated;

create or replace function api.invite_add_post(p_invite uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_link text := nullif(btrim(coalesce(p_payload->>'permalink','')), '');
        v_mt text := lower(coalesce(nullif(p_payload->>'media_type',''),'story')); v_shot text := nullif(btrim(coalesce(p_payload->>'screenshot_url','')), '');
        v_m jsonb := intel.ci_clean_metrics(p_payload->'metrics'); v_id uuid;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or not intel.ci_can_manage_campaign(i.campaign_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_link is not null and v_link ~* '/stories/' then v_mt := 'story'; end if;
  if v_mt not in ('reel','story','post') then v_mt := 'story'; end if;
  if v_link is null and v_shot is null then raise exception 'add the post link or the screenshot' using errcode = '22023'; end if;
  if v_link is not null and v_link !~* '^https?://(www\.|m\.)?instagram\.com/([^/?#]+/)?(reel|reels|p|tv|stories)/' then
    raise exception 'paste the Instagram link of the post (instagram.com/reel/… or /p/…)' using errcode = '22023'; end if;
  if v_shot is not null and v_shot !~* '^https://' then raise exception 'the screenshot did not upload — try again' using errcode = '22023'; end if;
  -- a link goes on the row too (the report reads its public numbers; it moves onto their campaign when they join)
  if v_link is not null and not exists (select 1 from unnest(i.post_links) l where intel.ci_norm_permalink(l) = intel.ci_norm_permalink(v_link)) then
    update intel.ci_campaign_invite set post_links = post_links || v_link where invite_id = p_invite;
  end if;
  if v_m <> '{}'::jsonb or v_shot is not null or (v_link is null) then
    insert into intel.ci_invite_post(invite_id, media_type, permalink, screenshot_url, metrics, source, created_by)
    values (p_invite, v_mt, v_link, v_shot, v_m, case when v_shot is not null then 'screenshot' else 'manual' end, auth.uid())
    returning id into v_id;
  end if;
  begin perform private.ci_kick_worker('ci-post-insights-worker'); exception when others then null; end;
  return jsonb_build_object('id', v_id, 'links', (select cardinality(post_links) from intel.ci_campaign_invite where invite_id = p_invite));
end $$;
revoke all on function api.invite_add_post(uuid, jsonb) from public, anon;
grant execute on function api.invite_add_post(uuid, jsonb) to authenticated;

-- when an invited creator joins: their screenshots / typed numbers go onto their campaign posts
create or replace function intel.tg_invite_move_posts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; v_post uuid;
begin
  if new.participation_id is null or old.participation_id is not distinct from new.participation_id then return null; end if;
  for r in select * from intel.ci_invite_post where invite_id = new.invite_id and moved_at is null order by created_at loop
    v_post := null;
    if r.permalink is not null then
      select post_id into v_post from intel.ci_campaign_post where participation_id = new.participation_id
         and intel.ci_norm_permalink(permalink) = intel.ci_norm_permalink(r.permalink) limit 1;
    end if;
    if v_post is null then
      insert into intel.ci_campaign_post(participation_id, campaign_id, media_type, permalink, posted_at)
      values (new.participation_id, new.campaign_id, r.media_type, r.permalink, r.created_at) returning post_id into v_post;
    end if;
    if r.metrics <> '{}'::jsonb or r.screenshot_url is not null then
      perform intel.ci_record_post_metric(v_post, r.metrics || jsonb_strip_nulls(jsonb_build_object('source', r.source, 'screenshot_url', r.screenshot_url)), r.created_by);
    end if;
    update intel.ci_invite_post set moved_at = now() where id = r.id;
  end loop;
  return null;
exception when others then raise warning 'invite posts not moved: %', sqlerrm; return null;
end $$;
drop trigger if exists ci_invite_zz_move_posts on intel.ci_campaign_invite;
create trigger ci_invite_zz_move_posts after update of participation_id on intel.ci_campaign_invite
  for each row execute function intel.tg_invite_move_posts();

-- a campaign post list with the screenshot (if any)
create or replace function intel.ci_participation_posts(p_participation uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('post_id', po.post_id, 'media_type', po.media_type, 'permalink', po.permalink,
           'posted_at', po.posted_at, 'tracked', po.external_media_id is not null, 'stats', st.s,
           'screenshot_url', st.s->>'screenshot_url')
         order by po.posted_at), '[]'::jsonb)
    from intel.ci_campaign_post po cross join lateral (select intel.ci_post_stats(po.post_id) s) st
   where po.participation_id = p_participation $$;
revoke all on function intel.ci_participation_posts(uuid) from public, anon, authenticated;

-- the report: every creator who posted (app + bulk sheet), with typed / screenshot numbers too
create or replace function api.campaign_analytics(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); v_rows jsonb; v_tot jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r order by (r->'totals'->>'views')::bigint desc nulls last, (r->'totals'->>'likes')::bigint desc nulls last), '[]'::jsonb) into v_rows from (
    -- creators in the app
    select jsonb_build_object('participation_id', p.participation_id, 'stage', p.stage,
             'creator', cc.card || jsonb_strip_nulls(jsonb_build_object(
                 'username', coalesce(nullif(cc.card->>'username',''), h.handle),
                 'followers', coalesce(nullif(cc.card->>'followers','')::bigint, ex.followers),
                 'name', coalesce(nullif(cc.card->>'name',''), ex.display_name, (select m.name from public.members m where m.id = intel.ci_member_of_identity(p.identity_id))))),
             'posts', x.posts,
             'totals', (select jsonb_build_object(
                  'reach', sum((e->'stats'->>'reach')::bigint), 'views', sum((e->'stats'->>'views')::bigint),
                  'likes', sum((e->'stats'->>'likes')::bigint), 'comments', sum((e->'stats'->>'comments')::bigint),
                  'shares', sum((e->'stats'->>'shares')::bigint), 'saves', sum((e->'stats'->>'saves')::bigint))
                from jsonb_array_elements(x.posts) e)) r
      from intel.ci_campaign_participation p
      cross join lateral (select intel.ci_public_creator_card(p.identity_id, p.applied_profile) card) cc
      cross join lateral (select intel.ci_participation_handle(p.participation_id) handle) h
      left join intel.ci_external_creator ex on ex.platform = 'instagram' and ex.handle = coalesce(nullif(lower(cc.card->>'username'),''), h.handle)
      cross join lateral (select intel.ci_participation_posts(p.participation_id) posts) x
     where p.campaign_id = v_id and p.stage in ('content_approved','published','completed')
    union all
    -- bulk-sheet creators who posted but haven't registered yet
    select jsonb_build_object('participation_id', null, 'invite_id', i.invite_id, 'stage', 'completed', 'on_sheet', true,
             'creator', jsonb_strip_nulls(jsonb_build_object('username', i.handle, 'name', coalesce(i.full_name, ex.display_name),
                          'followers', coalesce(ex.followers, i.followers), 'profile_picture_url', ex.profile_picture_url)),
             'posts', ps.posts,
             'totals', (select jsonb_build_object('reach', sum((e->'stats'->>'reach')::bigint), 'views', sum((e->'stats'->>'views')::bigint),
                  'likes', sum((e->'stats'->>'likes')::bigint), 'comments', sum((e->'stats'->>'comments')::bigint),
                  'shares', sum((e->'stats'->>'shares')::bigint), 'saves', sum((e->'stats'->>'saves')::bigint))
                from jsonb_array_elements(ps.posts) e))
      from intel.ci_campaign_invite i
      left join intel.ci_external_creator ex on ex.platform = 'instagram' and ex.handle = i.handle
      cross join lateral (select coalesce(jsonb_agg(pp), '[]'::jsonb) posts from (
          select jsonb_build_object('permalink', l, 'media_type', case when l ~* '/stories/' then 'story' when l ~* '/reels?/' then 'reel' else 'post' end,
                   'stats', coalesce(
                      (select jsonb_strip_nulls(ip.metrics || jsonb_build_object('screenshot_url', ip.screenshot_url, 'at', ip.created_at, 'source', ip.source))
                         from intel.ci_invite_post ip where ip.invite_id = i.invite_id and ip.permalink is not null and ip.metrics <> '{}'::jsonb
                          and intel.ci_norm_permalink(ip.permalink) = intel.ci_norm_permalink(l) order by ip.created_at desc limit 1),
                      (select jsonb_strip_nulls(jsonb_build_object('likes', s.likes, 'comments', s.comments, 'views', s.views, 'at', s.fetched_at, 'source', 'public'))
                         from intel.ci_public_post_stats s where s.code = intel.ci_ig_code(l) and s.error is null and s.fetched_at is not null), '{}'::jsonb)) pp
            from unnest(i.post_links) l
          union all
          select jsonb_build_object('permalink', null, 'media_type', ip.media_type, 'posted_at', ip.created_at, 'screenshot_url', ip.screenshot_url,
                   'stats', jsonb_strip_nulls(ip.metrics || jsonb_build_object('screenshot_url', ip.screenshot_url, 'at', ip.created_at, 'source', ip.source)))
            from intel.ci_invite_post ip where ip.invite_id = i.invite_id and ip.permalink is null) z) ps
     where i.campaign_id = v_id and i.participation_id is null
       and (cardinality(i.post_links) > 0 or exists (select 1 from intel.ci_invite_post ip where ip.invite_id = i.invite_id))) s;
  select jsonb_build_object(
      'creators_live', (select count(*) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0),
      'posts', (select coalesce(sum(jsonb_array_length(e->'posts')),0) from jsonb_array_elements(v_rows) e),
      'followers', (select coalesce(sum((e->'creator'->>'followers')::bigint),0) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0),
      'reach', (select sum((e->'totals'->>'reach')::bigint) from jsonb_array_elements(v_rows) e),
      'views', (select sum((e->'totals'->>'views')::bigint) from jsonb_array_elements(v_rows) e),
      'likes', (select sum((e->'totals'->>'likes')::bigint) from jsonb_array_elements(v_rows) e),
      'comments', (select sum((e->'totals'->>'comments')::bigint) from jsonb_array_elements(v_rows) e),
      'shares', (select sum((e->'totals'->>'shares')::bigint) from jsonb_array_elements(v_rows) e),
      'saves', (select sum((e->'totals'->>'saves')::bigint) from jsonb_array_elements(v_rows) e),
      'waiting_numbers', (select count(*) from jsonb_array_elements(v_rows) e, jsonb_array_elements(e->'posts') pp where coalesce(pp->'stats', '{}'::jsonb) = '{}'::jsonb),
      -- creators whose numbers can only come from their public profile (Instagram not connected / only on the sheet)
      'not_connected', (select count(*) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0
                          and not exists (select 1 from jsonb_array_elements(e->'posts') pp where pp->'stats'->>'source' = 'insights')),
      'public_ready', exists (select 1 from public.social_tokens t where t.platform = 'facebook' and t.ig_user_id is not null
                                and (t.expires_at is null or t.expires_at > now()))) into v_tot;
  return jsonb_build_object(
    'campaign', (select jsonb_build_object('name', c.name, 'brand', c.submitted_brand_name, 'starts_on', c.starts_on, 'ends_on', c.ends_on)
                   from intel.ci_campaign c where c.campaign_id = v_id),
    'funnel', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from intel.ci_campaign_participation
                          where campaign_id = v_id group by stage) f), '{}'::jsonb),
    'totals', v_tot, 'creators', v_rows);
end $$;
revoke all on function api.campaign_analytics(uuid) from public, anon;
grant execute on function api.campaign_analytics(uuid) to authenticated;

