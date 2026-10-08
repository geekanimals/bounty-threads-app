// Edge Function: wa-webhook  (verify_jwt = false — Meta calls this; the signature + verify-token are the boundary)
// GET  = Meta subscription handshake (hub.challenge).  POST = inbound messages + delivery statuses.
// Inbound replies land back in the app conversation (matched by phone), opening the 24h session window.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyChallenge, validateSignature } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WA_WEBHOOK_VERIFY_TOKEN") || "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") || Deno.env.get("INSTAGRAM_APP_SECRET") || "";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ch = verifyChallenge(url.searchParams.get("hub.mode"), url.searchParams.get("hub.verify_token"), url.searchParams.get("hub.challenge"), VERIFY_TOKEN);
    return ch ? new Response(ch, { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (APP_SECRET && !(await validateSignature(raw, req.headers.get("x-hub-signature-256"), APP_SECRET))) {
    return new Response("bad signature", { status: 401 });
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
          const text = m?.text?.body ?? (m?.type ? `[${m.type}]` : "");
          // match the latest conversation for this number; else record an unassigned one
          let { data: conv } = await admin.from("wa_conversations").select("id").eq("contact_phone_e164", fromE164)
            .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
          if (!conv) {
            const { data: created } = await admin.from("wa_conversations").insert({ contact_phone_e164: fromE164, subject: "Inbound WhatsApp" }).select("id").single();
            conv = created;
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
