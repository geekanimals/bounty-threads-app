-- Opted out list: also show people who switched off update emails from their own settings
-- (members.email_opt_out_at), not only those who clicked the unsubscribe link (public.email_optout).
-- "Turn back on" clears both. ADDITIVE (patches two functions in place).
do $m$
declare d text; n text;
begin
  select pg_get_functiondef('public.admin_optouts()'::regprocedure) into d;
  n := replace(d, 'from public.email_optout e',
   $r$from (select o.email, o.opt_out_at, coalesce(o.via, 'link') via from public.email_optout o
            union all
            select coalesce(case when m.email !~* '@creators\.bountythreads\.app$' then private.email_key(m.email) end, private.email_key(u.email::text)),
                   m.email_opt_out_at, 'settings'
              from public.members m join auth.users u on u.id = m.id
             where m.email_opt_out_at is not null
               and not exists (select 1 from public.email_optout o2
                                where o2.email in (private.email_key(u.email::text), private.email_key(m.email)))) e$r$);
  n := replace(n, $q$'via', 'Clicked unsubscribe in an email'$q$,
                  $q$'via', case when e.via = 'settings' then 'Turned off update emails in their settings' else 'Clicked unsubscribe in an email' end$q$);
  n := replace(n, $q$where private.email_key(u.email::text) = e.email limit 1) mb on true$q$,
                  $q$where private.email_key(u.email::text) = e.email or private.email_key(m.email) = e.email limit 1) mb on true$q$);
  if n = d or position('Turned off update emails' in n) = 0 then raise exception 'admin_optouts: text not found'; end if;
  execute n;

  select pg_get_functiondef('public.admin_optout_clear(text,text)'::regprocedure) into d;
  n := replace(d, $q$where u.id = m.id and private.email_key(u.email::text) = private.email_key(p_to);$q$,
                  $q$where u.id = m.id and (private.email_key(u.email::text) = private.email_key(p_to) or private.email_key(m.email) = private.email_key(p_to));$q$);
  if n = d then raise exception 'admin_optout_clear: text not found'; end if;
  execute n;
end $m$;
