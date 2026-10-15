// Edge Function: ai-chat  (verify_jwt = true)
// Campaign Helper — NO outside AI (OpenAI removed). Answers come only from the backend's own data for that
// creator's campaign: brief, video brief, contract, current step, deadline, courier/tracking, review note.
// The data is read here with the creator's own login, so nothing the browser sends is trusted as facts.
//
//   { participation_id, messages }  → answer about that one campaign
//   { messages, context }           → (sidebar) finds the campaign the question names, else the one that
//                                     needs action; brands / agencies get a short how-to answer
// No secrets needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { campaignHelperAnswer, isHinglish } from "../_shared/campaign_helper_core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ACTION_ORDER = ["changes_requested", "content_created", "contract_sent", "contract_signed", "content_approved", "product_sent", "invited",
  "content_submitted", "address_confirmed", "published", "brand_confirmed", "accepted", "sent_to_brand", "shortlisted", "eligible", "applied", "completed"];

const lastUserText = (messages: unknown) =>
  String((Array.isArray(messages) ? [...messages].reverse().find((m: any) => m?.role === "user")?.content : "") || "").slice(0, 1000);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const ctx = body.context || {};
    const partId = String(body.participation_id || "").trim();
    const q = lastUserText(body.messages);
    const hi = isHinglish(q);

    const { data } = await userClient.schema("api").rpc("get_my_campaigns");
    const mine: any[] = Array.isArray(data) ? data : [];

    let c: any = null;
    if (partId) {
      c = mine.find((x) => x.participation_id === partId);
      if (!c) return json({ error: "That campaign isn't on your account." }, 404);
    } else if (mine.length) {
      const ql = q.toLowerCase();
      c = mine.find((x) => [x.campaign, x.brand, x.product].some((n) => n && String(n).length > 2 && ql.includes(String(n).toLowerCase())))
        || [...mine].sort((a, b) => (ACTION_ORDER.indexOf(a.stage) + 1 || 99) - (ACTION_ORDER.indexOf(b.stage) + 1 || 99))[0];
    }

    if (!c) {
      const reply = ctx.role && ctx.role !== "creator"
        ? (hi ? "Main campaign ke sawaalon ka jawab deta hoon. Naya campaign: **Campaigns → New campaign**. Creators jodne ke liye campaign kholo → **Bulk upload** (sheet ka template wahin hai). Har step ka update creators ko WhatsApp + email + app pe apne aap jaata hai."
              : "I answer campaign questions. New campaign: **Campaigns → New campaign**. To add creators open the campaign → **Bulk upload** (the sheet template is there). Every step's update reaches creators on WhatsApp + email + the app automatically.")
        : (hi ? "Abhi aapke account pe koi campaign nahi hai. **Campaigns** mein jaake apply karo — select hote hi har update WhatsApp pe aayega."
              : "You don't have a campaign yet. Go to **Campaigns** and apply — once selected, every update comes on WhatsApp.");
      return json({ ok: true, reply, source: "backend" });
    }

    const { data: k } = await userClient.schema("api").rpc("get_my_contract", { p_participation: c.participation_id });
    const ans = campaignHelperAnswer(q, c, k ?? null);
    const head = !partId && mine.length > 1 ? `📌 **${c.campaign}${c.brand ? " · " + c.brand : ""}**\n\n` : "";
    return json({ ok: true, reply: head + ans.reply, intents: ans.intents, suggestions: ans.suggestions, source: "backend" });
  } catch (e) {
    console.error("ai-chat error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
