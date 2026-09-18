-- Phase 0A dark foundation (2/6): identity, platform account, connection, operator, org.
-- ADDITIVE + DARK. See docs/CREATOR_INTELLIGENCE_ARCHITECTURE.md §6.1, §14.
--
-- Design invariants enforced here:
--   • ci_creator_identity carries NO platform id and NO member_id (it is the human entity).
--   • ci_platform_account is stable & unique per (platform, platform_user_id).
--   • Only ONE active connection per (platform_account_id, provider_app_environment).
--   • Merge/unmerge is append-only (guard trigger).
--   • Only an exact verified platform user id may reconcile; handle/name/email/fuzzy → review only.

-- ---------- the human/talent/creator entity (no platform id, no member_id) ----------
create table intel.ci_creator_identity (
  identity_id  uuid primary key default gen_random_uuid(),
  display_name text,
  kind         text not null default 'creator' check (kind in ('creator','celebrity','talent')),
  is_claimed   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- a real account on a platform ----------
create table intel.ci_platform_account (
  platform_account_id uuid primary key default gen_random_uuid(),
  platform            text not null,
  platform_user_id    text not null,
  username            text,
  account_type        text,
  status              text not null default 'active',
  first_seen_at       timestamptz not null default now(),
  last_verified_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ci_platform_account_uq unique (platform, platform_user_id)
);

-- ---------- identity <-> account over time (one identity -> many accounts) ----------
create table intel.ci_identity_platform_account (
  id                  uuid primary key default gen_random_uuid(),
  identity_id         uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid not null references intel.ci_platform_account(platform_account_id) on delete cascade,
  relationship        text,
  is_primary          boolean not null default false,
  valid_from          timestamptz not null default now(),
  valid_to            timestamptz,
  evidence            jsonb,
  created_at          timestamptz not null default now(),
  constraint ci_ipa_uq unique (identity_id, platform_account_id, valid_from)
);
create index ci_ipa_identity_idx on intel.ci_identity_platform_account(identity_id);
create index ci_ipa_account_idx  on intel.ci_identity_platform_account(platform_account_id);

-- ---------- a specific OAuth/token connection (token_reference points at Vault, never a token) ----------
create table intel.ci_platform_connection (
  connection_id            uuid primary key default gen_random_uuid(),
  platform_account_id      uuid not null references intel.ci_platform_account(platform_account_id) on delete cascade,
  provider_app_environment text not null default 'instagram:prod',
  authorised_by_member_id  uuid references auth.users(id) on delete set null,
  token_reference          text,               -- Vault secret name/id — NOT a token value
  status                   text not null default 'active' check (status in ('active','superseded','revoked','expired')),
  connected_at             timestamptz not null default now(),
  expires_at               timestamptz,
  revoked_at               timestamptz,
  supersedes_connection_id uuid references intel.ci_platform_connection(connection_id) on delete set null,
  activated_at             timestamptz,
  last_validated_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
-- exactly one ACTIVE connection per account + provider app/environment
create unique index ci_conn_one_active_uq
  on intel.ci_platform_connection(platform_account_id, provider_app_environment)
  where status = 'active';
create index ci_conn_account_idx on intel.ci_platform_connection(platform_account_id);
create index ci_conn_supersedes_idx on intel.ci_platform_connection(supersedes_connection_id);
create index ci_conn_authorised_by_idx on intel.ci_platform_connection(authorised_by_member_id);

-- ---------- who may operate an identity (many operators per identity; agent-managed ok) ----------
create table intel.ci_identity_actor_access (
  id          uuid primary key default gen_random_uuid(),
  identity_id uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  member_id   uuid not null references auth.users(id) on delete cascade,
  access_role text not null check (access_role in ('self','agent','manager','authorised_operator')),
  granted_by  uuid references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  evidence    jsonb,
  constraint ci_actor_uq unique (identity_id, member_id, access_role)
);
create index ci_actor_member_idx on intel.ci_identity_actor_access(member_id);

-- ---------- org-scoped CRM relationship (relationship-scoped access, not blanket "org") ----------
create table intel.ci_org_creator_relationship (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null,
  identity_id               uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  relationship_type         text not null check (relationship_type in ('roster','represented','managed','campaign_only','discovered')),
  access_scope              jsonb,
  assigned_manager_member_id uuid references auth.users(id) on delete set null,
  status                    text not null default 'active',
  source                    text,
  created_at                timestamptz not null default now(),
  ended_at                  timestamptz,
  constraint ci_org_creator_uq unique (org_id, identity_id, relationship_type)
);
create index ci_org_creator_org_idx on intel.ci_org_creator_relationship(org_id);
create index ci_org_creator_identity_idx on intel.ci_org_creator_relationship(identity_id);
create index ci_org_creator_mgr_idx on intel.ci_org_creator_relationship(assigned_manager_member_id);

-- ---------- append-only merge/unmerge ledger ----------
create table intel.ci_identity_merge_event (
  event_id           uuid primary key default gen_random_uuid(),
  event_type         text not null check (event_type in ('merge','unmerge')),
  source_identity_id uuid not null,
  target_identity_id uuid not null,
  reverses_event_id  uuid references intel.ci_identity_merge_event(event_id),
  reason             text,
  evidence           jsonb,
  performed_by       uuid references auth.users(id) on delete set null,
  performed_at       timestamptz not null default now(),
  constraint ci_merge_distinct_ck check (source_identity_id <> target_identity_id)
);
create index ci_merge_source_idx on intel.ci_identity_merge_event(source_identity_id);
create index ci_merge_target_idx on intel.ci_identity_merge_event(target_identity_id);

drop trigger if exists ci_merge_append_only on intel.ci_identity_merge_event;
create trigger ci_merge_append_only
  before update or delete on intel.ci_identity_merge_event
  for each row execute function intel.tg_block_mutation();

-- ---------- migration/reconciliation ledger ONLY (never the runtime relationship model) ----------
create table intel.ci_identity_link (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid references intel.ci_creator_identity(identity_id) on delete set null,
  entity_schema      text,
  entity_table       text,
  entity_id          uuid,
  match_method       text not null check (match_method in ('platform_user_id','member_id','handle_exact','name_fuzzy','email','manual')),
  confidence         numeric,
  review_status      text not null default 'candidate' check (review_status in ('candidate','approved','rejected')),
  reviewer_member_id uuid references auth.users(id) on delete set null,
  reviewed_at        timestamptz,
  evidence           jsonb,
  created_at         timestamptz not null default now()
);

create index ci_link_identity_idx on intel.ci_identity_link(identity_id);

-- updated_at triggers
drop trigger if exists ci_identity_set_updated_at on intel.ci_creator_identity;
create trigger ci_identity_set_updated_at before update on intel.ci_creator_identity
  for each row execute function intel.tg_set_updated_at();
drop trigger if exists ci_account_set_updated_at on intel.ci_platform_account;
create trigger ci_account_set_updated_at before update on intel.ci_platform_account
  for each row execute function intel.tg_set_updated_at();
drop trigger if exists ci_conn_set_updated_at on intel.ci_platform_connection;
create trigger ci_conn_set_updated_at before update on intel.ci_platform_connection
  for each row execute function intel.tg_set_updated_at();
