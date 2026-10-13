-- Alerts reach every creator on email too: WhatsApp-login creators have an internal login address, so the email
-- copy now goes to their verified official email or the backup email from their profile. Same function as
-- 20261012090000 otherwise (one notification row → one email + one WhatsApp, deep-link route kept).
create or replace function intel.ci_notify(p_recipient uuid, p_campaign uuid, p_participation uuid, p_key text, p_vars jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare t intel.ci_notification_template%rowtype; v_title text; v_body text; v_route text; v_label text;
        v_kind text; v_nid uuid; v_email text; v_wa text; v_dedupe text;
begin
  if p_recipient is null then return null; end if;
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;   -- dark gate
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

  -- email: real login email → verified official email → profile backup email (never the internal WhatsApp address)
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

  select phone_e164 into v_wa from public.wa_contacts where user_id=p_recipient and verified_at is not null and opt_out_at is null;
  if v_wa is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
      values ('whatsapp', p_recipient, v_wa, p_campaign, p_participation, v_nid, p_key,
        jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', v_label,
                           'wa_template', t.wa_template_name, 'wa_vars', jsonb_build_array(coalesce(p_vars->>'campaign',''))), v_nid::text)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return v_nid;
end $$;
revoke all on function intel.ci_notify(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function intel.ci_notify(uuid,uuid,uuid,text,jsonb) to service_role;

-- creator notification links point at the new creator pages
update intel.ci_notification_template set action_route = 'mycampaigns' where action_route in ('alerts','onboarding_campaigns');
update intel.ci_notification_template set action_route = 'profile' where action_route = 'onboarding';
