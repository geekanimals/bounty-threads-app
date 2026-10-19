-- Creator profile is OPTIONAL; Instagram (media kit) + WhatsApp are what a creator must connect.
--   • bulk upload: a registered creator joins the campaign at the sheet's step as soon as Instagram + WhatsApp are
--     connected — the profile is made / pre-filled from the sheet and they can finish it whenever they like
--   • the team changing a creator's status on the bulk list puts them on that step straight away, skipping every
--     check (registered creators); people not registered yet get that step's message
--   • the bulk list "Still to do" shows only what blocks joining, plus the profile % ; the waiting message says so too
--   • catch-up: everyone already registered and waiting, who has Instagram + WhatsApp, joins now at their step
-- ADDITIVE: new helpers; functions redefined with the same signatures.

-- what a creator still has to connect before they can be on a campaign
create or replace function intel.ci_join_needs(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_member is null then '[]'::jsonb else
    case when exists (select 1 from public.social_accounts sa where sa.member_id = p_member and sa.platform = 'instagram' and coalesce(sa.username,'') <> '')
              or exists (select 1 from private.ig_linked_accounts l where l.member_id = p_member)
         then '[]'::jsonb else '["Connect Instagram (media kit)"]'::jsonb end
    || case when exists (select 1 from public.wa_contacts w where w.user_id = p_member and w.verified_at is not null)
         then '[]'::jsonb else '["Connect WhatsApp"]'::jsonb end end $$;
revoke all on function intel.ci_join_needs(uuid) from public, anon, authenticated;

-- the signed-in creator: what's left to connect (the app's only hard gate) + the optional profile checklist
create or replace function api.my_join_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_need jsonb; v_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_need := intel.ci_join_needs(v_uid);
  v_id := intel.ci_member_identity(v_uid);
  return jsonb_build_object('needs', v_need, 'ready', jsonb_array_length(v_need) = 0,
    'instagram', not (v_need ? 'Connect Instagram (media kit)'), 'whatsapp', not (v_need ? 'Connect WhatsApp'),
    'profile', case when v_id is not null then intel.ci_profile_requirements(v_id) end);
end $$;
revoke all on function api.my_join_status() from public, anon;
grant execute on function api.my_join_status() to authenticated;

create or replace function intel.ci_bulk_attach(p_invite uuid, p_member uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_identity uuid; v_part uuid; v_stage text; v_name text; v_brand text; v_prod text;
        v_status text; v_ok boolean; v_ig boolean; v_req jsonb; v_need jsonb := '[]'::jsonb;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite for update;
  if i.invite_id is null then return null; end if;
  v_status := coalesce(i.status, case when i.approved then 'approved' else 'registered' end);
  v_ok := intel.ci_bulk_rank(v_status) >= 4;     -- approved or later
  select c.name, coalesce(c.submitted_brand_name, b.name), c.product into v_name, v_brand, v_prod
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = i.campaign_id;

  -- the sheet's WhatsApp number carries their updates when they have none of their own
  if i.phone_e164 is not null then
    update public.members set whatsapp_e164 = i.phone_e164
     where id = p_member and whatsapp_e164 is null and not exists (select 1 from public.wa_contacts w where w.user_id = p_member);
  end if;

  -- their creator profile is made / pre-filled from the sheet (filling it in further is optional);
  -- what they MUST have to be on a campaign: Instagram connected (media kit) + WhatsApp connected.
  -- The team changing their status on the bulk list skips even that (geek.bulk_force).
  v_identity := intel.ci_bulk_profile(p_member, p_invite);
  if coalesce(current_setting('geek.bulk_force', true), '') <> 'on' then v_need := intel.ci_join_needs(p_member); end if;
  if jsonb_array_length(v_need) > 0 then
    -- hold the campaign for them and say what's left (once)
    if i.reserved_by is distinct from p_member then
      update intel.ci_campaign_invite set reserved_by = p_member where invite_id = p_invite;
      perform intel.ci_notify(p_member, i.campaign_id, null, 'bulk_waiting',
        jsonb_build_object('campaign', coalesce(v_name,'a campaign'), 'brand', coalesce(v_brand,'A brand')));
    end if;
    return jsonb_build_object('status', 'waiting_profile', 'member_id', p_member, 'needs', v_need);
  end if;

  select participation_id, stage into v_part, v_stage from intel.ci_campaign_participation
   where campaign_id = i.campaign_id and identity_id = v_identity;
  if v_part is null then
    perform set_config('geek.bulk_quiet', 'on', true);
    insert into intel.ci_campaign_participation(campaign_id, identity_id, stage, needs_approval, applied_profile)
    values (i.campaign_id, v_identity, case when v_ok then 'brand_confirmed' else 'applied' end, not v_ok, i.handle)
    returning participation_id, stage into v_part, v_stage;
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (i.campaign_id, v_part, 'participation', null, case when v_ok then 'brand_confirmed' else 'applied' end, p_actor,
            case when v_ok then 'approved on the bulk upload' else 'added from the bulk upload' end);
  end if;
  update intel.ci_campaign_invite set claimed_by = p_member, claimed_at = coalesce(claimed_at, now()), reserved_by = p_member,
         participation_id = v_part where invite_id = p_invite;
  -- to their step; the step message goes now unless the upload message already told them about this step
  v_stage := intel.ci_bulk_fastforward(v_part, p_invite, p_actor, coalesce(i.status_messaged, '') <> v_status, true);
  perform set_config('geek.bulk_quiet', 'off', true);
  select stage into v_stage from intel.ci_campaign_participation where participation_id = v_part;
  return jsonb_build_object('status', 'joined', 'member_id', p_member, 'participation_id', v_part, 'stage', v_stage);
end $$;

-- a status change by the team: in the campaign → forward to that step; registered → straight onto that step
-- (no checks); not registered yet → that step's message
create or replace function api.bulk_set_status(p_invite uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_st text := intel.ci_bulk_status(p_status); v_stage text; v_m uuid; v_res jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or not intel.ci_can_manage_campaign(i.campaign_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_st is null then raise exception 'unknown status "%"', p_status using errcode = '22023'; end if;
  update intel.ci_campaign_invite set status = v_st, approved = intel.ci_bulk_rank(v_st) >= 4 where invite_id = p_invite;
  if i.participation_id is not null then
    v_stage := intel.ci_bulk_fastforward(i.participation_id, p_invite, auth.uid());
  elsif i.claimed_at is null then
    v_m := coalesce(i.reserved_by, intel.ci_find_creator(i.phone_e164, lower(i.email), lower(i.handle)));
    if v_m is not null then
      perform set_config('geek.bulk_force', 'on', true);
      begin
        v_res := intel.ci_bulk_attach(p_invite, v_m, auth.uid());
      exception when others then perform set_config('geek.bulk_force', 'off', true); raise;
      end;
      perform set_config('geek.bulk_force', 'off', true);
      v_stage := v_res->>'stage';
    else
      perform intel.ci_send_bulk_invite(p_invite);    -- not registered yet: the new step's message
    end if;
  end if;
  return jsonb_build_object('status', v_st, 'stage', v_stage);
end $$;

create or replace function api.bulk_invites(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then return '[]'::jsonb; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row order by (row->>'created_at') desc) from (
    select jsonb_build_object(
      'invite_id', i.invite_id, 'name', i.full_name, 'handle', i.handle, 'phone', i.phone_e164, 'email', i.email, 'city', i.city,
      'followers', coalesce(i.followers, x.followers), 'approved', i.approved, 'created_at', i.created_at, 'invites_sent', i.invites_sent,
      'last_invited_at', i.last_invited_at, 'claimed_at', i.claimed_at,
      'sheet_status', coalesce(i.status, case when i.approved then 'approved' else 'registered' end), 'status_messaged', i.status_messaged,
      'address', i.ship_address, 'courier', i.courier, 'tracking', coalesce(i.tracking_ref, i.tracking_url),
      'ig', case when x.handle is not null then jsonb_strip_nulls(jsonb_build_object('name', x.display_name, 'followers', x.followers,
                 'pic', x.profile_picture_url, 'fetched', x.enriched_at is not null, 'error', x.enrich_error)) end,
      'member_id', mem.mid,
      'status', case when p.participation_id is not null then 'joined' when mem.mid is not null then 'registered' else 'invited' end,
      'stage', p.stage, 'participation_id', p.participation_id,
      -- the account this creator is on the campaign with (the sheet's handle), not whichever one their media kit has open
      'instagram', coalesce('@'||nullif(p.applied_profile,''),
                     case when mem.mid is not null and i.handle is not null and intel.ci_member_has_handle(mem.mid, lower(i.handle)) then '@'||lower(i.handle) end,
                     (select '@'||sa.username from public.social_accounts sa where sa.member_id = mem.mid and sa.platform='instagram' limit 1)),
      -- what still stops them joining (Instagram + WhatsApp); the profile itself is optional — shown as a %
      'missing', case when mem.mid is null then null else intel.ci_join_needs(mem.mid) end,
      'profile_pct', case when mem.mid is not null and intel.ci_member_identity(mem.mid) is not null then
                   (select case when (r->>'total')::int > 0 then round(100.0 * (r->>'done')::int / (r->>'total')::int) end
                      from (select intel.ci_profile_requirements(intel.ci_member_identity(mem.mid)) r) q) end,
      'wa', (select jsonb_build_object('status', o.status, 'error', o.last_error, 'at', coalesce(o.sent_at, o.created_at)) from intel.ci_outbox o
              where o.dedupe_key like 'binv:' || i.invite_id || ':wa:%' order by o.created_at desc limit 1),
      'mail', (select jsonb_build_object('status', o.status, 'error', o.last_error, 'at', coalesce(o.sent_at, o.created_at)) from intel.ci_outbox o
              where o.dedupe_key like 'binv:' || i.invite_id || ':em:%' order by o.created_at desc limit 1)) as row
      from intel.ci_campaign_invite i
      left join lateral (select coalesce(i.claimed_by, i.reserved_by, intel.ci_find_creator(i.phone_e164, lower(i.email), lower(i.handle))) as mid) mem on true
      left join intel.ci_campaign_participation p on p.participation_id = i.participation_id
      left join intel.ci_external_creator x on x.platform = 'instagram' and x.handle = lower(i.handle)
     where i.campaign_id = p_campaign and i.source = 'bulk') s), '[]'::jsonb);
end $$;

-- the "waiting" message now asks only for what's needed
update intel.ci_notification_template set
  body_md = 'You''re on **{{campaign}}** with {{brand}}. Connect your Instagram (media kit) and WhatsApp in the app — the campaign opens for you the moment they''re connected, right at your step. Completing your creator profile is optional.'
 where template_key = 'bulk_waiting';
update intel.ci_step_copy set next_step = 'connect your Instagram (media kit) and WhatsApp in the app'
 where template_key = 'bulk_waiting';

-- WhatsApp linked → re-check the invites waiting for them (Instagram already re-checks)
create or replace function intel.tg_claim_on_wa_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verified_at is not null and (tg_op = 'INSERT' or new.phone_e164 is distinct from old.phone_e164 or old.verified_at is null) then
    perform intel.ci_claim_member_invites(new.user_id);
  end if;
  return null;
exception when others then return null;
end $$;

-- catch up: everyone registered and waiting who already has Instagram + WhatsApp joins now, at their step
do $$ declare m uuid; begin
  for m in select distinct reserved_by from intel.ci_campaign_invite where claimed_at is null and reserved_by is not null loop
    perform intel.ci_rejoin_waiting(m);
  end loop;
end $$;
