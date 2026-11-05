-- ⚠️ Bulk upload: the rows that were NOT uploaded — who and why (missing courier / address / video / post link,
-- no contact, same number as another creator, already in…) — kept with the upload and shown in its Upload history.
create table if not exists intel.ci_bulk_upload_skip (
  id bigserial primary key,
  batch_id uuid not null,
  campaign_id uuid,
  row_no int,
  name text, handle text, phone text, email text,
  status text,
  reason text,
  at timestamptz not null default now()
);
create index if not exists ci_bulk_upload_skip_batch_idx on intel.ci_bulk_upload_skip (batch_id);
alter table intel.ci_bulk_upload_skip enable row level security;
revoke all on intel.ci_bulk_upload_skip from public, anon, authenticated;

create or replace function api.bulk_log_skipped(p_campaign uuid, p_batch uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_c uuid; v_n int;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p_batch is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  insert into intel.ci_bulk_upload_skip(batch_id, campaign_id, row_no, name, handle, phone, email, status, reason)
  select p_batch, v_c, nullif(r->>'row', '')::int, left(r->>'name', 120), left(r->>'handle', 120), left(r->>'phone', 40), left(r->>'email', 160),
         left(r->>'status', 40), left(r->>'reason', 300)
    from jsonb_array_elements(p_rows) r limit 2000;
  get diagnostics v_n = row_count; return v_n;
end $$;
revoke all on function api.bulk_log_skipped(uuid, uuid, jsonb) from public, anon;
grant execute on function api.bulk_log_skipped(uuid, uuid, jsonb) to authenticated;

-- the history shows them under each upload
do $p$
declare d text; n text;
begin
  d := pg_get_functiondef('api.campaign_upload_history(uuid)'::regprocedure);
  if position('ci_bulk_upload_skip' in d) > 0 then return; end if;
  n := replace(d, $a$(a.detail->>'batch') is not null exact$a$,
    $a$(a.detail->>'batch') is not null exact,
           coalesce((select jsonb_agg(jsonb_build_object('row', s.row_no, 'name', s.name, 'handle', s.handle, 'phone', s.phone, 'email', s.email,
                       'status', s.status, 'reason', s.reason) order by s.row_no)
                       from intel.ci_bulk_upload_skip s where s.batch_id = nullif(a.detail->>'batch', '')::uuid), '[]'::jsonb) not_uploaded$a$);
  if n = d then raise exception 'history not patched'; end if;
  execute n;
end $p$;
