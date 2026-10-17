-- A creator can disconnect ANY of their Instagram accounts — including the one that's open right now.
--   • not the open one  → it's removed from their list
--   • the open one      → Geek OS switches to their next connected account first, then removes it
--   • their only one    → the Instagram connection is removed (they're asked to connect one again to use the Media Kit)
-- Campaign history keeps the handle they applied with. ADDITIVE.
create or replace function public.ig_disconnect_account(p_ig_user_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); a public.social_accounts%rowtype; v_next text; v_next_user text; v_gone text;
begin
  if v_uid is null then raise exception 'Please sign in again.' using errcode = '28000'; end if;
  select * into a from public.social_accounts where member_id = v_uid and platform = 'instagram';

  -- not the open account → just drop it
  if a.member_id is null or a.ig_user_id is distinct from p_ig_user_id then
    select coalesce(l.username, l.account->>'username') into v_gone from private.ig_linked_accounts l where l.member_id = v_uid and l.ig_user_id = p_ig_user_id;
    delete from private.ig_linked_accounts where member_id = v_uid and ig_user_id = p_ig_user_id;
    if not found then raise exception 'That Instagram account is not connected to your login.' using errcode = '22023'; end if;
    return jsonb_build_object('ok', true, 'removed', v_gone, 'active', a.username);
  end if;

  v_gone := a.username;
  -- the open account → move to the next one that still has a valid login
  select l.ig_user_id, coalesce(l.username, l.account->>'username') into v_next, v_next_user
    from private.ig_linked_accounts l
   where l.member_id = v_uid and l.ig_user_id is distinct from p_ig_user_id
     and coalesce((l.token->>'expires_at')::timestamptz > now(), false)
   order by l.updated_at desc limit 1;
  if v_next is not null then
    perform public.ig_switch_account(v_next);
    delete from private.ig_linked_accounts where member_id = v_uid and ig_user_id = p_ig_user_id;
    return jsonb_build_object('ok', true, 'removed', v_gone, 'active', v_next_user, 'switched', true);
  end if;

  -- their only (working) account → remove the Instagram connection completely
  delete from public.social_tokens where member_id = v_uid and platform = 'instagram';
  delete from public.social_accounts where member_id = v_uid and platform = 'instagram';
  delete from private.ig_linked_accounts where member_id = v_uid and ig_user_id = p_ig_user_id;
  return jsonb_build_object('ok', true, 'removed', v_gone, 'active', null, 'none_left', true);
end $$;
revoke all on function public.ig_disconnect_account(text) from public, anon;
grant execute on function public.ig_disconnect_account(text) to authenticated;
