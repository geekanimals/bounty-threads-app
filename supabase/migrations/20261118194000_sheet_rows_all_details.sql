-- Bulk sheet download: every detail from the database (sheet upload, contact, profile, Instagram) — email, city, followers
do $do$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'campaign_sheet_rows_base') then
    alter function api.campaign_sheet_rows(uuid) rename to campaign_sheet_rows_base;
    alter function api.campaign_sheet_rows_base(uuid) set schema private;
  end if;
end $do$;
revoke all on function private.campaign_sheet_rows_base(uuid) from public, anon, authenticated;
create or replace function api.campaign_sheet_rows(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d jsonb; ex jsonb;
begin
  d := private.campaign_sheet_rows_base(p_campaign);   -- does the permission check
  ex := api.campaign_creator_extras(p_campaign);
  return jsonb_set(d, '{rows}', coalesce((select jsonb_agg(
      case when r->>'key' like 'p:%' and ex ? substr(r->>'key', 3) then
        r || jsonb_strip_nulls(jsonb_build_object(
          'email', case when coalesce(r->>'email','') = '' then ex->substr(r->>'key',3)->>'email' end,
          'city', case when coalesce(r->>'city','') = '' then ex->substr(r->>'key',3)->>'city' end,
          'state', case when coalesce(r->>'state','') = '' then ex->substr(r->>'key',3)->>'state' end,
          'whatsapp', case when coalesce(r->>'whatsapp','') = '' then ex->substr(r->>'key',3)->>'phone' end,
          'instagram', case when coalesce(r->>'instagram','') = '' then ex->substr(r->>'key',3)->>'handle' end,
          'followers', ex->substr(r->>'key',3)->>'followers'))
      when r->>'key' like 'i:%' then
        r || jsonb_strip_nulls(jsonb_build_object('followers', (select i.followers::text from intel.ci_campaign_invite i where i.invite_id::text = substr(r->>'key',3))))
      else r end order by ord)
    from jsonb_array_elements(d->'rows') with ordinality t(r, ord)), '[]'::jsonb));
end $$;
revoke all on function api.campaign_sheet_rows(uuid) from public, anon;
grant execute on function api.campaign_sheet_rows(uuid) to authenticated;
