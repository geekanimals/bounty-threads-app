-- 📘📸 Brand Facebook + Instagram pages. ADDITIVE.
-- The brand-facebook function asks who is calling: a brand login's access (owner / approver / viewer / removed), null otherwise.
create or replace function api.ops_brand_member_role(p_member uuid)
returns text language sql stable security definer set search_path = '' as $$ select intel.ci_brand_role(p_member) $$;
revoke all on function api.ops_brand_member_role(uuid) from public, anon, authenticated;
grant execute on function api.ops_brand_member_role(uuid) to service_role;
