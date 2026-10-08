// Edge Function: wa-send  (verify_jwt = true — signed-in app users send into a conversation)
// Sends a WhatsApp message (free-form inside Meta's 24h window, else a template) and records it. RLS on the
// user client enforces that the caller may access the conversation; the message row is written as service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider, toE164 } from "../_shared/wa_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const { conversation_id, to_phone, campaign_id, subject, text, template, lang, components } = await req.json();

    // resolve the conversation the caller is allowed to use
    let convId = conversation_id as string | undefined;
    if (!convId) {
      const e164 = toE164(to_phone || "");
      if (!/^\+[1-9]\d{7,15}$/.test(e164)) return json({ error: "conversation_id or a valid to_phone is required" }, 400);
      const { data, error } = await userClient.rpc("wa_get_or_create_conversation", { p_contact_phone: e164, p_campaign_id: campaign_id ?? null, p_subject: subject ?? null });
      if (error) throw error;
      convId = data as string;
    }
    // RLS check + fetch destination + session window (user client => denied rows are invisible)
    const { data: conv, error: cErr } = await userClient.from("wa_conversations")
      .select("id,contact_phone_e164,session_expires_at").eq("id", convId).maybeSingle();
    if (cErr) throw cErr;
    if (!conv) return json({ error: "Conversation not found or not authorised" }, 403);

    const openWindow = conv.session_expires_at && new Date(conv.session_expires_at) > new Date();
    if (!template && !openWindow) {
      return json({ error: "Outside the 24-hour window — a pre-approved template is required to start the conversation.", needs_template: true }, 409);
    }

    const out = template
      ? { to: conv.contact_phone_e164, template, lang, components }
      : { to: conv.contact_phone_e164, text: String(text || "") };
    const res = await getProvider().send(out as any);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: msg, error: mErr } = await admin.from("wa_messages").insert({
      conversation_id: convId, sender_user_id: user.id, direction: "outbound",
      body: template ? `[template:${template}]` : String(text || ""), wa_message_id: res.wamid, status: "sent",
    }).select("id,wa_message_id").single();
    if (mErr) throw mErr;
    await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);

    return json({ ok: true, conversation_id: convId, message_id: msg.id, wa_message_id: msg.wa_message_id });
  } catch (e) {
    return json({ error: (e as Error).message || "Send failed" }, 500);
  }
});
