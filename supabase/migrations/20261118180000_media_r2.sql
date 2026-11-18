-- Uploads move to Cloudflare R2 (edge function media-upload). Old Supabase files keep working.
-- private.media_url(path, bucket): R2 keys ("campaign-files/…", "review-proofs/…") → the R2 public address; old paths → Supabase storage.
create table if not exists private.media_config (k text primary key, v text not null, updated_at timestamptz not null default now());
revoke all on private.media_config from public, anon, authenticated;
create or replace function private.media_url(p_path text, p_bucket text) returns text language sql stable security definer set search_path = '' as $f$
  select case
    when p_path ~ '^(campaign-files|review-proofs|post-media|ig-media|post-thumbs)/' and (select v from private.media_config where k = 'r2_public_url') is not null
      then (select rtrim(v, '/') from private.media_config where k = 'r2_public_url') || '/' || p_path
    else '/storage/v1/object/public/' || p_bucket || '/' || p_path end $f$;

do $do$ declare src text; begin
  select pg_get_functiondef('api.submit_review_proof(uuid,text,text)'::regprocedure) into src;
  src := replace(src, $x$if p_path is null or p_path not like 'c/' || auth.uid()::text || '/%' then$x$,
                      $x$if p_path is null or not (p_path like 'c/' || auth.uid()::text || '/%' or p_path like 'review-proofs/c/' || auth.uid()::text || '/%') then$x$);
  src := replace(src, $x$'/storage/v1/object/public/review-proofs/' || p_path$x$, $x$private.media_url(p_path, 'review-proofs')$x$);
  execute src;
  select pg_get_functiondef('api.admin_add_review_proofs(uuid,jsonb)'::regprocedure) into src;
  src := replace(src, $x$'/storage/v1/object/public/review-proofs/' || (x->>'path')$x$, $x$private.media_url(x->>'path', 'review-proofs')$x$);
  execute src;
end $do$;
