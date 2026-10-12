// Edge Function: super-admin-sync  (verify_jwt = false; callable ONLY with the CI_WORKER_SECRET)
// Creates or updates the Super Admin login from Edge secrets — no password ever lives in the code, the
// database migrations or the browser:
//   SUPER_ADMIN_EMAIL     login email
//   SUPER_ADMIN_PASSWORD  ≥ 12 chars, letters + numbers
//   SUPER_ADMIN_NAME      optional display name
// Run again any time to rotate the password. Idempotent: confirms the email, sets the password, makes the
// member active and adds the user to public.platform_admins. Never returns the password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedWorker } from "../_shared/worker_auth.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isAuthorizedWorker(req, Deno.env.get("CI_WORKER_SECRET"))) return json({ error: "Unauthorized" }, 401);

  const email = (Deno.env.get("SUPER_ADMIN_EMAIL") || "").trim().toLowerCase();
  const password = Deno.env.get("SUPER_ADMIN_PASSWORD") || "";
  const name = (Deno.env.get("SUPER_ADMIN_NAME") || "Super Admin").trim().slice(0, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "SUPER_ADMIN_EMAIL is missing or invalid" }, 400);
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    return json({ error: "SUPER_ADMIN_PASSWORD must be at least 12 characters with letters and numbers" }, 400);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // find the auth user by email (paged)
    let userId: string | null = null;
    for (let page = 1; !userId && page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      userId = data.users.find((u) => (u.email || "").toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }

    let action: "created" | "updated";
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { created_via: "super-admin-env" },
        user_metadata: { full_name: name, name, role: "owner", org_name: "Geek Super Admin" },
      });
      if (error) throw error;
      userId = data.user!.id; action = "created";
    } else {
      const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (error) throw error;
      action = "updated";
    }

    // member row: active (the signup trigger creates agency-side accounts as pending)
    const { data: m } = await admin.from("members").select("id, name").eq("id", userId).maybeSingle();
    if (m) {
      const { error } = await admin.from("members").update({ status: "active", ...(m.name ? {} : { name }) }).eq("id", userId);
      if (error) throw error;
    } else {
      const { error } = await admin.from("members").insert({ id: userId, name, email, role: "owner", status: "active", org_name: "Geek Super Admin" });
      if (error) throw error;
    }

    const { error: pErr } = await admin.from("platform_admins").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (pErr) throw pErr;

    return json({ ok: true, action, email, user_id: userId });
  } catch (e) {
    console.error("super-admin-sync error:", (e as Error).message);
    return json({ error: "Couldn't set up the super admin: " + (e as Error).message }, 500);
  }
});
