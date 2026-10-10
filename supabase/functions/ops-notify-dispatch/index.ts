// Edge Function: ops-notify-dispatch  (verify_jwt = false — service-role, invoked by a schedule/cron)
// Drains intel.ci_outbox: sends each queued WhatsApp / email message via the provider adapters and records
// the result. In-app notifications need no dispatch (the ci_notification row IS the in-app channel). Dark:
// does nothing until the ops layer is active and rows exist. Secret CI_WORKER_SECRET gates manual calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getProvider } from "../_shared/wa_provider.ts";
import { getEmailProvider, renderEmailHtml } from "../_shared/email_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("CI_WORKER_SECRET") || "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (WORKER_SECRET && req.headers.get("x-worker-secret") !== WORKER_SECRET) return new Response("unauthorized", { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: "intel" } });
  const limit = 50;
  const { data: rows, error } = await admin.from("ci_outbox").select("*").eq("status", "queued").order("created_at").limit(limit);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0, failed = 0;
  for (const row of rows ?? []) {
    await admin.from("ci_outbox").update({ status: "sending", attempts: (row.attempts ?? 0) + 1 }).eq("outbox_id", row.outbox_id);
    try {
      let ref: string | null = null;
      const p = row.payload || {};
      if (row.channel === "whatsapp") {
        const out = p.wa_template
          ? { to: row.to_address, template: p.wa_template as string, variables: (p.wa_vars as string[]) || [] }
          : { to: row.to_address, text: String(p.text || "") };
        const res = await getProvider().send(out as any);
        ref = res.wamid;
      } else if (row.channel === "email") {
        const html = (p.html && String(p.html).includes("<")) ? String(p.html)
          : renderEmailHtml(String(p.subject || ""), String(p.html || ""), p.action_url as string, p.action_label as string);
        const res = await getEmailProvider().send({ to: row.to_address, subject: String(p.subject || "Update"), html, text: String(p.html || "") });
        ref = res.id;
      }
      await admin.from("ci_outbox").update({ status: "sent", provider_ref: ref, sent_at: new Date().toISOString() }).eq("outbox_id", row.outbox_id);
      sent++;
    } catch (e) {
      await admin.from("ci_outbox").update({ status: "failed", last_error: (e as Error).message }).eq("outbox_id", row.outbox_id);
      failed++;
    }
  }
  return new Response(JSON.stringify({ ok: true, processed: (rows ?? []).length, sent, failed }), { headers: { "Content-Type": "application/json" } });
});
