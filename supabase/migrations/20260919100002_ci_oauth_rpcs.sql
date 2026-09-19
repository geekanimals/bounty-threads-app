-- Phase 2C (2/3): OAuth RPCs. ADDITIVE + DARK + FAIL-CLOSED + SERVER-ENFORCED.
-- Security core lives here (state lifecycle, scope-from-returned-only, capability init,
-- identity anchoring by stable platform id, idempotent retry, token→Vault, audit).
-- The Edge Functions are thin HTTP shells that do the Meta fetch then call these.

-- ---------- helpers ----------
create or replace function intel.ci_hash_state(p_state text)
returns text language sql immutable security definer set search_path = extensions, pg_catalog as $$
  select encode(digest(p_state, 'sha256'), 'hex');
$$;
revoke all on function intel.ci_hash_state(text) from public, anon, authenticated;

-- Store a token in Vault, return the (non-secret) reference. Never returns the secret.
create or replace function intel.ci_vault_store(p_name text, p_secret text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := vault.create_secret(p_secret, p_name, 'creator-intelligence ig oauth token');
  return v_id::text;
end;
$$;
revoke all on function intel.ci_vault_store(text, text) from public, anon, authenticated;

-- ============================ START (authenticated actor) ============================
create or replace function api.ig_connect_start(
  p_provider text default 'instagram', p_app_environment text default 'prod', p_redirect_context text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_cfg intel.ci_provider_config; v_identity uuid; v_state text; v_hash text; v_state_id uuid;
begin
  perform intel.ci_assert_api_enabled('creator_ig_connect');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select * into v_cfg from intel.ci_provider_config where provider = p_provider and app_environment = p_app_environment;
  if v_cfg.provider is null then raise exception 'unsupported provider/app configuration' using errcode = '0A000'; end if;

  -- reuse the caller's existing 'self' identity if one exists (else it is resolved at callback)
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
    where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;

  v_state := encode(extensions.gen_random_bytes(32), 'hex');   -- CSPRNG, server-side; raw never stored
  v_hash  := intel.ci_hash_state(v_state);
  insert into intel.ci_oauth_state(state_hash, member_id, identity_id, provider, app_environment, redirect_context, expires_at)
  values (v_hash, v_uid, v_identity, p_provider, p_app_environment, p_redirect_context, now() + interval '10 minutes')
  returning state_id into v_state_id;

  insert into intel.ci_connection_event(actor_member_id, identity_id, action, result_status, authority_source, correlation_id)
  values (v_uid, v_identity, 'start', 'ok', 'self', v_state_id::text);

  return jsonb_build_object(
    'authorize_url', v_cfg.authorize_url
      || '?client_id=' || v_cfg.client_id
      || '&redirect_uri=' || v_cfg.redirect_uri
      || '&response_type=code'
      || '&scope=' || array_to_string(v_cfg.scopes, ',')
      || '&state=' || v_state,
    'state', v_state,                       -- the initiating browser's one-time CSRF token
    'expires_at', now() + interval '10 minutes'
  );
end;
$$;

-- ============================ CALLBACK COMPLETION (service-role / Edge only) ============================
-- Receives the ALREADY-EXCHANGED Meta results (the Edge Function did the HTTP). Atomic + idempotent.
create or replace function intel.ci_ig_complete_connection(
  p_state text, p_provider text, p_app_environment text,
  p_platform_user_id text, p_username text, p_account_type text,
  p_granted_scopes text[], p_token_secret text, p_token_expires_at timestamptz default null,
  p_notice_version text default null, p_correlation text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hash text; v_state intel.ci_oauth_state; v_member uuid; v_identity uuid; v_account uuid;
  v_pae text := p_provider || ':' || p_app_environment; v_ref text; v_conn uuid; v_ipa uuid;
  v_existing_identity uuid; v_notice text; s text;
begin
  if p_platform_user_id is null or p_platform_user_id = '' then
    raise exception 'missing stable platform account id' using errcode = '22023';
  end if;
  v_hash := intel.ci_hash_state(p_state);

  -- atomically consume a pending, unexpired state
  update intel.ci_oauth_state set status = 'consumed', consumed_at = now()
    where state_hash = v_hash and status = 'pending' and expires_at > now()
    returning * into v_state;

  if v_state.state_id is null then
    -- idempotent retry, expired, or invalid — decide without corrupting a prior success
    select * into v_state from intel.ci_oauth_state where state_hash = v_hash;
    if v_state.state_id is null then raise exception 'invalid oauth state' using errcode = '42501'; end if;
    if v_state.status = 'consumed' and v_state.connection_id is not null then
      return jsonb_build_object('connection_id', v_state.connection_id, 'identity_id', v_state.identity_id,
                                'status', 'connected', 'idempotent', true);
    end if;
    if v_state.expires_at <= now() then raise exception 'oauth state expired' using errcode = '42501'; end if;
    raise exception 'oauth state already used' using errcode = '42501';
  end if;

  v_member := v_state.member_id;
  v_notice := coalesce(p_notice_version,
                (select notice_version from intel.ci_provider_config where provider = p_provider and app_environment = p_app_environment));

  -- resolve/create the platform account ANCHORED ON THE STABLE PLATFORM USER ID (never the handle)
  select platform_account_id into v_account from intel.ci_platform_account
    where platform = p_provider and platform_user_id = p_platform_user_id;
  if v_account is null then
    insert into intel.ci_platform_account(platform, platform_user_id, username, account_type, last_verified_at)
    values (p_provider, p_platform_user_id, p_username, p_account_type, now())
    returning platform_account_id into v_account;
  else
    update intel.ci_platform_account set username = p_username, account_type = coalesce(p_account_type, account_type),
      last_verified_at = now(), updated_at = now() where platform_account_id = v_account;
  end if;

  -- identity anchoring + ambiguity / conflicting-ownership guards (fail closed)
  select ipa.identity_id into v_existing_identity from intel.ci_identity_platform_account ipa
    where ipa.platform_account_id = v_account and ipa.valid_to is null order by ipa.valid_from limit 1;
  if v_existing_identity is not null then
    if not exists (select 1 from intel.ci_identity_actor_access a
                   where a.identity_id = v_existing_identity and a.member_id = v_member and a.revoked_at is null) then
      insert into intel.ci_connection_event(actor_member_id, platform_account_id, action, result_status, authority_source, correlation_id)
      values (v_member, v_account, 'callback', 'conflict', 'self', p_correlation);
      raise exception 'platform account owned by another creator' using errcode = '42501';
    end if;
    if v_state.identity_id is not null and v_state.identity_id <> v_existing_identity then
      raise exception 'identity conflict for platform account' using errcode = '42501';
    end if;
    v_identity := v_existing_identity;
  else
    v_identity := v_state.identity_id;
    if v_identity is null then
      select a.identity_id into v_identity from intel.ci_identity_actor_access a
        where a.member_id = v_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
    end if;
    if v_identity is null then
      insert into intel.ci_creator_identity(display_name, kind, is_claimed) values (p_username, 'creator', true)
      returning identity_id into v_identity;
    end if;
    insert into intel.ci_identity_platform_account(identity_id, platform_account_id, relationship, is_primary)
    values (v_identity, v_account, 'owner', true)
    on conflict (identity_id, platform_account_id, valid_from) do nothing;
  end if;

  -- ensure the caller can operate this identity (self) — enables the Phase 2B profile draft
  insert into intel.ci_identity_actor_access(identity_id, member_id, access_role, granted_by)
  values (v_identity, v_member, 'self', v_member)
  on conflict (identity_id, member_id, access_role) do nothing;

  -- the identity↔account edge id (for capability switches)
  select id into v_ipa from intel.ci_identity_platform_account
    where identity_id = v_identity and platform_account_id = v_account and valid_to is null order by valid_from limit 1;

  -- token → Vault (reference only in the row; secret never stored in a column). Unique name per
  -- connection attempt so a reconnect creates a fresh secret rather than colliding on the name.
  v_ref := intel.ci_vault_store(
    'ig_conn:' || v_account::text || ':' || p_app_environment || ':' || encode(extensions.gen_random_bytes(6), 'hex'),
    p_token_secret);

  -- one active connection per (account, app-env): supersede any current active, then create the new one
  update intel.ci_platform_connection set status = 'superseded', updated_at = now()
    where platform_account_id = v_account and provider_app_environment = v_pae and status = 'active';
  insert into intel.ci_platform_connection(platform_account_id, provider_app_environment, authorised_by_member_id,
    token_reference, status, connected_at, expires_at, activated_at, last_validated_at)
  values (v_account, v_pae, v_member, v_ref, 'active', now(), p_token_expires_at, now(), now())
  returning connection_id into v_conn;

  update intel.ci_oauth_state set connection_id = v_conn where state_id = v_state.state_id;

  -- scope grants: ONLY actually-returned scopes are valid; declined stay recorded but invalid
  for s in select unnest(scopes) from intel.ci_provider_config where provider = p_provider and app_environment = p_app_environment loop
    insert into intel.ci_scope_grant(connection_id, scope, requested_at, granted_at, valid, verification_method, status_reason)
    values (v_conn, s, now(),
            case when s = any(p_granted_scopes) then now() else null end,
            (s = any(p_granted_scopes)), 'oauth_callback',
            case when s = any(p_granted_scopes) then 'granted' else 'declined' end)
    on conflict (connection_id, scope) do update set
      granted_at = excluded.granted_at, valid = excluded.valid, status_reason = excluded.status_reason,
      last_checked_at = now(), updated_at = now();
  end loop;

  -- capabilities: enable ONLY for granted scopes that map to a capability (default enabled)
  for s in select scope from intel.ci_scope_capability_map m where m.provider = p_provider and m.scope = any(p_granted_scopes) loop
    insert into intel.ci_capability_switch(identity_platform_account_id, capability, enabled, changed_by, consent_version)
    select v_ipa, m.capability, true, v_member, v_notice from intel.ci_scope_capability_map m
      where m.provider = p_provider and m.scope = s
    on conflict (identity_platform_account_id, capability) do update set enabled = true, changed_at = now(), updated_at = now();
  end loop;

  -- processing consent (notice version recorded; legal copy/retention live elsewhere — HOLD)
  insert into intel.ci_processing_consent(identity_id, accepting_actor_member_id, notice_version, purposes)
  values (v_identity, v_member, coalesce(v_notice, 'unspecified'), '{"creator_intelligence": true}'::jsonb);
  insert into intel.ci_processing_consent_event(identity_id, event_type, previous_state, new_state, notice_version, acting_member_id)
  values (v_identity, 'accepted', 'none', 'accepted', coalesce(v_notice, 'unspecified'), v_member);

  -- profile-draft hook: ensure a professional-profile shell + completion row exist (NO Meta prefill,
  -- NO auto-claimed identity fields; creator confirmation semantics stay intact)
  insert into intel.ci_creator_professional_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into intel.ci_profile_completion(identity_id) values (v_identity) on conflict (identity_id) do nothing;

  insert into intel.ci_connection_event(actor_member_id, identity_id, platform_account_id, connection_id, action, result_status, authority_source, correlation_id)
  values (v_member, v_identity, v_account, v_conn, 'callback', 'ok', 'self', p_correlation);

  return jsonb_build_object('connection_id', v_conn, 'identity_id', v_identity, 'platform_account_id', v_account,
                            'granted_scopes', to_jsonb(p_granted_scopes), 'status', 'connected', 'idempotent', false);
end;
$$;
revoke all on function intel.ci_ig_complete_connection(text, text, text, text, text, text, text[], text, timestamptz, text, text)
  from public, anon, authenticated;

-- ============================ LIST (authenticated actor; metadata only, NO token) ============================
create or replace function api.get_my_connections()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('creator_ig_connect');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'connection_id', c.connection_id, 'identity_id', ipa.identity_id, 'platform', pa.platform,
      'username', pa.username, 'status', c.status, 'connected_at', c.connected_at, 'expires_at', c.expires_at,
      'granted_scopes', coalesce((select jsonb_agg(g.scope order by g.scope) from intel.ci_scope_grant g
                                  where g.connection_id = c.connection_id and g.valid), '[]'::jsonb),
      'capabilities', coalesce((select jsonb_agg(jsonb_build_object('capability', cs.capability, 'enabled', cs.enabled) order by cs.capability)
                                from intel.ci_capability_switch cs where cs.identity_platform_account_id = ipa.id), '[]'::jsonb)
      -- NOTE: token_reference is deliberately NEVER selected here.
    ) order by c.connected_at desc)
    from intel.ci_identity_actor_access a
    join intel.ci_identity_platform_account ipa on ipa.identity_id = a.identity_id and ipa.valid_to is null
    join intel.ci_platform_account pa on pa.platform_account_id = ipa.platform_account_id
    join intel.ci_platform_connection c on c.platform_account_id = pa.platform_account_id
    where a.member_id = v_uid and a.revoked_at is null
  ), '[]'::jsonb);
end;
$$;
