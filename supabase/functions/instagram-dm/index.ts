// Edge Function: instagram-dm  (verify_jwt = true — the signed-in creator's own Instagram inbox only)
// Instagram DMs via the Instagram API with Instagram Login (permission: instagram_business_manage_messages,
// which needs Meta App Review). Until Meta grants it, every action answers { needs_permission: true } and the
// Media Kit shows how to enable it — nothing breaks.
//
// Body: { action, ... }
//   conversations {}                              → latest threads (participant + last message)
//   thread        { conversation_id }             → messages in one thread (newest first)
//   send          { recipient_id, text }          → reply (Instagram allows replies within 24 h of their
//                                                   last message; outside that it returns an error we surface)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json as jsonRaw } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com/v23.0";

function json(body: unknown, status = 200) {
  if (status >= 400) console.warn(`instagram-dm ${status}:`, JSON.stringify(body).slice(0, 500));
  return jsonRaw(body, status);
}
const metaError = (j: any) => j?.error?.error_user_msg || j?.error?.message || null;
const needsPermission = (j: any) => [10, 200, 230, 3].includes(Number(j?.error?.code)) || /permission|not authorized|capability/i.test(String(j?.error?.message || ""));

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
    const T = encodeURIComponent(tok.access_token as string);

    const permissionReply = () => json({
      error: "Instagram DMs need Meta's approval for this app (instagram_business_manage_messages). Once approved, reconnect Instagram and your inbox appears here.",
      needs_permission: true,
    }, 403);
    const fail = (j: any, what: string) => needsPermission(j) ? permissionReply() : json({ error: `Instagram couldn't ${what}.`, detail: metaError(j) || j }, 400);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "conversations") {
      const r = await fetch(`${GRAPH}/me/conversations?platform=instagram&fields=id,updated_time,participants,messages.limit(1){id,message,from,created_time}&limit=25&access_token=${T}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return fail(j, "load your inbox");
      const me = await (await fetch(`${GRAPH}/me?fields=id,username&access_token=${T}`)).json().catch(() => ({}));
      const threads = (j?.data ?? []).map((c: any) => {
        const other = (c?.participants?.data ?? []).find((p: any) => String(p.id) !== String(me?.id) && p.username !== me?.username) || {};
        const last = c?.messages?.data?.[0] || {};
        return { id: c.id, updated_time: c.updated_time, with_id: other.id ?? null, with_username: other.username ?? null,
                 last_text: last.message ?? null, last_from_me: last?.from?.id ? String(last.from.id) === String(me?.id) : null, last_at: last.created_time ?? null };
      });
      return json({ ok: true, me: { id: me?.id ?? null, username: me?.username ?? null }, threads });
    }

    if (action === "thread") {
      const id = String(body?.conversation_id || "");
      if (!/^[A-Za-z0-9_\-:=]{5,200}$/.test(id)) return json({ error: "conversation_id required" }, 400);
      const r = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=messages.limit(40){id,message,from,created_time,attachments}&access_token=${T}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return fail(j, "open this conversation");
      return json({ ok: true, messages: j?.messages?.data ?? [] });
    }

    if (action === "send") {
      const recipient = String(body?.recipient_id || "");
      const text = String(body?.text || "").trim();
      if (!/^[0-9]{5,30}$/.test(recipient)) return json({ error: "recipient_id required" }, 400);
      if (!text) return json({ error: "Write a message first." }, 400);
      if (text.length > 1000) return json({ error: "Message is too long (max 1000 characters)." }, 400);
      const r = await fetch(`${GRAPH}/me/messages?access_token=${T}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipient }, message: { text } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (/24|window|outside/i.test(String(metaError(j) || ""))) {
          return json({ error: "Instagram only allows replies within 24 hours of this person's last message.", window_closed: true }, 400);
        }
        return fail(j, "send your message");
      }
      return json({ ok: true, message_id: j?.message_id ?? null });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("instagram-dm error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
