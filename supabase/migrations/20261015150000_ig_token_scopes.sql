-- Remember which Instagram permissions the creator granted at connect time, so the DM inbox can tell
-- "reconnect to allow messages" apart from "turn on Allow access to messages" and "Meta app access". ADDITIVE.
alter table public.social_tokens add column if not exists scopes text[];
alter table public.social_tokens add column if not exists connected_at timestamptz;
