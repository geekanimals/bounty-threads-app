-- Phase 1A (1/2): additive columns for the Creator Profile build.
-- ADDITIVE + DARK. Only NEW intel-schema tables are altered (empty in the dark foundation);
-- no legacy public object is touched. All columns nullable → replayable from a clean database.

-- Professional profile: content formats, travel/availability, and management model.
alter table intel.ci_creator_professional_profile
  add column content_formats   text[],
  add column travel_willingness text,     -- e.g. city_only | domestic | international | not_available
  add column availability_status text,    -- e.g. available | limited | unavailable
  add column management_status  text
    check (management_status is null or management_status in
           ('self_managed','agency_managed','celebrity_agent_managed'));

-- Brand experience: an explicit creator rejection state (for the confirm/reject review flow) and
-- optional conflict/exclusivity note. Detected mentions are NOT auto-promoted to "worked with".
alter table intel.ci_creator_brand_experience
  add column creator_rejected_at timestamptz,
  add column exclusivity_notes   text;

-- Every brand-experience entry must identify the brand by a canonical id OR a raw name.
-- (Table is empty in the dark foundation, so this validates cleanly on a fresh apply.)
alter table intel.ci_creator_brand_experience
  add constraint ci_brand_experience_brand_or_name_ck
  check (brand_id is not null or submitted_brand_name is not null);
