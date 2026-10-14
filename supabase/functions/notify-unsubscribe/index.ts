// Edge Function: notify-unsubscribe  (verify_jwt = false — opened from a link in an email / WhatsApp message)
// POST { t: <member notify_token>, c: "email" | "whatsapp", off?: boolean }  →  stops (or restarts) update
// messages on that channel. The token is the key; no sign-in needed. Login / recovery OTPs are never affected.
// The page the person sees is app/unsubscribe.html (Supabase serves function HTML as plain text).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch (_e) { return json({ error: "bad request" }, 400); }
  const token = String(body?.t || ""), channel = String(body?.c || "");
  if (!UUID.test(token) || !["email", "whatsapp"].includes(channel)) return json({ error: "This link isn't valid." }, 400);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data, error } = await admin.schema("api").rpc("notify_unsubscribe", { p_token: token, p_channel: channel, p_off: body?.off !== false });
  if (error) return json({ error: /not valid/.test(error.message) ? "This link isn't valid any more." : "Couldn't update — try again." }, 400);
  return json(data);
});
