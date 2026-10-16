-- Deleting a campaign is a Super Admin power.
--   • Agency / brand: "Request delete" (with a reason) → it waits in Super Admin → Campaign deletes.
--   • Super Admin: approves (the campaign and everything under it is deleted) or rejects (with a note),
--     or deletes a campaign directly.
-- What goes with a campaign: its ops copy, creators in it, contracts, addresses, shipments, video
-- submissions, posts + metrics, invites, reminders, notifications, unsent WhatsApp/email, applications,
-- its WhatsApp campaign template. Creator / brand / agency accounts are never touched.
-- ADDITIVE except: the old policy that let any org member DELETE their org's campaign row is dropped.

-- 1) only the Super Admin deletes campaign rows (the API never deletes them directly any more)
drop policy if exists "org delete campaigns" on public.campaigns;

-- 2) campaign history is append-only; a sanctioned purge may remove it (transaction-local switch)
create or replace function intel.tg_block_mutation() returns trigger language plpgsql set search_path to 'pg_catalog' as $$
begin
  if tg_op = 'DELETE' and tg_table_schema = 'intel' and tg_table_name = 'ci_campaign_event'
     and coalesce(current_setting('geek.campaign_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'append-only table %.% — % is not permitted', tg_table_schema, tg_table_name, tg_op;
  return null;
end $$;

-- 3) requests
create table if not exists public.campaign_delete_requests (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null,                 -- public.campaigns.id (no FK: the request outlives the campaign)
  campaign_name text,
  brand         text,
  org_id        uuid,
  org_name      text,
  requested_by  uuid,
  requester     text,
  reason        text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);
create unique index if not exists campaign_delete_one_pending on public.campaign_delete_requests(campaign_id) where status = 'pending';
alter table public.campaign_delete_requests enable row level security;
revoke all on public.campaign_delete_requests from anon, authenticated;

-- 4) the purge itself (private: only reachable through the functions below)
create or replace function private.purge_campaign(p_campaign uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_ops uuid[]; v_n int;
begin
  perform set_config('geek.campaign_purge', 'on', true);
  select coalesce(array_agg(campaign_id), '{}') into v_ops from intel.ci_campaign where legacy_campaign_id = p_campaign;
  delete from intel.ci_pilot_feedback   where campaign_id = any(v_ops) or campaign_id = p_campaign;
  delete from intel.ci_matching_request where campaign_id = any(v_ops) or campaign_id = p_campaign;
  update public.wa_conversations set campaign_id = null where campaign_id = p_campaign or campaign_id = any(v_ops);
  delete from public.applications where campaign_id = p_campaign;
  delete from intel.ci_campaign where campaign_id = any(v_ops);      -- everything under it cascades
  delete from public.campaigns where id = p_campaign;                -- + its WhatsApp campaign template
  get diagnostics v_n = row_count;
  perform set_config('geek.campaign_purge', 'off', true);
  return v_n;
end $$;
revoke all on function private.purge_campaign(uuid) from public, anon, authenticated;

-- 5) agency / brand: ask for a delete
create or replace function public.request_campaign_delete(p_campaign uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.campaigns%rowtype; m public.members%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;
  select * into c from public.campaigns where id = p_campaign;
  if c.id is null then raise exception 'Campaign not found.'; end if;
  if public.is_platform_admin() then
    raise exception 'You are the Super Admin — use Delete campaign instead.';
  end if;
  select * into m from public.members where id = auth.uid();
  if m.id is null or m.org_id is distinct from c.org_id then raise exception 'You can only request deletes for your own campaigns.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please write why this campaign should be deleted.'; end if;
  if exists (select 1 from public.campaign_delete_requests where campaign_id = c.id and status = 'pending') then
    raise exception 'A delete request for this campaign is already waiting for the Super Admin.';
  end if;
  insert into public.campaign_delete_requests(campaign_id, campaign_name, brand, org_id, org_name, requested_by, requester, reason)
  values (c.id, c.name, c.brand, c.org_id, c.org_name, auth.uid(), coalesce(nullif(m.name, ''), m.email), left(btrim(p_reason), 500))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'request_id', v_id, 'status', 'pending');
end $$;

create or replace function public.cancel_campaign_delete_request(p_campaign uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.campaign_delete_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where campaign_id = p_campaign and status = 'pending'
     and (requested_by = auth.uid() or org_id = (select org_id from public.members where id = auth.uid()));
  return jsonb_build_object('ok', found);
end $$;

-- the latest request for a campaign (for the campaign page)
create or replace function public.campaign_delete_status(p_campaign uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(r) - 'requested_by' - 'decided_by'
    from public.campaign_delete_requests r
   where r.campaign_id = p_campaign
     and (public.is_platform_admin() or r.org_id = (select org_id from public.members where id = auth.uid()))
   order by r.created_at desc limit 1
$$;

-- 6) Super Admin
create or replace function public.admin_campaign_delete_requests(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only.'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) || jsonb_build_object(
             'creators', (select count(*) from intel.ci_campaign_participation p join intel.ci_campaign ic on ic.campaign_id = p.campaign_id where ic.legacy_campaign_id = r.campaign_id),
             'still_exists', exists (select 1 from public.campaigns c where c.id = r.campaign_id))
           order by r.created_at desc)
      from public.campaign_delete_requests r
     where p_status is null or r.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_decide_campaign_delete(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.campaign_delete_requests%rowtype; v_n int := 0;
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only.'; end if;
  select * into r from public.campaign_delete_requests where id = p_request for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %.', r.status; end if;
  if p_approve then v_n := private.purge_campaign(r.campaign_id); end if;
  update public.campaign_delete_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
  return jsonb_build_object('ok', true, 'deleted', v_n > 0, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;

create or replace function public.admin_delete_campaign(p_campaign uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.campaigns%rowtype; v_n int;
begin
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can delete a campaign.'; end if;
  select * into c from public.campaigns where id = p_campaign;
  if c.id is null then raise exception 'Campaign not found.'; end if;
  -- close any pending request for it, and keep a record of the delete
  update public.campaign_delete_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
   where campaign_id = c.id and status = 'pending';
  if not found then
    insert into public.campaign_delete_requests(campaign_id, campaign_name, brand, org_id, org_name, requested_by, requester, reason, status, decided_by, decided_at, decision_note)
    values (c.id, c.name, c.brand, c.org_id, c.org_name, auth.uid(), 'Super Admin', 'Deleted by the Super Admin', 'approved', auth.uid(), now(), nullif(btrim(coalesce(p_note, '')), ''));
  end if;
  v_n := private.purge_campaign(c.id);
  return jsonb_build_object('ok', true, 'deleted', v_n > 0);
end $$;

revoke all on function public.request_campaign_delete(uuid, text), public.cancel_campaign_delete_request(uuid), public.campaign_delete_status(uuid),
                       public.admin_campaign_delete_requests(text), public.admin_decide_campaign_delete(uuid, boolean, text),
                       public.admin_delete_campaign(uuid, text) from public, anon;
grant execute on function public.request_campaign_delete(uuid, text), public.cancel_campaign_delete_request(uuid), public.campaign_delete_status(uuid),
                          public.admin_campaign_delete_requests(text), public.admin_decide_campaign_delete(uuid, boolean, text),
                          public.admin_delete_campaign(uuid, text) to authenticated;
