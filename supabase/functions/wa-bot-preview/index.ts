// Edge Function: wa-bot-preview  (verify_jwt = true — Super Admin only)
// "Try the bot": { phone, question } → the exact reply the WhatsApp bot would send to that number right now,
// built from the same live data (admin_bot_preview is Super Admin–gated in the database). Nothing is sent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { aiPrompt, botTurn, parseAi } from "../_shared/wa_bot_core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const AI_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const AI_MODEL = Deno.env.get("ANTHROPIC_BOT_MODEL") || "claude-haiku-5-5";
const ENV_APP_URL = (Deno.env.get("APP_URL") || "").trim().replace(/\/+$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || "").trim(), question = String(body.question || "").trim().slice(0, 1500);
    if (!phone || !question) return json({ error: "Number and question are needed" }, 400);
    const { data: chk, error } = await client.rpc("admin_bot_check", { p_phone: phone, p_question: question });
    if (error) return json({ error: error.message }, error.code === "42501" ? 403 : 400);
    const c: any = chk?.ctx || {};
    c.app_url = ENV_APP_URL || c.app_url || null;
    // the same rules the live bot follows
    const quiet = !chk?.enabled ? "The bot is OFF — turn it on to reply on WhatsApp."
      : chk?.paused_until ? `Quiet for this number till ${new Date(chk.paused_until).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (${chk.paused_reason === "team_reply" ? "the team replied" : chk.paused_reason === "handoff" ? "waiting for the team" : "paused by you"}).`
      : chk?.team_replied_at ? "Quiet: someone from the team replied to this number in the last few hours." : null;
    // menu first, like the live bot: state "" = a new chat, "menu" = menu already sent, "help"/"campaign" = in a topic
    const st = String(body.state || "");
    const turn = botTurn(question, c, st ? { state: st, last_at: new Date().toISOString() } : null);
    if (!turn.send || !turn.draft) return json({ ok: true, no_reply: turn.reason || "waiting for an option", quiet, registered: !!c.registered, name: c.name || null });
    let d = turn.draft;
    let ai = false;
    if (turn.ai && body.use_ai !== false && AI_KEY && d.intent !== "human" && d.intent !== "thanks") {
      const { system, user } = aiPrompt(question, d, []);
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: AI_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] }),
        });
        if (r.ok) {
          const j: any = await r.json();
          const better = parseAi(String(j?.content?.find?.((x: any) => x.type === "text")?.text || ""), d);
          if (better) { d = better; ai = true; }
        }
      } catch (_e) { /* rule-based reply stays */ }
    }
    return json({ ok: true, reply: d.reply, steps: d.steps, handoff: d.handoff, intent: d.intent, ai, ai_available: !!AI_KEY, quiet, ack: null, state: turn.state || null,
                  registered: !!c.registered, name: c.name || null });
  } catch (e) {
    console.error("wa-bot-preview", (e as Error).message);
    return json({ error: "Something went wrong" }, 500);
  }
});
