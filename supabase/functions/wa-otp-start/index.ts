// Edge Function: wa-otp-start  (verify_jwt = false — called by signed-OUT users logging in via WhatsApp)
// Generates a 6-digit code, stores only its hash, and sends it via a Meta WhatsApp AUTHENTICATION template.
// Rate-limited per phone. Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WA_OTP_TEMPLATE, WA_OTP_LANG, OTP_PEPPER.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider, toE164, hashCode } from "../_shared/wa_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PEPPER = Deno.env.get("OTP_PEPPER") || "";
const TEMPLATE = Deno.env.get("WA_OTP_TEMPLATE") || "";
const LANG = Deno.env.get("WA_OTP_LANG") || "en_US";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { phone } = await req.json();
    const e164 = toE164(phone || "");
    if (!/^\+[1-9]\d{7,15}$/.test(e164)) return json({ error: "Enter a valid WhatsApp number in international format, e.g. +919812345678" }, 400);
    if (!PEPPER) return json({ error: "OTP not configured (OTP_PEPPER)." }, 501);
    if (!TEMPLATE) return json({ error: "OTP not configured (WA_OTP_TEMPLATE)." }, 501);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    // rate limit: at most 5 codes per number per 10 minutes
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from("wa_otp").select("id", { count: "exact", head: true }).eq("phone_e164", e164).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    const code_hash = await hashCode(code, PEPPER);
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: insErr } = await admin.from("wa_otp").insert({ phone_e164: e164, code_hash, expires_at });
    if (insErr) throw insErr;

    // Meta AUTHENTICATION template: body param = code, copy-code button param = code.
    await getProvider().send({
      to: e164, template: TEMPLATE, lang: LANG,
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "copy_code", index: "0", parameters: [{ type: "coupon_code", coupon_code: code }] },
      ],
    });
    return json({ ok: true, expires_in: 600 });
  } catch (e) {
    return json({ error: (e as Error).message || "Could not send the WhatsApp code." }, 500);
  }
});
