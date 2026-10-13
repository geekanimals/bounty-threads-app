-- Creator "My Campaigns" becomes the full live record of every campaign the creator is in:
-- complete brief, deliverables with live Instagram numbers, shipment tracking, and — when an application is
-- declined — the reason the brand gave. Plus a pet birth date (age is derived, never stored). ADDITIVE.

-- ---------------------------------------------------------------------------------------------------
-- 1) Pets: birth date in, age out (same rule as the creator's own DOB — stored once, age calculated)
-- ---------------------------------------------------------------------------------------------------
alter table private.creator_pet add column if not exists birth_date date;

create or replace function api.get_my_pets()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  return coalesce((select jsonb_agg(jsonb_build_object('pet_id', pet_id, 'name', name, 'pet_type', pet_type,
            'birth_date', birth_date,
            'age_months', case when birth_date is not null then
              (extract(year from age(current_date, birth_date)) * 12 + extract(month from age(current_date, birth_date)))::int end) order by created_at)
    from private.creator_pet where identity_id = intel.ci_caller_identity()), '[]'::jsonb);
end $$;

create or replace function api.add_pet(p_name text, p_type text, p_birth_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); v_id uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  if (select count(*) from private.creator_pet where identity_id = v_identity) >= 15 then raise exception 'up to 15 pets' using errcode = '22023'; end if;
  if p_birth_date is not null and (p_birth_date > current_date or p_birth_date < current_date - interval '60 years') then
    raise exception 'enter a valid birth date' using errcode = '22023'; end if;
  insert into private.creator_pet(identity_id, name, pet_type, birth_date)
  values (v_identity, btrim(p_name), btrim(p_type), p_birth_date) returning pet_id into v_id;
  insert into private.creator_personal_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  update private.creator_personal_profile set has_pet = true,
         pet_name = coalesce(nullif(pet_name,''), btrim(p_name)), pet_type = coalesce(nullif(pet_type,''), btrim(p_type)), updated_at = now()
   where identity_id = v_identity;
  return v_id;
end $$;
revoke all on function api.get_my_pets() from public, anon;
revoke all on function api.add_pet(text, text, date) from public, anon;
grant execute on function api.get_my_pets(), api.add_pet(text, text, date) to authenticated;

-- Super Admin sees the pet's birth date too
do $$
declare src text;
begin
  select pg_get_functiondef('public.admin_creator_profile(uuid)'::regprocedure) into src;
  src := replace(src, $q$jsonb_build_object('name', x.name, 'pet_type', x.pet_type) order by x.created_at$q$,
                      $q$jsonb_build_object('name', x.name, 'pet_type', x.pet_type, 'birth_date', x.birth_date) order by x.created_at$q$);
  execute src;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2) A declined creator is told why, in the alert itself (the brand's reason + note)
-- ---------------------------------------------------------------------------------------------------
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('not_selected','info','Update on {{campaign}}',
   'Thanks for applying to {{campaign}}. The brand has gone with other creators this time.{{reason_line}} Keep your profile updated — new campaigns open every week.',
   'mycampaigns','See open campaigns')
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md;

create or replace function intel.tg_notify_creator_not_selected()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_infl uuid; v_name text; v_reason text;
begin
  if NEW.entity <> 'participation' or NEW.to_status not in ('ineligible','brand_declined','dropped') then return null; end if;
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;
  select identity_id, reason into v_identity, v_reason from intel.ci_campaign_participation where participation_id = NEW.participation_id;
  v_infl := intel.ci_member_of_identity(v_identity);
  select name into v_name from intel.ci_campaign where campaign_id = NEW.campaign_id;
  v_reason := coalesce(nullif(btrim(coalesce(NEW.reason, v_reason)), ''), '');
  perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'not_selected',
                          jsonb_build_object('campaign', coalesce(v_name,'the campaign'),
                                             'reason_line', case when v_reason = '' then '' else ' Reason: ' || v_reason || '.' end));
  return null;
exception when others then
  raise warning 'not_selected notify skipped: %', sqlerrm;   -- never block a decision on a notification
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3) My Campaigns: the whole live record — brief, deliverables + live Instagram numbers, shipment, reason
-- ---------------------------------------------------------------------------------------------------
create or replace function api.get_my_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name), 'product', c.product, 'comp_type', c.comp_type,
      'category', c.category, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'lifecycle_status', c.lifecycle_status,
      'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
      'cities', coalesce(to_jsonb(c.cities), '[]'::jsonb), 'languages', coalesce(to_jsonb(c.languages), '[]'::jsonb),
      'brief', br.requirements->>'brief', 'deliverables_text', br.requirements->>'deliverables_text',
      'platforms', br.requirements->>'platforms', 'campaign_type', br.requirements->>'campaign_type',
      'barter_subtype', br.requirements->>'barter_subtype', 'product_link', br.requirements->>'product_link',
      'product_value', br.requirements->'product_value',
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb), 'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'attachments', coalesce(br.requirements->'attachments', '[]'::jsonb),
      'stage', p.stage, 'reason', p.reason, 'reason_code', p.reason_code,
      'reason_label', (select v.label from public.rejection_reason_vocab v where v.code = p.reason_code),
      'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'updated_at', p.updated_at,
      'deadline', (select min(expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
      'shipment', (select jsonb_build_object('status', s.status, 'product', s.product, 'courier', s.courier,
                     'tracking_ref', s.tracking_ref, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at)
                     from intel.ci_campaign_shipment s where s.participation_id = p.participation_id
                    order by s.created_at desc limit 1),
      'deliverables', coalesce((select jsonb_agg(jsonb_build_object(
            'deliverable_id', d.deliverable_id, 'format', d.content_format, 'quantity', d.quantity,
            'expected_by', d.expected_by, 'status', d.status,
            'permalink', m.permalink, 'media_type', m.media_type, 'posted_at', m.media_timestamp,
            'metrics', coalesce((select jsonb_object_agg(i.metric_name, i.value_count) from (
                  select distinct on (x.metric_name) x.metric_name, x.value_count
                    from intel.ci_media_insights x
                   where x.media_row_id = d.media_row_id and x.status = 'available' and x.value_count is not null
                   order by x.metric_name, x.captured_at desc) i), '{}'::jsonb)) order by d.created_at)
          from intel.ci_campaign_deliverable d
          left join intel.ci_media m on m.media_row_id = d.media_row_id
         where d.participation_id = p.participation_id), '[]'::jsonb))
      order by p.updated_at desc)
    from intel.ci_campaign_participation p
    join intel.ci_campaign c on c.campaign_id = p.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    where p.identity_id = v_id), '[]'::jsonb);
end $$;
revoke all on function api.get_my_campaigns() from public, anon;
grant execute on function api.get_my_campaigns() to authenticated;
revoke all on function intel.tg_notify_creator_not_selected() from public, anon, authenticated;
drop trigger if exists ci_event_notify_not_selected on intel.ci_campaign_event;
create trigger ci_event_notify_not_selected after insert on intel.ci_campaign_event
  for each row execute function intel.tg_notify_creator_not_selected();

-- "Painting" was added as a free-text resource before the list existed; it belongs in Skills
-- (Draw / Paint / Doodle), so it is removed from every creator's resources.
delete from intel.ci_creator_resource where resource_key ~* '^\s*paint(ing)?\s*$';
