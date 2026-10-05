// Edge Function: instagram-auth
// Exchanges the ?code from Instagram Login for a long-lived token (server-side,
// using the App Secret), fetches the creator's profile + recent media, and stores
// them. The access token is written to `social_tokens` (service-role only) and NEVER
// returned to the browser. The public profile goes to `social_accounts`.
//
// Secrets required (set with: supabase secrets set ...):
//   INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fetchProfileBundle } from "../_shared/ig.ts";

const IG_APP_ID = Deno.env.get("INSTAGRAM_APP_ID")!;
const IG_APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GRAPH = "https://graph.instagram.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // --- Identify the signed-in caller from their Supabase JWT ---
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Not authenticated" }, 401);

    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) return json({ error: "Missing code or redirect_uri" }, 400);

    // --- 1) authorization code -> short-lived token ---
    const form = new FormData();
    form.append("client_id", IG_APP_ID);
    form.append("client_secret", IG_APP_SECRET);
    form.append("grant_type", "authorization_code");
    form.append("redirect_uri", redirect_uri);
    form.append("code", code);
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: form,
    });
    const shortData = await shortRes.json();
    if (!shortRes.ok || !shortData.access_token) {
      return json({ error: "Token exchange failed", detail: shortData }, 400);
    }
    const igUserId = String(shortData.user_id);

    // --- 2) short-lived -> long-lived token (~60 days) ---
    const longRes = await fetch(
      `${GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${shortData.access_token}`,
    );
    const longData = await longRes.json();
    const accessToken = longData.access_token || shortData.access_token;
    const expiresIn = Number(longData.expires_in) || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // --- 3) fetch profile + media + insights (avg reach, audience, mentions) ---
    const { profile, media, avgReach, audience, mentions } = await fetchProfileBundle(accessToken, igUserId);

    // --- 4) persist (service role) ---
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: member } = await admin
      .from("members").select("org_id").eq("id", user.id).maybeSingle();

    // One Instagram account maps to one login. Reject a second login that claims it.
    const { data: linked, error: lErr } = await admin
      .from("social_accounts").select("member_id")
      .eq("ig_user_id", igUserId).eq("platform", "instagram").neq("member_id", user.id).limit(1);
    if (lErr) return json({ error: "Could not check existing connections", detail: lErr.message }, 500);
    if (linked?.length) return json({ error: "This Instagram account is already connected to another login." }, 409);

    const accountRow = {
      org_id: member?.org_id ?? null,
      member_id: user.id,
      platform: "instagram",
      ig_user_id: igUserId,
      username: profile.username ?? null,
      name: profile.name ?? null,
      account_type: profile.account_type ?? null,
      followers_count: profile.followers_count ?? 0,
      follows_count: profile.follows_count ?? 0,
      media_count: profile.media_count ?? 0,
      profile_picture_url: profile.profile_picture_url ?? null,
      biography: profile.biography ?? null,
      website: profile.website ?? null,
      recent_media: media ?? [],
      avg_reach: avgReach,
      audience: audience,
      mentions: mentions,
      updated_at: new Date().toISOString(),
    };

    const { error: aErr } = await admin
      .from("social_accounts").upsert(accountRow, { onConflict: "member_id,platform" });
    if (aErr) return json({ error: "Could not save profile", detail: aErr.message }, 500);

    await admin.from("social_tokens").upsert({
      member_id: user.id,
      platform: "instagram",
      ig_user_id: igUserId,
      access_token: accessToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "member_id,platform" });

    // Never return the token to the browser.
    return json({ ok: true, profile: accountRow });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
