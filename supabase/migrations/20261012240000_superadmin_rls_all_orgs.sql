-- Super Admin = full power over every workspace's operational data, live, from the normal app pages
-- (Campaigns, Mass Barter, Celebrity Stories, Approvals, Creators, IRM). Postgres RLS policies are permissive
-- (OR-ed), so these ADD access for platform admins only; every other user keeps strict org scoping.
do $$ declare t text; begin
  foreach t in array array['campaigns','barter_items','story_deals','applications','creators','irm_contacts','dream_plans'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists "platform admin all %s" on public.%I', t, t);
      execute format('create policy "platform admin all %s" on public.%I for all to authenticated
                        using (public.is_platform_admin()) with check (public.is_platform_admin())', t, t);
    end if;
  end loop;
end $$;
