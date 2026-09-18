-- Phase 0A — Creator Intelligence dark foundation (1/6): schemas, grants, shared helpers.
-- ADDITIVE + DARK. Creates the unexposed `intel` and `private` schemas and the (unexposed,
-- ungranted) `api` schema. No existing production object is touched. See
-- docs/CREATOR_INTELLIGENCE_ARCHITECTURE.md §15.
--
-- SECURITY: intel/private/api must NOT be added to the Data API "Exposed schemas" list.
-- USAGE is revoked from PUBLIC/anon/authenticated; only service_role gets usage (tables are
-- granted explicitly, per-privilege, in migration 6 — never GRANT ALL).

create extension if not exists pgcrypto;

create schema if not exists intel;
create schema if not exists private;
create schema if not exists api;

-- Lock the schemas down. New schemas do not grant USAGE to PUBLIC by default, but we are explicit.
revoke all on schema intel   from public;
revoke all on schema private from public;
revoke all on schema api     from public;
revoke usage on schema intel   from anon, authenticated;
revoke usage on schema private from anon, authenticated;
revoke usage on schema api     from anon, authenticated;

-- Future tables in these schemas must not leak to anon/authenticated.
alter default privileges in schema intel   revoke all on tables from public;
alter default privileges in schema private revoke all on tables from public;
alter default privileges in schema api     revoke all on tables from public;

-- Only the service layer may reach the internal schemas (table DML granted explicitly later).
grant usage on schema intel   to service_role;
grant usage on schema private to service_role;

-- ---------- shared helper: set updated_at on write ----------
-- Fixed search_path (no unqualified object resolution); not directly callable by clients.
create or replace function intel.tg_set_updated_at()
returns trigger language plpgsql
set search_path = pg_catalog as $$
begin
  new.updated_at := now();   -- pg_catalog.now()
  return new;
end;
$$;

-- ---------- shared helper: append-only guard (blocks UPDATE/DELETE for every role) ----------
create or replace function intel.tg_block_mutation()
returns trigger language plpgsql
set search_path = pg_catalog as $$
begin
  raise exception 'append-only table %.% — % is not permitted',
    tg_table_schema, tg_table_name, tg_op;
  return null;
end;
$$;

-- Internal helper functions must not be executable by browser/public roles.
revoke all on function intel.tg_set_updated_at()  from public, anon, authenticated;
revoke all on function intel.tg_block_mutation()   from public, anon, authenticated;
alter default privileges in schema intel   revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;
