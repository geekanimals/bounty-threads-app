-- 🌐 Live campaigns for everyone + the Creator upload invite that points there. ADDITIVE.
-- * public.explore_campaigns() (public schema so the anon key can call it): every LIVE campaign (no login needed) — brief, deliverables, video brief, terms and
--   who can apply. No fees, budgets, contacts or creators. Shown on /explore.html; tapping Apply asks the
--   visitor to sign in with WhatsApp, connect Instagram, and then the normal flow carries on.
-- * Super Admin → Creator upload: optional "Not selected for" campaign. Everyone uploaded there is invited to
--   /explore.html on WhatsApp (Utility templates geek_explore_invite / geek_explore_invite_ns) and by email.
--   Until Meta approves those two templates, WhatsApp uses the approved geek_join_invite; the email always
--   carries the new text.

-- ---------------------------------------------------------------------------------------------------------------
-- 1) live campaigns, public
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.explore_campaigns()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', c.campaign_id, 'name', c.name, 'brand', coalesce(b.name, c.submitted_brand_name),
      'product', c.product, 'category', c.category, 'comp_type', c.comp_type,
      'cities', coalesce(to_jsonb(c.cities), '[]'::jsonb), 'languages', coalesce(to_jsonb(c.languages), '[]'::jsonb),
      'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb), 'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'brief', br.requirements->>'brief', 'deliverables_text', br.requirements->>'deliverables_text', 'platforms', br.requirements->>'platforms',
      'campaign_type', br.requirements->>'campaign_type', 'barter_subtype', br.requirements->>'barter_subtype',
      'product_link', br.requirements->>'product_link', 'product_value', br.requirements->'product_value',
      'creators_needed', br.requirements->'creators_needed',
      'video_brief', intel.ci_playbook(c.campaign_id)->'brief',
      'terms', (intel.ci_playbook(c.campaign_id)->'contract') - 'product' - 'extra_terms',
      'who_can_apply', coalesce((select jsonb_agg(x->>'need') from jsonb_array_elements(intel.ci_eligibility(c.campaign_id, null)->'criteria') x), '[]'::jsonb))
      order by c.created_at desc), '[]'::jsonb)
    from intel.ci_campaign c
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
   where c.lifecycle_status in ('creator_discovery', 'in_execution') and not coalesce(c.applications_closed, false)
     and (c.ends_on is null or c.ends_on >= current_date) $$;
revoke all on function public.explore_campaigns() from public;
grant execute on function public.explore_campaigns() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2) Creator upload: "not selected for" campaign + the new invite
-- ---------------------------------------------------------------------------------------------------------------
alter table intel.ci_creator_upload add column if not exists not_selected_campaign uuid references intel.ci_campaign(campaign_id) on delete set null;

-- the exact words (WhatsApp template body, filled in) + email — used to send AND to show on the upload page
create or replace function intel.ci_explore_invite_text(p_first text, p_from text, p_campaign text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tpl text; v_live boolean; v_body text; v_mail text; v_subj text;
begin
  if p_campaign is not null then
    v_tpl := 'geek_explore_invite_ns';
    v_body := 'Hi *' || p_first || '*,' || E'\n\n'
      || 'Thank you for your interest in the campaign *' || p_campaign || '*. This is an update on your application: you were not selected for this campaign.' || E'\n\n'
      || 'You are invited to join Geek OS, where you can explore other live campaigns and apply to the ones that match your profile. You can sign in with this WhatsApp number when you apply.' || E'\n\n'
      || 'Explore campaigns here: {{link}}' || E'\n\n' || 'Thank you!' || E'\n' || 'Team Geek Animals';
    v_subj := 'Update on ' || p_campaign || ' — explore more campaigns on Geek OS';
  else
    v_tpl := 'geek_explore_invite';
    v_body := 'Hi *' || p_first || '*,' || E'\n\n'
      || 'Thank you for your interest in working with *' || p_from || '*. You are invited to join Geek OS, our creator platform for brand campaigns.' || E'\n\n'
      || 'Next, please explore the live campaigns and apply to the ones that match your profile. You can sign in with this WhatsApp number when you apply.' || E'\n\n'
      || 'Explore campaigns here: {{link}}' || E'\n\n' || 'Thank you!' || E'\n' || 'Team Geek Animals';
    v_subj := 'You are invited to Geek OS — explore live campaigns';
  end if;
  v_live := coalesce((select s.status from private.ci_step_wa_status s where s.wa_template = v_tpl), 'draft') = 'approved';
  v_mail := replace(replace(v_body, '*', ''), E'\n\nExplore campaigns here: {{link}}', E'\n\nClick the button below to see the live campaigns.');
  v_mail := replace(v_mail, E'\n\nThank you!\nTeam Geek Animals', '');
  return jsonb_build_object('template', v_tpl, 'template_live', v_live,
    'wa_template', case when v_live then v_tpl else 'geek_join_invite' end,
    'wa_vars', case when v_live then jsonb_build_array(p_first, coalesce(p_campaign, p_from), 'LINK') else jsonb_build_array(p_first, p_from, 'LINK') end,
    'whatsapp_text', v_body, 'subject', v_subj, 'email_text', v_mail);
end $$;

create or replace function intel.ci_send_join_invite(p_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare u intel.ci_creator_upload%rowtype; v_first text; v_n int := 0; v_from text; v_camp text; t jsonb;
begin
  select * into u from intel.ci_creator_upload where id = p_id;
  if u.id is null or u.joined_member is not null then return 0; end if;
  v_from := coalesce((select b.name from intel.ci_brand b where b.brand_id = u.brand_id), 'Geek Creative Agency');
  v_camp := (select c.name from intel.ci_campaign c where c.campaign_id = u.not_selected_campaign);
  v_first := coalesce(nullif(split_part(btrim(coalesce(u.full_name,'')), ' ', 1), ''), case when u.handle is not null then '@' || u.handle end, 'there');
  t := intel.ci_explore_invite_text(v_first, v_from, v_camp);
  if u.phone_e164 is not null and not exists (select 1 from public.wa_contacts w where w.phone_e164 = u.phone_e164 and w.opt_out_at is not null) then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('whatsapp', null, u.phone_e164, u.not_selected_campaign, 'join_invite',
            jsonb_build_object('title', 'Explore campaigns on Geek OS', 'text', t->>'email_text', 'action_route', '/explore.html', 'action_label', 'Explore campaigns',
                               'to_name', v_first, 'force_template', true, 'wa_template', t->>'wa_template', 'wa_lang', 'en', 'wa_vars', t->'wa_vars'),
            'join:' || u.id || ':wa:' || (u.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if u.email is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('email', null, u.email, u.not_selected_campaign, 'join_invite',
            jsonb_build_object('subject', t->>'subject', 'html', t->>'email_text', 'to_name', v_first, 'action_route', '/explore.html', 'action_label', 'Explore campaigns'),
            'join:' || u.id || ':em:' || (u.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if v_n > 0 then update intel.ci_creator_upload set invites_sent = invites_sent + 1, last_invited_at = now() where id = p_id; end if;
  return v_n;
end $$;
revoke all on function intel.ci_send_join_invite(uuid) from public, anon, authenticated;

-- upload with an optional "not selected for" campaign
create or replace function api.creator_upload_v2(p_rows jsonb, p_send boolean default true, p_brand uuid default null, p_campaign uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; x jsonb; v_phone text; v_email text; v_handle text; v_id uuid; v_sent int := 0; v_batch uuid; v_ids uuid[] := '{}';
begin
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can upload creators here.' using errcode = '42501'; end if;
  p_campaign := case when p_campaign is null then null else intel.ci_resolve_campaign(p_campaign) end;
  v_res := api.creator_upload(p_rows, false, p_brand);       -- save / update everyone first (no message yet)
  v_batch := nullif(v_res->>'batch_id', '')::uuid;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_phone := intel.ci_e164(nullif(btrim(coalesce(x->>'phone','')), ''));
    v_email := lower(nullif(btrim(coalesce(x->>'email','')), ''));
    v_handle := intel.ci_norm_handle(x->>'handle');
    select id into v_id from intel.ci_creator_upload
     where (v_phone is not null and phone_e164 = v_phone) or (v_handle is not null and handle = v_handle) or (v_email is not null and lower(email) = v_email) limit 1;
    if v_id is not null and not (v_id = any(v_ids)) then v_ids := v_ids || v_id; end if;
  end loop;
  if p_campaign is not null then update intel.ci_creator_upload set not_selected_campaign = p_campaign where id = any(v_ids); end if;
  if coalesce(p_send, true) then
    for v_id in select u.id from intel.ci_creator_upload u
                 where u.id = any(v_ids) and u.joined_member is null and (u.batch_id = v_batch or p_campaign is not null) loop
      v_sent := v_sent + (case when intel.ci_send_join_invite(v_id) > 0 then 1 else 0 end);
    end loop;
  end if;
  return v_res || jsonb_build_object('invited', v_sent, 'not_selected_campaign', p_campaign);
end $$;
revoke all on function api.creator_upload_v2(jsonb, boolean, uuid, uuid) from public, anon;
grant execute on function api.creator_upload_v2(jsonb, boolean, uuid, uuid) to authenticated;

-- the message the upload page shows before sending
create or replace function api.creator_upload_preview(p_brand uuid default null, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  return intel.ci_explore_invite_text('Asha', coalesce((select b.name from intel.ci_brand b where b.brand_id = p_brand), 'Geek Creative Agency'),
           (select c.name from intel.ci_campaign c where c.campaign_id = intel.ci_resolve_campaign(p_campaign)));
end $$;
revoke all on function api.creator_upload_preview(uuid, uuid) from public, anon;
grant execute on function api.creator_upload_preview(uuid, uuid) to authenticated;

-- the two new Utility templates (created in snapto, waiting for Meta)
insert into private.ci_step_wa_status(wa_template, status, error) values
  ('geek_explore_invite', 'submitted', 'created in snapto (Utility) on 27 Oct 2026 — waiting for Meta review'),
  ('geek_explore_invite_ns', 'submitted', 'created in snapto (Utility) on 27 Oct 2026 — waiting for Meta review')
on conflict (wa_template) do nothing;
