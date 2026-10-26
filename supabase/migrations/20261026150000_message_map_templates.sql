-- Every message, every step, every campaign type — and the WhatsApp templates for the new ones. ADDITIVE.
-- * The campaign type picks its own wording: a step key can have a variant "<key>@paid" / "<key>@barter_paid"
--   (e.g. the contract message on a Paid campaign does not say "then confirm your address").
-- * New UTILITY step templates for the paid flow + every payment message (fixed text, {{1}} name · {{2}} campaign ·
--   {{3}} brand · {{4}} app link, footer "Reply STOP to stop WhatsApp updates"). They start as DRAFT: nothing goes to
--   Meta until a Super Admin presses "Submit to Meta". A draft / never-created / refused template doesn't hold its
--   message: it goes on the general update template (as today); one in review holds it until approved; in-app + email always go straight away (the email is word-for-word the WhatsApp text).
-- * api.campaign_message_map(campaign): for a Super Admin, every phase of that campaign's flow with the WhatsApp
--   template (name, status, text), the email (subject + text) and the in-app message.

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
  ('contract_sent@paid', 'geek_step_contract_paid', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*.

Next, please read and sign your campaign contract on the app. It sets out your deliverables and payment terms. Once that is done, we will send you the video brief.

Sign your contract here: {{4}}

Thank you!
Team Geek Animals', null),
  ('brand_confirmed@paid', 'geek_step_contract_paid', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*.

Next, please read and sign your campaign contract on the app. It sets out your deliverables and payment terms. Once that is done, we will send you the video brief.

Sign your contract here: {{4}}

Thank you!
Team Geek Animals', null),
  ('contract_sent@barter_paid', 'geek_step_contract_bp', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*.

Next, please read and sign your campaign contract on the app. It sets out your product, deliverables and payment terms. Once that is done, we will ask you to confirm your delivery address.

Sign your contract here: {{4}}

Thank you!
Team Geek Animals', null),
  ('brand_confirmed@barter_paid', 'geek_step_contract_bp', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*.

Next, please read and sign your campaign contract on the app. It sets out your product, deliverables and payment terms. Once that is done, we will ask you to confirm your delivery address.

Sign your contract here: {{4}}

Thank you!
Team Geek Animals', null),
  ('paid_brief_ready', 'geek_step_brief_paid', 'Hi *{{1}}*,

Thank you for signing the contract for the campaign *{{2}}* with *{{3}}*.

Next, please read the video brief and submit your video link on the app. Once that is done, we will share it with the brand for approval.

Read your video brief here: {{4}}

Thank you!
Team Geek Animals', null),
  ('payment_details_needed', 'geek_step_payment_details', 'Hi *{{1}}*,

Thank you for working on the campaign *{{2}}* with *{{3}}*.

Next, please add your bank account or UPI ID in your own name on the app. Once that is done, we will verify it so your payment can be made as per your contract.

Add your payment details here: {{4}}

Thank you!
Team Geek Animals', null),
  ('payment_details_fix', 'geek_step_payment_fix', 'Hi *{{1}}*,

Thank you for adding your payment details for the campaign *{{2}}* with *{{3}}*. We could not verify them.

Next, please check and update your bank account or UPI ID on the app. Once that is done, we will verify them again.

Update your payment details here: {{4}}

Thank you!
Team Geek Animals', null),
  ('payment_verified', 'geek_step_payment_verified', 'Hi *{{1}}*,

Thank you for adding your payment details for the campaign *{{2}}* with *{{3}}*. They are now verified.

Next, please continue with your campaign steps on the app. Once that is done, we will make your payment as per your contract.

View your campaign here: {{4}}

Thank you!
Team Geek Animals', null),
  ('payment_scheduled', 'geek_step_payment_scheduled', 'Hi *{{1}}*,

Thank you for completing your posts for the campaign *{{2}}* with *{{3}}*. Your payment is now scheduled.

Next, please check the payment date and amount on the app. Once the transfer is done, we will share the transaction reference with you.

View your payment here: {{4}}

Thank you!
Team Geek Animals', null),
  ('payment_paid', 'geek_step_payment_paid', 'Hi *{{1}}*,

Thank you for working on the campaign *{{2}}* with *{{3}}*. Your payment has been sent to your verified account.

Next, please check the amount and transaction reference on the app. If anything does not match, reply to this message and our team will help you.

View your payment here: {{4}}

Thank you!
Team Geek Animals', null),
  ('completed@paid', 'geek_step_completed_paid', 'Hi *{{1}}*,

Thank you for completing the campaign *{{2}}* with *{{3}}*.

Next, please check your campaign results and payment status on the app. Once your payment is made, we will share the transaction reference with you.

View your campaign here: {{4}}

Thank you!
Team Geek Animals', null),
  ('completed@barter_paid', 'geek_step_completed_paid', 'Hi *{{1}}*,

Thank you for completing the campaign *{{2}}* with *{{3}}*.

Next, please check your campaign results and payment status on the app. Once your payment is made, we will share the transaction reference with you.

View your campaign here: {{4}}

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body, update_text = excluded.update_text;

insert into private.ci_step_wa_status(wa_template, status) values
  ('geek_step_contract_paid', 'draft'),
  ('geek_step_contract_bp', 'draft'),
  ('geek_step_brief_paid', 'draft'),
  ('geek_step_payment_details', 'draft'),
  ('geek_step_payment_fix', 'draft'),
  ('geek_step_payment_verified', 'draft'),
  ('geek_step_payment_scheduled', 'draft'),
  ('geek_step_payment_paid', 'draft'),
  ('geek_step_completed_paid', 'draft')
on conflict (wa_template) do nothing;

-- the step templates list (WhatsApp & email page) also returns drafts; Submit to Meta = queued
create or replace function public.admin_step_template_mark(p_name text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  if p_status not in ('approved','queued') then raise exception 'status must be approved or queued' using errcode = '22023'; end if;
  update private.ci_step_wa_status set status = p_status, error = null, updated_at = now() where wa_template = p_name;
  if not found then raise exception 'unknown template %', p_name using errcode = '22023'; end if;
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', case when p_status = 'queued' then 'wa_template_submitted' else 'wa_template_marked_approved' end, jsonb_build_object('template', p_name));
  if p_status = 'queued' then begin perform private.ci_kick_worker('wa-template-sync'); exception when others then null; end; end if;
end $$;
revoke all on function public.admin_step_template_mark(text, text) from public, anon;
grant execute on function public.admin_step_template_mark(text, text) to authenticated;

-- ci_notify: the type's own wording first; a draft template never holds a WhatsApp message
create or replace function intel.ci_notify(p_recipient uuid, p_campaign uuid, p_participation uuid, p_key text, p_vars jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare t intel.ci_notification_template%rowtype; v_title text; v_body text; v_route text; v_label text;
        v_kind text; v_nid uuid; v_email text; v_wa text; v_dedupe text; v_email_off boolean;
        v_first text; v_cname text; v_cbrand text; v_wa_payload jsonb; sc intel.ci_step_copy%rowtype;
        v_did text; v_next text; v_then text; v_mail text; sw intel.ci_step_wa%rowtype; v_v3 text; v_ctype text; v_sw_live boolean := false;
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
  -- the campaign type picks its own wording when there is one (e.g. contract_sent@paid: no address step)
  v_ctype := case when p_campaign is not null then intel.ci_campaign_flow(p_campaign)->>'kind' end;
  select * into sc from intel.ci_step_copy where template_key in (p_key, p_key || '@' || coalesce(v_ctype, '-'))
   order by (template_key = p_key) limit 1;
  if sc.template_key is not null then
    v_did := intel.ci_render(sc.did, p_vars); v_next := intel.ci_render(sc.next_step, p_vars); v_then := intel.ci_render(sc.then_we, p_vars);
    -- the email says exactly what the WhatsApp template says
    v_mail := 'Hi ' || v_first || E',\n\nThank you for ' || v_did || E'.\n\nNext, please ' || v_next || '. Once that is done, we will ' || v_then
              || E'.\n\nClick the button below to continue on the app.';
  end if;
  select * into sw from intel.ci_step_wa where template_key in (p_key, p_key || '@' || coalesce(v_ctype, '-'))
   order by (template_key = p_key) limit 1;
  -- a template that isn't with Meta (draft / never created / refused) isn't used on WhatsApp — the general update template
  -- carries the message meanwhile; one in review (queued / submitted) holds it until Meta approves (minutes)
  v_sw_live := sw.template_key is not null
    and coalesce((select s.status from private.ci_step_wa_status s where s.wa_template = sw.wa_template), 'approved') not in ('draft','manual','failed','rejected');
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
    elsif v_sw_live then
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
    elsif sc.template_key is not null and sw.template_key is null then
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


-- ============================================================================================================
-- every phase of one campaign: WhatsApp template · email · in-app (Super Admin)
-- ============================================================================================================
create or replace function api.campaign_message_map(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_kind text; v_name text; v_brand text; v_vars jsonb; v_out jsonb := '[]'::jsonb; ph record; sw intel.ci_step_wa%rowtype;
        sc intel.ci_step_copy%rowtype; t intel.ci_notification_template%rowtype; v_status text; v_wa jsonb; v_mail text; v_subj text;
        v_camp_tpl record; v_link text := 'https://bounty-threads-app.vercel.app/app.html';
begin
  perform intel.ci_assert_super_admin('see the campaign messages');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found' using errcode = '22023'; end if;
  v_kind := intel.ci_campaign_flow(p_campaign)->>'kind';
  select c.name, coalesce(c.submitted_brand_name, b.name) into v_name, v_brand
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = p_campaign;
  v_vars := jsonb_build_object('campaign', coalesce(v_name, 'the campaign'), 'brand', coalesce(v_brand, 'the brand'), 'days', '7',
    'amount', '₹10,000', 'date', to_char(current_date + 5, 'DD Mon YYYY'), 'reason', 'the account name does not match your name',
    'part', 'advance', 'method', 'UPI ID name@okhdfcbank', 'ref', 'UTR 425123456789', 'left', 'your remaining posts', 'done', '1', 'need', '2', 'note_line', '');
  select wt.template_name, wt.status into v_camp_tpl from public.wa_campaign_templates wt
    join intel.ci_campaign c on c.legacy_campaign_id = wt.campaign_id where c.campaign_id = p_campaign;

  for ph in select * from (values
      (10, 'Approved — invite to the campaign', 'invited', 'all'),
      (20, 'Contract sent — sign it', 'contract_sent', 'all'),
      (30, 'Contract signed — confirm the delivery address', 'confirm_address', 'ship'),
      (31, 'Contract signed — video brief (nothing to ship)', 'paid_brief_ready', 'paid_only'),
      (32, 'Contract signed — add bank / UPI details', 'payment_details_needed', 'fee'),
      (40, 'Address confirmed — video brief to practise', 'brief_preview', 'ship'),
      (50, 'Courier sent — track the parcel', 'product_shipped', 'ship'),
      (60, 'Courier delivered — video brief, deadline starts', 'parcel_received', 'ship'),
      (61, 'Payment details verified', 'payment_verified', 'fee'),
      (62, 'Payment details not verified / asked again', 'payment_details_fix', 'fee'),
      (70, 'Video due — reminder', 'video_due', 'all'),
      (71, 'Deadline reminder (last days)', 'deadline_reminder', 'all'),
      (72, 'Video overdue — warning', 'video_warning', 'all'),
      (73, 'Video overdue — final warning', 'video_final_warning', 'all'),
      (74, 'No video — account on hold', 'video_blocked', 'all'),
      (80, 'Brand asked for changes', 'changes_requested', 'all'),
      (90, 'Video approved — post it', 'content_approved', 'all'),
      (91, 'Caption missing hashtags / mentions', 'caption_fix', 'all'),
      (92, 'Some posts still to go', 'posts_pending', 'all'),
      (93, 'A post was taken down — restore it', 'post_restore', 'all'),
      (100, 'Campaign complete', 'completed', 'all'),
      (101, 'Payment scheduled', 'payment_scheduled', 'fee'),
      (102, 'Payment sent (with UTR / screenshot)', 'payment_paid', 'fee'),
      (110, 'Feedback request', 'feedback_request', 'all')) x(ord, phase, key, scope)
    where scope = 'all' or (scope = 'ship' and v_kind <> 'paid') or (scope = 'paid_only' and v_kind = 'paid') or (scope = 'fee' and v_kind <> 'barter')
    order by ord loop
    sw := null; sc := null; t := null; v_status := null; v_mail := null;
    select * into t from intel.ci_notification_template where template_key = ph.key;
    select * into sw from intel.ci_step_wa where template_key in (ph.key, ph.key || '@' || v_kind) order by (template_key = ph.key) limit 1;
    select * into sc from intel.ci_step_copy where template_key in (ph.key, ph.key || '@' || v_kind) order by (template_key = ph.key) limit 1;
    if sw.template_key is not null then
      select s.status into v_status from private.ci_step_wa_status s where s.wa_template = sw.wa_template;
    end if;
    -- WhatsApp
    if ph.key = 'invited' then
      v_wa := jsonb_build_object('template', 'geek_campaign_access', 'status', 'approved', 'live', true,
        'text', 'Approved invite template at Meta — {{1}} creator name · {{2}} campaign · {{3}} brand · {{4}} app link (the same for every campaign type).');
    elsif sw.template_key is not null then
      v_wa := jsonb_build_object('template', sw.wa_template, 'status', coalesce(v_status, 'approved'), 'live', coalesce(v_status, 'approved') = 'approved',
        'variant', sw.template_key <> ph.key,
        'text', replace(replace(replace(replace(sw.body, '{{1}}', 'Asha'), '{{2}}', coalesce(v_name, 'the campaign')),
                  '{{3}}', coalesce(sw.update_text, v_brand, 'the brand')), '{{4}}', v_link),
        'fallback', case when coalesce(v_status, 'approved') in ('draft','manual','failed','rejected') then coalesce(v_camp_tpl.template_name, 'the general update template') end,
        'held', coalesce(v_status, 'approved') in ('queued','submitted'));
    elsif sc.template_key is not null then
      v_wa := jsonb_build_object('template', null, 'status', 'none', 'live', false, 'text', 'No WhatsApp for this step — app + email only.');
    else
      v_wa := jsonb_build_object('template', coalesce(v_camp_tpl.template_name, 'general update template'), 'status', coalesce(v_camp_tpl.status, 'approved'),
        'live', true, 'general', true,
        'text', 'Hi Asha, here is an update on your ' || coalesce(v_name, 'campaign') || ' campaign: ' || coalesce(intel.ci_render(t.title, v_vars), ph.key)
                || chr(10) || chr(10) || 'Open the app to see details and next steps: ' || v_link || ' — thank you!');
    end if;
    -- email (same words as the WhatsApp step template when there is one)
    v_subj := coalesce(intel.ci_render(t.title, v_vars), ph.phase);
    if sw.template_key is not null then
      v_mail := replace(replace(replace(replace(regexp_replace(sw.body, E'\n\n[^\n]*\\{\\{4\\}\\}', E'\n\n[ Button: Open the app ]'), '*', ''),
                  '{{1}}', 'Asha'), '{{2}}', coalesce(v_name, 'the campaign')), '{{3}}', coalesce(sw.update_text, v_brand, 'the brand'));
      v_mail := replace(v_mail, E'\n\nThank you!\nTeam Geek Animals', '');
    elsif sc.template_key is not null then
      v_mail := 'Hi Asha,' || E'\n\n' || 'Thank you for ' || intel.ci_render(sc.did, v_vars) || '.' || E'\n\n' || 'Next, please ' || intel.ci_render(sc.next_step, v_vars)
                || '. Once that is done, we will ' || intel.ci_render(sc.then_we, v_vars) || '.' || E'\n\n[ Button: Open the app ]';
    elsif ph.key = 'invited' then
      v_mail := 'Hello Asha,' || E'\n\n' || 'Thank you for applying for the campaign ' || coalesce(v_name, 'our campaign') || '.' || E'\n\n'
                || 'Congratulations! Your profile has been approved by ' || coalesce(v_brand, 'the brand') || ' for the upcoming collaboration through Geek Creative Agency.'
                || E'\n\n' || 'Step 1 - Register on our app (button below). Step 2 - Go to My Campaigns and continue the entire process on the app.' || E'\n\n[ Button: Open the app ]';
      v_subj := 'Approved for ' || coalesce(v_name, 'a campaign') || ' 🎉';
    else
      v_mail := coalesce(intel.ci_render(t.body_md, v_vars), '') || E'\n\n[ Button: ' || coalesce(t.action_label, 'Open the app') || ' ]';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('phase', ph.phase, 'key', ph.key, 'whatsapp', v_wa,
      'email', jsonb_build_object('subject', v_subj, 'text', v_mail),
      'app', jsonb_build_object('title', intel.ci_render(t.title, v_vars), 'text', intel.ci_render(t.body_md, v_vars), 'button', t.action_label),
      'exists', t.template_key is not null));
  end loop;
  return jsonb_build_object('kind', v_kind, 'campaign', v_name, 'brand', v_brand,
    'switches', jsonb_build_object(
      'wa_global', coalesce((select wa_on from public.messaging_switches), true), 'email_global', coalesce((select email_on from public.messaging_switches), true),
      'wa', coalesce((select wa_on from intel.ci_campaign_messaging where campaign_id = p_campaign), true),
      'email', coalesce((select email_on from intel.ci_campaign_messaging where campaign_id = p_campaign), true)),
    'phases', v_out);
end $$;
revoke all on function api.campaign_message_map(uuid) from public, anon;
grant execute on function api.campaign_message_map(uuid) to authenticated;
