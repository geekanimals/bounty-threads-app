-- intel.ci_find_creator (used for every bulk invite row in api.campaign_people / creators page)
-- scanned whole tables on handle / phone / email → the Creators tab timed out (~20 s) once invites had real numbers.
-- Indexes for exactly the lookups it does.
create index if not exists social_accounts_ig_lower_username_idx on public.social_accounts (lower(username)) where platform = 'instagram';
create index if not exists members_whatsapp_e164_idx on public.members (whatsapp_e164);
create index if not exists ig_linked_accounts_lower_username_idx on private.ig_linked_accounts (lower(coalesce(username, account->>'username')));
create index if not exists creator_contact_lower_email_idx on private.creator_contact (lower(email));
create index if not exists creator_contact_whatsapp_e164_idx on private.creator_contact (whatsapp_e164);
do $$ begin
  create index if not exists users_lower_email_idx on auth.users (lower(email));
exception when insufficient_privilege then null; end $$;
analyze public.social_accounts; analyze public.members; analyze private.ig_linked_accounts; analyze private.creator_contact;

-- api.campaign_people per invite row: followers from the discovery pool + last bulk WhatsApp
create index if not exists ci_external_creator_lower_handle_idx on intel.ci_external_creator (lower(handle), last_seen_at desc nulls last);
create index if not exists ci_outbox_dedupe_pattern_idx on intel.ci_outbox (dedupe_key text_pattern_ops) where channel = 'whatsapp';
analyze intel.ci_external_creator; analyze intel.ci_outbox;
