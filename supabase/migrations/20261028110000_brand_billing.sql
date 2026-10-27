-- 💳 Brand billing + full campaign requests. ADDITIVE.
-- * Campaign requests carry the whole campaign form (the same one the Super Admin fills in): request.form = the
--   campaign row. The Super Admin turns a request into a campaign in one tap (the form opens pre-filled).
-- * Billing: the Super Admin raises a payment request (bill) for a brand — per campaign or general — from Brand CRM.
--   The brand sees it under 💳 Billing, pays online through Razorpay (Payment Link → auto-marked paid when Razorpay
--   says so), or the Super Admin marks it paid by hand (bank transfer / UPI / cheque + reference). Both sides keep the
--   full bill history and download every bill / receipt.

-- ------------------------------------------------------------------ requests: the full form
alter table intel.ci_brand_campaign_request add column if not exists form jsonb;
alter table intel.ci_brand_campaign_request add column if not exists campaign_id uuid references intel.ci_campaign(campaign_id) on delete set null;

create or replace function api.brand_campaign_request(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[] := intel.ci_portal_brands(null); v_brand uuid; v_id uuid; v_bname text; f jsonb := p->'form';
        v_name text := nullif(btrim(coalesce(p->>'name', f->>'name', '')), '');
begin
  if coalesce(intel.ci_brand_role(), '') in ('viewer','removed') then raise exception 'This login can only view — ask your team''s admin to send the request.' using errcode = '42501'; end if;
  v_brand := coalesce(nullif(p->>'brand_id','')::uuid, v_ids[1]);
  if v_brand is null or not (v_brand = any(v_ids)) then raise exception 'not your brand' using errcode = '42501'; end if;
  if v_name is null then raise exception 'Give the campaign a name.' using errcode = '22023'; end if;
  insert into intel.ci_brand_campaign_request(brand_id, requested_by, name, product, campaign_type, creators_needed, cities, starts_on, ends_on, budget, deliverables, brief, form)
  values (v_brand, auth.uid(), left(v_name, 160),
          left(nullif(btrim(coalesce(p->>'product', f->'contract_terms'->>'product', '')), ''), 200),
          case when coalesce(p->>'campaign_type', f->>'campaign_type') in ('barter','paid','barter_paid') then coalesce(p->>'campaign_type', f->>'campaign_type') end,
          nullif(regexp_replace(coalesce(p->>'creators_needed', f->>'creators', ''), '[^0-9]', '', 'g'), '')::int,
          left(nullif(btrim(coalesce(p->>'cities', (select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(f->'ideal_profile'->'locations') = 'array' then f->'ideal_profile'->'locations' else '[]'::jsonb end) x), '')), ''), 300),
          nullif(coalesce(p->>'starts_on', f->>'start_date'), '')::date, nullif(coalesce(p->>'ends_on', f->>'end_date'), '')::date,
          left(nullif(btrim(coalesce(p->>'budget', f->>'budget', case when f->>'product_value' is not null then 'Product worth ₹' || (f->>'product_value') end, '')), ''), 120),
          left(nullif(btrim(coalesce(p->>'deliverables', f->>'deliverables', '')), ''), 400),
          left(nullif(btrim(coalesce(p->>'brief', f->>'brief', '')), ''), 6000),
          case when jsonb_typeof(f) = 'object' then f end)
  returning request_id into v_id;
  select name into v_bname from intel.ci_brand where brand_id = v_brand;
  insert into intel.ci_notification(recipient_member_id, kind, title, body, action_route, action_label, dedupe_key)
  select a.user_id, 'action_required', '📝 New campaign request: ' || coalesce(v_bname, 'a brand'),
         v_name || '. Open Brand CRM → ' || coalesce(v_bname, 'the brand') || ' → Brand portal to see the full brief and create the campaign.',
         'app.html?go=brands', 'Open Brand CRM', 'brandreq:' || v_id
    from public.platform_admins a;
  return jsonb_build_object('request_id', v_id);
end $$;

-- the Super Admin made the campaign from a request
create or replace function api.admin_campaign_request_converted(p_request uuid, p_campaign_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c uuid;
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  select c.campaign_id into v_c from intel.ci_campaign c join intel.ci_brand_campaign_request r on r.request_id = p_request
   where c.name = p_campaign_name and (c.brand_id = r.brand_id or c.brand_id is null) order by c.created_at desc limit 1;
  update intel.ci_brand_campaign_request set campaign_id = coalesce(v_c, campaign_id) where request_id = p_request;
  return api.admin_campaign_request_set(p_request, 'converted', 'Your campaign is set up.');
end $$;
revoke all on function api.admin_campaign_request_converted(uuid, text) from public, anon;
grant execute on function api.admin_campaign_request_converted(uuid, text) to authenticated;

-- ------------------------------------------------------------------ billing
create table if not exists intel.ci_billing_settings (
  id          int primary key default 1 check (id = 1),
  legal_name  text not null default 'GEEK ONLINE VENTURES PRIVATE LIMITED',
  trade_name  text default 'Geek Animals',
  gstin       text,
  pan         text,
  address     text,
  email       text,
  phone       text,
  sac_code    text default '998361',         -- advertising services
  default_gst numeric not null default 18,
  invoice_prefix text not null default 'GEEK',
  bank_note   text,                          -- "Bank transfer: …" printed on every bill
  updated_at  timestamptz not null default now()
);
insert into intel.ci_billing_settings(id) values (1) on conflict (id) do nothing;
alter table intel.ci_billing_settings enable row level security;
revoke all on intel.ci_billing_settings from public, anon, authenticated;

create sequence if not exists intel.ci_invoice_seq;

create table if not exists intel.ci_brand_invoice (
  invoice_id    uuid primary key default gen_random_uuid(),
  invoice_no    text not null unique,
  brand_id      uuid not null references intel.ci_brand(brand_id) on delete cascade,
  campaign_id   uuid references intel.ci_campaign(campaign_id) on delete set null,
  title         text not null,
  items         jsonb not null default '[]'::jsonb,     -- [{description, qty, rate}]
  subtotal      numeric(14,2) not null default 0,
  gst_pct       numeric(5,2) not null default 18,
  gst_amount    numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  currency      text not null default 'INR',
  issued_on     date not null default current_date,
  due_on        date,
  notes         text,
  status        text not null default 'requested' check (status in ('requested','paid','cancelled')),
  paid_at       timestamptz,
  paid_amount   numeric(14,2),
  paid_via      text check (paid_via in ('razorpay','manual')),
  paid_ref      text,                                     -- Razorpay payment id / UTR / cheque no
  paid_note     text,
  rzp_link_id   text,
  rzp_link_url  text,
  rzp_link_at   timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ci_brand_invoice_brand_idx on intel.ci_brand_invoice(brand_id, created_at desc);
alter table intel.ci_brand_invoice enable row level security;
revoke all on intel.ci_brand_invoice from public, anon, authenticated;

-- one bill as both sides see it (seller + buyer details for the printed bill)
create or replace function intel.ci_invoice_json(i intel.ci_brand_invoice)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(i) - 'created_by' || jsonb_build_object(
    'campaign', (select c.name from intel.ci_campaign c where c.campaign_id = i.campaign_id),
    'legacy_campaign_id', (select c.legacy_campaign_id from intel.ci_campaign c where c.campaign_id = i.campaign_id),
    'overdue', i.status = 'requested' and i.due_on is not null and i.due_on < current_date,
    'buyer', (select jsonb_strip_nulls(jsonb_build_object('name', b.name, 'gstin', b.gstin, 'address', b.address)) from intel.ci_brand b where b.brand_id = i.brand_id),
    'seller', (select jsonb_strip_nulls(jsonb_build_object('legal_name', s.legal_name, 'trade_name', s.trade_name, 'gstin', s.gstin, 'pan', s.pan, 'address', s.address,
                 'email', s.email, 'phone', s.phone, 'sac_code', s.sac_code, 'bank_note', s.bank_note)) from intel.ci_billing_settings s where s.id = 1)) $$;
revoke all on function intel.ci_invoice_json(intel.ci_brand_invoice) from public, anon, authenticated;

-- Super Admin: raise / edit a bill. p: {invoice_id?, brand_id, campaign_id?, title, items:[{description,qty,rate}], gst_pct, due_on, notes}
create or replace function api.admin_invoice_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p->>'invoice_id','')::uuid; v_brand uuid := nullif(p->>'brand_id','')::uuid; v_items jsonb := '[]'::jsonb; x jsonb;
        v_sub numeric := 0; v_gst numeric := coalesce(nullif(p->>'gst_pct','')::numeric, (select default_gst from intel.ci_billing_settings where id = 1), 18);
        v_no text; r intel.ci_brand_invoice%rowtype; v_new boolean := false;
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  if v_brand is null or not exists (select 1 from intel.ci_brand where brand_id = v_brand) then raise exception 'Pick the brand.' using errcode = '22023'; end if;
  if v_gst < 0 or v_gst > 28 then raise exception 'GST must be between 0 and 28%%.' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p->'items') = 'array' then p->'items' else '[]'::jsonb end) loop
    continue when coalesce(btrim(x->>'description'), '') = '';
    v_items := v_items || jsonb_build_array(jsonb_build_object('description', left(btrim(x->>'description'), 300),
                 'qty', greatest(coalesce(nullif(x->>'qty','')::numeric, 1), 0), 'rate', round(greatest(coalesce(nullif(x->>'rate','')::numeric, 0), 0), 2)));
    v_sub := v_sub + greatest(coalesce(nullif(x->>'qty','')::numeric, 1), 0) * round(greatest(coalesce(nullif(x->>'rate','')::numeric, 0), 0), 2);
  end loop;
  if jsonb_array_length(v_items) = 0 or v_sub <= 0 then raise exception 'Add at least one line with an amount.' using errcode = '22023'; end if;
  v_sub := round(v_sub, 2);
  if v_id is null then
    v_new := true;
    v_no := (select invoice_prefix from intel.ci_billing_settings where id = 1) || '/' || to_char(current_date, 'YYYY') || '/' || lpad(nextval('intel.ci_invoice_seq')::text, 4, '0');
    insert into intel.ci_brand_invoice(invoice_no, brand_id, campaign_id, title, items, subtotal, gst_pct, gst_amount, total, due_on, notes, created_by)
    values (v_no, v_brand, intel.ci_resolve_campaign(nullif(p->>'campaign_id','')::uuid), left(coalesce(nullif(btrim(p->>'title'),''), 'Campaign services'), 200), v_items, v_sub, v_gst,
            round(v_sub * v_gst / 100, 2), round(v_sub * (1 + v_gst / 100), 2), nullif(p->>'due_on','')::date, left(nullif(btrim(p->>'notes'),''), 1000), auth.uid())
    returning * into r;
  else
    update intel.ci_brand_invoice set campaign_id = intel.ci_resolve_campaign(nullif(p->>'campaign_id','')::uuid), title = left(coalesce(nullif(btrim(p->>'title'),''), title), 200), items = v_items,
           subtotal = v_sub, gst_pct = v_gst, gst_amount = round(v_sub * v_gst / 100, 2), total = round(v_sub * (1 + v_gst / 100), 2),
           due_on = nullif(p->>'due_on','')::date, notes = left(nullif(btrim(p->>'notes'),''), 1000),
           rzp_link_id = null, rzp_link_url = null, rzp_link_at = null, updated_at = now()            -- the amount may have changed: a new pay link is made
     where invoice_id = v_id and status = 'requested' returning * into r;
    if r.invoice_id is null then raise exception 'Only an unpaid bill can be edited.' using errcode = '22023'; end if;
  end if;
  if v_new then perform intel.ci_billing_alert(r.invoice_id, 'requested'); end if;
  return intel.ci_invoice_json(r);
end $$;
revoke all on function api.admin_invoice_save(jsonb) from public, anon;
grant execute on function api.admin_invoice_save(jsonb) to authenticated;

-- Super Admin: paid by hand (bank transfer / UPI / cheque) or cancel
create or replace function api.admin_invoice_mark(p_invoice uuid, p_action text, p_ref text default null, p_amount numeric default null, p_paid_on date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r intel.ci_brand_invoice%rowtype;
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  if p_action = 'paid' then
    update intel.ci_brand_invoice set status = 'paid', paid_via = 'manual', paid_ref = left(nullif(btrim(p_ref),''), 120), paid_amount = coalesce(p_amount, total),
           paid_at = coalesce(p_paid_on::timestamptz, now()), paid_note = left(nullif(btrim(p_note),''), 500), updated_at = now()
     where invoice_id = p_invoice and status = 'requested' returning * into r;
    if r.invoice_id is null then raise exception 'This bill is already paid or cancelled.' using errcode = '22023'; end if;
    perform intel.ci_billing_alert(r.invoice_id, 'paid');
  elsif p_action = 'cancel' then
    update intel.ci_brand_invoice set status = 'cancelled', paid_note = left(nullif(btrim(p_note),''), 500), updated_at = now()
     where invoice_id = p_invoice and status = 'requested' returning * into r;
    if r.invoice_id is null then raise exception 'Only an unpaid bill can be cancelled.' using errcode = '22023'; end if;
  elsif p_action = 'unpay' then                                   -- a manual "paid" marked by mistake
    update intel.ci_brand_invoice set status = 'requested', paid_via = null, paid_ref = null, paid_amount = null, paid_at = null, updated_at = now()
     where invoice_id = p_invoice and status = 'paid' and paid_via = 'manual' returning * into r;
    if r.invoice_id is null then raise exception 'Only a bill marked paid by hand can be undone.' using errcode = '22023'; end if;
  else raise exception 'bad action' using errcode = '22023'; end if;
  return intel.ci_invoice_json(r);
end $$;
revoke all on function api.admin_invoice_mark(uuid, text, text, numeric, date, text) from public, anon;
grant execute on function api.admin_invoice_mark(uuid, text, text, numeric, date, text) to authenticated;

-- both sides: the bill history (brand login → its own; Super Admin → any brand, or every brand with p_brand null)
create or replace function api.brand_invoices(p_brand uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  if public.is_platform_admin() and p_brand is null then
    v_ids := (select array_agg(brand_id) from intel.ci_brand);
  else
    v_ids := intel.ci_portal_brands(p_brand);
  end if;
  return jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(intel.ci_invoice_json(i) || jsonb_build_object('brand', (select b.name from intel.ci_brand b where b.brand_id = i.brand_id)) order by i.created_at desc)
                  from intel.ci_brand_invoice i where i.brand_id = any(v_ids)), '[]'::jsonb),
    'due', (select coalesce(sum(total), 0) from intel.ci_brand_invoice where brand_id = any(v_ids) and status = 'requested'),
    'paid', (select coalesce(sum(coalesce(paid_amount, total)), 0) from intel.ci_brand_invoice where brand_id = any(v_ids) and status = 'paid'),
    'online', exists (select 1 from intel.ci_billing_online where id = 1 and on_ok),
    'can_pay', coalesce(intel.ci_brand_role(), 'owner') not in ('viewer','removed'));
end $$;
revoke all on function api.brand_invoices(uuid) from public, anon;
grant execute on function api.brand_invoices(uuid) to authenticated;

-- is Razorpay online payment working (the brand-billing function reports it)
create table if not exists intel.ci_billing_online (id int primary key default 1 check (id = 1), on_ok boolean not null default false, mode text, error text, checked_at timestamptz);
insert into intel.ci_billing_online(id) values (1) on conflict (id) do nothing;
alter table intel.ci_billing_online enable row level security;
revoke all on intel.ci_billing_online from public, anon, authenticated;

-- Super Admin: the seller details printed on every bill
create or replace function api.admin_billing_settings(p jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  if p is not null then
    update intel.ci_billing_settings set legal_name = coalesce(nullif(btrim(p->>'legal_name'),''), legal_name), trade_name = nullif(btrim(p->>'trade_name'),''),
           gstin = upper(nullif(btrim(p->>'gstin'),'')), pan = upper(nullif(btrim(p->>'pan'),'')), address = nullif(btrim(p->>'address'),''),
           email = nullif(btrim(p->>'email'),''), phone = nullif(btrim(p->>'phone'),''), sac_code = nullif(btrim(p->>'sac_code'),''),
           default_gst = coalesce(nullif(p->>'default_gst','')::numeric, default_gst), invoice_prefix = coalesce(nullif(regexp_replace(coalesce(p->>'invoice_prefix',''), '[^A-Za-z0-9-]', '', 'g'),''), invoice_prefix),
           bank_note = nullif(btrim(p->>'bank_note'),''), updated_at = now() where id = 1;
  end if;
  return (select to_jsonb(s) from intel.ci_billing_settings s where s.id = 1)
      || jsonb_build_object('online', (select to_jsonb(o) - 'id' from intel.ci_billing_online o where o.id = 1));
end $$;
revoke all on function api.admin_billing_settings(jsonb) from public, anon;
grant execute on function api.admin_billing_settings(jsonb) to authenticated;

-- ------------------------------------------------------------------ the brand-billing function (service role)
-- may this person pay this bill? → the bill + who to put on the Razorpay link
create or replace function api.ops_invoice_for_payer(p_member uuid, p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i intel.ci_brand_invoice%rowtype; v_ok boolean;
begin
  select * into i from intel.ci_brand_invoice where invoice_id = p_invoice;
  if i.invoice_id is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  v_ok := exists (select 1 from public.platform_admins a where a.user_id = p_member)
       or exists (select 1 from public.members m join intel.ci_brand b on b.org_id = m.org_id
                   where m.id = p_member and b.brand_id = i.brand_id and m.role = 'brand' and coalesce(m.status,'active') = 'active'
                     and coalesce(intel.ci_brand_role(p_member), 'owner') not in ('viewer','removed'));
  if not v_ok then raise exception 'not your bill' using errcode = '42501'; end if;
  return intel.ci_invoice_json(i) || jsonb_build_object('payer', (select jsonb_build_object('name', m.name, 'email', u.email, 'phone', m.whatsapp_e164)
                                                          from public.members m join auth.users u on u.id = m.id where m.id = p_member));
end $$;
revoke all on function api.ops_invoice_for_payer(uuid, uuid) from public, anon, authenticated;
grant execute on function api.ops_invoice_for_payer(uuid, uuid) to service_role;

create or replace function api.ops_invoice_link(p_invoice uuid, p_link_id text, p_url text)
returns void language sql security definer set search_path = '' as $$
  update intel.ci_brand_invoice set rzp_link_id = p_link_id, rzp_link_url = p_url, rzp_link_at = now(), updated_at = now()
   where invoice_id = p_invoice and status = 'requested' $$;
revoke all on function api.ops_invoice_link(uuid, text, text) from public, anon, authenticated;
grant execute on function api.ops_invoice_link(uuid, text, text) to service_role;

-- Razorpay says paid → the bill is paid (idempotent)
create or replace function api.ops_invoice_paid(p_invoice uuid, p_payment_id text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r intel.ci_brand_invoice%rowtype;
begin
  update intel.ci_brand_invoice set status = 'paid', paid_via = 'razorpay', paid_ref = left(p_payment_id, 120), paid_amount = coalesce(p_amount, total),
         paid_at = now(), updated_at = now()
   where invoice_id = p_invoice and status = 'requested' returning * into r;
  if r.invoice_id is not null then perform intel.ci_billing_alert(r.invoice_id, 'paid'); end if;
  return jsonb_build_object('paid', r.invoice_id is not null);
end $$;
revoke all on function api.ops_invoice_paid(uuid, text, numeric) from public, anon, authenticated;
grant execute on function api.ops_invoice_paid(uuid, text, numeric) to service_role;

create or replace function api.ops_invoices_open_links()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('invoice_id', invoice_id, 'link_id', rzp_link_id)), '[]'::jsonb)
    from intel.ci_brand_invoice where status = 'requested' and rzp_link_id is not null $$;
revoke all on function api.ops_invoices_open_links() from public, anon, authenticated;
grant execute on function api.ops_invoices_open_links() to service_role;

create or replace function api.ops_billing_online(p_ok boolean, p_mode text, p_error text)
returns void language sql security definer set search_path = '' as $$
  update intel.ci_billing_online set on_ok = coalesce(p_ok, false), mode = p_mode, error = nullif(btrim(coalesce(p_error,'')), ''), checked_at = now() where id = 1 $$;
revoke all on function api.ops_billing_online(boolean, text, text) from public, anon, authenticated;
grant execute on function api.ops_billing_online(boolean, text, text) to service_role;

-- ------------------------------------------------------------------ alerts: new bill → brand team; paid → brand team + Super Admins
create or replace function intel.ci_billing_alert(p_invoice uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare i intel.ci_brand_invoice%rowtype; b intel.ci_brand%rowtype; m record; v_amt text; v_title text; v_body text;
begin
  select * into i from intel.ci_brand_invoice where invoice_id = p_invoice;
  select * into b from intel.ci_brand where brand_id = i.brand_id;
  v_amt := '₹' || to_char(coalesce(i.paid_amount, i.total), 'FM99,99,99,99,990.00');
  if p_kind = 'requested' then
    v_title := '💳 Payment request: ' || v_amt; v_body := i.title || ' (' || i.invoice_no || ')' || coalesce(', due ' || to_char(i.due_on, 'DD Mon YYYY'), '') || '. Open Billing to pay online or see the bill.';
  else
    v_title := '✅ Payment received: ' || v_amt; v_body := i.title || ' (' || i.invoice_no || ') is paid' || case when i.paid_via = 'razorpay' then ' online via Razorpay' else '' end || '. The receipt is under Billing.';
  end if;
  if b.org_id is not null then
    for m in select x.id, x.email, x.name from public.members x left join intel.ci_brand_member_role r on r.member_id = x.id
              where x.org_id = b.org_id and x.role = 'brand' and coalesce(x.status, 'active') = 'active' and coalesce(r.role, 'owner') <> 'removed' loop
      insert into intel.ci_notification(recipient_member_id, kind, title, body, action_route, action_label, dedupe_key)
      values (m.id, case when p_kind = 'requested' then 'action_required' else 'info' end, v_title, v_body, 'app.html?go=billing', 'Open Billing', 'bill:' || p_kind || ':' || i.invoice_id);
      if b.notify_email and m.email is not null and m.email !~* '@creators\.bountythreads\.app$' then
        insert into intel.ci_outbox(channel, recipient_member_id, to_address, template_key, payload, dedupe_key)
        values ('email', m.id, m.email, 'brand_bill_' || p_kind,
                jsonb_build_object('subject', v_title || ' — ' || b.name, 'html', 'Hi ' || coalesce(nullif(split_part(m.name, ' ', 1), ''), 'there') || ',' || E'\n\n' || v_title || '.' || E'\n' || v_body,
                                   'to_name', m.name, 'action_route', '/app.html?door=brand&go=billing', 'action_label', case when p_kind = 'requested' then 'Pay now' else 'See the receipt' end),
                'bill:' || p_kind || ':' || i.invoice_id || ':' || m.id)
        on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end loop;
  end if;
  if p_kind = 'paid' then
    insert into intel.ci_notification(recipient_member_id, kind, title, body, action_route, action_label, dedupe_key)
    select a.user_id, 'info', '✅ ' || b.name || ' paid ' || v_amt, i.title || ' (' || i.invoice_no || ')' || case when i.paid_via = 'razorpay' then ' — paid online, Razorpay ' || coalesce(i.paid_ref, '') else ' — marked paid by hand' end,
           'app.html?go=brands', 'Open Brand CRM', 'billpaid:' || i.invoice_id
      from public.platform_admins a;
  end if;
exception when others then raise warning 'billing alert skipped: %', sqlerrm;
end $$;
revoke all on function intel.ci_billing_alert(uuid, text) from public, anon, authenticated;
