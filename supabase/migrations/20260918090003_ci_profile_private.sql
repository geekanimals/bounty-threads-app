-- Phase 0A dark foundation (3/6): PRIVATE creator profile (PII) in the `private` schema.
-- ADDITIVE + DARK. See docs/CREATOR_INTELLIGENCE_ARCHITECTURE.md §7, §5.
--
-- PII lives ONLY here. Never in intel. Age is NEVER stored (calculated from DOB).

-- ---------- personal identity ----------
create table if not exists private.creator_personal_profile (
  identity_id          uuid primary key references intel.ci_creator_identity(identity_id) on delete cascade,
  first_name           text,
  last_name            text,
  first_name_confirmed_at timestamptz,
  last_name_confirmed_at  timestamptz,
  gender               text,
  date_of_birth        date,
  age_band             text,               -- optional, only when DOB is not fully provided
  marital_status       text check (marital_status in ('single','married','divorced','widowed','prefer_not_to_say')),
  marriage_anniversary date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- anniversary may exist ONLY when married (immutable check)
  constraint personal_anniversary_requires_married_ck
    check (marriage_anniversary is null or marital_status = 'married')
  -- NOTE: no `age` column by design; DOB-not-future is enforced by trigger (current_date is not immutable).
);

-- DOB cannot be in the future (trigger, since current_date is not allowed in a CHECK)
create or replace function private.tg_validate_personal()
returns trigger language plpgsql as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > current_date then
    raise exception 'date_of_birth cannot be in the future';
  end if;
  return new;
end;
$$;
drop trigger if exists personal_validate on private.creator_personal_profile;
create trigger personal_validate before insert or update on private.creator_personal_profile
  for each row execute function private.tg_validate_personal();

-- ---------- contact (E.164 WhatsApp; independent verification states) ----------
create table if not exists private.creator_contact (
  identity_id             uuid primary key references intel.ci_creator_identity(identity_id) on delete cascade,
  whatsapp_e164           text check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9]\d{6,14}$'),
  whatsapp_verified_at    timestamptz,
  email                   text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_verified_at       timestamptz,
  preferred_contact_method text check (preferred_contact_method in ('whatsapp','email')),
  whatsapp_optin          boolean not null default false,
  email_optin             boolean not null default false,
  comm_consent_version    text,
  comm_consent_purpose    text,
  comm_consent_at         timestamptz,
  comm_consent_withdrawn_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------- delivery addresses (one default active address per identity) ----------
create table if not exists private.creator_address (
  address_id           uuid primary key default gen_random_uuid(),
  identity_id          uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  line1                text,
  line2                text,
  landmark             text,
  city                 text,
  state                text,
  postal_code          text,
  country              text,
  delivery_instructions text,
  label                text check (label in ('Home','Office','Manager','Other')),
  is_default           boolean not null default false,
  verified_at          timestamptz,
  confirmed_at         timestamptz,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists creator_address_one_default_active_uq
  on private.creator_address(identity_id)
  where is_default = true and deleted_at is null;
create index if not exists creator_address_identity_idx on private.creator_address(identity_id);

-- ---------- private field provenance (personal/contact/address fields) ----------
create table if not exists private.creator_profile_field_provenance (
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
create index if not exists private_prov_identity_field_idx
  on private.creator_profile_field_provenance(identity_id, field_key);

-- ---------- append-only edit-event log for sensitive private fields ----------
create table if not exists private.creator_profile_edit_event (
  event_id      uuid primary key default gen_random_uuid(),
  identity_id   uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  field_key     text not null,
  change_type   text not null default 'update',
  old_value     text,                 -- private schema, locked & audited; may hold hashes
  new_value     text,
  changed_by    uuid references auth.users(id) on delete set null,
  change_reason text,
  changed_at    timestamptz not null default now()
);
create index if not exists private_edit_identity_idx on private.creator_profile_edit_event(identity_id);
drop trigger if exists private_edit_append_only on private.creator_profile_edit_event;
create trigger private_edit_append_only
  before update or delete on private.creator_profile_edit_event
  for each row execute function intel.tg_block_mutation();

-- updated_at triggers
drop trigger if exists personal_set_updated_at on private.creator_personal_profile;
create trigger personal_set_updated_at before update on private.creator_personal_profile
  for each row execute function intel.tg_set_updated_at();
drop trigger if exists contact_set_updated_at on private.creator_contact;
create trigger contact_set_updated_at before update on private.creator_contact
  for each row execute function intel.tg_set_updated_at();
drop trigger if exists address_set_updated_at on private.creator_address;
create trigger address_set_updated_at before update on private.creator_address
  for each row execute function intel.tg_set_updated_at();
