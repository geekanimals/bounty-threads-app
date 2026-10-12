// Edge Function: wa-otp-start  (verify_jwt = false — called by signed-OUT users logging in via WhatsApp)
// Generates a 6-digit code (CSPRNG, unbiased), stores only its peppered hash, and sends it via the approved
// WhatsApp AUTHENTICATION template. Rate limits (atomic, in public.wa_otp_issue): 5/phone/10min,
// 10/IP/hour, 500/platform/hour. Secrets: OTP_PEPPER, WA_OTP_TEMPLATE, WA_OTP_LANG (+ provider secrets).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider, toE164, hashCode } from "../_shared/wa_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PEPPER = Deno.env.get("OTP_PEPPER") || "";
const TEMPLATE = Deno.env.get("WA_OTP_TEMPLATE") || "";
const LANG = Deno.env.get("WA_OTP_LANG") || "en";
const IP_MAX = Number(Deno.env.get("OTP_MAX_PER_IP_HOUR") || 10);
const GLOBAL_MAX = Number(Deno.env.get("OTP_MAX_GLOBAL_HOUR") || 500);
// optional allow-list of country codes, e.g. "91" or "91,971" — blocks premium-rate pumping to other countries
const ALLOWED_CC = (Deno.env.get("OTP_ALLOWED_COUNTRY_CODES") || "91").split(",").map((s) => s.trim()).filter(Boolean);

// unbiased 6-digit code via rejection sampling
function sixDigitCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
}

const GENERIC_OK = { ok: true, expires_in: 600 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!PEPPER || PEPPER.length < 32 || !TEMPLATE) {
    console.error("wa-otp-start: OTP_PEPPER (>=32 chars) / WA_OTP_TEMPLATE not configured");
    return json({ error: "WhatsApp login is not available right now." }, 503);
  }
  try {
    const body = await req.json().catch(() => ({}));
    const e164 = toE164(String(body?.phone || ""));
    if (!/^\+[1-9]\d{7,15}$/.test(e164)) return json({ error: "Enter a valid WhatsApp number in international format, e.g. +919812345678" }, 400);
    if (ALLOWED_CC.length && !ALLOWED_CC.some((cc) => e164.startsWith("+" + cc))) {
      return json({ error: "WhatsApp login isn't available for this country yet." }, 400);
    }

    const ip = clientIp(req);
    const ipHash = ip ? await hashCode("ip:" + ip, PEPPER) : null;
    const code = sixDigitCode();
    const codeHash = await hashCode(code, PEPPER);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: status, error } = await admin.rpc("wa_otp_issue", {
      p_phone: e164, p_code_hash: codeHash, p_ip_hash: ipHash, p_ttl_seconds: 600,
      p_phone_max: 5, p_ip_max: IP_MAX, p_global_max: GLOBAL_MAX,
    });
    if (error) throw error;
    if (status === "rate_phone" || status === "rate_ip") return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
    if (status === "rate_global") {
      console.error("wa-otp-start: GLOBAL OTP cap hit — possible SMS-pumping attack");
      return json({ error: "WhatsApp login is busy. Please try again shortly." }, 429);
    }
    if (status !== "ok") throw new Error("unexpected issue status: " + status);

    await getProvider().send({ to: e164, template: TEMPLATE, lang: LANG, variables: [code] });
    return json(GENERIC_OK);
  } catch (e) {
    console.error("wa-otp-start failed:", (e as Error).message);       // details in logs only
    return json({ error: "Could not send the WhatsApp code. Please try again." }, 500);
  }
});
