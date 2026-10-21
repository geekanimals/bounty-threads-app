// Edge Function: wa-bot-answer  (verify_jwt = false — called by the snapto chatbot; secret header x-bot-key)
//
// The snapto Advanced Chatbot "Geek Creator Help Bot" calls this on every creator message (System Api Call node):
//   POST { "phone": "{{receiver_number}}", "name": "{{display_name}}" }   header x-bot-key: <BOT_API_KEY>
// We read the creator's new message(s) from our WhatsApp inbox (wa-webhook stores them), check the team / pause
// rules, build the answer from that number's LIVE data (wa_bot_core), and return it flat for the chatbot:
//   { "send": "yes"|"no", "reply": "...", "handoff": "yes"|"no", "why": "..." }
// The chatbot's Message node sends {{bt.reply}} when send = yes. Step screenshots go a few seconds later from here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { constantTimeEqual } from "../_shared/worker_auth.ts";
import { aiPrompt, buildDraft, isHi, parseAi, STEP_IMAGES, type BotDraft } from "../_shared/wa_bot_core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_KEY = Deno.env.get("BOT_API_KEY") || "";
const AI_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const AI_MODEL = Deno.env.get("ANTHROPIC_BOT_MODEL") || "claude-haiku-5-5";
const ENV_APP_URL = (Deno.env.get("APP_URL") || "").trim().replace(/\/+$/, "");
const SNAPTO_KEY = Deno.env.get("SNAPTO_API_KEY") || "";
const SNAPTO_PHONE = Deno.env.get("SNAPTO_PHONE_ID") || "";

const out = (o: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function aiRewrite(question: string, draft: BotDraft, history: any[]): Promise<BotDraft | null> {
  if (!AI_KEY) return null;
  const { system, user } = aiPrompt(question, draft, history);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);   // the chatbot waits for us
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] }),
    });
    if (!r.ok) { console.error("bot ai", r.status, (await r.text()).slice(0, 200)); return null; }
    const j: any = await r.json();
    return parseAi(String(j?.content?.find?.((x: any) => x.type === "text")?.text || ""), draft);
  } catch (e) { console.error("bot ai error", (e as Error).message); return null; }
  finally { clearTimeout(t); }
}

async function sendImage(to: string, fileUrl: string, caption: string): Promise<string | null> {
  if (!SNAPTO_KEY) return null;
  const headers: Record<string, string> = { "x-api-key": SNAPTO_KEY, "Content-Type": "application/json" };
  if (SNAPTO_PHONE) headers["x-phone-id"] = SNAPTO_PHONE;
  try {
    const r = await fetch("https://app.snapto.ai/api/v1/whatsapp/sendMessage", {
      method: "POST", headers, body: JSON.stringify({ to: to.replace(/\D/g, ""), fileUrl, caption }) });
    const raw: any = await r.json().catch(() => ({}));
    if (!r.ok || raw?.success === false || raw?.error) { console.error("bot image", r.status, JSON.stringify(raw).slice(0, 200)); return null; }
    return raw?.waMessageId ?? raw?.id ?? null;
  } catch (_e) { return null; }
}
const imageOk = async (url: string) => {
  try { const r = await fetch(url, { method: "HEAD" }); return r.ok && /image\//.test(r.headers.get("content-type") || ""); } catch (_e) { return false; }
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return out({ send: "no", reply: "", why: "POST only" }, 405);
  const url = new URL(req.url);
  const key = req.headers.get("x-bot-key") || url.searchParams.get("key") || "";
  if (BOT_KEY.length < 32) return out({ send: "no", reply: "", why: "BOT_API_KEY not set" }, 503);
  if (!constantTimeEqual(key, BOT_KEY)) return out({ send: "no", reply: "", why: "unauthorized" }, 401);

  const body: any = await req.json().catch(() => ({}));
  const phone = String(body.phone || body.receiver_number || url.searchParams.get("phone") || "").trim();
  const text = typeof body.text === "string" ? body.text : (typeof body.message === "string" ? body.message : null);
  if (!phone) return out({ send: "no", reply: "", why: "no phone" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const api = admin.schema("api");
  // the webhook may store the message a moment after snapto calls us — wait up to ~5 s for it
  let job: any = null;
  for (let i = 0; i < 6; i++) {
    const { data, error } = await api.rpc("ops_bot_answer", { p_phone: phone, p_text: text });
    if (error) { console.error("bot answer", error.message); return out({ send: "no", reply: "", why: "db error" }); }
    job = data;
    if (job?.go || !job?.retry) break;
    await sleep(900);
  }
  if (!job?.go) return out({ send: "no", reply: "", handoff: "no", why: String(job?.why || "skip") });

  const ctx = job.ctx || {};
  ctx.app_url = ENV_APP_URL || ctx.app_url || null;
  const q = String(job.question || "");
  let d = buildDraft(q, ctx);
  if (job.use_ai !== false && d.intent !== "human" && d.intent !== "thanks") {
    const better = await aiRewrite(q, d, job.history || []);
    if (better) d = better;
  }
  const reply = d.reply.slice(0, 4000);
  await api.rpc("ops_bot_done", { p_job: job.job_id, p_status: "sent", p_reply: reply, p_refs: [],
    p_reason: d.handoff ? "needs a person" : "sent by the snapto chatbot", p_handoff: d.handoff, p_intent: d.intent, p_campaign: d.campaign_id, p_images: 0 });

  // step-by-step screenshots after the chatbot's text (only once a day per number)
  if (d.steps && !job.images_sent_today && ctx.app_url) {
    const steps = d.steps, to = String(job.phone), hi = isHi(q), base = String(ctx.app_url).replace(/\/+$/, "");
    const task = (async () => {
      await sleep(5000);
      const refs: string[] = []; let n = 0;
      for (const im of STEP_IMAGES[steps]) {
        const u = `${base}/assets/help/${im.file}`;
        if (!(await imageOk(u))) continue;
        const id = await sendImage(to, u, hi ? im.hi : im.en);
        if (id) refs.push(id);
        n++;
        await sleep(700);
      }
      if (n) await api.rpc("ops_bot_images", { p_job: job.job_id, p_count: n, p_refs: refs });
    })();
    // keep running after the response (Supabase Edge Runtime)
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(task); else await task;
  }
  return out({ send: "yes", reply, handoff: d.handoff ? "yes" : "no", intent: d.intent, why: "" });
});
