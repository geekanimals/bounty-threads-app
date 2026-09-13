// Edge Function: instagram-login  (verify_jwt = false — called by signed-OUT users)
// "Sign in with Instagram": exchanges the ?code, finds-or-creates a Supabase user for
// that Instagram account (role=creator, own org), stores the profile + token, then
// returns a one-time token_hash the client verifies to establish a real session.
//
// Secrets: INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET (+ auto SUPABASE_URL / SERVICE_ROLE_KEY)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fetchProfileBundle } from "../_shared/ig.ts";

const IG_APP_ID = Deno.env.get("INSTAGRAM_APP_ID")!;
const IG_APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) return json({ error: "Missing code or redirect_uri" }, 400);

    // 1) code -> short-lived token
    const form = new FormData();
    form.append("client_id", IG_APP_ID);
    form.append("client_secret", IG_APP_SECRET);
    form.append("grant_type", "authorization_code");
    form.append("redirect_uri", redirect_uri);
    form.append("code", code);
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
    const shortData = await shortRes.json();
    if (!shortRes.ok || !shortData.access_token) return json({ error: "Token exchange failed", detail: shortData }, 400);
    const igUserId = String(shortData.user_id);

    // 2) long-lived token
    const longRes = await fetch(`${GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${shortData.access_token}`);
    const longData = await longRes.json();
    const accessToken = longData.access_token || shortData.access_token;
    const expiresAt = new Date(Date.now() + (Number(longData.expires_in) || 3600) * 1000).toISOString();

    // 3) profile + media + insights (avg reach, audience, mentions)
    const { profile, media, avgReach, audience, mentions } = await fetchProfileBundle(accessToken, igUserId);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 4) find-or-create the Supabase user for this Instagram account
    const email = `ig_${igUserId}@creators.bountythreads.app`;
    let userId: string | null = null;
    let userEmail = email;
    const { data: existing } = await admin
      .from("social_accounts").select("member_id").eq("ig_user_id", igUserId).eq("platform", "instagram").maybeSingle();

    if (existing?.member_id) {
      userId = existing.member_id;
      const { data: u } = await admin.auth.admin.getUserById(userId);
      userEmail = u?.user?.email || email;
    } else {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: profile.name || profile.username || "Creator",
          org_name: profile.username ? `@${profile.username}` : "My Creator Space",
          role: "creator",
        },
      });
      if (cErr || !created?.user) return json({ error: "Could not create account", detail: cErr?.message }, 500);
      userId = created.user.id;
      userEmail = email;
    }

    // 5) store profile + token (the handle_new_user trigger already made the members row/org)
    const { data: member } = await admin.from("members").select("org_id").eq("id", userId).maybeSingle();
    await admin.from("social_accounts").upsert({
      org_id: member?.org_id ?? null, member_id: userId, platform: "instagram",
      ig_user_id: igUserId, username: profile.username ?? null, name: profile.name ?? null,
      account_type: profile.account_type ?? null, followers_count: profile.followers_count ?? 0,
      follows_count: profile.follows_count ?? 0, media_count: profile.media_count ?? 0,
      profile_picture_url: profile.profile_picture_url ?? null, biography: profile.biography ?? null,
      website: profile.website ?? null, recent_media: media ?? [],
      avg_reach: avgReach, audience: audience, mentions: mentions,
      updated_at: new Date().toISOString(),
    }, { onConflict: "member_id,platform" });
    await admin.from("social_tokens").upsert({
      member_id: userId, platform: "instagram", ig_user_id: igUserId,
      access_token: accessToken, expires_at: expiresAt, updated_at: new Date().toISOString(),
    }, { onConflict: "member_id,platform" });

    // 6) mint a one-time token the client verifies to get a session
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: userEmail });
    if (lErr || !link?.properties?.hashed_token) return json({ error: "Could not create session", detail: lErr?.message }, 500);

    return json({ ok: true, email: userEmail, token_hash: link.properties.hashed_token });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
