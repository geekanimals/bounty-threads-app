// Edge Function: ops-post-metrics-worker  (verify_jwt = false — service-role, invoked by a schedule/cron)
// Snapshots each campaign post's Instagram insights for 15 days after it was posted, writing a row via
// intel.ci_record_post_metric so api.get_campaign_report can show the live curve. Reads the posts to track
// from intel.ci_posts_to_track. Fetches insights with a configured IG token (IG_GRAPH_TOKEN) — the dark,
// go-live wiring swaps this for each creator's stored token (same path as ig-ingest-worker). No-ops until a
// token is set. CI_WORKER_SECRET gates manual calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("CI_WORKER_SECRET") || "";
const IG_TOKEN = Deno.env.get("IG_GRAPH_TOKEN") || "";
const IG_VER = Deno.env.get("WHATSAPP_API_VER") || "v21.0";

// map IG insight name → our column
function pick(values: Record<string, number>, keys: string[]): number | undefined {
  for (const k of keys) if (typeof values[k] === "number") return values[k];
  return undefined;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (WORKER_SECRET && req.headers.get("x-worker-secret") !== WORKER_SECRET) return new Response("unauthorized", { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: "intel" } });
  const { data: posts, error } = await admin.rpc("ci_posts_to_track", { p_limit: 100 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!IG_TOKEN) return new Response(JSON.stringify({ ok: true, skipped: (posts ?? []).length, reason: "IG_GRAPH_TOKEN not set" }), { headers: { "Content-Type": "application/json" } });

  let captured = 0, failed = 0;
  for (const p of posts ?? []) {
    if (!p.external_media_id) { continue; }
    try {
      const metricList = p.media_type === "story"
        ? "reach,impressions,replies"
        : "reach,impressions,likes,comments,shares,saved,plays,video_views";
      const url = `https://graph.facebook.com/${IG_VER}/${p.external_media_id}/insights?metric=${metricList}&access_token=${encodeURIComponent(IG_TOKEN)}`;
      const r = await fetch(url);
      const raw = await r.json();
      if (!r.ok) throw new Error(raw?.error?.message || "insights failed");
      const values: Record<string, number> = {};
      for (const m of raw?.data ?? []) values[m.name] = m?.values?.[0]?.value ?? 0;
      const metrics = {
        reach: pick(values, ["reach"]), impressions: pick(values, ["impressions"]),
        likes: pick(values, ["likes"]), comments: pick(values, ["comments"]),
        shares: pick(values, ["shares"]), saves: pick(values, ["saved"]),
        views: pick(values, ["plays", "video_views"]), raw: values,
      };
      await admin.rpc("ci_record_post_metric", { p_post: p.post_id, p_metrics: metrics, p_actor: null });
      captured++;
    } catch (_e) { failed++; }
  }
  return new Response(JSON.stringify({ ok: true, captured, failed }), { headers: { "Content-Type": "application/json" } });
});
