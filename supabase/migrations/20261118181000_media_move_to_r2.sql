-- Move old Supabase storage links to Cloudflare R2.
-- 1) files copied by the one-off edge function media-migrate (same key "<bucket>/<path>", size checked) — 102 files, 0 failed
-- 2) links rewritten below; every old value is kept in private.media_migration_backup (undo = write old_value back)
-- Supabase files are NOT deleted. Payment proofs stay in the private Supabase bucket.
create or replace function api.media_migrate_items() returns jsonb language sql stable security definer set search_path = '' as $f$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name, 'size', (metadata->>'size')::bigint, 'type', metadata->>'mimetype') order by bucket_id, name), '[]'::jsonb)
    from storage.objects where bucket_id in ('campaign-files','post-thumbs','ig-media','review-proofs') and name not like '%.emptyFolderPlaceholder' $f$;
revoke all on function api.media_migrate_items() from public, anon, authenticated;
grant execute on function api.media_migrate_items() to service_role;

insert into private.media_config(k, v) values ('r2_public_url', 'https://pub-bba86b630e704d509984654de806cdd2.r2.dev')
on conflict (k) do update set v = excluded.v, updated_at = now();

create table if not exists private.media_migration_backup (id bigserial primary key, tbl text not null, pk text not null, col text not null, old_value text not null, at timestamptz not null default now());
revoke all on private.media_migration_backup from public, anon, authenticated;
do $do$ declare base text := 'https://edibibytqfrrxfztukpm.supabase.co/storage/v1/object/public/'; r2 text; b text; begin
  select rtrim(v,'/') || '/' into r2 from private.media_config where k = 'r2_public_url';
  if r2 is null then raise exception 'R2 public URL not set'; end if;
  foreach b in array array['campaign-files','post-thumbs','ig-media'] loop
    insert into private.media_migration_backup(tbl, pk, col, old_value) select 'public.campaigns', id::text, 'cover_url', cover_url from public.campaigns where cover_url like base || b || '/%';
    update public.campaigns set cover_url = replace(cover_url, base || b || '/', r2 || b || '/') where cover_url like base || b || '/%';
    insert into private.media_migration_backup(tbl, pk, col, old_value) select 'public.campaigns', id::text, 'attachments', attachments::text from public.campaigns where attachments::text like '%' || base || b || '/%';
    update public.campaigns set attachments = replace(attachments::text, base || b || '/', r2 || b || '/')::jsonb where attachments::text like '%' || base || b || '/%';
    insert into private.media_migration_backup(tbl, pk, col, old_value) select 'intel.ci_campaign_brief', brief_id::text, 'requirements', requirements::text from intel.ci_campaign_brief where requirements::text like '%' || base || b || '/%';
    update intel.ci_campaign_brief set requirements = replace(requirements::text, base || b || '/', r2 || b || '/')::jsonb where requirements::text like '%' || base || b || '/%';
    insert into private.media_migration_backup(tbl, pk, col, old_value) select 'intel.ci_post_thumb_cache', code, 'url', url from intel.ci_post_thumb_cache where url like base || b || '/%';
    update intel.ci_post_thumb_cache set url = replace(url, base || b || '/', r2 || b || '/') where url like base || b || '/%';
  end loop;
end $do$;
