-- Every step update speaks the same structured, Utility-style message on WhatsApp AND email:
--   Hi {{1}},  Thank you for {{2}}.  Next, please {{3}}. Once that is done, we will {{4}}.
--   Click the link below to continue on the app: {{5}}   Thank you! · Team Geek Animals
-- WhatsApp template: geek_campaign_step (UTILITY, footer "Reply STOP to stop WhatsApp updates").
-- Until Meta approves it, the dispatcher falls back to geek_campaign_update automatically.
-- Invites keep geek_campaign_access. The email carries the same words (professional layout in the dispatcher).
-- ADDITIVE.

create table if not exists intel.ci_step_copy (
  template_key text primary key,
  did          text not null,     -- "Thank you for …"
  next_step    text not null,     -- "Next, please …"
  then_we      text not null      -- "Once that is done, we will …"
);
alter table intel.ci_step_copy enable row level security;
revoke all on intel.ci_step_copy from anon, authenticated;

insert into intel.ci_step_copy(template_key, did, next_step, then_we) values
  ('brand_confirmed', 'your interest in {{campaign}} ({{brand}}) — your profile has been selected', 'read and sign your contract in the app', 'ask you to confirm your delivery address'),
  ('contract_sent', 'being part of {{campaign}} ({{brand}})', 'read and sign your contract in the app', 'ask you to confirm your delivery address'),
  ('confirm_address', 'signing the contract for {{campaign}} ({{brand}})', 'confirm your delivery address', 'ship your product to your address'),
  ('product_shipped', 'confirming your address for {{campaign}} — your product has been shipped', 'track your parcel and tap Received in the app when it arrives', 'unlock your video brief'),
  ('parcel_received', 'confirming that your {{campaign}} product has arrived', 'read the video brief and submit your video link in the app', 'send your video to {{brand}} for review'),
  ('changes_requested', 'submitting your video for {{campaign}}', 'make the changes {{brand}} asked for and submit your video again', 'send it back to {{brand}} for review'),
  ('content_approved', 'your video for {{campaign}} — {{brand}} has approved it', 'post it on Instagram from the app using Let''s post', 'track your post and share the results with {{brand}}'),
  ('video_due', 'being part of {{campaign}} ({{brand}})', 'submit your video link in the app before the deadline', 'send your video to {{brand}} for review'),
  ('video_nudge', 'being part of {{campaign}} ({{brand}})', 'submit your video link in the app soon', 'send your video to {{brand}} for review'),
  ('video_warning', 'being part of {{campaign}} — your video is now overdue', 'submit your video link in the app today', 'keep your collaboration with {{brand}} active'),
  ('video_final_warning', 'being part of {{campaign}} — this is the final reminder for your video', 'submit your video link in the app today', 'keep your account and collaboration active'),
  ('video_blocked', 'being part of {{campaign}} — your account is on hold as the video was not received', 'submit your video in the app and reply here to talk to the Geek team', 'review your account and unblock it'),
  ('video_unblocked', 'speaking with the Geek team about {{campaign}} — your account is active again', 'submit your video link in the app', 'send your video to {{brand}} for review'),
  ('caption_fix', 'posting your {{campaign}} content', 'add the missing hashtags and mentions to your caption', 'update your post status in the app'),
  ('post_detected', 'posting your {{campaign}} content', 'share your quick feedback in the app', 'close the campaign and share your results'),
  ('feedback_request', 'completing your {{campaign}} post', 'share your quick feedback in the app', 'mark your campaign as complete'),
  ('completed', 'completing {{campaign}} ({{brand}})', 'check your campaign results in the app', 'invite you to new campaigns that match your profile'),
  ('campaign_started', 'joining {{campaign}} ({{brand}})', 'check your next step in My Campaigns', 'guide you through every step'),
  ('not_selected', 'applying for {{campaign}}', 'keep your profile updated in the app', 'invite you to the next campaign that matches your profile'),
  ('bulk_waiting', 'registering for {{campaign}} ({{brand}})', 'complete your profile in the app', 'open the campaign for you right away'),
  ('account_approved', 'registering on Geek OS — your account is approved', 'sign in and complete your profile', 'show you campaigns that match your profile'),
  ('account_declined', 'your interest in Geek OS', 'reply here if you have any questions', 'review your application again'),
  ('applied_received', 'running {{campaign}} on Geek OS — a new creator has applied', 'review the application in the app', 'notify the creator of your decision'),
  ('eligible_ready', 'running {{campaign}} on Geek OS — a creator is eligible', 'add the creator to the brand shortlist', 'share the shortlist with {{brand}}'),
  ('sent_to_brand', 'running {{campaign}} on Geek OS — the shortlist is ready', 'review the shortlist and confirm creators', 'send contracts to the selected creators'),
  ('brand_declined', 'running {{campaign}} on Geek OS — the brand did not confirm a creator', 'check the reason in the campaign', 'notify the creator'),
  ('address_confirmed', 'running {{campaign}} on Geek OS — a creator confirmed their address', 'add the courier and tracking details', 'share the tracking with the creator'),
  ('contract_signed_ops', 'running {{campaign}} on Geek OS — a creator signed the contract', 'arrange the product shipment', 'share the tracking with the creator'),
  ('content_for_review', 'running {{campaign}} on Geek OS — a creator video is ready', 'review the video and approve it or ask for changes', 'notify the creator right away'),
  ('published', 'running {{campaign}} on Geek OS — creator content is live', 'check the post in the campaign report', 'keep tracking the results'),
  ('block_alert_ops', 'running {{campaign}} on Geek OS — a creator missed the video deadline', 'call the creator and decide the next step', 'update the creator''s status')
on conflict (template_key) do update set did = excluded.did, next_step = excluded.next_step, then_we = excluded.then_we;

create or replace function intel.ci_notify(p_recipient uuid, p_campaign uuid, p_participation uuid, p_key text, p_vars jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare t intel.ci_notification_template%rowtype; v_title text; v_body text; v_route text; v_label text;
        v_kind text; v_nid uuid; v_email text; v_wa text; v_dedupe text; v_email_off boolean;
        v_first text; v_cname text; v_cbrand text; v_wa_payload jsonb; sc intel.ci_step_copy%rowtype;
        v_did text; v_next text; v_then text; v_mail text;
begin
  if p_recipient is null then return null; end if;
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
    elsif sc.template_key is not null then
      -- every step update goes on the UTILITY template geek_campaign_step:
      --   Hi {{1}}, Thank you for {{2}}. Next, please {{3}}. Once that is done, we will {{4}}. … {{5}} link
      v_wa_payload := jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', v_label,
        'to_name', v_first, 'force_template', true, 'wa_template', 'geek_campaign_step', 'wa_lang', 'en',
        'wa_vars', jsonb_build_array(v_first, v_did, v_next, v_then, 'LINK'));
    else
      v_wa_payload := jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', v_label,
        'wa_template', t.wa_template_name, 'wa_vars', jsonb_build_array(coalesce(p_vars->>'campaign','')));
    end if;
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
      values ('whatsapp', p_recipient, v_wa, p_campaign, p_participation, v_nid, p_key, v_wa_payload, v_nid::text)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return v_nid;
end $$;
revoke all on function intel.ci_notify(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function intel.ci_notify(uuid,uuid,uuid,text,jsonb) to service_role;

-- bulk-sheet invites: the email in the same words as the WhatsApp template
create or replace function intel.ci_send_bulk_invite(p_invite uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_name text; v_brand text; v_prod text; v_title text; v_body text; v_n int := 0; v_route text; v_first text;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or i.claimed_at is not null then return 0; end if;
  select c.name, coalesce(c.submitted_brand_name, b.name), c.product into v_name, v_brand, v_prod
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = i.campaign_id;
  v_first := coalesce(nullif(split_part(btrim(coalesce(i.full_name,'')), ' ', 1), ''), case when i.handle is not null then '@' || i.handle end, 'there');
  v_route := '/app.html?cinv=' || i.token::text;
  v_title := 'Approved for ' || coalesce(v_name,'the campaign');
  v_body := 'Thank you for applying for the campaign ' || coalesce(v_name,'') || '. Congratulations! Your profile has been approved by '
         || coalesce(v_brand,'the brand') || ' for the upcoming barter collaboration through Geek Creative Agency.'
         || ' Before we proceed with product dispatch: Step 1 - register on our app. Step 2 - go to My Campaigns and continue the entire process on the app.'
         || case when i.note is not null then ' Note from the brand: “' || i.note || '”' else '' end;
  if i.phone_e164 is not null and not exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null) then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('whatsapp', null, i.phone_e164, i.campaign_id, 'bulk_invite',
            jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', 'Register & join', 'to_name', v_first,
                               'wa_template', 'geek_campaign_access', 'wa_lang', 'en',
                               'wa_vars', jsonb_build_array(v_first, coalesce(v_name,'our campaign'), coalesce(v_brand,'the brand'), 'LINK')),
            'binv:' || i.invite_id || ':wa:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if i.email is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('email', null, i.email, i.campaign_id, 'bulk_invite',
            jsonb_build_object('subject', 'Approved for ' || coalesce(v_name,'the campaign') || ' — ' || coalesce(v_brand,'Geek'), 'html', 'Hello ' || v_first || E',\n\nThank you for applying for the campaign ' || coalesce(v_name,'our campaign')
                   || E'.\n\nCongratulations! Your profile has been approved by ' || coalesce(v_brand,'the brand')
                   || ' for the upcoming barter collaboration through Geek Creative Agency.'
                   || case when i.note is not null then ' Note from the brand: “' || i.note || '”' else '' end
                   || E'\n\nBefore we proceed with product dispatch, please follow these steps:\nStep 1 - Register on our app (button below).\nStep 2 - Go to My Campaigns and continue the entire process on the app.'
                   || E'\n\nIf there is any confusion, please reply to this email.', 'to_name', v_first, 'action_route', v_route, 'action_label', 'Register & join'),
            'binv:' || i.invite_id || ':em:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  update intel.ci_campaign_invite set invites_sent = invites_sent + 1, last_invited_at = now() where invite_id = p_invite;
  return v_n;
end $$;
revoke all on function intel.ci_send_bulk_invite(uuid) from public, anon, authenticated;


