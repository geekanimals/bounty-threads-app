-- Paid campaigns. ADDITIVE.
--
-- Three campaign types; each follows its own rules (the type picked on the campaign decides):
--   barter       → unchanged: contract → address → courier → delivered → video brief → video → approve → post → done.
--   barter_paid  → the same barter flow + a creator FEE.
--   paid         → NO product: contract → video brief straight away (no address, no courier) → video → approve → post.
--   "Story" (barter_subtype = celebrity_story) works with any of the three — the type decides product / fee.
--
-- The fee is NEVER on the campaign form and never shown to brands / agencies or other creators:
--   • the Geek team negotiates with each creator (offline) and a Super Admin sets THAT creator's fee + terms on the
--     campaign's 💰 Payments tab — or puts them in the bulk-upload sheet (Fee / Advance % / Pay days / Terms columns)
--   • terms = total fee, advance % (paid after signing, once payment details are verified), the balance N days after every
--     post is live (N = the campaign's "Pay days after posting" dropdown, can be changed per creator), and a free-text note
--   • the creator sees only their own fee — in their contract (and in My Campaigns)
--   • on a paid campaign the contract waits until the fee is set (Super Admins are told), then goes out automatically
--
-- Payment details (bank account or UPI ID): the creator adds them in the app, or the team puts them in the bulk sheet.
-- Account numbers are stored ENCRYPTED (pgcrypto, key in Supabase Vault). They are checked automatically (RazorpayX account
-- validation) when the keys are set — otherwise a Super Admin verifies by hand. A Super Admin can ask for new details.
-- Payouts: advance / balance installments, or any amount at any time (part payments — the rest stays due). Pay through
-- Razorpay (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET as Supabase secrets; the account number is read from Razorpay), the
-- RazorpayX bulk-payout file, or record a manual transfer with its UTR and / or a screenshot the creator can download.

create extension if not exists pgcrypto with schema extensions;

-- payment steps are logged on the same timeline as every other step
alter table intel.ci_campaign_event drop constraint if exists ci_campaign_event_entity_ck;
alter table intel.ci_campaign_event add constraint ci_campaign_event_entity_ck check (entity in
  ('campaign','participation','deliverable','shipment','submission','approval','contract','address','payment'));

-- ============================================================================================================
-- 0) the encryption key (created once, never shown) + the worker can be kicked
-- ============================================================================================================
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'payout_enc_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payout_enc_key', 'Geek OS — encrypts creator bank account numbers');
  end if;
end $$;

create or replace function private.payout_key() returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'payout_enc_key' limit 1 $$;
revoke all on function private.payout_key() from public, anon, authenticated;

create or replace function private.ci_kick_worker(p_fn text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text;
begin
  if p_fn not in ('ops-notify-dispatch','ops-reminder-worker','wa-template-sync','ig-discover-worker','ci-post-insights-worker',
                  'wa-bot-worker','ig-profile-pics-worker','razorpayx-worker') then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ci_worker_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ci_project_url' limit 1;
  if v_secret is null or v_url is null then return null; end if;
  return net.http_post(url := v_url || '/functions/v1/' || p_fn, body := '{}'::jsonb,
                       headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', v_secret),
                       timeout_milliseconds := 25000);
exception when others then
  raise warning 'ci_kick_worker(%) skipped: %', p_fn, sqlerrm; return null;
end $$;
revoke all on function private.ci_kick_worker(text) from public, anon, authenticated;

-- ============================================================================================================
-- 1) what kind of campaign is this
-- ============================================================================================================
create or replace function intel.ci_campaign_flow(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_comp text; v_legacy uuid; v_type text; v_sub text; v_req jsonb; v_k jsonb; v_kind text; v_due int;
begin
  select c.comp_type, c.legacy_campaign_id into v_comp, v_legacy from intel.ci_campaign c where c.campaign_id = p_campaign;
  if not found then return null; end if;
  select pc.campaign_type, pc.barter_subtype into v_type, v_sub from public.campaigns pc where pc.id = v_legacy;
  select requirements into v_req from intel.ci_campaign_brief where campaign_id = p_campaign order by created_at desc limit 1;
  v_k := coalesce((select contract_terms from intel.ci_campaign_playbook where campaign_id = p_campaign), '{}'::jsonb);
  v_kind := coalesce(nullif(v_type, ''), nullif(v_req->>'campaign_type', ''),
                     case v_comp when 'cash' then 'paid' when 'hybrid' then 'barter_paid' else 'barter' end);
  if v_kind not in ('barter', 'paid', 'barter_paid') then v_kind := 'barter'; end if;
  v_sub := coalesce(nullif(v_sub, ''), v_req->>'barter_subtype');
  v_due := least(greatest(coalesce(nullif(v_k->>'pay_due_days', '')::int, 7), 1), 90);
  return jsonb_build_object('kind', v_kind, 'story', coalesce(v_sub = 'celebrity_story', false),
    'needs_product', v_kind <> 'paid', 'paid', v_kind in ('paid', 'barter_paid'), 'due_days', v_due);
end $$;
revoke all on function intel.ci_campaign_flow(uuid) from public, anon, authenticated;

-- ============================================================================================================
-- 2) tables: one payment row per creator, its installments, the creator's agreed fees, the bulk sheet's payment columns
-- ============================================================================================================
create table if not exists intel.ci_creator_payment (
  participation_id   uuid primary key references intel.ci_campaign_participation(participation_id) on delete cascade,
  campaign_id        uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  amount             numeric check (amount is null or amount >= 0),   -- total fee (₹); null = not agreed yet
  advance_pct        int not null default 0 check (advance_pct between 0 and 100),
  due_days           int check (due_days is null or due_days between 1 and 90),
  terms_note         text,
  fee_source         text,               -- team | bulk
  fee_set_by         uuid references auth.users(id) on delete set null,
  fee_set_at         timestamptz,
  fee_alerted_at     timestamptz,
  method             text check (method is null or method in ('bank', 'upi')),
  account_name       text,
  ifsc               text,
  bank_name          text,
  account_last4      text,
  account_enc        bytea,
  upi_id             text,
  details_source     text,               -- creator | bulk | team
  details_status     text not null default 'pending'
                     check (details_status in ('pending', 'submitted', 'verifying', 'verified', 'failed', 'needs_update')),
  details_submitted_at timestamptz,
  verify_mode        text,               -- auto | manual
  verify_ref         text,               -- RazorpayX validation id while the check runs
  verify_name        text,               -- name the bank / UPI returned
  verify_message     text,
  verify_attempts    int not null default 0,
  verified_at        timestamptz,
  verified_by        uuid references auth.users(id) on delete set null,
  request_reason     text,
  requested_at       timestamptz,
  requested_by       uuid references auth.users(id) on delete set null,
  on_hold            boolean not null default false,
  hold_reason        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists ci_creator_payment_campaign_idx on intel.ci_creator_payment(campaign_id);
create index if not exists ci_creator_payment_verify_idx on intel.ci_creator_payment(details_status) where details_status = 'verifying';
alter table intel.ci_creator_payment enable row level security;
revoke all on intel.ci_creator_payment from anon, authenticated;
drop trigger if exists ci_creator_payment_updated_at on intel.ci_creator_payment;
create trigger ci_creator_payment_updated_at before update on intel.ci_creator_payment
  for each row execute function intel.tg_set_updated_at();

-- installments: advance (after signing) + balance (N days after the posts are live), or one "full" payment;
-- any amount can also be paid at any time (part payments) — what is left is re-planned automatically
create table if not exists intel.ci_creator_payout (
  payout_id        uuid primary key default gen_random_uuid(),
  ref_code         text not null unique default ('GEEK' || upper(substr(md5(gen_random_uuid()::text), 1, 10))),
  participation_id uuid not null references intel.ci_creator_payment(participation_id) on delete cascade,
  campaign_id      uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  part             text not null check (part in ('advance', 'balance', 'full')),
  amount           numeric not null check (amount >= 0),
  status           text not null default 'waiting'
                   check (status in ('waiting', 'due', 'queued', 'processing', 'paid', 'failed', 'cancelled')),
  due_at           date,
  provider         text,                 -- razorpayx | razorpayx_bulk | manual
  provider_ref     text,                 -- RazorpayX payout id
  utr              text,
  failure_reason   text,
  attempts         int not null default 0,
  queued_by        uuid references auth.users(id) on delete set null,
  queued_at        timestamptz,
  paid_at          timestamptz,
  paid_by          uuid references auth.users(id) on delete set null,
  note             text,
  proof_path       text,                 -- screenshot / PDF of a manual transfer (storage: payment-proofs) — the creator can open it
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ci_creator_payout_campaign_idx on intel.ci_creator_payout(campaign_id);
create index if not exists ci_creator_payout_work_idx on intel.ci_creator_payout(status) where status in ('queued', 'processing');
alter table intel.ci_creator_payout enable row level security;
revoke all on intel.ci_creator_payout from anon, authenticated;
drop trigger if exists ci_creator_payout_updated_at on intel.ci_creator_payout;
create trigger ci_creator_payout_updated_at before update on intel.ci_creator_payout
  for each row execute function intel.tg_set_updated_at();

-- every fee a creator agreed to (shown on their profile to Super Admins: the first one, the latest, all of them)
create table if not exists intel.ci_creator_rate (
  participation_id uuid primary key references intel.ci_campaign_participation(participation_id) on delete cascade,
  identity_id      uuid not null,
  campaign_id      uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  amount           numeric not null,
  advance_pct      int not null default 0,
  deliverables     text,
  kind             text,
  story            boolean not null default false,
  agreed_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ci_creator_rate_identity_idx on intel.ci_creator_rate(identity_id, agreed_at);
alter table intel.ci_creator_rate enable row level security;
revoke all on intel.ci_creator_rate from anon, authenticated;

-- the bulk sheet's payment columns, held until the creator is on the campaign (matched on phone / email / Instagram)
create table if not exists private.ci_bulk_payment_stage (
  stage_id       uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  phone_e164     text, email text, handle text,
  amount         numeric, advance_pct int, due_days int, terms_note text,
  method         text, account_name text, ifsc text, account_last4 text, account_enc bytea, upi_id text,
  created_by     uuid, created_at timestamptz not null default now(),
  applied_at     timestamptz, participation_id uuid
);
create index if not exists ci_bulk_payment_stage_camp_idx on private.ci_bulk_payment_stage(campaign_id) where applied_at is null;
alter table private.ci_bulk_payment_stage enable row level security;
revoke all on private.ci_bulk_payment_stage from public, anon, authenticated;

-- ============================================================================================================
-- 3) core helpers
-- ============================================================================================================
-- (re)build the installments still to pay from the fee + advance %, minus everything already sent / paid
--   advance target = fee × advance % (due once the contract is signed) · the rest is due N days after every post is live
--   0% → one "full" payment after the posts · 100% → one "full" payment after signing · part payments count towards the advance first
create or replace function intel.ci_payment_build_payouts(p_participation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v intel.ci_creator_payment%rowtype; v_stage text; v_signed boolean; v_done boolean; v_locked numeric;
        v_adv_t numeric; v_adv_left numeric; v_bal_left numeric; v_old jsonb;
begin
  select * into v from intel.ci_creator_payment where participation_id = p_participation;
  if v.participation_id is null then return; end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
  v_signed := v_stage in ('contract_signed','address_confirmed','product_sent','content_created','content_submitted','changes_requested',
                          'content_approved','published','completed');
  v_done := v_stage = 'completed';
  -- keep the due dates already set, then drop everything not yet on its way
  select coalesce(jsonb_object_agg(part, due_at), '{}'::jsonb) into v_old from intel.ci_creator_payout
   where participation_id = p_participation and status in ('waiting','due','failed','cancelled') and due_at is not null;
  delete from intel.ci_creator_payout where participation_id = p_participation and status in ('waiting','due','failed','cancelled');
  if v.amount is null then return; end if;
  select coalesce(sum(amount), 0) into v_locked from intel.ci_creator_payout
   where participation_id = p_participation and status in ('queued','processing','paid');
  v_adv_t := round(v.amount * v.advance_pct / 100.0);
  v_adv_left := greatest(v_adv_t - v_locked, 0);
  v_bal_left := greatest(v.amount - greatest(v_adv_t, v_locked), 0);
  if v_adv_left > 0 then
    insert into intel.ci_creator_payout(participation_id, campaign_id, part, amount, status, due_at, note)
    values (p_participation, v.campaign_id, case when v_bal_left = 0 and v_locked = 0 then 'full' else 'advance' end, v_adv_left,
            case when v_signed then 'due' else 'waiting' end,
            case when v_signed then coalesce((v_old->>'advance')::date, (v_old->>'full')::date, current_date) end,
            'due after the contract is signed');
  end if;
  if v_bal_left > 0 then
    insert into intel.ci_creator_payout(participation_id, campaign_id, part, amount, status, due_at, note)
    values (p_participation, v.campaign_id, case when v_adv_t = 0 and v_locked = 0 then 'full' else 'balance' end, v_bal_left,
            case when v_done then 'due' else 'waiting' end,
            case when v_done then coalesce((v_old->>'balance')::date, (v_old->>'full')::date, current_date + coalesce(v.due_days, 7)) end,
            'due after every post is live');
  end if;
end $$;
revoke all on function intel.ci_payment_build_payouts(uuid) from public, anon, authenticated;

-- what is still to pay (fee − everything sent / paid)
create or replace function intel.ci_payment_left(p_participation uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(coalesce(p.amount, 0) - coalesce((select sum(o.amount) from intel.ci_creator_payout o
           where o.participation_id = p.participation_id and o.status in ('queued','processing','paid')), 0), 0)
    from intel.ci_creator_payment p where p.participation_id = p_participation $$;
revoke all on function intel.ci_payment_left(uuid) from public, anon, authenticated;

-- set one creator's fee + terms (Super Admin or the bulk sheet). Re-issues an unsigned contract; sends a waiting one.
create or replace function intel.ci_payment_set_terms(p_participation uuid, p_amount numeric, p_advance_pct int, p_due_days int,
                                                      p_note text, p_source text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v intel.ci_creator_payment%rowtype; v_stage text; v_signed boolean; v_identity uuid; v_flow jsonb; v_inv uuid; v_inv_status text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception 'enter the fee in ₹ (more than 0)' using errcode = '22023'; end if;
  if p_advance_pct is not null and (p_advance_pct < 0 or p_advance_pct > 100) then raise exception 'advance must be 0 to 100 %%' using errcode = '22023'; end if;
  if p_due_days is not null and (p_due_days < 1 or p_due_days > 90) then raise exception 'pay days must be 1 to 90' using errcode = '22023'; end if;
  perform intel.ci_ensure_payment(p_participation);     -- a pending bulk-sheet row is applied first; what is typed here wins
  select * into v from intel.ci_creator_payment where participation_id = p_participation for update;
  if v.participation_id is null then raise exception 'this campaign has no creator fee (it is a barter campaign)' using errcode = '22023'; end if;
  if round(p_amount) < coalesce((select sum(amount) from intel.ci_creator_payout where participation_id = p_participation and status in ('queued','processing','paid')), 0) then
    raise exception 'the fee can''t be less than what is already paid / being paid' using errcode = '22023'; end if;
  select stage, identity_id into v_stage, v_identity from intel.ci_campaign_participation where participation_id = p_participation;
  select signed_at is not null into v_signed from intel.ci_campaign_contract where participation_id = p_participation;

  update intel.ci_creator_payment set amount = round(p_amount), advance_pct = coalesce(p_advance_pct, advance_pct),
         due_days = coalesce(p_due_days, due_days), terms_note = coalesce(nullif(btrim(p_note), ''), terms_note),
         fee_source = coalesce(p_source, 'team'), fee_set_by = p_actor, fee_set_at = now()
   where participation_id = p_participation;
  perform intel.ci_payment_build_payouts(p_participation);

  -- the creator's agreed fees (their profile) — kept in step until they are paid
  v_flow := intel.ci_campaign_flow(v.campaign_id);
  insert into intel.ci_creator_rate(participation_id, identity_id, campaign_id, amount, advance_pct, deliverables, kind, story)
  values (p_participation, v_identity, v.campaign_id, round(p_amount), coalesce(p_advance_pct, v.advance_pct),
          (intel.ci_playbook(v.campaign_id)->'contract')->>'deliverables', v_flow->>'kind', coalesce((v_flow->>'story')::boolean, false))
  on conflict (participation_id) do update set amount = excluded.amount, advance_pct = excluded.advance_pct,
    deliverables = coalesce(excluded.deliverables, intel.ci_creator_rate.deliverables), updated_at = now();

  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v.campaign_id, p_participation, 'payment', coalesce(v.amount::text, 'not set'), 'fee_set', p_actor,
            'fee ₹' || round(p_amount) || coalesce(', ' || coalesce(p_advance_pct, v.advance_pct) || '% advance', '')
            || case when coalesce(v_signed, false) then ' (changed after the contract was signed)' else '' end);

  -- the contract: an unsigned one is re-written with the fee; a waiting one goes out now
  if not coalesce(v_signed, false) and v_stage in ('brand_confirmed','accepted','contract_sent') then
    perform intel.ci_issue_contract(p_participation, p_actor);
    -- a bulk-uploaded creator whose row was on a later step carries on to it
    select invite_id, status into v_inv, v_inv_status from intel.ci_campaign_invite where participation_id = p_participation limit 1;
    if v_inv is not null and intel.ci_bulk_rank(coalesce(v_inv_status, 'registered')) > 5 then
      perform intel.ci_bulk_fastforward(p_participation, v_inv, p_actor, true);
    end if;
  end if;
  return jsonb_build_object('amount', round(p_amount), 'contract_signed', coalesce(v_signed, false),
    'stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation));
end $$;
revoke all on function intel.ci_payment_set_terms(uuid, numeric, int, int, text, text, uuid) from public, anon, authenticated;

-- save bank / UPI details (creator, bulk sheet or team) → the automatic check runs
create or replace function intel.ci_payment_set_details(p_participation uuid, p_method text, p_account_name text, p_account_no text,
                                                        p_ifsc text, p_upi text, p_source text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row intel.ci_creator_payment%rowtype; v_no text; v_ifsc text; v_upi text; v_name text;
begin
  select * into v_row from intel.ci_creator_payment where participation_id = p_participation;
  if v_row.participation_id is null then raise exception 'this campaign has no fee — no payment details needed' using errcode = '22023'; end if;
  if exists (select 1 from intel.ci_creator_payout where participation_id = p_participation and status in ('queued','processing')) then
    raise exception 'a payment is on its way to the current details — wait until it is done' using errcode = '22023'; end if;
  if not exists (select 1 from intel.ci_creator_payout where participation_id = p_participation and status not in ('paid','cancelled'))
     and exists (select 1 from intel.ci_creator_payout where participation_id = p_participation and status = 'paid') then
    raise exception 'this fee is already paid' using errcode = '22023'; end if;
  v_name := btrim(regexp_replace(coalesce(p_account_name, ''), '\s+', ' ', 'g'));
  if length(v_name) < 3 then raise exception 'type the account holder''s full name, as in the bank' using errcode = '22023'; end if;

  if p_method = 'bank' then
    v_no := regexp_replace(coalesce(p_account_no, ''), '[\s-]', '', 'g');
    v_ifsc := upper(btrim(coalesce(p_ifsc, '')));
    if v_no !~ '^[0-9]{9,18}$' then raise exception 'the account number should be 9 to 18 digits' using errcode = '22023'; end if;
    if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'the IFSC code looks wrong — it is 11 characters, like HDFC0001234' using errcode = '22023'; end if;
    update intel.ci_creator_payment set method = 'bank', account_name = v_name, ifsc = v_ifsc, account_last4 = right(v_no, 4),
           account_enc = extensions.pgp_sym_encrypt(v_no, private.payout_key()), upi_id = null, bank_name = null
     where participation_id = p_participation;
  elsif p_method = 'upi' then
    v_upi := lower(btrim(coalesce(p_upi, '')));
    if v_upi !~ '^[a-z0-9._-]{2,255}@[a-z][a-z0-9.-]{1,63}$' then raise exception 'the UPI ID looks wrong — it is like name@okhdfcbank' using errcode = '22023'; end if;
    update intel.ci_creator_payment set method = 'upi', account_name = v_name, upi_id = v_upi, ifsc = null, account_last4 = null,
           account_enc = null, bank_name = null
     where participation_id = p_participation;
  else raise exception 'choose bank account or UPI' using errcode = '22023'; end if;

  update intel.ci_creator_payment set details_source = coalesce(p_source, 'creator'), details_status = 'verifying', details_submitted_at = now(),
         verify_mode = null, verify_ref = null, verify_name = null, verify_message = null, verified_at = null, verified_by = null,
         verify_attempts = 0, request_reason = null
   where participation_id = p_participation;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_row.campaign_id, p_participation, 'payment', v_row.details_status, 'payment_details_added', p_actor,
            p_method || ' · ' || coalesce(p_source, 'creator'));
  -- failed payouts can go again once the new details are verified
  update intel.ci_creator_payout set status = 'due', failure_reason = null where participation_id = p_participation and status = 'failed';
  begin perform private.ci_kick_worker('razorpayx-worker'); exception when others then null; end;
end $$;
revoke all on function intel.ci_payment_set_details(uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated;

-- the bulk sheet's payment columns for this creator (if any) → applied once they are on the campaign
create or replace function intel.ci_apply_staged_payment(p_participation uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare i record; s private.ci_bulk_payment_stage%rowtype; v_no text;
begin
  select ci.campaign_id, ci.phone_e164, lower(ci.email) email, lower(ci.handle) handle into i
    from intel.ci_campaign_invite ci where ci.participation_id = p_participation limit 1;
  if i.campaign_id is null then return false; end if;
  select * into s from private.ci_bulk_payment_stage st
   where st.campaign_id = i.campaign_id and st.applied_at is null
     and ((st.phone_e164 is not null and st.phone_e164 = i.phone_e164) or (st.email is not null and st.email = i.email)
          or (st.handle is not null and st.handle = i.handle))
   order by st.created_at desc limit 1;
  if s.stage_id is null then return false; end if;
  update private.ci_bulk_payment_stage set applied_at = now(), participation_id = p_participation
   where campaign_id = i.campaign_id and applied_at is null
     and ((phone_e164 is not null and phone_e164 = i.phone_e164) or (email is not null and email = i.email) or (handle is not null and handle = i.handle));
  -- terms first (no contract side-effects here: the caller issues the contract), then the details
  if s.amount is not null then
    update intel.ci_creator_payment set amount = round(s.amount), advance_pct = coalesce(s.advance_pct, advance_pct),
           due_days = coalesce(s.due_days, due_days), terms_note = coalesce(s.terms_note, terms_note),
           fee_source = 'bulk', fee_set_by = s.created_by, fee_set_at = now()
     where participation_id = p_participation
       and round(s.amount) >= coalesce((select sum(po.amount) from intel.ci_creator_payout po where po.participation_id = p_participation and po.status in ('queued','processing','paid')), 0);
    perform intel.ci_payment_build_payouts(p_participation);
    insert into intel.ci_creator_rate(participation_id, identity_id, campaign_id, amount, advance_pct, deliverables, kind, story)
    select p_participation, p.identity_id, p.campaign_id, round(s.amount), coalesce(s.advance_pct, 0),
           (intel.ci_playbook(p.campaign_id)->'contract')->>'deliverables', intel.ci_campaign_flow(p.campaign_id)->>'kind',
           coalesce((intel.ci_campaign_flow(p.campaign_id)->>'story')::boolean, false)
      from intel.ci_campaign_participation p where p.participation_id = p_participation
    on conflict (participation_id) do update set amount = excluded.amount, advance_pct = excluded.advance_pct, updated_at = now();
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
      values (i.campaign_id, p_participation, 'payment', null, 'fee_set', s.created_by, 'fee ₹' || round(s.amount) || ' from the bulk upload');
  end if;
  if s.method = 'bank' and s.account_enc is not null then
    v_no := extensions.pgp_sym_decrypt(s.account_enc, private.payout_key());
    begin perform intel.ci_payment_set_details(p_participation, 'bank', s.account_name, v_no, s.ifsc, null, 'bulk', s.created_by);
    exception when others then null; end;
  elsif s.method = 'upi' and s.upi_id is not null then
    begin perform intel.ci_payment_set_details(p_participation, 'upi', s.account_name, null, null, s.upi_id, 'bulk', s.created_by);
    exception when others then null; end;
  end if;
  return true;
end $$;
revoke all on function intel.ci_apply_staged_payment(uuid) from public, anon, authenticated;

-- make sure a creator on a paid campaign has a payment row (no-op on barter). Picks up the bulk sheet's columns.
create or replace function intel.ci_ensure_payment(p_participation uuid, p_apply_staged boolean default true)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_flow jsonb;
begin
  select campaign_id into v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_camp is null then return null; end if;
  v_flow := intel.ci_campaign_flow(v_camp);
  if not coalesce((v_flow->>'paid')::boolean, false) then return null; end if;
  insert into intel.ci_creator_payment(participation_id, campaign_id, due_days)
  values (p_participation, v_camp, (v_flow->>'due_days')::int)
  on conflict (participation_id) do nothing;
  if p_apply_staged then perform intel.ci_apply_staged_payment(p_participation); end if;
  return (select amount from intel.ci_creator_payment where participation_id = p_participation);
end $$;
revoke all on function intel.ci_ensure_payment(uuid, boolean) from public, anon, authenticated;

-- ============================================================================================================
-- 4) the contract: different wording for barter / barter + paid / paid; a paid one carries THIS creator's fee + terms
-- ============================================================================================================
create or replace function intel.ci_inr(p numeric) returns text language sql immutable set search_path = '' as $$
  select '₹' || to_char(round(p), 'FM99,99,99,99,999') $$;

create or replace function intel.ci_contract_clauses(p_terms jsonb, p_brand text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v jsonb := '[]'::jsonb; n int := coalesce(nullif(p_terms->>'ad_rights_months','')::int,1);
        d int := coalesce(nullif(p_terms->>'content_days','')::int,7); val text; v_days text; v_tags text;
        v_kind text := coalesce(nullif(p_terms->>'kind',''), 'barter');
        v_product boolean := coalesce((p_terms->>'needs_product')::boolean, v_kind <> 'paid');
        v_paid boolean := v_kind in ('paid','barter_paid');
        v_fee numeric := nullif(p_terms->>'fee','')::numeric;
        v_pct int := coalesce(nullif(p_terms->>'advance_pct','')::int, 0);
        v_due int := coalesce(nullif(p_terms->>'due_days','')::int, 7);
        v_adv numeric; v_bal numeric; v_brand text := coalesce(p_brand,'the brand'); v_sched text; v_due_txt text;
begin
  v_days := d || ' day' || case when d > 1 then 's' else '' end;
  v_due_txt := v_due || ' day' || case when v_due > 1 then 's' else '' end;
  val := case when nullif(p_terms->>'product_value','') is not null then ' (worth ₹'||(p_terms->>'product_value')||')' else '' end;

  if v_product then
    v := v || jsonb_build_array(jsonb_build_object('key','product','title','Product',
          'text', 'You will receive '||coalesce(nullif(p_terms->>'product',''),'the product')||val||' from '||v_brand
                  ||' free of cost'||case when v_paid then '' else ', in exchange for the content below' end
                  ||'. Once your content is posted, the product is yours to keep.'));
  end if;
  if v_paid then
    if v_fee is null then
      v_sched := 'Your fee is the amount agreed with the Geek team, shown to you in the app.';
    else
      v_adv := round(v_fee * v_pct / 100.0); v_bal := v_fee - v_adv;
      v_sched := 'For the content below you will be paid a total fee of '||intel.ci_inr(v_fee)||' (Indian Rupees)'
                 ||case when v_product then ', in addition to the product' else '' end||'. '
                 ||case when v_pct >= 100 then 'The full fee is paid in advance, after you sign this contract and your payment details are verified.'
                        when v_pct > 0 then 'It is paid in two parts: an advance of '||intel.ci_inr(v_adv)||' ('||v_pct||'%) after you sign this contract and your payment details are verified, '
                                            ||'and the balance of '||intel.ci_inr(v_bal)||' within '||v_due_txt||' after every post for this campaign is live and its link is on the app.'
                        else 'It is paid in full within '||v_due_txt||' after every post for this campaign is live and its link is on the app.' end
                 ||' This is the full amount for this campaign; there are no other payments, and no deductions other than the tax described under Payment terms.';
    end if;
    if nullif(btrim(p_terms->>'pay_note'),'') is not null then
      v_sched := v_sched || ' Also agreed: ' || btrim(p_terms->>'pay_note') || '.';
    end if;
    v := v || jsonb_build_array(jsonb_build_object('key','fee','title','Your fee','text', v_sched));
  end if;
  v := v || jsonb_build_array(jsonb_build_object('key','deliverables','title','What you will make',
        'text', 'You will create and post: '||coalesce(nullif(p_terms->>'deliverables',''),'1 Reel')
                ||', within '||v_days||' of '||case when v_product then 'receiving the product' else 'receiving the video brief (it is sent to you in the app as soon as you sign this contract)' end
                ||', following the video brief shared in the app. '
                ||'Every one of them counts: the campaign is complete only when all of them are posted and their links are on the app.'));
  v_tags := btrim(coalesce(p_terms->>'hashtags','') || ' ' || coalesce(p_terms->>'mentions',''));
  if v_tags <> '' then
    v := v || jsonb_build_array(jsonb_build_object('key','tags','title','Hashtags & mentions',
          'text', 'Every post must use: '||v_tags||'.'));
  end if;
  v := v || jsonb_build_array(jsonb_build_object('key','approval','title','Post only after approval',
        'text', 'First submit your video in the app for review. You may post it on Instagram only after '||v_brand
                ||' approves it in the app. Posting before approval, or posting a different cut, is a breach of this contract.'));
  v := v || jsonb_build_array(jsonb_build_object('key','asci','title','ASCI disclosure',
        'text', 'Every post must clearly disclose the collaboration as per the ASCI Guidelines for Influencer Advertising in Digital Media: '
                ||'use the "Paid partnership" label and/or #ad / #collab at the start of the caption. Do not make claims the brand has not approved.'));
  v := v || jsonb_build_array(jsonb_build_object('key','ad_rights','title','Ad rights: keep it live',
        'text', v_brand||' may use your content (organic and as paid ads, including whitelisting) for '||n||' month'
                ||case when n>1 then 's' else '' end||' from the date you post. For those '||n||' month'||case when n>1 then 's' else '' end
                ||' your posts and reels for this campaign must stay live on your profile; do not delete or archive them. '
                ||'We check this automatically and remind you if one is missing.'));
  if coalesce((p_terms->>'collab_rights')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','collab','title','Collab rights',
          'text', 'You will add '||v_brand||' as an Instagram collaborator on the post so it also appears on their profile.'));
  end if;
  if v_paid then
    v := v || jsonb_build_array(jsonb_build_object('key','payment','title','Payment terms',
          'text', 'Add your bank account or UPI ID in the app. It must be in your own name; we verify it before any payment is made, '
                  ||'and every payment goes only to that verified account. '
                  ||'Payments are made only for content that was approved in the app and posted as agreed. '
                  ||case when v_pct > 0 then 'If you receive an advance and then do not deliver the content as agreed, you must return the advance in full within 7 days of being asked. ' else '' end
                  ||'If a post is deleted or archived during the ad rights period, any payment still due may be held until it is restored. '
                  ||'Where tax has to be deducted at source (TDS) under Indian law, it is deducted from the fee and the certificate is shared with you. '
                  ||'You are responsible for your own income tax and GST, if applicable. Keep the fee confidential.'));
  end if;
  if coalesce((p_terms->>'blacklist_clause')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','non_delivery','title',
          case when v_product then 'If you don''t deliver: blacklist' else 'If you don''t deliver' end,
          'text', case when v_product then
                    'If you receive the product and do not submit your video within '||v_days||' of delivery (we remind you on WhatsApp, email and in the app), '
                    ||'your account is blocked and removed from all campaigns on the Geek platform until you speak with our team.'
                    ||case when v_paid then ' No fee is payable in that case.' else '' end
                  else
                    'If you do not submit your video within '||v_days||' of receiving the brief, or do not post it after it is approved '
                    ||'(we remind you on WhatsApp, email and in the app), no further fee is payable and your account may be blocked from future campaigns '
                    ||'on the Geek platform until you speak with our team.' end));
  end if;
  if v_product and coalesce((p_terms->>'reship_clause')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','reship','title','Return / re-ship at your own cost',
          'text', 'In that case you must also send the product, at your own cost, to another creator nominated by Geek or '
                  ||v_brand||', within 7 days of being asked, in the condition you received it.'));
  end if;
  if nullif(btrim(p_terms->>'extra_terms'),'') is not null then
    v := v || jsonb_build_array(jsonb_build_object('key','extra','title','Other terms','text', btrim(p_terms->>'extra_terms')));
  end if;
  return v;
end $$;

-- a paid contract is issued only once this creator's fee is set (Super Admins are told once)
create or replace function intel.ci_issue_contract(p_participation uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_stage text; v_pb jsonb; v_k jsonb; v_brand text; v_cid uuid; v_months int; v_signed timestamptz;
        v_flow jsonb; v_pay intel.ci_creator_payment%rowtype; v_product boolean; v_name text; v_handle text;
begin
  select p.campaign_id, p.stage, p.applied_profile into v_camp, v_stage, v_handle from intel.ci_campaign_participation p where p.participation_id = p_participation;
  if v_camp is null then return null; end if;
  if v_stage not in ('brand_confirmed','accepted','contract_sent') then return null; end if;
  select signed_at into v_signed from intel.ci_campaign_contract where participation_id = p_participation;
  if v_signed is not null then return null; end if;

  v_pb := intel.ci_playbook(v_camp); v_k := v_pb->'contract';
  v_k := v_k || jsonb_strip_nulls(jsonb_build_object('hashtags', nullif(btrim(v_pb->'brief'->>'hashtags'),''),
                                                     'mentions', nullif(btrim(v_pb->'brief'->>'mentions'),'')));
  v_flow := intel.ci_campaign_flow(v_camp);
  v_product := coalesce((v_flow->>'needs_product')::boolean, true);
  if coalesce((v_flow->>'paid')::boolean, false) then
    perform intel.ci_ensure_payment(p_participation);
    select * into v_pay from intel.ci_creator_payment where participation_id = p_participation;
    if v_pay.amount is null then
      -- no fee agreed yet → the contract waits; tell the Super Admins once
      if v_pay.fee_alerted_at is null then
        select name into v_name from intel.ci_campaign where campaign_id = v_camp;
        perform intel.ci_alert_admins('💰 Set the fee: ' || coalesce('@' || nullif(v_handle, ''), 'a creator') || ' · ' || coalesce(v_name, 'campaign'),
          coalesce('@' || nullif(v_handle, ''), 'This creator') || ' is approved on ' || coalesce(v_name, 'a paid campaign')
            || '. Their contract goes out automatically as soon as you set their fee: open the campaign → 💰 Payments.',
          'campaigns', 'Set fee', 'action_required', null);
        update intel.ci_creator_payment set fee_alerted_at = now() where participation_id = p_participation;
      end if;
      return null;
    end if;
    v_k := v_k || jsonb_strip_nulls(jsonb_build_object('fee', v_pay.amount, 'advance_pct', v_pay.advance_pct,
                                                       'due_days', coalesce(v_pay.due_days, (v_flow->>'due_days')::int),
                                                       'pay_note', nullif(btrim(v_pay.terms_note), '')));
  end if;
  v_k := v_k || jsonb_build_object('kind', v_flow->>'kind', 'needs_product', v_product);
  select coalesce(b.name, c.submitted_brand_name) into v_brand
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = v_camp;
  v_months := coalesce((v_k->>'ad_rights_months')::int, 1);

  insert into intel.ci_campaign_contract(participation_id, campaign_id, terms_version, ad_rights_months, ad_rights_until,
      collab_rights, product, product_value, deliverables, content_days, clauses, issued_by)
  values (p_participation, v_camp, 'geek-' || replace(coalesce(v_flow->>'kind','barter'), '_', '-') || '-v3', v_months,
      (current_date + make_interval(months => v_months))::date,
      coalesce((v_k->>'collab_rights')::boolean, true), case when v_product then v_k->>'product' end,
      case when v_product then nullif(v_k->>'product_value','')::numeric end,
      intel.ci_parse_deliverables(v_k->>'deliverables'), (v_k->>'content_days')::int,
      intel.ci_contract_clauses(v_k, v_brand), p_actor)
  on conflict (participation_id) do update set
      terms_version = excluded.terms_version, ad_rights_months = excluded.ad_rights_months, ad_rights_until = excluded.ad_rights_until,
      collab_rights = excluded.collab_rights, product = excluded.product, product_value = excluded.product_value,
      deliverables = excluded.deliverables, content_days = excluded.content_days, clauses = excluded.clauses,
      issued_by = excluded.issued_by, issued_at = now(), updated_at = now()
  returning contract_id into v_cid;

  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'contract', null, 'issued', p_actor, 'issued automatically from the campaign terms');
  if v_stage in ('brand_confirmed','accepted') then
    perform intel.ci_participation_advance(p_participation, 'contract_sent', p_actor, 'contract sent automatically');
  end if;
  return v_cid;
end $$;
-- 4b) the steps: a paid campaign (no product) goes from "contract signed" straight to "video brief"
-- ============================================================================================================
create or replace function intel.ci_participation_advance(p_participation uuid, p_to text, p_actor uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_from text; v_camp uuid; v_ok boolean; v_needs_reason boolean;
        v_legal jsonb := jsonb_build_object(
          'applied',        jsonb_build_array('eligible','ineligible','dropped'),
          'eligible',       jsonb_build_array('sent_to_brand','dropped'),
          'sent_to_brand',  jsonb_build_array('brand_confirmed','brand_declined','dropped'),
          'brand_confirmed',jsonb_build_array('contract_sent','dropped'),
          'contract_sent',  jsonb_build_array('contract_signed','dropped'),
          'contract_signed',jsonb_build_array('address_confirmed','content_created','dropped'),
          'address_confirmed', jsonb_build_array('product_sent','dropped'),
          'shortlisted', jsonb_build_array('invited','dropped'),
          'invited',     jsonb_build_array('accepted','applied','rejected','dropped'),
          'accepted',    jsonb_build_array('contract_sent','product_sent','dropped'),
          'product_sent',jsonb_build_array('content_created','dropped'),
          'content_created', jsonb_build_array('content_submitted','dropped'),
          'content_submitted', jsonb_build_array('content_approved','changes_requested','rejected','dropped'),
          'changes_requested', jsonb_build_array('content_submitted','dropped'),
          'content_approved', jsonb_build_array('published','dropped'),
          'published',   jsonb_build_array('completed'));
begin
  select stage, campaign_id into v_from, v_camp from intel.ci_campaign_participation where participation_id=p_participation;
  if v_from is null then raise exception 'participation not found' using errcode='42501'; end if;
  v_ok := (v_legal ? v_from) and (v_legal->v_from) ? p_to;
  if not v_ok then raise exception 'illegal transition % -> %', v_from, p_to using errcode='22023'; end if;
  v_needs_reason := p_to in ('rejected','dropped','changes_requested','ineligible','brand_declined');
  if v_needs_reason and coalesce(btrim(p_reason),'')='' then
    raise exception 'a reason is required to % a participation', p_to using errcode='22023'; end if;

  update intel.ci_campaign_participation
    set stage=p_to, reason=case when v_needs_reason then p_reason else reason end,
        invited_at  = case when p_to='invited'  then now() else invited_at  end,
        accepted_at = case when p_to='accepted' then now() else accepted_at end,
        rejected_at = case when p_to in ('rejected','ineligible','brand_declined','dropped') then now() else rejected_at end,
        address_confirmed_at = case when p_to='address_confirmed' then now() else address_confirmed_at end
    where participation_id=p_participation;

  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'participation', v_from, p_to, p_actor, p_reason);
  return p_to;
end $$;

revoke all on function intel.ci_participation_advance(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function intel.ci_participation_advance(uuid,text,uuid,text) to service_role;

-- ============================================================================================================
-- 5) the paid flow on autopilot (runs after the barter autoflow on every event)
-- ============================================================================================================
create or replace function intel.tg_paid_autoflow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_flow jsonb; v_stage text; v_infl uuid; v_identity uuid; v_name text; v_brand text; v_pay intel.ci_creator_payment%rowtype;
        r record; v_days text;
begin
  if not intel.ci_feature_enabled('operational_pilot') or new.participation_id is null or new.entity <> 'participation' then return null; end if;
  if new.to_status not in ('brand_confirmed','accepted','contract_signed','completed') then return null; end if;
  v_flow := intel.ci_campaign_flow(new.campaign_id);
  if v_flow is null then return null; end if;
  select identity_id, stage into v_identity, v_stage from intel.ci_campaign_participation where participation_id = new.participation_id;
  v_infl := intel.ci_member_of_identity(v_identity);
  select c.name, coalesce(b.name, c.submitted_brand_name) into v_name, v_brand
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = new.campaign_id;

  if new.to_status in ('brand_confirmed','accepted') then
    perform intel.ci_ensure_payment(new.participation_id);

  elsif new.to_status = 'contract_signed' then
    if coalesce((v_flow->>'paid')::boolean, false) then
      perform intel.ci_ensure_payment(new.participation_id);
      perform intel.ci_payment_build_payouts(new.participation_id);          -- the advance is due now
      select * into v_pay from intel.ci_creator_payment where participation_id = new.participation_id;
      if v_pay.details_status in ('pending','needs_update','failed') then
        perform intel.ci_notify(v_infl, new.campaign_id, new.participation_id, 'payment_details_needed',
          jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'brand', coalesce(v_brand,'')));
      end if;
    end if;
    -- nothing to ship → the video brief goes out right away
    if not coalesce((v_flow->>'needs_product')::boolean, true) and v_stage = 'contract_signed' then
      perform intel.ci_participation_advance(new.participation_id, 'content_created', new.actor_member_id,
                                             'video brief sent automatically — nothing to ship on this campaign');
      select coalesce(k.content_days::text, (intel.ci_playbook(new.campaign_id)->'contract')->>'content_days', '7') into v_days
        from intel.ci_campaign_contract k where k.participation_id = new.participation_id;
      perform intel.ci_notify(v_infl, new.campaign_id, new.participation_id, 'paid_brief_ready',
        jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'brand', coalesce(v_brand,''), 'days', coalesce(v_days, '7')));
    end if;

  elsif new.to_status = 'completed' and coalesce((v_flow->>'paid')::boolean, false) then
    -- every post is live → the balance (or the full fee) is due N days from today
    perform intel.ci_ensure_payment(new.participation_id);
    perform intel.ci_payment_build_payouts(new.participation_id);
    select * into v_pay from intel.ci_creator_payment where participation_id = new.participation_id;
    for r in select * from intel.ci_creator_payout where participation_id = new.participation_id and status = 'due' and part in ('balance','full')
               and due_at is not null and due_at > current_date - 1 loop
      perform intel.ci_notify(v_infl, new.campaign_id, new.participation_id,
        case when v_pay.details_status = 'verified' then 'payment_scheduled' else 'payment_details_needed' end,
        jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'brand', coalesce(v_brand,''),
                           'amount', intel.ci_inr(r.amount), 'date', to_char(r.due_at, 'DD Mon YYYY')));
    end loop;
  end if;
  return null;
end $$;
revoke all on function intel.tg_paid_autoflow() from public, anon, authenticated;
drop trigger if exists ci_event_zz_paidflow on intel.ci_campaign_event;
create trigger ci_event_zz_paidflow after insert on intel.ci_campaign_event
  for each row execute function intel.tg_paid_autoflow();

-- the step message after signing: "confirm your address" only when there is a product to ship
create or replace function intel.tg_ops_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_infl uuid; v_oper uuid; v_identity uuid; v_name text; v_vars jsonb;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;

  select c.name, c.created_by into v_name, v_oper from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
  if NEW.participation_id is not null then
    select identity_id into v_identity from intel.ci_campaign_participation where participation_id = NEW.participation_id;
    v_infl := intel.ci_member_of_identity(v_identity);
  end if;
  v_vars := jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'participation_id', coalesce(NEW.participation_id::text,''));

  if NEW.entity = 'participation' then
    -- reminders auto-cancel when the awaited stage is reached
    update intel.ci_reminder set cancelled_at = now()
      where participation_id = NEW.participation_id and cancel_on_stage = NEW.to_status and fired_at is null and cancelled_at is null;

    case NEW.to_status
      when 'invited'          then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'invited', v_vars);
      when 'applied'          then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'applied_received', v_vars);
      when 'eligible'         then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'eligible_ready', v_vars);
      when 'sent_to_brand'    then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'sent_to_brand', v_vars);
      when 'brand_confirmed'  then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'brand_confirmed', v_vars);
      when 'brand_declined'   then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'brand_declined', v_vars);
      when 'contract_sent'    then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'contract_sent', v_vars);
      when 'contract_signed'  then
        if coalesce((intel.ci_campaign_flow(NEW.campaign_id)->>'needs_product')::boolean, true) then
          perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'confirm_address', v_vars);
        end if;
      when 'address_confirmed'then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'address_confirmed', v_vars);
      when 'product_sent'     then
        perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'product_shipped', v_vars);
        insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, cancel_on_stage)
          values (NEW.participation_id, NEW.campaign_id, 'video_due', 'video_due', now() + interval '3 days', 'content_submitted');
      when 'content_submitted' then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'content_for_review', v_vars);
      when 'changes_requested' then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'changes_requested', v_vars);
      when 'content_approved'  then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'content_approved', v_vars);
      when 'published'        then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'published', v_vars);
      when 'completed'        then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'completed', v_vars);
      else null;
    end case;

  elsif NEW.entity = 'shipment' and NEW.to_status = 'delivered' then
    perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'parcel_received', v_vars);
    -- (re)start the 3-day video SLA from delivery
    if NEW.participation_id is not null then
      insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, cancel_on_stage)
        values (NEW.participation_id, NEW.campaign_id, 'video_due', 'video_due', now() + interval '3 days', 'content_submitted');
    end if;
  end if;
  return null;
end $$;
revoke all on function intel.tg_ops_notify() from public, anon, authenticated;


-- the bulk sheet / "Set step" walk: a campaign with nothing to ship skips the address + courier steps
create or replace function intel.ci_bulk_fastforward(p_part uuid, p_invite uuid, p_actor uuid, p_message boolean default true, p_new boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_st text; v_target int; v_stage text; v_camp uuid; v_identity uuid; v_addr uuid;
        s record; v_ship uuid; v_name text; v_member uuid; v_key text; v_why text := 'confirmed offline — bulk upload'; v_flow jsonb;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  v_st := coalesce(i.status, case when i.approved then 'approved' else 'registered' end);
  v_target := intel.ci_bulk_rank(v_st);
  select stage, campaign_id, identity_id into v_stage, v_camp, v_identity from intel.ci_campaign_participation where participation_id = p_part;
  if v_stage is null or v_stage in ('rejected','dropped','ineligible','brand_declined') then return v_stage; end if;
  -- already there (or further): nothing to do — except a creator who has just joined still gets their step message
  if intel.ci_stage_rank(v_stage) >= v_target and not p_new then return v_stage; end if;

  perform set_config('geek.bulk_quiet', 'on', true);
  begin
    -- 1–3) screening (before the brand's yes)
    if v_stage in ('invited','shortlisted') then
      perform intel.ci_participation_advance(p_part, 'applied', p_actor, v_why); v_stage := 'applied';
    end if;
    if v_target >= 2 and v_stage = 'applied' then perform intel.ci_participation_advance(p_part, 'eligible', p_actor, v_why); v_stage := 'eligible'; end if;
    if v_target >= 3 and v_stage = 'eligible' then perform intel.ci_participation_advance(p_part, 'sent_to_brand', p_actor, v_why); v_stage := 'sent_to_brand'; end if;
    -- 4–5) approved → the contract is issued
    if v_target >= 4 and v_stage = 'sent_to_brand' then perform intel.ci_participation_advance(p_part, 'brand_confirmed', p_actor, 'approved on the bulk upload'); end if;
    select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;
    if v_target >= 4 and v_stage in ('brand_confirmed','accepted') then perform intel.ci_issue_contract(p_part, p_actor); end if;
    select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;

    -- 6) contract signed (offline)
    if v_target >= 6 and v_stage = 'contract_sent' then
      update intel.ci_campaign_contract set signed_at = coalesce(signed_at, now()),
             signature_name = coalesce(signature_name, 'Confirmed offline (bulk upload)'), asci_ack = true, terms_ack = true, updated_at = now()
       where participation_id = p_part;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
        values (v_camp, p_part, 'contract', 'issued', 'signed', p_actor, v_why);
      perform intel.ci_participation_advance(p_part, 'contract_signed', p_actor, v_why);
      v_stage := 'contract_signed';
    end if;
    -- a campaign with nothing to ship has already moved on to the video brief (no address / courier steps)
    select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;

    -- 7) address confirmed (the sheet's / profile's address is the delivery address)
    if v_target >= 7 and v_stage = 'contract_signed' then
      select address_id into v_addr from private.creator_address
       where identity_id = v_identity and deleted_at is null order by is_default desc, created_at desc limit 1;
      if v_addr is not null then update intel.ci_campaign_participation set shipping_address_id = v_addr where participation_id = p_part; end if;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
        values (v_camp, p_part, 'address', null, 'confirmed', p_actor, v_why);
      perform intel.ci_participation_advance(p_part, 'address_confirmed', p_actor, v_why);
      v_stage := 'address_confirmed';
    end if;

    -- 8) courier sent
    if v_target >= 8 and v_stage in ('address_confirmed','accepted') then
      select * into s from intel.ci_campaign_shipment where participation_id = p_part order by created_at desc limit 1;
      if s.shipment_id is not null and s.status in ('pending','shipped') then
        update intel.ci_campaign_shipment set courier = coalesce(i.courier, courier, 'Courier'), tracking_ref = coalesce(i.tracking_ref, tracking_ref),
               tracking_url = coalesce(i.tracking_url, tracking_url), status = 'shipped', shipped_at = coalesce(shipped_at, now())
         where shipment_id = s.shipment_id;
      else
        insert into intel.ci_campaign_shipment(participation_id, product, courier, tracking_ref, tracking_url, shipped_at, status)
        values (p_part, coalesce((select product from intel.ci_campaign_contract where participation_id = p_part),
                                 (select product from intel.ci_campaign where campaign_id = v_camp)),
                coalesce(i.courier, 'Courier'), i.tracking_ref, i.tracking_url, now(), 'shipped');
      end if;
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
        values (v_camp, p_part, 'shipment', s.status, 'shipped', p_actor, v_why);
      perform intel.ci_participation_advance(p_part, 'product_sent', p_actor, 'courier sent — ' || coalesce(i.courier, 'courier') || coalesce(' ' || i.tracking_ref, ''));
      v_stage := 'product_sent';
    end if;

    -- 9–10) courier delivered → video brief sent (deliverables due in the campaign's days from today + reminders)
    if v_target >= 9 and v_stage = 'product_sent' then
      select shipment_id into v_ship from intel.ci_campaign_shipment where participation_id = p_part and status = 'shipped'
       order by created_at desc limit 1;
      if v_ship is not null then perform intel.ci_shipment_set_status(v_ship, 'delivered', p_actor, jsonb_build_object('note', v_why));
      else perform intel.ci_participation_advance(p_part, 'content_created', p_actor, v_why); end if;
      select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;
    end if;

    -- 11–14) video submitted → client approved → posted → done
    if v_target >= 11 and v_stage = 'content_created' then perform intel.ci_participation_advance(p_part, 'content_submitted', p_actor, v_why); v_stage := 'content_submitted'; end if;
    if v_target >= 12 and v_stage = 'content_submitted' then perform intel.ci_participation_advance(p_part, 'content_approved', p_actor, v_why); v_stage := 'content_approved'; end if;
    if v_target >= 13 and v_stage = 'content_approved' then perform intel.ci_participation_advance(p_part, 'published', p_actor, v_why); v_stage := 'published'; end if;
    if v_target >= 14 and v_stage = 'published' then perform intel.ci_participation_advance(p_part, 'completed', p_actor, v_why); v_stage := 'completed'; end if;
  exception when others then
    perform set_config('geek.bulk_quiet', 'off', true);
    raise;
  end;
  perform set_config('geek.bulk_quiet', 'off', true);

  -- ONE message for the step they are on now (skipped when the upload message already told them)
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;
  v_key := intel.ci_bulk_status_key(v_st);
  v_flow := intel.ci_campaign_flow(v_camp);
  -- paid campaign, no fee yet: the contract is waiting — the message goes when the fee is set
  if v_stage in ('brand_confirmed','accepted') and v_key in ('contract_sent','confirm_address','product_shipped','parcel_received','content_approved','completed') then
    v_key := null; end if;
  -- nothing to ship: the address / courier messages become "your video brief is ready"
  if not coalesce((v_flow->>'needs_product')::boolean, true) and v_key in ('confirm_address','product_shipped','parcel_received') then
    v_key := case when v_stage = 'content_created' then 'paid_brief_ready' end; end if;
  v_member := intel.ci_member_of_identity(v_identity);
  if p_message and v_key is not null and v_member is not null then
    select name into v_name from intel.ci_campaign where campaign_id = v_camp;
    perform intel.ci_notify(v_member, v_camp, p_part, v_key,
      jsonb_build_object('campaign', coalesce(v_name, 'your campaign'), 'participation_id', p_part::text,
        'days', coalesce((select k.content_days::text from intel.ci_campaign_contract k where k.participation_id = p_part), '7')));
  end if;
  return v_stage;
end $$;


-- ============================================================================================================
-- 6) messages for the payment steps (app + email; WhatsApp once matching templates are approved)
-- ============================================================================================================
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label, active) values
  ('paid_brief_ready', 'action_required', 'Your video brief for {{campaign}} is ready 🎬',
   'Contract signed ✓. There is no product to wait for on **{{campaign}}**, so you can start now: open the campaign, read the **video brief**, shoot your content and upload it for approval within **{{days}} days**.',
   'mycampaigns', 'Open video brief', true),
  ('payment_details_needed', 'action_required', 'Add your bank / UPI details for {{campaign}}',
   'Your fee for **{{campaign}}** is paid to the bank account or UPI ID you add in the app. Open the campaign and tap **Add payment details**. It must be in your own name, and we verify it before paying.',
   'mycampaigns', 'Add payment details', true),
  ('payment_details_fix', 'action_required', 'Please update your payment details for {{campaign}}',
   'We could not use the payment details for **{{campaign}}**: {{reason}}. Open the campaign and tap **Update payment details**.',
   'mycampaigns', 'Update details', true),
  ('payment_verified', 'info', 'Payment details verified for {{campaign}} ✓',
   'Your bank / UPI details for **{{campaign}}** are verified. Payments for this campaign go to this account, as set out in your contract.',
   'mycampaigns', 'View', true),
  ('payment_scheduled', 'info', 'Your payment for {{campaign}} is scheduled',
   'All your posts for **{{campaign}}** are live. Thank you! {{amount}} will be paid to your verified account by **{{date}}**.',
   'mycampaigns', 'View', true),
  ('payment_paid', 'info', 'Paid ✓ {{amount}} for {{campaign}}',
   'We have paid {{amount}} ({{part}}) for **{{campaign}}** to your {{method}}. Reference / UTR: {{ref}}. Open the campaign in the app to see every payment (and the payment screenshot, if added). Thank you for working with Geek!',
   'mycampaigns', 'View', true)
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md, action_route = excluded.action_route,
  action_label = excluded.action_label, active = true;

-- ============================================================================================================
-- 7) the creator: my payment details + status (only their OWN fee)
-- ============================================================================================================
create or replace function intel.ci_payment_public(p intel.ci_creator_payment, p_full boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.participation_id is null then null else jsonb_build_object(
    'amount', p.amount, 'advance_pct', p.advance_pct, 'due_days', p.due_days, 'terms_note', p.terms_note,
    'method', p.method, 'account_name', p.account_name, 'ifsc', p.ifsc, 'bank_name', p.bank_name, 'account_last4', p.account_last4,
    'upi_id', p.upi_id, 'details_source', p.details_source, 'details_status', p.details_status, 'details_submitted_at', p.details_submitted_at,
    'verify_mode', p.verify_mode, 'verify_name', p.verify_name, 'verify_message', p.verify_message, 'verified_at', p.verified_at,
    'request_reason', p.request_reason, 'requested_at', p.requested_at, 'on_hold', p.on_hold,
    'paid_total', (select coalesce(sum(o.amount), 0) from intel.ci_creator_payout o where o.participation_id = p.participation_id and o.status = 'paid'),
    'left', intel.ci_payment_left(p.participation_id),
    'hold_reason', case when p_full then p.hold_reason end,
    'fee_source', case when p_full then p.fee_source end, 'fee_set_at', case when p_full then p.fee_set_at end,
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('payout_id', o.payout_id, 'ref_code', o.ref_code, 'part', o.part, 'amount', o.amount,
        'status', o.status, 'due_at', o.due_at, 'provider', case when p_full then o.provider end, 'utr', o.utr,
        'failure_reason', case when p_full then o.failure_reason end, 'paid_at', o.paid_at, 'note', o.note, 'proof_path', o.proof_path)
        order by (o.status = 'paid') desc, o.paid_at nulls last, case o.part when 'advance' then 1 when 'full' then 2 else 3 end)
      from intel.ci_creator_payout o where o.participation_id = p.participation_id), '[]'::jsonb)) end $$;
revoke all on function intel.ci_payment_public(intel.ci_creator_payment, boolean) from public, anon, authenticated;

-- every campaign on my account: its type + (for paid ones) my payment
create or replace function api.my_campaign_flows()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  return coalesce((select jsonb_object_agg(p.participation_id::text,
           intel.ci_campaign_flow(p.campaign_id) || jsonb_build_object('payment', intel.ci_payment_public(cp, false)))
    from intel.ci_campaign_participation p
    left join intel.ci_creator_payment cp on cp.participation_id = p.participation_id
   where p.identity_id = v_id), '{}'::jsonb);
end $$;
revoke all on function api.my_campaign_flows() from public, anon;
grant execute on function api.my_campaign_flows() to authenticated;

create or replace function api.save_payment_details(p_participation uuid, p_method text, p_account_name text,
                                                    p_account_no text default null, p_ifsc text default null, p_upi text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id = p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your campaign' using errcode = '42501'; end if;
  perform intel.ci_ensure_payment(p_participation);
  perform intel.ci_payment_set_details(p_participation, p_method, p_account_name, p_account_no, p_ifsc, p_upi, 'creator', auth.uid());
  return intel.ci_payment_public((select x from intel.ci_creator_payment x where x.participation_id = p_participation), false);
end $$;
revoke all on function api.save_payment_details(uuid, text, text, text, text, text) from public, anon;
grant execute on function api.save_payment_details(uuid, text, text, text, text, text) to authenticated;

-- ============================================================================================================
-- 8) Super Admin only: every creator's payment on one campaign (fees are never shown to brands / agencies)
-- ============================================================================================================
create or replace function intel.ci_assert_super_admin(p_what text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'only a Super Admin can %', p_what using errcode = '42501'; end if;
end $$;
revoke all on function intel.ci_assert_super_admin(text) from public, anon, authenticated;

create or replace function api.campaign_payments(p_campaign uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_flow jsonb; r record;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  perform intel.ci_assert_super_admin('see creator payments');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found' using errcode = '22023'; end if;
  v_flow := intel.ci_campaign_flow(p_campaign);
  -- everyone approved or later has a payment row
  if coalesce((v_flow->>'paid')::boolean, false) then
    for r in select participation_id from intel.ci_campaign_participation
              where campaign_id = p_campaign and stage not in ('applied','eligible','sent_to_brand','shortlisted','invited','rejected','ineligible','brand_declined','dropped')
                and participation_id not in (select participation_id from intel.ci_creator_payment where campaign_id = p_campaign) loop
      perform intel.ci_ensure_payment(r.participation_id);
    end loop;
  end if;
  return v_flow || jsonb_build_object(
    'provider', coalesce((select jsonb_build_object('connected', s.keys_ok, 'account', s.account_last4, 'balance', s.balance, 'mode', s.mode,
                   'error', s.error, 'checked_at', s.checked_at) from private.ci_rzp_status s where s.id = 1), jsonb_build_object('connected', false)),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage, 'applied_profile', p.applied_profile,
        'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
        'name', (select m.name from public.members m where m.id = intel.ci_member_of_identity(p.identity_id)),
        'contract', (select jsonb_build_object('issued_at', k.issued_at, 'signed_at', k.signed_at) from intel.ci_campaign_contract k where k.participation_id = p.participation_id),
        'first_fee', (select jsonb_build_object('amount', cr.amount, 'campaign', c2.name, 'agreed_at', cr.agreed_at)
                        from intel.ci_creator_rate cr join intel.ci_campaign c2 on c2.campaign_id = cr.campaign_id
                       where cr.identity_id = p.identity_id and cr.participation_id <> p.participation_id order by cr.agreed_at limit 1),
        'payment', intel.ci_payment_public(cp, true)) order by lower(coalesce(nullif(p.applied_profile, ''), (select m.name from public.members m where m.id = intel.ci_member_of_identity(p.identity_id)), '')))
      from intel.ci_campaign_participation p
      join intel.ci_creator_payment cp on cp.participation_id = p.participation_id
     where p.campaign_id = p_campaign), '[]'::jsonb));
end $$;
revoke all on function api.campaign_payments(uuid) from public, anon;
grant execute on function api.campaign_payments(uuid) to authenticated;

create or replace function api.payment_set_terms(p_participation uuid, p_amount numeric, p_advance_pct int default null,
                                                 p_due_days int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  perform intel.ci_assert_super_admin('set a creator''s fee');
  return intel.ci_payment_set_terms(p_participation, p_amount, p_advance_pct, p_due_days, p_note, 'team', auth.uid());
end $$;
revoke all on function api.payment_set_terms(uuid, numeric, int, int, text) from public, anon;
grant execute on function api.payment_set_terms(uuid, numeric, int, int, text) to authenticated;

-- the Payments tab's own sheet: fees (+ details) for creators already on the campaign, matched on Instagram / phone / email
create or replace function api.payment_bulk_terms(p_campaign uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_p uuid; v_h text; v_ph text; v_em text; v_ok int := 0; v_miss int := 0; v_err jsonb := '[]'::jsonb; v_amt numeric;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  perform intel.ci_assert_super_admin('upload creator fees');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'at most 2000 rows at a time' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_h := intel.ci_norm_handle(x->>'handle'); v_ph := intel.ci_norm_phone(x->>'phone'); v_em := nullif(lower(btrim(coalesce(x->>'email',''))), '');
    v_p := null;
    select p.participation_id into v_p from intel.ci_campaign_participation p
     where p.campaign_id = p_campaign and (
       (v_h is not null and lower(coalesce(p.applied_profile, '')) = v_h)
       or exists (select 1 from intel.ci_campaign_invite i where i.participation_id = p.participation_id
                    and ((v_ph is not null and i.phone_e164 = v_ph) or (v_em is not null and lower(i.email) = v_em) or (v_h is not null and lower(i.handle) = v_h)))
       or (v_h is not null and exists (select 1 from public.social_accounts sa where sa.member_id = intel.ci_member_of_identity(p.identity_id)
                                         and sa.platform = 'instagram' and lower(sa.username) = v_h)))
     limit 1;
    if v_p is null then v_miss := v_miss + 1; v_err := v_err || jsonb_build_array(jsonb_build_object('row', x->>'i', 'error', 'not on this campaign')); continue; end if;
    begin
      v_amt := nullif(regexp_replace(coalesce(x->>'fee', ''), '[^0-9.]', '', 'g'), '')::numeric;
      perform intel.ci_ensure_payment(v_p);
      if v_amt is not null then
        perform intel.ci_payment_set_terms(v_p, v_amt, nullif(regexp_replace(coalesce(x->>'advance_pct', ''), '[^0-9]', '', 'g'), '')::int,
                                           nullif(regexp_replace(coalesce(x->>'pay_days', ''), '[^0-9]', '', 'g'), '')::int,
                                           nullif(btrim(coalesce(x->>'pay_terms', '')), ''), 'bulk', auth.uid());
      end if;
      if nullif(btrim(coalesce(x->>'upi', '')), '') is not null then
        perform intel.ci_payment_set_details(v_p, 'upi', coalesce(nullif(btrim(x->>'account_name'), ''), x->>'name'), null, null, x->>'upi', 'bulk', auth.uid());
      elsif nullif(btrim(coalesce(x->>'account_no', '')), '') is not null then
        perform intel.ci_payment_set_details(v_p, 'bank', coalesce(nullif(btrim(x->>'account_name'), ''), x->>'name'), x->>'account_no', x->>'ifsc', null, 'bulk', auth.uid());
      end if;
      v_ok := v_ok + 1;
    exception when others then
      v_err := v_err || jsonb_build_array(jsonb_build_object('row', x->>'i', 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'not_found', v_miss, 'errors', v_err);
end $$;
revoke all on function api.payment_bulk_terms(uuid, jsonb) from public, anon;
grant execute on function api.payment_bulk_terms(uuid, jsonb) to authenticated;

-- the creator bulk upload: its payment columns are held here, then applied as each creator joins / moves
create or replace function api.bulk_stage_payments(p_campaign uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_ph text; v_em text; v_h text; v_amt numeric; v_pct int; v_days int; v_no text; v_ifsc text; v_upi text; v_name text;
        v_method text; n int := 0; v_err jsonb := '[]'::jsonb; v_flow jsonb; v_p uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  v_flow := intel.ci_campaign_flow(p_campaign);
  if not coalesce((v_flow->>'paid')::boolean, false) then return jsonb_build_object('staged', 0, 'errors', '[]'::jsonb); end if;
  if not public.is_platform_admin() then
    if exists (select 1 from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) y where coalesce(y->>'fee','') <> '') then
      raise exception 'only a Super Admin can upload creator fees — remove the Fee column' using errcode = '42501'; end if;
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_amt := nullif(regexp_replace(coalesce(x->>'fee', ''), '[^0-9.]', '', 'g'), '')::numeric;
    v_pct := nullif(regexp_replace(coalesce(x->>'advance_pct', ''), '[^0-9]', '', 'g'), '')::int;
    v_days := nullif(regexp_replace(coalesce(x->>'pay_days', ''), '[^0-9]', '', 'g'), '')::int;
    v_upi := nullif(lower(btrim(coalesce(x->>'upi', ''))), '');
    v_no := nullif(regexp_replace(coalesce(x->>'account_no', ''), '[\s-]', '', 'g'), '');
    v_ifsc := nullif(upper(btrim(coalesce(x->>'ifsc', ''))), '');
    v_name := nullif(btrim(regexp_replace(coalesce(nullif(x->>'account_name', ''), x->>'name', ''), '\s+', ' ', 'g')), '');
    continue when v_amt is null and v_upi is null and v_no is null;
    continue when v_ph is null and v_em is null and v_h is null;
    -- check the values now, so a bad row is reported instead of silently skipped later
    if v_amt is not null and (v_amt <= 0 or v_amt > 100000000) then v_err := v_err || jsonb_build_array(jsonb_build_object('row', x->>'i', 'error', 'fee must be more than 0')); v_amt := null; end if;
    if v_pct is not null and v_pct > 100 then v_err := v_err || jsonb_build_array(jsonb_build_object('row', x->>'i', 'error', 'advance must be 0–100 %')); v_pct := null; end if;
    if v_days is not null and (v_days < 1 or v_days > 90) then v_days := null; end if;
    v_method := null;
    if v_upi is not null then
      if v_upi ~ '^[a-z0-9._-]{2,255}@[a-z][a-z0-9.-]{1,63}$' then v_method := 'upi';
      else v_err := v_err || jsonb_build_array(jsonb_build_object('row', x->>'i', 'error', 'UPI ID looks wrong')); end if;
    elsif v_no is not null then
      if v_no ~ '^[0-9]{9,18}$' and coalesce(v_ifsc, '') ~ '^[A-Z]{4}0[A-Z0-9]{6}$' then v_method := 'bank';
      else v_err := v_err || jsonb_build_array(jsonb_build_object('row', x->>'i', 'error', 'account number (9–18 digits) or IFSC looks wrong')); end if;
    end if;
    if v_method is not null and coalesce(length(v_name), 0) < 3 then v_err := v_err || jsonb_build_array(jsonb_build_object('row', x->>'i', 'error', 'account holder name missing')); v_method := null; end if;
    continue when v_amt is null and v_method is null;
    -- one pending row per person
    delete from private.ci_bulk_payment_stage where campaign_id = p_campaign and applied_at is null
       and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and email = v_em) or (v_h is not null and handle = v_h));
    insert into private.ci_bulk_payment_stage(campaign_id, phone_e164, email, handle, amount, advance_pct, due_days, terms_note,
        method, account_name, ifsc, account_last4, account_enc, upi_id, created_by)
    values (p_campaign, v_ph, v_em, v_h, v_amt, v_pct, v_days, nullif(btrim(coalesce(x->>'pay_terms', '')), ''),
        v_method, case when v_method is not null then v_name end, case when v_method = 'bank' then v_ifsc end,
        case when v_method = 'bank' then right(v_no, 4) end,
        case when v_method = 'bank' then extensions.pgp_sym_encrypt(v_no, private.payout_key()) end,
        case when v_method = 'upi' then v_upi end, auth.uid());
    n := n + 1;
    -- already on the campaign → apply now (a waiting contract goes out with the fee)
    select i.participation_id into v_p from intel.ci_campaign_invite i
     where i.campaign_id = p_campaign and i.participation_id is not null
       and ((v_ph is not null and i.phone_e164 = v_ph) or (v_em is not null and lower(i.email) = v_em) or (v_h is not null and lower(i.handle) = v_h)) limit 1;
    if v_p is not null then
      begin
        perform intel.ci_ensure_payment(v_p);   -- applies the staged row
        if v_amt is not null and (select stage from intel.ci_campaign_participation where participation_id = v_p) in ('brand_confirmed','accepted','contract_sent')
           and not exists (select 1 from intel.ci_campaign_contract where participation_id = v_p and signed_at is not null) then
          perform intel.ci_issue_contract(v_p, auth.uid());
        end if;
      exception when others then v_err := v_err || jsonb_build_array(jsonb_build_object('row', x->>'i', 'error', sqlerrm)); end;
    end if;
  end loop;
  return jsonb_build_object('staged', n, 'errors', v_err);
end $$;
revoke all on function api.bulk_stage_payments(uuid, jsonb) from public, anon;
grant execute on function api.bulk_stage_payments(uuid, jsonb) to authenticated;

-- Super Admin: ask the creator for new details (reason goes to them)
create or replace function api.payment_request_details(p_participation uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_identity uuid; v_name text;
begin
  perform intel.ci_assert_super_admin('ask for new payment details');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'tell the creator what is wrong' using errcode = '22023'; end if;
  if exists (select 1 from intel.ci_creator_payout where participation_id = p_participation and status in ('queued','processing')) then
    raise exception 'a payment is on its way to the current details — wait until it is done' using errcode = '22023'; end if;
  update intel.ci_creator_payment set details_status = 'needs_update', request_reason = btrim(p_reason), requested_at = now(),
         requested_by = auth.uid(), verified_at = null, verified_by = null, verify_ref = null
   where participation_id = p_participation returning campaign_id into v_camp;
  if v_camp is null then raise exception 'this creator has no fee on this campaign' using errcode = '22023'; end if;
  select identity_id into v_identity from intel.ci_campaign_participation where participation_id = p_participation;
  select name into v_name from intel.ci_campaign where campaign_id = v_camp;
  perform intel.ci_notify(intel.ci_member_of_identity(v_identity), v_camp, p_participation, 'payment_details_fix',
    jsonb_build_object('campaign', coalesce(v_name, 'your campaign'), 'reason', btrim(p_reason)));
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'payment', null, 'payment_details_requested', auth.uid(), btrim(p_reason));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function api.payment_request_details(uuid, text) from public, anon;
grant execute on function api.payment_request_details(uuid, text) to authenticated;

-- Super Admin: type / correct the details on the creator's behalf (e.g. they sent them on WhatsApp)
create or replace function api.payment_admin_details(p_participation uuid, p_method text, p_account_name text,
                                                     p_account_no text default null, p_ifsc text default null, p_upi text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_super_admin('edit payment details');
  perform intel.ci_ensure_payment(p_participation);
  perform intel.ci_payment_set_details(p_participation, p_method, p_account_name, p_account_no, p_ifsc, p_upi, 'team', auth.uid());
  return jsonb_build_object('ok', true);
end $$;
revoke all on function api.payment_admin_details(uuid, text, text, text, text, text) from public, anon;
grant execute on function api.payment_admin_details(uuid, text, text, text, text, text) to authenticated;

-- Super Admin: verify by hand, or run the automatic check again
create or replace function api.payment_verify(p_participation uuid, p_mode text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_identity uuid; v_name text;
begin
  perform intel.ci_assert_super_admin('verify payment details');
  if p_mode = 'auto' then
    update intel.ci_creator_payment set details_status = 'verifying', verify_attempts = 0, verify_message = null, verify_ref = null
     where participation_id = p_participation and method is not null returning campaign_id into v_camp;
    if v_camp is null then raise exception 'no details to check yet' using errcode = '22023'; end if;
    begin perform private.ci_kick_worker('razorpayx-worker'); exception when others then null; end;
    return jsonb_build_object('ok', true, 'mode', 'auto');
  end if;
  update intel.ci_creator_payment set details_status = 'verified', verify_mode = 'manual', verified_at = now(), verified_by = auth.uid(),
         verify_message = coalesce(nullif(btrim(p_note), ''), 'checked by the Geek team'), verify_ref = null
   where participation_id = p_participation and method is not null returning campaign_id into v_camp;
  if v_camp is null then raise exception 'no payment details yet' using errcode = '22023'; end if;
  select identity_id into v_identity from intel.ci_campaign_participation where participation_id = p_participation;
  select name into v_name from intel.ci_campaign where campaign_id = v_camp;
  perform intel.ci_notify(intel.ci_member_of_identity(v_identity), v_camp, p_participation, 'payment_verified',
    jsonb_build_object('campaign', coalesce(v_name, 'your campaign')));
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'payment', null, 'payment_details_verified', auth.uid(), coalesce(p_note, 'manual check'));
  return jsonb_build_object('ok', true, 'mode', 'manual');
end $$;
revoke all on function api.payment_verify(uuid, text, text) from public, anon;
grant execute on function api.payment_verify(uuid, text, text) to authenticated;

-- Super Admin: the full account number (every look is logged)
create or replace function api.payment_reveal(p_participation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v intel.ci_creator_payment%rowtype;
begin
  perform intel.ci_assert_super_admin('see full bank details');
  select * into v from intel.ci_creator_payment where participation_id = p_participation;
  if v.participation_id is null or v.method is null then raise exception 'no payment details yet' using errcode = '22023'; end if;
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', 'payment_details_viewed', jsonb_build_object('participation_id', p_participation, 'method', v.method));
  return jsonb_build_object('method', v.method, 'account_name', v.account_name, 'ifsc', v.ifsc, 'upi_id', v.upi_id,
    'account_no', case when v.account_enc is not null then extensions.pgp_sym_decrypt(v.account_enc, private.payout_key()) end);
end $$;
revoke all on function api.payment_reveal(uuid) from public, anon;
grant execute on function api.payment_reveal(uuid) to authenticated;

-- Super Admin: hold / release every payment of one creator (e.g. a post was taken down)
create or replace function api.payment_hold(p_participation uuid, p_hold boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid;
begin
  perform intel.ci_assert_super_admin('hold a payment');
  if p_hold and coalesce(btrim(p_reason), '') = '' then raise exception 'say why it is on hold' using errcode = '22023'; end if;
  update intel.ci_creator_payment set on_hold = p_hold, hold_reason = case when p_hold then btrim(p_reason) end
   where participation_id = p_participation returning campaign_id into v_camp;
  if v_camp is null then raise exception 'this creator has no fee on this campaign' using errcode = '22023'; end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'payment', null, case when p_hold then 'payment_on_hold' else 'payment_released' end, auth.uid(), p_reason);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function api.payment_hold(uuid, boolean, text) from public, anon;
grant execute on function api.payment_hold(uuid, boolean, text) to authenticated;

-- one installment is paid → recorded + the creator is told
create or replace function intel.ci_payout_paid(p_payout uuid, p_utr text, p_provider text, p_paid_on date, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare o intel.ci_creator_payout%rowtype; v intel.ci_creator_payment%rowtype; v_identity uuid; v_name text;
begin
  update intel.ci_creator_payout set status = 'paid', utr = coalesce(nullif(btrim(p_utr), ''), utr), provider = coalesce(p_provider, provider),
         paid_at = coalesce(p_paid_on::timestamptz, now()), paid_by = p_actor, failure_reason = null,
         note = coalesce(nullif(btrim(p_note), ''), note)
   where payout_id = p_payout and status <> 'paid' returning * into o;
  if o.payout_id is null then return; end if;
  select * into v from intel.ci_creator_payment where participation_id = o.participation_id;
  select identity_id into v_identity from intel.ci_campaign_participation where participation_id = o.participation_id;
  select name into v_name from intel.ci_campaign where campaign_id = o.campaign_id;
  perform intel.ci_notify(intel.ci_member_of_identity(v_identity), o.campaign_id, o.participation_id, 'payment_paid',
    jsonb_build_object('campaign', coalesce(v_name, 'your campaign'), 'amount', intel.ci_inr(o.amount),
                       'part', case when o.note = 'part payment' then 'part payment' when o.part = 'advance' then 'advance' when o.part = 'balance' then 'balance' else 'full fee' end,
                       'method', case when v.method = 'upi' then 'UPI ID ' || v.upi_id else 'bank account ending ' || coalesce(v.account_last4, '') end,
                       'ref', coalesce(o.utr, o.ref_code)));
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (o.campaign_id, o.participation_id, 'payment', o.part, 'payment_paid', p_actor,
            intel.ci_inr(o.amount) || ' · ' || coalesce(o.provider, 'manual') || coalesce(' · UTR ' || o.utr, ''));
end $$;
revoke all on function intel.ci_payout_paid(uuid, text, text, date, uuid, text) from public, anon, authenticated;

-- Super Admin: a transfer made outside the app (bank / UPI app) — UTR required
create or replace function api.payout_mark_paid(p_payout uuid, p_utr text, p_paid_on date default null, p_note text default null,
                                                p_proof_path text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o intel.ci_creator_payout%rowtype;
begin
  perform intel.ci_assert_super_admin('mark a payment as paid');
  if coalesce(btrim(p_utr), '') = '' and coalesce(btrim(p_proof_path), '') = '' then
    raise exception 'add the UTR / transaction reference or a screenshot of the payment' using errcode = '22023'; end if;
  select * into o from intel.ci_creator_payout where payout_id = p_payout;
  if o.payout_id is null then raise exception 'payment not found' using errcode = '22023'; end if;
  if o.status = 'paid' then raise exception 'already paid' using errcode = '22023'; end if;
  if o.status = 'queued' or (o.status = 'processing' and o.provider = 'razorpayx') then
    raise exception 'this payment is being sent by Razorpay — wait for it' using errcode = '22023'; end if;
  if nullif(btrim(p_proof_path), '') is not null then
    update intel.ci_creator_payout set proof_path = btrim(p_proof_path) where payout_id = p_payout; end if;
  perform intel.ci_payout_paid(p_payout, p_utr, 'manual', p_paid_on, auth.uid(), p_note);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function api.payout_mark_paid(uuid, text, date, text, text) from public, anon;
grant execute on function api.payout_mark_paid(uuid, text, date, text, text) to authenticated;

-- Super Admin: pay ANY amount now (part payment, the rest stays due): through Razorpay, or record a manual transfer
--   p_how: razorpay | manual (manual needs the UTR or a screenshot)
create or replace function api.payout_pay(p_participation uuid, p_amount numeric, p_how text, p_utr text default null,
                                          p_paid_on date default null, p_note text default null, p_proof_path text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v intel.ci_creator_payment%rowtype; v_left numeric; v_locked numeric; v_adv_t numeric; v_part text; v_id uuid; v_amt numeric := round(coalesce(p_amount, 0));
begin
  perform intel.ci_assert_super_admin('pay a creator');
  select * into v from intel.ci_creator_payment where participation_id = p_participation for update;
  if v.participation_id is null or v.amount is null then raise exception 'set this creator''s fee first' using errcode = '22023'; end if;
  v_left := intel.ci_payment_left(p_participation);
  if v_amt <= 0 then raise exception 'enter the amount to pay' using errcode = '22023'; end if;
  if v_amt > v_left then raise exception 'only % is left to pay — raise the fee first if you agreed more', intel.ci_inr(v_left) using errcode = '22023'; end if;
  if p_how = 'razorpay' then
    if v.on_hold then raise exception 'this creator''s payments are on hold' using errcode = '22023'; end if;
    if v.details_status <> 'verified' then raise exception 'verify the bank / UPI details first' using errcode = '22023'; end if;
    if not coalesce((select keys_ok from private.ci_rzp_status where id = 1), false) then
      raise exception 'Razorpay isn''t connected yet — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or pay manually and upload the screenshot' using errcode = '22023'; end if;
  elsif p_how = 'manual' then
    if coalesce(btrim(p_utr), '') = '' and coalesce(btrim(p_proof_path), '') = '' then
      raise exception 'add the UTR / transaction reference or a screenshot of the payment' using errcode = '22023'; end if;
  else raise exception 'choose Razorpay or manual' using errcode = '22023'; end if;
  -- which part this covers: the advance first, then the balance
  select coalesce(sum(amount), 0) into v_locked from intel.ci_creator_payout where participation_id = p_participation and status in ('queued','processing','paid');
  v_adv_t := round(v.amount * v.advance_pct / 100.0);
  v_part := case when v_locked = 0 and v_amt = v.amount then 'full' when v_locked < v_adv_t then 'advance' else 'balance' end;
  insert into intel.ci_creator_payout(participation_id, campaign_id, part, amount, status, due_at, provider, queued_by, queued_at, attempts, note, proof_path)
  values (p_participation, v.campaign_id, v_part, v_amt, case when p_how = 'razorpay' then 'queued' else 'waiting' end, current_date,
          case when p_how = 'razorpay' then 'razorpayx' else 'manual' end, auth.uid(), now(), 1,
          coalesce(nullif(btrim(p_note), ''), case when v_amt < v_left then 'part payment' end), nullif(btrim(p_proof_path), ''))
  returning payout_id into v_id;
  if p_how = 'manual' then perform intel.ci_payout_paid(v_id, p_utr, 'manual', p_paid_on, auth.uid(), p_note); end if;
  perform intel.ci_payment_build_payouts(p_participation);        -- what is left is re-planned
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', 'payout_' || p_how, jsonb_build_object('participation_id', p_participation, 'amount', v_amt));
  if p_how = 'razorpay' then begin perform private.ci_kick_worker('razorpayx-worker'); exception when others then null; end; end if;
  return jsonb_build_object('ok', true, 'payout_id', v_id, 'amount', v_amt, 'left', intel.ci_payment_left(p_participation));
end $$;
revoke all on function api.payout_pay(uuid, numeric, text, text, date, text, text) from public, anon;
grant execute on function api.payout_pay(uuid, numeric, text, text, date, text, text) to authenticated;

-- Super Admin: attach / replace the screenshot of a payment (also for one paid through Razorpay)
create or replace function api.payout_set_proof(p_payout uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_super_admin('add a payment screenshot');
  if coalesce(btrim(p_path), '') = '' then raise exception 'upload the screenshot first' using errcode = '22023'; end if;
  update intel.ci_creator_payout set proof_path = btrim(p_path) where payout_id = p_payout;
  if not found then raise exception 'payment not found' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function api.payout_set_proof(uuid, text) from public, anon;
grant execute on function api.payout_set_proof(uuid, text) to authenticated;

-- payment screenshots: a private bucket — Super Admins upload, the creator can open their own
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/png','image/jpeg','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;
create or replace function public.ci_can_read_payment_proof(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (select 1 from intel.ci_creator_payout o
           join intel.ci_campaign_participation p on p.participation_id = o.participation_id
          where o.proof_path = p_name and intel.ci_member_of_identity(p.identity_id) = auth.uid()) $$;
revoke all on function public.ci_can_read_payment_proof(text) from public, anon;
grant execute on function public.ci_can_read_payment_proof(text) to authenticated;
drop policy if exists "payment proofs: read" on storage.objects;
create policy "payment proofs: read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.ci_can_read_payment_proof(name));
drop policy if exists "payment proofs: super admin uploads" on storage.objects;
create policy "payment proofs: super admin uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and public.is_platform_admin());
drop policy if exists "payment proofs: super admin changes" on storage.objects;
create policy "payment proofs: super admin changes" on storage.objects for update to authenticated
  using (bucket_id = 'payment-proofs' and public.is_platform_admin());

-- which of these can be paid now? (due · details verified · not on hold · amount > 0)
create or replace function intel.ci_payout_ready(p_payout uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when o.payout_id is null then 'not found'
              when o.status not in ('due','failed') then 'not due (' || o.status || ')'
              when p.on_hold then 'on hold'
              when p.details_status <> 'verified' then 'payment details not verified'
              when o.amount <= 0 then 'amount is 0' end
    from intel.ci_creator_payout o join intel.ci_creator_payment p on p.participation_id = o.participation_id
   where o.payout_id = p_payout $$;
revoke all on function intel.ci_payout_ready(uuid) from public, anon, authenticated;

-- Super Admin: send these through RazorpayX (the worker does it; the result comes back with the UTR)
create table if not exists private.ci_rzp_status (
  id int primary key default 1 check (id = 1),
  keys_ok boolean not null default false, account_last4 text, balance numeric, mode text, error text,
  checked_at timestamptz not null default now()
);
alter table private.ci_rzp_status enable row level security;
revoke all on private.ci_rzp_status from public, anon, authenticated;

create or replace function api.ops_rzp_report(p_keys boolean, p_account_last4 text, p_balance numeric, p_mode text, p_error text)
returns void language sql security definer set search_path = '' as $$
  insert into private.ci_rzp_status(id, keys_ok, account_last4, balance, mode, error, checked_at)
  values (1, coalesce(p_keys, false), p_account_last4, p_balance, p_mode, nullif(btrim(coalesce(p_error, '')), ''), now())
  on conflict (id) do update set keys_ok = excluded.keys_ok, account_last4 = excluded.account_last4, balance = excluded.balance,
    mode = excluded.mode, error = excluded.error, checked_at = now() $$;
revoke all on function api.ops_rzp_report(boolean, text, numeric, text, text) from public, anon, authenticated;
grant execute on function api.ops_rzp_report(boolean, text, numeric, text, text) to service_role;

-- Super Admin: re-check the Razorpay connection now (the worker reports in a few seconds)
create or replace function api.payments_ping()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_super_admin('check Razorpay');
  begin perform private.ci_kick_worker('razorpayx-worker'); exception when others then null; end;
  return coalesce((select to_jsonb(s) - 'id' from private.ci_rzp_status s where id = 1), '{}'::jsonb);
end $$;
revoke all on function api.payments_ping() from public, anon;
grant execute on function api.payments_ping() to authenticated;

create or replace function api.payout_queue(p_payouts uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v uuid; v_why text; v_ok int := 0; v_total numeric := 0; v_err jsonb := '[]'::jsonb;
begin
  perform intel.ci_assert_super_admin('send payments');
  if not coalesce((select keys_ok from private.ci_rzp_status where id = 1), false) then
    raise exception 'Razorpay isn''t connected yet — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (Supabase secrets), or pay manually / with the bulk file' using errcode = '22023'; end if;
  if coalesce(cardinality(p_payouts), 0) = 0 or cardinality(p_payouts) > 500 then raise exception 'pick 1 to 500 payments' using errcode = '22023'; end if;
  foreach v in array p_payouts loop
    v_why := intel.ci_payout_ready(v);
    if v_why is not null then v_err := v_err || jsonb_build_array(jsonb_build_object('payout_id', v, 'error', v_why)); continue; end if;
    update intel.ci_creator_payout set status = 'queued', provider = 'razorpayx', provider_ref = null, attempts = attempts + 1,
           queued_by = auth.uid(), queued_at = now(), failure_reason = null
     where payout_id = v;
    v_ok := v_ok + 1; v_total := v_total + (select amount from intel.ci_creator_payout where payout_id = v);
  end loop;
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', 'payouts_queued', jsonb_build_object('count', v_ok, 'total', v_total));
  if v_ok > 0 then begin perform private.ci_kick_worker('razorpayx-worker'); exception when others then null; end; end if;
  return jsonb_build_object('queued', v_ok, 'total', v_total, 'errors', v_err);
end $$;
revoke all on function api.payout_queue(uuid[]) from public, anon;
grant execute on function api.payout_queue(uuid[]) to authenticated;

-- Super Admin: the rows for a RazorpayX dashboard bulk-payout file (full details — logged). Marks them "processing".
create or replace function api.payout_export(p_payouts uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v uuid; v_why text; v_rows jsonb := '[]'::jsonb; v_err jsonb := '[]'::jsonb; o record;
begin
  perform intel.ci_assert_super_admin('export payments');
  if coalesce(cardinality(p_payouts), 0) = 0 or cardinality(p_payouts) > 2000 then raise exception 'pick 1 to 2000 payments' using errcode = '22023'; end if;
  foreach v in array p_payouts loop
    v_why := intel.ci_payout_ready(v);
    if v_why is not null then v_err := v_err || jsonb_build_array(jsonb_build_object('payout_id', v, 'error', v_why)); continue; end if;
    select po.payout_id, po.ref_code, po.amount, po.part, p.method, p.account_name, p.ifsc, p.upi_id,
           case when p.account_enc is not null then extensions.pgp_sym_decrypt(p.account_enc, private.payout_key()) end account_no,
           c.name campaign, pa.applied_profile handle,
           intel.ci_member_phone(intel.ci_member_of_identity(pa.identity_id)) phone
      into o
      from intel.ci_creator_payout po join intel.ci_creator_payment p on p.participation_id = po.participation_id
      join intel.ci_campaign_participation pa on pa.participation_id = po.participation_id
      join intel.ci_campaign c on c.campaign_id = po.campaign_id
     where po.payout_id = v;
    v_rows := v_rows || jsonb_build_array(to_jsonb(o));
    update intel.ci_creator_payout set status = 'processing', provider = 'razorpayx_bulk', queued_by = auth.uid(), queued_at = now(),
           attempts = attempts + 1, failure_reason = null where payout_id = v;
  end loop;
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', 'payouts_exported', jsonb_build_object('count', jsonb_array_length(v_rows)));
  return jsonb_build_object('rows', v_rows, 'errors', v_err);
end $$;
revoke all on function api.payout_export(uuid[]) from public, anon;
grant execute on function api.payout_export(uuid[]) to authenticated;

-- Super Admin: the RazorpayX batch report back → paid (with UTR) / failed. Rows: {ref, utr, status, reason}
create or replace function api.payout_import_results(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; o intel.ci_creator_payout%rowtype; v_paid int := 0; v_failed int := 0; v_miss int := 0; v_st text;
begin
  perform intel.ci_assert_super_admin('import payment results');
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into o from intel.ci_creator_payout where ref_code = upper(btrim(coalesce(x->>'ref', '')));
    if o.payout_id is null then v_miss := v_miss + 1; continue; end if;
    continue when o.status = 'paid';
    v_st := lower(coalesce(x->>'status', ''));
    if v_st ~ '(processed|success|paid|completed)' or (v_st = '' and coalesce(btrim(x->>'utr'), '') <> '') then
      perform intel.ci_payout_paid(o.payout_id, x->>'utr', coalesce(o.provider, 'razorpayx_bulk'), null, auth.uid(), null); v_paid := v_paid + 1;
    elsif v_st ~ '(fail|reject|revers|cancel)' then
      update intel.ci_creator_payout set status = 'failed', failure_reason = coalesce(nullif(btrim(x->>'reason'), ''), v_st) where payout_id = o.payout_id;
      v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('paid', v_paid, 'failed', v_failed, 'not_found', v_miss);
end $$;
revoke all on function api.payout_import_results(jsonb) from public, anon;
grant execute on function api.payout_import_results(jsonb) to authenticated;

-- Super Admin: a creator's agreed fees (their profile) — the first one, the latest, all of them
create or replace function api.creator_rates(p_member uuid default null, p_participation uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_super_admin('see creator fees');
  v_identity := coalesce((select identity_id from intel.ci_campaign_participation where participation_id = p_participation),
                         intel.ci_member_identity(p_member));
  if v_identity is null then return jsonb_build_object('list', '[]'::jsonb); end if;
  return jsonb_build_object('list', coalesce((select jsonb_agg(jsonb_build_object('amount', r.amount, 'advance_pct', r.advance_pct,
      'deliverables', r.deliverables, 'kind', r.kind, 'story', r.story, 'agreed_at', r.agreed_at, 'campaign', c.name,
      'paid', (select coalesce(sum(o.amount), 0) from intel.ci_creator_payout o where o.participation_id = r.participation_id and o.status = 'paid'))
      order by r.agreed_at)
    from intel.ci_creator_rate r join intel.ci_campaign c on c.campaign_id = r.campaign_id where r.identity_id = v_identity), '[]'::jsonb));
end $$;
revoke all on function api.creator_rates(uuid, uuid) from public, anon;
grant execute on function api.creator_rates(uuid, uuid) to authenticated;

-- Super Admin: an exported (bulk-file) payment that was NOT uploaded on RazorpayX goes back to "due"
create or replace function api.payout_reset(p_payout uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_super_admin('reset a payment');
  update intel.ci_creator_payout set status = 'due', provider = null, failure_reason = null
   where payout_id = p_payout and ((status = 'processing' and provider = 'razorpayx_bulk') or status = 'failed');
  if not found then raise exception 'only an exported (bulk file) or failed payment can be reset' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function api.payout_reset(uuid) from public, anon;
grant execute on function api.payout_reset(uuid) to authenticated;

-- ============================================================================================================
-- 9) the RazorpayX worker (razorpayx-worker edge function, service role only)
--    a) account validation of new details  b) payouts a Super Admin queued  c) status of anything in progress
-- ============================================================================================================
create or replace function api.ops_rzp_work(p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  return jsonb_build_object(
    'validate', coalesce((select jsonb_agg(jsonb_build_object('participation_id', x.participation_id, 'method', x.method,
            'account_name', x.account_name, 'ifsc', x.ifsc, 'upi_id', x.upi_id,
            'account_no', case when x.account_enc is not null then extensions.pgp_sym_decrypt(x.account_enc, private.payout_key()) end,
            'phone', intel.ci_member_phone(intel.ci_member_of_identity(p.identity_id))))
        from (select * from intel.ci_creator_payment where details_status = 'verifying' and verify_ref is null and verify_attempts < 5
               order by details_submitted_at nulls last limit v_lim) x
        join intel.ci_campaign_participation p on p.participation_id = x.participation_id), '[]'::jsonb),
    'validate_poll', coalesce((select jsonb_agg(jsonb_build_object('participation_id', x.participation_id, 'ref', x.verify_ref))
        from (select * from intel.ci_creator_payment where details_status = 'verifying' and verify_ref is not null limit v_lim) x), '[]'::jsonb),
    'pay', coalesce((select jsonb_agg(jsonb_build_object('payout_id', o.payout_id, 'ref_code', o.ref_code, 'attempts', o.attempts,
            'amount', o.amount, 'part', o.part, 'method', x.method, 'account_name', x.account_name, 'ifsc', x.ifsc, 'upi_id', x.upi_id,
            'account_no', case when x.account_enc is not null then extensions.pgp_sym_decrypt(x.account_enc, private.payout_key()) end,
            'phone', intel.ci_member_phone(intel.ci_member_of_identity(p.identity_id)), 'campaign', c.name))
        from (select * from intel.ci_creator_payout where status = 'queued' and provider = 'razorpayx' and provider_ref is null
               order by queued_at limit v_lim) o
        join intel.ci_creator_payment x on x.participation_id = o.participation_id and x.details_status = 'verified' and not x.on_hold
        join intel.ci_campaign_participation p on p.participation_id = o.participation_id
        join intel.ci_campaign c on c.campaign_id = o.campaign_id), '[]'::jsonb),
    'pay_poll', coalesce((select jsonb_agg(jsonb_build_object('payout_id', o.payout_id, 'ref', o.provider_ref))
        from (select * from intel.ci_creator_payout where status = 'processing' and provider = 'razorpayx' and provider_ref is not null limit v_lim) o), '[]'::jsonb));
end $$;
revoke all on function api.ops_rzp_work(int) from public, anon, authenticated;
grant execute on function api.ops_rzp_work(int) to service_role;

-- validation started (RazorpayX id) — the next run reads the result
create or replace function api.ops_rzp_validation_started(p_participation uuid, p_ref text)
returns void language sql security definer set search_path = '' as $$
  update intel.ci_creator_payment set verify_ref = p_ref, verify_attempts = verify_attempts + 1
   where participation_id = p_participation and details_status = 'verifying' $$;
revoke all on function api.ops_rzp_validation_started(uuid, text) from public, anon, authenticated;
grant execute on function api.ops_rzp_validation_started(uuid, text) to service_role;

-- p_result: valid | invalid | unavailable (no keys / name mismatch / provider error → a Super Admin checks by hand)
create or replace function api.ops_rzp_validation_result(p_participation uuid, p_result text, p_name_at_bank text default null,
                                                         p_bank_name text default null, p_message text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_identity uuid; v_name text;
begin
  if p_result = 'valid' then
    update intel.ci_creator_payment set details_status = 'verified', verify_mode = 'auto', verified_at = now(), verify_ref = null,
           verify_name = nullif(btrim(p_name_at_bank), ''), bank_name = coalesce(nullif(btrim(p_bank_name), ''), bank_name),
           verify_message = nullif(btrim(p_message), '')
     where participation_id = p_participation and details_status = 'verifying' returning campaign_id into v_camp;
    if v_camp is not null then
      select identity_id into v_identity from intel.ci_campaign_participation where participation_id = p_participation;
      select name into v_name from intel.ci_campaign where campaign_id = v_camp;
      perform intel.ci_notify(intel.ci_member_of_identity(v_identity), v_camp, p_participation, 'payment_verified',
        jsonb_build_object('campaign', coalesce(v_name, 'your campaign')));
      insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
        values (v_camp, p_participation, 'payment', 'verifying', 'payment_details_verified', null, 'automatic check');
    end if;
  elsif p_result = 'invalid' then
    update intel.ci_creator_payment set details_status = 'failed', verify_mode = 'auto', verify_ref = null,
           verify_name = nullif(btrim(p_name_at_bank), ''), verify_message = coalesce(nullif(btrim(p_message), ''), 'the bank could not verify these details')
     where participation_id = p_participation and details_status = 'verifying' returning campaign_id into v_camp;
    if v_camp is not null then
      select identity_id into v_identity from intel.ci_campaign_participation where participation_id = p_participation;
      select name into v_name from intel.ci_campaign where campaign_id = v_camp;
      perform intel.ci_notify(intel.ci_member_of_identity(v_identity), v_camp, p_participation, 'payment_details_fix',
        jsonb_build_object('campaign', coalesce(v_name, 'your campaign'), 'reason', coalesce(nullif(btrim(p_message), ''), 'the bank could not verify these details')));
    end if;
  else
    update intel.ci_creator_payment set details_status = 'submitted', verify_ref = null,
           verify_name = coalesce(nullif(btrim(p_name_at_bank), ''), verify_name),
           verify_message = coalesce(nullif(btrim(p_message), ''), 'automatic check not set up — verify by hand')
     where participation_id = p_participation and details_status = 'verifying';
  end if;
end $$;
revoke all on function api.ops_rzp_validation_result(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function api.ops_rzp_validation_result(uuid, text, text, text, text) to service_role;

-- a payout's state from RazorpayX: processing (with its id) · paid (UTR) · failed (reason)
create or replace function api.ops_rzp_payout_update(p_payout uuid, p_status text, p_ref text default null, p_utr text default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status = 'paid' then
    update intel.ci_creator_payout set provider_ref = coalesce(p_ref, provider_ref) where payout_id = p_payout;
    perform intel.ci_payout_paid(p_payout, p_utr, 'razorpayx', null, null, null);
  elsif p_status = 'failed' then
    update intel.ci_creator_payout set status = 'failed', provider_ref = coalesce(p_ref, provider_ref),
           failure_reason = coalesce(nullif(btrim(p_reason), ''), 'RazorpayX could not make this payment')
     where payout_id = p_payout and status in ('queued','processing');
    if found then
      perform intel.ci_alert_admins('⚠️ A creator payment failed', coalesce(nullif(btrim(p_reason), ''), 'RazorpayX could not make the payment')
        || '. Open the campaign → 💰 Payments to retry or pay by hand.', 'campaigns', 'Open', 'action_required', null);
    end if;
  else
    update intel.ci_creator_payout set status = 'processing', provider_ref = coalesce(p_ref, provider_ref)
     where payout_id = p_payout and status in ('queued','processing');
  end if;
end $$;
revoke all on function api.ops_rzp_payout_update(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function api.ops_rzp_payout_update(uuid, text, text, text, text) to service_role;

-- ============================================================================================================
-- 10) every morning (9:00 IST): Super Admins hear about payments that are due; the worker runs every 15 min when needed
-- ============================================================================================================
create or replace function intel.ci_payment_due_alerts()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select c.campaign_id, c.name, count(*) cnt, sum(o.amount) total,
                  count(*) filter (where p.details_status <> 'verified') unverified
             from intel.ci_creator_payout o join intel.ci_creator_payment p on p.participation_id = o.participation_id
             join intel.ci_campaign c on c.campaign_id = o.campaign_id
            where o.status in ('due','failed') and coalesce(o.due_at, current_date) <= current_date and not p.on_hold
            group by c.campaign_id, c.name loop
    perform intel.ci_alert_admins('💰 Creator payments due: ' || coalesce(r.name, 'campaign'),
      r.cnt || ' payment' || case when r.cnt > 1 then 's are' else ' is' end || ' due (' || intel.ci_inr(r.total) || ')'
        || case when r.unverified > 0 then ', ' || r.unverified || ' without verified bank / UPI details' else '' end
        || '. Open the campaign → 💰 Payments.', 'campaigns', 'Open', 'action_required', null);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function intel.ci_payment_due_alerts() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('ci-payment-due', 'ci-razorpayx-worker', 'ci-razorpayx');
    perform cron.schedule('ci-payment-due', '30 3 * * *', $c$select intel.ci_payment_due_alerts()$c$);
    perform cron.schedule('ci-razorpayx', '*/15 * * * *',
      $c$select private.ci_kick_worker('razorpayx-worker') where exists (select 1 from intel.ci_creator_payment where details_status = 'verifying' and verify_attempts < 5)
          or exists (select 1 from intel.ci_creator_payout where status in ('queued','processing') and provider = 'razorpayx')$c$);
  end if;
exception when others then raise warning 'payment crons not scheduled: %', sqlerrm; end $$;

revoke all on function intel.ci_inr(numeric) from public, anon;
