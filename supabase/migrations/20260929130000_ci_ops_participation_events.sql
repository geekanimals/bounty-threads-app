-- Phase 1E Operations — per-creator participation, the APPEND-ONLY event ledger, execution tables, and the
-- validated state-machine transition function. ADDITIVE + DARK. Reuses ci_creator_identity, ci_match_result,
-- ci_media, and the append-only trigger tg_block_mutation. Current status lives on the row; full history +
-- owner + timestamp + reason live in ci_campaign_event. Clients never UPDATE status directly — only the
-- transition function does, which appends an event for every change. No scoring, no inferred metrics.

-- ---- per-creator participation (current stage) ----
create table if not exists intel.ci_campaign_participation (
  participation_id uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  identity_id      uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  role             text references intel.ci_participation_role_vocab(role_key),
  match_result_id  uuid references intel.ci_match_result(match_result_id) on delete set null,
  stage            text not null default 'shortlisted' check (stage in
                    ('shortlisted','invited','accepted','rejected','product_sent','content_created',
                     'content_submitted','content_approved','changes_requested','published','completed','dropped')),
  owner_member_id  uuid references auth.users(id) on delete set null,
  invited_at       timestamptz,
  accepted_at      timestamptz,
  rejected_at      timestamptz,
  reason           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ci_participation_uq unique (campaign_id, identity_id)
);
create index if not exists ci_participation_campaign_idx on intel.ci_campaign_participation(campaign_id, stage);
create index if not exists ci_participation_identity_idx on intel.ci_campaign_participation(identity_id);
drop trigger if exists ci_participation_updated_at on intel.ci_campaign_participation;
create trigger ci_participation_updated_at before update on intel.ci_campaign_participation
  for each row execute function intel.tg_set_updated_at();

-- ---- APPEND-ONLY status ledger (owner · timestamp · from→to · reason, for every entity) ----
create table if not exists intel.ci_campaign_event (
  event_id         uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  participation_id uuid references intel.ci_campaign_participation(participation_id) on delete cascade,
  entity           text not null check (entity in ('campaign','participation','deliverable','shipment','submission','approval')),
  from_status      text,
  to_status        text not null,
  actor_member_id  uuid references auth.users(id) on delete set null,
  reason           text,
  at               timestamptz not null default now()
);
create index if not exists ci_campaign_event_campaign_idx on intel.ci_campaign_event(campaign_id, at);
create index if not exists ci_campaign_event_part_idx     on intel.ci_campaign_event(participation_id, at);
drop trigger if exists ci_campaign_event_append_only on intel.ci_campaign_event;
create trigger ci_campaign_event_append_only before update or delete on intel.ci_campaign_event
  for each row execute function intel.tg_block_mutation();

-- ---- deliverables (expected content per participation) ----
create table if not exists intel.ci_campaign_deliverable (
  deliverable_id   uuid primary key default gen_random_uuid(),
  participation_id uuid not null references intel.ci_campaign_participation(participation_id) on delete cascade,
  content_format   text references intel.ci_content_format_vocab(format_key),
  quantity         int check (quantity is null or quantity > 0),
  expected_by      date,
  status           text not null default 'expected' check (status in ('expected','submitted','approved','published','missed')),
  media_row_id     uuid references intel.ci_media(media_row_id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ci_deliverable_part_idx on intel.ci_campaign_deliverable(participation_id);
drop trigger if exists ci_deliverable_updated_at on intel.ci_campaign_deliverable;
create trigger ci_deliverable_updated_at before update on intel.ci_campaign_deliverable
  for each row execute function intel.tg_set_updated_at();

-- ---- shipments (product sent) ----
create table if not exists intel.ci_campaign_shipment (
  shipment_id      uuid primary key default gen_random_uuid(),
  participation_id uuid not null references intel.ci_campaign_participation(participation_id) on delete cascade,
  product          text,
  courier          text,
  tracking_ref     text,
  shipped_at       timestamptz,
  delivered_at     timestamptz,
  status           text not null default 'pending' check (status in ('pending','shipped','delivered','failed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ci_shipment_part_idx on intel.ci_campaign_shipment(participation_id);
drop trigger if exists ci_shipment_updated_at on intel.ci_campaign_shipment;
create trigger ci_shipment_updated_at before update on intel.ci_campaign_shipment
  for each row execute function intel.tg_set_updated_at();

-- ---- submissions (creator content links; never raw media/DMs) ----
create table if not exists intel.ci_campaign_submission (
  submission_id  uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references intel.ci_campaign_deliverable(deliverable_id) on delete cascade,
  content_url    text,
  note           text,
  status         text not null default 'submitted' check (status in ('submitted','withdrawn')),
  submitted_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists ci_submission_deliverable_idx on intel.ci_campaign_submission(deliverable_id);

-- ---- approvals (brand/agency decision on a submission) ----
create table if not exists intel.ci_campaign_approval (
  approval_id        uuid primary key default gen_random_uuid(),
  submission_id      uuid not null references intel.ci_campaign_submission(submission_id) on delete cascade,
  reviewer_member_id uuid references auth.users(id) on delete set null,
  decision           text not null check (decision in ('approved','changes_requested','rejected')),
  reason             text,
  decided_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  constraint ci_approval_reason_ck check (decision='approved' or reason is not null)  -- rejection/changes need a reason
);
create index if not exists ci_approval_submission_idx on intel.ci_campaign_approval(submission_id);

do $$ declare t text; begin
  foreach t in array array['ci_campaign_participation','ci_campaign_event','ci_campaign_deliverable',
                           'ci_campaign_shipment','ci_campaign_submission','ci_campaign_approval'] loop
    execute format('alter table intel.%I enable row level security', t);
    execute format('revoke all on table intel.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table intel.%I to service_role', t);
  end loop;
end $$;

-- ============================ transition function (the only legal way to change a stage) ============================
-- Validates the move against the legal map, stamps timestamps, records the reason (required for failure/
-- rejection moves), and APPENDS to ci_campaign_event. Returns the new stage.
create or replace function intel.ci_participation_advance(p_participation uuid, p_to text, p_actor uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_from text; v_camp uuid; v_ok boolean; v_needs_reason boolean;
        v_legal jsonb := jsonb_build_object(
          'shortlisted', jsonb_build_array('invited','dropped'),
          'invited',     jsonb_build_array('accepted','rejected','dropped'),
          'accepted',    jsonb_build_array('product_sent','dropped'),
          'product_sent',jsonb_build_array('content_created','dropped'),
          'content_created', jsonb_build_array('content_submitted','dropped'),
          'content_submitted', jsonb_build_array('content_approved','changes_requested','rejected'),
          'changes_requested', jsonb_build_array('content_submitted','dropped'),
          'content_approved', jsonb_build_array('published'),
          'published',   jsonb_build_array('completed'));
begin
  select stage, campaign_id into v_from, v_camp from intel.ci_campaign_participation where participation_id=p_participation;
  if v_from is null then raise exception 'participation not found' using errcode='42501'; end if;
  v_ok := (v_legal ? v_from) and (v_legal->v_from) ? p_to;
  if not v_ok then raise exception 'illegal transition % -> %', v_from, p_to using errcode='22023'; end if;
  v_needs_reason := p_to in ('rejected','dropped','changes_requested');
  if v_needs_reason and coalesce(btrim(p_reason),'')='' then
    raise exception 'a reason is required to % a participation', p_to using errcode='22023'; end if;

  update intel.ci_campaign_participation
    set stage=p_to, reason=case when v_needs_reason then p_reason else reason end,
        invited_at  = case when p_to='invited'  then now() else invited_at  end,
        accepted_at = case when p_to='accepted' then now() else accepted_at end,
        rejected_at = case when p_to in ('rejected','dropped') then now() else rejected_at end
    where participation_id=p_participation;

  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'participation', v_from, p_to, p_actor, p_reason);
  return p_to;
end $$;
revoke all on function intel.ci_participation_advance(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function intel.ci_participation_advance(uuid,text,uuid,text) to service_role;

-- campaign-level status change (draft -> discovery -> in_execution -> reporting -> completed/cancelled)
create or replace function intel.ci_campaign_set_status(p_campaign uuid, p_to text, p_actor uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_from text; v_ok boolean;
        v_legal jsonb := jsonb_build_object(
          'draft', jsonb_build_array('creator_discovery','cancelled'),
          'creator_discovery', jsonb_build_array('in_execution','cancelled'),
          'in_execution', jsonb_build_array('reporting','cancelled'),
          'reporting', jsonb_build_array('completed','cancelled'));
begin
  select lifecycle_status into v_from from intel.ci_campaign where campaign_id=p_campaign;
  if v_from is null then raise exception 'campaign not found' using errcode='42501'; end if;
  v_ok := (v_legal ? v_from) and (v_legal->v_from) ? p_to;
  if not v_ok then raise exception 'illegal campaign transition % -> %', v_from, p_to using errcode='22023'; end if;
  if p_to='cancelled' and coalesce(btrim(p_reason),'')='' then
    raise exception 'a reason is required to cancel a campaign' using errcode='22023'; end if;
  update intel.ci_campaign set lifecycle_status=p_to where campaign_id=p_campaign;
  insert into intel.ci_campaign_event(campaign_id, entity, from_status, to_status, actor_member_id, reason)
    values (p_campaign, 'campaign', v_from, p_to, p_actor, p_reason);
  return p_to;
end $$;
revoke all on function intel.ci_campaign_set_status(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function intel.ci_campaign_set_status(uuid,text,uuid,text) to service_role;
