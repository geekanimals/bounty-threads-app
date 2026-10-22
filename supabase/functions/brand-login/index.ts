// Edge Function: brand-login  (verify_jwt = true — Super Admin only)
// Gives a brand its own Geek OS login, made from the Brand CRM:
//   { action: "create", brand_id, email, name }  → new account (role "brand", in the brand's own workspace) + a password
//   { action: "reset",  brand_id, member_id }    → a new password for one of that brand's logins
// The password is shown once to the Super Admin to pass on; the brand can change it after signing in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") || "").trim().replace(/\/+$/, "");

function newPassword(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ", a = "abcdefghijkmnpqrstuvwxyz", d = "23456789", s = "@#$%&*!";
  const all = A + a + d, pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(A), pick(a), pick(d), pick(s), ...Array.from({ length: 8 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: isAdmin } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isAdmin) return json({ error: "Only the Super Admin can make brand logins." }, 403);

    const body = await req.json().catch(() => ({}));
    const brand = String(body.brand_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(brand)) return json({ error: "Pick a brand." }, 400);
    const loginUrl = APP_URL ? `${APP_URL}/brand/` : null;

    if (body.action === "reset") {
      const member = String(body.member_id || "");
      const { data: ok } = await admin.schema("api").rpc("ops_brand_login_member", { p_brand: brand, p_member: member });
      if (!ok) return json({ error: "That login doesn't belong to this brand." }, 400);
      const password = newPassword();
      const { data: u, error } = await admin.auth.admin.updateUserById(member, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, email: u.user?.email || null, password, login_url: loginUrl });
    }

    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 80);
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ error: "Enter a valid email." }, 400);
    const { data: prep, error: pe } = await admin.schema("api").rpc("ops_brand_login_prepare", { p_brand: brand, p_email: email, p_name: name, p_by: user.id });
    if (pe) return json({ error: pe.message }, 400);
    const password = newPassword();
    const { data: made, error: ce } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { invite_token: (prep as any).token, full_name: name || (prep as any).org_name, role: "brand", org_name: (prep as any).org_name },
    });
    if (ce) {
      const msg = /already|registered|exists/i.test(ce.message) ? "This email already has a Geek OS account — use another email for the brand login." : ce.message;
      await admin.from("invites").update({ status: "cancelled" }).eq("token", (prep as any).token);
      return json({ error: msg }, 400);
    }
    return json({ ok: true, member_id: made.user?.id, email, password, login_url: loginUrl });
  } catch (e) {
    console.error("brand-login", (e as Error).message);
    return json({ error: "Something went wrong" }, 500);
  }
});
