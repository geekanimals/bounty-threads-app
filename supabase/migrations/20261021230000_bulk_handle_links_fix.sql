-- Bulk upload: Instagram profile links written without https:// ("www.instagram.com/asha", "instagram.com/asha")
-- were read as the handle "www.instagram.com" — so every row looked like the same person ("duplicate") and was
-- skipped. Now the domain is stripped with or without https://, www. or m.; a bare domain is never a handle.
create or replace function intel.ci_norm_handle(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p,''));
begin
  v := regexp_replace(v, '^(https?://)?(www\.|m\.)?(instagram\.com|instagr\.am)/', '', 'i');
  v := lower(regexp_replace(split_part(split_part(v, '?', 1), '/', 1), '^@', ''));
  if v !~ '^[a-z0-9._]{1,60}$' or v ~ '\.(com|in|net|org|am)$' or v in ('instagram', 'www', 'reel', 'reels', 'p', 'tv', 'stories') then return null; end if;
  return v;
end $$;
