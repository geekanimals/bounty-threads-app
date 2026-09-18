-- Phase 0A dark foundation (5/6): four control systems (app scope / connection grant /
-- capability switch / processing consent) + visibility. ADDITIVE + DARK.
-- See docs/CREATOR_INTELLIGENCE_ARCHITECTURE.md §14. No `ci_consent`, no `granted_to_org`.

-- ---------- app-level Meta approval (per provider/app-environment/scope) ----------
create table intel.ci_app_scope_capability (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  app_environment  text not null,
  scope            text not null,
  app_review_status text not null default 'unknown',
  approved_at      timestamptz,
  last_verified_at timestamptz,
  api_version      text,
  evidence         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ci_app_scope_uq unique (provider, app_environment, scope)
);

-- ---------- connection-level grant (owned by ci_platform_connection) ----------
create table intel.ci_scope_grant (
  id                 uuid primary key default gen_random_uuid(),
  connection_id      uuid not null references intel.ci_platform_connection(connection_id) on delete cascade,
  scope              text not null,
  requested_at       timestamptz,
  granted_at         timestamptz,
  last_checked_at    timestamptz,
  valid              boolean not null default false,
  revoked_at         timestamptz,
  status_reason      text,
  verification_method text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ci_scope_grant_uq unique (connection_id, scope)
);

-- ---------- internal capability switch (owned by identity<->account relationship; survives reconnect) ----------
create table intel.ci_capability_switch (
  id                          uuid primary key default gen_random_uuid(),
  identity_platform_account_id uuid not null references intel.ci_identity_platform_account(id) on delete cascade,
  capability                  text not null check (capability in
                                ('performance_insights','comment_intelligence',
                                 'campaign_messaging_intelligence','publishing_scheduling')),
  enabled                     boolean not null default true,
  changed_by                  uuid references auth.users(id) on delete set null,
  changed_at                  timestamptz not null default now(),
  consent_version             text,
  retention_treatment         text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint ci_capability_uq unique (identity_platform_account_id, capability)
);

-- ---------- processing consent (privacy notice/purpose/version accepted) ----------
create table intel.ci_processing_consent (
  id                        uuid primary key default gen_random_uuid(),
  identity_id               uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  accepting_actor_member_id uuid references auth.users(id) on delete set null,
  authority_evidence        jsonb,
  notice_version            text not null,
  purposes                  jsonb,
  accepted_at               timestamptz not null default now(),
  withdrawn_at              timestamptz,
  created_at                timestamptz not null default now()
);
create index ci_processing_consent_identity_idx on intel.ci_processing_consent(identity_id);

-- ---------- field/group visibility tiers ----------
create table intel.ci_profile_visibility (
  id             uuid primary key default gen_random_uuid(),
  identity_id    uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  field_or_group text not null,
  tier           text not null check (tier in
                    ('private','authorised_representative','organisation_roster',
                     'marketplace_summary','campaign_specific','public_media_kit')),
  allowed        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ci_visibility_uq unique (identity_id, field_or_group, tier)
);

-- updated_at triggers
drop trigger if exists ctrl_app_scope_updated_at on intel.ci_app_scope_capability;
create trigger ctrl_app_scope_updated_at before update on intel.ci_app_scope_capability for each row execute function intel.tg_set_updated_at();
drop trigger if exists ctrl_scope_grant_updated_at on intel.ci_scope_grant;
create trigger ctrl_scope_grant_updated_at before update on intel.ci_scope_grant for each row execute function intel.tg_set_updated_at();
drop trigger if exists ctrl_capability_updated_at on intel.ci_capability_switch;
create trigger ctrl_capability_updated_at before update on intel.ci_capability_switch for each row execute function intel.tg_set_updated_at();
drop trigger if exists ctrl_visibility_updated_at on intel.ci_profile_visibility;
create trigger ctrl_visibility_updated_at before update on intel.ci_profile_visibility for each row execute function intel.tg_set_updated_at();

-- ========================================================================
-- APPEND-ONLY CONTROL EVENT HISTORY
-- The current-state tables above are kept for efficient reads; these ledgers
-- record every change. Rows are immutable (block-mutation trigger). They store
-- STATE/VERSION only — never tokens, message content, addresses, phone, email or DOB.
-- ========================================================================

-- capability-switch change events
create table intel.ci_capability_switch_event (
  event_id                     uuid primary key default gen_random_uuid(),
  identity_id                  uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  identity_platform_account_id uuid references intel.ci_identity_platform_account(id) on delete set null,
  capability                   text not null,
  previous_state               boolean,          -- previous enabled/disabled (null on first set)
  new_state                    boolean not null,
  acting_member_id             uuid references auth.users(id) on delete set null,
  authority_evidence           jsonb,
  notice_version               text,
  reason_source                text,
  changed_at                   timestamptz not null default now()
);
create index ci_cap_event_identity_idx on intel.ci_capability_switch_event(identity_id);
create index ci_cap_event_ipa_idx      on intel.ci_capability_switch_event(identity_platform_account_id);
drop trigger if exists ci_cap_event_append_only on intel.ci_capability_switch_event;
create trigger ci_cap_event_append_only before update or delete on intel.ci_capability_switch_event
  for each row execute function intel.tg_block_mutation();

-- processing-consent acceptance/withdrawal events
create table intel.ci_processing_consent_event (
  event_id           uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  event_type         text not null check (event_type in ('accepted','withdrawn','updated')),
  previous_state     text,                       -- e.g. 'none' | 'accepted' | 'withdrawn'
  new_state          text not null,
  notice_version     text not null,
  purposes           jsonb,                      -- processing-purpose descriptors (not PII)
  acting_member_id   uuid references auth.users(id) on delete set null,
  authority_evidence jsonb,
  reason_source      text,
  changed_at         timestamptz not null default now()
);
create index ci_consent_event_identity_idx on intel.ci_processing_consent_event(identity_id);
drop trigger if exists ci_consent_event_append_only on intel.ci_processing_consent_event;
create trigger ci_consent_event_append_only before update or delete on intel.ci_processing_consent_event
  for each row execute function intel.tg_block_mutation();

-- profile-visibility change events
create table intel.ci_profile_visibility_event (
  event_id         uuid primary key default gen_random_uuid(),
  identity_id      uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  field_or_group   text not null,
  tier             text not null,
  previous_allowed boolean,
  new_allowed      boolean not null,
  acting_member_id uuid references auth.users(id) on delete set null,
  authority_evidence jsonb,
  reason_source    text,
  changed_at       timestamptz not null default now()
);
create index ci_vis_event_identity_idx on intel.ci_profile_visibility_event(identity_id);
drop trigger if exists ci_vis_event_append_only on intel.ci_profile_visibility_event;
create trigger ci_vis_event_append_only before update or delete on intel.ci_profile_visibility_event
  for each row execute function intel.tg_block_mutation();
