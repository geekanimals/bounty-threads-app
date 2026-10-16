-- Bulk invites: WhatsApp variables in the order the approved template geek_campaign_access expects —
--   {{1}} creator name · {{2}} campaign name · {{3}} brand name · {{4}} app link
-- (the live database had brand and campaign the other way round). Plus: links never point at a
-- *.vercel.app host — the live domain wins. ADDITIVE.

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
            jsonb_build_object('subject', v_title || ' — ' || coalesce(v_brand,'Geek'), 'html', 'Hi ' || v_first || ', ' || v_body, 'action_route', v_route, 'action_label', 'Register & join'),
            'binv:' || i.invite_id || ':em:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  update intel.ci_campaign_invite set invites_sent = invites_sent + 1, last_invited_at = now() where invite_id = p_invite;
  return v_n;
end $$;
revoke all on function intel.ci_send_bulk_invite(uuid) from public, anon, authenticated;


-- a Vercel project / preview host must never become the domain in WhatsApp + email links
create or replace function public.admin_sync_app_url(p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := rtrim(btrim(coalesce(p_url,'')), '/');
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if v !~ '^https://[a-z0-9.-]+(:[0-9]+)?$' or v ~* '://(localhost|127\.|0\.0\.0\.0)' then
    raise exception 'app url must be the public https origin' using errcode = '22023'; end if;
  if v ~* '\.vercel\.app$' then return jsonb_build_object('app_url', (select app_url from public.wa_settings), 'ignored', v); end if;
  update public.wa_settings set app_url = v, app_url_at = now() where app_url is distinct from v;
  return jsonb_build_object('app_url', v);
end $$;
revoke all on function public.admin_sync_app_url(text) from public, anon;
grant execute on function public.admin_sync_app_url(text) to authenticated;
update public.wa_settings set app_url = 'https://www.bountythreads.geekcreativeagency.com', app_url_at = now()
 where app_url is null or app_url ~* '\.vercel\.app/?$';
