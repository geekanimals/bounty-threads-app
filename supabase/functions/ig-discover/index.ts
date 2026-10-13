// Edge Function: ig-discover  (verify_jwt = true — an approved agency, brand or Super Admin only)
// Pulls public Instagram data for creators who are NOT on Geek OS yet, using the caller's own connected
// Instagram account, and files them in the discovery pool.
//
//   { action: "lookup",  username }   → one public profile (followers, posts, bio, recent posts)
//   { action: "tagged" }              → the accounts that tagged / mentioned this Instagram, filed as candidates
//
// Honest about Meta's limits: public lookup of an arbitrary handle is the Facebook Graph "business discovery"
// edge, which needs a Facebook Page linked to the Instagram account plus App Review. When that isn't granted
// the call answers { error, needs_permission: true } and the app still adds the handle (without the numbers),
// so discovery and invites keep working. Hashtag → username is not offered by Meta at all, so we never pretend
// to: hashtags are matched from the captions the handle was actually found in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IG_GRAPH = "https://graph.instagram.com/v23.0";
const FB_GRAPH = "https://graph.facebook.com/v23.0";

const needsPermission = (j: any) =>
  [10, 100, 110, 200, 230, 3].includes(Number(j?.error?.code)) ||
  /permission|not authorized|capability|business_discovery|does not exist/i.test(String(j?.error?.message || ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: member } = await admin.from("members").select("role, status, org_id").eq("id", user.id).maybeSingle();
    const { data: isAdmin } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    const allowed = !!isAdmin || (member && ["owner", "brand", "manager", "corporate"].includes(member.role) && (member.status ?? "active") === "active");
    if (!allowed) return json({ error: "Discovery is for approved agencies, brands and the Super Admin." }, 403);

    const { data: tok } = await admin.from("social_tokens").select("access_token, ig_user_id, expires_at")
      .eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    if (!tok?.access_token) return json({ error: "Connect your Instagram first — then we can read it for you.", needs_connect: true }, 400);
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) return json({ error: "Instagram token expired — reconnect Instagram." }, 400);
    const T = encodeURIComponent(tok.access_token as string);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "lookup") {
      const username = String(body?.username || "").trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9._]{2,30}$/.test(username)) return json({ error: "Enter a valid Instagram username." }, 400);
      const igId = String(tok.ig_user_id || "");
      if (!igId) return json({ error: "Your Instagram connection is missing its account id — reconnect Instagram." }, 400);

      const fields = `business_discovery.username(${encodeURIComponent(username)}){username,name,biography,followers_count,media_count,profile_picture_url,media.limit(6){caption,permalink,like_count,comments_count,media_type}}`;
      const r = await fetch(`${FB_GRAPH}/${encodeURIComponent(igId)}?fields=${fields}&access_token=${T}`);
      const j = await r.json().catch(() => ({}));
      const bd = j?.business_discovery;
      if (!r.ok || !bd) {
        const msg = needsPermission(j)
          ? "Instagram only returns another account's public numbers once Meta approves business discovery for this app (and the account must be a Business/Creator account)."
          : (j?.error?.message || "Instagram couldn't return that profile.");
        return json({ error: msg, needs_permission: needsPermission(j) }, 200);
      }
      const caption = (bd?.media?.data ?? []).map((m: any) => m?.caption || "").join(" ").slice(0, 1500);
      const profile = {
        handle: bd.username || username, name: bd.name ?? null, bio: (bd.biography ?? "").slice(0, 300),
        followers: bd.followers_count ?? null, media_count: bd.media_count ?? null,
        profile_picture_url: bd.profile_picture_url ?? null,
        permalink: bd?.media?.data?.[0]?.permalink ?? null, caption, source: "manual",
      };
      await admin.schema("api").rpc("save_external_candidates", { p_items: [profile] }).then(() => {}, () => {});
      return json({ ok: true, profile });
    }

    if (action === "tagged") {
      const igId = String(tok.ig_user_id || "me");
      const r = await fetch(`${IG_GRAPH}/${encodeURIComponent(igId)}/tags?fields=id,username,caption,permalink,media_type,timestamp&limit=50&access_token=${T}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: j?.error?.message || "Instagram couldn't return the accounts that tagged you.", needs_permission: needsPermission(j) }, 200);
      const items = (j?.data ?? [])
        .filter((m: any) => m?.username)
        .map((m: any) => ({ handle: String(m.username).toLowerCase(), caption: String(m.caption || "").slice(0, 500), permalink: m.permalink ?? null, source: "tagged_brand" }));
      let saved = 0;
      if (items.length) {
        const { data } = await admin.schema("api").rpc("save_external_candidates", { p_items: items });
        saved = Number(data) || 0;
      }
      return json({ ok: true, found: items.length, saved });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("ig-discover error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
