// Edge Function: post-shot-read  (verify_jwt = true — the team: Super Admin, agencies, brands)
// A screenshot of a story / reel / post insights screen → the numbers on it, so nobody types them by hand.
//   POST { image: "<base64 or data: URL>", media_type?: "story"|"reel"|"post" }
//   → { ok, metrics: { views, reach, likes, comments, shares, saves, replies, link_clicks, sticker_taps, profile_visits },
//       handle?, kind?, note? }
// The numbers are only suggested: the form shows them and the person saves them (or fixes them first).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const AI_MODEL = Deno.env.get("ANTHROPIC_SHOT_MODEL") || Deno.env.get("ANTHROPIC_BOT_MODEL") || "claude-haiku-5-5";
const KEYS = ["views", "reach", "impressions", "likes", "comments", "shares", "saves", "replies", "link_clicks", "sticker_taps", "profile_visits"];

// "1,234" / "12.5K" / "1.2M" / "1.2 lakh" → a whole number
function num(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v) && v >= 0) return Math.round(v);
  const s = String(v ?? "").trim().toLowerCase().replace(/,/g, "");
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(k|m|l|lakh|cr)?$/);
  if (!m) return null;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : (m[2] === "l" || m[2] === "lakh") ? 1e5 : m[2] === "cr" ? 1e7 : 1;
  return Math.round(Number(m[1]) * mult);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const [{ data: isAdmin }, { data: member }] = await Promise.all([
      admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
      admin.from("members").select("role, status").eq("id", user.id).maybeSingle()]);
    const ok = !!isAdmin || (member && ["owner", "brand", "manager", "corporate", "agency"].includes(member.role) && (member.status ?? "active") === "active");
    if (!ok) return json({ error: "Reading screenshots is for the team." }, 403);
    if (!AI_KEY) return json({ error: "Reading screenshots isn't switched on (ANTHROPIC_API_KEY) — type the numbers in.", off: true }, 200);

    const body = await req.json().catch(() => ({}));
    let img = String(body.image || "");
    let mime = "image/png";
    const dm = img.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.*)$/i);
    if (dm) { mime = dm[1].toLowerCase().replace("jpg", "jpeg"); img = dm[2]; }
    else if (body.mime && /^image\/(png|jpeg|webp|gif)$/i.test(String(body.mime))) mime = String(body.mime).toLowerCase();
    img = img.replace(/\s+/g, "");
    if (!img || img.length < 200) return json({ error: "Add a screenshot first." }, 400);
    if (img.length > 7_000_000) return json({ error: "That screenshot is too big — crop it or send a smaller one (under 5 MB)." }, 400);
    const kind = ["story", "reel", "post"].includes(String(body.media_type)) ? String(body.media_type) : "story";

    const prompt = `This is a screenshot of Instagram insights (or the viewer list) for a ${kind}. Read the numbers shown on it.
Reply with JSON only, no other text:
{"views":n,"reach":n,"impressions":n,"likes":n,"comments":n,"shares":n,"saves":n,"replies":n,"link_clicks":n,"sticker_taps":n,"profile_visits":n,"handle":"username if visible","kind":"story|reel|post","note":"anything unclear, short"}
Rules: use null for anything not on the screenshot — never guess. "Accounts reached" = reach. "Views"/"Plays"/"Impressions" on stories = views (and impressions if both are shown separately). "Link clicks"/"Link taps" = link_clicks. "Sticker taps" = sticker_taps. "Profile activity"/"Profile visits" = profile_visits. Copy numbers exactly as shown (e.g. "1.2K" is fine).`;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    let r: Response;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ctl.signal,
        headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: AI_MODEL, max_tokens: 400, messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mime, data: img } },
          { type: "text", text: prompt }] }] }),
      });
    } finally { clearTimeout(t); }
    if (!r.ok) { console.error("post-shot-read", r.status, (await r.text()).slice(0, 300)); return json({ error: "Couldn't read this screenshot — type the numbers in." }, 200); }
    const j: any = await r.json();
    const text = String(j?.content?.find?.((x: any) => x.type === "text")?.text || "");
    const raw = text.match(/\{[\s\S]*\}/)?.[0] || "{}";
    let o: any = {}; try { o = JSON.parse(raw); } catch (_e) { o = {}; }
    const metrics: Record<string, number> = {};
    for (const k of KEYS) { const v = num(o[k]); if (v != null) metrics[k] = v; }
    if (!Object.keys(metrics).length) return json({ ok: true, metrics, note: "No numbers found on this screenshot — is it the insights screen?" });
    return json({ ok: true, metrics, handle: typeof o.handle === "string" ? o.handle.replace(/^@/, "").slice(0, 40) : null,
                  kind: ["story", "reel", "post"].includes(o.kind) ? o.kind : kind, note: typeof o.note === "string" ? o.note.slice(0, 200) : null });
  } catch (e) {
    console.error("post-shot-read", (e as Error).message);
    return json({ error: "Something went wrong — type the numbers in." }, 500);
  }
});
