-- The barter process, end to end, one creator at a time:
--   outreach message → creator registers → Geek screens against the brand's criteria → final list to the brand
--   → brand confirms → contract signed (ASCI, ad rights, collab rights, product, deliverables)
--   → address confirmed → courier sent → courier delivered → video brief → video submitted → changes
--   → client approves → caption + tags → reel posted → story posted → analytics.
-- Every step is timestamped per creator. A campaign's own agency/brand sees only its own creators;
-- the Super Admin sees every workspace. ADDITIVE — the existing stage machine is unchanged.

-- ===================================================================================================
-- 1) The outreach message (what goes to the DB, to stories and to WhatsApp groups)
-- ===================================================================================================
create table if not exists intel.ci_campaign_outreach (
  campaign_id   uuid primary key references intel.ci_campaign(campaign_id) on delete cascade,
  brand_usp     text,
  eligibility   text,
  what_you_get  text,
  deliverables  text,
  sample_link   text,
  form_link     text,
  extra_note    text,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);
alter table intel.ci_campaign_outreach enable row level security;
revoke all on intel.ci_campaign_outreach from anon, authenticated;
grant select, insert, update, delete on intel.ci_campaign_outreach to service_role;

create or replace function api.save_outreach(p_campaign uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  insert into intel.ci_campaign_outreach(campaign_id, brand_usp, eligibility, what_you_get, deliverables, sample_link, form_link, extra_note, updated_by)
  values (v_id, nullif(btrim(p_payload->>'brand_usp'),''), nullif(btrim(p_payload->>'eligibility'),''),
          nullif(btrim(p_payload->>'what_you_get'),''), nullif(btrim(p_payload->>'deliverables'),''),
          nullif(btrim(p_payload->>'sample_link'),''), nullif(btrim(p_payload->>'form_link'),''),
          nullif(btrim(p_payload->>'extra_note'),''), auth.uid())
  on conflict (campaign_id) do update set
    brand_usp = excluded.brand_usp, eligibility = excluded.eligibility, what_you_get = excluded.what_you_get,
    deliverables = excluded.deliverables, sample_link = excluded.sample_link, form_link = excluded.form_link,
    extra_note = excluded.extra_note, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function api.get_outreach(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select to_jsonb(o) - 'updated_by' from intel.ci_campaign_outreach o where o.campaign_id = v_id), '{}'::jsonb)
       || (select jsonb_build_object('campaign', c.name, 'brand', c.submitted_brand_name, 'product', c.product,
                    'starts_on', c.starts_on, 'ends_on', c.ends_on, 'campaign_id', c.campaign_id)
             from intel.ci_campaign c where c.campaign_id = v_id);
end $$;
revoke all on function api.save_outreach(uuid, jsonb) from public, anon;
revoke all on function api.get_outreach(uuid) from public, anon;
grant execute on function api.save_outreach(uuid, jsonb), api.get_outreach(uuid) to authenticated;

-- ===================================================================================================
-- 2) Blacklist — a creator who took the product and never delivered
-- ===================================================================================================
create table if not exists intel.ci_creator_blacklist (
  blacklist_id uuid primary key default gen_random_uuid(),
  identity_id  uuid references intel.ci_creator_identity(identity_id) on delete cascade,
  handle       text,
  reason       text not null,
  campaign_id  uuid references intel.ci_campaign(campaign_id) on delete set null,
  org_id       uuid,
  added_by     uuid references auth.users(id) on delete set null,
  added_at     timestamptz not null default now(),
  lifted_at    timestamptz,
  lifted_by    uuid references auth.users(id) on delete set null
);
create index if not exists ci_blacklist_identity_idx on intel.ci_creator_blacklist(identity_id) where lifted_at is null;
alter table intel.ci_creator_blacklist enable row level security;
revoke all on intel.ci_creator_blacklist from anon, authenticated;
grant select, insert, update, delete on intel.ci_creator_blacklist to service_role;

create or replace function api.blacklist_creator(p_participation uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_identity uuid; v_handle text; v_org uuid; v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select p.campaign_id, p.identity_id into v_camp, v_identity from intel.ci_campaign_participation p where p.participation_id = p_participation;
  if v_camp is null or not intel.ci_can_manage_campaign(v_camp) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'add a reason' using errcode = '22023'; end if;
  select lower(sa.username) into v_handle from intel.ci_identity_actor_access a
    join public.social_accounts sa on sa.member_id = a.member_id and sa.platform = 'instagram'
   where a.identity_id = v_identity and a.access_role = 'self' and a.revoked_at is null limit 1;
  select c.org_id into v_org from intel.ci_campaign c where c.campaign_id = v_camp;
  insert into intel.ci_creator_blacklist(identity_id, handle, reason, campaign_id, org_id, added_by)
  values (v_identity, v_handle, btrim(p_reason), v_camp, v_org, auth.uid()) returning blacklist_id into v_id;
  begin perform intel.ci_participation_advance(p_participation, 'dropped', auth.uid(), 'Blacklisted — ' || btrim(p_reason));
  exception when others then null; end;
  return jsonb_build_object('blacklist_id', v_id);
end $$;

create or replace function api.lift_blacklist(p_blacklist uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from intel.ci_creator_blacklist where blacklist_id = p_blacklist;
  if not (public.is_platform_admin() or exists (select 1 from public.members m where m.id = auth.uid() and m.org_id = v_org and m.role in ('owner','brand','manager'))) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  update intel.ci_creator_blacklist set lifted_at = now(), lifted_by = auth.uid() where blacklist_id = p_blacklist;
end $$;

create or replace function api.list_blacklist()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean := public.is_platform_admin(); v_org uuid;
begin
  select org_id into v_org from public.members where id = auth.uid();
  return coalesce((select jsonb_agg(jsonb_build_object('blacklist_id', b.blacklist_id, 'handle', b.handle,
            'reason', b.reason, 'added_at', b.added_at, 'lifted_at', b.lifted_at,
            'campaign', (select name from intel.ci_campaign c where c.campaign_id = b.campaign_id),
            'creator', intel.ci_public_creator_card(b.identity_id)) order by b.added_at desc)
     from intel.ci_creator_blacklist b where v_admin or b.org_id = v_org), '[]'::jsonb);
end $$;
revoke all on function api.blacklist_creator(uuid, text) from public, anon;
revoke all on function api.lift_blacklist(uuid) from public, anon;
revoke all on function api.list_blacklist() from public, anon;
grant execute on function api.blacklist_creator(uuid, text), api.lift_blacklist(uuid), api.list_blacklist() to authenticated;

-- ===================================================================================================
-- 3) Something went wrong → send this product to the next creator
-- ===================================================================================================
create or replace function api.reassign_product(p_participation uuid, p_to_member uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_ship record; v_new uuid; v_identity uuid; v_name text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select campaign_id into v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_camp is null or not intel.ci_can_manage_campaign(v_camp) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'add a reason' using errcode = '22023'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = p_to_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  if v_identity is null then raise exception 'that creator has not finished signing up yet' using errcode = '22023'; end if;

  -- close the old one
  begin perform intel.ci_participation_advance(p_participation, 'dropped', auth.uid(), 'Product reassigned — ' || btrim(p_reason));
  exception when others then null; end;

  -- open the next one at the same point in the journey and carry the product over
  select participation_id into v_new from intel.ci_campaign_participation where campaign_id = v_camp and identity_id = v_identity;
  if v_new is null then
    insert into intel.ci_campaign_participation(campaign_id, identity_id, stage)
    values (v_camp, v_identity, 'brand_confirmed') returning participation_id into v_new;
  end if;
  select * into v_ship from intel.ci_campaign_shipment where participation_id = p_participation order by created_at desc limit 1;
  if v_ship.participation_id is not null then
    insert into intel.ci_campaign_shipment(participation_id, product, courier, status)
    values (v_new, v_ship.product, v_ship.courier, 'pending');
  end if;
  insert into intel.ci_campaign_deliverable(participation_id, content_format, quantity, expected_by, status)
  select v_new, d.content_format, d.quantity, d.expected_by, 'expected'
    from intel.ci_campaign_deliverable d where d.participation_id = p_participation
     and not exists (select 1 from intel.ci_campaign_deliverable x where x.participation_id = v_new);

  select name into v_name from intel.ci_campaign where campaign_id = v_camp;
  perform intel.ci_notify(p_to_member, v_camp, v_new, 'brand_confirmed', jsonb_build_object('campaign', coalesce(v_name,'a campaign')));
  return jsonb_build_object('participation_id', v_new);
end $$;
revoke all on function api.reassign_product(uuid, uuid, text) from public, anon;
grant execute on function api.reassign_product(uuid, uuid, text) to authenticated;

-- ===================================================================================================
-- 4) The tracker: one row per creator, every step of the barter process with its timestamp
-- ===================================================================================================
create or replace function api.barter_tracker(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;

  return jsonb_build_object(
    'campaign', (select jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'brand', c.submitted_brand_name,
                   'product', c.product, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'status', c.lifecycle_status)
                   from intel.ci_campaign c where c.campaign_id = v_id),
    'outreach_at', (select updated_at from intel.ci_campaign_outreach o where o.campaign_id = v_id),
    'creators', coalesce((select jsonb_agg(row order by (row->>'applied_at')) from (
      select jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage, 'reason', p.reason,
        'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'updated_at', p.updated_at,
        'creator', intel.ci_public_creator_card(p.identity_id),
        'member_id', intel.ci_member_of_identity(p.identity_id),
        'blacklisted', exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = p.identity_id and b.lifted_at is null),
        'contract', (select jsonb_build_object('issued_at', k.issued_at, 'signed_at', k.signed_at, 'asci_ack', k.asci_ack,
                       'ad_rights_months', k.ad_rights_months, 'collab_rights', k.collab_rights,
                       'deliverables', k.deliverables)
                       from intel.ci_campaign_contract k where k.participation_id = p.participation_id),
        'shipment', (select jsonb_build_object('status', s.status, 'courier', s.courier, 'tracking_ref', s.tracking_ref,
                       'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at)
                       from intel.ci_campaign_shipment s where s.participation_id = p.participation_id order by s.created_at desc limit 1),
        'deliverables', coalesce((select jsonb_agg(jsonb_build_object('deliverable_id', d.deliverable_id, 'format', d.content_format,
                           'quantity', d.quantity, 'expected_by', d.expected_by, 'status', d.status,
                           'permalink', m.permalink, 'posted_at', m.media_timestamp,
                           'metrics', coalesce((select jsonb_object_agg(i.metric_name, i.value_count) from (
                                 select distinct on (x.metric_name) x.metric_name, x.value_count
                                   from intel.ci_media_insights x
                                  where x.media_row_id = d.media_row_id and x.status = 'available' and x.value_count is not null
                                  order by x.metric_name, x.captured_at desc) i), '{}'::jsonb)) order by d.created_at)
                         from intel.ci_campaign_deliverable d
                         left join intel.ci_media m on m.media_row_id = d.media_row_id
                        where d.participation_id = p.participation_id), '[]'::jsonb),
        -- when each step actually happened (from the append-only ledger)
        'steps', (select coalesce(jsonb_object_agg(e.to_status, e.at), '{}'::jsonb) from (
                    select distinct on (ev.to_status) ev.to_status, ev.at from intel.ci_campaign_event ev
                     where ev.participation_id = p.participation_id and ev.entity = 'participation'
                     order by ev.to_status, ev.at) e)) row
        from intel.ci_campaign_participation p
       where p.campaign_id = v_id) s), '[]'::jsonb));
end $$;
revoke all on function api.barter_tracker(uuid) from public, anon;
grant execute on function api.barter_tracker(uuid) to authenticated;

-- the final list the brand signs off on (what the Excel export is built from)
create or replace function api.brand_shortlist(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id, 'stage', p.stage, 'applied_profile', p.applied_profile,
      'creator', intel.ci_public_creator_card(p.identity_id),
      'city', (select a.city from private.creator_address a where a.identity_id = p.identity_id and a.deleted_at is null
                order by a.is_default desc, a.created_at limit 1),
      'categories', (select to_jsonb(pr.categories) from intel.ci_creator_professional_profile pr where pr.identity_id = p.identity_id),
      'reel_rate', (select min(i.amount) from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                     where rc.identity_id = p.identity_id and rc.status = 'active' and i.deliverable_type ilike '%reel%' and i.amount > 0),
      'applied_at', p.created_at) order by p.created_at)
    from intel.ci_campaign_participation p
   where p.campaign_id = v_id and p.stage in ('eligible','sent_to_brand','brand_confirmed')), '[]'::jsonb);
end $$;
revoke all on function api.brand_shortlist(uuid) from public, anon;
grant execute on function api.brand_shortlist(uuid) to authenticated;
