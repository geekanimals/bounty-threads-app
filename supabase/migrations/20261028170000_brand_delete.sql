-- Brand CRM: ✏️ Edit + 🗑 Delete for the Super Admin.
-- Delete = the brand leaves Brand CRM and every one of its logins loses access at once:
--   * the brand is marked deleted (kept in the database — campaigns, bills and reports stay intact, and it can be restored)
--   * each brand login: member status 'disabled', banned in auth (no new sign-in), every open session ended
--   * brand_list / brand portal / discovery skip deleted brands
-- api.admin_brand_delete(p_brand) · api.admin_brand_restore(p_brand) · api.admin_brands_deleted()

alter table intel.ci_brand add column if not exists deleted_at timestamptz;
alter table intel.ci_brand add column if not exists deleted_by uuid;

-- Brand CRM list: deleted brands are hidden (patched in place so earlier changes stay)
do $$
declare d text;
begin
  d := pg_get_functiondef('api.brand_list(text)'::regprocedure);
  if position('b.deleted_at is null' in d) = 0 then
    if position('where intel.ci_can_see_brand(b.brand_id)' in d) = 0 then raise exception 'brand_list has changed — update 20261028170000_brand_delete.sql'; end if;
    d := replace(d, 'where intel.ci_can_see_brand(b.brand_id)', 'where b.deleted_at is null and intel.ci_can_see_brand(b.brand_id)');
    execute d;
  end if;
end $$;

-- a deleted brand's logins see nothing, even with a session that is still open
create or replace function intel.ci_my_brand_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(b.brand_id), '{}') from intel.ci_brand b
   where b.org_id is not null and b.deleted_at is null
     and b.org_id = (select m.org_id from public.members m where m.id = auth.uid() and coalesce(m.status,'active') = 'active')
     and coalesce(intel.ci_brand_role(), 'owner') <> 'removed' $$;

create or replace function intel.ci_brand_role(p_member uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select case when m.id is null then null else coalesce(r.role, 'owner') end
    from public.members m
    left join intel.ci_brand_member_role r on r.member_id = m.id
   where m.id = coalesce(p_member, auth.uid()) and m.role = 'brand' and coalesce(m.status, 'active') = 'active'
     and exists (select 1 from intel.ci_brand b where b.org_id = m.org_id and b.deleted_at is null) $$;
revoke all on function intel.ci_brand_role(uuid) from public, anon;
grant execute on function intel.ci_brand_role(uuid) to authenticated;

create or replace function api.admin_brand_delete(p_brand uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b intel.ci_brand%rowtype; v_ids uuid[];
begin
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can delete a brand.' using errcode = '42501'; end if;
  select * into b from intel.ci_brand where brand_id = p_brand;
  if b.brand_id is null then raise exception 'brand not found' using errcode = 'P0002'; end if;
  update intel.ci_brand set deleted_at = now(), deleted_by = auth.uid(), status = 'archived', updated_at = now() where brand_id = p_brand;
  if b.org_id is not null then
    -- only the brand's own logins (never an agency / creator account, never a Super Admin)
    select coalesce(array_agg(m.id), '{}') into v_ids from public.members m
     where m.org_id = b.org_id and m.role = 'brand' and not exists (select 1 from public.platform_admins a where a.user_id = m.id);
    update public.members set status = 'disabled' where id = any(v_ids);
    update auth.users set banned_until = 'infinity'::timestamptz where id = any(v_ids);
    delete from auth.sessions where user_id = any(v_ids);
    delete from auth.refresh_tokens where user_id::text = any(select x::text from unnest(v_ids) x);
  end if;
  return jsonb_build_object('deleted', true, 'logins_blocked', coalesce(array_length(v_ids, 1), 0));
end $$;
revoke all on function api.admin_brand_delete(uuid) from public, anon;
grant execute on function api.admin_brand_delete(uuid) to authenticated;

create or replace function api.admin_brand_restore(p_brand uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b intel.ci_brand%rowtype; v_ids uuid[];
begin
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can restore a brand.' using errcode = '42501'; end if;
  select * into b from intel.ci_brand where brand_id = p_brand;
  if b.brand_id is null then raise exception 'brand not found' using errcode = 'P0002'; end if;
  update intel.ci_brand set deleted_at = null, deleted_by = null, status = 'active', updated_at = now() where brand_id = p_brand;
  if b.org_id is not null then
    -- logins come back, except teammates the brand itself had removed
    select coalesce(array_agg(m.id), '{}') into v_ids from public.members m
      left join intel.ci_brand_member_role r on r.member_id = m.id
     where m.org_id = b.org_id and m.role = 'brand' and m.status = 'disabled' and coalesce(r.role, 'owner') <> 'removed';
    update public.members set status = 'active' where id = any(v_ids);
    update auth.users set banned_until = null where id = any(v_ids);
  end if;
  return jsonb_build_object('restored', true, 'logins_back', coalesce(array_length(v_ids, 1), 0));
end $$;
revoke all on function api.admin_brand_restore(uuid) from public, anon;
grant execute on function api.admin_brand_restore(uuid) to authenticated;

create or replace function api.admin_brands_deleted()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('brand_id', b.brand_id, 'name', b.name, 'category', b.category, 'deleted_at', b.deleted_at,
            'by', (select m.name from public.members m where m.id = b.deleted_by),
            'logins', (select count(*) from public.members m where b.org_id is not null and m.org_id = b.org_id and m.role = 'brand'),
            'campaigns', (select count(*) from public.campaigns c where c.brand_id = b.brand_id)) order by b.deleted_at desc)
     from intel.ci_brand b where b.deleted_at is not null), '[]'::jsonb);
end $$;
revoke all on function api.admin_brands_deleted() from public, anon;
grant execute on function api.admin_brands_deleted() to authenticated;
