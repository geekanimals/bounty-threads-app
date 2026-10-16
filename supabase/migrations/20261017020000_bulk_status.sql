-- Bulk upload: a STATUS column instead of "Approved". Each creator can already be at a different step:
--   Invited (blank) · Approved · Contract signed · Address confirmed · Courier sent · Courier received
-- Optional columns that go with it: Address, State, PIN code, Courier, Tracking (ID or link).
-- Whatever the status, someone new first gets the INVITE. They register → make their creator profile (blank fields
-- are pre-filled from the sheet: name, city, email, WhatsApp, delivery address + what Instagram shows for the
-- handle) → connect Instagram (media kit) → the moment the profile is complete they join the campaign and land
-- straight on the sheet's step. Creators already on Geek OS with a complete profile + Instagram join now.
-- Steps done offline are recorded as "confirmed offline — bulk upload". No message storm: they get ONE message
-- for the step they land on (address → product shipped → parcel received / video brief).
-- Every Instagram handle in the sheet goes to the auto-fetch queue (followers, name, photo, bio).

create or replace function intel.ci_notify(p_recipient uuid, p_campaign uuid, p_participation uuid, p_key text, p_vars jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare t intel.ci_notification_template%rowtype; v_title text; v_body text; v_route text; v_label text;
        v_kind text; v_nid uuid; v_email text; v_wa text; v_dedupe text; v_email_off boolean;
        v_first text; v_cname text; v_cbrand text; v_wa_payload jsonb; sc intel.ci_step_copy%rowtype;
        v_did text; v_next text; v_then text; v_mail text; sw intel.ci_step_wa%rowtype; v_v3 text;
begin
  if p_recipient is null then return null; end if;
  -- a bulk upload moving someone several steps at once stays quiet; they get one message for where they land
  if coalesce(current_setting('geek.bulk_quiet', true), '') = 'on' then return null; end if;
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;
  if p_campaign is not null and coalesce(p_vars->>'brand', '') = '' then
    p_vars := coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('brand', coalesce(
      (select coalesce(c.submitted_brand_name, b.name) from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id
        where c.campaign_id = p_campaign), 'the brand'));
  end if;
  if p_key in ('invited', 'bulk_invited') and not (p_vars ? 'note_line') then p_vars := p_vars || '{"note_line":""}'::jsonb; end if;
  select * into t from intel.ci_notification_template where template_key=p_key and active;
  if found then
    v_title := intel.ci_render(t.title, p_vars); v_body := intel.ci_render(t.body_md, p_vars);
    v_route := nullif(intel.ci_render(coalesce(t.action_route,''), p_vars),''); v_label := coalesce(t.action_label,'Open'); v_kind := t.kind;
  else
    v_title := p_key; v_body := p_key; v_route := null; v_label := 'Open'; v_kind := 'info';
  end if;
  v_dedupe := p_key||':'||coalesce(p_participation::text, p_campaign::text, gen_random_uuid()::text);
  if p_key in ('invited', 'bulk_invited') then
    -- one invite per creator per campaign: a bulk sheet / handle claim and the "invited" event must not send it twice
    select n.notification_id into v_nid from intel.ci_notification n
     where n.recipient_member_id = p_recipient and n.campaign_id is not distinct from p_campaign
       and n.kind in (select kind from intel.ci_notification_template where template_key in ('invited','bulk_invited'))
       and split_part(n.dedupe_key, ':', 1) in ('invited', 'bulk_invited')
       and n.created_at > now() - interval '7 days'
     limit 1;
    if v_nid is not null then return v_nid; end if;
    -- same subject on every invite path
    v_title := 'Approved for ' || coalesce((select c.name from intel.ci_campaign c where c.campaign_id = p_campaign), p_vars->>'campaign', 'a campaign') || ' 🎉';
  end if;

  insert into intel.ci_notification(recipient_member_id, campaign_id, participation_id, kind, title, body, action_route, action_label, dedupe_key)
    values (p_recipient, p_campaign, p_participation, v_kind, v_title, v_body, v_route, v_label, v_dedupe)
    returning notification_id into v_nid;

  select coalesce(nullif(split_part(btrim(coalesce(m.name, '')), ' ', 1), ''), 'there') into v_first from public.members m where m.id = p_recipient;
  v_first := coalesce(v_first, 'there');
  if p_campaign is not null then
    select c.name, coalesce(c.submitted_brand_name, b.name) into v_cname, v_cbrand
      from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = p_campaign;
  end if;
  select * into sc from intel.ci_step_copy where template_key = p_key;
  if sc.template_key is not null then
    v_did := intel.ci_render(sc.did, p_vars); v_next := intel.ci_render(sc.next_step, p_vars); v_then := intel.ci_render(sc.then_we, p_vars);
    -- the email says exactly what the WhatsApp template says
    v_mail := 'Hi ' || v_first || E',\n\nThank you for ' || v_did || E'.\n\nNext, please ' || v_next || '. Once that is done, we will ' || v_then
              || E'.\n\nClick the button below to continue on the app.';
  end if;
  select * into sw from intel.ci_step_wa where template_key = p_key;
  if sw.template_key is not null then
    -- the email is word-for-word the WhatsApp template
    v_v3 := coalesce(sw.update_text, coalesce(v_cbrand, p_vars->>'brand', 'the brand'));
    v_mail := replace(replace(replace(replace(
                regexp_replace(sw.body, E'\n\n[^\n]*\\{\\{4\\}\\}', E'\n\nClick the button below to continue on the app.'),
                '*', ''), '{{1}}', v_first),
                '{{2}}', coalesce(v_cname, p_vars->>'campaign', 'your campaign')), '{{3}}', v_v3);
    v_mail := replace(v_mail, E'\n\nThank you!\nTeam Geek Animals', '');
  elsif p_key in ('invited', 'bulk_invited') then
    v_mail := 'Hello ' || v_first || E',\n\nThank you for applying for the campaign ' || coalesce(v_cname, p_vars->>'campaign', 'our campaign')
              || E'.\n\nCongratulations! Your profile has been approved by ' || coalesce(v_cbrand, p_vars->>'brand', 'the brand')
              || ' for the upcoming barter collaboration through Geek Creative Agency.' || coalesce(nullif(p_vars->>'note_line', ''), '')
              || E'\n\nBefore we proceed with product dispatch, please follow these steps:\nStep 1 - Register on our app (button below).\nStep 2 - Go to My Campaigns and continue the entire process on the app.'
              || E'\n\nIf there is any confusion, please reply to this email.';
  end if;

  select m.email_opt_out_at is not null into v_email_off from public.members m where m.id = p_recipient;
  if not coalesce(v_email_off, false) then
    select nullif(u.email::text, '') into v_email from auth.users u where u.id = p_recipient;
    if v_email ~* '@creators\.bountythreads\.app$' then v_email := null; end if;
    if v_email is null then select nullif(m.official_email, '') into v_email from public.members m where m.id = p_recipient; end if;
    if v_email is null then
      select nullif(c.email, '') into v_email
        from intel.ci_identity_actor_access a join private.creator_contact c on c.identity_id = a.identity_id
       where a.member_id = p_recipient and a.access_role = 'self' and a.revoked_at is null
         and c.email !~* '@creators\.bountythreads\.app$'
       order by a.granted_at limit 1;
    end if;
    if v_email is not null then
      insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
        values ('email', p_recipient, v_email, p_campaign, p_participation, v_nid, p_key,
          jsonb_build_object('subject',v_title,'html',coalesce(v_mail, v_body),'action_route',v_route,'action_label',v_label,'to_name',v_first), v_nid::text)
        on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;

  v_wa := intel.ci_wa_number(p_recipient);
  if v_wa is not null then
    if p_key in ('invited', 'bulk_invited') then
      -- every campaign invite (Super Admin / agency / brand, bulk or one-by-one) goes on the approved
      -- UTILITY template geek_campaign_access: {{1}} creator name · {{2}} campaign · {{3}} brand · {{4}} app link
      v_wa_payload := jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', v_label,
        'to_name', coalesce(v_first, 'there'), 'force_template', true,
        'wa_template', 'geek_campaign_access', 'wa_lang', 'en',
        'wa_vars', jsonb_build_array(coalesce(v_first, 'there'), coalesce(v_cname, p_vars->>'campaign', 'our campaign'),
                                     coalesce(v_cbrand, p_vars->>'brand', 'the brand'), 'LINK'));
    elsif sw.template_key is not null then
      -- every step update has its own fixed-text UTILITY template (geek_step_* / geek_team_update):
      --   {{1}} name · {{2}} campaign · {{3}} brand (team: what happened) · {{4}} app link
      v_wa_payload := jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', v_label,
        'to_name', v_first, 'force_template', true, 'wa_template', sw.wa_template, 'wa_lang', 'en',
        'wa_vars', jsonb_build_array(v_first, coalesce(v_cname, p_vars->>'campaign', 'your campaign'), v_v3, 'LINK'));
      -- "selected" and "contract sent" use the same template: don't send the same WhatsApp twice in a row
      if p_participation is not null and exists (select 1 from intel.ci_outbox o where o.channel = 'whatsapp'
           and o.participation_id = p_participation and o.payload->>'wa_template' = sw.wa_template
           and o.created_at > now() - interval '30 minutes') then
        v_wa_payload := null;
      end if;
    elsif sc.template_key is not null then
      v_wa_payload := null;   -- no approved step template for this one: email + in-app only
    else
      v_wa_payload := jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', v_label,
        'wa_template', t.wa_template_name, 'wa_vars', jsonb_build_array(coalesce(p_vars->>'campaign','')));
    end if;
    if v_wa_payload is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
      values ('whatsapp', p_recipient, v_wa, p_campaign, p_participation, v_nid, p_key, v_wa_payload, v_nid::text)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;
  return v_nid;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 1) Storage: where each creator already is, + the details that go with it
-- ---------------------------------------------------------------------------------------------------
alter table intel.ci_campaign_invite add column if not exists status       text;
alter table intel.ci_campaign_invite add column if not exists ship_address jsonb;
alter table intel.ci_campaign_invite add column if not exists courier      text;
alter table intel.ci_campaign_invite add column if not exists tracking_ref text;
alter table intel.ci_campaign_invite add column if not exists tracking_url text;
update intel.ci_campaign_invite set status = case when approved then 'approved' else 'invited' end where status is null;

-- "Courier received" / "delivered" / "Address ✓" / "yes" / "" → one of the six statuses (null = not understood)
create or replace function intel.ci_bulk_status(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := lower(btrim(coalesce(p, '')));
begin
  if v = '' or v in ('invited','invite','new','pending','apply','to apply','no','-','—','not approved') then return 'invited'; end if;
  if v ~ '(receiv|deliver|recieved|in hand|got it|reached)' then return 'courier_received'; end if;
  if v ~ '(courier|ship|dispatch|sent|transit|awb|on the way|out for)' then return 'courier_sent'; end if;
  if v ~ 'address' then return 'address_confirmed'; end if;
  if v ~ '(contract|sign)' then return 'contract_signed'; end if;
  if v ~ '^(y|yes|approved?|selected|confirmed?|final|done|ok|okay|true|1|✓|✔|☑|x|shortlisted|brand approved)$' then return 'approved'; end if;
  return null;
end $$;

create or replace function intel.ci_bulk_rank(p_status text)
returns int language sql immutable set search_path = '' as $$
  select case p_status when 'approved' then 1 when 'contract_signed' then 2 when 'address_confirmed' then 3
                       when 'courier_sent' then 4 when 'courier_received' then 5 else 0 end $$;

-- how far a participation already is, on the same 0–5 scale
create or replace function intel.ci_stage_rank(p_stage text)
returns int language sql immutable set search_path = '' as $$
  select case
    when p_stage in ('brand_confirmed','accepted','contract_sent') then 1
    when p_stage = 'contract_signed' then 2
    when p_stage = 'address_confirmed' then 3
    when p_stage = 'product_sent' then 4
    when p_stage in ('content_created','content_submitted','changes_requested','content_approved','published','completed') then 5
    else 0 end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2) The creator profile is made for them from the sheet (+ what Instagram already told us about the handle)
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_bulk_profile(p_member uuid, p_invite uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; i intel.ci_campaign_invite%rowtype; x intel.ci_external_creator%rowtype; v_first text; v_last text;
        v_email text; a jsonb; v_prev text;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.handle is not null then select * into x from intel.ci_external_creator where platform = 'instagram' and handle = lower(i.handle); end if;
  v_identity := intel.ci_member_identity(p_member);
  if v_identity is null then
    v_prev := current_setting('geek.bulk_bootstrap', true);
    perform set_config('geek.bulk_bootstrap', 'on', true);      -- the claim is already running: don't start it again
    insert into intel.ci_creator_identity(display_name, kind, is_claimed) values (null, 'creator', true) returning identity_id into v_identity;
    insert into intel.ci_identity_actor_access(identity_id, member_id, access_role, granted_by)
      values (v_identity, p_member, 'self', p_member) on conflict (identity_id, member_id, access_role) do nothing;
    perform set_config('geek.bulk_bootstrap', coalesce(v_prev, 'off'), true);
  end if;
  insert into intel.ci_creator_professional_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into intel.ci_creator_commercial_preference(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into intel.ci_profile_completion(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into private.creator_personal_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into private.creator_contact(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  if i.invite_id is null then return v_identity; end if;

  -- only empty fields are filled — nothing the creator wrote is ever overwritten
  update intel.ci_creator_professional_profile set
      display_name = coalesce(display_name, nullif(btrim(i.full_name), ''), x.display_name, i.handle),
      city_coarse = coalesce(city_coarse, nullif(btrim(i.city), ''), i.ship_address->>'city', x.city),
      state_coarse = coalesce(state_coarse, i.ship_address->>'state', x.state),
      bio = coalesce(bio, x.bio),
      profile_image_url = coalesce(profile_image_url, x.profile_picture_url),
      profile_image_source_platform = coalesce(profile_image_source_platform, case when x.profile_picture_url is not null then 'instagram' end),
      updated_at = now()
   where identity_id = v_identity;

  v_first := nullif(split_part(btrim(coalesce(i.full_name, '')), ' ', 1), '');
  v_last := nullif(btrim(substr(btrim(coalesce(i.full_name, '')), length(coalesce(v_first, '')) + 1)), '');
  update private.creator_personal_profile set first_name = coalesce(first_name, v_first), last_name = coalesce(last_name, v_last), updated_at = now()
   where identity_id = v_identity;

  v_email := case when i.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(i.email) end;
  update private.creator_contact set email = coalesce(email, v_email), whatsapp_e164 = coalesce(whatsapp_e164, i.phone_e164), updated_at = now()
   where identity_id = v_identity;

  update public.members set name = coalesce(nullif(btrim(name), ''), nullif(btrim(i.full_name), ''))
   where id = p_member and coalesce(btrim(name), '') = '' and coalesce(btrim(i.full_name), '') <> '';

  -- the sheet's address becomes their delivery address (only when they have none)
  a := i.ship_address;
  if a is not null and coalesce(btrim(a->>'line1'), '') <> ''
     and not exists (select 1 from private.creator_address ad where ad.identity_id = v_identity and ad.deleted_at is null) then
    insert into private.creator_address(identity_id, line1, line2, city, state, postal_code, country, label, is_default)
    values (v_identity, left(btrim(a->>'line1'), 300), nullif(btrim(a->>'line2'), ''),
            coalesce(nullif(btrim(a->>'city'), ''), nullif(btrim(i.city), '')), nullif(btrim(a->>'state'), ''),
            nullif(btrim(a->>'postal_code'), ''), 'IN', 'Home', true);
  end if;
  return v_identity;
end $$;

-- the identity trigger must not re-run the claim while the bulk upload makes the profile
create or replace function intel.tg_claim_on_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('geek.bulk_bootstrap', true), '') = 'on' then return null; end if;
  if new.access_role = 'self' and new.revoked_at is null then perform intel.ci_claim_member_invites(new.member_id); end if;
  return null;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3) Put a creator straight into the step the sheet says (no message storm: one message for where they are)
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_bulk_fastforward(p_part uuid, p_invite uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_target int; v_stage text; v_camp uuid; v_identity uuid; v_addr uuid;
        s record; v_ship uuid; v_name text; v_member uuid; v_why text := 'confirmed offline — bulk upload';
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  v_target := intel.ci_bulk_rank(coalesce(i.status, case when i.approved then 'approved' else 'invited' end));
  select stage, campaign_id, identity_id into v_stage, v_camp, v_identity from intel.ci_campaign_participation where participation_id = p_part;
  if v_stage is null or v_target < 1 or intel.ci_stage_rank(v_stage) >= v_target then return v_stage; end if;
  if v_stage in ('rejected','dropped','ineligible','brand_declined') then return v_stage; end if;

  if v_target >= 2 then perform set_config('geek.bulk_quiet', 'on', true); end if;
  begin
    -- 1) approved → contract issued
    if intel.ci_stage_rank(v_stage) < 1 then perform intel.ci_bulk_promote(p_part, p_actor); end if;
    select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;
    if v_stage in ('brand_confirmed','accepted') then perform intel.ci_issue_contract(p_part, p_actor); end if;
    select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;

    -- 2) contract signed (offline)
    if v_target >= 2 and v_stage = 'contract_sent' then
      update intel.ci_campaign_contract set signed_at = coalesce(signed_at, now()),
             signature_name = coalesce(signature_name, 'Confirmed offline (bulk upload)'), asci_ack = true, terms_ack = true, updated_at = now()
       where participation_id = p_part;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
        values (v_camp, p_part, 'contract', 'issued', 'signed', p_actor, v_why);
      perform intel.ci_participation_advance(p_part, 'contract_signed', p_actor, v_why);
      v_stage := 'contract_signed';
    end if;

    -- 3) address confirmed (the sheet's address, when given, is their delivery address)
    if v_target >= 3 and v_stage = 'contract_signed' then
      select address_id into v_addr from private.creator_address
       where identity_id = v_identity and deleted_at is null order by is_default desc, created_at desc limit 1;
      if v_addr is not null then update intel.ci_campaign_participation set shipping_address_id = v_addr where participation_id = p_part; end if;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
        values (v_camp, p_part, 'address', null, 'confirmed', p_actor, v_why);
      perform intel.ci_participation_advance(p_part, 'address_confirmed', p_actor, v_why);
      v_stage := 'address_confirmed';
    end if;

    -- 4) courier sent
    if v_target >= 4 and v_stage in ('address_confirmed','accepted') then
      select * into s from intel.ci_campaign_shipment where participation_id = p_part order by created_at desc limit 1;
      if s.shipment_id is not null and s.status in ('pending','shipped') then
        update intel.ci_campaign_shipment set courier = coalesce(i.courier, courier, 'Courier'), tracking_ref = coalesce(i.tracking_ref, tracking_ref),
               tracking_url = coalesce(i.tracking_url, tracking_url), status = 'shipped', shipped_at = coalesce(shipped_at, now())
         where shipment_id = s.shipment_id returning shipment_id into v_ship;
      else
        insert into intel.ci_campaign_shipment(participation_id, product, courier, tracking_ref, tracking_url, shipped_at, status)
        values (p_part, coalesce((select product from intel.ci_campaign_contract where participation_id = p_part),
                                 (select product from intel.ci_campaign where campaign_id = v_camp)),
                coalesce(i.courier, 'Courier'), i.tracking_ref, i.tracking_url, now(), 'shipped') returning shipment_id into v_ship;
      end if;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
        values (v_camp, p_part, 'shipment', s.status, 'shipped', p_actor, v_why);
      perform intel.ci_participation_advance(p_part, 'product_sent', p_actor, 'courier sent — ' || coalesce(i.courier, 'courier') || coalesce(' ' || i.tracking_ref, ''));
      v_stage := 'product_sent';
    end if;

    -- 5) courier received → video brief unlocks, video deadline starts now
    if v_target >= 5 and v_stage = 'product_sent' then
      select shipment_id into v_ship from intel.ci_campaign_shipment where participation_id = p_part and status = 'shipped'
       order by created_at desc limit 1;
      if v_ship is not null then
        perform intel.ci_shipment_set_status(v_ship, 'delivered', p_actor, jsonb_build_object('note', v_why));
      end if;
    end if;
  exception when others then
    perform set_config('geek.bulk_quiet', 'off', true);
    raise;
  end;
  perform set_config('geek.bulk_quiet', 'off', true);

  -- ONE message for the step they are on now
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;
  v_member := intel.ci_member_of_identity(v_identity);
  select name into v_name from intel.ci_campaign where campaign_id = v_camp;
  if v_target >= 2 and v_member is not null then
    perform intel.ci_notify(v_member, v_camp, p_part,
      case v_stage when 'contract_signed' then 'confirm_address' when 'product_sent' then 'product_shipped'
                   when 'content_created' then 'parcel_received' else null end,
      jsonb_build_object('campaign', coalesce(v_name, 'your campaign'), 'participation_id', p_part::text))
    where v_stage in ('contract_signed','product_sent','content_created');
  end if;
  return v_stage;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4) Join the campaign: profile made from the sheet, then straight to the sheet's step
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_bulk_attach(p_invite uuid, p_member uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_identity uuid; v_part uuid; v_stage text; v_name text; v_brand text; v_prod text;
        v_status text; v_ok boolean; v_ig boolean; v_req jsonb; v_need jsonb := '[]'::jsonb;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite for update;
  if i.invite_id is null then return null; end if;
  v_status := coalesce(i.status, case when i.approved then 'approved' else 'invited' end);
  v_ok := v_status <> 'invited';
  select c.name, coalesce(c.submitted_brand_name, b.name), c.product into v_name, v_brand, v_prod
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = i.campaign_id;

  -- the sheet's WhatsApp number carries their updates when they have none of their own
  if i.phone_e164 is not null then
    update public.members set whatsapp_e164 = i.phone_e164
     where id = p_member and whatsapp_e164 is null and not exists (select 1 from public.wa_contacts w where w.user_id = p_member);
  end if;

  -- first their own profile + Instagram (media kit); the sheet only pre-fills what they haven't written
  v_identity := intel.ci_member_identity(p_member);
  if v_identity is not null then perform intel.ci_bulk_profile(p_member, p_invite); end if;
  v_ig := exists (select 1 from public.social_accounts sa where sa.member_id = p_member and sa.platform = 'instagram'
                    and coalesce(sa.username, '') <> '');
  if v_identity is null then v_need := v_need || '"Create the creator profile"'::jsonb;
  else
    v_req := intel.ci_profile_requirements(v_identity);
    if not coalesce((v_req->>'complete')::boolean, false) then v_need := v_need || '"Complete the creator profile"'::jsonb; end if;
  end if;
  if not v_ig then v_need := v_need || '"Connect Instagram (media kit)"'::jsonb; end if;
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
    if intel.ci_bulk_rank(v_status) >= 2 then perform set_config('geek.bulk_quiet', 'on', true); end if;
    insert into intel.ci_campaign_participation(campaign_id, identity_id, stage, needs_approval, applied_profile)
    values (i.campaign_id, v_identity, case when v_ok then 'brand_confirmed' else 'invited' end, not v_ok, i.handle)
    returning participation_id, stage into v_part, v_stage;
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (i.campaign_id, v_part, 'participation', null, case when v_ok then 'brand_confirmed' else 'invited' end, p_actor,
            case when v_ok then 'approved on the bulk upload' else 'invited from the bulk upload' end);
    if not v_ok then
      perform intel.ci_notify(p_member, i.campaign_id, v_part, 'bulk_invited',
        jsonb_build_object('campaign', coalesce(v_name,'a campaign'), 'brand', coalesce(v_brand,'A brand'),
                           'product_line', case when v_prod is null then '' else ' You get: ' || v_prod || '.' end));
    end if;
  end if;
  update intel.ci_campaign_invite set claimed_by = p_member, claimed_at = coalesce(claimed_at, now()), reserved_by = p_member,
         participation_id = v_part where invite_id = p_invite;
  if v_ok then v_stage := intel.ci_bulk_fastforward(v_part, p_invite, p_actor); end if;
  perform set_config('geek.bulk_quiet', 'off', true);
  select stage into v_stage from intel.ci_campaign_participation where participation_id = v_part;
  return jsonb_build_object('status', 'joined', 'member_id', p_member, 'participation_id', v_part, 'stage', v_stage);
end $$;

-- "waiting" message: what is left before the campaign opens
update intel.ci_notification_template set
  title = '{{brand}} has a campaign waiting for you: {{campaign}}',
  body_md = 'You''re on **{{campaign}}** with {{brand}}. Connect your Instagram (media kit) and complete your creator profile — the campaign opens for you the moment it''s done, right at your step.',
  action_route = 'mediakit', action_label = 'Finish setting up'
 where template_key = 'bulk_waiting';
update intel.ci_step_copy set did = 'registering for {{campaign}} with {{brand}}',
  next_step = 'connect your Instagram (media kit) and complete your creator profile in the app',
  then_we = 'open the campaign for you right at your step'
 where template_key = 'bulk_waiting';

-- ---------------------------------------------------------------------------------------------------
-- 5) Team side
-- ---------------------------------------------------------------------------------------------------
-- one row of the sheet → the address object ({line1, city, state, postal_code})
create or replace function intel.ci_bulk_address(x jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_line text := nullif(btrim(coalesce(x->>'address','')), ''); v_pin text := nullif(regexp_replace(coalesce(x->>'pincode',''), '\D', '', 'g'), '');
begin
  if v_line is null then return null; end if;
  if v_pin is null then v_pin := substring(v_line from '(?:^|\D)(\d{6})(?:\D|$)'); end if;
  return jsonb_strip_nulls(jsonb_build_object('line1', left(v_line, 300), 'city', nullif(btrim(coalesce(x->>'city','')), ''),
           'state', nullif(btrim(coalesce(x->>'state','')), ''), 'postal_code', v_pin));
end $$;

-- rows: [{name, handle, phone, email, city, followers, status, address, state, pincode, courier, tracking}]
create or replace function api.bulk_preview(p_campaign uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare x jsonb; n int := 0; out jsonb := '[]'::jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_stage text; v_who text;
        v_st text; v_ig jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_st := coalesce(intel.ci_bulk_status(x->>'status'), case when lower(coalesce(x->>'approved','')) in ('true','yes','1') then 'approved' end);
    v_m := intel.ci_find_creator(v_ph, v_em, v_h); v_stage := null; v_who := null; v_ig := null;
    if v_m is not null then
      select coalesce((select '@'||sa.username from public.social_accounts sa where sa.member_id = v_m and sa.platform='instagram' limit 1), m.name)
        into v_who from public.members m where m.id = v_m;
      select p.stage into v_stage from intel.ci_campaign_participation p
       where p.campaign_id = p_campaign and p.identity_id = intel.ci_member_identity(v_m);
    end if;
    if v_h is not null then
      select jsonb_strip_nulls(jsonb_build_object('name', e.display_name, 'followers', e.followers, 'pic', e.profile_picture_url))
        into v_ig from intel.ci_external_creator e where e.platform = 'instagram' and e.handle = v_h;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('i', n, 'phone', v_ph, 'email', v_em, 'handle', v_h,
      'phone_bad', coalesce(x->>'phone','') <> '' and v_ph is null,
      'email_bad', coalesce(x->>'email','') <> '' and v_em is null,
      'no_contact', v_ph is null and v_em is null and v_h is null,
      'status', coalesce(v_st, 'invited'), 'status_bad', coalesce(btrim(x->>'status'),'') <> '' and v_st is null,
      'needs_address', v_st in ('address_confirmed','courier_sent','courier_received') and coalesce(btrim(x->>'address'),'') = '',
      'on_platform', v_m is not null, 'who', v_who, 'stage', v_stage, 'ig', v_ig));
    n := n + 1;
  end loop;
  return out;
end $$;

create or replace function api.bulk_import_creators(p_campaign uuid, p_rows jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_id uuid; v_org uuid; v_batch uuid := gen_random_uuid();
        v_res jsonb; v_added int := 0; v_invited int := 0; v_waiting int := 0; v_skipped int := 0; v_msgs int := 0;
        v_note text := nullif(btrim(coalesce(p_note,'')),''); v_status text; v_addr jsonb; v_trk text; v_courier text; v_part uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 2000 then raise exception 'upload at most 2000 creators at a time' using errcode = '22023'; end if;
  select org_id into v_org from public.members where id = auth.uid();

  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_status := coalesce(intel.ci_bulk_status(x->>'status'),
                         case when lower(coalesce(x->>'approved','')) in ('true','yes','1') then 'approved' else 'invited' end);
    v_addr := intel.ci_bulk_address(x);
    v_courier := nullif(btrim(coalesce(x->>'courier','')), '');
    v_trk := nullif(btrim(coalesce(x->>'tracking','')), '');
    if v_ph is null and v_em is null and v_h is null then v_skipped := v_skipped + 1; continue; end if;

    -- one row per person per campaign (matched on phone, then email, then Instagram)
    select invite_id into v_id from intel.ci_campaign_invite
     where campaign_id = p_campaign and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and lower(email) = v_em)
                                          or (v_h is not null and lower(handle) = v_h))
     order by (phone_e164 = v_ph) desc nulls last limit 1;
    if v_id is null then
      insert into intel.ci_campaign_invite(campaign_id, platform, handle, note, invited_by, org_id, source, full_name, phone_e164, email,
                                           city, followers, extra, approved, status, ship_address, courier, tracking_ref, tracking_url,
                                           batch_id, dm_status)
      values (p_campaign, 'instagram', v_h, v_note, auth.uid(), v_org, 'bulk', nullif(btrim(coalesce(x->>'name','')),''), v_ph, v_em,
              nullif(btrim(coalesce(x->>'city','')),''), nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'),'')::bigint,
              coalesce(x->'extra','{}'::jsonb), v_status <> 'invited', v_status, v_addr, v_courier,
              case when v_trk !~* '^https?://' then v_trk end, case when v_trk ~* '^https?://' then v_trk end, v_batch, 'manual')
      returning invite_id into v_id;
    else
      update intel.ci_campaign_invite set
        handle = coalesce(handle, v_h), phone_e164 = coalesce(phone_e164, v_ph), email = coalesce(email, v_em),
        full_name = coalesce(nullif(btrim(coalesce(x->>'name','')),''), full_name), city = coalesce(nullif(btrim(coalesce(x->>'city','')),''), city),
        status = case when intel.ci_bulk_rank(v_status) > intel.ci_bulk_rank(coalesce(status,'invited')) then v_status else coalesce(status,'invited') end,
        approved = approved or v_status <> 'invited',
        ship_address = coalesce(v_addr, ship_address), courier = coalesce(v_courier, courier),
        tracking_ref = coalesce(case when v_trk !~* '^https?://' then v_trk end, tracking_ref),
        tracking_url = coalesce(case when v_trk ~* '^https?://' then v_trk end, tracking_url),
        note = coalesce(v_note, note), batch_id = v_batch, source = 'bulk'
       where invite_id = v_id;
    end if;

    -- their Instagram goes to the auto-fetch queue (followers, name, photo, bio) — the profile picks it up
    if v_h is not null then
      perform intel.ci_upsert_external(jsonb_build_object('handle', v_h, 'name', nullif(btrim(coalesce(x->>'name','')),''),
                                                          'city', nullif(btrim(coalesce(x->>'city','')),'')), v_org, 'bulk');
    end if;

    v_m := intel.ci_find_creator(v_ph, v_em, v_h);
    select participation_id into v_part from intel.ci_campaign_invite where invite_id = v_id;
    if v_part is not null then
      perform intel.ci_bulk_fastforward(v_part, v_id, auth.uid());   -- already in: move them to the sheet's step
      v_added := v_added + 1;
    elsif v_m is not null then
      v_res := intel.ci_bulk_attach(v_id, v_m, auth.uid());
      if v_res->>'status' = 'joined' then v_added := v_added + 1; else v_waiting := v_waiting + 1; end if;
    else
      if (select invites_sent from intel.ci_campaign_invite where invite_id = v_id) = 0 then
        v_msgs := v_msgs + intel.ci_send_bulk_invite(v_id);
      end if;
      v_invited := v_invited + 1;
    end if;
  end loop;

  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'analytics', 'bulk_creator_upload', jsonb_build_object('campaign', p_campaign, 'added', v_added, 'invited', v_invited,
          'waiting', v_waiting, 'skipped', v_skipped));
  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'invited', v_invited, 'waiting_profile', v_waiting,
                            'skipped', v_skipped, 'messages', v_msgs);
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
      'sheet_status', coalesce(i.status, case when i.approved then 'approved' else 'invited' end),
      'address', i.ship_address, 'courier', i.courier, 'tracking', coalesce(i.tracking_ref, i.tracking_url),
      'ig', case when x.handle is not null then jsonb_strip_nulls(jsonb_build_object('name', x.display_name, 'followers', x.followers,
                 'pic', x.profile_picture_url, 'fetched', x.enriched_at is not null, 'error', x.enrich_error)) end,
      'member_id', mem.mid,
      'status', case when p.participation_id is not null then 'joined' when mem.mid is not null then 'registered' else 'invited' end,
      'stage', p.stage, 'participation_id', p.participation_id,
      'instagram', (select '@'||sa.username from public.social_accounts sa where sa.member_id = mem.mid and sa.platform='instagram' limit 1),
      'missing', case when mem.mid is null then null else
                   case when not exists (select 1 from public.social_accounts sa where sa.member_id = mem.mid and sa.platform = 'instagram')
                        then jsonb_build_array('Connect Instagram (media kit)') else '[]'::jsonb end
                   || case when intel.ci_member_identity(mem.mid) is null then jsonb_build_array('Creator profile not started')
                           else coalesce(intel.ci_profile_requirements(intel.ci_member_identity(mem.mid))->'missing', '[]'::jsonb) end end,
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

-- change a row's status after the upload (moves them forward if they're already in; never backwards)
create or replace function api.bulk_set_status(p_invite uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_st text := intel.ci_bulk_status(p_status); v_stage text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or not intel.ci_can_manage_campaign(i.campaign_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_st is null then raise exception 'unknown status "%"', p_status using errcode = '22023'; end if;
  update intel.ci_campaign_invite set status = v_st, approved = v_st <> 'invited' where invite_id = p_invite;
  if i.participation_id is not null then v_stage := intel.ci_bulk_fastforward(i.participation_id, p_invite, auth.uid()); end if;
  return jsonb_build_object('status', v_st, 'stage', v_stage);
end $$;

create or replace function api.bulk_set_approved(p_invite uuid, p_approved boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not p_approved then
    update intel.ci_campaign_invite set approved = false, status = 'invited'
     where invite_id = p_invite and intel.ci_can_manage_campaign(campaign_id);
    return jsonb_build_object('approved', false);
  end if;
  return api.bulk_set_status(p_invite, 'approved') || jsonb_build_object('approved', true);
end $$;

-- signed-out invite screen: also says which step they're already on
create or replace function public.invite_preview(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('campaign', c.name, 'brand', coalesce(c.submitted_brand_name, b.name), 'product', c.product,
            'first_name', nullif(split_part(btrim(coalesce(i.full_name,'')), ' ', 1), ''), 'approved', i.approved,
            'sheet_status', coalesce(i.status, case when i.approved then 'approved' else 'invited' end),
            'phone_hint', case when i.phone_e164 is not null then '••••' || right(i.phone_e164, 4) end,
            'joined', i.claimed_at is not null)
     from intel.ci_campaign_invite i join intel.ci_campaign c on c.campaign_id = i.campaign_id
     left join intel.ci_brand b on b.brand_id = c.brand_id where i.token = p_token) $$;

revoke all on function intel.ci_bulk_status(text), intel.ci_bulk_rank(text), intel.ci_stage_rank(text), intel.ci_bulk_address(jsonb),
  intel.ci_bulk_profile(uuid,uuid), intel.ci_bulk_fastforward(uuid,uuid,uuid), intel.ci_bulk_attach(uuid,uuid,uuid),
  intel.tg_claim_on_identity() from public, anon, authenticated;
revoke all on function api.bulk_set_status(uuid,text), api.bulk_preview(uuid,jsonb), api.bulk_import_creators(uuid,jsonb,text),
  api.bulk_invites(uuid), api.bulk_set_approved(uuid,boolean) from public, anon;
grant execute on function api.bulk_set_status(uuid,text), api.bulk_preview(uuid,jsonb), api.bulk_import_creators(uuid,jsonb,text),
  api.bulk_invites(uuid), api.bulk_set_approved(uuid,boolean) to authenticated;
revoke all on function public.invite_preview(uuid) from public;
grant execute on function public.invite_preview(uuid) to anon, authenticated;
