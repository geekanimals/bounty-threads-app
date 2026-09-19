-- Phase 2C (1/3): secure Instagram connection / OAuth foundation. ADDITIVE + DARK.
-- Provider config (API version + scopes explicit/configurable), scope→capability map,
-- one-time OAuth state (hash-stored), and an append-only connection audit ledger.
-- No token/code/state secret is ever stored here. Legacy social_tokens is untouched.

create extension if not exists supabase_vault;   -- token secrets go to Vault (never plaintext columns)

-- ---------- provider / app configuration (non-secret; app SECRET lives only in Edge env) ----------
create table intel.ci_provider_config (
  provider          text not null,
  app_environment   text not null,
  api_version       text not null,            -- explicit + configurable (do not hardcode in code)
  client_id         text,                     -- public OAuth client id (NOT a secret)
  authorize_url     text not null,
  token_exchange_url text not null,
  graph_base_url    text not null,
  redirect_uri      text not null,
  scopes            text[] not null,          -- canonical permissions requested together
  notice_version    text,                     -- current processing-notice version (copy lives elsewhere)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (provider, app_environment)
);
alter table intel.ci_provider_config enable row level security;
revoke all on table intel.ci_provider_config from anon, authenticated;
grant select, insert, update, delete on table intel.ci_provider_config to service_role;
drop trigger if exists ci_provider_config_updated_at on intel.ci_provider_config;
create trigger ci_provider_config_updated_at before update on intel.ci_provider_config
  for each row execute function intel.tg_set_updated_at();

-- Seed the Instagram Login config (active flow endpoints; version is configurable here, not in code).
insert into intel.ci_provider_config
  (provider, app_environment, api_version, client_id, authorize_url, token_exchange_url, graph_base_url, redirect_uri, scopes, notice_version)
values
  ('instagram','prod','v21.0','__SET_VIA_CONFIG__',
   'https://www.instagram.com/oauth/authorize',
   'https://api.instagram.com/oauth/access_token',
   'https://graph.instagram.com',
   'https://example.invalid/ig/callback',
   array['instagram_business_basic','instagram_business_manage_insights','instagram_business_manage_comments',
         'instagram_business_manage_messages','instagram_business_content_publish'],
   'notice-2026-09-18')
on conflict (provider, app_environment) do nothing;

-- ---------- scope → internal capability map (scopes ≠ capabilities) ----------
create table intel.ci_scope_capability_map (
  provider   text not null,
  scope      text not null,
  capability text not null check (capability in
              ('performance_insights','comment_intelligence','campaign_messaging_intelligence','publishing_scheduling')),
  primary key (provider, scope)
);
alter table intel.ci_scope_capability_map enable row level security;
revoke all on table intel.ci_scope_capability_map from anon, authenticated;
grant select, insert, update, delete on table intel.ci_scope_capability_map to service_role;
insert into intel.ci_scope_capability_map(provider, scope, capability) values
  ('instagram','instagram_business_manage_insights','performance_insights'),
  ('instagram','instagram_business_manage_comments','comment_intelligence'),
  ('instagram','instagram_business_manage_messages','campaign_messaging_intelligence'),
  ('instagram','instagram_business_content_publish','publishing_scheduling')
on conflict (provider, scope) do nothing;
-- NB: instagram_business_basic is required for the connection and maps to NO toggleable capability.

-- Seed app-level Meta approval (factual config; all five approved 2026-09-18 per architecture §6.2).
insert into intel.ci_app_scope_capability(provider, app_environment, scope, app_review_status, approved_at, api_version)
select 'instagram','prod', s, 'approved', timestamptz '2026-09-18', 'v21.0'
from unnest(array['instagram_business_basic','instagram_business_manage_insights','instagram_business_manage_comments',
                  'instagram_business_manage_messages','instagram_business_content_publish']) s
on conflict (provider, app_environment, scope) do nothing;

-- ---------- one-time OAuth state (raw secret NEVER stored; only its hash) ----------
create table intel.ci_oauth_state (
  state_id         uuid primary key default gen_random_uuid(),
  state_hash       text not null unique,      -- sha256(hex) of the CSPRNG state; raw is never stored
  member_id        uuid not null references auth.users(id) on delete cascade,
  identity_id      uuid references intel.ci_creator_identity(identity_id) on delete set null,
  provider         text not null,
  app_environment  text not null,
  redirect_context text,
  connection_id    uuid,                      -- set on successful completion (idempotent retries)
  status           text not null default 'pending' check (status in ('pending','consumed','failed')),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  consumed_at      timestamptz
);
create index ci_oauth_state_member_idx on intel.ci_oauth_state(member_id);
alter table intel.ci_oauth_state enable row level security;
revoke all on table intel.ci_oauth_state from anon, authenticated;
grant select, insert, update, delete on table intel.ci_oauth_state to service_role;

-- ---------- append-only connection / OAuth audit (metadata only; NO token/code/state) ----------
create table intel.ci_connection_event (
  event_id           uuid primary key default gen_random_uuid(),
  actor_member_id    uuid references auth.users(id) on delete set null,
  identity_id        uuid,
  platform_account_id uuid,
  connection_id      uuid,
  action             text not null,           -- start | callback | scope_grant | capability_init | fail
  result_status      text not null,           -- ok | denied | invalid_state | expired | conflict | error
  scope              text,
  authority_source   text,
  correlation_id     text,
  occurred_at        timestamptz not null default now()
);
create index ci_conn_event_actor_idx on intel.ci_connection_event(actor_member_id);
create index ci_conn_event_conn_idx  on intel.ci_connection_event(connection_id);
alter table intel.ci_connection_event enable row level security;
revoke all on table intel.ci_connection_event from anon, authenticated;
grant select, insert, update, delete on table intel.ci_connection_event to service_role;
drop trigger if exists ci_conn_event_append_only on intel.ci_connection_event;
create trigger ci_conn_event_append_only before update or delete on intel.ci_connection_event
  for each row execute function intel.tg_block_mutation();

-- Phase 2C ships DARK: the connection feature flag exists and is OFF by default.
insert into intel.ci_feature_flag(flag, enabled) values ('creator_ig_connect', false)
  on conflict (flag) do nothing;
