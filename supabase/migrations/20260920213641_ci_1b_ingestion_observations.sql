-- Phase 1B (1/2): ingestion runs/stages + append-only observations + audience demographics.
-- ADDITIVE + DARK. intel/private only; no legacy public object touched. Observations are append-only
-- (block-mutation trigger), carry the standard raw-observation envelope, dedupe by idempotency_key,
-- and NEVER store an unavailable value as 0 (unavailable => NULL + a reason). Writers are service_role
-- only, capability- and connection-aware (fail-closed). "Latest" projections are separate from raw.

-- ============================ RUN / STAGE ORCHESTRATION ============================
create table intel.ci_ingest_run (
  run_id             uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid references intel.ci_platform_account(platform_account_id) on delete set null,
  connection_id      uuid references intel.ci_platform_connection(connection_id) on delete set null,
  trigger            text not null default 'initial_connect',
  api_version        text,
  status             text not null default 'queued'
                       check (status in ('queued','running','complete','partial','failed_terminal','cancelled')),
  started_at         timestamptz,
  completed_at       timestamptz,
  freshness_at       timestamptz,
  correlation_id     text,
  created_at         timestamptz not null default now()
);
create index ci_ingest_run_identity_idx on intel.ci_ingest_run(identity_id, created_at desc);

create table intel.ci_ingest_stage (
  stage_id           uuid primary key default gen_random_uuid(),
  run_id             uuid not null references intel.ci_ingest_run(run_id) on delete cascade,
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid,
  connection_id      uuid,
  stage              text not null check (stage in
                       ('scope_verify','account','media','account_insights','media_insights',
                        'audience','mentions','comments','messaging','completion')),
  capability         text,
  status             text not null default 'queued' check (status in
                       ('queued','running','complete','partial','insufficient_data','permission_missing',
                        'capability_disabled','threshold_not_met','unsupported','rate_limited','token_expired',
                        'reconnect_required','provider_error','failed_retryable','failed_terminal')),
  attempt            integer not null default 0,
  cursor             text,
  records_requested  integer,
  records_received   integer,
  records_written    integer,
  availability_reason text,
  error_class        text,           -- classification only; never a token/secret/full payload
  api_version        text,
  source_observed_at timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint ci_ingest_stage_uq unique (run_id, stage)
);
create index ci_ingest_stage_run_idx on intel.ci_ingest_stage(run_id);
drop trigger if exists ci_ingest_stage_upd on intel.ci_ingest_stage;
create trigger ci_ingest_stage_upd before update on intel.ci_ingest_stage for each row execute function intel.tg_set_updated_at();

-- ============================ APPEND-ONLY OBSERVATIONS ============================
-- standard raw-observation envelope columns are repeated per table (source_observed_at, captured_at,
-- ingest_run_id, source_record_id, payload_hash, idempotency_key, source, api_version, status).

create table intel.ci_account_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid not null references intel.ci_platform_account(platform_account_id) on delete cascade,
  followers_count    integer,        -- NULL when unavailable (never 0-as-unavailable)
  follows_count      integer,
  media_count        integer,
  reach              integer,
  accounts_engaged   integer,
  total_interactions integer,
  source_observed_at timestamptz,
  captured_at        timestamptz not null default now(),
  ingest_run_id      uuid references intel.ci_ingest_run(run_id) on delete set null,
  source_record_id   text,
  payload_hash       text,
  idempotency_key    text not null,
  source             text not null default 'instagram',
  api_version        text,
  status             text not null default 'available'
                       check (status in ('available','insufficient_data','permission_missing','token_expired','api_error')),
  constraint ci_account_snap_idem_uq unique (idempotency_key)
);
create index ci_account_snap_idx on intel.ci_account_snapshots(platform_account_id, captured_at desc);

create table intel.ci_media (
  media_row_id       uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references intel.ci_platform_account(platform_account_id) on delete cascade,
  platform_media_id  text not null,
  media_type         text,
  media_product_type text,
  permalink          text,
  media_timestamp    timestamptz,
  first_observed_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint ci_media_uq unique (platform_account_id, platform_media_id)
);
create table intel.ci_media_version (
  version_id         uuid primary key default gen_random_uuid(),
  media_row_id       uuid not null references intel.ci_media(media_row_id) on delete cascade,
  caption            text,
  thumbnail_ref      text,
  owner_info         jsonb,
  source_observed_at timestamptz,
  captured_at        timestamptz not null default now(),
  ingest_run_id      uuid references intel.ci_ingest_run(run_id) on delete set null,
  payload_hash       text,
  idempotency_key    text not null,
  api_version        text,
  constraint ci_media_version_idem_uq unique (idempotency_key)
);
create index ci_media_version_media_idx on intel.ci_media_version(media_row_id, captured_at desc);

create table intel.ci_media_insights (
  id                 uuid primary key default gen_random_uuid(),
  media_row_id       uuid not null references intel.ci_media(media_row_id) on delete cascade,
  metric_name        text not null,
  value_count        integer,        -- NULL when unavailable
  source_observed_at timestamptz,
  captured_at        timestamptz not null default now(),
  ingest_run_id      uuid references intel.ci_ingest_run(run_id) on delete set null,
  idempotency_key    text not null,
  api_version        text,
  status             text not null default 'available'
                       check (status in ('available','unsupported','insufficient_data','permission_missing','api_error')),
  availability_reason text,
  constraint ci_media_insights_idem_uq unique (idempotency_key)
);
create index ci_media_insights_idx on intel.ci_media_insights(media_row_id, metric_name, captured_at desc);

-- ---------- AUDIENCE (mandatory) ----------
create table intel.ci_audience_observations (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid not null references intel.ci_platform_account(platform_account_id) on delete cascade,
  metric_name        text not null,   -- follower_demographics | engaged_audience_demographics (VERIFIED)
  audience_type      text not null check (audience_type in ('follower','engaged')),
  breakdown_type     text check (breakdown_type in ('age','gender','city','country')),
  dimension_key      text,            -- Meta's exact bucket (e.g. "25-34", "F", "Mumbai", "IN")
  dimension_value    text,
  value_count        integer,         -- NULL when unavailable/suppressed (never 0-as-unavailable)
  calculated_percentage numeric,
  period             text,            -- lifetime
  timeframe          text,            -- this_month | this_week | prev_month
  sample_size        integer,
  audience_total     integer,
  source_observed_at timestamptz,
  captured_at        timestamptz not null default now(),
  ingest_run_id      uuid references intel.ci_ingest_run(run_id) on delete set null,
  payload_hash       text,
  idempotency_key    text not null,
  api_version        text,
  status             text not null default 'available' check (status in
                       ('available','insufficient_audience','threshold_not_met','suppressed',
                        'permission_missing','unsupported_account','unsupported_metric','provider_error')),
  suppression_reason text,
  constraint ci_audience_idem_uq unique (idempotency_key)
);
create index ci_audience_idx on intel.ci_audience_observations(platform_account_id, metric_name, breakdown_type, captured_at desc);

-- ---------- MENTIONS / COMMENTS (raw content in a RESTRICTED private store) ----------
create table intel.ci_mentions (
  id                 uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references intel.ci_platform_account(platform_account_id) on delete cascade,
  media_row_id       uuid references intel.ci_media(media_row_id) on delete set null,
  mention_ref_hash   text,            -- pseudonymised source ref (never raw external identity)
  detected_at        timestamptz,
  source_observed_at timestamptz,
  captured_at        timestamptz not null default now(),
  ingest_run_id      uuid references intel.ci_ingest_run(run_id) on delete set null,
  idempotency_key    text not null,
  api_version        text,
  constraint ci_mentions_idem_uq unique (idempotency_key)
);
create table intel.ci_comments (
  id                 uuid primary key default gen_random_uuid(),
  media_row_id       uuid references intel.ci_media(media_row_id) on delete set null,
  platform_account_id uuid not null references intel.ci_platform_account(platform_account_id) on delete cascade,
  author_ref_hash    text,            -- pseudonymised external participant id (NOT raw identity)
  comment_ref        text,            -- Meta comment id (opaque)
  comment_timestamp  timestamptz,
  captured_at        timestamptz not null default now(),
  ingest_run_id      uuid references intel.ci_ingest_run(run_id) on delete set null,
  idempotency_key    text not null,
  api_version        text,
  constraint ci_comments_idem_uq unique (idempotency_key)
);
-- raw comment BODY lives ONLY here (restricted, service-role only, retention configurable elsewhere).
create table private.ci_comment_raw (
  id                 uuid primary key default gen_random_uuid(),
  comment_id         uuid not null references intel.ci_comments(id) on delete cascade,
  body               text,            -- raw text; NEVER exposed through creator/brand search
  retain_until       timestamptz,     -- configurable retention (no hardcoded permanent retention)
  created_at         timestamptz not null default now()
);

-- ---------- MESSAGING (derived operational metadata only; NO raw bodies) ----------
create table intel.ci_messaging_operational (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid references intel.ci_platform_account(platform_account_id) on delete set null,
  campaign_id        uuid,            -- soft ref; only campaign-operational conversations
  thread_ref_hash    text not null,   -- hashed thread reference (never raw)
  participant_ref_hash text,          -- hashed participant reference (never raw)
  first_response_latency_seconds integer,
  response_state     text check (response_state is null or response_state in ('responded','no_response','missing_permission','token_expired')),
  message_count      integer,
  last_operational_at timestamptz,
  source_observed_at timestamptz,
  captured_at        timestamptz not null default now(),
  ingest_run_id      uuid references intel.ci_ingest_run(run_id) on delete set null,
  idempotency_key    text not null,
  constraint ci_messaging_idem_uq unique (idempotency_key)
);

-- ---------- SERVED / CURRENT projection (derived; separate from raw) ----------
create table intel.ci_metric (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid,
  metric_key         text not null,
  value_num          numeric,
  value_json         jsonb,
  status             text not null default 'ok' check (status in ('ok','insufficient_data','unavailable','missing_permission','token_expired','api_error')),
  window_label       text,
  is_estimate        boolean not null default false,
  computed_at        timestamptz not null default now(),
  compute_run_id     uuid,
  constraint ci_metric_uq unique (identity_id, metric_key, window_label)
);

-- append-only enforcement on raw observation tables
do $$ declare t text; begin
  foreach t in array array['ci_account_snapshots','ci_media_version','ci_media_insights',
                           'ci_audience_observations','ci_mentions','ci_comments','ci_messaging_operational'] loop
    execute format('drop trigger if exists %I on intel.%I', t||'_append_only', t);
    execute format('create trigger %I before update or delete on intel.%I for each row execute function intel.tg_block_mutation()', t||'_append_only', t);
  end loop; end $$;

-- ============================ RLS + GRANTS (service_role only for internal tables) ============================
do $$ declare t text; begin
  foreach t in array array['ci_ingest_run','ci_ingest_stage','ci_account_snapshots','ci_media','ci_media_version',
    'ci_media_insights','ci_audience_observations','ci_mentions','ci_comments','ci_messaging_operational','ci_metric'] loop
    execute format('alter table intel.%I enable row level security', t);
    execute format('revoke all on table intel.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table intel.%I to service_role', t);
  end loop; end $$;
alter table private.ci_comment_raw enable row level security;
revoke all on table private.ci_comment_raw from anon, authenticated;
grant select, insert, update, delete on table private.ci_comment_raw to service_role;

-- ============================ LATEST projections (reachable only via definer fns / service_role) ============================
create view intel.ci_account_latest as
  select distinct on (platform_account_id) platform_account_id, followers_count, follows_count, media_count,
         reach, accounts_engaged, total_interactions, status, captured_at, source_observed_at
  from intel.ci_account_snapshots order by platform_account_id, captured_at desc;
revoke all on intel.ci_account_latest from anon, authenticated;
grant select on intel.ci_account_latest to service_role;
