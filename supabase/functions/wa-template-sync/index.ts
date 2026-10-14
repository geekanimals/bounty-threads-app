// Edge Function: wa-template-sync  (verify_jwt = false — CI_WORKER_SECRET, kicked on every new campaign + every 5 min)
// Every campaign gets its own WhatsApp UTILITY template ("Hi {{1}}, here is an update on your <campaign>
// campaign with <brand>: {{2}} … {{3}}", footer "Reply STOP to stop WhatsApp updates"). This worker submits
// queued templates and follows their review until Meta approves (or rejects) them.
//
// Where it is created (first that is configured):
//   1) Meta WhatsApp Business API directly — WHATSAPP_WABA_ID + WHATSAPP_TOKEN (a system-user token for the
//      same WhatsApp Business Account snapto uses). Fully automatic: create + status check.
//   2) snapto — SNAPTO_TEMPLATE_URL (their template-create endpoint) with SNAPTO_API_KEY; the Meta-shaped
//      body is sent and the status read from the reply.
//   3) Neither → status 'manual': the Super Admin sees the exact name + text under WhatsApp & email and can
//      create it in the snapto dashboard, then press "Mark approved".
// When a template turns approved, held WhatsApp updates for that campaign are re-sent automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") || "https://bountythreads.app").replace(/\/+$/, "");
const WABA_ID = (Deno.env.get("WHATSAPP_WABA_ID") || "").trim();
const META_TOKEN = (Deno.env.get("WHATSAPP_TEMPLATE_TOKEN") || Deno.env.get("WHATSAPP_TOKEN") || "").trim();
const META_VER = Deno.env.get("WHATSAPP_API_VER") || "v21.0";
const SNAPTO_URL = (Deno.env.get("SNAPTO_TEMPLATE_URL") || "").trim();
const SNAPTO_KEY = (Deno.env.get("SNAPTO_API_KEY") || "").trim();
const SNAPTO_PHONE = (Deno.env.get("SNAPTO_PHONE_ID") || "").trim();

type Row = { campaign_id: string; template_name: string; language: string; body: string; footer: string; status: string; provider: string | null };

const mapStatus = (s: unknown): "approved" | "rejected" | "submitted" => {
  const v = String(s || "").toUpperCase();
  if (v === "APPROVED" || v === "ACTIVE") return "approved";
  if (v === "REJECTED" || v === "DISABLED" || v === "PAUSED") return "rejected";
  return "submitted";
};
const metaComponents = (t: Row) => [
  { type: "BODY", text: t.body, example: { body_text: [["Asha", "Your contract is ready — please read and sign it in the app", `${APP_URL}/app.html`]] } },
  { type: "FOOTER", text: t.footer },
];

async function metaCreate(t: Row) {
  const r = await fetch(`https://graph.facebook.com/${META_VER}/${WABA_ID}/message_templates`, {
    method: "POST", headers: { Authorization: `Bearer ${META_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: t.template_name, language: t.language, category: "UTILITY", components: metaComponents(t) }),
  });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (raw as any)?.error?.error_user_msg || (raw as any)?.error?.message || "Meta template create failed";
    if (/already exists|duplicate/i.test(msg)) return { status: "submitted" as const, ref: null };
    throw new Error(msg);
  }
  return { status: mapStatus((raw as any)?.status), ref: (raw as any)?.id ?? null };
}
async function metaStatus(t: Row) {
  const u = `https://graph.facebook.com/${META_VER}/${WABA_ID}/message_templates?name=${encodeURIComponent(t.template_name)}&fields=name,status,rejected_reason&access_token=${encodeURIComponent(META_TOKEN)}`;
  const raw = await (await fetch(u)).json().catch(() => ({}));
  const hit = ((raw as any)?.data || []).find((x: any) => x.name === t.template_name);
  if (!hit) return { status: "queued" as const, error: "not found at Meta — resubmitting" };
  return { status: mapStatus(hit.status), error: hit.rejected_reason && hit.rejected_reason !== "NONE" ? String(hit.rejected_reason) : null };
}
async function snaptoCreate(t: Row) {
  const headers: Record<string, string> = { "x-api-key": SNAPTO_KEY, "Content-Type": "application/json" };
  if (SNAPTO_PHONE) headers["x-phone-id"] = SNAPTO_PHONE;
  const r = await fetch(SNAPTO_URL, { method: "POST", headers,
    body: JSON.stringify({ name: t.template_name, language: t.language, category: "UTILITY", components: metaComponents(t) }) });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((raw as any)?.error?.message || (raw as any)?.detail || (raw as any)?.message || `snapto template create failed (${r.status})`);
  return { status: mapStatus((raw as any)?.status ?? (raw as any)?.data?.status), ref: (raw as any)?.id ?? (raw as any)?.data?.id ?? null };
}

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;
  const api = createClient(SUPABASE_URL, SERVICE_ROLE).schema("api");
  const { data: rows, error } = await api.rpc("wa_templates_claim", { p_limit: 20 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const done: Record<string, number> = {};
  const set = async (t: Row, status: string, provider: string | null, ref: string | null, err: string | null) => {
    await api.rpc("wa_templates_set", { p_campaign: t.campaign_id, p_status: status, p_provider: provider, p_ref: ref, p_error: err });
    done[status] = (done[status] || 0) + 1;
  };
  for (const t of (rows ?? []) as Row[]) {
    try {
      if (WABA_ID && META_TOKEN) {
        if (t.status === "submitted") { const s = await metaStatus(t); await set(t, s.status, "meta", null, s.error); }
        else { const c = await metaCreate(t); await set(t, c.status, "meta", c.ref, null); }
      } else if (SNAPTO_URL && SNAPTO_KEY) {
        if (t.status === "submitted") { await set(t, "submitted", "snapto", null, "waiting for Meta review — press Mark approved once snapto shows it approved"); }
        else { const c = await snaptoCreate(t); await set(t, c.status, "snapto", c.ref, null); }
      } else {
        await set(t, "manual", null, null, "Create this template in snapto (category Utility), or add WHATSAPP_WABA_ID + WHATSAPP_TOKEN so it is created automatically.");
      }
    } catch (e) {
      await set(t, "failed", null, null, ((e as Error).message || "template create failed").slice(0, 300));
    }
  }
  return new Response(JSON.stringify({ ok: true, processed: (rows ?? []).length, ...done }), { headers: { "Content-Type": "application/json" } });
});
