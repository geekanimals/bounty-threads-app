// Edge Function: fb-connect  (verify_jwt = true — Super Admin only; one connection powers search for everyone)
// "Connect with Facebook" for creator search. Meta's business discovery (look up ANY public Business/Creator
// Instagram profile: followers, bio, posts, likes, comments) only works with a Facebook Login token of a
// Facebook Page that has an Instagram professional account linked — not with an Instagram Login token.
//
//   { action: "url",      redirect_uri, state } → the Facebook consent URL (uses FB_LOGIN_CONFIG_ID when set —
//                                                  Facebook Login for Business — else the permission list)
//   { action: "exchange", code, redirect_uri }  → swaps the code, finds the Page + its Instagram account,
//                                                  stores a never-expiring Page token (service role only), and
//                                                  proves business discovery works with a test lookup
//   { action: "status" }                        → is this account connected, and as which Instagram
// Secrets: FB_APP_ID, FB_APP_SECRET, optional FB_LOGIN_CONFIG_ID, optional FB_GRAPH_VER.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRow, openToken, sealToken, tokenEncryptionOn } from "../_shared/token_crypto.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_ID = (Deno.env.get("FB_APP_ID") || "").trim();
const APP_SECRET = (Deno.env.get("FB_APP_SECRET") || "").trim();
const CONFIG_ID = (Deno.env.get("FB_LOGIN_CONFIG_ID") || "").trim();
const VER = Deno.env.get("FB_GRAPH_VER") || "v23.0";
const GRAPH = `https://graph.facebook.com/${VER}`;
const SCOPES = "instagram_basic,pages_show_list,pages_read_engagement,business_management,instagram_manage_insights";
const err = (j: any) => j?.error?.error_user_msg || j?.error?.message || null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    // one connection for the whole platform, made once by the Super Admin; agencies / brands only connect Instagram
    const { data: isAdmin } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isAdmin) return json({ error: "Only the Geek Super Admin connects Facebook for Instagram search." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "status") {
      const { data: t } = await admin.from("social_tokens").select("meta, updated_at").eq("member_id", user.id).eq("platform", "facebook").maybeSingle();
      return json({ ok: true, connected: !!t, meta: t?.meta ?? null, configured: !!(APP_ID && APP_SECRET) });
    }

    if (action === "disconnect") {
      await admin.from("social_tokens").delete().eq("member_id", user.id).eq("platform", "facebook");
      return json({ ok: true });
    }

    if (!APP_ID || !APP_SECRET) {
      return json({ error: "Facebook isn't set up on the server yet (FB_APP_ID / FB_APP_SECRET). Ask the Super Admin to add them.", not_configured: true });
    }
    const redirect = String(body?.redirect_uri || "");
    if (!/^https:\/\/[^\s]+$/.test(redirect)) return json({ error: "redirect_uri required" }, 400);

    if (action === "url") {
      const p = new URLSearchParams({ client_id: APP_ID, redirect_uri: redirect, response_type: "code", state: String(body?.state || "") });
      if (CONFIG_ID) { p.set("config_id", CONFIG_ID); p.set("override_default_response_type", "true"); }
      else p.set("scope", SCOPES);
      return json({ ok: true, url: `https://www.facebook.com/${VER}/dialog/oauth?${p.toString()}` });
    }

    if (action === "exchange") {
      const code = String(body?.code || "");
      if (!code) return json({ error: "code required" }, 400);
      // 1) code → user token → long-lived user token (60 days); Page tokens made from it never expire
      const t1 = await (await fetch(`${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(redirect)}&code=${encodeURIComponent(code)}`)).json().catch(() => ({}));
      if (!t1?.access_token) return json({ error: `Facebook didn't accept the sign-in: ${err(t1) || "no token"}` });
      const t2 = await (await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${encodeURIComponent(t1.access_token)}`)).json().catch(() => ({}));
      const userToken = t2?.access_token || t1.access_token;
      // 2) the Pages this person manages, with their linked Instagram professional account
      const pages = await (await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count}&limit=100&access_token=${encodeURIComponent(userToken)}`)).json().catch(() => ({}));
      if (!Array.isArray(pages?.data)) return json({ error: `Facebook didn't return your Pages: ${err(pages) || "unknown error"}` });
      const withIg = pages.data.filter((p: any) => p?.instagram_business_account?.id);
      if (!withIg.length) {
        return json({ error: "None of your Facebook Pages has an Instagram professional account linked. In Instagram → Settings → Account type and tools → switch to Professional, then link it to your Facebook Page (Instagram → Edit profile → Page), and connect again — and on Facebook's screen select that Page and its Instagram account.", no_page: true,
                      pages: pages.data.map((p: any) => p.name) });
      }
      const wanted = String(body?.page_id || "");
      const pg = withIg.find((p: any) => p.id === wanted) || withIg[0];
      const ig = pg.instagram_business_account;
      // 3) prove business discovery works (look ourselves up)
      const test = await (await fetch(`${GRAPH}/${ig.id}?fields=business_discovery.username(${encodeURIComponent(ig.username)}){username,followers_count}&access_token=${encodeURIComponent(pg.access_token)}`)).json().catch(() => ({}));
      const discoveryOk = !!test?.business_discovery;
      const meta = { page_id: pg.id, page_name: pg.name, ig_username: ig.username, ig_picture: ig.profile_picture_url ?? null,
                     ig_followers: ig.followers_count ?? null, discovery_ok: discoveryOk, discovery_error: discoveryOk ? null : err(test),
                     pages: withIg.map((p: any) => ({ id: p.id, name: p.name, ig: p.instagram_business_account?.username })) };
      const { error: sErr } = await admin.from("social_tokens").upsert({
        member_id: user.id, platform: "facebook", ig_user_id: ig.id, access_token: await sealToken(pg.access_token), expires_at: null,
        meta, updated_at: new Date().toISOString(),
      }, { onConflict: "member_id,platform" });
      if (sErr) return json({ error: `Couldn't save the connection: ${sErr.message}` });
      return json({ ok: true, ...meta });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("fb-connect error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
