// Edge Function: wa-bot-worker  (verify_jwt = false — CI_WORKER_SECRET; kicked every minute by the database when a
// creator's WhatsApp message is waiting for a reply)
//
// For each waiting message (api.ops_bot_claim already checked: bot on, team has not replied, number not paused):
//   1) builds the reply from that number's LIVE data (registered? what's missing? every campaign: stage, what is stuck,
//      next step, deadline, courier, posts left; bulk invites + join link for numbers not registered yet);
//   2) optionally lets Claude rewrite it in the creator's own words (ANTHROPIC_API_KEY; facts only from step 1);
//   3) sends it on the snapto number, plus step-by-step screenshots for "how do I register / connect Instagram";
//   4) "TEAM" / complaints / anything it can't answer → tells them the team will reply, alerts the team, goes quiet.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";
import { getProvider } from "../_shared/wa_provider.ts";
import { aiPrompt, buildDraft, isHi, parseAi, STEP_IMAGES, type BotDraft } from "../_shared/wa_bot_core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const AI_MODEL = Deno.env.get("ANTHROPIC_BOT_MODEL") || "claude-haiku-5-5";
const ENV_APP_URL = (Deno.env.get("APP_URL") || "").trim().replace(/\/+$/, "");
const SNAPTO_KEY = Deno.env.get("SNAPTO_API_KEY") || "";
const SNAPTO_PHONE = Deno.env.get("SNAPTO_PHONE_ID") || "";

async function aiRewrite(question: string, draft: BotDraft, history: any[]): Promise<BotDraft | null> {
  if (!AI_KEY) return null;
  const { system, user } = aiPrompt(question, draft, history);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 800, system, messages: [{ role: "user", content: user }] }),
    });
    if (!r.ok) { console.error("bot ai", r.status, (await r.text()).slice(0, 200)); return null; }
    const j: any = await r.json();
    return parseAi(String(j?.content?.find?.((x: any) => x.type === "text")?.text || ""), draft);
  } catch (e) { console.error("bot ai error", (e as Error).message); return null; }
  finally { clearTimeout(t); }
}

// image on the snapto number (media message with a public URL)
async function sendImage(to: string, fileUrl: string, caption: string): Promise<string | null> {
  if (!SNAPTO_KEY) return null;
  const headers: Record<string, string> = { "x-api-key": SNAPTO_KEY, "Content-Type": "application/json" };
  if (SNAPTO_PHONE) headers["x-phone-id"] = SNAPTO_PHONE;
  const r = await fetch("https://app.snapto.ai/api/v1/whatsapp/sendMessage", {
    method: "POST", headers, body: JSON.stringify({ to: to.replace(/\D/g, ""), fileUrl, caption }) });
  const raw: any = await r.json().catch(() => ({}));
  if (!r.ok || raw?.success === false || raw?.error) { console.error("bot image", r.status, JSON.stringify(raw).slice(0, 200)); return null; }
  return raw?.waMessageId ?? raw?.id ?? null;
}
const imageOk = async (url: string) => {
  try { const r = await fetch(url, { method: "HEAD" }); return r.ok && /image\//.test(r.headers.get("content-type") || ""); } catch (_e) { return false; }
};

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const api = admin.schema("api");
  const wa = getProvider();
  let sent = 0, failed = 0;
  const started = Date.now();
  while (Date.now() - started < 45000) {
    const { data: jobs, error } = await api.rpc("ops_bot_claim", { p_limit: 5 });
    if (error) { console.error("bot claim", error.message); break; }
    if (!Array.isArray(jobs) || !jobs.length) break;
    for (const job of jobs) {
      const ctx = job.ctx || {};
      ctx.app_url = ENV_APP_URL || ctx.app_url || null;
      const q = String(job.question || "");
      let d = buildDraft(q, ctx);
      if (job.use_ai !== false && d.intent !== "human" && d.intent !== "thanks") {
        const better = await aiRewrite(q, d, job.history || []);
        if (better) d = better;
      }
      try {
        const refs: string[] = [];
        const r = await wa.send({ to: job.phone, text: d.reply.slice(0, 4000) });
        if (r.wamid) refs.push(r.wamid);
        let imgs = 0;
        if (d.steps && !job.images_sent_today && ctx.app_url) {
          const hi = isHi(q);
          for (const im of STEP_IMAGES[d.steps]) {
            const url = `${String(ctx.app_url).replace(/\/+$/, "")}/assets/help/${im.file}`;
            if (!(await imageOk(url))) continue;          // screenshots not uploaded yet → text steps only
            const id = await sendImage(job.phone, url, hi ? im.hi : im.en);
            if (id) { refs.push(id); imgs++; }
          }
        }
        await api.rpc("ops_bot_done", { p_job: job.job_id, p_status: "sent", p_reply: d.reply, p_refs: refs,
          p_reason: d.handoff ? "needs a person" : null, p_handoff: d.handoff, p_intent: d.intent, p_campaign: d.campaign_id, p_images: imgs });
        sent++;
      } catch (e) {
        const msg = (e as Error).message || "send failed";
        // outside WhatsApp's 24 h window or number not on WhatsApp → no point retrying
        const final = /131047|24 ?hour|re-?engagement|131026|not a valid whatsapp/i.test(msg);
        await api.rpc("ops_bot_done", { p_job: job.job_id, p_status: final ? "failed" : "queued", p_reply: d.reply, p_refs: [],
          p_reason: msg.slice(0, 280), p_handoff: false, p_intent: d.intent, p_campaign: d.campaign_id, p_images: 0 });
        failed++;
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, sent, failed }), { headers: { "Content-Type": "application/json" } });
});
