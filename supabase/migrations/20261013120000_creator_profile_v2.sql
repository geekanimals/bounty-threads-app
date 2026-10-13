-- Creator profile v2: managed Instagram pages (+ choose one when applying), multiple pets, verified WhatsApp
-- auto-filled, verified backup email, travel location, Instagram-detected brands, richer approval alerts.
-- ADDITIVE; every API is scoped to the signed-in creator's own identity.

-- ===================================================================================================
-- 1) Pages / profiles the creator manages, and which one an application is made with
-- ===================================================================================================
create table if not exists intel.ci_creator_managed_profile (
  managed_id   uuid primary key default gen_random_uuid(),
  identity_id  uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform     text not null default 'instagram' check (platform in ('instagram','youtube','facebook','x','linkedin','other')),
  handle       text not null check (handle ~ '^[A-Za-z0-9._-]{1,60}$'),
  followers    integer check (followers is null or followers >= 0),
  category     text,
  relation     text check (relation is null or relation in ('own','brand_page','client','fan_page','other')),
  created_at   timestamptz not null default now(),
  constraint ci_managed_profile_uq unique (identity_id, platform, handle)
);
alter table intel.ci_creator_managed_profile enable row level security;
revoke all on intel.ci_creator_managed_profile from anon, authenticated;
grant select, insert, update, delete on intel.ci_creator_managed_profile to service_role;

create or replace function api.get_my_managed_profiles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  return coalesce((select jsonb_agg(jsonb_build_object('managed_id', m.managed_id, 'platform', m.platform, 'handle', m.handle,
            'followers', m.followers, 'category', m.category, 'relation', m.relation) order by m.created_at)
     from intel.ci_creator_managed_profile m where m.identity_id = intel.ci_caller_identity()), '[]'::jsonb);
end $$;
create or replace function api.upsert_managed_profile(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); v_id uuid; v_handle text;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_handle := lower(regexp_replace(coalesce(p_payload->>'handle',''), '^@', ''));
  if (select count(*) from intel.ci_creator_managed_profile where identity_id = v_identity) >= 20 then
    raise exception 'you can add up to 20 profiles' using errcode = '22023'; end if;
  insert into intel.ci_creator_managed_profile(identity_id, platform, handle, followers, category, relation)
  values (v_identity, coalesce(nullif(p_payload->>'platform',''),'instagram'), v_handle,
          nullif(p_payload->>'followers','')::int, nullif(p_payload->>'category',''), nullif(p_payload->>'relation',''))
  on conflict (identity_id, platform, handle) do update set followers = excluded.followers, category = excluded.category, relation = excluded.relation
  returning managed_id into v_id;
  return v_id;
end $$;
create or replace function api.delete_managed_profile(p_managed_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  delete from intel.ci_creator_managed_profile where managed_id = p_managed_id and identity_id = intel.ci_caller_identity();
end $$;
revoke all on function api.get_my_managed_profiles() from public, anon;
revoke all on function api.upsert_managed_profile(jsonb) from public, anon;
revoke all on function api.delete_managed_profile(uuid) from public, anon;
grant execute on function api.get_my_managed_profiles(), api.upsert_managed_profile(jsonb), api.delete_managed_profile(uuid) to authenticated;

alter table intel.ci_campaign_participation add column if not exists applied_profile text;

-- apply with a chosen profile: the connected Instagram account or one of the creator's managed profiles
create or replace function api.apply_to_campaign_v2(p_campaign uuid, p_profile text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); v_res jsonb; v_handle text; v_own text;
begin
  v_handle := nullif(lower(regexp_replace(coalesce(p_profile,''), '^@', '')), '');
  select lower(sa.username) into v_own from public.social_accounts sa where sa.member_id = auth.uid() and sa.platform = 'instagram' limit 1;
  if v_handle is not null and v_handle is distinct from v_own
     and not exists (select 1 from intel.ci_creator_managed_profile m where m.identity_id = v_identity and lower(m.handle) = v_handle) then
    raise exception 'pick one of your own profiles' using errcode = '42501';
  end if;
  v_res := api.apply_to_campaign(p_campaign, null);
  update intel.ci_campaign_participation set applied_profile = coalesce(v_handle, v_own)
   where participation_id = (v_res->>'participation_id')::uuid;
  return v_res || jsonb_build_object('applied_profile', coalesce(v_handle, v_own));
end $$;
revoke all on function api.apply_to_campaign_v2(uuid, text) from public, anon;
grant execute on function api.apply_to_campaign_v2(uuid, text) to authenticated;

-- applicants list shows which profile the creator applied with
create or replace function api.org_applicants(p_campaign uuid default null, p_stage text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_all boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_all := intel.ci_is_agency_operator();
  if p_campaign is not null and not intel.ci_can_manage_campaign(p_campaign) then
    raise exception 'not authorised for this campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(rr order by (rr->>'applied_at') desc) from (
    select jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id,
             'legacy_campaign_id', c.legacy_campaign_id, 'campaign_name', c.name,
             'brand', c.submitted_brand_name, 'comp_type', c.comp_type,
             'campaign_type', coalesce(br.requirements->>'campaign_type',
                                       case c.comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' when 'barter' then 'barter' end),
             'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
             'stage', p.stage, 'reason', p.reason, 'reason_code', p.reason_code, 'applied_profile', p.applied_profile,
             'applied_at', p.created_at, 'updated_at', p.updated_at, 'creator', intel.ci_public_creator_card(p.identity_id)) rr
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join lateral (select requirements from intel.ci_campaign_brief b where b.campaign_id = c.campaign_id order by b.created_at desc limit 1) br on true
     where (p_campaign is null or c.campaign_id = p_campaign)
       and (p_stage is null or p.stage = p_stage)
       and (v_all or intel.ci_can_manage_campaign(c.campaign_id))
     order by p.created_at desc limit 1000) s), '[]'::jsonb);
end $$;
revoke all on function api.org_applicants(uuid, text) from public, anon;
grant execute on function api.org_applicants(uuid, text) to authenticated;

-- ===================================================================================================
-- 2) Multiple pets
-- ===================================================================================================
create table if not exists private.creator_pet (
  pet_id      uuid primary key default gen_random_uuid(),
  identity_id uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  pet_type    text not null check (length(btrim(pet_type)) between 1 and 40),
  created_at  timestamptz not null default now()
);
alter table private.creator_pet enable row level security;
revoke all on private.creator_pet from anon, authenticated;
grant select, insert, update, delete on private.creator_pet to service_role;
-- the single pet already on file becomes the first entry of the list
insert into private.creator_pet(identity_id, name, pet_type)
select p.identity_id, btrim(p.pet_name), btrim(p.pet_type) from private.creator_personal_profile p
 where p.has_pet and coalesce(btrim(p.pet_name),'') <> '' and coalesce(btrim(p.pet_type),'') <> ''
   and not exists (select 1 from private.creator_pet x where x.identity_id = p.identity_id);

create or replace function api.get_my_pets()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  return coalesce((select jsonb_agg(jsonb_build_object('pet_id', pet_id, 'name', name, 'pet_type', pet_type) order by created_at)
    from private.creator_pet where identity_id = intel.ci_caller_identity()), '[]'::jsonb);
end $$;
create or replace function api.add_pet(p_name text, p_type text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); v_id uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  if (select count(*) from private.creator_pet where identity_id = v_identity) >= 15 then raise exception 'up to 15 pets' using errcode = '22023'; end if;
  insert into private.creator_pet(identity_id, name, pet_type) values (v_identity, btrim(p_name), btrim(p_type)) returning pet_id into v_id;
  insert into private.creator_personal_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  update private.creator_personal_profile set has_pet = true,
         pet_name = coalesce(nullif(pet_name,''), btrim(p_name)), pet_type = coalesce(nullif(pet_type,''), btrim(p_type)), updated_at = now()
   where identity_id = v_identity;
  return v_id;
end $$;
create or replace function api.delete_pet(p_pet_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); r record;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  delete from private.creator_pet where pet_id = p_pet_id and identity_id = v_identity;
  select name, pet_type into r from private.creator_pet where identity_id = v_identity order by created_at limit 1;
  update private.creator_personal_profile set pet_name = r.name, pet_type = r.pet_type, updated_at = now() where identity_id = v_identity;
end $$;
revoke all on function api.get_my_pets() from public, anon;
revoke all on function api.add_pet(text, text) from public, anon;
revoke all on function api.delete_pet(uuid) from public, anon;
grant execute on function api.get_my_pets(), api.add_pet(text, text), api.delete_pet(uuid) to authenticated;

-- ===================================================================================================
-- 3) Verified WhatsApp → profile contact; verified backup email (set by the email-otp function only)
-- ===================================================================================================
create or replace function api.sync_my_whatsapp()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); v_wa text; v_at timestamptz;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  select phone_e164, verified_at into v_wa, v_at from public.wa_contacts
   where user_id = auth.uid() and verified_at is not null and opt_out_at is null order by verified_at desc limit 1;
  if v_wa is null then return jsonb_build_object('whatsapp_e164', null); end if;
  insert into private.creator_contact(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  update private.creator_contact set whatsapp_e164 = v_wa, whatsapp_verified_at = coalesce(whatsapp_verified_at, v_at), updated_at = now()
   where identity_id = v_identity and (whatsapp_e164 is distinct from v_wa or whatsapp_verified_at is null);
  return jsonb_build_object('whatsapp_e164', v_wa, 'verified_at', v_at);
end $$;
revoke all on function api.sync_my_whatsapp() from public, anon;
grant execute on function api.sync_my_whatsapp() to authenticated;

create or replace function public.creator_set_verified_backup_email(p_member uuid, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  if v_identity is null then return false; end if;
  insert into private.creator_contact(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  update private.creator_contact set email = lower(p_email), email_verified_at = now(), updated_at = now() where identity_id = v_identity;
  return true;
end $$;
revoke all on function public.creator_set_verified_backup_email(uuid, text) from public, anon, authenticated;
grant execute on function public.creator_set_verified_backup_email(uuid, text) to service_role;

-- ===================================================================================================
-- 4) Travelling now (optional) — brands planning a campaign in that city can see the creator is there
-- ===================================================================================================
create table if not exists intel.ci_creator_travel (
  identity_id uuid primary key references intel.ci_creator_identity(identity_id) on delete cascade,
  city        text, state text, country text, until_date date, updated_at timestamptz not null default now()
);
alter table intel.ci_creator_travel enable row level security;
revoke all on intel.ci_creator_travel from anon, authenticated;
grant select, insert, update, delete on intel.ci_creator_travel to service_role;
create or replace function api.get_my_travel()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  return (select to_jsonb(t) - 'identity_id' from intel.ci_creator_travel t where t.identity_id = intel.ci_caller_identity());
end $$;
create or replace function api.set_my_travel(p_city text, p_state text default null, p_country text default null, p_until date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity();
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  if coalesce(btrim(p_city),'') = '' then delete from intel.ci_creator_travel where identity_id = v_identity; return; end if;
  insert into intel.ci_creator_travel(identity_id, city, state, country, until_date)
  values (v_identity, btrim(p_city), nullif(btrim(p_state),''), nullif(btrim(p_country),''), p_until)
  on conflict (identity_id) do update set city = excluded.city, state = excluded.state, country = excluded.country, until_date = excluded.until_date, updated_at = now();
end $$;
revoke all on function api.get_my_travel() from public, anon;
revoke all on function api.set_my_travel(text, text, text, date) from public, anon;
grant execute on function api.get_my_travel(), api.set_my_travel(text, text, text, date) to authenticated;

-- ===================================================================================================
-- 5) Brands detected from the creator's own Instagram posts (suggestions the creator can remove)
-- ===================================================================================================
create or replace function api.sync_detected_brands(p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); e jsonb; v_name text; v_n int := 0;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  if jsonb_typeof(p_items) <> 'array' then return 0; end if;
  for e in select * from jsonb_array_elements(p_items) limit 40 loop
    v_name := '@' || lower(regexp_replace(coalesce(e->>'handle',''), '^@', ''));
    continue when v_name !~ '^@[a-z0-9._]{2,30}$';
    -- skip anything already listed or previously removed by the creator
    continue when exists (select 1 from intel.ci_creator_brand_experience b where b.identity_id = v_identity and lower(b.submitted_brand_name) = v_name);
    insert into intel.ci_creator_brand_experience(identity_id, submitted_brand_name, relationship_type, compensation_type,
                                                  source_type, verification_status, evidence)
    values (v_identity, v_name, case when (e->>'paid')::boolean then 'paid' else 'organic' end,
            case when (e->>'paid')::boolean then 'paid' else 'organic_mention' end,
            'content_detected_suggestion', 'detected_unconfirmed',
            jsonb_build_object('permalink', e->>'permalink', 'detected_at', now()));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function api.sync_detected_brands(jsonb) from public, anon;
grant execute on function api.sync_detected_brands(jsonb) to authenticated;

-- ===================================================================================================
-- 6) Mandatory checklist: "pet name & type" is met by at least one pet in the list
-- ===================================================================================================
do $$
declare src text;
begin
  select pg_get_functiondef('intel.ci_profile_requirements(uuid)'::regprocedure) into src;
  src := replace(src, $q$ok := coalesce(btrim(per.pet_name),'') <> '' and coalesce(btrim(per.pet_type),'') <> '';$q$,
                      $q$ok := (coalesce(btrim(per.pet_name),'') <> '' and coalesce(btrim(per.pet_type),'') <> '')
          or exists (select 1 from private.creator_pet x where x.identity_id = p_identity);$q$);
  execute src;
end $$;

-- ===================================================================================================
-- 7) Alerts carry the details: which profile, brand, dates; and "campaign started" for confirmed creators
-- ===================================================================================================
create or replace function intel.ci_campaign_vars(p_campaign uuid, p_participation uuid, p_vars jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(p_vars,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'brand', coalesce(nullif(c.submitted_brand_name,''), 'the brand'),
    'starts_on', coalesce(to_char(c.starts_on, 'DD Mon YYYY'), 'soon'),
    'ends_on', coalesce(to_char(c.ends_on, 'DD Mon YYYY'), '—'),
    'product', coalesce(nullif(c.product,''), '—'),
    'profile', coalesce('@' || nullif(p.applied_profile,''), 'your profile')))
  from intel.ci_campaign c left join intel.ci_campaign_participation p on p.participation_id = p_participation
  where c.campaign_id = p_campaign $$;
revoke all on function intel.ci_campaign_vars(uuid, uuid, jsonb) from public, anon, authenticated;

do $$
declare src text;
begin
  select pg_get_functiondef('intel.ci_notify(uuid,uuid,uuid,text,jsonb)'::regprocedure) into src;
  -- enrich the template variables before rendering
  src := replace(src, $q$  select * into t from intel.ci_notification_template where template_key=p_key and active;$q$,
                      $q$  if p_campaign is not null then p_vars := coalesce(intel.ci_campaign_vars(p_campaign, p_participation, p_vars), p_vars); end if;
  select * into t from intel.ci_notification_template where template_key=p_key and active;$q$);
  execute src;
end $$;

update intel.ci_notification_template set
  title = 'Approved for {{campaign}} 🎉',
  body_md = '{{brand}} approved {{profile}} for {{campaign}}. Starts {{starts_on}} · ends {{ends_on}}. Next: review and sign your contract in the app.'
 where template_key = 'brand_confirmed';
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('campaign_started','action_required','{{campaign}} has started 🚀',
   '{{brand}}''s campaign is live from {{starts_on}} (till {{ends_on}}) for {{profile}}. Open My Campaigns for your deliverables and deadlines.','mycampaigns','See deliverables')
on conflict (template_key) do nothing;

create or replace function intel.tg_campaign_started()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if NEW.lifecycle_status = 'in_execution' and OLD.lifecycle_status is distinct from 'in_execution' then
    for r in select participation_id, identity_id from intel.ci_campaign_participation
              where campaign_id = NEW.campaign_id and stage not in ('applied','eligible','sent_to_brand','ineligible','brand_declined','dropped','rejected','shortlisted','invited') loop
      begin
        perform intel.ci_notify(intel.ci_member_of_identity(r.identity_id), NEW.campaign_id, r.participation_id, 'campaign_started',
                                jsonb_build_object('campaign', NEW.name));
      exception when others then raise warning 'campaign_started notify skipped: %', sqlerrm; end;
    end loop;
  end if;
  return NEW;
end $$;
revoke all on function intel.tg_campaign_started() from public, anon, authenticated;
drop trigger if exists ci_campaign_started on intel.ci_campaign;
create trigger ci_campaign_started after update of lifecycle_status on intel.ci_campaign
  for each row execute function intel.tg_campaign_started();

-- ===================================================================================================
-- 8) Super Admin profile view: pets, managed profiles and travel too
-- ===================================================================================================
do $$
declare src text;
begin
  select pg_get_functiondef('public.admin_creator_profile(uuid)'::regprocedure) into src;
  src := replace(src, $q$    'fav_brands',$q$, $q$    'pets', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'pet_type', x.pet_type) order by x.created_at) from private.creator_pet x where x.identity_id = v_identity), '[]'::jsonb),
    'managed_profiles', coalesce((select jsonb_agg(jsonb_build_object('platform', m.platform, 'handle', m.handle, 'followers', m.followers, 'category', m.category) order by m.created_at) from intel.ci_creator_managed_profile m where m.identity_id = v_identity), '[]'::jsonb),
    'travel', (select to_jsonb(t) - 'identity_id' from intel.ci_creator_travel t where t.identity_id = v_identity),
    'fav_brands',$q$);
  execute src;
end $$;
