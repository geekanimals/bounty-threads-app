// Edge Function: wa-otp-verify  (verify_jwt = false)
// Verifies the WhatsApp OTP, finds-or-creates the Supabase user for that phone, marks the contact verified +
// opted-in, and returns a magic-link token_hash the client exchanges for a session (sb.auth.verifyOtp).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { toE164, normalizeMsisdn, hashCode } from "../_shared/wa_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PEPPER = Deno.env.get("OTP_PEPPER") || "";
const EMAIL_DOMAIN = "creators.bountythreads.app";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { phone, code } = await req.json();
    const e164 = toE164(phone || "");
    if (!/^\+[1-9]\d{7,15}$/.test(e164)) return json({ error: "Invalid phone" }, 400);
    if (!/^\d{6}$/.test(String(code || ""))) return json({ error: "Enter the 6-digit code" }, 400);
    if (!PEPPER) return json({ error: "OTP not configured" }, 501);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: row } = await admin.from("wa_otp").select("id,code_hash,expires_at,attempts,consumed_at")
      .eq("phone_e164", e164).is("consumed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row) return json({ error: "No active code. Request a new one." }, 400);
    if (new Date(row.expires_at) < new Date()) return json({ error: "Code expired. Request a new one." }, 400);
    if ((row.attempts ?? 0) >= 5) return json({ error: "Too many attempts. Request a new code." }, 429);

    const ok = (await hashCode(String(code), PEPPER)) === row.code_hash;
    if (!ok) {
      await admin.from("wa_otp").update({ attempts: (row.attempts ?? 0) + 1 }).eq("id", row.id);
      return json({ error: "Incorrect code" }, 401);
    }
    await admin.from("wa_otp").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

    // find-or-create the Supabase user for this phone (mirrors instagram-login)
    const email = `wa_${normalizeMsisdn(e164)}@${EMAIL_DOMAIN}`;
    let userId: string | null = null;
    const { data: existing } = await admin.from("wa_contacts").select("user_id").eq("phone_e164", e164).maybeSingle();
    if (existing?.user_id) {
      userId = existing.user_id;
    } else {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, email_confirm: true, phone: e164.replace("+", ""), phone_confirm: true,
        app_metadata: { created_via: "whatsapp-login" }, user_metadata: { role: "creator", org_name: "My Creator Space" },
      });
      if (cErr && !/registered|exists/i.test(cErr.message)) throw cErr;
      userId = created?.user?.id ?? null;
      if (!userId) { // created elsewhere — look up by email
        const { data: list } = await admin.auth.admin.listUsers();
        userId = list?.users?.find((u) => u.email === email)?.id ?? null;
      }
    }
    if (!userId) throw new Error("could not resolve user");

    // upsert the verified, opted-in contact
    await admin.from("wa_contacts").upsert(
      { user_id: userId, phone_e164: e164, verified_at: new Date().toISOString(), opt_in_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

    // magic-link token_hash the browser exchanges for a session
    const { data: userRec } = await admin.auth.admin.getUserById(userId);
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: userRec?.user?.email || email });
    const token_hash = (link as any)?.data?.properties?.hashed_token ?? (link as any)?.properties?.hashed_token ?? null;
    if (!token_hash) throw new Error("could not mint session");
    return json({ ok: true, token_hash, email: userRec?.user?.email || email });
  } catch (e) {
    return json({ error: (e as Error).message || "Verification failed" }, 500);
  }
});
