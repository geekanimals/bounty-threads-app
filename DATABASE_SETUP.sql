-- ===================================================================
-- GEEK INFLUENCER OS — DATABASE SETUP  (REAL SUPABASE AUTH + PER-ORG RLS)
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE.
--
-- SECURITY MODEL:
--   • Login is real Supabase Auth (bcrypt, sessions). auth.uid() is the user.
--   • On signup, a trigger creates ONE row in `members` carrying a fresh org_id
--     (server-generated — the browser can NEVER choose it) + the user's role.
--   • Every data table carries an org_id column.
--   • RLS uses my_org() to compare a row's org_id to the caller's org_id.
--   => Agency A can NEVER read or write Agency B's rows — enforced by Postgres,
--      not by JavaScript.
-- ===================================================================

create extension if not exists pgcrypto;

-- ---------- MEMBERS (the org + role directory) ----------
create table if not exists members (
  id        uuid primary key references auth.users(id) on delete cascade,
  org_id    uuid not null default gen_random_uuid(),
  org_name  text,
  name      text,
  email     text,
  role      text default 'owner',
  status    text default 'active',   -- active | pending | declined  (agencies start pending)
  created_at timestamptz default now()
);
alter table members add column if not exists status text default 'active';
alter table members enable row level security;

-- A user can read + manage only their OWN member row; and read co-members in their org.
drop policy if exists "member self read"   on members;
drop policy if exists "member self insert" on members;
drop policy if exists "member self update" on members;
drop policy if exists "org read members"   on members;
create policy "member self read"   on members for select using (id = auth.uid());
create policy "member self update" on members for update using (id = auth.uid());
-- NOTE: no "member self insert" policy on purpose. The members row is created ONLY by the
-- handle_new_user trigger (SECURITY DEFINER). This removes the vector where a client could
-- insert its own members row with a victim's org_id to breach isolation.

-- Guard: a member can never move themselves to another org (isolation-critical).
create or replace function public.members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.org_id := old.org_id;  -- org_id is immutable from the client
  new.role   := old.role;    -- role is immutable from the client (no self-escalation to owner)
  return new;
end;
$$;
drop trigger if exists members_no_org_change on members;
create trigger members_no_org_change
  before update on members
  for each row execute function public.members_guard();

-- Column-level lock: clients may update ONLY their own `name`. role/status/org_id can never be
-- changed from the browser (no self-escalation to owner, no self-approval). The trigger and the
-- admin RPCs below run as the table owner and bypass this, so provisioning/approval still work.
revoke insert, update on members from authenticated;
grant update (name) on members to authenticated;

-- Helper: the caller's org_id, read from their members row.
create or replace function my_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.members where id = auth.uid()
$$;

-- Now that my_org() exists, allow members to read co-members in their org.
create policy "org read members" on members for select using (org_id = my_org());

-- Helper: the caller's role (SECURITY DEFINER avoids RLS recursion on members).
create or replace function my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.members where id = auth.uid()
$$;

-- ---------- INVITES (team members join an existing org) ----------
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(),
  org_name text,
  email text not null,
  role text default 'creator',
  token uuid not null default gen_random_uuid(),  -- shared in the invite link; required to join
  invited_by uuid default auth.uid(),
  status text default 'pending',   -- pending | accepted
  created_at timestamptz default now()
);
alter table invites add column if not exists token uuid not null default gen_random_uuid();
-- Invites can go out over WhatsApp (preferred) or email; optionally tied to an imported creator.
alter table invites add column if not exists name text;
alter table invites add column if not exists whatsapp text;
alter table invites add column if not exists channel text default 'whatsapp'; -- whatsapp | email
alter table invites add column if not exists creator_id uuid;
alter table invites enable row level security;
drop policy if exists "org read invites"   on invites;
drop policy if exists "org insert invites" on invites;
drop policy if exists "org update invites" on invites;
drop policy if exists "org delete invites" on invites;
create policy "org read invites"   on invites for select using (org_id = my_org());
-- Only owners/corporate admins may invite (not every member), into their own org.
create policy "org insert invites" on invites for insert with check (org_id = my_org() and my_role() in ('owner','corporate'));
create policy "org update invites" on invites for update using (org_id = my_org());
create policy "org delete invites" on invites for delete using (org_id = my_org());

-- ---------- AUTO-PROVISION a member row on signup ----------
-- Fires when Supabase Auth creates a new user. Reads the name/org/role the
-- signup form put in raw_user_meta_data and stamps a NEW server-side org_id.
-- SECURITY DEFINER so it can write the row regardless of RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites;
  v_org_id   uuid;
  v_org_name text;
  v_role     text;
  v_status   text;
begin
  -- Join an org ONLY if the signup carries a valid invite token for a matching pending invite.
  -- (Email match alone is not enough — that would let anyone be captured into another org.)
  select * into inv from public.invites
    where lower(email) = lower(new.email)
      and status = 'pending'
      and token::text = coalesce(new.raw_user_meta_data->>'invite_token','')
    order by created_at desc limit 1;

  if inv.id is not null then
    v_org_id   := inv.org_id;
    v_org_name := coalesce(inv.org_name, 'My Org');
    v_role     := coalesce(nullif(inv.role,''), 'creator');
    v_status   := 'active';   -- invited users are pre-approved by an owner
    update public.invites set status = 'accepted' where id = inv.id;
  else
    v_org_id   := gen_random_uuid();
    v_org_name := coalesce(nullif(new.raw_user_meta_data->>'org_name',''), 'My Org');
    v_role     := coalesce(nullif(new.raw_user_meta_data->>'role',''), 'owner');
    -- Creators onboard instantly; agency-side roles need platform approval.
    v_status   := case when v_role = 'creator' then 'active' else 'pending' end;
  end if;

  insert into public.members (id, org_id, org_name, name, email, role, status)
  values (
    new.id, v_org_id, v_org_name,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email, v_role, v_status
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- LEADS (public homepage form — open insert, private read) ----------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text, email text, agency text, team_size text,
  source text, created_at timestamptz default now()
);
alter table leads enable row level security;
drop policy if exists "anyone submits a lead" on leads;
drop policy if exists "signed-in read leads"  on leads;
create policy "anyone submits a lead" on leads for insert with check (true);
-- NOTE: intentionally NO client read policy. Homepage leads (prospect PII) are read
-- only via the Supabase dashboard / service role — never exposed to signed-in app users.

-- ---------- CREATORS ----------
create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(), org_name text,
  name text, city text, tier text, cat text,
  followers text, eng text, rating numeric, handle text,
  created_at timestamptz default now()
);
-- bulk import + "invite to app" flow needs contact + invite tracking
alter table creators add column if not exists email text;
alter table creators add column if not exists invite_status text default 'none'; -- none | invited | joined
alter table creators add column if not exists invited_at timestamptz;
-- WhatsApp is the preferred channel; email is the fallback.
alter table creators add column if not exists whatsapp text;
alter table creators add column if not exists phone text;
alter table creators add column if not exists preferred_channel text default 'whatsapp'; -- whatsapp | email
-- Location: auto-picked current location + a saved shipping address (for barters).
alter table creators add column if not exists address text;
alter table creators add column if not exists lat numeric;
alter table creators add column if not exists lng numeric;
alter table creators enable row level security;
drop policy if exists "org read creators"   on creators;
drop policy if exists "org insert creators" on creators;
drop policy if exists "org update creators" on creators;
drop policy if exists "org delete creators" on creators;
create policy "org read creators"   on creators for select using (org_id = my_org());
create policy "org insert creators" on creators for insert with check (org_id = my_org());
create policy "org update creators" on creators for update using (org_id = my_org());
create policy "org delete creators" on creators for delete using (org_id = my_org());

-- ---------- CAMPAIGNS ----------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(), org_name text,
  name text, brand text, type text, status text,
  progress int default 0, creators int default 0,
  created_at timestamptz default now()
);
-- Richer campaign brief fields (competitive: CreatorIQ/GRIN/Aspire)
alter table campaigns add column if not exists objective text;
alter table campaigns add column if not exists budget numeric;
alter table campaigns add column if not exists platforms text;
alter table campaigns add column if not exists deliverables text;
alter table campaigns add column if not exists brief text;
alter table campaigns add column if not exists hashtags text;
alter table campaigns add column if not exists start_date date;
alter table campaigns add column if not exists end_date date;
-- Campaign workspace: which deliverable lines are checked off (array of the checked line text).
alter table campaigns add column if not exists deliverables_done jsonb default '[]'::jsonb;
alter table campaigns enable row level security;
drop policy if exists "org read campaigns"   on campaigns;
drop policy if exists "org insert campaigns" on campaigns;
drop policy if exists "org update campaigns" on campaigns;
drop policy if exists "org delete campaigns" on campaigns;
drop policy if exists "marketplace read campaigns" on campaigns;
create policy "org read campaigns"   on campaigns for select using (org_id = my_org());
-- NOTE: campaigns RLS stays strictly org-scoped (so Brand CRM / Finance / KPIs never leak
-- across orgs). The marketplace instead reads open campaigns through the open_campaigns()
-- function below — an explicit, read-only, cross-org surface for Sourcing/Live campaigns only.
create policy "org insert campaigns" on campaigns for insert with check (org_id = my_org());
create policy "org update campaigns" on campaigns for update using (org_id = my_org());
create policy "org delete campaigns" on campaigns for delete using (org_id = my_org());

-- Marketplace surface: open (Sourcing/Live) campaigns across ALL orgs, read-only.
-- SECURITY DEFINER bypasses the org-scoped RLS above, but only exposes open campaigns.
-- Return type changed (was `setof campaigns`), so drop the old signature before recreating.
drop function if exists public.open_campaigns();
create or replace function public.open_campaigns()
returns table(id uuid, name text, brand text, type text, status text, org_id uuid, org_name text,
              objective text, budget numeric, platforms text, deliverables text, brief text,
              hashtags text, start_date date, end_date date)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, brand, type, status, org_id, org_name,
         objective, budget, platforms, deliverables, brief, hashtags, start_date, end_date
  from public.campaigns where status in ('Sourcing','Live') order by created_at desc
$$;
grant execute on function public.open_campaigns() to authenticated;

-- Creator's own applications, joined to live campaign details so they can review what they
-- applied to (campaigns RLS is org-scoped, so a plain join from the client can't see the brief).
create or replace function public.my_applications()
returns table(id uuid, status text, created_at timestamptz, campaign_id uuid, campaign_name text,
              agency_name text, brand text, type text, objective text, budget numeric,
              platforms text, deliverables text, brief text, hashtags text, start_date date, end_date date)
language sql stable security definer set search_path = public
as $$
  select a.id, a.status, a.created_at, a.campaign_id, a.campaign_name,
         c.org_name as agency_name, c.brand, c.type, c.objective, c.budget,
         c.platforms, c.deliverables, c.brief, c.hashtags, c.start_date, c.end_date
  from public.applications a
  left join public.campaigns c on c.id = a.campaign_id
  where a.org_id = my_org()
  order by a.created_at desc
$$;
grant execute on function public.my_applications() to authenticated;

-- Applications TO the caller's campaigns (agency side), with creator contact where available.
-- Lets the agency see & act on inbound applications from the dashboard, not just Approvals.
create or replace function public.campaign_applications()
returns table(id uuid, status text, created_at timestamptz, campaign_id uuid, campaign_name text,
              creator_name text, creator_org text)
language sql stable security definer set search_path = public
as $$
  select a.id, a.status, a.created_at, a.campaign_id, a.campaign_name, a.creator_name, a.org_name
  from public.applications a
  where a.agency_org_id = my_org()
  order by a.created_at desc
$$;
grant execute on function public.campaign_applications() to authenticated;

-- ---------- BARTER ITEMS ----------
create table if not exists barter_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(), org_name text,
  creator text, product text, campaign text,
  stage text default 'Matched',
  value numeric, reach numeric,
  created_at timestamptz default now()
);
-- Richer barter fields
alter table barter_items add column if not exists product_link text;
alter table barter_items add column if not exists quantity int;
alter table barter_items add column if not exists deliverables text;
alter table barter_items add column if not exists deadline date;
alter table barter_items add column if not exists address text;
-- Fulfilment / shipping tracking
alter table barter_items add column if not exists carrier text;
alter table barter_items add column if not exists tracking_number text;
alter table barter_items add column if not exists shipped_at date;
alter table barter_items add column if not exists reminded_at timestamptz;
alter table barter_items enable row level security;
drop policy if exists "org read barter"   on barter_items;
drop policy if exists "org insert barter" on barter_items;
drop policy if exists "org update barter" on barter_items;
drop policy if exists "org delete barter" on barter_items;
create policy "org read barter"   on barter_items for select using (org_id = my_org());
create policy "org insert barter" on barter_items for insert with check (org_id = my_org());
create policy "org update barter" on barter_items for update using (org_id = my_org());
create policy "org delete barter" on barter_items for delete using (org_id = my_org());

-- ---------- APPLICATIONS (creator → campaign; crosses the org boundary) ----------
-- org_id        = the applying CREATOR's org (so the creator sees their own applications)
-- agency_org_id = the CAMPAIGN's org (so the agency sees applications to their campaigns)
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(), org_name text,
  agency_org_id uuid,
  campaign_id uuid, campaign_name text,
  creator_name text, status text default 'Applied',
  created_at timestamptz default now()
);
alter table applications add column if not exists agency_org_id uuid;
alter table applications enable row level security;
drop policy if exists "org read apps"     on applications;
drop policy if exists "org insert apps"   on applications;
drop policy if exists "org update apps"   on applications;
drop policy if exists "agency update apps"  on applications;
drop policy if exists "creator update apps" on applications;
-- Either side (the creator who applied, or the agency that owns the campaign) can read it.
create policy "org read apps"   on applications for select using (org_id = my_org() or agency_org_id = my_org());
-- Direct client inserts may NOT set agency_org_id — routing to an agency happens only through
-- apply_to_campaign() (which validates the campaign). This blocks forged/spam applications.
create policy "org insert apps" on applications for insert with check (org_id = my_org() and agency_org_id is null);
-- Only the agency that owns the campaign may approve/decline.
create policy "agency update apps"  on applications for update using (agency_org_id = my_org()) with check (agency_org_id = my_org());
-- The creator may only keep/withdraw their own application — never self-approve.
create policy "creator update apps" on applications for update using (org_id = my_org()) with check (org_id = my_org() and status in ('Applied','Withdrawn'));

-- Server-side apply: validates the campaign is real & open, sets agency_org_id from it (un-forgeable),
-- and de-dupes. This is the only path that can route an application to an agency.
create or replace function public.apply_to_campaign(p_campaign_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.campaigns;
  existing public.applications;
  newrow   public.applications;
  me       public.members;
begin
  select * into c from public.campaigns where id = p_campaign_id and status in ('Sourcing','Live');
  if c.id is null then raise exception 'Campaign is not open for applications'; end if;
  if c.org_id = my_org() then raise exception 'You cannot apply to your own campaign'; end if;
  select * into me from public.members where id = auth.uid();
  select * into existing from public.applications
    where campaign_id = p_campaign_id and org_id = my_org() limit 1;
  if existing.id is not null then return existing; end if;
  insert into public.applications (org_id, org_name, agency_org_id, campaign_id, campaign_name, creator_name, status)
  values (my_org(), me.org_name, c.org_id, c.id, c.name, me.name, 'Applied')
  returning * into newrow;
  return newrow;
end;
$$;
grant execute on function public.apply_to_campaign(uuid) to authenticated;

-- ---------- DREAM PLANS (creator growth) ----------
create table if not exists dream_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(), creator_email text,
  goal text, score int default 40, tasks jsonb,
  created_at timestamptz default now()
);
alter table dream_plans enable row level security;
drop policy if exists "org read plans"   on dream_plans;
drop policy if exists "org insert plans" on dream_plans;
drop policy if exists "org update plans" on dream_plans;
create policy "org read plans"   on dream_plans for select using (org_id = my_org());
create policy "org insert plans" on dream_plans for insert with check (org_id = my_org());
create policy "org update plans" on dream_plans for update using (org_id = my_org());

-- ---------- STORY DEALS (celebrity engine) ----------
create table if not exists story_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(), org_name text,
  celebrity text, brand text, manager text,
  value numeric, fee numeric, stage text default 'Requested',
  proof_url text, created_at timestamptz default now()
);
alter table story_deals enable row level security;
drop policy if exists "org read stories"   on story_deals;
drop policy if exists "org insert stories" on story_deals;
drop policy if exists "org update stories" on story_deals;
create policy "org read stories"   on story_deals for select using (org_id = my_org());
create policy "org insert stories" on story_deals for insert with check (org_id = my_org());
create policy "org update stories" on story_deals for update using (org_id = my_org());

-- ---------- IRM CONTACTS (influencer relationship management) ----------
create table if not exists irm_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(),
  name text, kind text, handle text,
  status text default 'New', health int default 50,
  last_touch date, notes text,
  created_at timestamptz default now()
);
-- Contact channels for keeping relationships warm (WhatsApp preferred).
alter table irm_contacts add column if not exists whatsapp text;
alter table irm_contacts add column if not exists phone text;
alter table irm_contacts add column if not exists email text;
alter table irm_contacts add column if not exists preferred_channel text default 'whatsapp';
alter table irm_contacts enable row level security;
drop policy if exists "org read irm"   on irm_contacts;
drop policy if exists "org insert irm" on irm_contacts;
drop policy if exists "org update irm" on irm_contacts;
drop policy if exists "org delete irm" on irm_contacts;
create policy "org read irm"   on irm_contacts for select using (org_id = my_org());
create policy "org insert irm" on irm_contacts for insert with check (org_id = my_org());
create policy "org update irm" on irm_contacts for update using (org_id = my_org());
create policy "org delete irm" on irm_contacts for delete using (org_id = my_org());

-- ---------- SOCIAL ACCOUNTS (Instagram media kit — profile is org-readable) ----------
create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(),
  member_id uuid references auth.users(id) on delete cascade,
  platform text not null default 'instagram',
  ig_user_id text,
  username text, name text, account_type text,
  followers_count int default 0, follows_count int default 0, media_count int default 0,
  profile_picture_url text, biography text, website text,
  recent_media jsonb default '[]'::jsonb,
  avg_reach numeric,                       -- avg reach per recent post (from insights)
  audience jsonb default '{}'::jsonb,      -- follower demographics: {countries,cities,gender_age}
  mentions jsonb default '[]'::jsonb,      -- media where this creator was tagged/mentioned
  edits jsonb default '{}'::jsonb,         -- creator's editable overrides: {headline,bio,rate_card,portfolio,hidden}
  connected_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (member_id, platform)
);
-- Media-kit v2 columns (safe to run on an existing table)
alter table social_accounts add column if not exists avg_reach numeric;
alter table social_accounts add column if not exists audience jsonb default '{}'::jsonb;
alter table social_accounts add column if not exists mentions jsonb default '[]'::jsonb;
alter table social_accounts add column if not exists edits jsonb default '{}'::jsonb;
alter table social_accounts enable row level security;
drop policy if exists "org read social"   on social_accounts;
drop policy if exists "org write social"  on social_accounts;
drop policy if exists "org update social" on social_accounts;
drop policy if exists "org delete social" on social_accounts;
create policy "org read social"   on social_accounts for select using (org_id = my_org());
create policy "org update social" on social_accounts for update using (org_id = my_org());
create policy "org delete social" on social_accounts for delete using (org_id = my_org());
-- Clients may NOT insert rows and may only UPDATE the `edits` column. All Instagram-synced
-- stats (followers, avg_reach, audience, mentions, recent_media...) are written ONLY by the
-- Edge Functions (service_role), so a creator can't forge the numbers brands evaluate them on.
revoke insert, update on social_accounts from authenticated;
grant update (edits, updated_at) on social_accounts to authenticated;

-- Public, read-only creator media kit (for shareable public profile pages). Exposes only safe
-- public fields (never tokens or org_id). Callable by anyone (anon) by username.
create or replace function public.public_profile(p_username text)
returns table(username text, name text, account_type text, followers_count int, follows_count int,
              media_count int, avg_reach numeric, profile_picture_url text, biography text, website text,
              recent_media jsonb, audience jsonb, mentions jsonb, edits jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select username, name, account_type, followers_count, follows_count, media_count, avg_reach,
         profile_picture_url, biography, website, recent_media, audience, mentions, edits
  from public.social_accounts
  where lower(username) = lower(p_username) and platform = 'instagram'
  limit 1
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

-- ---------- ORG PUBLIC PROFILE (shareable agency/brand/creator workspace page) ----------
-- One public page per org. Keyed by org_id; the owner sets a unique slug + public bio.
create table if not exists org_profiles (
  org_id uuid primary key default my_org(),
  slug text unique,
  display_name text,
  tagline text,
  bio text,
  logo_url text,
  website text,
  whatsapp text,
  email text,
  city text,
  is_public boolean default true,
  updated_at timestamptz default now()
);
alter table org_profiles enable row level security;
drop policy if exists "org read own profile"   on org_profiles;
drop policy if exists "org insert own profile" on org_profiles;
drop policy if exists "org update own profile" on org_profiles;
create policy "org read own profile"   on org_profiles for select using (org_id = my_org());
-- Only owners/corporate admins may create/edit the org's public page.
create policy "org insert own profile" on org_profiles for insert with check (org_id = my_org() and my_role() in ('owner','corporate'));
create policy "org update own profile" on org_profiles for update using (org_id = my_org() and my_role() in ('owner','corporate'));

-- Public, read-only org page by slug. Returns the org header + its public roster + live campaign count.
-- Exposes only safe public fields (never org_id, tokens, or private CRM data).
create or replace function public.public_org(p_slug text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when p.org_id is null then null else jsonb_build_object(
    'slug', p.slug, 'display_name', coalesce(p.display_name, 'Workspace'),
    'tagline', p.tagline, 'bio', p.bio, 'logo_url', p.logo_url, 'website', p.website,
    'whatsapp', p.whatsapp, 'email', p.email, 'city', p.city,
    'creator_count', (select count(*) from public.creators c where c.org_id = p.org_id),
    'campaign_count', (select count(*) from public.campaigns cm where cm.org_id = p.org_id),
    'creators', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name, 'handle', c.handle, 'tier', c.tier,
                                          'cat', c.cat, 'followers', c.followers, 'city', c.city)
             order by c.created_at desc)
      from (select * from public.creators c2 where c2.org_id = p.org_id order by c2.created_at desc limit 24) c
    ), '[]'::jsonb)
  ) end
  from public.org_profiles p
  where lower(p.slug) = lower(p_slug) and p.is_public = true
  limit 1
$$;
grant execute on function public.public_org(text) to anon, authenticated;

-- ---------- SOCIAL TOKENS (access tokens — SERVER ONLY, no client access) ----------
-- RLS is enabled with NO policies for the anon/authenticated roles, so the browser
-- can never read or write tokens. Only Edge Functions (service_role) touch this table.
create table if not exists social_tokens (
  member_id uuid references auth.users(id) on delete cascade,
  platform text not null default 'instagram',
  ig_user_id text,
  access_token text,
  expires_at timestamptz,
  updated_at timestamptz default now(),
  primary key (member_id, platform)
);
alter table social_tokens enable row level security;
-- (intentionally no policies — locked to service_role)

-- ---------- STORAGE: bucket for media the creator uploads to publish ----------
insert into storage.buckets (id, name, public)
  values ('ig-media', 'ig-media', true)
  on conflict (id) do nothing;
drop policy if exists "auth upload ig-media" on storage.objects;
drop policy if exists "public read ig-media" on storage.objects;
drop policy if exists "auth delete ig-media" on storage.objects;
-- Each user can only write/delete under their OWN uid folder prefix (client uploads to `${uid}/...`).
create policy "auth upload ig-media" on storage.objects for insert to authenticated with check (bucket_id = 'ig-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "public read ig-media"  on storage.objects for select using (bucket_id = 'ig-media');
create policy "auth delete ig-media"  on storage.objects for delete to authenticated using (bucket_id = 'ig-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- PLATFORM ADMINS (your team — approve agency/brand signups) ----------
-- Add yourself once:  insert into platform_admins(user_id) values ('<your-auth-user-id>');
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
alter table platform_admins enable row level security;
-- (no client policies — managed via the Supabase dashboard / service role)

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;
grant execute on function public.is_platform_admin() to authenticated;

-- Pending agency signups across ALL orgs — returns rows only to a platform admin.
create or replace function public.pending_members()
returns table(id uuid, name text, email text, role text, org_name text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select m.id, m.name, m.email, m.role, m.org_name, m.created_at
  from public.members m
  where m.status = 'pending' and public.is_platform_admin()
  order by m.created_at desc
$$;
grant execute on function public.pending_members() to authenticated;

-- Approve/decline a pending member — platform admins only.
create or replace function public.set_member_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('active','declined') then raise exception 'Invalid status'; end if;
  update public.members set status = p_status where id = p_id;
end;
$$;
grant execute on function public.set_member_status(uuid, text) to authenticated;

-- ---------- AI USAGE (per-user daily cap for the AI assistant) ----------
create table if not exists ai_usage (
  member_id uuid references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (member_id, day)
);
alter table ai_usage enable row level security;
-- (no client policies — only the ai-chat Edge Function, via service_role, reads/writes this)

-- ===================================================================
-- DONE. Real Supabase Auth + Postgres-enforced per-org isolation.
-- org_id now DEFAULTS to my_org() on insert, so the browser can't spoof it,
-- and RLS rejects any row that isn't the caller's org anyway.
-- ===================================================================
