-- 📥 Bulk upload → "Upload history": every upload on a campaign — when, who, how many creators came in (new / updated),
-- and the creators of that upload with their details (like the creator list). From now on every upload logs its batch
-- and each row it touched; older uploads are rebuilt from the activity log (new creators = rows created in that upload).
create table if not exists intel.ci_bulk_upload_item (
  id bigserial primary key,
  batch_id uuid not null,
  campaign_id uuid,
  invite_id uuid,
  at timestamptz not null default now(),
  action text not null,          -- new | updated
  sheet_status text              -- the Status the sheet gave this row
);
create index if not exists ci_bulk_upload_item_batch_idx on intel.ci_bulk_upload_item (batch_id);
create index if not exists ci_bulk_upload_item_camp_idx on intel.ci_bulk_upload_item (campaign_id, at desc);
alter table intel.ci_bulk_upload_item enable row level security;
revoke all on intel.ci_bulk_upload_item from public, anon, authenticated;

-- the upload itself logs its batch + every row it added or updated
do $p$
declare d text; n text;
begin
  d := pg_get_functiondef('api.bulk_import_creators(uuid,jsonb,text)'::regprocedure);
  if position('ci_bulk_upload_item' in d) > 0 then return; end if;
  n := replace(d, $a$jsonb_build_object('campaign', p_campaign, 'added', v_added,$a$, $a$jsonb_build_object('campaign', p_campaign, 'batch', v_batch, 'added', v_added,$a$);
  n := replace(n, $a$  return jsonb_build_object('batch_id', v_batch,$a$, $a$  -- 📥 upload history: every row this upload added or updated
  insert into intel.ci_bulk_upload_item(batch_id, campaign_id, invite_id, action, sheet_status)
  select v_batch, i.campaign_id, i.invite_id, case when i.created_at = now() then 'new' else 'updated' end, i.status
    from intel.ci_campaign_invite i where i.batch_id = v_batch;
  return jsonb_build_object('batch_id', v_batch,$a$);
  if position('ci_bulk_upload_item' in n) = 0 or position($a$'batch', v_batch$a$ in n) = 0 then
    raise exception 'bulk_import_creators: text not found — not patched';
  end if;
  execute n;
end $p$;

create or replace function api.campaign_upload_history(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return jsonb_build_object('campaign', v_c, 'uploads', coalesce((select jsonb_agg(u order by u.at desc) from (
    select a.created_at at, coalesce(nullif(m.name, ''), 'Someone on the team') who,
           nullif(a.detail->>'batch', '')::uuid batch,
           coalesce((a.detail->>'skipped')::int, 0) skipped, coalesce((a.detail->>'duplicates')::int, 0) duplicates,
           coalesce((a.detail->>'invited')::int, 0) invited, coalesce((a.detail->>'waiting')::int, 0) waiting,
           x.items,
           (select count(*) from jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) e where e->>'action' = 'new') new_count,
           (select count(*) from jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) e where e->>'action' = 'updated') updated_count,
           (a.detail->>'batch') is not null exact
      from public.activity_log a
      left join public.members m on m.id = a.member_id
      left join lateral (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'action', it.action, 'invite_id', i.invite_id, 'participation_id', i.participation_id, 'name', i.full_name, 'handle', i.handle, 'phone', i.phone_e164, 'email', i.email, 'city', i.city,
                 'followers', i.followers, 'sheet_status', it.sheet_status, 'status_now', i.status,
                 'registered', i.claimed_at is not null, 'in_campaign', i.participation_id is not null, 'invites_sent', i.invites_sent)
               order by it.action, coalesce(i.handle, i.full_name)), '[]'::jsonb) items
          from (
            -- logged uploads: exactly what they touched
            select b.invite_id, b.action, b.sheet_status from intel.ci_bulk_upload_item b where (a.detail->>'batch') is not null and b.batch_id = (a.detail->>'batch')::uuid
            union all
            -- older uploads: the creators that upload created
            select i2.invite_id, 'new', i2.status from intel.ci_campaign_invite i2
             where (a.detail->>'batch') is null and i2.campaign_id = v_c and i2.created_at = a.created_at
          ) it join intel.ci_campaign_invite i on i.invite_id = it.invite_id) x on true
     where a.event = 'bulk_creator_upload'
       and (a.detail->>'campaign') ~ '^[0-9a-f-]{36}$'
       and intel.ci_resolve_campaign((a.detail->>'campaign')::uuid) = v_c) u), '[]'::jsonb));
end $$;
revoke all on function api.campaign_upload_history(uuid) from public, anon;
grant execute on function api.campaign_upload_history(uuid) to authenticated;
