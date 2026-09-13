// Edge Function: whatsapp-send  (verify_jwt = true)
// Sends a WhatsApp message via the WhatsApp Business Cloud API (Meta), server-side.
// The app works TODAY with wa.me click-to-chat links (zero setup); deploy this + set the
// secrets below to switch on automated sending (bulk invites, reminders) with no user taps.
//
// Secrets (Supabase → Edge Functions → whatsapp-send → Secrets):
//   WHATSAPP_TOKEN     — permanent access token for your WhatsApp Business number
//   WHATSAPP_PHONE_ID  — the Phone Number ID from Meta → WhatsApp → API Setup
//   WHATSAPP_API_VER   — optional, defaults to v21.0
//
// Body: { to: "+9198…", text: "message" }  OR
//       { to, template: "hello_world", lang: "en_US", components: [...] }
// Free-form text only reaches users inside the 24h customer-service window; outside it, Meta
// requires a pre-approved TEMPLATE — pass `template` for invites/first-contact.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID") || "";
const API_VER = Deno.env.get("WHATSAPP_API_VER") || "v21.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Normalize to digits-only E.164 (no '+'), defaulting bare 10-digit numbers to India.
function normalize(raw: string): string {
  let d = (raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  d = d.replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Signed-in users only.
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    if (!TOKEN || !PHONE_ID) {
      return json({ error: "WhatsApp Business API is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID, or use the app's WhatsApp click-to-chat links." }, 501);
    }

    const { to, text, template, lang, components } = await req.json();
    const num = normalize(to || "");
    if (!num) return json({ error: "A destination number ('to') is required." }, 400);

    const payload: Record<string, unknown> = { messaging_product: "whatsapp", to: num };
    if (template) {
      payload.type = "template";
      payload.template = { name: template, language: { code: lang || "en_US" }, ...(components ? { components } : {}) };
    } else {
      payload.type = "text";
      payload.text = { body: String(text || "") };
    }

    const r = await fetch(`https://graph.facebook.com/${API_VER}/${PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await r.json();
    if (!r.ok) return json({ error: body?.error?.message || "WhatsApp send failed", details: body }, r.status);
    return json({ ok: true, result: body });
  } catch (e) {
    return json({ error: (e as Error).message || "Unexpected error" }, 500);
  }
});
