-- Campaign creator list: tick creators → send ONE WhatsApp to all of them, by hand (a template or a typed message).
-- 1) the new UTILITY template "geek_selected_connect_instagram" (Hi name · form for campaign · you are selected · connect Instagram · link
--    · guide video). Never sent automatically — only when a team member presses Send on the list.
--    (The first wordings — geek_ig_connect / geek_instagram_login, "log in with your Instagram here" + youtu.be — were
--    rejected by Meta on the spot; this one follows the approved Utility style.)
-- 2) api.campaign_wa_targets: for the ticked rows, each creator's WhatsApp number, first name and own app link
--    (the invite's join link for sheet creators, the app for creators already on the campaign). ADDITIVE.

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('manual_ig_connect', 'geek_selected_connect_instagram', 'Hi *{{1}}*,

Thank you for filling the form for the campaign *{{2}}*. This is an update on your application: you are selected.

Next, please open the app and connect your Instagram account to continue. Once that is done, we will update your campaign status.

Continue here: {{3}}

Need help connecting? Watch this short guide: https://www.youtube.com/watch?v=PYpBru7LUvc

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body;

insert into private.ci_step_wa_status(wa_template, status, error)
values ('geek_selected_connect_instagram', 'submitted', 'created in snapto (Utility) on 31 Oct 2026 — waiting for Meta review')
on conflict (wa_template) do nothing;

create or replace function api.campaign_wa_targets(p_campaign uuid, p_invites uuid[] default '{}', p_parts uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_name text; v_brand text; v_url text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);   -- the app's campaign id → the campaign the creators sit on
  if p_campaign is null or not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select c.name, coalesce(c.submitted_brand_name, b.name) into v_name, v_brand
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = p_campaign;
  -- links always on the live domain (never a *.vercel.app host the team happens to be on)
  begin select (api.ops_wa_settings())->>'app_url' into v_url; exception when others then v_url := null; end;
  return jsonb_build_object('campaign', v_name, 'brand', v_brand, 'app_url', rtrim(coalesce(v_url, ''), '/'), 'tpl_status',
      (select s.status from private.ci_step_wa_status s where s.wa_template = 'geek_selected_connect_instagram'),
    'targets', coalesce((select jsonb_agg(t) from (
      select jsonb_build_object('key', 'i:' || i.invite_id, 'phone', i.phone_e164,
               'name', coalesce(nullif(split_part(btrim(coalesce(i.full_name,'')), ' ', 1), ''), case when i.handle is not null then '@' || i.handle end, 'there'),
               'who', coalesce('@' || i.handle, i.full_name, i.phone_e164),
               'route', case when i.claimed_at is null then '/app.html?cinv=' || i.token::text else '/app.html' end,
               'opted_out', exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null)) t
        from intel.ci_campaign_invite i where i.campaign_id = p_campaign and i.invite_id = any(coalesce(p_invites, '{}'))
      union all
      select jsonb_build_object('key', 'p:' || p.participation_id, 'phone', ph.phone,
               'name', coalesce(nullif(split_part(btrim(coalesce(m.name,'')), ' ', 1), ''), case when p.applied_profile is not null then '@' || p.applied_profile end, 'there'),
               'who', coalesce('@' || nullif(p.applied_profile,''), m.name, ph.phone),
               'route', '/app.html',
               'opted_out', exists (select 1 from public.wa_contacts w where w.phone_e164 = ph.phone and w.opt_out_at is not null))
        from intel.ci_campaign_participation p
        left join lateral (select intel.ci_member_of_identity(p.identity_id) as mid) mm on true
        left join public.members m on m.id = mm.mid
        left join lateral (select coalesce(intel.ci_member_phone(mm.mid),
                     (select i2.phone_e164 from intel.ci_campaign_invite i2 where i2.participation_id = p.participation_id and i2.phone_e164 is not null limit 1)) as phone) ph on true
       where p.campaign_id = p_campaign and p.participation_id = any(coalesce(p_parts, '{}'))) x), '[]'::jsonb));
end $$;
revoke all on function api.campaign_wa_targets(uuid, uuid[], uuid[]) from public, anon;
grant execute on function api.campaign_wa_targets(uuid, uuid[], uuid[]) to authenticated;

-- 3) the WhatsApp templates the team can pick on the list (every step template + its status), and the targets' brand + live app URL
create or replace function api.wa_template_choices()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', x.wa_template, 'status', x.status, 'keys', x.keys, 'body', x.body) order by x.wa_template)
    from (select w.wa_template, coalesce(s.status, 'approved') status, array_agg(distinct w.template_key) keys, min(w.body) body
            from intel.ci_step_wa w left join private.ci_step_wa_status s on s.wa_template = w.wa_template
           where w.wa_template <> 'geek_team_update'
           group by w.wa_template, s.status) x), '[]'::jsonb);
end $$;
revoke all on function api.wa_template_choices() from public, anon;
grant execute on function api.wa_template_choices() to authenticated;
