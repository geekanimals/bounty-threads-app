-- Phase 1D pilot — SERVER-ENFORCED cohort authorization. ADDITIVE + DARK.
-- Restricts the entire Creator Intelligence api surface to a named allowlist (internal creator(s) +
-- internal brand org(s)) at the DATABASE layer — not by hiding navigation or a browser flag. Enforcement
-- is opt-in via the `pilot_cohort_enforced` flag (default FALSE), so this migration changes NOTHING about
-- current behaviour until activation explicitly turns it on. Immediate shutoff remains the master api flags
-- (`creator_profile_api` / `creator_ig_connect`); this adds a second, narrower gate on top.
-- Does NOT alter any historical migration; only CREATE OR REPLACE of the shared enable-assert (additive).

-- ---- enforcement flag (default off: identical behaviour to today until activation) ----
insert into intel.ci_feature_flag(flag, enabled) values ('pilot_cohort_enforced', false)
  on conflict (flag) do nothing;

-- ---- the allowlist ----
create table if not exists intel.ci_pilot_cohort (
  id            uuid primary key default gen_random_uuid(),
  subject_kind  text not null check (subject_kind in ('creator','brand')),
  member_id     uuid references auth.users(id) on delete cascade,  -- creator: the auth user
  org_id        uuid,                                              -- brand: the org (public.members.org_id)
  identity_id   uuid,                                              -- optional creator identity (documentation)
  label         text,                                              -- human label of the named pilot subject
  active        boolean not null default true,
  added_by      uuid references auth.users(id) on delete set null,
  added_at      timestamptz not null default now(),
  constraint ci_pilot_cohort_subject_ck check (
    (subject_kind='creator' and member_id is not null) or
    (subject_kind='brand'   and org_id   is not null))
);
create index if not exists ci_pilot_cohort_member_idx on intel.ci_pilot_cohort(member_id) where active;
create index if not exists ci_pilot_cohort_org_idx    on intel.ci_pilot_cohort(org_id)    where active;

alter table intel.ci_pilot_cohort enable row level security;
revoke all on table intel.ci_pilot_cohort from anon, authenticated;
grant select, insert, update, delete on table intel.ci_pilot_cohort to service_role;

-- ---- caller-in-cohort test (creator by auth uid, or brand by resolved org) ----
create or replace function intel.ci_in_pilot_cohort()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_org uuid;
begin
  -- not enforced => everyone passes (behaviour identical to pre-pilot)
  if not intel.ci_feature_enabled('pilot_cohort_enforced') then return true; end if;
  v_uid := auth.uid();
  if v_uid is not null and exists (
       select 1 from intel.ci_pilot_cohort c
       where c.active and c.subject_kind='creator' and c.member_id = v_uid) then
    return true;
  end if;
  v_org := intel.ci_caller_org();
  if v_org is not null and exists (
       select 1 from intel.ci_pilot_cohort c
       where c.active and c.subject_kind='brand' and c.org_id = v_org) then
    return true;
  end if;
  return false;   -- enforced + not listed => closed (empty cohort locks everyone out, by design)
end $$;
revoke all on function intel.ci_in_pilot_cohort() from public, anon, authenticated;
grant execute on function intel.ci_in_pilot_cohort() to service_role;

-- ---- extend the SHARED enable-assert with the cohort gate (additive replace; same signature) ----
create or replace function intel.ci_assert_api_enabled(p_flag text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not intel.ci_feature_enabled(p_flag) then
    raise exception 'creator-intelligence feature % is disabled', p_flag using errcode = '0A000';
  end if;
  -- restricted-pilot gate: when enforced, the caller must be an allowlisted creator or brand org.
  if not intel.ci_in_pilot_cohort() then
    raise exception 'not in pilot cohort' using errcode = '42501';
  end if;
end;
$$;
revoke all on function intel.ci_assert_api_enabled(text) from public, anon, authenticated;
