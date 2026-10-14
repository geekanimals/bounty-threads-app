// Edge Function: instagram-dm  (verify_jwt = true — the signed-in creator's own Instagram inbox only)
// Instagram DMs via the Instagram API with Instagram Login (permission: instagram_business_manage_messages).
//
// Body: { action, ... }
//   conversations {}                              → latest threads (participant + last message)
//   thread        { conversation_id }             → messages in one thread (newest first)
//   send          { recipient_id, text }          → reply (Instagram allows replies within 24 h of their
//                                                   last message; outside that it returns an error we surface)
//
// When Instagram refuses, the reply says WHY (always HTTP 200 so the app can read it):
//   { error, reason, meta: { code, subcode, message } } with reason one of
//   reconnect           — this connection was made without the messages permission (e.g. before Meta approved it)
//   messages_access_off — the creator's Instagram has "Allow access to messages" (Connected tools) turned off
//   app_access          — Meta hasn't given this app Advanced Access to instagram_business_manage_messages / app not Live
//   token_expired       — reconnect Instagram
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json as jsonRaw } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com/v23.0";
const DM_SCOPE = "instagram_business_manage_messages";

function json(body: unknown, status = 200) {
  if ((body as any)?.error) console.warn(`instagram-dm:`, JSON.stringify(body).slice(0, 600));
  return jsonRaw(body, status);
}
const metaError = (j: any) => j?.error?.error_user_msg || j?.error?.message || null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    let tok: any = null;
    {
      const r1 = await admin.from("social_tokens").select("access_token, expires_at, scopes, connected_at")
        .eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
      tok = r1.data;
      if (r1.error) {   // before the scopes migration
        const r2 = await admin.from("social_tokens").select("access_token, expires_at").eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
        tok = r2.data;
      }
    }
    if (!tok?.access_token) return json({ error: "Instagram isn't connected yet.", reason: "reconnect" });
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) return json({ error: "Your Instagram connection expired — reconnect Instagram.", reason: "token_expired" });
    const T = encodeURIComponent(tok.access_token as string);
    const scopes: string[] | null = Array.isArray(tok.scopes) ? tok.scopes : null;
    if (scopes && !scopes.includes(DM_SCOPE)) {
      return json({ error: "This Instagram connection doesn't include messages.", reason: "reconnect", scopes });
    }

    // turn Instagram's refusal into a reason the creator can act on
    const refuse = (j: any, what: string) => {
      const code = Number(j?.error?.code), sub = Number(j?.error?.error_subcode) || null, msg = String(metaError(j) || "");
      const meta = { code: code || null, subcode: sub, message: msg || null };
      let reason: string | null = null;
      if (code === 190) reason = "token_expired";
      else if (code === 230 || /connected tools|allow access to messages|access to messages/i.test(msg)) reason = "messages_access_off";
      else if (code === 3 || /capability|advanced access|app review|not approved/i.test(msg)) reason = "app_access";
      else if ([10, 200, 299].includes(code) || /permission|not authorized|scope/i.test(msg)) reason = scopes ? "app_access" : "reconnect";
      return json({ error: reason ? `Instagram didn't allow us to ${what}.` : `Instagram couldn't ${what}${msg ? ": " + msg : "."}`, reason, meta, scopes });
    };

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "conversations") {
      const r = await fetch(`${GRAPH}/me/conversations?platform=instagram&fields=id,updated_time,participants&limit=25&access_token=${T}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return refuse(j, "load your inbox");
      const me = await (await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${T}`)).json().catch(() => ({}));
      const myIds = [me?.id, me?.user_id].filter(Boolean).map(String);
      const convs = (j?.data ?? []) as any[];
      // last message per thread (separately — not every API version allows it nested in the list)
      const lasts = await Promise.all(convs.slice(0, 25).map(async (c) => {
        try {
          const m = await (await fetch(`${GRAPH}/${encodeURIComponent(c.id)}?fields=messages.limit(1){id,message,from,created_time}&access_token=${T}`)).json();
          return m?.messages?.data?.[0] || null;
        } catch (_e) { return null; }
      }));
      const threads = convs.map((c: any, i: number) => {
        const other = (c?.participants?.data ?? []).find((p: any) => !myIds.includes(String(p.id)) && p.username !== me?.username) || {};
        const last = lasts[i] || {};
        return { id: c.id, updated_time: c.updated_time, with_id: other.id ?? null, with_username: other.username ?? null,
                 last_text: last.message ?? null, last_from_me: last?.from?.id ? myIds.includes(String(last.from.id)) : null, last_at: last.created_time ?? null };
      });
      return json({ ok: true, me: { id: me?.user_id ?? me?.id ?? null, username: me?.username ?? null }, threads });
    }

    if (action === "thread") {
      const id = String(body?.conversation_id || "");
      if (!/^[A-Za-z0-9_\-:=]{5,200}$/.test(id)) return json({ error: "conversation_id required" }, 400);
      const r = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=messages.limit(40){id,message,from,created_time,attachments}&access_token=${T}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return refuse(j, "open this conversation");
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
          return json({ error: "Instagram only allows replies within 24 hours of this person's last message.", window_closed: true });
        }
        return refuse(j, "send your message");
      }
      return json({ ok: true, message_id: j?.message_id ?? null });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("instagram-dm error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
