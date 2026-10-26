-- QA fixes for the Paid / Barter + Paid flows. ADDITIVE (same signatures).
-- 1) The in-app message also uses the campaign type's own wording (contract_signed_ops@paid: no address / courier).
-- 2) The Super Admin alert when a creator signs a Paid contract no longer says "they will confirm their address".
-- 3) api.messaging_status: bulk upload / invite screens show whether WhatsApp / email are ON (Settings + this campaign).
-- 4) Contract wording: "For those 1 month" -> "During that time".
-- 5) The 9 new step templates created in snapto go back to "submitted" (waiting for Meta); the sync keeps them there.

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
  -- the campaign type picks its own in-app wording too (e.g. contract_signed_ops@paid: nothing to ship)
  v_ctype := case when p_campaign is not null then intel.ci_campaign_flow(p_campaign)->>'kind' end;
  select * into t from intel.ci_notification_template
   where template_key in (p_key, p_key || '@' || coalesce(v_ctype, '-')) and active
   order by (template_key = p_key) limit 1;
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

insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label, active)
select 'contract_signed_ops@paid', t.kind, 'Contract signed — {{campaign}}',
       'A creator signed their contract. Their video brief went out automatically (nothing to ship) — next: their bank / UPI details and the video.',
       t.action_route, t.action_label, true
  from intel.ci_notification_template t where t.template_key = 'contract_signed_ops'
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md;

insert into intel.ci_step_wa(template_key, wa_template, body, update_text)
select 'contract_signed_ops@paid', w.wa_template, w.body, 'a creator signed the contract and got the video brief (nothing to ship)'
  from intel.ci_step_wa w where w.template_key = 'contract_signed_ops'
on conflict (template_key) do update set update_text = excluded.update_text;

insert into intel.ci_step_copy(template_key, did, next_step, then_we)
values ('contract_signed_ops@paid', 'running {{campaign}} on Geek OS — a creator signed the contract', 'check their bank / UPI details', 'review their video when it comes in')
on conflict (template_key) do update set did = excluded.did, next_step = excluded.next_step, then_we = excluded.then_we;

-- 3) is WhatsApp / email ON? (Settings, and this campaign's own switch)
create or replace function api.messaging_status(p_campaign uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (select case when p_campaign is null then null else intel.ci_resolve_campaign(p_campaign) end id)
  select jsonb_build_object(
    'wa_global', coalesce((select s.wa_on from public.messaging_switches s limit 1), true),
    'email_global', coalesce((select s.email_on from public.messaging_switches s limit 1), true),
    'wa_campaign', coalesce((select m.wa_on from intel.ci_campaign_messaging m, c where m.campaign_id = c.id), true),
    'email_campaign', coalesce((select m.email_on from intel.ci_campaign_messaging m, c where m.campaign_id = c.id), true)) $$;
revoke all on function api.messaging_status(uuid) from public, anon;
grant execute on function api.messaging_status(uuid) to authenticated, service_role;

-- 4) contract wording
do $do$ declare src text; v_old text := $x$For those '||n||' month'||case when n>1 then 's' else '' end$x$; begin
  select pg_get_functiondef('intel.ci_contract_clauses(jsonb,text)'::regprocedure) into src;
  if position(v_old in src) > 0 then
    src := replace(src, v_old, $x$During that time'||'$x$ || $x$'$x$);
    execute src;
  end if;
end $do$;

-- 5) the step templates already created in snapto: waiting for Meta, not "create by hand"
update private.ci_step_wa_status set status = 'submitted', error = 'created in snapto — waiting for Meta review', updated_at = now()
 where wa_template in ('geek_step_contract_paid','geek_step_contract_bp','geek_step_brief_paid','geek_step_payment_details',
                       'geek_step_payment_fix','geek_step_payment_verified','geek_step_payment_scheduled','geek_step_payment_paid',
                       'geek_step_completed_paid')
   and status in ('manual','draft');
