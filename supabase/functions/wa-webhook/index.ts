// Edge Function: wa-webhook  (verify_jwt = false — Meta calls this; the signature + verify-token are the boundary)
// GET  = Meta subscription handshake (hub.challenge).  POST = inbound messages + delivery statuses.
// Inbound replies land back in the app conversation (matched by phone), opening the 24h session window.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyChallenge, validateSignature } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WA_WEBHOOK_VERIFY_TOKEN") || "";                 // Meta GET handshake (direct-Meta)
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") || Deno.env.get("INSTAGRAM_APP_SECRET") || ""; // x-hub-signature (direct-Meta)
// snapto "Meta Webhooks" forwards the native Meta payload; we authenticate it by a Custom Header shared
// secret configured on the snapto webhook (header name + value below).
const HOOK_SECRET = Deno.env.get("WA_WEBHOOK_SECRET") || "";
const HOOK_SECRET_HEADER = (Deno.env.get("WA_WEBHOOK_SECRET_HEADER") || "x-webhook-secret").toLowerCase();

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ch = verifyChallenge(url.searchParams.get("hub.mode"), url.searchParams.get("hub.verify_token"), url.searchParams.get("hub.challenge"), VERIFY_TOKEN);
    return ch ? new Response(ch, { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  // Verify the sender: snapto Custom-Header secret (primary) and/or Meta x-hub-signature (direct-Meta).
  // Fail closed: with neither secret configured, anyone could inject messages / opt users out.
  if (HOOK_SECRET) {
    if (req.headers.get(HOOK_SECRET_HEADER) !== HOOK_SECRET) return new Response("unauthorized", { status: 401 });
  } else if (APP_SECRET) {
    if (!(await validateSignature(raw, req.headers.get("x-hub-signature-256"), APP_SECRET))) return new Response("bad signature", { status: 401 });
  } else {
    return new Response("webhook not configured (WA_WEBHOOK_SECRET)", { status: 503 });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const body = JSON.parse(raw);
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const v = change?.value ?? {};
        // inbound messages
        for (const m of v?.messages ?? []) {
          const fromE164 = "+" + String(m.from || "").replace(/\D/g, "");
          const text = m?.text?.body ?? m?.button?.text ?? m?.interactive?.button_reply?.title ?? (m?.type ? `[${m.type}]` : "");
          const { data: contact } = await admin.from("wa_contacts").select("user_id").eq("phone_e164", fromE164).maybeSingle();
          // opt-out / opt-in keywords (WhatsApp Business policy): honoured before anything else is sent
          const kw = String(m?.text?.body || "").trim().toUpperCase();
          if (contact && /^(STOP|UNSUBSCRIBE)$/.test(kw)) await admin.from("wa_contacts").update({ opt_out_at: new Date().toISOString() }).eq("user_id", contact.user_id);
          if (contact && /^(START|SUBSCRIBE)$/.test(kw)) await admin.from("wa_contacts").update({ opt_out_at: null, opt_in_at: new Date().toISOString() }).eq("user_id", contact.user_id);
          // match the latest conversation for this number; else open the creator's system thread (visible to
          // the creator + agency operators) — never an orphan row nobody can read
          let { data: conv } = await admin.from("wa_conversations").select("id,contact_user_id").eq("contact_phone_e164", fromE164)
            .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
          if (!conv) {
            const { data: id } = await admin.rpc("wa_system_conversation", { p_user: contact?.user_id ?? null, p_phone: fromE164 });
            conv = { id, contact_user_id: contact?.user_id ?? null };
          } else if (!conv.contact_user_id && contact?.user_id) {
            await admin.from("wa_conversations").update({ contact_user_id: contact.user_id }).eq("id", conv.id);
          }
          const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await admin.from("wa_messages").upsert(
            { conversation_id: conv!.id, sender_user_id: null, direction: "inbound", body: text, wa_message_id: m.id, status: "received" },
            { onConflict: "wa_message_id", ignoreDuplicates: true },
          );
          await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString(), session_expires_at: sessionExpiry }).eq("id", conv!.id);
        }
        // delivery/read/failed statuses
        for (const s of v?.statuses ?? []) {
          const patch: Record<string, unknown> = { status: s.status };
          if (s.status === "delivered") patch.delivered_at = new Date().toISOString();
          if (s.status === "read") patch.read_at = new Date().toISOString();
          if (s.status === "failed") patch.error = s?.errors?.[0]?.title ?? "failed";
          await admin.from("wa_messages").update(patch).eq("wa_message_id", s.id);
        }
      }
    }
  } catch (_e) { /* always 200 so Meta does not retry-storm; errors are logged server-side */ }
  return new Response("ok", { status: 200 });
});
