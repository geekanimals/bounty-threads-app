-- Meta put the one-size geek_campaign_step template in MARKETING (its text was almost all variables).
-- Now every step has its OWN fixed-text UTILITY template, so Meta sees exactly what the message is about:
--   geek_step_contract / _address / _shipped / _brief / _video_due / _video_overdue / _on_hold / _changes /
--   _approved / _caption / _feedback / _completed, and geek_team_update for agency / brand / Geek team updates.
-- Variables: {{1}} name · {{2}} campaign · {{3}} brand (team: what happened) · {{4}} app link.
-- The email is built from the very same text. Footer on WhatsApp: "Reply STOP to stop WhatsApp updates".
-- A message whose template is still waiting for Meta is held and retried (never sent on another template).

create table if not exists intel.ci_step_wa (
  template_key text primary key,
  wa_template  text not null,
  body         text not null,
  update_text  text
);
alter table intel.ci_step_wa enable row level security;
revoke all on intel.ci_step_wa from public, anon, authenticated;

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('brand_confirmed', 'geek_step_contract', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*.

Next, please read and sign your campaign contract on the app. Once that is done, we will ask you to confirm your delivery address.

Sign your contract here: {{4}}

Thank you!
Team Geek Animals', null),
('contract_sent', 'geek_step_contract', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*.

Next, please read and sign your campaign contract on the app. Once that is done, we will ask you to confirm your delivery address.

Sign your contract here: {{4}}

Thank you!
Team Geek Animals', null),
('confirm_address', 'geek_step_address', 'Hi *{{1}}*,

Thank you for signing the contract for the campaign *{{2}}* with *{{3}}*.

Next, please confirm your delivery address on the app. Once that is done, we will ship your product to this address.

Confirm your address here: {{4}}

Thank you!
Team Geek Animals', null),
('product_shipped', 'geek_step_shipped', 'Hi *{{1}}*,

Thank you for confirming your address for the campaign *{{2}}*. Your product from *{{3}}* has been shipped.

Next, please track your parcel and tap Received on the app when it arrives. Once that is done, we will unlock your video brief.

Track your parcel here: {{4}}

Thank you!
Team Geek Animals', null),
('parcel_received', 'geek_step_brief', 'Hi *{{1}}*,

Thank you for confirming that your product for the campaign *{{2}}* with *{{3}}* has arrived.

Next, please read the video brief and submit your video link on the app. Once that is done, we will send your video to the brand for review.

Open your video brief here: {{4}}

Thank you!
Team Geek Animals', null),
('video_due', 'geek_step_video_due', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. This is a reminder that your video for this campaign is due.

Next, please submit your video link on the app. Once that is done, we will send your video to the brand for review.

Submit your video here: {{4}}

Thank you!
Team Geek Animals', null),
('video_nudge', 'geek_step_video_due', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. This is a reminder that your video for this campaign is due.

Next, please submit your video link on the app. Once that is done, we will send your video to the brand for review.

Submit your video here: {{4}}

Thank you!
Team Geek Animals', null),
('video_unblocked', 'geek_step_video_due', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. This is a reminder that your video for this campaign is due.

Next, please submit your video link on the app. Once that is done, we will send your video to the brand for review.

Submit your video here: {{4}}

Thank you!
Team Geek Animals', null),
('video_warning', 'geek_step_video_overdue', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. Your video for this campaign is now overdue.

Next, please submit your video link on the app today. Once that is done, we will keep your campaign active.

Submit your video here: {{4}}

Thank you!
Team Geek Animals', null),
('video_final_warning', 'geek_step_video_overdue', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. Your video for this campaign is now overdue.

Next, please submit your video link on the app today. Once that is done, we will keep your campaign active.

Submit your video here: {{4}}

Thank you!
Team Geek Animals', null),
('video_blocked', 'geek_step_on_hold', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. Your campaign is on hold because your video was not received.

Next, please submit your video on the app or reply here to talk to the Geek team. Once that is done, we will review your campaign and make it active again.

Open your campaign here: {{4}}

Thank you!
Team Geek Animals', null),
('changes_requested', 'geek_step_changes', 'Hi *{{1}}*,

Thank you for submitting your video for the campaign *{{2}}*. *{{3}}* has asked for a few changes.

Next, please make the changes and submit your video again on the app. Once that is done, we will send it back to the brand for review.

See the changes here: {{4}}

Thank you!
Team Geek Animals', null),
('content_approved', 'geek_step_approved', 'Hi *{{1}}*,

Thank you for your video for the campaign *{{2}}*. *{{3}}* has approved it.

Next, please post it on Instagram from the app using Let''s post. Once that is done, we will track your post for this campaign.

Post your video here: {{4}}

Thank you!
Team Geek Animals', null),
('caption_fix', 'geek_step_caption', 'Hi *{{1}}*,

Thank you for posting your content for the campaign *{{2}}* with *{{3}}*.

Next, please add the missing hashtags and mentions to your caption. Once that is done, we will update your post status on the app.

See the details here: {{4}}

Thank you!
Team Geek Animals', null),
('post_detected', 'geek_step_feedback', 'Hi *{{1}}*,

Thank you for posting your content for the campaign *{{2}}* with *{{3}}*.

Next, please share your quick feedback on the app. Once that is done, we will mark this campaign as complete.

Share your feedback here: {{4}}

Thank you!
Team Geek Animals', null),
('feedback_request', 'geek_step_feedback', 'Hi *{{1}}*,

Thank you for posting your content for the campaign *{{2}}* with *{{3}}*.

Next, please share your quick feedback on the app. Once that is done, we will mark this campaign as complete.

Share your feedback here: {{4}}

Thank you!
Team Geek Animals', null),
('completed', 'geek_step_completed', 'Hi *{{1}}*,

Thank you for completing the campaign *{{2}}* with *{{3}}*.

Next, please check your campaign results on the app. Once that is done, we will close this campaign in your account.

See your results here: {{4}}

Thank you!
Team Geek Animals', null),
('applied_received', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'a new creator has applied'),
('eligible_ready', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'a creator is eligible for the brand shortlist'),
('sent_to_brand', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'the creator shortlist is ready for review'),
('brand_declined', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'the brand did not confirm a creator'),
('contract_signed_ops', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'a creator signed the contract'),
('address_confirmed', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'a creator confirmed their delivery address'),
('block_alert_ops', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'a creator missed the video deadline'),
('content_for_review', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'a creator video is ready for review'),
('published', 'geek_team_update', 'Hi *{{1}}*,

Thank you for running the campaign *{{2}}* on Geek OS. There is a new update on this campaign: {{3}}.

Next, please open the campaign on the app and complete the pending action. Once that is done, we will update the campaign status.

Open the campaign here: {{4}}

Thank you!
Team Geek Animals', 'creator content is now live')
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body, update_text = excluded.update_text;

create or replace function intel.ci_notify(p_recipient uuid, p_campaign uuid, p_participation uuid, p_key text, p_vars jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare t intel.ci_notification_template%rowtype; v_title text; v_body text; v_route text; v_label text;
        v_kind text; v_nid uuid; v_email text; v_wa text; v_dedupe text; v_email_off boolean;
        v_first text; v_cname text; v_cbrand text; v_wa_payload jsonb; sc intel.ci_step_copy%rowtype;
        v_did text; v_next text; v_then text; v_mail text; sw intel.ci_step_wa%rowtype; v_v3 text;
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

create or replace function api.wa_invite_ready()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'whatsapp', true,
    'template', 'geek_campaign_access',
    'invite_template', 'geek_campaign_access',
    'update_template', 'geek_step_*',
    'backup_template', coalesce((select nullif(btrim(update_template),'') from public.wa_settings), 'geek_campaign_update'),
    'is_admin', public.is_platform_admin()) $$;
