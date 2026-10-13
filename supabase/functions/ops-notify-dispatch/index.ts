// Edge Function: ops-notify-dispatch  (verify_jwt = false — service-role, invoked by a schedule/cron)
// Drains intel.ci_outbox: sends each queued WhatsApp / email message via the provider adapters and records
// the result. In-app notifications need no dispatch (the ci_notification row IS the in-app channel). Dark:
// does nothing until the ops layer is active and rows exist. Secret CI_WORKER_SECRET gates manual calls.
// intel is never exposed to PostgREST, so the outbox is reached only through the service-role api.ops_outbox_*
// RPCs (atomic claim — overlapping runs never double-send; failures retry with backoff).
// WhatsApp sends are mirrored into the creator's "Campaign updates" thread so delivery statuses land and the
// creator's replies show up in the app inbox. Outside Meta's 24h window a send needs an approved template;
// WA_UPDATE_TEMPLATE (one approved utility template, variables {{1}} name · {{2}} update · {{3}} link) covers every
// alert that has no template of its own; without any template the row is marked 'skipped' (in-app + email still go).
// On each authorised run the dispatcher stores its secret + project URL in Vault so pg_cron / pg_net can call it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";
import { getProvider } from "../_shared/wa_provider.ts";
import { getEmailProvider, renderEmailHtml } from "../_shared/email_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") || "").replace(/\/+$/, "");   // e.g. https://bountythreads.app
const WA_UPDATE_TEMPLATE = (Deno.env.get("WA_UPDATE_TEMPLATE") || "").trim();
const WA_UPDATE_TEMPLATE_LANG = (Deno.env.get("WA_UPDATE_TEMPLATE_LANG") || "en").trim();
// WhatsApp template parameters may not contain new lines / tabs / 4+ spaces
const waParam = (s: string, max = 900) => String(s || "").replace(/\s*[\r\n\t]+\s*/g, " · ").replace(/ {4,}/g, "   ").trim().slice(0, max) || "-";

// app nav key ('mycampaigns') → absolute deep link the app opens on boot (app.html?go=<route>)
function deepLink(route?: string | null): string | null {
  if (!route) return null;
  if (/^https?:\/\//.test(route)) return route;
  return APP_URL ? `${APP_URL}/app.html?go=${encodeURIComponent(route)}` : null;
}

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;   // fail-closed, constant-time CI_WORKER_SECRET check

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const api = admin.schema("api");
  // let the database call us (instant kick on new alerts + 1-minute cron); best-effort, idempotent
  try { await api.rpc("ops_register_worker", { p_secret: Deno.env.get("CI_WORKER_SECRET") || "", p_url: SUPABASE_URL }); } catch (_e) { /* ignore */ }
  // WhatsApp alerts parked while the template awaits Meta approval are retried every 10 minutes
  try { await api.rpc("ops_outbox_requeue_waiting"); } catch (_e) { /* ignore */ }
  const { data: rows, error } = await api.rpc("ops_outbox_claim", { p_limit: 50 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0, failed = 0, skipped = 0;
  for (const row of (rows ?? []) as any[]) {
    const p = row.payload || {};
    const link = deepLink(p.action_route ?? p.action_url);
    try {
      let ref: string | null = null;
      if (row.channel === "whatsapp") {
        // re-check consent at send time (the user may have opted out after the row was queued)
        const { data: contact } = await admin.from("wa_contacts").select("opt_out_at").eq("phone_e164", row.to_address).maybeSingle();
        if (contact?.opt_out_at) { await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "skipped", p_error: "opted out" }); skipped++; continue; }

        const { data: windows } = await admin.from("wa_conversations").select("session_expires_at")
          .eq("contact_phone_e164", row.to_address).not("session_expires_at", "is", null)
          .order("session_expires_at", { ascending: false }).limit(1);
        const open = !!(windows?.[0]?.session_expires_at && new Date(windows[0].session_expires_at) > new Date());
        const text = [p.title, p.text].filter(Boolean).join("\n\n") + (link ? `\n\n${p.action_label || "Open"}: ${link}` : "");

        let out: Record<string, unknown>;
        if (open) out = { to: row.to_address, text };
        else if (p.wa_template) out = { to: row.to_address, template: String(p.wa_template), variables: (p.wa_vars as string[]) || [] };
        else if (WA_UPDATE_TEMPLATE) {
          let name = "there";
          try {
            const { data: m } = await admin.from("members").select("name").eq("id", row.recipient_member_id).maybeSingle();
            if (m?.name) name = String(m.name).split(" ")[0];
          } catch (_e) { /* keep default */ }
          out = { to: row.to_address, template: WA_UPDATE_TEMPLATE, lang: WA_UPDATE_TEMPLATE_LANG,
                  variables: [waParam(name, 60), waParam([p.title, p.text].filter(Boolean).join(" — ")), waParam(link || APP_URL || "the app", 300)] };
        } else {
          await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "skipped", p_error: "WhatsApp 24h window closed — set WA_UPDATE_TEMPLATE to an approved template" });
          skipped++; continue;
        }
        const res = await getProvider().send(out as any);
        ref = res.wamid;

        // mirror into the creator's thread (best-effort: the send already happened)
        try {
          const { data: convId } = await admin.rpc("wa_system_conversation", { p_user: row.recipient_member_id, p_phone: row.to_address });
          if (convId) {
            await admin.from("wa_messages").insert({ conversation_id: convId, sender_user_id: null, direction: "outbound",
              body: open ? text : [p.title, p.text].filter(Boolean).join("\n\n"), wa_message_id: ref, status: "sent" });
            await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
          }
        } catch (_e) { /* mirroring never blocks delivery */ }
      } else if (row.channel === "email") {
        const html = (p.html && String(p.html).includes("<")) ? String(p.html)
          : renderEmailHtml(String(p.subject || ""), String(p.html || ""), link ?? undefined, p.action_label as string);
        const res = await getEmailProvider().send({ to: row.to_address, subject: String(p.subject || "Update"), html,
          text: String(p.html || "") + (link ? `\n\n${link}` : "") });
        ref = res.id;
      }
      await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "sent", p_provider_ref: ref });
      sent++;
    } catch (e) {
      const msg = (e as Error).message || "send failed";
      if (row.channel === "whatsapp" && /template[^]*?(not active|pending|not approved|in review)/i.test(msg)) {
        // template still with Meta — park it; it is re-queued automatically and goes out once approved
        await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "skipped", p_error: `Waiting for WhatsApp template approval — ${msg}`.slice(0, 300) });
        skipped++;
      } else {
        await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "failed", p_error: msg });
        failed++;
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, processed: (rows ?? []).length, sent, failed, skipped }), { headers: { "Content-Type": "application/json" } });
});
