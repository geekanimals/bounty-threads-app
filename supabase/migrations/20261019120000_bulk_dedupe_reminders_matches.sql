-- 1) Bulk upload: duplicates are skipped, unique people are invited.
--    • the same person twice in one sheet (same phone, email or Instagram) → only the first row is used
--    • someone already uploaded on this campaign whose row doesn't move them to a later step → skipped (no second message)
--    • the preview marks both, and the result says how many were skipped as duplicates
-- 2) Invites nobody has answered get a reminder twice a day (10:00 and 18:00 India time) on WhatsApp + email, for up to
--    7 days: bulk-upload invites (not registered / not joined yet) and in-app invites not accepted yet.
-- 3) "Matching creators" for a campaign = creators who meet EVERY field of the campaign's ideal profile (followers, engagement,
--    location, gender, category, age, pet, marital status, open to barter). Missing details don't count as a match.
-- ADDITIVE: functions redefined with the same signatures, one new log table, one cron job.

create or replace function api.bulk_import_creators(p_campaign uuid, p_rows jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_id uuid; v_org uuid; v_batch uuid := gen_random_uuid();
        v_res jsonb; v_added int := 0; v_invited int := 0; v_waiting int := 0; v_skipped int := 0; v_msgs int := 0;
        v_note text := nullif(btrim(coalesce(p_note,'')),''); v_status text; v_addr jsonb; v_trk text; v_courier text; v_part uuid;
        v_dup int := 0; seen_ph text[] := '{}'; seen_em text[] := '{}'; seen_h text[] := '{}'; v_prev intel.ci_campaign_invite%rowtype;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 2000 then raise exception 'upload at most 2000 creators at a time' using errcode = '22023'; end if;
  select org_id into v_org from public.members where id = auth.uid();

  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_status := coalesce(intel.ci_bulk_status(x->>'status'),
                         case when lower(coalesce(x->>'approved','')) in ('true','yes','1') then 'approved' else 'registered' end);
    v_addr := intel.ci_bulk_address(x);
    v_courier := nullif(btrim(coalesce(x->>'courier','')), '');
    v_trk := nullif(btrim(coalesce(x->>'tracking','')), '');
    if v_ph is null and v_em is null and v_h is null then v_skipped := v_skipped + 1; continue; end if;
    -- the same person twice in this sheet (same phone, email or Instagram) → only the first row counts
    if (v_ph is not null and v_ph = any(seen_ph)) or (v_em is not null and v_em = any(seen_em)) or (v_h is not null and v_h = any(seen_h)) then
      v_dup := v_dup + 1; continue; end if;
    if v_ph is not null then seen_ph := seen_ph || v_ph; end if;
    if v_em is not null then seen_em := seen_em || v_em; end if;
    if v_h is not null then seen_h := seen_h || v_h; end if;

    -- one row per person per campaign (matched on phone, then email, then Instagram)
    select invite_id into v_id from intel.ci_campaign_invite
     where campaign_id = p_campaign and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and lower(email) = v_em)
                                          or (v_h is not null and lower(handle) = v_h))
     order by (phone_e164 = v_ph) desc nulls last limit 1;
    -- already uploaded before, and this row doesn't move them to a later step → skip (no second message)
    if v_id is not null then
      select * into v_prev from intel.ci_campaign_invite where invite_id = v_id;
      if intel.ci_bulk_rank(v_status) <= intel.ci_bulk_rank(coalesce(v_prev.status, 'registered')) and v_prev.batch_id is distinct from v_batch
         and (v_addr is null or v_prev.ship_address is not null) and (v_courier is null or v_prev.courier is not null) then
        v_dup := v_dup + 1; continue; end if;
    end if;
    if v_id is null then
      insert into intel.ci_campaign_invite(campaign_id, platform, handle, note, invited_by, org_id, source, full_name, phone_e164, email,
                                           city, followers, extra, approved, status, ship_address, courier, tracking_ref, tracking_url,
                                           batch_id, dm_status)
      values (p_campaign, 'instagram', v_h, v_note, auth.uid(), v_org, 'bulk', nullif(btrim(coalesce(x->>'name','')),''), v_ph, v_em,
              nullif(btrim(coalesce(x->>'city','')),''), nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'),'')::bigint,
              coalesce(x->'extra','{}'::jsonb), intel.ci_bulk_rank(v_status) >= 4, v_status, v_addr, v_courier,
              case when v_trk !~* '^https?://' then v_trk end, case when v_trk ~* '^https?://' then v_trk end, v_batch, 'manual')
      returning invite_id into v_id;
    else
      update intel.ci_campaign_invite set
        handle = coalesce(handle, v_h), phone_e164 = coalesce(phone_e164, v_ph), email = coalesce(email, v_em),
        full_name = coalesce(nullif(btrim(coalesce(x->>'name','')),''), full_name), city = coalesce(nullif(btrim(coalesce(x->>'city','')),''), city),
        status = case when intel.ci_bulk_rank(v_status) > intel.ci_bulk_rank(coalesce(status,'registered')) then v_status else coalesce(status,'registered') end,
        approved = approved or intel.ci_bulk_rank(v_status) >= 4,
        ship_address = coalesce(v_addr, ship_address), courier = coalesce(v_courier, courier),
        tracking_ref = coalesce(case when v_trk !~* '^https?://' then v_trk end, tracking_ref),
        tracking_url = coalesce(case when v_trk ~* '^https?://' then v_trk end, tracking_url),
        note = coalesce(v_note, note), batch_id = v_batch, source = 'bulk'
       where invite_id = v_id;
    end if;

    -- their Instagram goes to the auto-fetch queue (followers, name, photo, bio) — the profile picks it up
    if v_h is not null then
      perform intel.ci_upsert_external(jsonb_build_object('handle', v_h, 'name', nullif(btrim(coalesce(x->>'name','')),''),
                                                          'city', nullif(btrim(coalesce(x->>'city','')),'')), v_org, 'bulk');
    end if;

    v_m := intel.ci_find_creator(v_ph, v_em, v_h);
    select participation_id into v_part from intel.ci_campaign_invite where invite_id = v_id;
    if v_part is not null then
      perform intel.ci_bulk_fastforward(v_part, v_id, auth.uid());   -- already in: move them to the sheet's step
      v_added := v_added + 1;
    else
      if v_m is not null then v_res := intel.ci_bulk_attach(v_id, v_m, auth.uid()); else v_res := null; end if;
      if v_res->>'status' = 'joined' then v_added := v_added + 1;
      else
        if v_m is not null then v_waiting := v_waiting + 1; else v_invited := v_invited + 1; end if;
        -- not in the campaign yet: the message for their step (Approved → invite) — once per status
        if (select status_messaged is distinct from status from intel.ci_campaign_invite where invite_id = v_id) then
          v_msgs := v_msgs + intel.ci_send_bulk_invite(v_id);
        end if;
      end if;
    end if;
  end loop;

  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'analytics', 'bulk_creator_upload', jsonb_build_object('campaign', p_campaign, 'added', v_added, 'invited', v_invited,
          'waiting', v_waiting, 'skipped', v_skipped, 'duplicates', v_dup));
  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'invited', v_invited, 'waiting_profile', v_waiting,
                            'skipped', v_skipped, 'duplicates', v_dup, 'messages', v_msgs);
end $$;

create or replace function api.bulk_preview(p_campaign uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare x jsonb; n int := 0; out jsonb := '[]'::jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_stage text; v_who text;
        v_st text; v_ig jsonb; seen_ph text[] := '{}'; seen_em text[] := '{}'; seen_h text[] := '{}'; v_dup boolean; v_inv intel.ci_campaign_invite%rowtype;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_st := coalesce(intel.ci_bulk_status(x->>'status'), case when lower(coalesce(x->>'approved','')) in ('true','yes','1') then 'approved' end);
    v_dup := (v_ph is not null and v_ph = any(seen_ph)) or (v_em is not null and v_em = any(seen_em)) or (v_h is not null and v_h = any(seen_h));
    if v_ph is not null then seen_ph := seen_ph || v_ph; end if;
    if v_em is not null then seen_em := seen_em || v_em; end if;
    if v_h is not null then seen_h := seen_h || v_h; end if;
    v_inv := null;
    select * into v_inv from intel.ci_campaign_invite where campaign_id = p_campaign
       and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and lower(email) = v_em) or (v_h is not null and lower(handle) = v_h)) limit 1;
    v_m := intel.ci_find_creator(v_ph, v_em, v_h); v_stage := null; v_who := null; v_ig := null;
    if v_m is not null then
      select coalesce(case when v_h is not null and intel.ci_member_has_handle(v_m, v_h) then '@'||v_h end,
                      (select '@'||sa.username from public.social_accounts sa where sa.member_id = v_m and sa.platform='instagram' limit 1), m.name)
        into v_who from public.members m where m.id = v_m;
      select p.stage into v_stage from intel.ci_campaign_participation p
       where p.campaign_id = p_campaign and p.identity_id = intel.ci_member_identity(v_m);
    end if;
    if v_h is not null then
      select jsonb_strip_nulls(jsonb_build_object('name', e.display_name, 'followers', e.followers, 'pic', e.profile_picture_url))
        into v_ig from intel.ci_external_creator e where e.platform = 'instagram' and e.handle = v_h;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('i', n, 'phone', v_ph, 'email', v_em, 'handle', v_h,
      'phone_bad', coalesce(x->>'phone','') <> '' and v_ph is null,
      'email_bad', coalesce(x->>'email','') <> '' and v_em is null,
      'no_contact', v_ph is null and v_em is null and v_h is null,
      'status', coalesce(v_st, 'registered'), 'status_bad', coalesce(btrim(x->>'status'),'') <> '' and v_st is null,
      'message', intel.ci_bulk_status_key(coalesce(v_st, 'registered')),
      'needs_address', intel.ci_bulk_rank(v_st) between 7 and 9 and coalesce(btrim(x->>'address'),'') = '',
      'on_platform', v_m is not null, 'who', v_who, 'stage', v_stage, 'ig', v_ig,
      'duplicate', v_dup,
      'already', v_inv.invite_id is not null and intel.ci_bulk_rank(coalesce(v_st,'registered')) <= intel.ci_bulk_rank(coalesce(v_inv.status,'registered'))));
    n := n + 1;
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2) reminders for invites nobody answered
-- ---------------------------------------------------------------------------------------------------
create table if not exists private.ci_invite_reminder (
  participation_id uuid not null references intel.ci_campaign_participation(participation_id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index if not exists ci_invite_reminder_part_idx on private.ci_invite_reminder(participation_id, sent_at desc);
alter table private.ci_invite_reminder enable row level security;
revoke all on private.ci_invite_reminder from public, anon, authenticated;

-- one reminder to a Geek OS creator who was invited in the app but hasn't accepted (app + WhatsApp + email)
create or replace function intel.ci_send_invite_reminder(p_participation uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare p intel.ci_campaign_participation%rowtype; v_mid uuid; v_first text; v_name text; v_brand text; v_wa text; v_email text;
        v_nid uuid; v_title text; v_body text; v_n int := 0;
begin
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or p.stage not in ('invited','shortlisted') then return 0; end if;
  v_mid := intel.ci_member_of_identity(p.identity_id); if v_mid is null then return 0; end if;
  select c.name, coalesce(c.submitted_brand_name, b.name) into v_name, v_brand
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = p.campaign_id;
  select coalesce(nullif(split_part(btrim(coalesce(m.name,'')), ' ', 1), ''), 'there') into v_first from public.members m where m.id = v_mid;
  v_title := 'Reminder: ' || coalesce(v_name, 'a campaign') || ' is waiting for you';
  v_body := coalesce(v_brand, 'The brand') || ' would like you on **' || coalesce(v_name, 'the campaign') || '**. Open My Campaigns to accept or pass.';
  insert into intel.ci_notification(recipient_member_id, campaign_id, participation_id, kind, title, body, action_route, action_label, dedupe_key)
    values (v_mid, p.campaign_id, p_participation, 'action_required', v_title, v_body, 'mycampaigns', 'Accept or pass',
            'invite_reminder:' || p_participation || ':' || extract(epoch from now())::bigint)
    returning notification_id into v_nid;
  v_wa := intel.ci_wa_number(v_mid);
  if v_wa is not null and not exists (select 1 from public.wa_contacts w where w.phone_e164 = v_wa and w.opt_out_at is not null) then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
    values ('whatsapp', v_mid, v_wa, p.campaign_id, p_participation, v_nid, 'invite_reminder',
            jsonb_build_object('title', v_title, 'text', v_body, 'action_route', 'mycampaigns', 'action_label', 'Accept or pass', 'to_name', v_first,
              'force_template', true, 'wa_template', 'geek_campaign_access', 'wa_lang', 'en',
              'wa_vars', jsonb_build_array(v_first, coalesce(v_name, 'our campaign'), coalesce(v_brand, 'the brand'), 'LINK')), v_nid::text)
    on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
    v_n := v_n + 1;
  end if;
  if not coalesce((select m.email_opt_out_at is not null from public.members m where m.id = v_mid), false) then
    select nullif(u.email::text, '') into v_email from auth.users u where u.id = v_mid;
    if v_email ~* '@creators\.bountythreads\.app$' then v_email := null; end if;
    if v_email is null then
      select nullif(c.email, '') into v_email from private.creator_contact c where c.identity_id = p.identity_id and c.email !~* '@creators\.bountythreads\.app$';
    end if;
    if v_email is not null then
      insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
      values ('email', v_mid, v_email, p.campaign_id, p_participation, v_nid, 'invite_reminder',
              jsonb_build_object('subject', v_title, 'html', 'Hi ' || v_first || E',\n\n' || replace(v_body, '**', '') || E'\n\nClick the button below to open it on the app.',
                                 'action_route', 'mycampaigns', 'action_label', 'Accept or pass', 'to_name', v_first), v_nid::text)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
      v_n := v_n + 1;
    end if;
  end if;
  insert into private.ci_invite_reminder(participation_id) values (p_participation);
  return v_n;
end $$;
revoke all on function intel.ci_send_invite_reminder(uuid) from public, anon, authenticated;

-- the twice-a-day run: at most 14 reminders (7 days), never closer than 8 hours apart
create or replace function intel.ci_run_invite_reminders()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_bulk int := 0; v_app int := 0;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return jsonb_build_object('skipped', 'off'); end if;
  -- bulk upload invites: not joined yet, were sent an invite, within 7 days of the upload
  for r in select i.invite_id from intel.ci_campaign_invite i join intel.ci_campaign c on c.campaign_id = i.campaign_id
            where i.source = 'bulk' and i.claimed_at is null and i.status_messaged is not null
              and i.created_at > now() - interval '7 days' and coalesce(i.invites_sent, 0) between 1 and 14
              and coalesce(i.last_invited_at, i.created_at) < now() - interval '8 hours'
              and coalesce(c.applications_closed, false) = false
            limit 500 loop
    begin
      if intel.ci_send_bulk_invite(r.invite_id) > 0 then v_bulk := v_bulk + 1; end if;
    exception when others then raise warning 'bulk reminder skipped: %', sqlerrm;
    end;
  end loop;
  -- in-app invites not accepted yet
  for r in select p.participation_id from intel.ci_campaign_participation p
            where p.stage in ('invited','shortlisted') and p.created_at > now() - interval '7 days'
              and (select count(*) from private.ci_invite_reminder x where x.participation_id = p.participation_id) < 14
              and coalesce((select max(x.sent_at) from private.ci_invite_reminder x where x.participation_id = p.participation_id), p.created_at)
                  < now() - interval '8 hours'
            limit 500 loop
    begin
      if intel.ci_send_invite_reminder(r.participation_id) > 0 then v_app := v_app + 1; end if;
    exception when others then raise warning 'invite reminder skipped: %', sqlerrm;
    end;
  end loop;
  return jsonb_build_object('bulk', v_bulk, 'app', v_app);
end $$;
revoke all on function intel.ci_run_invite_reminders() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-invite-reminders', '30 4,12 * * *', $c$select intel.ci_run_invite_reminders()$c$);   -- 10:00 + 18:00 IST
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3) "Matching creators" = meets EVERY field of the campaign's ideal profile. A field left empty allows anyone;
--    a field that is filled in needs the creator's detail to be there AND to match (no detail = not a match).
-- ---------------------------------------------------------------------------------------------------
create or replace function api.campaign_matches(p_campaign uuid, p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ideal jsonb; v_min int; v_max int; v_eng numeric; v_gender text; v_locs text[]; v_cats text[]; v_cities text[];
        v_amin int; v_amax int; v_pet text; v_pet_type text; v_marital text; v_barter boolean;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then return '[]'::jsonb; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  v_ideal := intel.ci_campaign_ideal(p_campaign);
  v_min := nullif(v_ideal->>'min_followers','')::numeric::int; v_max := nullif(v_ideal->>'max_followers','')::numeric::int;
  v_eng := nullif(v_ideal->>'min_engagement','')::numeric; v_gender := nullif(lower(v_ideal->>'gender'),'');
  v_amin := nullif(v_ideal->>'age_min','')::numeric::int; v_amax := nullif(v_ideal->>'age_max','')::numeric::int;
  v_pet := nullif(lower(v_ideal->>'pet'),''); v_pet_type := nullif(lower(btrim(v_ideal->>'pet_type')),'');
  if v_pet_type is not null then v_pet := 'yes'; end if;
  v_marital := nullif(lower(v_ideal->>'marital'),'');
  v_barter := lower(coalesce(v_ideal->>'barter','')) in ('yes','true');
  select array_agg(lower(btrim(x))) into v_locs from jsonb_array_elements_text(coalesce(v_ideal->'locations','[]'::jsonb)) x where btrim(x) <> '';
  select array_agg(lower(btrim(x))) into v_cats from jsonb_array_elements_text(coalesce(v_ideal->'categories','[]'::jsonb)) x where btrim(x) <> '';
  select array_agg(lower(x)) into v_cities from (select unnest(c.cities) x from intel.ci_campaign c where c.campaign_id = p_campaign) s where btrim(x) <> '';
  v_locs := coalesce(v_locs, v_cities);

  return coalesce((select jsonb_agg(r order by (r->>'followers')::bigint desc nulls last) from (
    select jsonb_build_object(
      'member_id', x.member_id, 'username', x.username, 'name', x.name,
      'profile_picture_url', x.profile_picture_url, 'followers', x.followers, 'posts', x.posts,
      'engagement', x.eng, 'city', x.city, 'region', x.region, 'categories', coalesce(to_jsonb(x.cats), '[]'::jsonb), 'gender', x.gender,
      'age', x.age, 'pets', to_jsonb(x.pets), 'marital', x.marital,
      'reel_rate', (select min(i.amount) from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                     where rc.identity_id = x.identity_id and rc.status = 'active' and i.deliverable_type ilike '%reel%' and i.amount > 0),
      'accepts_barter', x.accepts_barter,
      'state', case when x.stage is null then 'none'
                    when x.stage = 'invited' then 'invited'
                    when x.stage in ('applied','eligible','sent_to_brand','shortlisted') then 'applied'
                    when x.stage in ('ineligible','brand_declined','dropped','rejected') then 'declined'
                    else 'approved' end,
      'score', 100,
      'why', (select coalesce(jsonb_agg(w), '[]'::jsonb) from (
                select 'Followers ' || to_char(x.followers, 'FM999,999,999') w where v_min is not null or v_max is not null
                union all select 'Engagement ' || x.eng || '%' where v_eng is not null
                union all select 'In ' || coalesce(x.city, x.region) where v_locs is not null
                union all select initcap(x.gender) where v_gender is not null
                union all select 'Category: ' || array_to_string(x.cats[1:2], ', ') where v_cats is not null
                union all select 'Age ' || x.age where v_amin is not null or v_amax is not null
                union all select case when v_pet = 'no' then 'No pet' else 'Pet: ' || coalesce(array_to_string(x.pets, ', '), 'yes') end where v_pet is not null
                union all select initcap(case when x.marital = 'single' then 'unmarried' else x.marital end) where v_marital is not null
                union all select 'Open to barter' where v_barter) q(w))) r
    from (
      select sa.member_id, sa.username, coalesce(nullif(btrim(m.name),''), sa.name) as name, sa.profile_picture_url,
             sa.followers_count as followers, sa.media_count as posts, sa.biography, acc.identity_id,
             coalesce(ad.city, pp.city_coarse) as city, coalesce(ad.state, pp.state_coarse) as region, pp.categories as cats,
             lower(per.gender) as gender, extract(year from age(per.date_of_birth))::int as age, lower(per.marital_status) as marital,
             per.has_pet, (select array_agg(distinct lower(cpz.pet_type)) from private.creator_pet cpz where cpz.identity_id = acc.identity_id and coalesce(cpz.pet_type,'') <> '')
               || case when coalesce(per.pet_type,'') <> '' then array[lower(per.pet_type)] else array[]::text[] end as pets,
             cp.accepts_barter, p.stage,
             case when coalesce(sa.followers_count,0) > 0 and jsonb_typeof(sa.recent_media) = 'array' and jsonb_array_length(sa.recent_media) > 0 then
               round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                                from jsonb_array_elements(sa.recent_media) m2) / sa.followers_count, 2) end as eng
        from public.social_accounts sa
        join public.members m on m.id = sa.member_id and m.role = 'creator'
        left join lateral (select a.identity_id from intel.ci_identity_actor_access a
                            where a.member_id = sa.member_id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) acc on true
        left join intel.ci_creator_professional_profile pp on pp.identity_id = acc.identity_id
        left join private.creator_personal_profile per on per.identity_id = acc.identity_id
        left join intel.ci_creator_commercial_preference cp on cp.identity_id = acc.identity_id
        left join lateral (select a.city, a.state from private.creator_address a
                            where a.identity_id = acc.identity_id and a.deleted_at is null order by a.is_default desc, a.created_at limit 1) ad on true
        left join intel.ci_campaign_participation p on p.campaign_id = p_campaign and p.identity_id = acc.identity_id
       where sa.platform = 'instagram' and coalesce(m.status,'active') = 'active'
    ) x
   where (v_min is null or coalesce(x.followers, 0) >= v_min)
     and (v_max is null or (x.followers is not null and x.followers <= v_max))
     and (v_eng is null or coalesce(x.eng, 0) >= v_eng)
     and (v_gender is null or x.gender = v_gender)
     and (v_locs is null or exists (select 1 from unnest(v_locs) l
            where lower(coalesce(x.city, '')) like '%' || l || '%' or lower(coalesce(x.region, '')) like '%' || l || '%'))
     and (v_cats is null or exists (select 1 from unnest(v_cats) ct
            where exists (select 1 from unnest(coalesce(x.cats, array[]::text[])) pc where lower(pc) like '%' || ct || '%')))
     and (v_amin is null or (x.age is not null and x.age >= v_amin))
     and (v_amax is null or (x.age is not null and x.age <= v_amax))
     and (v_pet is null
          or (v_pet = 'no' and x.has_pet is false)
          or (v_pet = 'yes' and (x.has_pet is true or coalesce(array_length(x.pets, 1), 0) > 0)
              and (v_pet_type is null or exists (select 1 from unnest(x.pets) pt where pt like '%' || v_pet_type || '%' or v_pet_type like '%' || pt || '%'))))
     and (v_marital is null or x.marital = v_marital)
     and (not v_barter or x.accepts_barter is true)
   order by x.followers desc nulls last
   limit greatest(coalesce(p_limit, 60), 1)) s), '[]'::jsonb);
end $$;
revoke all on function api.campaign_matches(uuid, int) from public, anon;
grant execute on function api.campaign_matches(uuid, int) to authenticated;


-- ---------------------------------------------------------------------------------------------------
-- 4) Creator story: the whole WhatsApp chat (latest 800 messages, newest first) + the creator's email, and the team can
--    send an email from there too (it shows up in the same message list).
-- ---------------------------------------------------------------------------------------------------
create or replace function api.campaign_creator_hub(p_participation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p intel.ci_campaign_participation%rowtype; v_mid uuid; v_phone text; v_req jsonb; v_name text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or not intel.ci_can_manage_participation(p_participation) then
    raise exception 'not your campaign' using errcode = '42501'; end if;
  v_mid := intel.ci_member_of_identity(p.identity_id);
  v_phone := intel.ci_member_phone(v_mid);
  v_req := case when p.identity_id is not null then intel.ci_profile_requirements(p.identity_id) end;
  select name into v_name from intel.ci_campaign where campaign_id = p.campaign_id;
  return jsonb_build_object(
    'participation_id', p.participation_id, 'campaign_id', p.campaign_id, 'campaign', v_name, 'stage', p.stage,
    'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'reason', p.reason,
    'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
    'member_id', v_mid, 'name', (select m.name from public.members m where m.id = v_mid), 'phone', v_phone,
    'wa_linked', exists (select 1 from public.wa_contacts w where w.user_id = v_mid and w.verified_at is not null),
    'wa_opted_out', exists (select 1 from public.wa_contacts w where w.user_id = v_mid and w.opt_out_at is not null),
    'needs', intel.ci_join_needs(v_mid),
    'profile', case when v_req is not null then jsonb_build_object('done', v_req->'done', 'total', v_req->'total',
                 'pct', case when (v_req->>'total')::int > 0 then round(100.0 * (v_req->>'done')::int / (v_req->>'total')::int) end,
                 'missing', v_req->'missing') end,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'entity', e.entity, 'from', e.from_status, 'to', e.to_status,
                   'reason', e.reason, 'by', (select m.name from public.members m where m.id = e.actor_member_id),
                   'by_creator', e.actor_member_id is not distinct from v_mid) order by e.at desc, e.event_id desc)
                 from intel.ci_campaign_event e where e.participation_id = p_participation), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('at', n.created_at, 'title', n.title, 'body', left(n.body, 400), 'read', n.read_at is not null,
                   'kind', n.kind) order by n.created_at desc)
                 from (select * from intel.ci_notification n where n.recipient_member_id = v_mid
                         and (n.participation_id = p_participation or n.campaign_id = p.campaign_id) order by n.created_at desc limit 60) n), '[]'::jsonb),
    -- every WhatsApp / email we sent (automatic step messages, invites, reminders) + the WhatsApp chat both ways
    'messages', coalesce((select jsonb_agg(m order by (m->>'at') desc) from (
        select jsonb_build_object('at', coalesce(o.sent_at, o.created_at), 'channel', o.channel, 'dir', 'out', 'auto', true,
                 'key', o.template_key, 'template', o.payload->>'wa_template', 'status', o.status, 'error', o.last_error,
                 'text', left(coalesce(o.payload->>'text', o.payload->>'subject', o.payload->>'title', ''), 700)) m
          from intel.ci_outbox o
         where o.channel in ('whatsapp','email')
           and (o.participation_id = p_participation or (o.recipient_member_id = v_mid and o.campaign_id = p.campaign_id)
                or (v_phone is not null and o.to_address = v_phone and o.campaign_id = p.campaign_id))
        union all
        select jsonb_build_object('at', w.created_at, 'channel', 'whatsapp', 'dir', case when w.direction = 'inbound' then 'in' else 'out' end,
                 'auto', false, 'status', w.status, 'error', w.error, 'text', left(coalesce(w.body, ''), 1500),
                 'by', (select m.name from public.members m where m.id = w.sender_user_id))
          from public.wa_messages w join public.wa_conversations c on c.id = w.conversation_id
         where v_phone is not null and c.contact_phone_e164 = v_phone
        order by 1 desc limit 800) q), '[]'::jsonb),
    'email', coalesce(
        (select nullif(u.email::text, '') from auth.users u where u.id = v_mid and u.email !~* '@creators\.bountythreads\.app$'),
        (select nullif(c.email, '') from private.creator_contact c where c.identity_id = p.identity_id and c.email !~* '@creators\.bountythreads\.app$'),
        (select i.email from intel.ci_campaign_invite i where i.participation_id = p_participation and i.email is not null limit 1)),
    'session_open', exists (select 1 from public.wa_conversations c where v_phone is not null and c.contact_phone_e164 = v_phone and c.session_expires_at > now()),
    'step_messages', coalesce((select jsonb_agg(jsonb_build_object('key', t.template_key, 'title', t.title) order by array_position(intel.ci_team_step_keys(), t.template_key))
                 from intel.ci_notification_template t where t.active and t.template_key = any(intel.ci_team_step_keys())), '[]'::jsonb));
end $$;
revoke all on function api.campaign_creator_hub(uuid) from public, anon;
grant execute on function api.campaign_creator_hub(uuid) to authenticated;

create or replace function api.team_send_email(p_participation uuid, p_subject text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p intel.ci_campaign_participation%rowtype; v_mid uuid; v_to text; v_first text; v_sub text := left(btrim(coalesce(p_subject,'')), 160);
        v_body text := left(btrim(coalesce(p_body,'')), 6000); v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or not intel.ci_can_manage_participation(p_participation) then
    raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_body = '' then raise exception 'write a message first' using errcode = '22023'; end if;
  if v_sub = '' then v_sub := coalesce((select name from intel.ci_campaign where campaign_id = p.campaign_id), 'Your campaign'); end if;
  v_mid := intel.ci_member_of_identity(p.identity_id);
  v_to := coalesce(
    (select nullif(u.email::text, '') from auth.users u where u.id = v_mid and u.email !~* '@creators\.bountythreads\.app$'),
    (select nullif(c.email, '') from private.creator_contact c where c.identity_id = p.identity_id and c.email !~* '@creators\.bountythreads\.app$'),
    (select i.email from intel.ci_campaign_invite i where i.participation_id = p_participation and i.email is not null limit 1));
  if v_to is null then raise exception 'no email address for this creator yet' using errcode = '22023'; end if;
  if v_mid is not null and coalesce((select m.email_opt_out_at is not null from public.members m where m.id = v_mid), false) then
    raise exception 'this creator unsubscribed from emails' using errcode = '22023'; end if;
  if exists (select 1 from intel.ci_outbox o where o.participation_id = p_participation and o.template_key = 'team_email'
              and o.created_at > now() - interval '20 seconds') then
    raise exception 'Sent just now — wait a few seconds.' using errcode = '22023'; end if;
  select coalesce(nullif(split_part(btrim(coalesce(m.name,'')), ' ', 1), ''), 'there') into v_first from public.members m where m.id = v_mid;
  insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, template_key, payload, dedupe_key)
  values ('email', v_mid, v_to, p.campaign_id, p_participation, 'team_email',
          jsonb_build_object('subject', v_sub, 'html', v_body, 'text', v_sub || E'\n\n' || v_body, 'to_name', coalesce(v_first, 'there'),
                             'action_route', 'mycampaigns', 'action_label', 'Open My Campaigns', 'sent_by', auth.uid()),
          'team_email:' || p_participation || ':' || gen_random_uuid())
  returning outbox_id into v_id;
  return jsonb_build_object('ok', true, 'to', v_to, 'outbox_id', v_id);
end $$;
revoke all on function api.team_send_email(uuid, text, text) from public, anon;
grant execute on function api.team_send_email(uuid, text, text) to authenticated;
