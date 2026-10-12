// Edge Function: wa-otp-verify  (verify_jwt = false)
// Verifies the WhatsApp OTP, finds-or-creates the Supabase user for that phone, marks the contact verified +
// opted-in, and returns a magic-link token_hash the client exchanges for a session (sb.auth.verifyOtp).
// Link mode ({ link: true } + the signed-in user's JWT): attaches the verified number to the CURRENT account
// instead (email / Instagram creators opting in to WhatsApp updates) and returns no session.
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
    const { phone, code, link: linkMode, door: doorRaw, name: nameRaw, org: orgRaw } = await req.json().catch(() => ({}));
    // which login door was used: creator (default) | owner (agency) | brand. Agency/brand accounts are created
    // `pending` by handle_new_user and only enter after the Super Admin approves them.
    const door = ["owner", "brand"].includes(String(doorRaw)) ? String(doorRaw) : "creator";
    const fullName = String(nameRaw || "").trim().slice(0, 80);
    const orgName = String(orgRaw || "").trim().slice(0, 120);
    const e164 = toE164(phone || "");
    if (!/^\+[1-9]\d{7,15}$/.test(e164)) return json({ error: "Invalid phone" }, 400);
    if (!/^\d{6}$/.test(String(code || ""))) return json({ error: "Enter the 6-digit code" }, 400);
    if (!PEPPER || PEPPER.length < 32) { console.error("wa-otp-verify: OTP_PEPPER missing/short"); return json({ error: "WhatsApp login is not available right now." }, 503); }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    let linkUserId: string | null = null;
    if (linkMode) {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!jwt) return json({ error: "Sign in first to link WhatsApp." }, 401);
      const { data: u } = await admin.auth.getUser(jwt);
      if (!u?.user) return json({ error: "Sign in first to link WhatsApp." }, 401);
      linkUserId = u.user.id;
    }
    // atomic: row-locked check, attempt counted, consumed on match (public.wa_otp_check)
    const { data: status, error: chkErr } = await admin.rpc("wa_otp_check", {
      p_phone: e164, p_code_hash: await hashCode(String(code), PEPPER),
    });
    if (chkErr) throw chkErr;
    if (status === "no_code") return json({ error: "No active code. Request a new one." }, 400);
    if (status === "expired") return json({ error: "Code expired. Request a new one." }, 400);
    if (status === "locked")  return json({ error: "Too many attempts. Please wait and request a new code." }, 429);
    if (status !== "ok")      return json({ error: "Incorrect code" }, 401);

    // find-or-create the Supabase user for this phone (mirrors instagram-login)
    const email = `wa_${normalizeMsisdn(e164)}@${EMAIL_DOMAIN}`;
    let userId: string | null = null;
    const { data: existing } = await admin.from("wa_contacts").select("user_id").eq("phone_e164", e164).maybeSingle();
    if (linkUserId) {
      if (existing?.user_id && existing.user_id !== linkUserId) return json({ error: "This WhatsApp number is already linked to another account." }, 409);
      const now = new Date().toISOString();
      const { error: lErr } = await admin.from("wa_contacts").upsert(
        { user_id: linkUserId, phone_e164: e164, verified_at: now, opt_in_at: now, opt_out_at: null }, { onConflict: "user_id" });
      if (lErr) throw lErr;
      return json({ ok: true, linked: true, phone_e164: e164 });
    }
    if (existing?.user_id) {
      userId = existing.user_id;
      // one WhatsApp number = one kind of account; never let a creator walk in through the agency door or vice versa
      const { data: mem } = await admin.from("members").select("role").eq("id", userId).maybeSingle();
      const isCreator = !mem?.role || mem.role === "creator";
      if (door === "creator" && !isCreator) return json({ error: "This WhatsApp number belongs to an Agency/Brand account — use the Agency Owner or Brand door." }, 409);
      if (door !== "creator" && isCreator) return json({ error: "This WhatsApp number is registered as a Creator. Use a different number for your agency or brand." }, 409);
    } else {
      if (door !== "creator" && (!fullName || !orgName)) return json({ error: "Enter your name and organisation name.", needs_details: true }, 400);
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, email_confirm: true, phone: e164.replace("+", ""), phone_confirm: true,
        app_metadata: { created_via: "whatsapp-login", door },
        user_metadata: door === "creator"
          ? { role: "creator", org_name: "My Creator Space" }
          : { role: door, org_name: orgName, full_name: fullName },
      });
      if (cErr && !/registered|exists/i.test(cErr.message)) throw cErr;
      userId = created?.user?.id ?? null;
      for (let page = 1; !userId && page <= 50; page++) { // created elsewhere — look up by email (paged)
        const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        const users = list?.users ?? [];
        userId = users.find((u) => u.email === email)?.id ?? null;
        if (users.length < 1000) break;
      }
    }
    if (!userId) throw new Error("could not resolve user");

    // upsert the verified, opted-in contact
    await admin.from("wa_contacts").upsert(
      { user_id: userId, phone_e164: e164, verified_at: new Date().toISOString(), opt_in_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

    // keep the verified WhatsApp on the member row (Super Admin approval queue shows it)
    await admin.from("members").update({ whatsapp_e164: e164 }).eq("id", userId);

    // magic-link token_hash the browser exchanges for a session
    const { data: userRec } = await admin.auth.admin.getUserById(userId);
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: userRec?.user?.email || email });
    const token_hash = (link as any)?.data?.properties?.hashed_token ?? (link as any)?.properties?.hashed_token ?? null;
    if (!token_hash) throw new Error("could not mint session");
    return json({ ok: true, token_hash, email: userRec?.user?.email || email });
  } catch (e) {
    console.error("wa-otp-verify failed:", (e as Error).message);       // details in logs only
    return json({ error: "Verification failed. Please try again." }, 500);
  }
});
