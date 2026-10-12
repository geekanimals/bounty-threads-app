-- Worker RPCs for tracking / post-metrics / content-review. ADDITIVE.
-- intel is (correctly) never exposed to PostgREST, so these three workers failed with "Invalid schema: intel".
-- Same pattern as api.ops_outbox_* / api.ops_run_due_reminders: thin SECURITY DEFINER wrappers in the exposed
-- `api` schema, executable by service_role ONLY (anon/authenticated revoked).

create or replace function api.ops_shipments_to_track(p_limit int default 200)
returns table(shipment_id uuid, courier text, carrier_code text, tracking_ref text)
language sql stable security definer set search_path = '' as $$
  select * from intel.ci_shipments_to_track(p_limit) $$;
revoke all on function api.ops_shipments_to_track(int) from public, anon, authenticated;
grant execute on function api.ops_shipments_to_track(int) to service_role;

create or replace function api.ops_shipment_set_status(p_shipment uuid, p_status text, p_raw jsonb default '{}'::jsonb)
returns text language sql security definer set search_path = '' as $$
  select intel.ci_shipment_set_status(p_shipment, p_status, null, coalesce(p_raw, '{}'::jsonb)) $$;
revoke all on function api.ops_shipment_set_status(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function api.ops_shipment_set_status(uuid,text,jsonb) to service_role;

create or replace function api.ops_posts_to_track(p_limit int default 100)
returns table(post_id uuid, participation_id uuid, external_media_id text, media_type text)
language sql stable security definer set search_path = '' as $$
  select * from intel.ci_posts_to_track(p_limit) $$;
revoke all on function api.ops_posts_to_track(int) from public, anon, authenticated;
grant execute on function api.ops_posts_to_track(int) to service_role;

create or replace function api.ops_record_post_metric(p_post uuid, p_metrics jsonb)
returns uuid language sql security definer set search_path = '' as $$
  select intel.ci_record_post_metric(p_post, p_metrics, null) $$;
revoke all on function api.ops_record_post_metric(uuid,jsonb) from public, anon, authenticated;
grant execute on function api.ops_record_post_metric(uuid,jsonb) to service_role;

-- everything ops-content-review needs in one read: latest brief + deliverables for a participation
create or replace function api.ops_content_review_context(p_participation uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.participation_id is null then jsonb_build_object('found', false)
  else jsonb_build_object(
    'found', true,
    'brief', coalesce((select b.requirements from intel.ci_campaign_brief b
                        where b.campaign_id = p.campaign_id order by b.created_at desc limit 1), '{}'::jsonb),
    'deliverables', coalesce((select jsonb_agg(jsonb_build_object('content_format', d.content_format, 'quantity', d.quantity))
                               from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id), '[]'::jsonb))
  end
  from (select 1) one
  left join intel.ci_campaign_participation p on p.participation_id = p_participation $$;
revoke all on function api.ops_content_review_context(uuid) from public, anon, authenticated;
grant execute on function api.ops_content_review_context(uuid) to service_role;

create or replace function api.ops_record_content_check(p_participation uuid, p_subject_kind text, p_subject_id uuid,
  p_kind text, p_verdict text, p_findings jsonb, p_model text)
returns uuid language sql security definer set search_path = '' as $$
  select intel.ci_record_content_check(p_participation, p_subject_kind, p_subject_id, p_kind, p_verdict, p_findings, p_model) $$;
revoke all on function api.ops_record_content_check(uuid,text,uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function api.ops_record_content_check(uuid,text,uuid,text,text,jsonb,text) to service_role;
