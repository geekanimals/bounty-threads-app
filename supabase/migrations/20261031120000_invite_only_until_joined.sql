-- Bulk upload / sheet creators: until they register, they get ONLY the invite ("you're approved — register & join").
-- Before: a creator not on Geek OS yet got the sheet step's message instead (contract / address / courier sent /
-- parcel received …) and a new one every time the team moved their step — several step messages before they even
-- had an account. Now:
--   • not joined yet → the approval invite (geek_campaign_access) whatever their step is; moving their step later
--     sends nothing (Resend invite and the invite reminders still re-send the invite, as before)
--   • the moment they join (register + connect) they land on their step and get THAT step's one message.
-- ADDITIVE / replaces function bodies only.

-- 1) the invite message: always the approval invite once the brand said yes (or later)
create or replace function intel.ci_send_bulk_invite(p_invite uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_name text; v_brand text; v_prod text; v_n int := 0; v_route text; v_first text;
        v_st text; v_key text; sw intel.ci_step_wa%rowtype; t intel.ci_notification_template%rowtype; v_subject text; v_mail text; v_wa jsonb;
        v_resend boolean := coalesce(current_setting('geek.invite_resend', true), '') = 'on';
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or i.claimed_at is not null then return 0; end if;
  v_st := coalesce(i.status, case when i.approved then 'approved' else 'registered' end);
  v_key := intel.ci_bulk_status_key(v_st);
  -- approved or any later step: they are not on Geek OS yet, so the only message is the invite (register & join)
  if intel.ci_bulk_rank(v_st) >= 4 then v_key := 'invited'; end if;
  if v_key is null then return 0; end if;
  -- already invited: a step change on the sheet / list sends nothing more (Resend invite + reminders do re-send)
  if v_key = 'invited' and i.invites_sent > 0 and not v_resend then
    update intel.ci_campaign_invite set status_messaged = v_st where invite_id = p_invite;
    return 0;
  end if;
  select c.name, coalesce(c.submitted_brand_name, b.name), c.product into v_name, v_brand, v_prod
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = i.campaign_id;
  v_first := coalesce(nullif(split_part(btrim(coalesce(i.full_name,'')), ' ', 1), ''), case when i.handle is not null then '@' || i.handle end, 'there');
  v_route := '/app.html?cinv=' || i.token::text;

  if v_key = 'invited' then
    v_subject := 'Approved for ' || coalesce(v_name,'the campaign') || ' 🎉';
    v_mail := 'Hello ' || v_first || E',\n\nThank you for applying for the campaign ' || coalesce(v_name,'our campaign')
           || E'.\n\nCongratulations! Your profile has been approved by ' || coalesce(v_brand,'the brand')
           || ' for the upcoming barter collaboration through Geek Creative Agency.'
           || case when i.note is not null then ' Note from the brand: “' || i.note || '”' else '' end
           || E'\n\nBefore we proceed with product dispatch, please follow these steps:\nStep 1 - Register on our app (button below).\nStep 2 - Go to My Campaigns and continue the entire process on the app.'
           || E'\n\nIf there is any confusion, please reply to this email.';
    v_wa := jsonb_build_object('title', v_subject, 'text', v_mail, 'action_route', v_route, 'action_label', 'Register & join', 'to_name', v_first,
              'force_template', true, 'wa_template', 'geek_campaign_access', 'wa_lang', 'en',
              'wa_vars', jsonb_build_array(v_first, coalesce(v_name,'our campaign'), coalesce(v_brand,'the brand'), 'LINK'));
  else
    select * into sw from intel.ci_step_wa where template_key = v_key;
    select * into t from intel.ci_notification_template where template_key = v_key;
    if sw.template_key is null then return 0; end if;
    v_subject := intel.ci_render(coalesce(t.title, coalesce(v_name,'Your campaign')), jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'brand', coalesce(v_brand,'the brand')));
    v_mail := replace(replace(replace(replace(
                regexp_replace(sw.body, E'\n\n[^\n]*\\{\\{4\\}\\}', E'\n\nClick the button below to open it on the app.'),
                '*', ''), '{{1}}', v_first), '{{2}}', coalesce(v_name, 'your campaign')), '{{3}}', coalesce(v_brand, 'the brand'));
    v_mail := replace(v_mail, E'\n\nThank you!\nTeam Geek Animals', '');
    v_wa := jsonb_build_object('title', v_subject, 'text', v_mail, 'action_route', v_route, 'action_label', 'Open the app', 'to_name', v_first,
              'force_template', true, 'wa_template', sw.wa_template, 'wa_lang', 'en',
              'wa_vars', jsonb_build_array(v_first, coalesce(v_name,'your campaign'), coalesce(v_brand,'the brand'), 'LINK'));
  end if;

  if i.phone_e164 is not null and not exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null) then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('whatsapp', null, i.phone_e164, i.campaign_id, 'bulk_invite', v_wa, 'binv:' || i.invite_id || ':wa:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if i.email is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('email', null, i.email, i.campaign_id, 'bulk_invite',
            jsonb_build_object('subject', v_subject, 'html', v_mail, 'to_name', v_first, 'action_route', v_route,
                               'action_label', case when v_key = 'invited' then 'Register & join' else 'Open the app' end),
            'binv:' || i.invite_id || ':em:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  update intel.ci_campaign_invite set invites_sent = invites_sent + 1, last_invited_at = now(), status_messaged = v_st where invite_id = p_invite;
  return v_n;
end $$;
revoke all on function intel.ci_send_bulk_invite(uuid) from public, anon, authenticated;

-- 2) "Resend invite" and the invite reminders really re-send it
create or replace function intel.ci_send_bulk_invite_resend(p_invite uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  perform set_config('geek.invite_resend', 'on', true);
  begin v := intel.ci_send_bulk_invite(p_invite);
  exception when others then perform set_config('geek.invite_resend', 'off', true); raise; end;
  perform set_config('geek.invite_resend', 'off', true);
  return v;
end $$;
revoke all on function intel.ci_send_bulk_invite_resend(uuid) from public, anon, authenticated;

do $$ declare f text; d text; begin
  foreach f in array array['api.bulk_resend_invite(uuid)', 'intel.ci_run_invite_reminders()'] loop
    begin
      d := pg_get_functiondef(f::regprocedure);
      if position('ci_send_bulk_invite_resend(' in d) = 0 then
        execute replace(d, 'intel.ci_send_bulk_invite(', 'intel.ci_send_bulk_invite_resend(');
      end if;
    exception when undefined_function then raise notice '% not found — skipped', f;
    end;
  end loop;
end $$;

-- 3) joining: the creator never got a step message while outside the campaign — they get their step's message now
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

  if i.phone_e164 is not null then
    update public.members set whatsapp_e164 = i.phone_e164
     where id = p_member and whatsapp_e164 is null and not exists (select 1 from public.wa_contacts w where w.user_id = p_member);
  end if;

  v_identity := intel.ci_bulk_profile(p_member, p_invite);
  if coalesce(current_setting('geek.bulk_force', true), '') <> 'on' then v_need := intel.ci_join_needs(p_member); end if;
  if jsonb_array_length(v_need) > 0 then
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
  -- onto their step; ONE message for that step now (before joining they only ever got the invite).
  -- A creator who was already on the campaign (claimed before) and got the step message keeps the old rule.
  v_stage := intel.ci_bulk_fastforward(v_part, p_invite, p_actor,
               i.claimed_at is null or coalesce(i.status_messaged, '') <> v_status, true);
  perform set_config('geek.bulk_quiet', 'off', true);
  select stage into v_stage from intel.ci_campaign_participation where participation_id = v_part;
  return jsonb_build_object('status', 'joined', 'member_id', p_member, 'participation_id', v_part, 'stage', v_stage);
end $$;
revoke all on function intel.ci_bulk_attach(uuid, uuid, uuid) from public, anon, authenticated;
