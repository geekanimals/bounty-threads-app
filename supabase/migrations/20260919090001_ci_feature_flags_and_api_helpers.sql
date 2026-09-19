-- Phase 2B (1/3): feature-flag plumbing + hardened API helpers. ADDITIVE + DARK.
-- Concretises the architecture's "feature flags gate reads, default OFF" (§25/§27). No new
-- framework — a single control table in the unexposed `intel` schema, read only via helpers.

-- ---------- feature flags (internal; service_role only) ----------
create table intel.ci_feature_flag (
  flag        text primary key,
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table intel.ci_feature_flag enable row level security;   -- no client policy → deny all
revoke all on table intel.ci_feature_flag from anon, authenticated;
grant select, insert, update, delete on table intel.ci_feature_flag to service_role;
drop trigger if exists ci_flag_updated_at on intel.ci_feature_flag;
create trigger ci_flag_updated_at before update on intel.ci_feature_flag
  for each row execute function intel.tg_set_updated_at();

-- Phase 2B ships DARK: the flag exists and is OFF by default.
insert into intel.ci_feature_flag(flag, enabled) values ('creator_profile_api', false)
  on conflict (flag) do nothing;

-- ---------- helpers (SECURITY DEFINER, fixed empty search_path, not client-executable) ----------

-- fail-closed flag read: missing/false ⇒ disabled
create or replace function intel.ci_feature_enabled(p_flag text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.enabled from intel.ci_feature_flag f where f.flag = p_flag), false);
$$;

create or replace function intel.ci_assert_api_enabled(p_flag text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not intel.ci_feature_enabled(p_flag) then
    raise exception 'creator-intelligence feature % is disabled', p_flag using errcode = '0A000';
  end if;
end;
$$;

-- Resolve the CALLER's own creator identity from auth context (never from client input).
-- Requires an un-revoked 'self' actor-access row. Fail-closed on unauthenticated / unlinked.
create or replace function intel.ci_caller_identity()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select a.identity_id into v_identity
  from intel.ci_identity_actor_access a
  where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null
  order by a.granted_at
  limit 1;
  if v_identity is null then
    raise exception 'no creator identity for caller' using errcode = '42501';
  end if;
  return v_identity;
end;
$$;

-- Does the caller hold ANY un-revoked actor access to the given identity? (representative reads)
create or replace function intel.ci_caller_can_access(p_identity_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return false; end if;
  return exists (
    select 1 from intel.ci_identity_actor_access a
    where a.identity_id = p_identity_id and a.member_id = v_uid and a.revoked_at is null
  );
end;
$$;

-- Reject any patch key not in the allowed set (blocks unsupported / protected fields).
create or replace function intel.ci_reject_unknown_keys(p_patch jsonb, p_allowed text[])
returns void language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (p_allowed)) then
      raise exception 'unsupported field: %', k using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- Metadata-only audit event (no old/new values, no PII, no hashes).
create or replace function intel.ci_write_audit(
  p_identity uuid, p_record_table text, p_record_id uuid, p_field_key text,
  p_operation text, p_correlation text)
returns void language sql security definer set search_path = '' as $$
  insert into private.creator_profile_edit_event
    (identity_id, record_table, record_id, field_key, operation,
     acting_member_id, authority_source, correlation_id)
  values (p_identity, p_record_table, p_record_id, p_field_key, p_operation,
          auth.uid(), 'self', p_correlation);
$$;

-- Internal helpers are never client-callable (defence in depth; default-privileges already
-- revoke execute from public for future intel functions, but we are explicit).
revoke all on function intel.ci_feature_enabled(text)          from public, anon, authenticated;
revoke all on function intel.ci_assert_api_enabled(text)       from public, anon, authenticated;
revoke all on function intel.ci_caller_identity()              from public, anon, authenticated;
revoke all on function intel.ci_caller_can_access(uuid)        from public, anon, authenticated;
revoke all on function intel.ci_reject_unknown_keys(jsonb, text[]) from public, anon, authenticated;
revoke all on function intel.ci_write_audit(uuid, text, uuid, text, text, text) from public, anon, authenticated;
