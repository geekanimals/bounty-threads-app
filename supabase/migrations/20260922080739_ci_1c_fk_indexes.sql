-- Phase 1C — index hardening. ADDITIVE. Covering indexes for the Creator Intelligence FKs that sit on
-- actual query paths (identity/account joins, observation->ingest-run joins, retention/deletion paths).
-- Non-duplicate (create index if not exists; column not already the leading key of an existing index).
-- Pure member-id ATTRIBUTION FKs (changed_by/granted_by/acting_member_id/verified_by/performed_by/
-- reviewer_member_id/accepting_actor_member_id/reverses_event_id/profile_image_source_account) are
-- deliberately NOT indexed: they are never the driving side of a CI query (no speculative indexes).

-- identity / account joins on observation tables
create index if not exists ci_account_snap_identity_idx   on intel.ci_account_snapshots(identity_id);
create index if not exists ci_audience_identity_idx        on intel.ci_audience_observations(identity_id);
create index if not exists ci_comments_account_idx         on intel.ci_comments(platform_account_id);
create index if not exists ci_comments_media_idx           on intel.ci_comments(media_row_id);
create index if not exists ci_mentions_account_idx         on intel.ci_mentions(platform_account_id);
create index if not exists ci_mentions_media_idx           on intel.ci_mentions(media_row_id);
create index if not exists ci_messaging_identity_idx       on intel.ci_messaging_operational(identity_id);
create index if not exists ci_messaging_account_idx        on intel.ci_messaging_operational(platform_account_id);
create index if not exists ci_ingest_stage_identity_idx    on intel.ci_ingest_stage(identity_id);
create index if not exists ci_ingest_run_account_idx       on intel.ci_ingest_run(platform_account_id);
create index if not exists ci_ingest_run_connection_idx    on intel.ci_ingest_run(connection_id);

-- observation -> ingest-run joins (retention/deletion + lineage paths)
create index if not exists ci_account_snap_run_idx         on intel.ci_account_snapshots(ingest_run_id);
create index if not exists ci_audience_run_idx             on intel.ci_audience_observations(ingest_run_id);
create index if not exists ci_media_insights_run_idx       on intel.ci_media_insights(ingest_run_id);
create index if not exists ci_media_version_run_idx        on intel.ci_media_version(ingest_run_id);
create index if not exists ci_comments_run_idx             on intel.ci_comments(ingest_run_id);
create index if not exists ci_mentions_run_idx             on intel.ci_mentions(ingest_run_id);
create index if not exists ci_messaging_run_idx            on intel.ci_messaging_operational(ingest_run_id);

-- retention/deletion path: expired OAuth state lookup joins identity
create index if not exists ci_oauth_state_identity_idx     on intel.ci_oauth_state(identity_id);
