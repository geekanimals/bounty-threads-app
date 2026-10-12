// Edge Function: instagram-comments  (verify_jwt = true — the signed-in creator's OWN posts only)
// Comment moderation for the Media Kit via the Instagram API with Instagram Login
// (permission: instagram_business_manage_comments).
//
// Body: { action, ... }
//   list    { media_id }                       → comments (+ replies) on one of the creator's posts
//   reply   { comment_id, message }            → public reply under a comment
//   hide    { comment_id, hide: boolean }      → hide / unhide (hidden comments are only visible to the author)
//   delete  { comment_id }                     → delete a comment on the creator's post
// Ownership: the post (for list) / the comment's post (for actions) must belong to the token's account —
// checked against Instagram before acting, so this endpoint can't be used on anyone else's content.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json as jsonRaw } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com/v23.0";
const ID = /^[0-9]{5,30}$/;

function json(body: unknown, status = 200) {
  if (status >= 400) console.warn(`instagram-comments ${status}:`, JSON.stringify(body).slice(0, 500));
  return jsonRaw(body, status);
}
const metaError = (j: any) => j?.error?.error_user_msg || j?.error?.message || null;
const needsPermission = (j: any) => j?.error?.code === 10 || j?.error?.code === 200 || /permission/i.test(String(j?.error?.message || ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: tok } = await admin.from("social_tokens").select("access_token, expires_at")
      .eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    if (!tok?.access_token) return json({ error: "Instagram not connected" }, 400);
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) return json({ error: "Instagram token expired — reconnect Instagram." }, 400);
    const T = tok.access_token as string;

    const get = async (path: string, fields: string) => {
      const r = await fetch(`${GRAPH}/${path}?fields=${fields}&access_token=${encodeURIComponent(T)}`);
      return { ok: r.ok, j: await r.json().catch(() => ({})) };
    };
    const call = async (method: string, path: string, params: Record<string, string> = {}) => {
      const qs = new URLSearchParams({ ...params, access_token: T });
      const r = method === "DELETE"
        ? await fetch(`${GRAPH}/${path}?${qs}`, { method })
        : await fetch(`${GRAPH}/${path}`, { method, body: qs });
      return { ok: r.ok, j: await r.json().catch(() => ({})) };
    };
    const fail = (j: any, what: string) => needsPermission(j)
      ? json({ error: "Instagram hasn't granted comment management to this app yet. Reconnect Instagram (and make sure the Meta app has instagram_business_manage_comments approved).", needs_permission: true }, 403)
      : json({ error: `Instagram couldn't ${what}.`, detail: metaError(j) || j }, 400);

    // the token's own account ids (app-scoped id + professional id) — used for ownership checks
    const me = await get("me", "id,user_id,username");
    if (!me.ok) return fail(me.j, "verify your account");
    const mine = new Set([String(me.j.id || ""), String(me.j.user_id || "")].filter(Boolean));
    const ownsMedia = async (mediaId: string) => {
      const m = await get(mediaId, "owner{id},username");
      if (!m.ok) return false;
      return mine.has(String(m.j?.owner?.id || "")) || (m.j?.username && m.j.username === me.j.username);
    };
    const mediaOfComment = async (commentId: string) => {
      const c = await get(commentId, "media{id}");
      return c.ok ? String(c.j?.media?.id || "") : "";
    };

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "list") {
      const mediaId = String(body?.media_id || "");
      if (!ID.test(mediaId)) return json({ error: "media_id required" }, 400);
      if (!(await ownsMedia(mediaId))) return json({ error: "You can only manage comments on your own posts." }, 403);
      const r = await get(`${mediaId}/comments`,
        "id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp,like_count,hidden}");
      if (!r.ok) return fail(r.j, "load comments");
      return json({ ok: true, comments: r.j?.data ?? [] });
    }

    const commentId = String(body?.comment_id || "");
    if (!ID.test(commentId)) return json({ error: "comment_id required" }, 400);
    const mediaId = await mediaOfComment(commentId);
    if (!mediaId || !(await ownsMedia(mediaId))) return json({ error: "You can only manage comments on your own posts." }, 403);

    if (action === "reply") {
      const message = String(body?.message || "").trim();
      if (!message) return json({ error: "Write a reply first." }, 400);
      if (message.length > 2200) return json({ error: "Reply is too long." }, 400);
      const r = await call("POST", `${commentId}/replies`, { message });
      return r.ok && r.j?.id ? json({ ok: true, id: r.j.id }) : fail(r.j, "post your reply");
    }
    if (action === "hide") {
      const r = await call("POST", commentId, { hide: body?.hide === false ? "false" : "true" });
      return r.ok ? json({ ok: true, hidden: body?.hide !== false }) : fail(r.j, "hide the comment");
    }
    if (action === "delete") {
      const r = await call("DELETE", commentId);
      return r.ok ? json({ ok: true }) : fail(r.j, "delete the comment");
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("instagram-comments error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
