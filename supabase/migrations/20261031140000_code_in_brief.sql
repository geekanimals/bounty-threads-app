-- 🎟️ Code in the video brief: a campaign can make every creator SAY their own coupon code in the video.
--   campaign setting: public.campaigns.tracking.say_code = true (Edit campaign → Link & coupon tracking)
--   • the creator's brief shows their own code (and {code} written anywhere in the brief becomes their code)
--   • the brief step message (parcel received / paid brief ready) goes on the new UTILITY template
--     geek_step_brief_code: {{1}} name · {{2}} campaign · {{3}} brand · {{4}} their code · {{5}} app link
--     (until Meta approves it the usual brief template goes; the email + app always carry the code)
--   • the WhatsApp panel on the campaign list can send it too, and every target comes with its code
-- ADDITIVE.

-- 1) the creator's code for the brief — only when the campaign says so (null otherwise / no code yet)
create or replace function intel.ci_brief_code(p_participation uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; cfg jsonb; l intel.ci_track_link%rowtype;
begin
  select campaign_id into v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_camp is null then return null; end if;
  cfg := intel.ci_track_cfg(v_camp);
  if coalesce(cfg->>'say_code', '') <> 'true' or coalesce(cfg->>'mode', 'none') = 'none' then return null; end if;
  select * into l from intel.ci_track_link where participation_id = p_participation;
  if l.link_id is null and coalesce(cfg->>'enabled', '') = 'true' then
    begin perform intel.ci_track_ensure(v_camp); exception when others then null; end;
    select * into l from intel.ci_track_link where participation_id = p_participation;
  end if;
  return nullif(btrim(coalesce(l.code, case when cfg->>'mode' in ('common','per_creator') then upper(btrim(cfg->>'common_code')) end, '')), '');
end $$;
revoke all on function intel.ci_brief_code(uuid) from public, anon, authenticated;

-- 2) the template (created in snapto, waiting for Meta) — listed with the step templates
insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('parcel_received@code', 'geek_step_brief_code', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. Your video brief is ready.

Your personal code to say in the video: *{{4}}*

Next, please read the video brief and submit your video link on the app. Once that is done, we will send your video to the brand for review.

Open your video brief here: {{5}}

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body;
insert into private.ci_step_wa_status(wa_template, status, error)
values ('geek_step_brief_code', 'submitted', 'created in snapto (Utility) on 31 Oct 2026 — waiting for Meta review')
on conflict (wa_template) do nothing;

-- 3) the brief step message carries the code: WhatsApp on geek_step_brief_code (once approved), email always
do $$ declare d text; n text; begin
  d := pg_get_functiondef('intel.ci_notify(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  if position('ci_brief_code' in d) > 0 then raise notice 'ci_notify: code already in'; return; end if;
  n := replace(d, 'select m.email_opt_out_at is not null into v_email_off',
$x$-- 🎟️ a campaign where creators say their own code: the brief message says the code too
  if p_key in ('parcel_received', 'paid_brief_ready', 'brief_preview') and p_participation is not null
     and intel.ci_brief_code(p_participation) is not null and v_mail is not null then
    v_mail := v_mail || E'\n\nYour personal code to say in the video: ' || intel.ci_brief_code(p_participation);
  end if;
  select m.email_opt_out_at is not null into v_email_off$x$);
  n := replace(n, 'if v_wa_payload is not null then',
$x$if v_wa_payload is not null and p_key in ('parcel_received', 'paid_brief_ready') and p_participation is not null
       and intel.ci_brief_code(p_participation) is not null
       and coalesce((select s.status from private.ci_step_wa_status s where s.wa_template = 'geek_step_brief_code'), '') = 'approved' then
      v_wa_payload := v_wa_payload || jsonb_build_object('wa_template', 'geek_step_brief_code', 'wa_lang', 'en',
        'wa_vars', jsonb_build_array(coalesce(v_first, 'there'), coalesce(v_cname, p_vars->>'campaign', 'your campaign'),
                                     coalesce(v_cbrand, p_vars->>'brand', 'the brand'), intel.ci_brief_code(p_participation), 'LINK'));
    end if;
    if v_wa_payload is not null then$x$);
  if n = d then raise exception 'ci_notify anchors not found'; end if;
  execute n;
end $$;

-- 4) the creator's own links: + whether the campaign wants the code said in the video
create or replace function api.my_track_links()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  for r in select distinct p.campaign_id from intel.ci_campaign_participation p
             join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.member_id = auth.uid() and a.access_role = 'self' and a.revoked_at is null
            where coalesce(intel.ci_track_cfg(p.campaign_id)->>'enabled', '') = 'true'
              and not exists (select 1 from intel.ci_track_link l where l.participation_id = p.participation_id) loop
    perform intel.ci_track_ensure(r.campaign_id);
  end loop;
  return coalesce((select jsonb_agg(jsonb_build_object('participation_id', p.participation_id, 'campaign_id', p.campaign_id, 'slug', l.slug,
            'code', intel.ci_track_code(l, cfg.c), 'discount', nullif(btrim(cfg.c->>'discount'), ''), 'dest', coalesce(nullif(btrim(cfg.c->>'dest_url'), ''), cfg.c->>'product_link'),
            'say_code', coalesce(cfg.c->>'say_code', '') = 'true' and coalesce(cfg.c->>'mode', 'none') <> 'none',
            'clicks', (select count(*) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'click'),
            'copies', (select count(*) from intel.ci_track_event e where e.link_id = l.link_id and e.kind = 'copy'),
            'orders', (select coalesce(sum(s.orders), 0) from intel.ci_track_sale s where s.link_id = l.link_id)))
     from intel.ci_campaign_participation p
     join intel.ci_identity_actor_access a on a.identity_id = p.identity_id and a.member_id = auth.uid() and a.access_role = 'self' and a.revoked_at is null
     join intel.ci_track_link l on l.participation_id = p.participation_id
     cross join lateral (select intel.ci_track_cfg(p.campaign_id) c) cfg
    where coalesce(cfg.c->>'enabled', '') = 'true'), '[]'::jsonb);
end $$;
revoke all on function api.my_track_links() from public, anon;
grant execute on function api.my_track_links() to authenticated;

-- 5) the WhatsApp panel's targets: + each creator's code (and whether this campaign has creators say it)
create or replace function api.campaign_wa_targets(p_campaign uuid, p_invites uuid[] default '{}', p_parts uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_name text; v_brand text; v_url text; cfg jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);   -- the app's campaign id → the campaign the creators sit on
  if p_campaign is null or not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select c.name, coalesce(c.submitted_brand_name, b.name) into v_name, v_brand
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = p_campaign;
  -- links always on the live domain (never a *.vercel.app host the team happens to be on)
  cfg := intel.ci_track_cfg(p_campaign);
  begin select (api.ops_wa_settings())->>'app_url' into v_url; exception when others then v_url := null; end;
  return jsonb_build_object('campaign', v_name, 'brand', v_brand,
    'say_code', coalesce(cfg->>'say_code', '') = 'true' and coalesce(cfg->>'mode', 'none') <> 'none', 'app_url', rtrim(coalesce(v_url, ''), '/'), 'tpl_status',
      (select s.status from private.ci_step_wa_status s where s.wa_template = 'geek_selected_connect_instagram'),
    'targets', coalesce((select jsonb_agg(t) from (
      select jsonb_build_object('key', 'i:' || i.invite_id, 'phone', i.phone_e164,
               'name', coalesce(nullif(split_part(btrim(coalesce(i.full_name,'')), ' ', 1), ''), case when i.handle is not null then '@' || i.handle end, 'there'),
               'who', coalesce('@' || i.handle, i.full_name, i.phone_e164),
               'route', case when i.claimed_at is null then '/app.html?cinv=' || i.token::text else '/app.html' end,
               'opted_out', exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null),
               'code', nullif(btrim(coalesce((select l.code from intel.ci_track_link l where l.invite_id = i.invite_id or (i.participation_id is not null and l.participation_id = i.participation_id) limit 1),
                         case when cfg->>'mode' in ('common','per_creator') then upper(btrim(cfg->>'common_code')) end, '')), '')) t
        from intel.ci_campaign_invite i where i.campaign_id = p_campaign and i.invite_id = any(coalesce(p_invites, '{}'))
      union all
      select jsonb_build_object('key', 'p:' || p.participation_id, 'phone', ph.phone,
               'name', coalesce(nullif(split_part(btrim(coalesce(m.name,'')), ' ', 1), ''), case when p.applied_profile is not null then '@' || p.applied_profile end, 'there'),
               'who', coalesce('@' || nullif(p.applied_profile,''), m.name, ph.phone),
               'route', '/app.html',
               'opted_out', exists (select 1 from public.wa_contacts w where w.phone_e164 = ph.phone and w.opt_out_at is not null),
               'code', nullif(btrim(coalesce((select l.code from intel.ci_track_link l where l.participation_id = p.participation_id),
                         case when cfg->>'mode' in ('common','per_creator') then upper(btrim(cfg->>'common_code')) end, '')), ''))
        from intel.ci_campaign_participation p
        left join lateral (select intel.ci_member_of_identity(p.identity_id) as mid) mm on true
        left join public.members m on m.id = mm.mid
        left join lateral (select coalesce(intel.ci_member_phone(mm.mid),
                     (select i2.phone_e164 from intel.ci_campaign_invite i2 where i2.participation_id = p.participation_id and i2.phone_e164 is not null limit 1)) as phone) ph on true
       where p.campaign_id = p_campaign and p.participation_id = any(coalesce(p_parts, '{}'))) x), '[]'::jsonb));
end $$;
revoke all on function api.campaign_wa_targets(uuid, uuid[], uuid[]) from public, anon;
grant execute on function api.campaign_wa_targets(uuid, uuid[], uuid[]) to authenticated;


-- Meta approved the Connect Instagram template (31 Oct 2026)
update private.ci_step_wa_status set status = 'approved', error = null, updated_at = now() where wa_template = 'geek_selected_connect_instagram';
