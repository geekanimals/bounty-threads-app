-- Phase 0A dark foundation (4/6): PROFESSIONAL creator profile in `intel` (no PII here).
-- ADDITIVE + DARK. See docs/CREATOR_INTELLIGENCE_ARCHITECTURE.md §8–§12, §11 (normalized rate card).

-- ---------- professional profile (marketplace-facing; incl. profile-image reference) ----------
create table if not exists intel.ci_creator_professional_profile (
  identity_id        uuid primary key references intel.ci_creator_identity(identity_id) on delete cascade,
  display_name       text,
  city_coarse        text,
  state_coarse       text,
  categories         text[],
  languages          text[],
  bio                text,
  visibility_default text not null default 'creator_controlled',
  -- profile image reference (Instagram image is NOT treated as permanent)
  profile_image_source_platform   text,
  profile_image_source_account_id uuid references intel.ci_platform_account(platform_account_id) on delete set null,
  profile_image_url               text,
  profile_image_asset_ref         text,
  profile_image_observed_at       timestamptz,
  profile_image_status            text not null default 'unavailable'
                                    check (profile_image_status in ('fresh','stale','unavailable')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------- skills (controlled taxonomy + optional custom) ----------
create table if not exists intel.ci_creator_skill (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  skill_key          text not null,
  is_custom          boolean not null default false,
  skill_level        text,
  years_experience   integer check (years_experience is null or years_experience >= 0),
  portfolio_link     text,
  creator_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ci_skill_uq unique (identity_id, skill_key)
);

-- ---------- resources (structured + custom; creator-declared) ----------
create table if not exists intel.ci_creator_resource (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  resource_key       text not null,
  is_custom          boolean not null default false,
  evidence           jsonb,
  creator_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ci_resource_uq unique (identity_id, resource_key)
);

-- ---------- canonical brand ----------
create table if not exists intel.ci_brand (
  brand_id        uuid primary key default gen_random_uuid(),
  name            text not null,
  aliases         text[],
  domain          text,
  parent_brand_id uuid references intel.ci_brand(brand_id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- brand experience (mention != worked-with; verified vs declared) ----------
create table if not exists intel.ci_creator_brand_experience (
  experience_id       uuid primary key default gen_random_uuid(),
  identity_id         uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  brand_id            uuid references intel.ci_brand(brand_id) on delete set null,
  submitted_brand_name text,
  relationship_type   text,
  compensation_type   text check (compensation_type is null or compensation_type in
                        ('paid','barter','hybrid','ambassador','affiliate','ugc','organic_mention')),
  campaign_id         uuid references public.campaigns(id) on delete set null,
  start_date          date,
  end_date            date,
  deliverables        text,
  evidence            jsonb,
  source_type         text not null default 'creator_declared' check (source_type in
                        ('geek_campaign_verified','agency_verified','creator_declared',
                         'content_detected_suggestion','organic_brand_mention','imported_historical')),
  verification_status text not null default 'creator_confirmed' check (verification_status in
                        ('api_observed','creator_confirmed','campaign_verified','agency_verified',
                         'detected_unconfirmed','disputed','unavailable')),
  verified_by         uuid references auth.users(id) on delete set null,
  creator_confirmed_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint brand_exp_has_brand_ck check (brand_id is not null or submitted_brand_name is not null),
  constraint brand_exp_date_range_ck check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists brand_exp_identity_idx on intel.ci_creator_brand_experience(identity_id);

-- ---------- barter / commercial preferences (declared; NOT a scoring signal) ----------
create table if not exists intel.ci_creator_commercial_preference (
  identity_id          uuid primary key references intel.ci_creator_identity(identity_id) on delete cascade,
  accepts_barter       boolean,
  open_to_top_brands   boolean,               -- "open to barter with established/top brands"
  barter_preference    text check (barter_preference is null or barter_preference in
                          ('top_established_only','selected_brands_only','any_relevant')),
  preferred_categories text[],
  excluded_categories  text[],
  min_product_value    numeric check (min_product_value is null or min_product_value >= 0),
  product_only         boolean,
  product_plus_travel  boolean,
  product_plus_production_reimbursement boolean,
  city_only            boolean,
  travel_ready         boolean,
  notes                text,
  last_confirmed_at    timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------- rate card (card-level) ----------
create table if not exists intel.ci_creator_rate_card (
  rate_card_id          uuid primary key default gen_random_uuid(),
  identity_id           uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id   uuid references intel.ci_platform_account(platform_account_id) on delete set null,
  status                text not null default 'active' check (status in ('active','archived')),
  currency              char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  negotiable            boolean not null default true,
  accepts_paid          boolean,
  visibility            text not null default 'private',
  commercial_contact_type text check (commercial_contact_type is null or commercial_contact_type in ('self','agent','manager')),
  valid_from            date,
  valid_until           date,
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rate_card_valid_range_ck check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index if not exists rate_card_identity_idx on intel.ci_creator_rate_card(identity_id);

-- ---------- rate card (deliverable-level items; unique deliverable per card; non-negative) ----------
create table if not exists intel.ci_creator_rate_card_item (
  rate_card_item_id     uuid primary key default gen_random_uuid(),
  rate_card_id          uuid not null references intel.ci_creator_rate_card(rate_card_id) on delete cascade,
  deliverable_type      text not null,
  amount                numeric not null check (amount >= 0),
  unit_quantity         integer not null default 1 check (unit_quantity > 0),
  duration_minutes      integer check (duration_minutes is null or duration_minutes >= 0),
  includes_production   boolean not null default false,
  includes_editing      boolean not null default false,
  usage_rights_included boolean not null default false,
  usage_rights_days     integer check (usage_rights_days is null or usage_rights_days >= 0),
  exclusivity_included  boolean not null default false,
  travel_included       boolean not null default false,
  taxes_extra           boolean not null default false,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rate_card_item_uq unique (rate_card_id, deliverable_type)
);

-- ---------- dream brands (declared aspiration; unique active priority rank per identity) ----------
create table if not exists intel.ci_creator_brand_aspiration (
  aspiration_id        uuid primary key default gen_random_uuid(),
  identity_id          uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  brand_id             uuid references intel.ci_brand(brand_id) on delete set null,
  submitted_brand_name text,
  priority_rank        integer check (priority_rank is null or priority_rank > 0),
  preferred_collaboration_type text,
  notes                text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint aspiration_has_brand_ck check (brand_id is not null or submitted_brand_name is not null)
);
create unique index if not exists aspiration_active_rank_uq
  on intel.ci_creator_brand_aspiration(identity_id, priority_rank)
  where active = true and priority_rank is not null;
create index if not exists aspiration_identity_idx on intel.ci_creator_brand_aspiration(identity_id);

-- ---------- professional field provenance (professional/profile/commercial fields) ----------
create table if not exists intel.ci_profile_field_provenance (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  field_key          text not null,
  source_type        text not null check (source_type in
                        ('from_instagram','from_geek_account','creator_entered','detected_from_content',
                         'verified_campaign_history','agency_verified')),
  source_reference   text,
  first_observed_at  timestamptz,
  last_updated_at    timestamptz,
  creator_confirmed_at timestamptz,
  verification_status text not null default 'unavailable' check (verification_status in
                        ('api_observed','creator_confirmed','campaign_verified','agency_verified',
                         'detected_unconfirmed','disputed','unavailable')),
  verified_by        uuid references auth.users(id) on delete set null,
  confidence         numeric,
  created_at         timestamptz not null default now()
);
create index if not exists intel_prov_identity_field_idx
  on intel.ci_profile_field_provenance(identity_id, field_key);

-- ---------- profile completion projection (booleans/percentages/counts ONLY — no PII) ----------
create table if not exists intel.ci_profile_completion (
  identity_id             uuid primary key references intel.ci_creator_identity(identity_id) on delete cascade,
  completion_pct          numeric not null default 0 check (completion_pct between 0 and 100),
  basic_complete          boolean not null default false,
  required_fields_total   integer not null default 0,
  required_fields_done    integer not null default 0,
  section_flags           jsonb,            -- e.g. {"identity":true,"contact":false} — flags only
  verified_data_coverage_pct numeric check (verified_data_coverage_pct is null or verified_data_coverage_pct between 0 and 100),
  last_calculated_at      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- updated_at triggers
drop trigger if exists prof_profile_updated_at on intel.ci_creator_professional_profile;
create trigger prof_profile_updated_at before update on intel.ci_creator_professional_profile for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_skill_updated_at on intel.ci_creator_skill;
create trigger prof_skill_updated_at before update on intel.ci_creator_skill for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_resource_updated_at on intel.ci_creator_resource;
create trigger prof_resource_updated_at before update on intel.ci_creator_resource for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_brand_updated_at on intel.ci_brand;
create trigger prof_brand_updated_at before update on intel.ci_brand for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_brandexp_updated_at on intel.ci_creator_brand_experience;
create trigger prof_brandexp_updated_at before update on intel.ci_creator_brand_experience for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_commpref_updated_at on intel.ci_creator_commercial_preference;
create trigger prof_commpref_updated_at before update on intel.ci_creator_commercial_preference for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_ratecard_updated_at on intel.ci_creator_rate_card;
create trigger prof_ratecard_updated_at before update on intel.ci_creator_rate_card for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_ratecarditem_updated_at on intel.ci_creator_rate_card_item;
create trigger prof_ratecarditem_updated_at before update on intel.ci_creator_rate_card_item for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_aspiration_updated_at on intel.ci_creator_brand_aspiration;
create trigger prof_aspiration_updated_at before update on intel.ci_creator_brand_aspiration for each row execute function intel.tg_set_updated_at();
drop trigger if exists prof_completion_updated_at on intel.ci_profile_completion;
create trigger prof_completion_updated_at before update on intel.ci_profile_completion for each row execute function intel.tg_set_updated_at();
