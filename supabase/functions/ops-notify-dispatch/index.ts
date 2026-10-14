// Edge Function: ops-notify-dispatch  (verify_jwt = false — service-role, invoked by a schedule/cron)
// Drains intel.ci_outbox: sends each queued WhatsApp / email message via the provider adapters and records
// the result. In-app notifications need no dispatch (the ci_notification row IS the in-app channel).
// intel is never exposed to PostgREST, so the outbox is reached only through the service-role api.ops_outbox_*
// RPCs (atomic claim — overlapping runs never double-send; failures retry with backoff).
//
// Unsubscribe: every email carries a one-click unsubscribe link (+ List-Unsubscribe header) and every WhatsApp
// update says "Reply STOP" + a link. Choices are re-checked at send time. Login / recovery OTPs never come
// through here, so they keep working after someone unsubscribes.
//
// WhatsApp outside Meta's 24h window needs an approved template. Order of preference:
//   1) the alert's own template (payload.wa_template)  2) the campaign's own UTILITY template (wa-template-sync)
//   3) WA_UPDATE_TEMPLATE (one generic approved template).  None approved yet → the message is held and re-sent
//   automatically as soon as one is approved (in-app + email still go straight away).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";
import { getProvider } from "../_shared/wa_provider.ts";
import { getEmailProvider, renderEmailHtml } from "../_shared/email_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") || "https://bountythreads.app").replace(/\/+$/, "");   // e.g. https://bountythreads.app
const WA_UPDATE_TEMPLATE = (Deno.env.get("WA_UPDATE_TEMPLATE") || "").trim();
const WA_UPDATE_TEMPLATE_LANG = (Deno.env.get("WA_UPDATE_TEMPLATE_LANG") || "en").trim();
// WhatsApp template parameters may not contain new lines / tabs / 4+ spaces
const waParam = (s: string, max = 900) => String(s || "").replace(/\s*[\r\n\t]+\s*/g, " · ").replace(/ {4,}/g, "   ").trim().slice(0, max) || "-";

function deepLink(route?: string | null): string | null {
  if (!route) return null;
  if (/^https?:\/\//.test(route)) return route;
  if (route.startsWith("/")) return APP_URL ? `${APP_URL}${route}` : null;   // e.g. /app.html?cinv=<invite token>
  return APP_URL ? `${APP_URL}/app.html?go=${encodeURIComponent(route)}` : null;
}
function unsubLink(token: string | undefined, channel: "email" | "whatsapp"): string | null {
  if (!token || !APP_URL) return null;
  return `${APP_URL}/unsubscribe.html?t=${encodeURIComponent(token)}&c=${channel}`;
}

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const api = admin.schema("api");
  try { await api.rpc("ops_register_worker", { p_secret: Deno.env.get("CI_WORKER_SECRET") || "", p_url: SUPABASE_URL }); } catch (_e) { /* ignore */ }
  try { await api.rpc("ops_outbox_requeue_waiting"); } catch (_e) { /* ignore */ }
  const { data: rows, error } = await api.rpc("ops_outbox_claim", { p_limit: 50 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  // the generic update template: set by the Super Admin in the app, else the WA_UPDATE_TEMPLATE secret
  let genTpl = WA_UPDATE_TEMPLATE, genLang = WA_UPDATE_TEMPLATE_LANG;
  try { const { data: ws } = await api.rpc("ops_wa_settings"); if (ws?.template) { genTpl = String(ws.template); genLang = String(ws.lang || "en"); } } catch (_e) { /* keep env */ }
  const prefsCache = new Map<string, any>();
  const prefsOf = async (member?: string | null) => {
    if (!member) return {};
    if (!prefsCache.has(member)) {
      const { data } = await api.rpc("ops_recipient_prefs", { p_member: member });
      prefsCache.set(member, data || {});
    }
    return prefsCache.get(member);
  };

  let sent = 0, failed = 0, skipped = 0;
  for (const row of (rows ?? []) as any[]) {
    const p = row.payload || {};
    const link = deepLink(p.action_route ?? p.action_url);
    const prefs = await prefsOf(row.recipient_member_id);
    try {
      let ref: string | null = null;
      if (row.channel === "whatsapp") {
        // re-check consent at send time (the user may have opted out after the row was queued)
        const { data: contact } = await admin.from("wa_contacts").select("opt_out_at").eq("phone_e164", row.to_address).maybeSingle();
        if (contact?.opt_out_at || prefs.wa_off) { await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "skipped", p_error: "opted out" }); skipped++; continue; }

        const { data: windows } = await admin.from("wa_conversations").select("session_expires_at")
          .eq("contact_phone_e164", row.to_address).not("session_expires_at", "is", null)
          .order("session_expires_at", { ascending: false }).limit(1);
        const open = !!(windows?.[0]?.session_expires_at && new Date(windows[0].session_expires_at) > new Date());
        const stop = unsubLink(prefs.token, "whatsapp");
        const text = [p.title, p.text].filter(Boolean).join("\n\n") + (link ? `\n\n${p.action_label || "Open"}: ${link}` : "")
          + `\n\n— Reply STOP to stop WhatsApp updates${stop ? ` (or tap ${stop})` : ""}. Login codes still come.`;
        const name = waParam(prefs.name || p.to_name || "there", 60);
        const update = waParam([p.title, p.text].filter(Boolean).join(" — "));
        const target = waParam(link || APP_URL || "the app", 300);

        // every way this update can go out, best first. A template that fails (not approved yet, wrong language,
        // wrong variable count…) no longer blocks the update: the next option is tried.
        const tries: Record<string, unknown>[] = [];
        if (open && !p.force_template) tries.push({ to: row.to_address, text });
        if (p.wa_template) tries.push({ to: row.to_address, template: String(p.wa_template), variables: (p.wa_vars as string[]) || [] });
        if (row.campaign_id) {
          const { data: t } = await api.rpc("ops_wa_template_for", { p_campaign: row.campaign_id });
          if (t?.name) tries.push({ to: row.to_address, template: String(t.name), lang: String(t.lang || "en"), variables: [name, update, target] });
        }
        if (genTpl) tries.push({ to: row.to_address, template: genTpl, lang: genLang, variables: [name, update, target] });
        if (!tries.length) {
          await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "skipped",
            p_error: "WhatsApp 24h window closed — no approved update template yet. Super Admin → WhatsApp & email → set the template name (it goes out automatically then)" });
          skipped++; continue;
        }
        const errs: string[] = [];
        let res: { wamid: string | null } | null = null;
        for (const out of tries) {
          // a language mismatch ("en" vs "en_US") is the commonest template error — try the other code too
          const langs = "template" in out ? [String(out.lang || "en"), String(out.lang || "en") === "en" ? "en_US" : "en"] : [""];
          for (const lang of langs) {
            try { res = await getProvider().send(("template" in out ? { ...out, lang } : out) as any); break; }
            catch (e) {
              const m = (e as Error).message || "send failed";
              errs.push(("template" in out ? `${out.template}/${lang}: ` : "text: ") + m);
              if (!/language|translation|132001/i.test(m)) break;
            }
          }
          if (res) break;
        }
        if (!res) throw new Error(errs.join(" | ").slice(0, 600));
        ref = res.wamid;

        try {
          const { data: convId } = await admin.rpc("wa_system_conversation", { p_user: row.recipient_member_id, p_phone: row.to_address });
          if (convId) {
            await admin.from("wa_messages").insert({ conversation_id: convId, sender_user_id: null, direction: "outbound",
              body: open ? text : [p.title, p.text].filter(Boolean).join("\n\n"), wa_message_id: ref, status: "sent" });
            await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
          }
        } catch (_e) { /* mirroring never blocks delivery */ }
      } else if (row.channel === "email") {
        if (prefs.email_off) { await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "skipped", p_error: "unsubscribed" }); skipped++; continue; }
        const unsub = unsubLink(prefs.token, "email");
        const html = (p.html && String(p.html).includes("<")) ? String(p.html)
          : renderEmailHtml(String(p.subject || ""), String(p.html || ""), link ?? undefined, p.action_label as string, unsub ?? undefined);
        const res = await getEmailProvider().send({ to: row.to_address, subject: String(p.subject || "Update"), html,
          text: String(p.html || "") + (link ? `\n\n${link}` : "") + (unsub ? `\n\nStop update emails: ${unsub}` : ""),
          headers: unsub ? { "List-Unsubscribe": `<${unsub}>` } : undefined });
        ref = res.id;
      }
      await api.rpc("ops_outbox_complete", { p_outbox_id: row.outbox_id, p_status: "sent", p_provider_ref: ref });
      sent++;
    } catch (e) {
      const msg = (e as Error).message || "send failed";
      if (row.channel === "whatsapp" && (/template[^]*?(not active|pending|not approved|in review|does not exist|not found|paused|disabled)/i.test(msg) || /#132\d{3}/.test(msg))) {
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
