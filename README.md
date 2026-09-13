# Geek Influencer OS — Bounty & Threads

The operating system for influencer agencies, brands, and creators — media kits, campaigns, mass barter, celebrity deals, IRM, and Instagram integration.

Static front-end (vanilla JS) backed by **Supabase** (Auth + Postgres + RLS + Edge Functions).

## Structure
- `index.html` — public landing page
- `app.html` — the app shell (loads `data.js`, `auth.js`, `login.js`, `app.js`)
- `DATABASE_SETUP.sql` — run once in Supabase → SQL Editor (tables + per-org RLS + triggers)
- `privacy.html`, `terms.html`, `data-deletion.html` — legal pages (required for the Meta/Instagram integration)

## Config
- Supabase URL + publishable (anon) key live in `auth.js` and `index.html` — these are safe to expose.
- **Never** commit the Supabase `service_role` key, the Meta/Instagram **App Secret**, or Razorpay secret — those belong in Supabase Edge Function secrets only.

## Deploy
Static site — deploys on Vercel with no build step (serves the HTML at the repo root).
