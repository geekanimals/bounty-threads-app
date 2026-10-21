-- Bulk upload: every status asks for what it needs, like changing a step by hand on the campaign page —
--   Courier sent / Courier delivered → the Courier + Tracking columns (else the row lands on Address confirmed)
--   Video submitted / Client approved → the Video link column (else Courier delivered)
--   Posted / Done → the Post link column — the link of every post (else Client approved)
-- The preview says it for every row before anything is uploaded. Same signatures; redefined.

CREATE OR REPLACE FUNCTION api.bulk_import_creators(p_campaign uuid, p_rows jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_id uuid; v_org uuid; v_batch uuid := gen_random_uuid();
        v_res jsonb; v_added int := 0; v_invited int := 0; v_waiting int := 0; v_skipped int := 0; v_msgs int := 0;
        v_note text := nullif(btrim(coalesce(p_note,'')),''); v_status text; v_addr jsonb; v_trk text; v_courier text; v_part uuid;
        v_dup int := 0; v_posts text[]; v_video text; v_nolink int := 0; v_nocour int := 0; v_novid int := 0; seen_ph text[] := '{}'; seen_em text[] := '{}'; seen_h text[] := '{}'; v_prev intel.ci_campaign_invite%rowtype;
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
    -- post links (one or more, any separator) + the video link
    select coalesce(array_agg(distinct l), '{}') into v_posts from regexp_split_to_table(coalesce(x->>'post_link',''), '[\s,;|]+') l
     where l ~* '^https?://(www\.|m\.)?instagram\.com/(reel|reels|p|tv|stories)/';
    v_video := nullif(btrim(coalesce(x->>'video_link','')), ''); if v_video !~* '^https?://' then v_video := null; end if;
    if cardinality(v_posts) > 0 and intel.ci_bulk_rank(v_status) < intel.ci_bulk_rank('posted') then v_status := 'posted'; end if;
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
         and (v_addr is null or v_prev.ship_address is not null) and (v_courier is null or v_prev.courier is not null)
         and (v_video is null or v_prev.video_url is not null) and v_posts <@ coalesce(v_prev.post_links, '{}') then
        v_dup := v_dup + 1; continue; end if;
    end if;
    if v_status = 'posted' and cardinality(v_posts) = 0
       and cardinality(coalesce((select post_links from intel.ci_campaign_invite where invite_id = v_id), '{}')) = 0 then
      v_status := 'client_approved'; v_nolink := v_nolink + 1;
    end if;
    -- Video submitted / Client approved need the video link (or post links) → until then: Courier delivered
    if v_status in ('video_submitted','client_approved') and v_video is null and cardinality(v_posts) = 0
       and (select video_url from intel.ci_campaign_invite where invite_id = v_id) is null then
      v_status := 'courier_delivered'; v_novid := v_novid + 1;
    end if;
    -- Courier sent / delivered need the courier + tracking → until then: Address confirmed
    if v_status in ('courier_sent','courier_delivered','courier_received','video_brief_sent') and (v_courier is null or v_trk is null)
       and not exists (select 1 from intel.ci_campaign_invite where invite_id = v_id and courier is not null and coalesce(tracking_ref, tracking_url) is not null) then
      v_status := 'address_confirmed'; v_nocour := v_nocour + 1;
    end if;
    if v_id is null then
      insert into intel.ci_campaign_invite(campaign_id, platform, handle, note, invited_by, org_id, source, full_name, phone_e164, email,
                                           city, followers, extra, approved, status, ship_address, courier, tracking_ref, tracking_url,
                                           batch_id, dm_status, video_url, post_links)
      values (p_campaign, 'instagram', v_h, v_note, auth.uid(), v_org, 'bulk', nullif(btrim(coalesce(x->>'name','')),''), v_ph, v_em,
              nullif(btrim(coalesce(x->>'city','')),''), nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'),'')::bigint,
              coalesce(x->'extra','{}'::jsonb), intel.ci_bulk_rank(v_status) >= 4, v_status, v_addr, v_courier,
              case when v_trk !~* '^https?://' then v_trk end, case when v_trk ~* '^https?://' then v_trk end, v_batch, 'manual', v_video, v_posts)
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
        note = coalesce(v_note, note), batch_id = v_batch, source = 'bulk',
        video_url = coalesce(v_video, video_url),
        post_links = (select coalesce(array_agg(distinct l), '{}') from unnest(coalesce(post_links, '{}') || v_posts) l)
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
      perform intel.ci_bulk_fastforward(v_part, v_id, auth.uid(), true);   -- already in: move them to the sheet's step
      v_added := v_added + 1;
    else
      -- already on Geek OS → registration / connect steps are skipped: straight onto the sheet's step
      if v_m is not null then
        perform set_config('geek.bulk_force', 'on', true);
        begin v_res := intel.ci_bulk_attach(v_id, v_m, auth.uid());
        exception when others then perform set_config('geek.bulk_force', 'off', true); raise; end;
        perform set_config('geek.bulk_force', 'off', true);
      else v_res := null; end if;
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
          'waiting', v_waiting, 'skipped', v_skipped, 'duplicates', v_dup, 'posted_without_link', v_nolink, 'without_courier', v_nocour, 'without_video', v_novid));
  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'invited', v_invited, 'waiting_profile', v_waiting,
                            'skipped', v_skipped, 'duplicates', v_dup, 'posted_without_link', v_nolink, 'without_courier', v_nocour, 'without_video', v_novid, 'messages', v_msgs);
end $function$;

CREATE OR REPLACE FUNCTION api.bulk_preview(p_campaign uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x jsonb; n int := 0; out jsonb := '[]'::jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_stage text; v_who text;
        v_st text; v_ig jsonb; v_np int; v_hasvid boolean; seen_ph text[] := '{}'; seen_em text[] := '{}'; seen_h text[] := '{}'; v_dup boolean; v_inv intel.ci_campaign_invite%rowtype;
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
    select count(distinct l) into v_np from regexp_split_to_table(coalesce(x->>'post_link',''), '[\s,;|]+') l
     where l ~* '^https?://(www\.|m\.)?instagram\.com/(reel|reels|p|tv|stories)/';
    v_hasvid := coalesce(x->>'video_link','') ~* '^https?://';
    if v_np > 0 and intel.ci_bulk_rank(coalesce(v_st,'registered')) < intel.ci_bulk_rank('posted') then v_st := 'posted'; end if;
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
      'duplicate', v_dup, 'post_links', v_np, 'video', v_hasvid,
      -- where the row really lands (each step needs its column; same rules as the upload)
      'lands_on', (select case
          when z.s2 in ('courier_sent','courier_delivered','courier_received','video_brief_sent')
               and (nullif(btrim(coalesce(x->>'courier','')),'') is null or nullif(btrim(coalesce(x->>'tracking','')),'') is null)
               and not (v_inv.courier is not null and coalesce(v_inv.tracking_ref, v_inv.tracking_url) is not null) then 'address_confirmed'
          else z.s2 end
        from (select case when y.s1 in ('video_submitted','client_approved') and not v_hasvid and v_np = 0 and v_inv.video_url is null then 'courier_delivered' else y.s1 end s2
                from (select case when v_st = 'posted' and v_np = 0 and cardinality(coalesce(v_inv.post_links, '{}')) = 0 then 'client_approved' else coalesce(v_st,'registered') end s1) y) z),
      'needs_post_link', v_st = 'posted' and v_np = 0 and cardinality(coalesce(v_inv.post_links, '{}')) = 0,
      'needs_video', v_st in ('video_submitted','client_approved') and not v_hasvid and v_np = 0 and v_inv.video_url is null,
      'needs_courier', v_st in ('courier_sent','courier_delivered','courier_received','video_brief_sent')
                       and (nullif(btrim(coalesce(x->>'courier','')),'') is null or nullif(btrim(coalesce(x->>'tracking','')),'') is null)
                       and not (v_inv.courier is not null and coalesce(v_inv.tracking_ref, v_inv.tracking_url) is not null),
      'live_stage', (select p.stage from intel.ci_campaign_participation p where p.participation_id = v_inv.participation_id),
      'already', v_inv.invite_id is not null and intel.ci_bulk_rank(coalesce(v_st,'registered')) <= intel.ci_bulk_rank(coalesce(v_inv.status,'registered'))
                 and v_np = 0 and not (v_hasvid and v_inv.video_url is null)));
    n := n + 1;
  end loop;
  return out;
end $function$;

-- "Posted / Done" (as written in the sheet guide) reads as Posted
CREATE OR REPLACE FUNCTION intel.ci_bulk_status(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v text := regexp_replace(lower(btrim(coalesce(p, ''))), '^\d+\s*[.)-]?\s*', '');
begin
  -- the step keys the app's dropdowns send (contract_sent, courier_sent …) read the same as the words
  v := regexp_replace(replace(v, '_', ' '), '\s+', ' ', 'g');
  if v in ('', 'registered', 'register', 'applied', 'invited', 'invite', 'new', 'pending', '-', '—') then return 'registered'; end if;
  if v in ('screened', 'eligible', 'shortlisted') then return 'screened'; end if;
  if v in ('sent to brand', 'sent to the brand', 'with brand') then return 'sent_to_brand'; end if;
  if v in ('approved', 'brand confirmed', 'brand approved', 'selected', 'confirmed', 'yes', 'y', 'ok', 'final', '✓', '✔') then return 'approved'; end if;
  if v in ('contract sent', 'contract') then return 'contract_sent'; end if;
  if v in ('contract signed', 'signed') then return 'contract_signed'; end if;
  if v in ('address confirmed', 'address', 'address done') then return 'address_confirmed'; end if;
  if v in ('courier sent', 'shipped', 'dispatched', 'in transit', 'product sent') then return 'courier_sent'; end if;
  if v in ('courier delivered', 'courier received', 'delivered', 'received', 'product received', 'product delivered') then return 'courier_delivered'; end if;
  if v in ('video brief sent', 'brief sent', 'video brief') then return 'video_brief_sent'; end if;
  if v in ('video submitted', 'submitted', 'video sent') then return 'video_submitted'; end if;
  if v in ('client approved', 'video approved', 'content approved') then return 'client_approved'; end if;
  -- Posted is the last step: posting completes the campaign
  if v in ('posted', 'live', 'published', 'reel posted', 'done', 'completed', 'complete', 'posted / done', 'posted/done', 'posted done', 'posted - done') then return 'posted'; end if;
  return null;
end $function$;
