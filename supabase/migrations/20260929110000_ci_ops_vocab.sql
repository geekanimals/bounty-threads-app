-- Phase 1E Operations — controlled vocabularies + the dark flag. ADDITIVE + DARK.
-- Reference tables (content format, campaign objective, participation role) that the operational entities FK
-- to. Grown by inserting rows, never by code/enum edits. Service-role only; the UI reads them via an api getter.
-- Nothing here touches the intelligence models. The whole operational layer is gated by `operational_pilot`
-- (default FALSE) plus the existing pilot cohort — identical to production behaviour until activation.

insert into intel.ci_feature_flag(flag, enabled) values ('operational_pilot', false)
  on conflict (flag) do nothing;

create table if not exists intel.ci_content_format_vocab (
  format_key text primary key,
  label      text not null,
  platform   text,
  is_active  boolean not null default true,
  notes      text,
  created_at timestamptz not null default now()
);
insert into intel.ci_content_format_vocab(format_key,label,platform) values
  ('reel','Instagram Reel','instagram'),('story','Instagram Story','instagram'),
  ('static_post','Instagram Static Post','instagram'),('carousel','Instagram Carousel','instagram'),
  ('live','Instagram Live','instagram'),('ugc_no_post','UGC (no posting)',null),
  ('store_visit','Store / Restaurant Visit',null),('usage_rights','Usage Rights',null),
  ('paid_amplification','Paid Amplification / Whitelisting',null),('exclusivity_addon','Exclusivity Add-on',null)
  on conflict (format_key) do nothing;

create table if not exists intel.ci_campaign_objective_vocab (
  objective_key text primary key,
  label         text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
insert into intel.ci_campaign_objective_vocab(objective_key,label) values
  ('awareness','Awareness'),('product_launch','Product Launch'),('reach','Reach'),
  ('engagement','Engagement'),('ugc_content','UGC Content'),('conversions','Conversions'),
  ('product_seeding','Product Seeding'),('event_coverage','Event Coverage')
  on conflict (objective_key) do nothing;

create table if not exists intel.ci_participation_role_vocab (
  role_key   text primary key,
  label      text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
insert into intel.ci_participation_role_vocab(role_key,label) values
  ('creator','Creator'),('celebrity','Celebrity'),('ambassador','Brand Ambassador'),
  ('ugc_creator','UGC Creator'),('agency_managed','Agency-managed Talent')
  on conflict (role_key) do nothing;

do $$ declare t text; begin
  foreach t in array array['ci_content_format_vocab','ci_campaign_objective_vocab','ci_participation_role_vocab'] loop
    execute format('alter table intel.%I enable row level security', t);
    execute format('revoke all on table intel.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table intel.%I to service_role', t);
  end loop;
end $$;
