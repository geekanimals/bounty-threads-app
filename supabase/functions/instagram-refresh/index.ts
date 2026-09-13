// Edge Function: instagram-refresh  (verify_jwt = false)
// Keeps Instagram long-lived tokens alive (they expire in ~60 days) and re-syncs the media kit.
// Two modes:
//   • Signed-in user (JWT present): refreshes just THAT creator's token. The client calls this
//     lazily when their media kit data is stale (>7 days).
//   • Cron (header x-cron-secret == CRON_SECRET): refreshes ALL tokens expiring within 12 days.
//     Wire this to a daily pg_cron job to cover creators who don't log in.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fetchProfileBundle } from "../_shared/ig.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const GRAPH = "https://graph.instagram.com";

// deno-lint-ignore no-explicit-any
async function refreshOne(admin: any, tok: any) {
  const r = await (await fetch(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${tok.access_token}`)).json();
  const newToken = r.access_token || tok.access_token;
  const expiresAt = new Date(Date.now() + (Number(r.expires_in) || 5184000) * 1000).toISOString();
  await admin.from("social_tokens")
    .update({ access_token: newToken, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("member_id", tok.member_id).eq("platform", "instagram");

  // Re-sync the media kit with the refreshed token (best-effort).
  try {
    const { profile, media, avgReach, audience, mentions } = await fetchProfileBundle(newToken, tok.ig_user_id);
    await admin.from("social_accounts").update({
      username: profile.username ?? null, name: profile.name ?? null, account_type: profile.account_type ?? null,
      followers_count: profile.followers_count ?? 0, follows_count: profile.follows_count ?? 0, media_count: profile.media_count ?? 0,
      profile_picture_url: profile.profile_picture_url ?? null, biography: profile.biography ?? null, website: profile.website ?? null,
      recent_media: media ?? [], avg_reach: avgReach, audience, mentions, updated_at: new Date().toISOString(),
    }).eq("member_id", tok.member_id).eq("platform", "instagram");
  } catch (_e) { /* profile resync optional */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // --- Cron mode: refresh everything expiring soon ---
    const cronHeader = req.headers.get("x-cron-secret") || "";
    if (CRON_SECRET && cronHeader === CRON_SECRET) {
      const cutoff = new Date(Date.now() + 12 * 86400 * 1000).toISOString();
      const { data } = await admin.from("social_tokens").select("*").eq("platform", "instagram").lt("expires_at", cutoff);
      let count = 0;
      for (const tok of (data || [])) { try { await refreshOne(admin, tok); count++; } catch (_e) { /* skip one */ } }
      return json({ ok: true, refreshed: count });
    }

    // --- User mode: refresh just the caller's token ---
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const { data: tok } = await admin.from("social_tokens").select("*").eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    if (!tok) return json({ ok: true, skipped: "not connected" });
    await refreshOne(admin, tok);
    return json({ ok: true, refreshed: 1 });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
