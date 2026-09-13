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
  created_at timestamptz default now()
);
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
  return new;
end;
$$;
drop trigger if exists members_no_org_change on members;
create trigger members_no_org_change
  before update on members
  for each row execute function public.members_guard();

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
alter table invites enable row level security;
drop policy if exists "org read invites"   on invites;
drop policy if exists "org insert invites" on invites;
drop policy if exists "org update invites" on invites;
drop policy if exists "org delete invites" on invites;
create policy "org read invites"   on invites for select using (org_id = my_org());
create policy "org insert invites" on invites for insert with check (org_id = my_org());
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
    update public.invites set status = 'accepted' where id = inv.id;
  else
    v_org_id   := gen_random_uuid();
    v_org_name := coalesce(nullif(new.raw_user_meta_data->>'org_name',''), 'My Org');
    v_role     := coalesce(nullif(new.raw_user_meta_data->>'role',''), 'owner');
  end if;

  insert into public.members (id, org_id, org_name, name, email, role)
  values (
    new.id, v_org_id, v_org_name,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email, v_role
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
create or replace function public.open_campaigns()
returns setof campaigns
language sql
stable
security definer
set search_path = public
as $$
  select * from public.campaigns where status in ('Sourcing','Live') order by created_at desc
$$;
grant execute on function public.open_campaigns() to authenticated;

-- ---------- BARTER ITEMS ----------
create table if not exists barter_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default my_org(), org_name text,
  creator text, product text, campaign text,
  stage text default 'Matched',
  value numeric, reach numeric,
  created_at timestamptz default now()
);
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
drop policy if exists "org read apps"   on applications;
drop policy if exists "org insert apps" on applications;
drop policy if exists "org update apps" on applications;
-- Either side (the creator who applied, or the agency that owns the campaign) can read it.
create policy "org read apps"   on applications for select using (org_id = my_org() or agency_org_id = my_org());
-- A creator inserts an application stamped with THEIR org; agency_org_id points at the campaign's org.
create policy "org insert apps" on applications for insert with check (org_id = my_org());
-- The agency (or the creator) can update status (approve / decline / withdraw).
create policy "org update apps" on applications for update using (org_id = my_org() or agency_org_id = my_org());

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
create policy "org write social"  on social_accounts for insert with check (org_id = my_org());
create policy "org update social" on social_accounts for update using (org_id = my_org());
create policy "org delete social" on social_accounts for delete using (org_id = my_org());

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
create policy "auth upload ig-media" on storage.objects for insert to authenticated with check (bucket_id = 'ig-media');
create policy "public read ig-media"  on storage.objects for select using (bucket_id = 'ig-media');
create policy "auth delete ig-media"  on storage.objects for delete to authenticated using (bucket_id = 'ig-media');

-- ===================================================================
-- DONE. Real Supabase Auth + Postgres-enforced per-org isolation.
-- org_id now DEFAULTS to my_org() on insert, so the browser can't spoof it,
-- and RLS rejects any row that isn't the caller's org anyway.
-- ===================================================================
