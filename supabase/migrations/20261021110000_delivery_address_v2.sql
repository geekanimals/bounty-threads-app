-- Delivery address, like Amazon's: full name + mobile for the courier, PIN code, flat / house, area / street, landmark,
-- town / city and state — all required — plus optional delivery instructions, and the point on the map the creator
-- confirmed. The form fills city + state from the PIN, suggests the area / landmark, and checks the address on the map
-- before saving (edge function geo-lookup). The database checks every saved address again (format, the state is a real
-- Indian state/UT, 6-digit PIN, 10-digit mobile). Older addresses keep working; when one is picked for a campaign
-- the creator is asked to complete it first, so the courier always gets everything.
-- ADDITIVE: new columns; upsert_address / confirm_campaign_address / barter_tracker redefined with the same signatures.

alter table private.creator_address add column if not exists recipient_name  text;
alter table private.creator_address add column if not exists recipient_phone text;
alter table private.creator_address add column if not exists lat numeric(9,6);
alter table private.creator_address add column if not exists lng numeric(9,6);
alter table private.creator_address add column if not exists geo_verified_at timestamptz;   -- found on the map + confirmed by the creator

create or replace function intel.ci_india_state(p text)
returns text language sql immutable set search_path = '' as $$
  select s from unnest(array['Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh',
    'Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand',
    'Karnataka','Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha',
    'Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal']) s
   where lower(s) = lower(replace(btrim(coalesce(case lower(btrim(p)) when 'orissa' then 'Odisha' when 'pondicherry' then 'Puducherry'
            when 'uttaranchal' then 'Uttarakhand' when 'nct of delhi' then 'Delhi' when 'new delhi' then 'Delhi' else p end, '')), '&', 'and'))
   limit 1 $$;

-- a complete address = everything the courier needs
create or replace function intel.ci_address_complete(a private.creator_address)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(btrim(a.recipient_name),'') <> '' and coalesce(a.recipient_phone,'') ~ '^\+91[6-9][0-9]{9}$'
     and coalesce(btrim(a.line1),'') <> '' and coalesce(btrim(a.line2),'') <> '' and coalesce(btrim(a.landmark),'') <> ''
     and coalesce(btrim(a.city),'') <> '' and intel.ci_india_state(a.state) is not null and coalesce(a.postal_code,'') ~ '^[1-9][0-9]{5}$' $$;

create or replace function api.upsert_address(p_payload jsonb, p_correlation text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_id uuid; v_default boolean; v_full boolean; v_phone text; v_state text; v_miss text[] := '{}';
        g text := coalesce(p_payload->>'recipient_name',''); v_geo boolean := coalesce((p_payload->>'map_verified')::boolean, false);
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  perform intel.ci_reject_unknown_keys(p_payload, array[
    'address_id','line1','line2','landmark','city','state','postal_code','country',
    'delivery_instructions','label','is_default','recipient_name','recipient_phone','lat','lng','map_verified']);
  v_default := coalesce((p_payload->>'is_default')::boolean, false);
  -- saving the address itself (not only "make default"): every field, checked
  v_full := p_payload ?| array['line1','line2','landmark','city','state','postal_code','recipient_name','recipient_phone'];
  if v_full then
    v_phone := regexp_replace(coalesce(p_payload->>'recipient_phone',''), '\D', '', 'g');
    if length(v_phone) = 12 and left(v_phone, 2) = '91' then v_phone := substr(v_phone, 3); end if;
    if length(v_phone) = 11 and left(v_phone, 1) = '0' then v_phone := substr(v_phone, 2); end if;
    v_state := intel.ci_india_state(p_payload->>'state');
    if array_length(regexp_split_to_array(btrim(g), '\s+'), 1) < 2 or btrim(g) = '' then v_miss := array_append(v_miss, 'full name (first and last)'); end if;
    if v_phone !~ '^[6-9][0-9]{9}$' then v_miss := array_append(v_miss, 'a 10-digit mobile number'); end if;
    if coalesce(p_payload->>'postal_code','') !~ '^[1-9][0-9]{5}$' then v_miss := array_append(v_miss, 'a 6-digit PIN code'); end if;
    if length(btrim(coalesce(p_payload->>'line1',''))) < 2 then v_miss := array_append(v_miss, 'flat / house no.'); end if;
    if length(btrim(coalesce(p_payload->>'line2',''))) < 3 then v_miss := array_append(v_miss, 'area / street'); end if;
    if length(btrim(coalesce(p_payload->>'landmark',''))) < 3 then v_miss := array_append(v_miss, 'landmark'); end if;
    if length(btrim(coalesce(p_payload->>'city',''))) < 2 then v_miss := array_append(v_miss, 'town / city'); end if;
    if v_state is null then v_miss := array_append(v_miss, 'state'); end if;
    if cardinality(v_miss) > 0 then raise exception 'Please add %', array_to_string(v_miss, ', ') using errcode = '22023'; end if;
    p_payload := p_payload || jsonb_build_object('recipient_phone', '+91' || v_phone, 'state', v_state, 'country', 'India',
      'recipient_name', left(btrim(g), 80), 'line1', left(btrim(p_payload->>'line1'), 120), 'line2', left(btrim(p_payload->>'line2'), 160),
      'landmark', left(btrim(p_payload->>'landmark'), 120), 'city', left(btrim(p_payload->>'city'), 80));
  end if;
  if v_default then
    update private.creator_address set is_default = false
      where identity_id = v_identity and is_default = true and deleted_at is null;
  end if;
  if p_payload ? 'address_id' then
    v_id := (p_payload->>'address_id')::uuid;
    update private.creator_address set
      line1 = case when p_payload ? 'line1' then p_payload->>'line1' else line1 end,
      line2 = case when p_payload ? 'line2' then p_payload->>'line2' else line2 end,
      landmark = case when p_payload ? 'landmark' then p_payload->>'landmark' else landmark end,
      city = case when p_payload ? 'city' then p_payload->>'city' else city end,
      state = case when p_payload ? 'state' then p_payload->>'state' else state end,
      postal_code = case when p_payload ? 'postal_code' then p_payload->>'postal_code' else postal_code end,
      country = case when p_payload ? 'country' then p_payload->>'country' else country end,
      delivery_instructions = case when p_payload ? 'delivery_instructions' then nullif(left(btrim(coalesce(p_payload->>'delivery_instructions','')), 300), '') else delivery_instructions end,
      label = case when p_payload ? 'label' then p_payload->>'label' else label end,
      recipient_name = case when p_payload ? 'recipient_name' then p_payload->>'recipient_name' else recipient_name end,
      recipient_phone = case when p_payload ? 'recipient_phone' then p_payload->>'recipient_phone' else recipient_phone end,
      lat = case when v_full then nullif(p_payload->>'lat','')::numeric else lat end,
      lng = case when v_full then nullif(p_payload->>'lng','')::numeric else lng end,
      geo_verified_at = case when v_full then case when v_geo then now() end else geo_verified_at end,
      is_default = case when p_payload ? 'is_default' then v_default else is_default end,
      updated_at = now()
    where address_id = v_id and identity_id = v_identity and deleted_at is null;
    if not found then raise exception 'address not found or not owned' using errcode = '42501'; end if;
    perform intel.ci_write_audit(v_identity, 'creator_address', v_id, 'address', 'changed', p_correlation);
  else
    if not v_full then raise exception 'Please fill in the address' using errcode = '22023'; end if;
    insert into private.creator_address(identity_id, line1, line2, landmark, city, state, postal_code, country,
      delivery_instructions, label, is_default, recipient_name, recipient_phone, lat, lng, geo_verified_at)
    values (v_identity, p_payload->>'line1', p_payload->>'line2', p_payload->>'landmark', p_payload->>'city',
      p_payload->>'state', p_payload->>'postal_code', 'India', nullif(left(btrim(coalesce(p_payload->>'delivery_instructions','')), 300), ''),
      p_payload->>'label', v_default, p_payload->>'recipient_name', p_payload->>'recipient_phone',
      nullif(p_payload->>'lat','')::numeric, nullif(p_payload->>'lng','')::numeric, case when v_geo then now() end)
    returning address_id into v_id;
    perform intel.ci_write_audit(v_identity, 'creator_address', v_id, 'address', 'created', p_correlation);
  end if;
  return v_id;
end $$;

-- shipping to an address that misses details → the creator completes it first
create or replace function api.confirm_campaign_address(p_participation uuid, p_address_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_owner uuid; a private.creator_address%rowtype;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your participation' using errcode='42501'; end if;
  select * into a from private.creator_address where address_id=p_address_id and identity_id=v_id and deleted_at is null;
  if a.address_id is null then raise exception 'address not found or not yours' using errcode='42501'; end if;
  if not intel.ci_address_complete(a) then
    raise exception 'This address needs a few more details for the courier (name, mobile, area, landmark) — edit it and save.' using errcode = '22023'; end if;
  update intel.ci_campaign_participation set shipping_address_id=p_address_id where participation_id=p_participation;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (intel.ci_campaign_of_participation(p_participation), p_participation, 'address', null, 'confirmed', v_uid, null);
  perform intel.ci_participation_advance(p_participation, 'address_confirmed', v_uid, 'address confirmed');
  return jsonb_build_object('stage', 'address_confirmed');
end $$;

-- the team sees the courier name + mobile, instructions and the map point of the address
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
    'playbook', intel.ci_playbook(v_id),
    'creators', coalesce((select jsonb_agg(row order by (row->>'applied_at')) from (
      select jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage, 'reason', p.reason,
        'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'updated_at', p.updated_at,
        'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
        'member_id', intel.ci_member_of_identity(p.identity_id),
        'blacklisted', exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = p.identity_id and b.lifted_at is null),
        'blocked_at', p.blocked_at, 'block_reason', p.block_reason, 'call_note', p.call_note, 'call_at', p.call_at,
        'feedback_requested_at', p.feedback_requested_at, 'feedback_at', p.feedback_at, 'feedback', p.feedback,
        'phone', case when p.blocked_at is not null or p.stage in ('address_confirmed','product_sent','content_created','changes_requested')
                      then (select w.phone_e164 from public.wa_contacts w where w.user_id = intel.ci_member_of_identity(p.identity_id) and w.verified_at is not null limit 1) end,
        'reminders_sent', (select count(*) from intel.ci_reminder r where r.participation_id = p.participation_id and r.fired_at is not null and r.kind like 'video%'),
        'next_reminder', (select min(r.due_at) from intel.ci_reminder r where r.participation_id = p.participation_id and r.fired_at is null and r.cancelled_at is null),
        'has_address', p.shipping_address_id is not null,
        'ship_to', (select jsonb_build_object('name', coalesce(nullif(btrim(a.recipient_name),''), nullif(btrim(m.name),''), sa.name), 'line1', a.line1, 'line2', a.line2,
                       'landmark', a.landmark, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code,
                       'instructions', a.delivery_instructions, 'lat', a.lat, 'lng', a.lng, 'map_verified', a.geo_verified_at is not null,
                       'phone', coalesce(nullif(a.recipient_phone,''), (select w.phone_e164 from public.wa_contacts w where w.user_id = a2.member_id and w.verified_at is not null limit 1)))
                      from private.creator_address a
                      join intel.ci_identity_actor_access a2 on a2.identity_id = a.identity_id and a2.access_role = 'self' and a2.revoked_at is null
                      left join public.members m on m.id = a2.member_id
                      left join public.social_accounts sa on sa.member_id = a2.member_id and sa.platform = 'instagram'
                     where a.address_id = p.shipping_address_id and p.stage in ('address_confirmed','product_sent','content_created')
                     limit 1),
        'contract', (select jsonb_build_object('issued_at', k.issued_at, 'signed_at', k.signed_at, 'asci_ack', k.asci_ack, 'terms_ack', k.terms_ack,
                       'ad_rights_months', k.ad_rights_months, 'collab_rights', k.collab_rights, 'product', k.product,
                       'deliverables', k.deliverables, 'content_days', k.content_days, 'clauses', k.clauses, 'signature_name', k.signature_name)
                       from intel.ci_campaign_contract k where k.participation_id = p.participation_id),
        'shipment', (select jsonb_build_object('status', s.status, 'courier', s.courier, 'tracking_ref', s.tracking_ref, 'tracking_url', s.tracking_url,
                       'product', s.product, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at)
                       from intel.ci_campaign_shipment s where s.participation_id = p.participation_id order by s.created_at desc limit 1),
        'due_on', (select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
        'submission', (select jsonb_build_object('url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at,
                         'rounds', (select count(*) from intel.ci_campaign_submission s2 join intel.ci_campaign_deliverable d2 on d2.deliverable_id = s2.deliverable_id
                                     where d2.participation_id = p.participation_id))
                         from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                        where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
        'review', (select jsonb_build_object('decision', ap.decision, 'reason', ap.reason, 'at', ap.decided_at)
                     from intel.ci_campaign_approval ap join intel.ci_campaign_submission s on s.submission_id = ap.submission_id
                     join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                    where d.participation_id = p.participation_id order by ap.decided_at desc limit 1),
        'posts', intel.ci_participation_posts(p.participation_id),
        'deliverables', coalesce((select jsonb_agg(jsonb_build_object('deliverable_id', d.deliverable_id, 'format', d.content_format,
                           'quantity', d.quantity, 'expected_by', d.expected_by, 'status', d.status) order by d.created_at)
                         from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id), '[]'::jsonb),
        'steps', (select coalesce(jsonb_object_agg(e.to_status, e.at), '{}'::jsonb) from (
                    select distinct on (ev.to_status) ev.to_status, ev.at from intel.ci_campaign_event ev
                     where ev.participation_id = p.participation_id and ev.entity = 'participation'
                     order by ev.to_status, ev.at) e)) row
        from intel.ci_campaign_participation p
       where p.campaign_id = v_id) s), '[]'::jsonb));
end $$;
