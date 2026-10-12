// Edge Function: email-otp  (verify_jwt = true — the signed-in agency/brand verifying their official email)
// Step 2 of agency/brand onboarding (step 1 is WhatsApp OTP). Sends a 6-digit code over SMTP and verifies it.
// Supabase Edge blocks outbound ports 25/587, so SMTP must be implicit TLS on port 465.
// Secrets: SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, SMTP_FROM ("Geek OS <no-reply@yourdomain.com>"),
//          OTP_PEPPER (shared with WhatsApp OTP).
// Body: { action: "start", email } | { action: "verify", code }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hashCode } from "../_shared/wa_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PEPPER = Deno.env.get("OTP_PEPPER") || "";
const SMTP = {
  host: Deno.env.get("SMTP_HOST") || "", port: Number(Deno.env.get("SMTP_PORT") || 465),
  user: Deno.env.get("SMTP_USER") || "", pass: Deno.env.get("SMTP_PASS") || "",
  from: Deno.env.get("SMTP_FROM") || Deno.env.get("SMTP_USER") || "",
};
// free-mail domains are allowed but flagged to the Super Admin (official email expected)
const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|live|icloud|rediffmail|proton(mail)?|aol)\./i;

function sixDigitCode(): string {
  const buf = new Uint32Array(1); const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!PEPPER || PEPPER.length < 32) return json({ error: "Email verification is not available right now." }, 503);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: member } = await admin.from("members").select("id, role, name, org_name").eq("id", user.id).maybeSingle();
    if (!member || member.role === "creator") return json({ error: "Email verification is for agency and brand accounts." }, 403);

    const body = await req.json().catch(() => ({}));
    if (body?.action === "start") {
      const email = String(body?.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
      if (!SMTP.host || !SMTP.user || !SMTP.pass) {
        console.error("email-otp: SMTP_* secrets not configured");
        return json({ error: "Email sending isn't configured yet. Please contact Geek support." }, 503);
      }
      const code = sixDigitCode();
      const { data: status, error } = await admin.rpc("email_otp_issue", { p_member: user.id, p_email: email, p_code_hash: await hashCode(code, PEPPER) });
      if (error) throw error;
      if (status !== "ok") return json({ error: "Too many codes requested. Please wait a few minutes and try again." }, 429);

      const transport = nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, auth: { user: SMTP.user, pass: SMTP.pass } });
      await transport.sendMail({
        from: SMTP.from, to: email,
        subject: `${code} is your Geek Influencer OS verification code`,
        text: `Your verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">
          <p>Hi ${esc(member.name || "there")},</p>
          <p>Use this code to verify <b>${esc(email)}</b> for <b>${esc(member.org_name || "your organisation")}</b> on Geek Influencer OS:</p>
          <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
          <p style="color:#555">It expires in 10 minutes. If you didn't request this, you can ignore this email.</p></div>`,
      });
      return json({ ok: true, expires_in: 600, free_mail: FREE_MAIL.test(email) });
    }

    if (body?.action === "verify") {
      const code = String(body?.code || "");
      if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code." }, 400);
      const { data: res, error } = await admin.rpc("email_otp_check", { p_member: user.id, p_code_hash: await hashCode(code, PEPPER) });
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      if (row?.status === "no_code") return json({ error: "No active code. Send a new one." }, 400);
      if (row?.status === "expired") return json({ error: "Code expired. Send a new one." }, 400);
      if (row?.status === "locked") return json({ error: "Too many attempts. Please wait and send a new code." }, 429);
      if (row?.status !== "ok") return json({ error: "Incorrect code." }, 401);

      const email = String(row.email);
      await admin.from("members").update({ official_email: email, email: email, email_verified_at: new Date().toISOString() }).eq("id", user.id);
      // make it the account's sign-in email too, unless another login already owns that address
      const { error: uErr } = await admin.auth.admin.updateUserById(user.id, { email, email_confirm: true });
      return json({ ok: true, email, login_email_updated: !uErr });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("email-otp error:", (e as Error).message);
    return json({ error: "Couldn't send or verify the code. Please try again." }, 500);
  }
});
