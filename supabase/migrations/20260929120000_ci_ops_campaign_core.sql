-- Phase 1E Operations — brand company profile + the ONE canonical campaign entity + brief. ADDITIVE + DARK.
-- Reuses ci_brand (never duplicated) and links a durable campaign to the 1D matching query (ci_matching_request).
-- Legacy public.campaigns is only SOFT-linked (legacy_campaign_id), never mirrored or written.

-- ---- brand company profile (company + contact; the brand ENTITY stays ci_brand) ----
create table if not exists intel.ci_brand_org_profile (
  org_id            uuid primary key,                              -- the brand/company org (public.members.org_id)
  brand_id          uuid references intel.ci_brand(brand_id) on delete set null,
  company_name      text,
  category          text,
  website           text,
  location_city     text,
  location_state    text,
  contact_member_id uuid references auth.users(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
drop trigger if exists ci_brand_org_profile_updated_at on intel.ci_brand_org_profile;
create trigger ci_brand_org_profile_updated_at before update on intel.ci_brand_org_profile
  for each row execute function intel.tg_set_updated_at();

-- ---- canonical campaign (operational; future historical evidence attaches to THIS entity) ----
create table if not exists intel.ci_campaign (
  campaign_id        uuid primary key default gen_random_uuid(),
  brand_id           uuid references intel.ci_brand(brand_id) on delete set null,
  submitted_brand_name text,                                       -- fallback while brand unresolved
  org_id             uuid,                                         -- owning org (Geek/brand)
  created_by         uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  objective          text references intel.ci_campaign_objective_vocab(objective_key),
  product            text,
  category           text,
  cities             text[],
  languages          text[],
  comp_type          text check (comp_type is null or comp_type in ('barter','cash','hybrid')),
  budget             numeric check (budget is null or budget >= 0),
  currency           char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  starts_on          date,
  ends_on            date,
  lifecycle_status   text not null default 'draft'
                      check (lifecycle_status in ('draft','creator_discovery','in_execution','reporting','completed','cancelled')),
  legacy_campaign_id uuid,                                         -- SOFT ref to public.campaigns(id); no hard FK
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ci_campaign_date_range_ck check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint ci_campaign_has_brand_ck   check (brand_id is not null or submitted_brand_name is not null)
);
create index if not exists ci_campaign_org_idx   on intel.ci_campaign(org_id, created_at desc);
create index if not exists ci_campaign_brand_idx on intel.ci_campaign(brand_id);
drop trigger if exists ci_campaign_updated_at on intel.ci_campaign;
create trigger ci_campaign_updated_at before update on intel.ci_campaign
  for each row execute function intel.tg_set_updated_at();

-- ---- brief: the durable requirements, linked to a 1D matching query ----
create table if not exists intel.ci_campaign_brief (
  brief_id            uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  requirements        jsonb not null default '{}',
  matching_request_id uuid references intel.ci_matching_request(matching_request_id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists ci_campaign_brief_campaign_idx on intel.ci_campaign_brief(campaign_id);

do $$ declare t text; begin
  foreach t in array array['ci_brand_org_profile','ci_campaign','ci_campaign_brief'] loop
    execute format('alter table intel.%I enable row level security', t);
    execute format('revoke all on table intel.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table intel.%I to service_role', t);
  end loop;
end $$;
