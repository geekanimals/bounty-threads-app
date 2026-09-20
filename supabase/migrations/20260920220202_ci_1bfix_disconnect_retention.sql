-- Phase 1B-fix (3/3): hardened disconnect (destroy Vault secret + provider-revocation record) and a
-- service-only retention purge. ADDITIVE. No prior migration edited. No PII in events/counts.

-- ---------- internal: destroy a Vault secret by reference, then verify it is unreadable ----------
create or replace function intel.ci_vault_destroy(p_ref text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_gone boolean;
begin
  if p_ref is null then return true; end if;
  begin v_id := p_ref::uuid; exception when others then return true; end;  -- non-uuid ref => nothing to destroy
  delete from vault.secrets where id = v_id;
  select not exists (select 1 from vault.secrets where id = v_id) into v_gone;  -- verify unretrievable
  return v_gone;
end; $$;
revoke all on function intel.ci_vault_destroy(text) from public, anon, authenticated;

-- ---------- internal: fully destroy an owned connection's secret + revocation record ----------
create or replace function intel.ci_destroy_connection_secret(p_connection uuid, p_actor uuid, p_identity uuid, p_correlation text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ref text; v_gone boolean; v_scope text;
begin
  select token_reference into v_ref from intel.ci_platform_connection where connection_id = p_connection for update;
  -- 2/3. Provider revocation: Instagram Login access tokens have NO documented programmatic revocation
  --      endpoint (revocation is via the user's Instagram app settings). Record that truthfully.
  insert into intel.ci_connection_event(actor_member_id, identity_id, connection_id, action, result_status, authority_source, correlation_id)
    values (p_actor, p_identity, p_connection, 'provider_revoke', 'provider_revoke_unavailable', 'self', p_correlation);
  -- 4/5. Destroy the Vault secret and verify it is no longer retrievable.
  v_gone := intel.ci_vault_destroy(v_ref);
  if not v_gone then
    -- fail closed: never report success while a readable token could remain
    raise exception 'vault secret could not be destroyed' using errcode = '42501';
  end if;
  -- 6/7. Clear the reference + mark disconnected (secret is gone, not merely dereferenced).
  update intel.ci_platform_connection set token_reference = null, status = 'disconnected',
    state_reason = 'creator_disconnected', revoked_at = now(), updated_at = now()
  where connection_id = p_connection;
  insert into intel.ci_connection_event(actor_member_id, identity_id, connection_id, action, result_status, authority_source, correlation_id)
    values (p_actor, p_identity, p_connection, 'secret_destroyed', 'ok', 'self', p_correlation);
end; $$;
revoke all on function intel.ci_destroy_connection_secret(uuid,uuid,uuid,text) from public, anon, authenticated;

-- ---------- api.disconnect_platform (hardened; replaces the Phase 1B version) ----------
-- The Phase 1B version returned void; drop it first (return type change requires a drop).
drop function if exists api.disconnect_platform(uuid, text);
create or replace function api.disconnect_platform(p_connection_id uuid, p_correlation text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_own boolean;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_id := intel.ci_caller_identity();
  select exists (select 1 from intel.ci_platform_connection c
                 join intel.ci_identity_platform_account ipa on ipa.platform_account_id = c.platform_account_id and ipa.valid_to is null
                 where c.connection_id = p_connection_id and ipa.identity_id = v_id) into v_own;
  if not v_own then raise exception 'connection not found or not owned' using errcode = '42501'; end if;

  -- 1–7: revoke record + destroy Vault secret (verified) + clear ref + mark disconnected
  perform intel.ci_destroy_connection_secret(p_connection_id, auth.uid(), v_id, p_correlation);
  -- 8: cancel/terminate queued+running ingestion for this connection
  update intel.ci_ingest_run set status='cancelled' where connection_id = p_connection_id and status in ('queued','running');
  update intel.ci_ingest_stage set status='failed_terminal', dead_letter=true, lease_owner=null, lease_expires_at=null,
    availability_reason='disconnected', updated_at=now()
  where connection_id = p_connection_id and status in ('queued','running','failed_retryable');
  -- 10: append-only, non-PII event
  insert into intel.ci_connection_event(actor_member_id, identity_id, connection_id, action, result_status, authority_source, correlation_id)
    values (auth.uid(), v_id, p_connection_id, 'disconnect', 'ok', 'self', p_correlation);
  -- 9: the creator's manually-entered profile is intentionally NOT deleted.
  return jsonb_build_object('status','disconnected','secret_destroyed',true,'provider_revoke','provider_revoke_unavailable',
    'revoke_instructions','Remove Geek from Instagram → Settings → Apps and websites to revoke access at Meta.');
end; $$;
revoke all on function api.disconnect_platform(uuid,text) from public, anon;
grant execute on function api.disconnect_platform(uuid,text) to authenticated, service_role;

-- ============================ RETENTION PURGE (service_role only) ============================
-- Bounded, idempotent, auditable counts (no raw content). Removes ONLY expired temporary raw data and
-- expired OAuth state. NEVER touches creator profile/personal/professional data.
create or replace function intel.ci_purge_expired(p_limit int default 1000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_comments int; v_states int;
begin
  with del as (
    delete from private.ci_comment_raw
     where id in (select id from private.ci_comment_raw where retain_until is not null and retain_until < now() order by retain_until limit greatest(p_limit,1))
     returning 1)
  select count(*) into v_comments from del;

  with del as (
    delete from intel.ci_oauth_state
     where state_id in (select state_id from intel.ci_oauth_state
                        where expires_at < now() - interval '1 day' and status in ('consumed','failed','pending')
                        order by expires_at limit greatest(p_limit,1))
     returning 1)
  select count(*) into v_states from del;

  -- audit counts only (no bodies/keys/tokens)
  return jsonb_build_object('purged_raw_comments', v_comments, 'purged_oauth_states', v_states, 'as_of', now());
end; $$;
revoke all on function intel.ci_purge_expired(int) from public, anon, authenticated;
