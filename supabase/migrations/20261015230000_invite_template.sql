-- Bulk invites go out on their own approved WhatsApp template, geek_campaign_invite:
--   {{1}} first name · {{2}} brand · {{3}} campaign · {{4}} registration link
-- If that template isn't approved yet, the dispatcher falls back to geek_campaign_update automatically. ADDITIVE.
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
  v_title := 'Invitation: ' || coalesce(v_name,'a campaign');
  v_body := coalesce(v_brand,'A brand') || ' would like to collaborate with you on ' || coalesce(v_name,'their campaign')
         || case when v_prod is not null then ' (you receive: ' || v_prod || ')' else '' end
         || case when i.approved then '. You are already approved.' else '.' end
         || ' Register on Geek OS with your WhatsApp number to view the brief and join.'
         || case when i.note is not null then ' Note from the brand: “' || i.note || '”' else '' end;
  if i.phone_e164 is not null and not exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null) then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('whatsapp', null, i.phone_e164, i.campaign_id, 'bulk_invite',
            jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', 'Register & join', 'to_name', v_first,
                               'wa_template', 'geek_campaign_invite', 'wa_lang', 'en',
                               'wa_vars', jsonb_build_array(v_first, coalesce(v_brand,'A brand'), coalesce(v_name,'a campaign'), 'LINK')),
            'binv:' || i.invite_id || ':wa:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if i.email is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('email', null, i.email, i.campaign_id, 'bulk_invite',
            jsonb_build_object('subject', v_title || ' — ' || coalesce(v_brand,'Geek'), 'html', 'Hi ' || v_first || ', ' || v_body, 'action_route', v_route, 'action_label', 'Register & join'),
            'binv:' || i.invite_id || ':em:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  update intel.ci_campaign_invite set invites_sent = invites_sent + 1, last_invited_at = now() where invite_id = p_invite;
  return v_n;
end $$;
revoke all on function intel.ci_send_bulk_invite(uuid) from public, anon, authenticated;
