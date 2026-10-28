// Edge Function: brand-fb-login  (verify_jwt = false — "login" has no session yet; "link" / "refresh" / "unlink" check the caller's token)
// Brand logins sign in with Facebook Login for Business, and their dashboard shows their Facebook business:
// Business Manager accounts, Pages + linked Instagram, ad accounts and Page reach.
//
//   { action: "url",     redirect_uri, state } → Facebook's consent URL (FB_BRAND_CONFIG_ID = a Facebook Login for
//                                                Business configuration, else FB_LOGIN_CONFIG_ID, else the scope list)
//   { action: "login",   code, redirect_uri }  → finds the brand login linked to this Facebook account (or with the same
//                                                email) and returns a one-time token_hash the browser turns into a session
//   { action: "link",    code, redirect_uri }  → (signed-in brand login) links this Facebook account to it
//   { action: "refresh" }                       → (signed-in) re-reads the business / Pages / ad accounts snapshot
//   { action: "unlink" }                        → (signed-in) removes the link
// The Facebook token is stored sealed (TOKEN_ENC_KEY) in public.social_tokens, platform "facebook_brand"; the browser never sees it.
// Secrets: FB_APP_ID, FB_APP_SECRET, optional FB_BRAND_CONFIG_ID, FB_BRAND_SCOPES, FB_GRAPH_VER.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openToken, sealToken } from "../_shared/token_crypto.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_ID = (Deno.env.get("FB_APP_ID") || "").trim();
const APP_SECRET = (Deno.env.get("FB_APP_SECRET") || "").trim();
const CONFIG_ID = (Deno.env.get("FB_BRAND_CONFIG_ID") || Deno.env.get("FB_LOGIN_CONFIG_ID") || "").trim();
const VER = Deno.env.get("FB_GRAPH_VER") || "v23.0";
const GRAPH = `https://graph.facebook.com/${VER}`;
// who they are, their Business Manager, Pages (+ Instagram), Page insights and ad accounts — plus managing Page posts /
// comments and pausing / resuming ad campaigns from the brand's 📘 Facebook page (brand-facebook)
const SCOPES = (Deno.env.get("FB_BRAND_SCOPES") ||
  "public_profile,email,business_management,pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_posts,pages_manage_engagement,read_insights,ads_read,ads_management").trim();
const PLATFORM = "facebook_brand";
const gerr = (j: any) => j?.error?.error_user_msg || j?.error?.message || null;
const get = async (path: string, token: string) => {
  const sep = path.includes("?") ? "&" : "?";
  return await (await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`)).json().catch(() => ({}));
};

// everything the brand dashboard shows about their Facebook business (each part is optional — a missing permission just leaves it out)
async function snapshot(token: string) {
  const me = await get("me?fields=id,name,email", token);
  if (!me?.id) throw new Error(`Facebook didn't return your account: ${gerr(me) || "unknown error"}`);
  const biz = await get("me/businesses?fields=id,name,verification_status&limit=25", token);
  const pg = await get("me/accounts?fields=id,name,fan_count,followers_count,access_token,instagram_business_account{id,username,followers_count,media_count,profile_picture_url}&limit=25", token);
  const ads = await get("me/adaccounts?fields=id,name,account_status,currency,amount_spent&limit=25", token);
  const pages = [];
  for (const p of (Array.isArray(pg?.data) ? pg.data : []).slice(0, 10)) {
    let reach28: number | null = null, engaged28: number | null = null;
    if (p.access_token) {
      const ins = await get(`${p.id}/insights?metric=page_impressions_unique,page_post_engagements&period=days_28`, p.access_token);
      for (const m of (Array.isArray(ins?.data) ? ins.data : [])) {
        const v = m?.values?.[m.values.length - 1]?.value;
        if (m.name === "page_impressions_unique" && typeof v === "number") reach28 = v;
        if (m.name === "page_post_engagements" && typeof v === "number") engaged28 = v;
      }
    }
    const ig = p.instagram_business_account;
    pages.push({ id: p.id, name: p.name, fans: p.fan_count ?? null, followers: p.followers_count ?? null, reach_28d: reach28, engaged_28d: engaged28,
                 instagram: ig ? { username: ig.username, followers: ig.followers_count ?? null, posts: ig.media_count ?? null, picture: ig.profile_picture_url ?? null } : null });
  }
  return {
    fb_user_id: String(me.id), fb_name: me.name ?? null, fb_email: me.email ?? null,
    businesses: (Array.isArray(biz?.data) ? biz.data : []).map((b: any) => ({ id: b.id, name: b.name, verified: b.verification_status ?? null })),
    pages,
    ad_accounts: (Array.isArray(ads?.data) ? ads.data : []).map((a: any) => ({ id: a.id, name: a.name, status: a.account_status ?? null, currency: a.currency ?? null,
                   spent: a.amount_spent != null ? Number(a.amount_spent) / 100 : null })),
    refreshed_at: new Date().toISOString(),
  };
}

async function exchange(code: string, redirect: string) {
  const t1 = await (await fetch(`${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(redirect)}&code=${encodeURIComponent(code)}`)).json().catch(() => ({}));
  if (!t1?.access_token) throw new Error(`Facebook didn't accept the sign-in: ${gerr(t1) || "no token"}`);
  const t2 = await (await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${encodeURIComponent(t1.access_token)}`)).json().catch(() => ({}));
  return { token: String(t2?.access_token || t1.access_token), expires: t2?.expires_in ? new Date(Date.now() + Number(t2.expires_in) * 1000).toISOString() : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (!APP_ID || !APP_SECRET) return json({ error: "Facebook sign-in isn't set up on the server yet (FB_APP_ID / FB_APP_SECRET).", not_configured: true });

    // the signed-in brand login, for link / refresh / unlink
    const caller = async () => {
      const auth = req.headers.get("Authorization") || "";
      if (!auth || auth.endsWith(ANON_KEY)) return null;
      const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await uc.auth.getUser();
      if (!user) return null;
      const { data: ok } = await admin.schema("api").rpc("ops_is_brand_login", { p_member: user.id });
      return ok ? user : null;
    };
    const save = async (member: string, token: string, expires: string | null, meta: Record<string, unknown>) => {
      const { error } = await admin.from("social_tokens").upsert({
        member_id: member, platform: PLATFORM, ig_user_id: null, access_token: await sealToken(token), expires_at: expires,
        scopes: SCOPES, meta, updated_at: new Date().toISOString(), connected_at: new Date().toISOString(),
      }, { onConflict: "member_id,platform" });
      if (error) throw new Error(`Couldn't save the Facebook link: ${error.message}`);
    };
    const publicMeta = (m: any) => { const { fb_user_id: _x, ...rest } = m || {}; return rest; };

    if (action === "refresh" || action === "unlink") {
      const user = await caller();
      if (!user) return json({ error: "Sign in with your brand login first." }, 401);
      if (action === "unlink") {
        await admin.from("social_tokens").delete().eq("member_id", user.id).eq("platform", PLATFORM);
        return json({ ok: true });
      }
      const { data: row } = await admin.from("social_tokens").select("access_token, expires_at").eq("member_id", user.id).eq("platform", PLATFORM).maybeSingle();
      const token = await openToken(row?.access_token);
      if (!token) return json({ error: "Facebook isn't linked yet.", not_linked: true });
      const meta = await snapshot(token);
      await save(user.id, token, row?.expires_at ?? null, meta);
      return json({ ok: true, facebook: publicMeta(meta) });
    }

    const redirect = String(body?.redirect_uri || "");
    if (!/^https:\/\/[^\s]+$/.test(redirect)) return json({ error: "redirect_uri required" }, 400);

    if (action === "url") {
      const p = new URLSearchParams({ client_id: APP_ID, redirect_uri: redirect, response_type: "code", state: String(body?.state || "") });
      if (CONFIG_ID) { p.set("config_id", CONFIG_ID); p.set("override_default_response_type", "true"); }
      else p.set("scope", SCOPES);
      return json({ ok: true, url: `https://www.facebook.com/${VER}/dialog/oauth?${p.toString()}` });
    }

    const code = String(body?.code || "");
    if (!code) return json({ error: "code required" }, 400);

    if (action === "link") {
      const user = await caller();
      if (!user) return json({ error: "Sign in with your brand login first, then link Facebook." }, 401);
      const t = await exchange(code, redirect);
      const meta = await snapshot(t.token);
      const { data: other } = await admin.from("social_tokens").select("member_id").eq("platform", PLATFORM).eq("meta->>fb_user_id", meta.fb_user_id).neq("member_id", user.id).maybeSingle();
      if (other) return json({ error: "This Facebook account is already linked to another brand login." });
      await save(user.id, t.token, t.expires, meta);
      return json({ ok: true, facebook: publicMeta(meta) });
    }

    if (action === "login") {
      const t = await exchange(code, redirect);
      const meta = await snapshot(t.token);
      const { data: hit } = await admin.schema("api").rpc("ops_brand_fb_find", { p_fb_user: meta.fb_user_id, p_email: meta.fb_email });
      const memberId = (hit as any)?.member_id, email = (hit as any)?.email;
      if (!memberId || !email) {
        return json({ error: "This Facebook account isn't linked to a brand login yet. Sign in once with the email & password the Geek team sent you, then go to Settings → Link Facebook. After that, Continue with Facebook works.", not_linked: true });
      }
      await save(memberId, t.token, t.expires, meta);
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
      const token_hash = (link as any)?.data?.properties?.hashed_token ?? null;
      if (!token_hash) throw new Error("could not start the session");
      return json({ ok: true, token_hash });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("brand-fb-login", (e as Error).message);
    return json({ error: (e as Error).message || "Something went wrong. Please try again." }, 500);
  }
});
