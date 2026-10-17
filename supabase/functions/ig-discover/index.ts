// Edge Function: ig-discover  (verify_jwt = true — an approved agency, brand or Super Admin only)
// Pulls public Instagram data for creators who are NOT on Geek OS yet, using the caller's own connected
// Instagram account, and files them in the discovery pool.
//
//   { action: "lookup",  username }   → one public profile (followers, posts, bio, recent posts)
//   { action: "tagged" }              → the accounts that tagged / mentioned this Instagram, filed as candidates
//   { action: "hashtag", tag, edge }  → top (or recent) public posts for a #hashtag (Instagram Public Content Access);
//                                        the @accounts mentioned in those captions are filed as candidates
//
// Honest about Meta's limits: public lookup of an arbitrary handle is the Facebook Graph "business discovery"
// edge, which needs a Facebook Page linked to the Instagram account plus App Review. When that isn't granted
// the call answers { error, needs_permission: true } and the app still adds the handle (without the numbers),
// so discovery and invites keep working. Hashtag → username is not offered by Meta at all, so we never pretend
// to: hashtags are matched from the captions the handle was actually found in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRow, openToken, sealToken, tokenEncryptionOn } from "../_shared/token_crypto.ts";
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

    const { data: tokRaw } = await admin.from("social_tokens").select("access_token, ig_user_id, expires_at")
      .eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    const tok = await openRow(tokRaw);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (action === "tagged") {
      if (!tok?.access_token) return json({ error: "Connect your Instagram first — then we can read it for you.", needs_connect: true }, 400);
      if (tok.expires_at && new Date(tok.expires_at) < new Date()) return json({ error: "Instagram token expired — reconnect Instagram." }, 400);
    }
    const T = encodeURIComponent(String(tok?.access_token || ""));

    if (action === "lookup") {
      const username = String(body?.username || "").trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9._]{2,30}$/.test(username)) return json({ error: "Enter a valid Instagram username." }, 400);
      // business discovery needs a Facebook-Login Page token: this account's own ("Connect with Facebook"),
      // else the platform's shared one (Super Admin / any connected workspace)
      const { data: fbtRaw } = await admin.from("social_tokens").select("access_token, ig_user_id")
        .eq("member_id", user.id).eq("platform", "facebook").maybeSingle();
      const fbt = await openRow(fbtRaw);
      let src = fbt?.access_token ? fbt : null;
      if (!src) { const { data: shared } = await admin.schema("api").rpc("ops_discovery_token"); if (shared?.platform === "facebook") src = await openRow(shared); }
      if (!src?.access_token || !src?.ig_user_id) {
        await admin.schema("api").rpc("save_external_candidates", { p_items: [{ handle: username, source: "manual" }] }).then(() => {}, () => {});
        return json({ error: `@${username} is added. Live Instagram numbers switch on once the Geek Super Admin turns on Instagram search (one-time).`, needs_facebook: true, added: true }, 200);
      }
      const igId = String(src.ig_user_id);
      const FT = encodeURIComponent(String(src.access_token));

      const fields = `business_discovery.username(${encodeURIComponent(username)}){username,name,biography,followers_count,media_count,profile_picture_url,media.limit(12){caption,permalink,like_count,comments_count,media_type}}`;
      const r = await fetch(`${FB_GRAPH}/${encodeURIComponent(igId)}?fields=${fields}&access_token=${FT}`);
      const j = await r.json().catch(() => ({}));
      const bd = j?.business_discovery;
      if (!r.ok || !bd) {
        const m = String(j?.error?.message || "");
        const msg = /does not exist|cannot be found|invalid user|username/i.test(m) || Number(j?.error?.code) === 110
          ? `@${username} isn't a public Business or Creator account (or doesn't exist) — Instagram only shares numbers for those. It's still added; invite them anyway.`
          : needsPermission(j) ? `Instagram refused the lookup: ${m || "permission"} — reconnect with Facebook and select the Page + Instagram account.`
          : (m || "Instagram couldn't return that profile.");
        await admin.schema("api").rpc("save_external_candidates", { p_items: [{ handle: username, source: "manual" }] }).then(() => {}, () => {});
        return json({ error: msg, needs_permission: needsPermission(j) }, 200);
      }
      const media: any[] = bd?.media?.data ?? [];
      const caption = media.map((m: any) => m?.caption || "").join(" ").slice(0, 1500);
      const avg = (k: string) => media.length ? media.reduce((s2: number, m: any) => s2 + (Number(m?.[k]) || 0), 0) / media.length : null;
      const me = String(bd.username || username).toLowerCase();
      const mentions = [...new Set((caption.match(/@([A-Za-z0-9._]{2,30})/g) || []).map((x: string) => x.slice(1).toLowerCase().replace(/\.$/, "")))].filter((h) => h !== me).slice(0, 30);
      const profile = {
        handle: me, name: bd.name ?? null, bio: (bd.biography ?? "").slice(0, 300),
        followers: bd.followers_count ?? null, media_count: bd.media_count ?? null,
        profile_picture_url: bd.profile_picture_url ?? null,
        permalink: media[0]?.permalink ?? null, caption, source: "manual",
        avg_likes: avg("like_count"), avg_comments: avg("comments_count"), mentions,
      };
      await admin.schema("api").rpc("save_external_candidates", { p_items: [profile] }).then(() => {}, () => {});
      return json({ ok: true, profile });
    }

    if (action === "tagged") {
      const igId = String(tok?.ig_user_id || "me");
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

    if (action === "hashtag") {
      const tag = String(body?.tag || "").trim().replace(/^#/, "").toLowerCase();
      const edge = body?.edge === "recent" ? "recent_media" : "top_media";
      if (!/^[\p{L}\p{N}_]{2,60}$/u.test(tag)) return json({ error: "Enter a hashtag, e.g. #foodblogger" }, 400);
      const { data: fbtRaw } = await admin.from("social_tokens").select("access_token, ig_user_id")
        .eq("member_id", user.id).eq("platform", "facebook").maybeSingle();
      let src = await openRow(fbtRaw);
      if (!src?.access_token) { const { data: shared } = await admin.schema("api").rpc("ops_discovery_token"); if (shared?.platform === "facebook") src = await openRow(shared); }
      if (!src?.access_token || !src?.ig_user_id) {
        return json({ error: "Hashtag search switches on once the Geek Super Admin turns on Instagram search (Connect with Facebook, one time).", needs_facebook: true }, 200);
      }
      const igId = encodeURIComponent(String(src.ig_user_id)), FT = encodeURIComponent(String(src.access_token));
      const hs = await (await fetch(`${FB_GRAPH}/ig_hashtag_search?user_id=${igId}&q=${encodeURIComponent(tag)}&access_token=${FT}`)).json().catch(() => ({}));
      const hid = hs?.data?.[0]?.id;
      if (!hid) {
        const m = String(hs?.error?.message || "");
        return json({ error: m ? `Instagram refused the hashtag search: ${m}` : `No public posts found for #${tag}.`, needs_permission: needsPermission(hs) }, 200);
      }
      const fields = "id,caption,media_type,media_url,permalink,like_count,comments_count,timestamp";
      const mr = await (await fetch(`${FB_GRAPH}/${hid}/${edge}?user_id=${igId}&fields=${fields}&limit=40&access_token=${FT}`)).json().catch(() => ({}));
      if (!Array.isArray(mr?.data)) return json({ error: mr?.error?.message || "Instagram couldn't return posts for that hashtag.", needs_permission: needsPermission(mr) }, 200);
      const posts = mr.data.map((m: any) => ({ id: m.id, caption: String(m.caption || "").slice(0, 400), media_type: m.media_type, media_url: m.media_url ?? null,
        permalink: m.permalink ?? null, like_count: m.like_count ?? null, comments_count: m.comments_count ?? null, timestamp: m.timestamp ?? null }));
      // Instagram doesn't say who posted a hashtag post — but captions name accounts (@handle): those become candidates
      const handles = [...new Set(posts.flatMap((p: any) => (p.caption.match(/@([A-Za-z0-9._]{2,30})/g) || []).map((x: string) => x.slice(1).toLowerCase().replace(/\.$/, ""))))].slice(0, 40);
      if (handles.length) {
        await admin.schema("api").rpc("save_external_candidates", { p_items: handles.map((h) => ({ handle: h, source: "hashtag", caption: `#${tag}` })) }).then(() => {}, () => {});
      }
      return json({ ok: true, tag, edge, posts, handles });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("ig-discover error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
