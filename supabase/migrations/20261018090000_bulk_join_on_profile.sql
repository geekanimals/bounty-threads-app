-- Bulk upload: a NEW creator lands on the sheet's step the moment their setup is done — not only after an app reload.
--
-- Before: the campaign invite was claimed when the creator's identity was created and when WhatsApp was verified.
-- At that moment Instagram isn't connected and the profile isn't complete yet, so the invite was only held
-- ("waiting"). Nothing re-ran the claim when they then connected Instagram or completed the profile, so they
-- sat outside the campaign until the app happened to reload.
-- Now connecting Instagram or saving any part of the creator profile re-checks their open invites. When everything is
-- in place they join right at the sheet's step (with that step's ONE message, never a second one).
--
-- Also: a new person whose sheet step has no step message of its own (Address confirmed, Video submitted) got no
-- message at all, so they never learned they had to register. Approved-or-later steps without a message of their own now
-- send the approval invite (register & join). Registered / Screened / Sent to brand still send nothing, because the brand
-- hasn't said yes yet.
-- ADDITIVE: new triggers + one function redefined (same signature).

-- 0) the claim marks itself running, so the profile saves it makes while joining don't start it again
create or replace function intel.ci_claim_member_invites(p_member uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0; v_prev text; v_phones text[]; v_emails text[]; v_handles text[]; v_res jsonb;
begin
  if p_member is null then return 0; end if;
  if exists (select 1 from public.members m where m.id = p_member and coalesce(m.role,'creator') <> 'creator') then return 0; end if;
  select array_remove(array[
           (select w.phone_e164 from public.wa_contacts w where w.user_id = p_member),
           (select m.whatsapp_e164 from public.members m where m.id = p_member),
           (select intel.ci_norm_phone(u.phone) from auth.users u where u.id = p_member and coalesce(u.phone,'') <> '')], null) into v_phones;
  select array_remove(array[
           (select lower(u.email::text) from auth.users u where u.id = p_member),
           (select lower(c.email) from private.creator_contact c where c.identity_id = intel.ci_member_identity(p_member))], null) into v_emails;
  select coalesce(array_agg(lower(sa.username)), '{}') into v_handles from public.social_accounts sa
   where sa.member_id = p_member and sa.platform = 'instagram' and coalesce(sa.username,'') <> '';

  v_prev := current_setting('geek.claim_running', true);
  perform set_config('geek.claim_running', 'on', true);       -- the profile saves made while joining don't re-run it
  for r in select invite_id from intel.ci_campaign_invite
            where claimed_at is null
              and (reserved_by = p_member or phone_e164 = any(v_phones) or lower(email) = any(v_emails) or lower(handle) = any(v_handles))
            order by created_at loop
    begin
      v_res := intel.ci_bulk_attach(r.invite_id, p_member, null);
      if v_res->>'status' = 'joined' then v_n := v_n + 1; end if;
    exception when others then raise warning 'invite claim skipped: %', sqlerrm;
    end;
  end loop;
  perform set_config('geek.claim_running', coalesce(v_prev, 'off'), true);
  return v_n;
end $$;

-- 1) re-check open invites (cheap: only members who have one waiting for them)
create or replace function intel.ci_rejoin_waiting(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_member is null then return; end if;
  if coalesce(current_setting('geek.claim_running', true), '') = 'on' then return; end if;   -- the claim itself saves the profile
  if coalesce(current_setting('geek.bulk_bootstrap', true), '') = 'on' then return; end if;
  if not exists (select 1 from intel.ci_campaign_invite i where i.claimed_at is null and i.reserved_by = p_member) then return; end if;
  begin
    perform intel.ci_claim_member_invites(p_member);
  exception when others then
    perform set_config('geek.claim_running', 'off', true);
    raise warning 'invite re-check skipped: %', sqlerrm;
  end;
end $$;
revoke all on function intel.ci_rejoin_waiting(uuid) from public, anon, authenticated;

create or replace function intel.tg_rejoin_on_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_rejoin_waiting(intel.ci_member_of_identity(new.identity_id));
  return null;
exception when others then return null;    -- never block the creator's own save
end $$;

create or replace function intel.tg_rejoin_on_instagram()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.platform = 'instagram' and coalesce(new.username, '') <> ''
     and (tg_op = 'INSERT' or new.username is distinct from old.username or new.member_id is distinct from old.member_id) then
    perform intel.ci_rejoin_waiting(new.member_id);
  end if;
  return null;
exception when others then return null;
end $$;

drop trigger if exists ci_rejoin_on_instagram on public.social_accounts;
create trigger ci_rejoin_on_instagram after insert or update on public.social_accounts
  for each row execute function intel.tg_rejoin_on_instagram();

drop trigger if exists ci_rejoin_on_prof on intel.ci_creator_professional_profile;
create trigger ci_rejoin_on_prof after insert or update on intel.ci_creator_professional_profile
  for each row execute function intel.tg_rejoin_on_profile();
drop trigger if exists ci_rejoin_on_personal on private.creator_personal_profile;
create trigger ci_rejoin_on_personal after insert or update on private.creator_personal_profile
  for each row execute function intel.tg_rejoin_on_profile();
drop trigger if exists ci_rejoin_on_contact on private.creator_contact;
create trigger ci_rejoin_on_contact after insert or update on private.creator_contact
  for each row execute function intel.tg_rejoin_on_profile();
drop trigger if exists ci_rejoin_on_address on private.creator_address;
create trigger ci_rejoin_on_address after insert or update on private.creator_address
  for each row execute function intel.tg_rejoin_on_profile();
drop trigger if exists ci_rejoin_on_completion on intel.ci_profile_completion;
create trigger ci_rejoin_on_completion after insert or update on intel.ci_profile_completion
  for each row execute function intel.tg_rejoin_on_profile();

-- 2) the message for someone who isn't on Geek OS yet: approved-or-later steps always invite them to register
create or replace function intel.ci_send_bulk_invite(p_invite uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_name text; v_brand text; v_prod text; v_n int := 0; v_route text; v_first text;
        v_st text; v_key text; sw intel.ci_step_wa%rowtype; t intel.ci_notification_template%rowtype; v_subject text; v_mail text; v_wa jsonb;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or i.claimed_at is not null then return 0; end if;
  v_st := coalesce(i.status, case when i.approved then 'approved' else 'registered' end);
  v_key := intel.ci_bulk_status_key(v_st);
  -- a step with no message of its own, but the brand already said yes → the approval invite (register & join)
  if v_key is null and intel.ci_bulk_rank(v_st) >= 4 then v_key := 'invited'; end if;
  if v_key is null then return 0; end if;
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

-- 3) catch up: creators who already finished their setup but are still waiting outside their campaign join now
--    (same rules — only when Instagram + the profile are really done; one step message, never a second)
do $$ declare m uuid; begin
  for m in select distinct reserved_by from intel.ci_campaign_invite where claimed_at is null and reserved_by is not null loop
    perform intel.ci_rejoin_waiting(m);
  end loop;
end $$;
