-- Phase 0A dark foundation (6/6): RLS (defence in depth) + least-privilege grants.
-- ADDITIVE + DARK. See docs/CREATOR_INTELLIGENCE_ARCHITECTURE.md §15.
--
-- Enable RLS on every intel/private table with NO client policies → anon/authenticated are
-- denied (they also lack schema USAGE). service_role (BYPASSRLS) and the owner keep access for
-- the future service layer. No permissive placeholder policies are created. No GRANT ALL.

do $$
declare r record;
begin
  for r in
    select schemaname, tablename
    from pg_tables
    where schemaname in ('intel','private')
  loop
    execute format('alter table %I.%I enable row level security;', r.schemaname, r.tablename);
    -- explicitly ensure browser roles hold no table privileges
    execute format('revoke all on table %I.%I from anon, authenticated;', r.schemaname, r.tablename);
    -- least-privilege DML for the service layer only (named privileges, never ALL)
    execute format('grant select, insert, update, delete on table %I.%I to service_role;', r.schemaname, r.tablename);
  end loop;
end;
$$;

-- The `api` schema stays empty and unexposed in Phase 0A: no tables, no RPCs, no grants.
-- It will receive approved RPCs + safe presentation views in Phase 0B (never raw tables).

comment on schema intel   is 'Creator Intelligence — professional/intelligence data. UNEXPOSED (not in Data API). service_role only.';
comment on schema private is 'Creator Intelligence — personal PII (identity/contact/address). UNEXPOSED. service_role only.';
comment on schema api     is 'Creator Intelligence — the ONLY intended browser-facing surface (RPCs + safe views). Empty & unexposed until Phase 0B.';
