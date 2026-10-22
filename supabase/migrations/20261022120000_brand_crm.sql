-- Brand CRM: brands are real records (intel.ci_brand), picked in the campaign form or created when new; every
-- brand has its own CRM page (details, contacts, notes, campaigns, creators, logins); the Super Admin can make a
-- brand login (the brand's own team then sees and runs only that brand's campaigns); creators can be uploaded per brand.

-- ============================== brand record ==============================
alter table intel.ci_brand add column if not exists owner_org uuid;        -- the agency workspace that manages it
alter table intel.ci_brand add column if not exists org_id uuid;           -- the brand's own login workspace
alter table intel.ci_brand add column if not exists category text;
alter table intel.ci_brand add column if not exists website text;
alter table intel.ci_brand add column if not exists instagram text;
alter table intel.ci_brand add column if not exists logo_url text;
alter table intel.ci_brand add column if not exists gstin text;
alter table intel.ci_brand add column if not exists address text;
alter table intel.ci_brand add column if not exists notes text;
alter table intel.ci_brand add column if not exists status text not null default 'active';
alter table intel.ci_brand add column if not exists created_by uuid;
create index if not exists ci_brand_name_idx on intel.ci_brand(lower(name));
create index if not exists ci_brand_org_idx on intel.ci_brand(org_id);

create table if not exists intel.ci_brand_contact (
  contact_id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references intel.ci_brand(brand_id) on delete cascade,
  name text not null, role text, email text, phone text, is_primary boolean not null default false,
  created_by uuid, created_at timestamptz not null default now()
);
create table if not exists intel.ci_brand_note (
  note_id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references intel.ci_brand(brand_id) on delete cascade,
  kind text not null default 'note' check (kind in ('note','call','email','meeting','deal','task')),
  body text not null, due_on date, done_at timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);
alter table intel.ci_brand_contact enable row level security;
alter table intel.ci_brand_note enable row level security;
revoke all on intel.ci_brand_contact, intel.ci_brand_note from public, anon, authenticated;

alter table intel.ci_creator_upload add column if not exists brand_id uuid references intel.ci_brand(brand_id) on delete set null;

-- the brand by name (or alias) — one record per brand, whatever the spelling case
create or replace function intel.ci_brand_find_or_create(p_name text, p_org uuid, p_by uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_n text := btrim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g'));
begin
  if v_n = '' then return null; end if;
  select brand_id into v_id from intel.ci_brand
   where lower(name) = lower(v_n) or lower(v_n) = any(select lower(a) from unnest(coalesce(aliases,'{}')) a)
   order by created_at limit 1;
  if v_id is null then
    insert into intel.ci_brand(name, owner_org, created_by) values (v_n, p_org, p_by) returning brand_id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function intel.ci_brand_find_or_create(text, uuid, uuid) from public, anon, authenticated;

-- campaigns carry the brand record: picked in the form (brand_id), or typed → found / created
alter table public.campaigns add column if not exists brand_id uuid;
create or replace function public.tg_campaign_brand()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if new.brand_id is not null and (tg_op = 'INSERT' or new.brand_id is distinct from old.brand_id) then
    select name into v_name from intel.ci_brand where brand_id = new.brand_id;
    if v_name is null then new.brand_id := null; else new.brand := v_name; return new; end if;
  end if;
  if coalesce(btrim(new.brand),'') <> '' and (new.brand_id is null or (tg_op = 'UPDATE' and new.brand is distinct from old.brand and new.brand_id is not distinct from old.brand_id)) then
    new.brand_id := intel.ci_brand_find_or_create(new.brand, new.org_id, auth.uid());
    new.brand := coalesce((select name from intel.ci_brand where brand_id = new.brand_id), new.brand);
  end if;
  return new;
end $$;
drop trigger if exists campaign_aa_brand on public.campaigns;
create trigger campaign_aa_brand before insert or update of brand, brand_id on public.campaigns
  for each row execute function public.tg_campaign_brand();
update public.campaigns set brand = brand where brand_id is null and coalesce(btrim(brand),'') <> '';

-- the pipeline campaign follows its form campaign's brand
create or replace function intel.tg_ci_campaign_brand()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.legacy_campaign_id is not null then
    new.brand_id := coalesce((select c.brand_id from public.campaigns c where c.id = new.legacy_campaign_id), new.brand_id);
  elsif new.brand_id is null and coalesce(btrim(new.submitted_brand_name),'') <> '' then
    new.brand_id := intel.ci_brand_find_or_create(new.submitted_brand_name, new.org_id, new.created_by);
  end if;
  return new;
end $$;
drop trigger if exists ci_campaign_aa_brand on intel.ci_campaign;
create trigger ci_campaign_aa_brand before insert or update on intel.ci_campaign
  for each row execute function intel.tg_ci_campaign_brand();
update intel.ci_campaign set brand_id = brand_id where legacy_campaign_id is not null or brand_id is null;
create or replace function public.tg_campaign_brand_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.brand_id is not distinct from old.brand_id then return null; end if;
  update intel.ci_campaign set brand_id = new.brand_id where legacy_campaign_id = new.id and brand_id is distinct from new.brand_id;
  return null;
end $$;
drop trigger if exists campaign_zz_brand_sync on public.campaigns;
create trigger campaign_zz_brand_sync after insert or update of brand_id on public.campaigns
  for each row execute function public.tg_campaign_brand_after();

-- ============================== who sees a brand ==============================
create or replace function intel.ci_my_brand_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(b.brand_id), '{}') from intel.ci_brand b
   where b.org_id is not null and b.org_id = (select m.org_id from public.members m where m.id = auth.uid() and coalesce(m.status,'active') = 'active') $$;
grant execute on function intel.ci_my_brand_ids() to authenticated;

create or replace function intel.ci_can_see_brand(p_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or intel.ci_is_agency_operator()
      or exists (select 1 from intel.ci_brand b join public.members m on m.id = auth.uid()
                  where b.brand_id = p_brand and m.org_id is not null and (b.owner_org = m.org_id or b.org_id = m.org_id))
      or exists (select 1 from public.campaigns c join public.members m on m.id = auth.uid()
                  where c.brand_id = p_brand and c.org_id = m.org_id and m.role in ('owner','manager','corporate','brand')) $$;
revoke all on function intel.ci_can_see_brand(uuid) from public, anon;

-- a brand's own login runs that brand's campaigns (the agency's campaigns for it included)
create or replace function intel.ci_can_manage_campaign(p_campaign uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if intel.ci_is_agency_operator() then return true; end if;
  return exists (select 1 from intel.ci_campaign c join public.members m on m.id = v_uid
                  where c.campaign_id = p_campaign and c.org_id is not null and c.org_id = m.org_id
                    and m.role in ('owner','brand','manager') and coalesce(m.status,'active') = 'active')
      or exists (select 1 from intel.ci_campaign c join intel.ci_brand b on b.brand_id = c.brand_id join public.members m on m.id = v_uid
                  where c.campaign_id = p_campaign and b.org_id is not null and b.org_id = m.org_id
                    and m.role = 'brand' and coalesce(m.status,'active') = 'active');
end $$;

drop policy if exists "brand reads its campaigns" on public.campaigns;
create policy "brand reads its campaigns" on public.campaigns for select to authenticated
  using (brand_id is not null and brand_id = any(intel.ci_my_brand_ids()));

-- ============================== brand CRM api ==============================
create or replace function api.brand_list(p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(lower(btrim(coalesce(p_q,''))), '');
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(r order by (r->>'active')::int desc, r->>'name') from (
    select jsonb_build_object('brand_id', b.brand_id, 'name', b.name, 'category', b.category, 'website', b.website, 'instagram', b.instagram,
             'logo_url', b.logo_url, 'status', b.status, 'has_login', b.org_id is not null,
             'logins', (select count(*) from public.members m where b.org_id is not null and m.org_id = b.org_id and m.role = 'brand'),
             'campaigns', (select count(*) from public.campaigns c where c.brand_id = b.brand_id),
             'active', (select count(*) from public.campaigns c where c.brand_id = b.brand_id
                          and c.status in ('Live','Shortlist completed','In Production','Sourcing','Approval')),
             'creators', (select count(distinct p.identity_id) from intel.ci_campaign k join intel.ci_campaign_participation p on p.campaign_id = k.campaign_id
                           where k.brand_id = b.brand_id) +
                         (select count(*) from intel.ci_campaign k join intel.ci_campaign_invite i on i.campaign_id = k.campaign_id
                           where k.brand_id = b.brand_id and i.participation_id is null),
             'posted', (select count(distinct po.participation_id) from intel.ci_campaign k join intel.ci_campaign_post po on po.campaign_id = k.campaign_id
                         where k.brand_id = b.brand_id),
             'uploaded', (select count(*) from intel.ci_creator_upload u where u.brand_id = b.brand_id),
             'contact', (select jsonb_build_object('name', x.name, 'email', x.email, 'phone', x.phone) from intel.ci_brand_contact x
                          where x.brand_id = b.brand_id order by x.is_primary desc, x.created_at limit 1),
             'last_at', greatest(b.updated_at, (select max(c.created_at) from public.campaigns c where c.brand_id = b.brand_id),
                                 (select max(n.created_at) from intel.ci_brand_note n where n.brand_id = b.brand_id))) r
      from intel.ci_brand b
     where intel.ci_can_see_brand(b.brand_id)
       and (v_q is null or lower(concat_ws(' ', b.name, b.category, b.website, b.instagram, array_to_string(b.aliases, ' '))) like '%' || v_q || '%')) z), '[]'::jsonb);
end $$;
revoke all on function api.brand_list(text) from public, anon;
grant execute on function api.brand_list(text) to authenticated;

create or replace function api.brand_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p->>'brand_id','')::uuid; v_uid uuid := auth.uid(); v_org uuid; v_name text := btrim(coalesce(p->>'name',''));
        v_dup uuid; v_new boolean := false;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select org_id into v_org from public.members where id = v_uid;
  if not (public.is_platform_admin() or intel.ci_is_agency_operator()
          or exists (select 1 from public.members m where m.id = v_uid and m.role in ('owner','manager','corporate') and coalesce(m.status,'active') = 'active')) then
    raise exception 'Only the agency team can add or edit brands.' using errcode = '42501'; end if;
  if v_id is not null and not intel.ci_can_see_brand(v_id) then raise exception 'not your brand' using errcode = '42501'; end if;
  if v_id is null and v_name = '' then raise exception 'Add the brand name.' using errcode = '22023'; end if;
  if v_name <> '' then
    select brand_id into v_dup from intel.ci_brand where lower(name) = lower(v_name) and brand_id is distinct from v_id limit 1;
    if v_dup is not null then raise exception 'A brand called "%" already exists — open it from the list.', v_name using errcode = '23505'; end if;
  end if;
  if v_id is null then
    insert into intel.ci_brand(name, owner_org, created_by) values (v_name, v_org, v_uid) returning brand_id into v_id; v_new := true;
  end if;
  update intel.ci_brand set
    name = coalesce(nullif(v_name,''), name),
    category = case when p ? 'category' then nullif(btrim(p->>'category'),'') else category end,
    website = case when p ? 'website' then nullif(btrim(p->>'website'),'') else website end,
    instagram = case when p ? 'instagram' then nullif(lower(regexp_replace(btrim(p->>'instagram'), '^(https?://)?(www\.)?instagram\.com/|^@|/$', '', 'g')),'') else instagram end,
    logo_url = case when p ? 'logo_url' then nullif(btrim(p->>'logo_url'),'') else logo_url end,
    gstin = case when p ? 'gstin' then nullif(upper(btrim(p->>'gstin')),'') else gstin end,
    address = case when p ? 'address' then nullif(btrim(p->>'address'),'') else address end,
    notes = case when p ? 'notes' then nullif(btrim(p->>'notes'),'') else notes end,
    status = case when p->>'status' in ('active','paused','lead','archived') then p->>'status' else status end,
    owner_org = coalesce(owner_org, v_org), updated_at = now()
   where brand_id = v_id;
  -- campaigns keep showing the right brand name after a rename
  if not v_new and v_name <> '' then update public.campaigns set brand = v_name where brand_id = v_id and brand is distinct from v_name; end if;
  if v_new and coalesce(btrim(p->>'contact_name'),'') <> '' then
    insert into intel.ci_brand_contact(brand_id, name, role, email, phone, is_primary, created_by)
    values (v_id, btrim(p->>'contact_name'), nullif(btrim(p->>'contact_role'),''), nullif(lower(btrim(p->>'contact_email')),''), nullif(btrim(p->>'contact_phone'),''), true, v_uid);
  end if;
  return jsonb_build_object('brand_id', v_id, 'created', v_new);
end $$;
revoke all on function api.brand_save(jsonb) from public, anon;
grant execute on function api.brand_save(jsonb) to authenticated;

create or replace function api.brand_detail(p_brand uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b intel.ci_brand%rowtype;
begin
  if not intel.ci_can_see_brand(p_brand) then raise exception 'not your brand' using errcode = '42501'; end if;
  select * into b from intel.ci_brand where brand_id = p_brand;
  if b.brand_id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'brand', to_jsonb(b) - 'parent_brand_id',
    'is_admin', public.is_platform_admin(),
    'contacts', coalesce((select jsonb_agg(to_jsonb(x) - 'brand_id' order by x.is_primary desc, x.created_at) from intel.ci_brand_contact x where x.brand_id = p_brand), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('note_id', n.note_id, 'kind', n.kind, 'body', n.body, 'due_on', n.due_on, 'done_at', n.done_at, 'at', n.created_at,
                 'by', (select m.name from public.members m where m.id = n.created_by)) order by n.created_at desc)
                 from intel.ci_brand_note n where n.brand_id = p_brand), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'type', c.campaign_type,
                 'start_date', c.start_date, 'end_date', c.end_date, 'budget', c.budget, 'product_value', c.product_value,
                 'creators', (select count(*) from intel.ci_campaign k join intel.ci_campaign_participation p on p.campaign_id = k.campaign_id where k.legacy_campaign_id = c.id),
                 'invited', (select count(*) from intel.ci_campaign k join intel.ci_campaign_invite i on i.campaign_id = k.campaign_id where k.legacy_campaign_id = c.id and i.participation_id is null),
                 'done', (select count(*) from intel.ci_campaign k join intel.ci_campaign_participation p on p.campaign_id = k.campaign_id where k.legacy_campaign_id = c.id and p.stage = 'completed'),
                 'posts', (select count(*) from intel.ci_campaign k join intel.ci_campaign_post po on po.campaign_id = k.campaign_id where k.legacy_campaign_id = c.id))
                 order by c.created_at desc) from public.campaigns c where c.brand_id = p_brand), '[]'::jsonb),
    'creators', coalesce((select jsonb_agg(r order by r->>'at' desc) from (
        select jsonb_build_object('participation_id', p.participation_id, 'campaign', k.name, 'campaign_id', k.legacy_campaign_id, 'stage', p.stage, 'at', p.updated_at,
                 'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile)) r
          from intel.ci_campaign k join intel.ci_campaign_participation p on p.campaign_id = k.campaign_id
         where k.brand_id = p_brand order by p.updated_at desc limit 500) z), '[]'::jsonb),
    'logins', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'email', m.email, 'status', m.status, 'created_at', m.created_at,
                 'last_seen', (select max(u.last_sign_in_at) from auth.users u where u.id = m.id)) order by m.created_at)
                 from public.members m where b.org_id is not null and m.org_id = b.org_id and m.role = 'brand'), '[]'::jsonb),
    'uploaded', (select count(*) from intel.ci_creator_upload u where u.brand_id = p_brand),
    'totals', jsonb_build_object(
       'campaigns', (select count(*) from public.campaigns c where c.brand_id = p_brand),
       'creators', (select count(distinct p.identity_id) from intel.ci_campaign k join intel.ci_campaign_participation p on p.campaign_id = k.campaign_id where k.brand_id = p_brand),
       'posted', (select count(distinct po.participation_id) from intel.ci_campaign k join intel.ci_campaign_post po on po.campaign_id = k.campaign_id where k.brand_id = p_brand),
       'spend', (select coalesce(sum(coalesce(c.budget,0)),0) from public.campaigns c where c.brand_id = p_brand),
       'product_value', (select coalesce(sum(coalesce(c.product_value,0) * greatest(coalesce(c.creators,0),0)),0) from public.campaigns c where c.brand_id = p_brand)));
end $$;
revoke all on function api.brand_detail(uuid) from public, anon;
grant execute on function api.brand_detail(uuid) to authenticated;

create or replace function api.brand_contact_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p->>'contact_id','')::uuid; v_b uuid := nullif(p->>'brand_id','')::uuid;
begin
  if v_id is not null then select brand_id into v_b from intel.ci_brand_contact where contact_id = v_id; end if;
  if v_b is null or not intel.ci_can_see_brand(v_b) then raise exception 'not your brand' using errcode = '42501'; end if;
  if coalesce(btrim(p->>'name'),'') = '' then raise exception 'Add the contact''s name.' using errcode = '22023'; end if;
  if coalesce((p->>'is_primary')::boolean, false) then update intel.ci_brand_contact set is_primary = false where brand_id = v_b; end if;
  if v_id is null then
    insert into intel.ci_brand_contact(brand_id, name, role, email, phone, is_primary, created_by)
    values (v_b, btrim(p->>'name'), nullif(btrim(p->>'role'),''), nullif(lower(btrim(p->>'email')),''), nullif(btrim(p->>'phone'),''),
            coalesce((p->>'is_primary')::boolean, not exists (select 1 from intel.ci_brand_contact where brand_id = v_b)), auth.uid())
    returning contact_id into v_id;
  else
    update intel.ci_brand_contact set name = btrim(p->>'name'), role = nullif(btrim(p->>'role'),''), email = nullif(lower(btrim(p->>'email')),''),
           phone = nullif(btrim(p->>'phone'),''), is_primary = coalesce((p->>'is_primary')::boolean, is_primary) where contact_id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function api.brand_contact_save(jsonb) from public, anon;
grant execute on function api.brand_contact_save(jsonb) to authenticated;

create or replace function api.brand_contact_delete(p_contact uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_b uuid;
begin
  select brand_id into v_b from intel.ci_brand_contact where contact_id = p_contact;
  if v_b is null or not intel.ci_can_see_brand(v_b) then raise exception 'not your brand' using errcode = '42501'; end if;
  delete from intel.ci_brand_contact where contact_id = p_contact;
end $$;
revoke all on function api.brand_contact_delete(uuid) from public, anon;
grant execute on function api.brand_contact_delete(uuid) to authenticated;

create or replace function api.brand_note_add(p_brand uuid, p_kind text, p_body text, p_due date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not intel.ci_can_see_brand(p_brand) then raise exception 'not your brand' using errcode = '42501'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'Write the note first.' using errcode = '22023'; end if;
  insert into intel.ci_brand_note(brand_id, kind, body, due_on, created_by)
  values (p_brand, case when p_kind in ('note','call','email','meeting','deal','task') then p_kind else 'note' end, left(btrim(p_body), 4000), p_due, auth.uid())
  returning note_id into v_id;
  update intel.ci_brand set updated_at = now() where brand_id = p_brand;
  return v_id;
end $$;
revoke all on function api.brand_note_add(uuid, text, text, date) from public, anon;
grant execute on function api.brand_note_add(uuid, text, text, date) to authenticated;

create or replace function api.brand_note_update(p_note uuid, p_done boolean default null, p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_b uuid;
begin
  select brand_id into v_b from intel.ci_brand_note where note_id = p_note;
  if v_b is null or not intel.ci_can_see_brand(v_b) then raise exception 'not your brand' using errcode = '42501'; end if;
  if p_delete then delete from intel.ci_brand_note where note_id = p_note; return; end if;
  if p_done is not null then update intel.ci_brand_note set done_at = case when p_done then now() end where note_id = p_note; end if;
end $$;
revoke all on function api.brand_note_update(uuid, boolean, boolean) from public, anon;
grant execute on function api.brand_note_update(uuid, boolean, boolean) to authenticated;

-- brand login (Super Admin): the edge function brand-login creates the auth user; this prepares the brand's workspace
-- and the invite the signup joins, so the account lands as role "brand" in that brand's own workspace
create or replace function api.ops_brand_login_prepare(p_brand uuid, p_email text, p_name text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b intel.ci_brand%rowtype; v_org uuid; v_tok uuid;
begin
  select * into b from intel.ci_brand where brand_id = p_brand;
  if b.brand_id is null then raise exception 'brand not found' using errcode = 'P0002'; end if;
  if coalesce(btrim(p_email),'') !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Enter a valid email.' using errcode = '22023'; end if;
  v_org := coalesce(b.org_id, gen_random_uuid());
  if b.org_id is null then update intel.ci_brand set org_id = v_org, updated_at = now() where brand_id = p_brand; end if;
  insert into public.invites(org_id, org_name, email, role, status, invited_by, name, channel)
  values (v_org, b.name, lower(btrim(p_email)), 'brand', 'pending', p_by, nullif(btrim(p_name),''), 'email')
  returning token into v_tok;
  return jsonb_build_object('org_id', v_org, 'org_name', b.name, 'token', v_tok);
end $$;
revoke all on function api.ops_brand_login_prepare(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function api.ops_brand_login_prepare(uuid, text, text, uuid) to service_role;

create or replace function api.ops_brand_login_member(p_brand uuid, p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m join intel.ci_brand b on b.org_id = m.org_id
                  where b.brand_id = p_brand and m.id = p_member and m.role = 'brand') $$;
revoke all on function api.ops_brand_login_member(uuid, uuid) from public, anon, authenticated;
grant execute on function api.ops_brand_login_member(uuid, uuid) to service_role;

-- ============================== creator upload per brand ==============================
drop function if exists api.creator_upload(jsonb, boolean);
CREATE OR REPLACE FUNCTION api.creator_upload(p_rows jsonb, p_send boolean DEFAULT true, p_brand uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x jsonb; v_uid uuid := auth.uid(); v_org uuid; v_batch uuid := gen_random_uuid(); v_phone text; v_email text; v_handle text;
        v_id uuid; v_m uuid; v_added int := 0; v_upd int := 0; v_joined int := 0; v_sent int := 0; v_skip int := 0; v_new boolean;
begin
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can upload creators here.' using errcode = '42501'; end if;
  select org_id into v_org from public.members where id = v_uid;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_phone := intel.ci_e164(nullif(btrim(coalesce(x->>'phone','')), ''));
    v_email := lower(nullif(btrim(coalesce(x->>'email','')), '')); if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then v_email := null; end if;
    v_handle := intel.ci_norm_handle(x->>'handle');
    if v_phone is null and v_email is null and v_handle is null then v_skip := v_skip + 1; continue; end if;
    select id into v_id from intel.ci_creator_upload
     where (v_phone is not null and phone_e164 = v_phone) or (v_handle is not null and handle = v_handle) or (v_email is not null and lower(email) = v_email)
     limit 1;
    v_new := v_id is null;
    if v_new then
      insert into intel.ci_creator_upload(org_id, uploaded_by, batch_id, brand_id, full_name, handle, phone_e164, email, city, state, followers, category, note)
      values (v_org, v_uid, v_batch, p_brand, nullif(btrim(x->>'name'),''), v_handle, v_phone, v_email, nullif(btrim(x->>'city'),''), nullif(btrim(x->>'state'),''),
              nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'), '')::bigint, nullif(btrim(x->>'category'),''), nullif(btrim(x->>'note'),''))
      on conflict do nothing returning id into v_id;
      if v_id is null then v_skip := v_skip + 1; continue; end if;
      v_added := v_added + 1;
    else
      update intel.ci_creator_upload set full_name = coalesce(full_name, nullif(btrim(x->>'name'),'')), handle = coalesce(handle, v_handle),
             phone_e164 = coalesce(phone_e164, v_phone), email = coalesce(email, v_email), city = coalesce(nullif(btrim(x->>'city'),''), city),
             state = coalesce(nullif(btrim(x->>'state'),''), state),
             followers = coalesce(nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'), '')::bigint, followers),
             category = coalesce(nullif(btrim(x->>'category'),''), category), brand_id = coalesce(p_brand, brand_id)
       where id = v_id;
      v_upd := v_upd + 1;
    end if;
    -- in discovery too (so they can be matched to campaigns)
    if v_handle is not null then
      begin
        insert into intel.ci_external_creator(platform, handle, display_name, followers, city, sources, found_by_org, first_seen_at, last_seen_at)
        values ('instagram', v_handle, nullif(btrim(x->>'name'),''), nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'), '')::int,
                nullif(btrim(x->>'city'),''), array['creator_upload'], v_org, now(), now())
        on conflict (platform, handle) do update set last_seen_at = now(),
          followers = coalesce(intel.ci_external_creator.followers, excluded.followers), city = coalesce(intel.ci_external_creator.city, excluded.city),
          sources = case when 'creator_upload' = any(intel.ci_external_creator.sources) then intel.ci_external_creator.sources else intel.ci_external_creator.sources || array['creator_upload'] end;
      exception when others then null; end;
    end if;
    v_m := intel.ci_find_creator(v_phone, v_email, v_handle);
    if v_m is not null then
      update intel.ci_creator_upload set joined_member = v_m, joined_at = coalesce(joined_at, now()) where id = v_id and joined_member is null;
      v_joined := v_joined + 1;
    elsif p_send and v_new then
      v_sent := v_sent + (case when intel.ci_send_join_invite(v_id) > 0 then 1 else 0 end);
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_upd, 'already_on_geek', v_joined, 'invited', v_sent, 'skipped', v_skip, 'batch_id', v_batch);
end $function$;
revoke all on function api.creator_upload(jsonb, boolean, uuid) from public, anon;
grant execute on function api.creator_upload(jsonb, boolean, uuid) to authenticated;

drop function if exists api.creator_upload_list(text, text, int);
CREATE OR REPLACE FUNCTION api.creator_upload_list(p_q text DEFAULT NULL::text, p_status text DEFAULT 'all'::text, p_limit integer DEFAULT 300, p_brand uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_q text := nullif(lower(btrim(coalesce(p_q,''))), '');
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  perform intel.ci_creator_upload_sync();
  return jsonb_build_object(
    'total', (select count(*) from intel.ci_creator_upload),
    'joined', (select count(*) from intel.ci_creator_upload where joined_member is not null),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'handle', u.handle, 'phone', u.phone_e164, 'email', u.email,
               'city', u.city, 'state', u.state, 'followers', u.followers, 'category', u.category, 'brand_id', u.brand_id, 'brand', (select b.name from intel.ci_brand b where b.brand_id = u.brand_id), 'invites_sent', u.invites_sent,
               'last_invited_at', u.last_invited_at, 'joined', u.joined_member is not null, 'joined_at', u.joined_at, 'created_at', u.created_at,
               'member_name', (select m.name from public.members m where m.id = u.joined_member),
               'last_wa', (select jsonb_build_object('status', o.status, 'error', o.last_error, 'at', coalesce(o.sent_at, o.created_at))
                             from intel.ci_outbox o where o.template_key = 'join_invite' and o.channel = 'whatsapp' and o.to_address = u.phone_e164
                             order by o.created_at desc limit 1))
             order by u.created_at desc)
        from (select * from intel.ci_creator_upload x
               where (v_q is null or lower(concat_ws(' ', x.full_name, x.handle, x.phone_e164, x.email, x.city, x.category)) like '%' || v_q || '%')
                 and (p_brand is null or x.brand_id = p_brand)
                 and (coalesce(p_status,'all') = 'all' or (p_status = 'joined' and x.joined_member is not null) or (p_status = 'waiting' and x.joined_member is null))
               order by x.created_at desc limit greatest(10, least(coalesce(p_limit,300), 1000))) u), '[]'::jsonb));
end $function$;
revoke all on function api.creator_upload_list(text, text, int, uuid) from public, anon;
grant execute on function api.creator_upload_list(text, text, int, uuid) to authenticated;

CREATE OR REPLACE FUNCTION intel.ci_send_join_invite(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u intel.ci_creator_upload%rowtype; v_first text; v_n int := 0; v_mail text; v_from text;
begin
  select * into u from intel.ci_creator_upload where id = p_id;
  if u.id is null or u.joined_member is not null then return 0; end if;
  v_from := coalesce((select b.name from intel.ci_brand b where b.brand_id = u.brand_id), 'Geek Creative Agency');
  v_first := coalesce(nullif(split_part(btrim(coalesce(u.full_name,'')), ' ', 1), ''), case when u.handle is not null then '@' || u.handle end, 'there');
  v_mail := 'Hi ' || v_first || E',\n\nThank you for your interest in working with ' || v_from
         || E'. Your profile has been added to our creator network for upcoming brand campaigns.\n\nNext, please register on the Geek app with your WhatsApp number and connect your Instagram. Once that is done, you will start getting campaigns that match your profile.'
         || E'\n\nClick the button below to register.';
  if u.phone_e164 is not null and not exists (select 1 from public.wa_contacts w where w.phone_e164 = u.phone_e164 and w.opt_out_at is not null) then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('whatsapp', null, u.phone_e164, null, 'join_invite',
            jsonb_build_object('title', 'Join Geek Creative Agency', 'text', v_mail, 'action_route', '/app.html', 'action_label', 'Register', 'to_name', v_first,
                               'force_template', true, 'wa_template', 'geek_join_invite', 'wa_lang', 'en',
                               'wa_vars', jsonb_build_array(v_first, v_from, 'LINK')),
            'join:' || u.id || ':wa:' || (u.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if u.email is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('email', null, u.email, null, 'join_invite',
            jsonb_build_object('subject', 'Join the Geek creator network', 'html', v_mail, 'to_name', v_first, 'action_route', '/app.html', 'action_label', 'Register'),
            'join:' || u.id || ':em:' || (u.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if v_n > 0 then update intel.ci_creator_upload set invites_sent = invites_sent + 1, last_invited_at = now() where id = p_id; end if;
  return v_n;
end $function$;
revoke all on function intel.ci_send_join_invite(uuid) from public, anon, authenticated;
