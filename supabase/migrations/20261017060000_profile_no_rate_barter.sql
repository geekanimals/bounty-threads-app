-- Creator Profile: Rate card and Barter preference are switched off for now (they come back later). The profile
-- is complete without them, and "campaign-ready" = Instagram connected + the mandatory checklist done.
-- Instagram counts as connected when the creator's Instagram (Media Kit connection) is linked.

CREATE OR REPLACE FUNCTION intel.ci_profile_requirements(p_identity uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  per record; con record; cp record; r jsonb := '[]'::jsonb; v_done int := 0; v_total int := 0;
  ok boolean;
begin
  select * into per from private.creator_personal_profile where identity_id = p_identity;
  select * into con from private.creator_contact where identity_id = p_identity;
  select * into cp  from intel.ci_creator_commercial_preference where identity_id = p_identity;

  -- helper pattern: append {key,label,section,done}
  -- (rate card + barter preference are not asked for now — they come back later)
  ok := exists (select 1 from intel.ci_creator_brand_aspiration a where a.identity_id = p_identity and a.active
                  and coalesce(btrim(a.submitted_brand_name),'') <> '');
  r := r || jsonb_build_object('key','fav_brands','label','Favourite brands (at least 1)','section','dreams','done',ok);
  ok := exists (select 1 from private.creator_address a where a.identity_id = p_identity and a.deleted_at is null
                  and coalesce(btrim(a.city),'') <> '' and coalesce(btrim(a.state),'') <> '' and coalesce(btrim(a.postal_code),'') <> '');
  r := r || jsonb_build_object('key','address','label','Delivery address with city, state & PIN','section','address','done',ok);
  ok := per.date_of_birth is not null;
  r := r || jsonb_build_object('key','dob','label','Birthday','section','personal','done',ok);
  ok := coalesce(btrim(per.gender),'') <> '';
  r := r || jsonb_build_object('key','gender','label','Gender','section','personal','done',ok);
  ok := per.marital_status is not null;
  r := r || jsonb_build_object('key','marital','label','Married / unmarried','section','personal','done',ok);
  if per.marital_status = 'married' then
    ok := per.marriage_anniversary is not null;
    r := r || jsonb_build_object('key','anniversary','label','Marriage anniversary','section','personal','done',ok);
  end if;
  ok := per.has_pet is not null;
  r := r || jsonb_build_object('key','pet','label','Pet? (Yes / No)','section','personal','done',ok);
  if per.has_pet then
    ok := (coalesce(btrim(per.pet_name),'') <> '' and coalesce(btrim(per.pet_type),'') <> '')
          or exists (select 1 from private.creator_pet x where x.identity_id = p_identity);
    r := r || jsonb_build_object('key','pet_details','label','Pet name & type','section','personal','done',ok);
  end if;
  ok := exists (select 1 from intel.ci_creator_skill s where s.identity_id = p_identity);
  r := r || jsonb_build_object('key','skills','label','Skills (at least 1)','section','skills','done',ok);
  ok := exists (select 1 from intel.ci_creator_resource s where s.identity_id = p_identity);
  r := r || jsonb_build_object('key','resources','label','Resources / equipment (at least 1)','section','skills','done',ok);
  ok := coalesce(btrim(con.email),'') <> '' and con.email !~* '@creators\.bountythreads\.app$';
  r := r || jsonb_build_object('key','backup_email','label','Backup email (account recovery)','section','contact','done',ok);

  select count(*) filter (where (x->>'done')::boolean), count(*) into v_done, v_total from jsonb_array_elements(r) x;
  return jsonb_build_object('complete', v_done = v_total, 'done', v_done, 'total', v_total, 'items', r,
    'missing', (select coalesce(jsonb_agg(x->>'label'), '[]'::jsonb) from jsonb_array_elements(r) x where not (x->>'done')::boolean));
end $$;

CREATE OR REPLACE FUNCTION api.get_my_onboarding_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_id uuid; v_conn boolean; v_pct numeric; v_basic boolean; v_barter boolean; v_rate boolean; v_status text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  v_conn := exists (select 1 from intel.ci_identity_platform_account ipa join intel.ci_platform_connection c on c.platform_account_id=ipa.platform_account_id
                    where ipa.identity_id=v_id and ipa.valid_to is null and c.status='active')
        or exists (select 1 from public.social_accounts sa where sa.member_id = auth.uid() and sa.platform = 'instagram' and sa.ig_user_id is not null);
  select coalesce(completion_pct,0), coalesce(basic_complete,false) into v_pct, v_basic from intel.ci_profile_completion where identity_id=v_id;
  v_pct := coalesce(v_pct,0); v_basic := coalesce(v_basic,false);
  v_barter := exists (select 1 from intel.ci_creator_commercial_preference where identity_id=v_id and accepts_barter is not null);
  v_rate   := exists (select 1 from intel.ci_creator_rate_card where identity_id=v_id and status='active');
  -- complete = the mandatory checklist (intel.ci_profile_requirements); rate card / barter are not required now
  v_basic := v_basic or coalesce((intel.ci_profile_requirements(v_id)->>'complete')::boolean, false);
  v_status := case
    when not v_conn then 'started'
    when not v_basic then 'profile_incomplete'
    else 'campaign_ready' end;
  return jsonb_build_object('status', v_status, 'instagram_connected', v_conn, 'profile_pct', v_pct,
    'basic_complete', v_basic, 'barter_declared', v_barter, 'rate_card_present', v_rate);
end $$;
