-- ============ Review deliverables (Google review / District review) — screenshot proof ============
-- Creators upload a screenshot of each review; the team can also upload a whole folder at once.
-- A creator is not marked complete while a review screenshot the campaign asks for is missing.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('review-proofs','review-proofs', true, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/gif'])
on conflict (id) do nothing;
drop policy if exists "review proofs: upload" on storage.objects;
create policy "review proofs: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-proofs' and (public.is_platform_admin() or ((storage.foldername(name))[1] = 'c' and (storage.foldername(name))[2] = auth.uid()::text)));
drop policy if exists "review proofs: read" on storage.objects;
create policy "review proofs: read" on storage.objects for select to public using (bucket_id = 'review-proofs');

create table if not exists intel.ci_review_proof (
  proof_id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  participation_id uuid references intel.ci_campaign_participation(participation_id) on delete cascade,
  invite_id uuid references intel.ci_campaign_invite(invite_id) on delete cascade,
  kind text not null check (kind in ('google_review','district_review')),
  path text not null,
  url text not null,
  by_member uuid,
  by_role text not null default 'creator' check (by_role in ('creator','team')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (participation_id is not null or invite_id is not null)
);
create index if not exists ci_review_proof_part on intel.ci_review_proof(participation_id) where deleted_at is null;
create index if not exists ci_review_proof_inv on intel.ci_review_proof(invite_id) where deleted_at is null;
create index if not exists ci_review_proof_camp on intel.ci_review_proof(campaign_id) where deleted_at is null;
alter table intel.ci_review_proof enable row level security;
revoke all on intel.ci_review_proof from public, anon, authenticated;

-- how many review screenshots each creator owes (read from the deliverables text: "1 Google review", "2 x District reviews")
create or replace function intel.ci_review_need(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t text; g int := 0; d int := 0; m text[];
begin
  select lower(coalesce(br.requirements->>'deliverables_text','')) into t from intel.ci_campaign_brief br where br.campaign_id = p_campaign order by br.created_at desc limit 1;
  t := coalesce(t, '');
  if t ~ 'google' then m := regexp_match(t, '(\d+)\s*[x×]?\s*google'); g := coalesce(m[1]::int, 1); end if;
  if t ~ 'district' then m := regexp_match(t, '(\d+)\s*[x×]?\s*district'); d := coalesce(m[1]::int, 1); end if;
  return jsonb_build_object('google_review', least(g, 10), 'district_review', least(d, 10));
end $$;

-- what is still missing for one participation / invite (empty array = nothing owed)
create or replace function intel.ci_review_missing(p_campaign uuid, p_part uuid, p_inv uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare n jsonb := intel.ci_review_need(p_campaign); out jsonb := '[]'::jsonb; k text; have int;
begin
  foreach k in array array['google_review','district_review'] loop
    if coalesce((n->>k)::int,0) > 0 then
      select count(*) into have from intel.ci_review_proof r where r.deleted_at is null and r.kind = k
        and ((p_part is not null and r.participation_id = p_part) or (p_inv is not null and r.invite_id = p_inv));
      if have < (n->>k)::int then out := out || jsonb_build_object('kind', k, 'need', (n->>k)::int, 'have', have); end if;
    end if;
  end loop;
  return out;
end $$;

-- creator: my review screenshots for one campaign
create or replace function api.my_review_proofs(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid := intel.ci_resolve_campaign(p_campaign); v_id uuid; v_part uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_id := intel.ci_member_identity(auth.uid());
  select participation_id into v_part from intel.ci_campaign_participation where campaign_id = v_c and identity_id = v_id limit 1;
  return jsonb_build_object('need', intel.ci_review_need(v_c), 'participation_id', v_part,
    'missing', case when v_part is not null then intel.ci_review_missing(v_c, v_part, null) else '[]'::jsonb end,
    'proofs', coalesce((select jsonb_agg(jsonb_build_object('proof_id', r.proof_id, 'kind', r.kind, 'url', r.url, 'by', r.by_role, 'at', r.created_at) order by r.created_at)
                          from intel.ci_review_proof r where r.participation_id = v_part and r.deleted_at is null), '[]'::jsonb));
end $$;

-- creator: add a screenshot (file already uploaded to storage review-proofs/c/<uid>/...)
create or replace function api.submit_review_proof(p_campaign uuid, p_kind text, p_path text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c uuid := intel.ci_resolve_campaign(p_campaign); v_id uuid; v_part uuid; v_pid uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_kind not in ('google_review','district_review') then raise exception 'unknown review type' using errcode = '22023'; end if;
  if p_path is null or p_path not like 'c/' || auth.uid()::text || '/%' then raise exception 'upload the screenshot first' using errcode = '22023'; end if;
  v_id := intel.ci_member_identity(auth.uid());
  select participation_id into v_part from intel.ci_campaign_participation where campaign_id = v_c and identity_id = v_id limit 1;
  if v_part is null then raise exception 'you are not in this campaign' using errcode = '42501'; end if;
  if coalesce((intel.ci_review_need(v_c)->>p_kind)::int, 0) = 0 then raise exception 'this campaign does not ask for that review' using errcode = '22023'; end if;
  insert into intel.ci_review_proof(campaign_id, participation_id, kind, path, url, by_member, by_role)
  values (v_c, v_part, p_kind, p_path, '/storage/v1/object/public/review-proofs/' || p_path, auth.uid(), 'creator') returning proof_id into v_pid;
  return jsonb_build_object('proof_id', v_pid, 'missing', intel.ci_review_missing(v_c, v_part, null));
end $$;

-- team: every creator in the campaign + their review screenshots (for the review page + bulk folder matching)
create or replace function api.campaign_review_proofs(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid := intel.ci_resolve_campaign(p_campaign);
begin
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return jsonb_build_object('need', intel.ci_review_need(v_c), 'campaign_id', v_c, 'creators', coalesce((
    select jsonb_agg(x order by x->>'added') from (
      select jsonb_build_object('key', 'p-' || p.participation_id, 'participation_id', p.participation_id, 'stage', p.stage, 'added', p.created_at,
        'name', coalesce(cc->>'name', sa.username), 'handle', sa.username, 'phone', intel.ci_member_phone(a.member_id),
        'missing', intel.ci_review_missing(v_c, p.participation_id, null),
        'proofs', coalesce((select jsonb_agg(jsonb_build_object('proof_id', r.proof_id, 'kind', r.kind, 'url', r.url, 'by', r.by_role, 'at', r.created_at) order by r.created_at)
                             from intel.ci_review_proof r where r.participation_id = p.participation_id and r.deleted_at is null), '[]'::jsonb)) x
        from intel.ci_campaign_participation p
        left join lateral (select a2.member_id from intel.ci_identity_actor_access a2 where a2.identity_id = p.identity_id and a2.access_role = 'self' and a2.revoked_at is null order by a2.granted_at limit 1) a on true
        left join lateral (select s.username from public.social_accounts s where s.member_id = a.member_id and s.platform = 'instagram' order by s.followers_count desc nulls last limit 1) sa on true
        left join lateral (select intel.ci_public_creator_card(p.identity_id) cc) card on true
       where p.campaign_id = v_c and p.stage not in ('rejected','dropped','ineligible','brand_declined')
      union all
      select jsonb_build_object('key', 'i-' || i.invite_id, 'invite_id', i.invite_id, 'stage', i.status, 'added', i.created_at,
        'name', i.full_name, 'handle', i.handle, 'phone', i.phone_e164,
        'missing', intel.ci_review_missing(v_c, null, i.invite_id),
        'proofs', coalesce((select jsonb_agg(jsonb_build_object('proof_id', r.proof_id, 'kind', r.kind, 'url', r.url, 'by', r.by_role, 'at', r.created_at) order by r.created_at)
                             from intel.ci_review_proof r where r.invite_id = i.invite_id and r.deleted_at is null), '[]'::jsonb))
        from intel.ci_campaign_invite i
       where i.campaign_id = v_c and i.claimed_at is null and coalesce(i.status,'') not in ('declined','removed')
    ) s), '[]'::jsonb));
end $$;

-- team: add screenshots in bulk (files already uploaded to review-proofs/a/<campaign>/...)
create or replace function api.admin_add_review_proofs(p_campaign uuid, p_rows jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c uuid := intel.ci_resolve_campaign(p_campaign); x jsonb; n int := 0; v_part uuid; v_inv uuid;
begin
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    if (x->>'kind') not in ('google_review','district_review') or coalesce(x->>'path','') = '' then continue; end if;
    v_part := nullif(x->>'participation_id','')::uuid; v_inv := nullif(x->>'invite_id','')::uuid;
    if v_part is not null and not exists (select 1 from intel.ci_campaign_participation where participation_id = v_part and campaign_id = v_c) then continue; end if;
    if v_inv is not null and not exists (select 1 from intel.ci_campaign_invite where invite_id = v_inv and campaign_id = v_c) then continue; end if;
    if v_part is null and v_inv is null then continue; end if;
    insert into intel.ci_review_proof(campaign_id, participation_id, invite_id, kind, path, url, by_member, by_role)
    values (v_c, v_part, v_inv, x->>'kind', x->>'path', '/storage/v1/object/public/review-proofs/' || (x->>'path'), auth.uid(), 'team');
    n := n + 1;
  end loop;
  return jsonb_build_object('added', n);
end $$;

create or replace function api.delete_review_proof(p_proof uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c uuid;
begin
  select campaign_id into v_c from intel.ci_review_proof where proof_id = p_proof;
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  update intel.ci_review_proof set deleted_at = now() where proof_id = p_proof;
  return jsonb_build_object('ok', true);
end $$;

-- the campaign waits for the screenshots: a creator is not marked complete while a review screenshot is missing
create or replace function intel.tg_review_gate() returns trigger language plpgsql set search_path = '' as $$
declare miss jsonb;
begin
  if NEW.stage = 'completed' and OLD.stage is distinct from 'completed' and coalesce(current_setting('geek.bulk_force', true), '') <> 'on' then
    miss := intel.ci_review_missing(NEW.campaign_id, NEW.participation_id, null);
    if jsonb_array_length(miss) > 0 then
      if auth.uid() is not null then
        raise exception 'Waiting for the % screenshot — upload it under Review screenshots on the campaign page',
          (select string_agg(case m->>'kind' when 'google_review' then 'Google review' else 'District review' end, ' + ') from jsonb_array_elements(miss) m)
          using errcode = '22023', hint = 'review_missing';
      end if;
      NEW.stage := OLD.stage;  -- automatic moves just wait
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists ci_review_gate on intel.ci_campaign_participation;
create trigger ci_review_gate before update of stage on intel.ci_campaign_participation for each row execute function intel.tg_review_gate();

do $g$ declare f text; begin
  foreach f in array array['api.my_review_proofs(uuid)','api.submit_review_proof(uuid,text,text)','api.campaign_review_proofs(uuid)','api.admin_add_review_proofs(uuid,jsonb)','api.delete_review_proof(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function intel.ci_review_need(uuid) from public, anon, authenticated;
  revoke all on function intel.ci_review_missing(uuid,uuid,uuid) from public, anon, authenticated;
end $g$;
