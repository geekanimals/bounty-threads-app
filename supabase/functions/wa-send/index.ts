// Edge Function: wa-send  (verify_jwt = true — signed-in app users send into a conversation)
// Sends a WhatsApp message (free-form inside Meta's 24h window, else a template) and records it. RLS on the
// user client enforces that the caller may access the conversation; the message row is written as service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider, toE164 } from "../_shared/wa_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// the approved "campaign update" template (name · update · link) — a typed message outside WhatsApp's 24-hour window goes inside it
// (only if set — "geek_campaign_update" / "campaign_update" were never created in snapto, so they are not defaults any more)
const WA_UPDATE_TEMPLATE_ENV = (Deno.env.get("WA_UPDATE_TEMPLATE") || "").trim();
const WA_BACKUP_TEMPLATES = (Deno.env.get("WA_BACKUP_TEMPLATES") || "").split(",").map((x) => x.trim()).filter(Boolean);
// the approved Utility template every typed message can always fall back to: Hi {{1}} · campaign {{2}} · update {{3}} · {{4}}
const WA_TEAM_TEMPLATE = (Deno.env.get("WA_TEAM_TEMPLATE") || "geek_team_update").trim();
// creator-worded Utility template: Hi {{1}} · update on your application for {{2}}: {{3}} · Open the app here: {{4}}
const WA_CREATOR_TEMPLATE = (Deno.env.get("WA_CREATOR_TEMPLATE") || "geek_creator_update").trim();
const APP_URL_ENV = (Deno.env.get("APP_URL") || "").replace(/\/+$/, "");
// WhatsApp template parameters may not contain new lines / tabs / 4+ spaces
const waParam = (s: string, max = 900) => String(s || "").replace(/\s*[\r\n\t]+\s*/g, " · ").replace(/ {4,}/g, "   ").trim().slice(0, max) || "-";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const { conversation_id, to_phone, campaign_id, subject, text, template, lang, variables, components, to_name, link: linkIn, no_template } = await req.json();

    // resolve the conversation the caller is allowed to use
    let convId = conversation_id as string | undefined;
    if (!convId) {
      const e164 = toE164(to_phone || "");
      if (!/^\+[1-9]\d{7,15}$/.test(e164)) return json({ error: "conversation_id or a valid to_phone is required" }, 400);
      const { data, error } = await userClient.rpc("wa_get_or_create_conversation", { p_contact_phone: e164, p_campaign_id: campaign_id ?? null, p_subject: subject ?? null });
      if (error) throw error;
      convId = data as string;
    }
    // RLS check + fetch destination + session window (user client => denied rows are invisible)
    const { data: conv, error: cErr } = await userClient.from("wa_conversations")
      .select("id,contact_phone_e164,session_expires_at").eq("id", convId).maybeSingle();
    if (cErr) throw cErr;
    if (!conv) return json({ error: "Conversation not found or not authorised" }, 403);

    // Consent gate (WhatsApp Business policy + abuse protection): never message an opted-out number, and only
    // START a conversation (template, outside the 24h window) with a number that verified + opted in via OTP.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    // Super Admin → Settings (and the campaign's own switch): WhatsApp OFF means nothing is sent, typed by hand included
    {
      const { data: allow } = await admin.schema("api").rpc("messaging_allowed", { p_channel: "whatsapp", p_campaign: campaign_id ?? null });
      if (allow && (allow as any).ok === false) return json({ error: `WhatsApp is turned off — ${(allow as any).reason || "Settings"}. Turn it on to send.`, paused: true }, 423);
    }
    const { data: consent } = await admin.from("wa_contacts").select("opt_in_at,opt_out_at,verified_at")
      .eq("phone_e164", conv.contact_phone_e164).maybeSingle();
    // STOP is kept in two places: wa_contacts (members) and wa_phone_optout (any number, incl. creators not on the app yet)
    const { data: po } = await admin.from("wa_phone_optout").select("opt_out_at").eq("phone_e164", conv.contact_phone_e164).maybeSingle();
    const optOutAt = [consent?.opt_out_at, (po as any)?.opt_out_at].filter(Boolean).sort().pop() as string | undefined;
    // Super Admin paused this creator's messages (WhatsApp + email together)
    {
      const { data: paused } = await admin.schema("api").rpc("ops_contact_paused", { p_addr: conv.contact_phone_e164 });
      if (paused === true) return json({ error: "Messages to this creator are paused by a Super Admin. Resume them on the creator to send.", paused: true }, 423);
    }

    // the 24-hour window is per NUMBER: the creator's reply may sit on another conversation row (the webhook's own,
    // org-less one) than the one this team member writes into — any open window for this number counts
    let openWindow = !!(conv.session_expires_at && new Date(conv.session_expires_at) > new Date());
    if (!openWindow) {
      const { data: w } = await admin.from("wa_conversations").select("session_expires_at")
        .eq("contact_phone_e164", conv.contact_phone_e164).not("session_expires_at", "is", null)
        .order("session_expires_at", { ascending: false }).limit(1);
      openWindow = !!(w?.[0]?.session_expires_at && new Date(w[0].session_expires_at) > new Date());
    }

    // said STOP → nothing goes, except a typed reply when THEY wrote to us again after the STOP (their 24-hour window is open)
    if (optOutAt) {
      let wroteAfter = false;
      if (!template && openWindow) {
        const { data: ib } = await admin.from("wa_messages").select("id, wa_conversations!inner(contact_phone_e164)")
          .eq("direction", "inbound").eq("wa_conversations.contact_phone_e164", conv.contact_phone_e164).gt("created_at", optOutAt).limit(1);
        wroteAfter = !!ib?.length;
      }
      if (!wroteAfter) return json({ error: "This creator said STOP on WhatsApp — nothing is sent to them.", opted_out: true }, 403);
    }

    // "My own message" from the panel: plain typed text only — never wrapped in a template
    if (no_template && !template && !openWindow) {
      return json({ error: "They haven't written to you in the last 24 hours — WhatsApp only lets a typed message go inside that window.", window_closed: true }, 409);
    }

    let res: { wamid?: string | null } | null = null, usedTemplate: string | null = template || null;
    if (template || openWindow) {
      const out = template
        ? { to: conv.contact_phone_e164, template, lang, variables, components }
        : { to: conv.contact_phone_e164, text: String(text || "") };
      res = await getProvider().send(out as any);
    } else {
      // outside the 24-hour window a typed message can only go inside an approved template — send it in the
      // "campaign update" template (name · the message · app link), the same one every automatic update uses
      if (!String(text || "").trim()) return json({ error: "Type a message first." }, 400);
      let genTpl = WA_UPDATE_TEMPLATE_ENV, genLang = "en", appUrl = APP_URL_ENV;
      try {
        const { data: ws } = await admin.schema("api").rpc("ops_wa_settings");
        if ((ws as any)?.template) { genTpl = String((ws as any).template); genLang = String((ws as any).lang || "en"); }
        if (!appUrl && (ws as any)?.app_url) appUrl = String((ws as any).app_url).replace(/\/+$/, "");
      } catch (_e) { /* keep defaults */ }
      let name = String(to_name || "").trim() || "there";
      try {
        const { data: c2 } = await admin.from("wa_conversations").select("contact_user_id").eq("contact_phone_e164", conv.contact_phone_e164)
          .not("contact_user_id", "is", null).limit(1);
        const uid = c2?.[0]?.contact_user_id;
        if (uid && name === "there") { const { data: m } = await admin.from("members").select("name").eq("id", uid).maybeSingle(); if (m?.name) name = String(m.name); }
      } catch (_e) { /* "there" */ }
      // the panel sends each creator's own link (an invite link for someone not registered yet) — only our own app
      const own = String(linkIn || "").trim();
      const link = own && appUrl && own.startsWith(appUrl + "/") ? own : appUrl ? `${appUrl}/app.html` : "the Geek OS app";
      // 3-variable templates (name · update · link) set in Settings / secrets first, then the approved
      // geek_team_update (name · campaign · update · link) that is always there
      let campName = String(subject || "").trim();
      if (!campName && campaign_id) {
        try { const { data: c } = await admin.from("campaigns").select("name").eq("id", campaign_id).maybeSingle(); if ((c as any)?.name) campName = String((c as any).name); } catch (_e) { /* */ }
      }
      const upd = waParam(String(text));
      const tries: { t: string; lang: string; vars: string[] }[] = [
        ...[genTpl, ...WA_BACKUP_TEMPLATES].filter((t, i, a) => t && t !== WA_TEAM_TEMPLATE && a.indexOf(t) === i)
          .map((t) => ({ t, lang: t === genTpl ? genLang : "en", vars: [waParam(name, 60), upd, waParam(link, 300)] })),
        { t: WA_TEAM_TEMPLATE, lang: "en", vars: [waParam(name, 60), waParam(campName || "your campaign", 120), upd, waParam(link, 300)] },
      ];
      // the creator-worded one (name · campaign · update · link) goes first once Meta has approved it
      try {
        const { data: st } = await admin.schema("api").rpc("wa_template_status", { p_name: WA_CREATOR_TEMPLATE });
        if (st === "approved") tries.unshift({ t: WA_CREATOR_TEMPLATE, lang: "en", vars: [waParam(name, 60), waParam(campName || "your campaign", 120), upd, waParam(link, 300)] });
      } catch (_e) { /* not set up → geek_team_update */ }
      let lastErr: Error | null = null;
      for (const x of tries) {
        try {
          res = await getProvider().send({ to: conv.contact_phone_e164, template: x.t, lang: x.lang, variables: x.vars } as any);
          usedTemplate = x.t; lastErr = null; break;
        } catch (e) { lastErr = e as Error; console.error(`wa-send: template ${x.t} refused:`, (e as Error).message); }
      }
      if (!res) return json({ error: `Couldn't send it as a WhatsApp update (${(lastErr?.message || "template refused").slice(0, 160)}). Use Open in WhatsApp.` }, 502);
    }

    const { data: msg, error: mErr } = await admin.from("wa_messages").insert({
      conversation_id: convId, sender_user_id: user.id, direction: "outbound",
      body: template ? `[template:${template}]` : String(text || ""), wa_message_id: res?.wamid ?? null, status: "sent",
    }).select("id,wa_message_id").single();
    if (mErr) throw mErr;
    await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);

    return json({ ok: true, conversation_id: convId, message_id: msg.id, wa_message_id: msg.wa_message_id, via_template: !template && usedTemplate ? usedTemplate : null });
  } catch (e) {
    console.error("wa-send failed:", (e as Error).message);
    return json({ error: "Send failed. Please try again." }, 500);
  }
});
