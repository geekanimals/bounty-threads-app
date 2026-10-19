-- One campaign, A to Z, from its own page (team side: the campaign's agency / brand / Super Admin):
--   api.campaign_people(campaign)        everyone on it — creators in the campaign at their step + everyone invited
--                                        (bulk upload / handle) who hasn't joined yet — with profile %, what still
--                                        blocks them, the last WhatsApp sent and when they last moved
--   api.campaign_creator_hub(participation)  one creator: profile %, contact, every step they took (who / when /
--                                        why), every alert + WhatsApp + email we sent and every WhatsApp message in
--                                        and out, plus the step messages the team can send next
--   api.team_send_step(participation, key)   send one of those step messages now (app + WhatsApp + email)
-- ADDITIVE · read functions + one send function · nothing changes for creators.

create or replace function intel.ci_member_phone(p_member uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select w.phone_e164 from public.wa_contacts w where w.user_id = p_member),
                  (select m.whatsapp_e164 from public.members m where m.id = p_member)) $$;
revoke all on function intel.ci_member_phone(uuid) from public, anon, authenticated;

create or replace function intel.ci_profile_pct(p_member uuid)
returns int language sql stable security definer set search_path = '' as $$
  select case when (r->>'total')::int > 0 then round(100.0 * (r->>'done')::int / (r->>'total')::int)::int end
    from (select intel.ci_profile_requirements(intel.ci_member_identity(p_member)) r) q
   where intel.ci_member_identity(p_member) is not null $$;
revoke all on function intel.ci_profile_pct(uuid) from public, anon, authenticated;

-- every creator card the team sees (applicants, approvals, barter board, campaign people) carries the profile %
create or replace function intel.ci_public_creator_card_v1(p_identity uuid, p_handle text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_base jsonb := intel.ci_public_creator_card(p_identity); v_h text := lower(ltrim(coalesce(p_handle,''),'@')); v_mid uuid; a jsonb;
begin
  if v_h = '' or lower(coalesce(v_base->>'username','')) = v_h then return v_base; end if;
  select x.member_id into v_mid from intel.ci_identity_actor_access x where x.identity_id = p_identity and x.access_role = 'self' and x.revoked_at is null limit 1;
  if v_mid is null then return v_base; end if;
  select l.account into a from private.ig_linked_accounts l
   where l.member_id = v_mid and lower(coalesce(l.username, l.account->>'username')) = v_h limit 1;
  if a is null then return v_base; end if;
  return v_base || jsonb_build_object('username', coalesce(a->>'username', v_h), 'name', coalesce(a->>'name', v_base->>'name'),
    'profile_picture_url', a->>'profile_picture_url', 'followers', nullif(a->>'followers_count','')::bigint,
    'avg_reach', nullif(a->>'avg_reach','')::numeric,
    'engagement', case when coalesce(nullif(a->>'followers_count','')::numeric,0) > 0 and jsonb_typeof(a->'recent_media') = 'array'
                            and jsonb_array_length(a->'recent_media') > 0 then
        round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                         from jsonb_array_elements(a->'recent_media') m2) / (a->>'followers_count')::numeric, 2) end,
    'account', 'other');
end $$;
create or replace function intel.ci_public_creator_card(p_identity uuid, p_handle text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := intel.ci_public_creator_card_v1(p_identity, p_handle); v_pct int;
begin
  if v is null then return v; end if;
  v_pct := intel.ci_profile_pct(nullif(v->>'member_id','')::uuid);
  return case when v_pct is null then v else v || jsonb_build_object('profile_pct', v_pct) end;
end $$;
revoke all on function intel.ci_public_creator_card_v1(uuid, text) from public, anon, authenticated;
revoke all on function intel.ci_public_creator_card(uuid, text) from public, anon, authenticated;
grant execute on function intel.ci_public_creator_card(uuid, text) to service_role;

-- creator-facing step messages the team can send by hand (WhatsApp template + in-app + email)
create or replace function intel.ci_team_step_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['invited','contract_sent','confirm_address','product_shipped','parcel_received','video_due','video_warning',
               'changes_requested','content_approved','caption_fix','completed','feedback_request','video_blocked'] $$;

create or replace function api.campaign_people(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_camp uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_camp := intel.ci_resolve_campaign(p_campaign);
  if v_camp is null then return jsonb_build_object('participants', '[]'::jsonb, 'invites', '[]'::jsonb); end if;
  if not intel.ci_can_manage_campaign(v_camp) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return jsonb_build_object(
    'campaign_id', v_camp,
    'participants', coalesce((select jsonb_agg(x order by x->>'updated_at' desc) from (
      select jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage, 'applied_profile', p.applied_profile,
        'applied_at', p.created_at, 'updated_at', p.updated_at, 'reason', p.reason,
        'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
        'member_id', mem.mid, 'phone', intel.ci_member_phone(mem.mid), 'profile_pct', intel.ci_profile_pct(mem.mid),
        'needs', intel.ci_join_needs(mem.mid),
        'from_bulk', exists (select 1 from intel.ci_campaign_invite i where i.participation_id = p.participation_id),
        'last_move', (select max(e.at) from intel.ci_campaign_event e where e.participation_id = p.participation_id),
        'last_wa', (select jsonb_build_object('key', o.template_key, 'status', o.status, 'at', coalesce(o.sent_at, o.created_at), 'error', o.last_error)
                      from intel.ci_outbox o where o.channel = 'whatsapp' and (o.participation_id = p.participation_id
                        or (o.recipient_member_id = mem.mid and o.campaign_id = v_camp)) order by o.created_at desc limit 1)) x
        from intel.ci_campaign_participation p
        left join lateral (select a.member_id mid from intel.ci_identity_actor_access a where a.identity_id = p.identity_id
                            and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) mem on true
       where p.campaign_id = v_camp) s), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
        'invite_id', i.invite_id, 'name', i.full_name, 'handle', i.handle, 'phone', i.phone_e164, 'email', i.email, 'city', i.city,
        'source', i.source, 'status', coalesce(i.status, case when i.approved then 'approved' else 'registered' end),
        'created_at', i.created_at, 'invites_sent', i.invites_sent, 'last_invited_at', i.last_invited_at,
        'member_id', mem.mid, 'registered', mem.mid is not null, 'needs', case when mem.mid is not null then intel.ci_join_needs(mem.mid) end,
        'profile_pct', case when mem.mid is not null then intel.ci_profile_pct(mem.mid) end,
        'last_wa', (select jsonb_build_object('status', o.status, 'at', coalesce(o.sent_at, o.created_at), 'error', o.last_error) from intel.ci_outbox o
                     where o.channel = 'whatsapp' and o.dedupe_key like 'binv:' || i.invite_id || ':wa:%' order by o.created_at desc limit 1)) x
        from intel.ci_campaign_invite i
        left join lateral (select coalesce(i.claimed_by, i.reserved_by, intel.ci_find_creator(i.phone_e164, lower(i.email), lower(i.handle))) as mid) mem on true
       where i.campaign_id = v_camp and i.claimed_at is null) s), '[]'::jsonb));
end $$;
revoke all on function api.campaign_people(uuid) from public, anon;
grant execute on function api.campaign_people(uuid) to authenticated;

create or replace function api.campaign_creator_hub(p_participation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p intel.ci_campaign_participation%rowtype; v_mid uuid; v_phone text; v_req jsonb; v_name text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or not intel.ci_can_manage_participation(p_participation) then
    raise exception 'not your campaign' using errcode = '42501'; end if;
  v_mid := intel.ci_member_of_identity(p.identity_id);
  v_phone := intel.ci_member_phone(v_mid);
  v_req := case when p.identity_id is not null then intel.ci_profile_requirements(p.identity_id) end;
  select name into v_name from intel.ci_campaign where campaign_id = p.campaign_id;
  return jsonb_build_object(
    'participation_id', p.participation_id, 'campaign_id', p.campaign_id, 'campaign', v_name, 'stage', p.stage,
    'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'reason', p.reason,
    'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
    'member_id', v_mid, 'name', (select m.name from public.members m where m.id = v_mid), 'phone', v_phone,
    'wa_linked', exists (select 1 from public.wa_contacts w where w.user_id = v_mid and w.verified_at is not null),
    'wa_opted_out', exists (select 1 from public.wa_contacts w where w.user_id = v_mid and w.opt_out_at is not null),
    'needs', intel.ci_join_needs(v_mid),
    'profile', case when v_req is not null then jsonb_build_object('done', v_req->'done', 'total', v_req->'total',
                 'pct', case when (v_req->>'total')::int > 0 then round(100.0 * (v_req->>'done')::int / (v_req->>'total')::int) end,
                 'missing', v_req->'missing') end,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'entity', e.entity, 'from', e.from_status, 'to', e.to_status,
                   'reason', e.reason, 'by', (select m.name from public.members m where m.id = e.actor_member_id),
                   'by_creator', e.actor_member_id is not distinct from v_mid) order by e.at desc, e.event_id desc)
                 from intel.ci_campaign_event e where e.participation_id = p_participation), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('at', n.created_at, 'title', n.title, 'body', left(n.body, 400), 'read', n.read_at is not null,
                   'kind', n.kind) order by n.created_at desc)
                 from (select * from intel.ci_notification n where n.recipient_member_id = v_mid
                         and (n.participation_id = p_participation or n.campaign_id = p.campaign_id) order by n.created_at desc limit 60) n), '[]'::jsonb),
    -- every WhatsApp / email we sent (automatic step messages, invites, reminders) + the WhatsApp chat both ways
    'messages', coalesce((select jsonb_agg(m order by (m->>'at') desc) from (
        select jsonb_build_object('at', coalesce(o.sent_at, o.created_at), 'channel', o.channel, 'dir', 'out', 'auto', true,
                 'key', o.template_key, 'template', o.payload->>'wa_template', 'status', o.status, 'error', o.last_error,
                 'text', left(coalesce(o.payload->>'text', o.payload->>'subject', o.payload->>'title', ''), 700)) m
          from intel.ci_outbox o
         where o.channel in ('whatsapp','email')
           and (o.participation_id = p_participation or (o.recipient_member_id = v_mid and o.campaign_id = p.campaign_id)
                or (v_phone is not null and o.to_address = v_phone and o.campaign_id = p.campaign_id))
        union all
        select jsonb_build_object('at', w.created_at, 'channel', 'whatsapp', 'dir', case when w.direction = 'inbound' then 'in' else 'out' end,
                 'auto', false, 'status', w.status, 'error', w.error, 'text', left(coalesce(w.body, ''), 1500),
                 'by', (select m.name from public.members m where m.id = w.sender_user_id))
          from public.wa_messages w join public.wa_conversations c on c.id = w.conversation_id
         where v_phone is not null and c.contact_phone_e164 = v_phone
        order by 1 limit 200) q), '[]'::jsonb),
    'session_open', exists (select 1 from public.wa_conversations c where v_phone is not null and c.contact_phone_e164 = v_phone and c.session_expires_at > now()),
    'step_messages', coalesce((select jsonb_agg(jsonb_build_object('key', t.template_key, 'title', t.title) order by array_position(intel.ci_team_step_keys(), t.template_key))
                 from intel.ci_notification_template t where t.active and t.template_key = any(intel.ci_team_step_keys())), '[]'::jsonb));
end $$;
revoke all on function api.campaign_creator_hub(uuid) from public, anon;
grant execute on function api.campaign_creator_hub(uuid) to authenticated;

create or replace function api.team_send_step(p_participation uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p intel.ci_campaign_participation%rowtype; v_mid uuid; v_name text; v_nid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or not intel.ci_can_manage_participation(p_participation) then
    raise exception 'not your campaign' using errcode = '42501'; end if;
  if not (p_key = any(intel.ci_team_step_keys())) then raise exception 'unknown message' using errcode = '22023'; end if;
  v_mid := intel.ci_member_of_identity(p.identity_id);
  if v_mid is null then raise exception 'this creator is not on Geek OS yet' using errcode = '22023'; end if;
  if exists (select 1 from intel.ci_outbox o where o.participation_id = p_participation and o.template_key = p_key
              and o.created_at > now() - interval '2 minutes') then
    raise exception 'Sent just now — wait a couple of minutes before sending it again.' using errcode = '22023'; end if;
  select name into v_name from intel.ci_campaign where campaign_id = p.campaign_id;
  v_nid := intel.ci_notify(v_mid, p.campaign_id, p_participation, p_key,
             jsonb_build_object('campaign', coalesce(v_name, 'your campaign'), 'participation_id', p_participation::text));
  return jsonb_build_object('ok', v_nid is not null, 'notification_id', v_nid);
end $$;
revoke all on function api.team_send_step(uuid, text) from public, anon;
grant execute on function api.team_send_step(uuid, text) to authenticated;

-- Discovery: Geek OS creators show their profile % too (same search underneath, % added to platform rows)
do $$ begin
  if to_regprocedure('api.creator_search_base(jsonb,integer,integer,uuid)') is null then
    alter function api.creator_search(jsonb, int, int, uuid) rename to creator_search_base;
  end if;
end $$;
revoke all on function api.creator_search_base(jsonb, int, int, uuid) from public, anon, authenticated;
create or replace function api.creator_search(p_filters jsonb default '{}'::jsonb, p_page int default 1, p_size int default 24, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := api.creator_search_base(p_filters, p_page, p_size, p_campaign);
begin
  return v || jsonb_build_object('rows', coalesce((select jsonb_agg(case when r->>'kind' = 'platform' and r->>'member_id' is not null
             then r || jsonb_build_object('profile_pct', intel.ci_profile_pct((r->>'member_id')::uuid)) else r end order by o)
         from jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) with ordinality t(r, o)), '[]'::jsonb));
end $$;
revoke all on function api.creator_search(jsonb, int, int, uuid) from public, anon;
grant execute on function api.creator_search(jsonb, int, int, uuid) to authenticated;
