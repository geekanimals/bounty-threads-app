-- 1) ELIGIBILITY: the campaign's criteria (followers, engagement, city, gender, category, age, pet, married / unmarried,
--    open to barter) are now real rules. A creator can APPLY only when they meet every criterion that is filled in;
--    otherwise they see exactly which ones don't match. The team can only INVITE creators who meet them too.
--    (Bulk upload is the team's own list and is not blocked.)
-- 2) FULL BRIEF for the creator: everything the Super Admin entered (brief, deliverables, video brief, caption, tags,
--    references, posting note, terms, who can apply) is visible before applying and inside My Campaigns.
-- 3) DECLINED WITH A REASON: the team writes the message; the creator gets it on WhatsApp (Utility template
--    geek_step_not_selected), by email and in the app: "not selected for <campaign> — Reason: <your message>".
-- ADDITIVE.

-- ---------------------------------------------------------------------------------------------------------------
-- 1) one creator against one campaign → { eligible, criteria:[{key, need, have, ok}], unmet:[text] }
-- ---------------------------------------------------------------------------------------------------------------
create or replace function intel.ci_eligibility(p_campaign uuid, p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ideal jsonb; v_min int; v_max int; v_eng numeric; v_gender text; v_locs text[]; v_cats text[];
        v_amin int; v_amax int; v_pet text; v_pet_type text; v_marital text; v_barter boolean;
        v_id uuid; v_fol bigint; v_meng numeric; v_city text; v_region text; v_mcats text[]; v_mg text; v_dob date; v_age int;
        v_mm text; v_has_pet boolean; v_pets text[]; v_mbarter boolean; c jsonb := '[]'::jsonb; ok boolean; v_n text;
begin
  v_ideal := intel.ci_campaign_ideal(p_campaign);
  v_min := nullif(v_ideal->>'min_followers','')::numeric::int; v_max := nullif(v_ideal->>'max_followers','')::numeric::int;
  v_eng := nullif(v_ideal->>'min_engagement','')::numeric; v_gender := nullif(lower(v_ideal->>'gender'),'');
  v_amin := nullif(v_ideal->>'age_min','')::numeric::int; v_amax := nullif(v_ideal->>'age_max','')::numeric::int;
  v_pet := nullif(lower(v_ideal->>'pet'),''); v_pet_type := nullif(lower(btrim(v_ideal->>'pet_type')),'');
  if v_pet_type is not null then v_pet := 'yes'; end if;
  v_marital := nullif(lower(v_ideal->>'marital'),'');
  v_barter := lower(coalesce(v_ideal->>'barter','')) in ('yes','true');
  select array_agg(btrim(x)) into v_locs from jsonb_array_elements_text(coalesce(v_ideal->'locations','[]'::jsonb)) x where btrim(x) <> '';
  select array_agg(btrim(x)) into v_cats from jsonb_array_elements_text(coalesce(v_ideal->'categories','[]'::jsonb)) x where btrim(x) <> '';
  if v_locs is null then
    select array_agg(btrim(x)) into v_locs from (select unnest(cc.cities) x from intel.ci_campaign cc where cc.campaign_id = p_campaign) s where btrim(x) <> '';
  end if;

  -- the creator's own details
  v_id := intel.ci_member_identity(p_member);
  select sa.followers_count,
         case when coalesce(sa.followers_count,0) > 0 and jsonb_typeof(sa.recent_media) = 'array' and jsonb_array_length(sa.recent_media) > 0 then
           round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                            from jsonb_array_elements(sa.recent_media) m2) / sa.followers_count, 2) end
    into v_fol, v_meng
    from public.social_accounts sa where sa.member_id = p_member and sa.platform = 'instagram'
   order by sa.followers_count desc nulls last limit 1;
  if v_id is not null then
    select coalesce(ad.city, pp.city_coarse), coalesce(ad.state, pp.state_coarse), pp.categories
      into v_city, v_region, v_mcats
      from (select 1) one
      left join intel.ci_creator_professional_profile pp on pp.identity_id = v_id
      left join lateral (select a.city, a.state from private.creator_address a where a.identity_id = v_id and a.deleted_at is null
                          order by a.is_default desc, a.created_at limit 1) ad on true;
    select lower(per.gender), per.date_of_birth, lower(per.marital_status), per.has_pet,
           (select array_agg(distinct lower(cpz.pet_type)) from private.creator_pet cpz where cpz.identity_id = v_id and coalesce(cpz.pet_type,'') <> '')
             || case when coalesce(per.pet_type,'') <> '' then array[lower(per.pet_type)] else array[]::text[] end
      into v_mg, v_dob, v_mm, v_has_pet, v_pets
      from private.creator_personal_profile per where per.identity_id = v_id;
    select cp.accepts_barter into v_mbarter from intel.ci_creator_commercial_preference cp where cp.identity_id = v_id;
  end if;
  v_age := case when v_dob is not null then extract(year from age(v_dob))::int end;

  if v_min is not null or v_max is not null then
    ok := v_fol is not null and (v_min is null or v_fol >= v_min) and (v_max is null or v_fol <= v_max);
    c := c || jsonb_build_object('key','followers','ok',coalesce(ok,false),
      'need', case when v_min is not null and v_max is not null then to_char(v_min,'FM999,999,999') || ' – ' || to_char(v_max,'FM999,999,999') || ' Instagram followers'
                   when v_min is not null then 'At least ' || to_char(v_min,'FM999,999,999') || ' Instagram followers'
                   else 'Up to ' || to_char(v_max,'FM999,999,999') || ' Instagram followers' end,
      'have', case when v_fol is null then 'Instagram not connected' else 'You have ' || to_char(v_fol,'FM999,999,999') end);
  end if;
  if v_eng is not null then
    ok := v_meng is not null and v_meng >= v_eng;
    c := c || jsonb_build_object('key','engagement','ok',coalesce(ok,false),'need','Engagement of at least ' || v_eng || '%',
      'have', case when v_meng is null then 'Not enough recent posts to measure' else 'Yours: ' || v_meng || '%' end);
  end if;
  if v_locs is not null then
    ok := exists (select 1 from unnest(v_locs) l where lower(coalesce(v_city,'')) like '%' || lower(l) || '%' or lower(coalesce(v_region,'')) like '%' || lower(l) || '%');
    c := c || jsonb_build_object('key','location','ok',coalesce(ok,false),'need','Based in ' || array_to_string(v_locs, ', '),
      'have', case when v_city is null and v_region is null then 'No city in your profile yet' else 'Your city: ' || case when v_city is not null and v_region is not null and lower(v_city) <> lower(v_region) then v_city || ', ' || v_region else coalesce(v_city, v_region) end end);
  end if;
  if v_gender is not null then
    ok := v_mg = v_gender;
    c := c || jsonb_build_object('key','gender','ok',coalesce(ok,false),'need', initcap(v_gender) || ' creators',
      'have', case when v_mg is null then 'Gender not in your profile yet' else 'Your profile: ' || initcap(v_mg) end);
  end if;
  if v_cats is not null then
    ok := exists (select 1 from unnest(v_cats) ct where exists (select 1 from unnest(coalesce(v_mcats, array[]::text[])) pc where lower(pc) like '%' || lower(ct) || '%'));
    c := c || jsonb_build_object('key','category','ok',coalesce(ok,false),'need','Category: ' || array_to_string(v_cats, ', '),
      'have', case when coalesce(array_length(v_mcats,1),0) = 0 then 'No categories in your profile yet' else 'Yours: ' || array_to_string(v_mcats[1:3], ', ') end);
  end if;
  if v_amin is not null or v_amax is not null then
    ok := v_age is not null and (v_amin is null or v_age >= v_amin) and (v_amax is null or v_age <= v_amax);
    c := c || jsonb_build_object('key','age','ok',coalesce(ok,false),
      'need', case when v_amin is not null and v_amax is not null then 'Age ' || v_amin || ' – ' || v_amax
                   when v_amin is not null then 'Age ' || v_amin || ' or older' else 'Age ' || v_amax || ' or younger' end,
      'have', case when v_age is null then 'Birthday not in your profile yet' else 'You are ' || v_age end);
  end if;
  if v_pet is not null then
    ok := (v_pet = 'no' and v_has_pet is false)
       or (v_pet = 'yes' and (v_has_pet is true or coalesce(array_length(v_pets,1),0) > 0)
           and (v_pet_type is null or exists (select 1 from unnest(v_pets) pt where pt like '%' || v_pet_type || '%' or v_pet_type like '%' || pt || '%')));
    c := c || jsonb_build_object('key','pet','ok',coalesce(ok,false),
      'need', case when v_pet = 'no' then 'No pet' when v_pet_type is not null then 'Must have a pet (' || v_pet_type || ')' else 'Must have a pet' end,
      'have', case when v_has_pet is null and coalesce(array_length(v_pets,1),0) = 0 then 'Pets not in your profile yet'
                   when coalesce(array_length(v_pets,1),0) > 0 then 'Your pets: ' || array_to_string(v_pets, ', ')
                   when v_has_pet then 'You have a pet' else 'No pet' end);
  end if;
  if v_marital is not null then
    ok := v_mm = v_marital;
    v_n := case v_marital when 'single' then 'Unmarried' else initcap(v_marital) end;
    c := c || jsonb_build_object('key','marital','ok',coalesce(ok,false),'need', v_n || ' creators',
      'have', case when v_mm is null then 'Not in your profile yet' else 'Your profile: ' || case v_mm when 'single' then 'Unmarried' else initcap(v_mm) end end);
  end if;
  if v_barter then
    ok := v_mbarter is true;
    c := c || jsonb_build_object('key','barter','ok',coalesce(ok,false),'need','Open to barter collaborations',
      'have', case when v_mbarter is null then 'Not set in your profile yet' when v_mbarter then 'Yes' else 'Your profile says no' end);
  end if;

  return jsonb_build_object('eligible', not exists (select 1 from jsonb_array_elements(c) x where not (x->>'ok')::boolean),
    'criteria', c,
    'unmet', coalesce((select jsonb_agg((x->>'need') || ' — ' || (x->>'have')) from jsonb_array_elements(c) x where not (x->>'ok')::boolean), '[]'::jsonb));
end $$;
revoke all on function intel.ci_eligibility(uuid, uuid) from public, anon, authenticated;

-- the readable message used by apply / invite when someone doesn't match
create or replace function intel.ci_eligibility_message(p_e jsonb, p_you boolean)
returns text language sql immutable set search_path = '' as $$
  select case when p_you then 'You are not eligible for this campaign. The brand needs: '
              else 'This creator is not eligible for this campaign. It needs: ' end
         || (select string_agg(x, '; ') from jsonb_array_elements_text(p_e->'unmet') x) || '.' $$;

-- creator: my eligibility for one campaign (the app shows it before Apply)
create or replace function api.my_campaign_eligibility(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return intel.ci_eligibility(intel.ci_resolve_campaign(p_campaign), auth.uid());
end $$;
revoke all on function api.my_campaign_eligibility(uuid) from public, anon;
grant execute on function api.my_campaign_eligibility(uuid) to authenticated;

-- team: several creators at once (Search all creators marks who can be invited)
create or replace function api.campaign_eligibility_bulk(p_campaign uuid, p_members uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null or not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(m::text, intel.ci_eligibility(p_campaign, m)) from unnest(p_members[1:200]) m), '{}'::jsonb);
end $$;
revoke all on function api.campaign_eligibility_bulk(uuid, uuid[]) from public, anon;
grant execute on function api.campaign_eligibility_bulk(uuid, uuid[]) to authenticated;

-- apply: only when every criterion matches (same checks, same words as the app)
do $do$ declare src text; begin
  select pg_get_functiondef('api.apply_to_campaign(uuid,text)'::regprocedure) into src;
  if position('ci_eligibility' in src) = 0 then
    src := replace(src, $x$  insert into intel.ci_campaign_participation(campaign_id, identity_id, role, stage)
    values (p_campaign, v_id, nullif(p_role,''), 'applied')$x$,
      $x$  declare v_e jsonb; begin
    v_e := intel.ci_eligibility(p_campaign, v_uid);
    if not coalesce((v_e->>'eligible')::boolean, true) then
      raise exception '%', intel.ci_eligibility_message(v_e, true) using errcode = '22023', hint = 'not_eligible';
    end if;
  end;
  insert into intel.ci_campaign_participation(campaign_id, identity_id, role, stage)
    values (p_campaign, v_id, nullif(p_role,''), 'applied')$x$);
    execute src;
  end if;
end $do$;

-- invite: only creators who match (the team sees why not)
do $do$ declare src text; begin
  select pg_get_functiondef('api.invite_creator(uuid,uuid,text)'::regprocedure) into src;
  if position('ci_eligibility' in src) = 0 then
    src := replace(src, $x$  v_note := nullif(btrim(coalesce(p_note,'')), '');$x$,
      $x$  v_note := nullif(btrim(coalesce(p_note,'')), '');
  declare v_e jsonb; begin
    v_e := intel.ci_eligibility(p_campaign, p_member);
    if not coalesce((v_e->>'eligible')::boolean, true) then
      raise exception '%', intel.ci_eligibility_message(v_e, false) using errcode = '22023', hint = 'not_eligible';
    end if;
  end;$x$);
    execute src;
  end if;
end $do$;
-- open campaigns for the creator: + full brief + their eligibility
create or replace function api.list_open_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'campaign_id', c.campaign_id, 'name', c.name, 'brand', coalesce(b.name, c.submitted_brand_name),
      'product', c.product, 'category', c.category, 'comp_type', c.comp_type,
      'cities', coalesce(to_jsonb(c.cities), '[]'::jsonb), 'languages', coalesce(to_jsonb(c.languages), '[]'::jsonb),
      'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb), 'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'brief', br.requirements->>'brief', 'deliverables_text', br.requirements->>'deliverables_text', 'platforms', br.requirements->>'platforms',
      'campaign_type', br.requirements->>'campaign_type', 'barter_subtype', br.requirements->>'barter_subtype',
      'product_link', br.requirements->>'product_link', 'product_value', br.requirements->'product_value',
      'creators_needed', br.requirements->'creators_needed', 'attachments', coalesce(br.requirements->'attachments', '[]'::jsonb),
      'my_stage', p.stage, 'my_participation_id', p.participation_id, 'applications_closed', c.applications_closed,
      -- everything the team entered, before applying: video brief + terms (no fee — that is agreed one to one)
      'video_brief', intel.ci_playbook(c.campaign_id)->'brief',
      'terms', (intel.ci_playbook(c.campaign_id)->'contract') - 'product' - 'extra_terms',
      'objective', br.requirements->>'objective',
      -- who can apply, checked against this creator's profile
      'eligibility', intel.ci_eligibility(c.campaign_id, v_uid))
      order by c.created_at desc)
    from intel.ci_campaign c
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    left join intel.ci_campaign_participation p on p.campaign_id = c.campaign_id and v_identity is not null and p.identity_id = v_identity
    where c.lifecycle_status in ('creator_discovery', 'in_execution') and (c.ends_on is null or c.ends_on >= current_date)
      and (not coalesce(c.applications_closed, false) or p.participation_id is not null)), '[]'::jsonb);
end $$;


-- ---------------------------------------------------------------------------------------------------------------
-- 2) creator side sees the whole video brief + terms at every step (not only after the product arrives)
-- ---------------------------------------------------------------------------------------------------------------
do $do$ declare src text; v_new text; begin
  select pg_get_functiondef('api.get_my_campaigns()'::regprocedure) into src;
  v_new := regexp_replace(src,
    $x$'video_brief',\s*case when p\.stage in \([^)]*\)\s*then intel\.ci_playbook\(c\.campaign_id\)->'brief' end$x$,
    $x$'video_brief', intel.ci_playbook(c.campaign_id)->'brief', 'terms', (intel.ci_playbook(c.campaign_id)->'contract') - 'extra_terms'$x$);
  if v_new <> src then execute v_new; else raise notice 'get_my_campaigns: video brief already open'; end if;
end $do$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3) not selected → the team's own reason, on WhatsApp (Utility) + email + in-app
-- ---------------------------------------------------------------------------------------------------------------
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
    -- {{3}} can carry this message's own text (e.g. the reason a creator was not selected)
    v_v3 := coalesce(nullif(btrim(coalesce(p_vars->>'wa_v3', '')), ''), sw.update_text, coalesce(v_cbrand, p_vars->>'brand', 'the brand'));
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

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('not_selected', 'geek_step_not_selected', 'Hi *{{1}}*,

Thank you for applying for the campaign *{{2}}* on Geek OS. This is an update on your application: it was not selected for this campaign. Reason: {{3}}

Next, please keep your creator profile updated on the app. Once a new campaign matches your profile, we will invite you to it.

View your application here: {{4}}

Thank you!
Team Geek Animals', 'The brand has chosen other creators for this campaign.')
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body, update_text = excluded.update_text;
insert into private.ci_step_wa_status(wa_template, status, error)
values ('geek_step_not_selected', 'submitted', 'created in snapto (Utility) on 27 Oct 2026 — waiting for Meta review')
on conflict (wa_template) do nothing;

update intel.ci_notification_template set
  title = 'Update on {{campaign}}',
  body_md = 'Thank you for applying to {{campaign}}. You were not selected for this campaign.{{reason_line}} Your profile stays active — new campaigns open every week.'
 where template_key = 'not_selected';

create or replace function intel.tg_notify_creator_not_selected()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_infl uuid; v_name text; v_reason text; v_label text; v_code text;
begin
  if NEW.entity <> 'participation' or NEW.to_status not in ('ineligible','brand_declined','dropped') then return null; end if;
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;
  select identity_id, reason, reason_code into v_identity, v_reason, v_code from intel.ci_campaign_participation where participation_id = NEW.participation_id;
  v_infl := intel.ci_member_of_identity(v_identity);
  select name into v_name from intel.ci_campaign where campaign_id = NEW.campaign_id;
  v_reason := nullif(btrim(coalesce(NEW.reason, v_reason, '')), '');
  -- "code — note" → the note is the message; a bare code → its label
  if v_reason is not null and position(' — ' in v_reason) > 0 then v_reason := nullif(btrim(split_part(v_reason, ' — ', 2)), ''); end if;
  select v.label into v_label from public.rejection_reason_vocab v where v.code = coalesce(v_reason, v_code);
  v_reason := coalesce(v_label, v_reason);
  if v_reason is not null and v_reason !~ '[.!?]$' then v_reason := v_reason || '.'; end if;
  perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'not_selected',
                          jsonb_build_object('campaign', coalesce(v_name,'the campaign'),
                                             'reason_line', case when v_reason is null then '' else ' Reason: ' || v_reason end,
                                             'wa_v3', coalesce(v_reason, 'The brand has chosen other creators for this campaign.')));
  return null;
exception when others then
  raise warning 'not_selected notify skipped: %', sqlerrm;   -- never block a decision on a notification
  return null;
end $$;
revoke all on function intel.tg_notify_creator_not_selected() from public, anon, authenticated;

-- the Messages & templates map shows the "not selected" message too
do $do$ declare src text; begin
  select pg_get_functiondef('api.campaign_message_map(uuid)'::regprocedure) into src;
  if position('''not_selected''' in src) = 0 then
    src := replace(src, $x$(10, 'Approved — invite to the campaign', 'invited', 'all'),$x$,
                        $x$(5, 'Not selected — with the team''s reason', 'not_selected', 'all'),
      (10, 'Approved — invite to the campaign', 'invited', 'all'),$x$);
    execute src;
  end if;
end $do$;

-- the 9 paid-flow step templates are APPROVED by Meta (checked in snapto on 27 Oct 2026) — use them
update private.ci_step_wa_status set status = 'approved', error = null, updated_at = now()
 where wa_template in ('geek_step_contract_paid','geek_step_contract_bp','geek_step_brief_paid','geek_step_payment_details',
                       'geek_step_payment_fix','geek_step_payment_verified','geek_step_payment_scheduled','geek_step_payment_paid',
                       'geek_step_completed_paid');
