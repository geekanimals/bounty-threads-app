-- Every campaign invite goes out on the approved UTILITY WhatsApp template geek_campaign_access —
-- not only bulk-sheet invites, but also "🎯 Invite creators" (registered creators) and Instagram-handle invites
-- claimed at signup (notification keys 'invited' / 'bulk_invited'):
--   {{1}} creator first name · {{2}} campaign · {{3}} brand · {{4}} app link (My Campaigns)
-- force_template: the approved format goes even when the creator's 24h WhatsApp window is open.
-- If Meta refuses it, the dispatcher falls back to the update template automatically. ADDITIVE.

create or replace function intel.ci_notify(p_recipient uuid, p_campaign uuid, p_participation uuid, p_key text, p_vars jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare t intel.ci_notification_template%rowtype; v_title text; v_body text; v_route text; v_label text;
        v_kind text; v_nid uuid; v_email text; v_wa text; v_dedupe text; v_email_off boolean;
        v_first text; v_cname text; v_cbrand text; v_wa_payload jsonb;
begin
  if p_recipient is null then return null; end if;
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;
  if p_key in ('invited', 'bulk_invited') and coalesce(p_vars->>'brand', '') = '' then
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
          jsonb_build_object('subject',v_title,'html',v_body,'action_route',v_route,'action_label',v_label), v_nid::text)
        on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;

  v_wa := intel.ci_wa_number(p_recipient);
  if v_wa is not null then
    if p_key in ('invited', 'bulk_invited') then
      -- every campaign invite (Super Admin / agency / brand, bulk or one-by-one) goes on the approved
      -- UTILITY template geek_campaign_access: {{1}} creator name · {{2}} campaign · {{3}} brand · {{4}} app link
      select coalesce(nullif(split_part(btrim(coalesce(m.name, '')), ' ', 1), ''), 'there') into v_first
        from public.members m where m.id = p_recipient;
      select c.name, coalesce(c.submitted_brand_name, b.name) into v_cname, v_cbrand
        from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = p_campaign;
      v_wa_payload := jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', v_label,
        'to_name', coalesce(v_first, 'there'), 'force_template', true,
        'wa_template', 'geek_campaign_access', 'wa_lang', 'en',
        'wa_vars', jsonb_build_array(coalesce(v_first, 'there'), coalesce(v_cname, p_vars->>'campaign', 'our campaign'),
                                     coalesce(v_cbrand, p_vars->>'brand', 'the brand'), 'LINK'));
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

-- the in-app / email copy of an invite says the same as the WhatsApp template
update intel.ci_notification_template set
  title = 'Approved for {{campaign}} 🎉',
  body_md = 'Thank you for applying for the campaign **{{campaign}}**. Congratulations! Your profile has been approved by {{brand}} for the upcoming barter collaboration through Geek Creative Agency.{{note_line}} Before we proceed with product dispatch: Step 1 — register on our app (if you haven''t). Step 2 — go to My Campaigns and continue the entire process on the app.',
  action_route = 'mycampaigns', action_label = 'Open My Campaigns'
 where template_key = 'invited';
