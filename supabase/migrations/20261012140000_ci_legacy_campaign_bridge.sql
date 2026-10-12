-- Bridge: admin-panel campaigns (public.campaigns) → barter pipeline (intel.ci_campaign). ADDITIVE.
-- Before this, campaigns created in the admin panel never reached the pipeline, so pilot creators saw nothing
-- under "Open campaigns". Every insert/update of a legacy campaign now upserts its pipeline twin (soft link via
-- the existing legacy_campaign_id column) + the creator-facing brief. The legacy app keeps working exactly as
-- before: the trigger never raises (failures become a WARNING), and nothing in public.* is written.
--
-- Status mapping (only applied on insert or when the LEGACY status changes, so an operator's progress in the
-- pipeline is never regressed by an unrelated admin-panel edit):
--   Draft, Approval      → draft              (not visible to creators)
--   Sourcing, Live       → creator_discovery  (open for applications)
--   In Production        → in_execution       (still open for applications)
--   Completed            → completed

create unique index if not exists ci_campaign_legacy_uq
  on intel.ci_campaign(legacy_campaign_id) where legacy_campaign_id is not null;

create or replace function intel.ci_legacy_lifecycle(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case lower(coalesce(p_status, ''))
    when 'sourcing' then 'creator_discovery'
    when 'live' then 'creator_discovery'
    when 'in production' then 'in_execution'
    when 'completed' then 'completed'
    else 'draft' end $$;

create or replace function intel.ci_legacy_comp_type(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_type ilike '%hybrid%' then 'hybrid'
    when p_type ilike '%paid%' or p_type ilike '%celebrity%' then 'cash'
    when p_type ilike '%barter%' or p_type ilike '%seeding%' then 'barter'
    else null end $$;

-- "#a, #b  @c" → ["#a","#b"] / ["c"]
create or replace function intel.ci_legacy_tags(p_text text, p_prefix text)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(distinct t), '[]'::jsonb) from (
    select case when p_prefix = '#' then tok else ltrim(tok, '@') end as t
    from regexp_split_to_table(coalesce(p_text, ''), '[\s,;]+') tok
    where tok <> '' and left(tok, 1) = p_prefix) s $$;

create or replace function intel.ci_sync_legacy_campaign(p_legacy uuid, p_status_changed boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c record; v_id uuid; v_creator uuid; v_life text; v_req jsonb; v_prev jsonb;
begin
  execute 'select id, org_id, org_name, name, brand, type, status, objective, platforms, deliverables, brief,
                  hashtags, start_date, end_date from public.campaigns where id = $1' into c using p_legacy;
  if c.id is null then return null; end if;

  -- owner of the pipeline row: the admin making the change, else an owner/any member of the campaign's org
  v_creator := auth.uid();
  if v_creator is null or not exists (select 1 from auth.users where id = v_creator) then
    execute 'select id from public.members where org_id = $1 order by (role = ''owner'') desc, created_at limit 1'
      into v_creator using c.org_id;
  end if;
  if v_creator is null then return null; end if;

  v_life := intel.ci_legacy_lifecycle(c.status);
  select campaign_id into v_id from intel.ci_campaign where legacy_campaign_id = c.id;

  if v_id is null then
    insert into intel.ci_campaign(legacy_campaign_id, org_id, created_by, name, submitted_brand_name, category,
                                  comp_type, starts_on, ends_on, lifecycle_status)
    values (c.id, c.org_id, v_creator, coalesce(nullif(c.name, ''), 'Campaign'),
            coalesce(nullif(c.brand, ''), nullif(c.org_name, ''), nullif(c.name, ''), 'Brand'),
            nullif(c.type, ''), intel.ci_legacy_comp_type(c.type),
            c.start_date, case when c.end_date >= c.start_date or c.start_date is null then c.end_date end, v_life)
    returning campaign_id into v_id;
  else
    update intel.ci_campaign set
      name = coalesce(nullif(c.name, ''), name),
      submitted_brand_name = coalesce(nullif(c.brand, ''), submitted_brand_name),
      category = coalesce(nullif(c.type, ''), category),
      comp_type = coalesce(intel.ci_legacy_comp_type(c.type), comp_type),
      starts_on = c.start_date,
      ends_on = case when c.end_date >= c.start_date or c.start_date is null then c.end_date end,
      lifecycle_status = case when p_status_changed then v_life else lifecycle_status end
    where campaign_id = v_id;
  end if;

  -- creator-facing brief (only what the legacy marketplace already showed every creator; never budget)
  v_req := jsonb_strip_nulls(jsonb_build_object(
    'hashtags', intel.ci_legacy_tags(c.hashtags, '#'),
    'mentions', intel.ci_legacy_tags(c.hashtags, '@'),
    'brief', nullif(c.brief, ''), 'deliverables_text', nullif(c.deliverables, ''),
    'platforms', nullif(c.platforms, ''), 'objective_text', nullif(c.objective, ''),
    'source', 'admin_panel'));
  select requirements into v_prev from intel.ci_campaign_brief where campaign_id = v_id order by created_at desc limit 1;
  if v_prev is distinct from v_req then
    insert into intel.ci_campaign_brief(campaign_id, requirements) values (v_id, v_req);
  end if;
  return v_id;
end $$;
revoke all on function intel.ci_sync_legacy_campaign(uuid, boolean) from public, anon, authenticated;
grant execute on function intel.ci_sync_legacy_campaign(uuid, boolean) to service_role;

create or replace function public.tg_campaign_to_pipeline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform intel.ci_sync_legacy_campaign(new.id,
      tg_op = 'INSERT' or new.status is distinct from old.status);
  exception when others then
    raise warning 'campaign pipeline sync skipped for %: %', new.id, sqlerrm;   -- never break the admin panel
  end;
  return new;
end $$;
revoke all on function public.tg_campaign_to_pipeline() from public, anon, authenticated;

drop trigger if exists campaign_to_pipeline on public.campaigns;
create trigger campaign_to_pipeline after insert or update on public.campaigns
  for each row execute function public.tg_campaign_to_pipeline();

-- if the admin deletes a legacy campaign, close its pipeline twin (keep history; never hard-delete)
create or replace function public.tg_campaign_delete_to_pipeline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    update intel.ci_campaign set lifecycle_status = 'cancelled'
     where legacy_campaign_id = old.id and lifecycle_status not in ('completed', 'cancelled');
  exception when others then raise warning 'campaign pipeline cancel skipped for %: %', old.id, sqlerrm; end;
  return old;
end $$;
revoke all on function public.tg_campaign_delete_to_pipeline() from public, anon, authenticated;
drop trigger if exists campaign_delete_to_pipeline on public.campaigns;
create trigger campaign_delete_to_pipeline after delete on public.campaigns
  for each row execute function public.tg_campaign_delete_to_pipeline();

-- backfill every existing admin-panel campaign
do $$ declare r record; begin
  for r in execute 'select id from public.campaigns' loop
    begin perform intel.ci_sync_legacy_campaign(r.id, true);
    exception when others then raise warning 'backfill skipped %: %', r.id, sqlerrm; end;
  end loop;
end $$;

-- creators also see the brief text / deliverables / platforms the admin wrote (never budget or contacts)
create or replace function api.list_open_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null
   order by a.granted_at limit 1;

  return coalesce((select jsonb_agg(jsonb_build_object(
      'campaign_id', c.campaign_id, 'name', c.name, 'brand', coalesce(b.name, c.submitted_brand_name),
      'product', c.product, 'category', c.category, 'comp_type', c.comp_type,
      'cities', coalesce(to_jsonb(c.cities), '[]'::jsonb), 'languages', coalesce(to_jsonb(c.languages), '[]'::jsonb),
      'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb),
      'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'brief', br.requirements->>'brief', 'deliverables_text', br.requirements->>'deliverables_text',
      'platforms', br.requirements->>'platforms',
      'my_stage', p.stage, 'my_participation_id', p.participation_id)
      order by c.created_at desc)
    from intel.ci_campaign c
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x
                        where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    left join intel.ci_campaign_participation p
           on p.campaign_id = c.campaign_id and v_identity is not null and p.identity_id = v_identity
    where c.lifecycle_status in ('creator_discovery', 'in_execution')
      and (c.ends_on is null or c.ends_on >= current_date)), '[]'::jsonb);
end $$;
revoke all on function api.list_open_campaigns() from public, anon;
grant execute on function api.list_open_campaigns() to authenticated, service_role;
