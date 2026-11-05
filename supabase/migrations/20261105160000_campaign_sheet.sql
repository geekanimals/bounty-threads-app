-- 📄 Campaign sheet: every creator of a campaign as rows in the SAME format as the bulk upload
-- (Name · Instagram · WhatsApp · Email · City · Status · Address · State · PIN code · Courier · Tracking · Video link · Post link),
-- so a downloaded sheet can be uploaded again as it is. The same rows feed a linked Google Sheet (a small script in the
-- sheet pulls them with the campaign's secret link: fills what's missing — address, courier, video, posts — moves the
-- Status forward and adds new creators; nothing the team typed is overwritten).
create or replace function intel.ci_sheet_status_label(k text)
returns text language sql immutable set search_path = '' as $$
  select case k when 'registered' then 'Applied' when 'screened' then 'Screened' when 'sent_to_brand' then 'Sent to brand'
    when 'approved' then 'Approved' when 'contract_sent' then 'Contract sent' when 'contract_signed' then 'Contract signed'
    when 'address_confirmed' then 'Address confirmed' when 'courier_sent' then 'Courier sent' when 'courier_delivered' then 'Courier delivered'
    when 'video_brief_sent' then 'Video brief sent' when 'video_submitted' then 'Video submitted' when 'client_approved' then 'Client approved'
    when 'posted' then 'Posted / Done' else coalesce(k, 'Applied') end $$;

create or replace function intel.ci_campaign_sheet_rows(p_campaign uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r order by r->>'rank' desc, r->>'instagram'), '[]'::jsonb) from (
    -- in the campaign
    select jsonb_build_object('key', 'p:' || p.participation_id, 'rank', lpad(coalesce(st.k_rank, 0)::text, 2, '0'),
      'name', coalesce(nullif(btrim(m.name), ''), card->>'name', inv.full_name),
      'instagram', coalesce(card->>'username', p.applied_profile, inv.handle),
      'whatsapp', coalesce(intel.ci_member_phone(mid.mid), inv.phone_e164),
      'email', coalesce(case when m.email !~* '@creators\.bountythreads\.app$' then nullif(m.email, '') end, inv.email),
      'city', coalesce(ad.city, inv.city, card->>'city'),
      'status_key', st.k, 'status', case when st.out then 'Out — ' || replace(p.stage, '_', ' ') else intel.ci_sheet_status_label(st.k) end,
      'address', coalesce(nullif(concat_ws(', ', nullif(btrim(ad.line1), ''), nullif(btrim(ad.line2), ''), nullif(btrim(ad.landmark), ''), nullif(btrim(ad.city), '')), ''),
                          nullif(concat_ws(', ', nullif(btrim(inv.ship_address->>'line1'), ''), nullif(btrim(inv.ship_address->>'line2'), ''), nullif(btrim(inv.ship_address->>'city'), '')), '')),
      'state', coalesce(ad.state, inv.ship_address->>'state'), 'pincode', coalesce(ad.postal_code, inv.ship_address->>'postal_code'),
      'courier', coalesce(sh.courier, inv.courier), 'tracking', coalesce(sh.tracking_ref, sh.tracking_url, inv.tracking_ref, inv.tracking_url),
      'video_link', coalesce((select s.content_url from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                               where d.participation_id = p.participation_id order by s.submitted_at desc limit 1), inv.video_url),
      'post_link', coalesce(nullif((select string_agg(cp.permalink, ' ' order by cp.posted_at nulls last) from intel.ci_campaign_post cp
                                     where cp.participation_id = p.participation_id and cp.permalink is not null), ''), array_to_string(inv.post_links, ' ')),
      'updated_at', p.updated_at) r
      from intel.ci_campaign_participation p
      cross join lateral (select intel.ci_member_of_identity(p.identity_id) mid) mid
      left join public.members m on m.id = mid.mid
      cross join lateral (select intel.ci_public_creator_card(p.identity_id, p.applied_profile) card) c
      left join lateral (select i.* from intel.ci_campaign_invite i where i.participation_id = p.participation_id order by i.created_at limit 1) inv on true
      left join lateral (select a.* from private.creator_address a
                          where (p.shipping_address_id is not null and a.address_id = p.shipping_address_id)
                             or (p.shipping_address_id is null and a.identity_id = p.identity_id and a.deleted_at is null)
                          order by (a.address_id = p.shipping_address_id) desc nulls last, a.is_default desc nulls last, a.created_at desc limit 1) ad on true
      left join lateral (select s.* from intel.ci_campaign_shipment s where s.participation_id = p.participation_id order by s.created_at desc limit 1) sh on true
      cross join lateral (select p.stage in ('dropped','rejected','ineligible','brand_declined') out,
          case p.stage when 'applied' then 'registered' when 'eligible' then 'screened' when 'shortlisted' then 'screened'
            when 'sent_to_brand' then 'sent_to_brand' when 'invited' then 'approved' when 'accepted' then 'approved' when 'brand_confirmed' then 'approved'
            when 'contract_sent' then 'contract_sent' when 'contract_signed' then 'contract_signed' when 'address_confirmed' then 'address_confirmed'
            when 'product_sent' then case when sh.status = 'delivered' then 'courier_delivered' else 'courier_sent' end
            when 'content_created' then 'video_brief_sent' when 'changes_requested' then 'video_brief_sent' when 'content_submitted' then 'video_submitted'
            when 'content_approved' then 'client_approved' when 'published' then 'posted' when 'completed' then 'posted' else 'registered' end k) st0
      cross join lateral (select st0.out, st0.k, array_position(array['registered','screened','sent_to_brand','approved','contract_sent','contract_signed',
          'address_confirmed','courier_sent','courier_delivered','video_brief_sent','video_submitted','client_approved','posted'], st0.k) k_rank) st
     where p.campaign_id = p_campaign
    union all
    -- uploaded / invited, not in the campaign yet
    select jsonb_build_object('key', 'i:' || i.invite_id, 'rank', lpad(coalesce(st.k_rank, 0)::text, 2, '0'),
      'name', i.full_name, 'instagram', i.handle, 'whatsapp', i.phone_e164, 'email', i.email, 'city', i.city,
      'status_key', st.k, 'status', intel.ci_sheet_status_label(st.k),
      'address', nullif(concat_ws(', ', nullif(btrim(i.ship_address->>'line1'), ''), nullif(btrim(i.ship_address->>'line2'), ''), nullif(btrim(i.ship_address->>'city'), '')), ''),
      'state', i.ship_address->>'state', 'pincode', i.ship_address->>'postal_code',
      'courier', i.courier, 'tracking', coalesce(i.tracking_ref, i.tracking_url), 'video_link', i.video_url,
      'post_link', nullif(array_to_string(i.post_links, ' '), ''), 'updated_at', coalesce(i.last_invited_at, i.created_at)) r
      from intel.ci_campaign_invite i
      cross join lateral (select case coalesce(i.status, case when i.approved then 'approved' else 'registered' end)
          when 'invited' then 'registered' when 'courier_received' then 'courier_delivered' else coalesce(i.status, case when i.approved then 'approved' else 'registered' end) end k) st0
      cross join lateral (select st0.k, array_position(array['registered','screened','sent_to_brand','approved','contract_sent','contract_signed',
          'address_confirmed','courier_sent','courier_delivered','video_brief_sent','video_submitted','client_approved','posted'], st0.k) k_rank) st
     where i.campaign_id = p_campaign and i.participation_id is null and i.claimed_at is null) q $$;
revoke all on function intel.ci_campaign_sheet_rows(uuid) from public, anon, authenticated;

-- the team: rows for ⬇ Download (all / a step / the ticked ones)
create or replace function api.campaign_sheet_rows(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return jsonb_build_object('campaign', (select name from intel.ci_campaign where campaign_id = v_c),
    'kind', (select case comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' else 'barter' end from intel.ci_campaign where campaign_id = v_c), 'rows', intel.ci_campaign_sheet_rows(v_c));
end $$;
revoke all on function api.campaign_sheet_rows(uuid) from public, anon;
grant execute on function api.campaign_sheet_rows(uuid) to authenticated;

-- 🔗 the linked Google Sheet: one secret link per campaign (the sheet's script reads with it; change it to cut the old one off)
create table if not exists intel.ci_campaign_sheet_link (
  campaign_id uuid primary key,
  token text not null unique,
  sheet_url text,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_pull_at timestamptz,
  pulls int not null default 0
);
alter table intel.ci_campaign_sheet_link enable row level security;
revoke all on intel.ci_campaign_sheet_link from public, anon, authenticated;

create or replace function api.campaign_sheet_link(p_campaign uuid, p_sheet_url text default null, p_new_token boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c uuid; r intel.ci_campaign_sheet_link%rowtype;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p_sheet_url is not null and btrim(p_sheet_url) <> '' and btrim(p_sheet_url) !~* '^https://docs\.google\.com/spreadsheets/' then
    raise exception 'Paste the Google Sheet link (https://docs.google.com/spreadsheets/…)' using errcode = '22023'; end if;
  insert into intel.ci_campaign_sheet_link(campaign_id, token, sheet_url, created_by)
  values (v_c, encode(extensions.gen_random_bytes(18), 'hex'), nullif(btrim(p_sheet_url), ''), auth.uid())
  on conflict (campaign_id) do update set
    sheet_url = coalesce(nullif(btrim(p_sheet_url), ''), intel.ci_campaign_sheet_link.sheet_url),
    token = case when p_new_token then encode(extensions.gen_random_bytes(18), 'hex') else intel.ci_campaign_sheet_link.token end
  returning * into r;
  return jsonb_build_object('token', r.token, 'sheet_url', r.sheet_url, 'last_pull_at', r.last_pull_at, 'pulls', r.pulls);
end $$;
revoke all on function api.campaign_sheet_link(uuid, text, boolean) from public, anon;
grant execute on function api.campaign_sheet_link(uuid, text, boolean) to authenticated;

create or replace function api.campaign_sheet_link_get(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return (select jsonb_build_object('token', l.token, 'sheet_url', l.sheet_url, 'last_pull_at', l.last_pull_at, 'pulls', l.pulls)
            from intel.ci_campaign_sheet_link l where l.campaign_id = v_c);
end $$;
revoke all on function api.campaign_sheet_link_get(uuid) from public, anon;
grant execute on function api.campaign_sheet_link_get(uuid) to authenticated;

-- what the sheet's script calls (no login — the secret link is the key)
create or replace function public.campaign_sheet_feed(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l intel.ci_campaign_sheet_link%rowtype;
begin
  if p_token is null or length(p_token) < 30 then raise exception 'bad link' using errcode = '42501'; end if;
  select * into l from intel.ci_campaign_sheet_link where token = p_token;
  if l.campaign_id is null then raise exception 'This sheet link was changed or removed — copy the new script from Geek OS' using errcode = '42501'; end if;
  update intel.ci_campaign_sheet_link set last_pull_at = now(), pulls = pulls + 1 where campaign_id = l.campaign_id;
  return jsonb_build_object('campaign', (select name from intel.ci_campaign where campaign_id = l.campaign_id),
    'kind', (select case comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' else 'barter' end from intel.ci_campaign where campaign_id = l.campaign_id),
    'at', now(), 'rows', intel.ci_campaign_sheet_rows(l.campaign_id));
end $$;
revoke all on function public.campaign_sheet_feed(text) from public;
grant execute on function public.campaign_sheet_feed(text) to anon, authenticated;
