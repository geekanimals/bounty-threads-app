-- Phase 1E Operations — internal agency-operator allowlist, onboarding funnel events, feedback link. ADDITIVE.
-- The operator allowlist is the server-enforced gate for all campaign-WRITE operations (create/invite/ship/
-- approve/export). Separate from platform_admins by decision. Onboarding events are append-only funnel timing.

-- ---- internal agency operators (who may run campaigns) ----
create table if not exists intel.ci_agency_operator (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references auth.users(id) on delete cascade,
  org_id     uuid,
  label      text,
  active     boolean not null default true,
  added_by   uuid references auth.users(id) on delete set null,
  added_at   timestamptz not null default now()
);
create unique index if not exists ci_agency_operator_member_uq on intel.ci_agency_operator(member_id);
create index if not exists ci_agency_operator_active_idx on intel.ci_agency_operator(member_id) where active;
alter table intel.ci_agency_operator enable row level security;
revoke all on table intel.ci_agency_operator from anon, authenticated;
grant select, insert, update, delete on table intel.ci_agency_operator to service_role;

create or replace function intel.ci_is_agency_operator()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := auth.uid(); if v_uid is null then return false; end if;
  return exists (select 1 from intel.ci_agency_operator where member_id=v_uid and active);
end $$;
revoke all on function intel.ci_is_agency_operator() from public, anon, authenticated;
grant execute on function intel.ci_is_agency_operator() to service_role;

-- ---- onboarding funnel events (append-only; timing only, NO duplicate profile fields) ----
create table if not exists intel.ci_creator_onboarding_event (
  id          uuid primary key default gen_random_uuid(),
  identity_id uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  step        text not null,
  at          timestamptz not null default now()
);
create index if not exists ci_onboarding_event_identity_idx on intel.ci_creator_onboarding_event(identity_id, at);
alter table intel.ci_creator_onboarding_event enable row level security;
revoke all on table intel.ci_creator_onboarding_event from anon, authenticated;
grant select, insert, update, delete on table intel.ci_creator_onboarding_event to service_role;
drop trigger if exists ci_onboarding_event_append_only on intel.ci_creator_onboarding_event;
create trigger ci_onboarding_event_append_only before update or delete on intel.ci_creator_onboarding_event
  for each row execute function intel.tg_block_mutation();

-- ---- link pilot feedback to a campaign (additive column; reuses the built feedback store) ----
alter table intel.ci_pilot_feedback add column if not exists campaign_id uuid references intel.ci_campaign(campaign_id) on delete set null;
create index if not exists ci_pilot_feedback_campaign_idx on intel.ci_pilot_feedback(campaign_id) where campaign_id is not null;
