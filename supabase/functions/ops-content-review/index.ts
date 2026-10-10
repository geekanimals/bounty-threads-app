// Edge Function: ops-content-review  (verify_jwt = false — service-role, called by the ops UI/worker)
// Runs an AI brief-adherence review for one submission and stores the verdict via
// intel.ci_record_content_check, so the operator sees it next to the creator's submission. The deterministic
// caption/tag check is separate (SQL: intel.ci_check_caption_tags, run on post). Dark until ANTHROPIC_API_KEY
// is set. CI_WORKER_SECRET gates calls. Body: { participation_id, submission_id?, caption?, content_url? }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getContentReviewer } from "../_shared/content_reviewer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("CI_WORKER_SECRET") || "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (WORKER_SECRET && req.headers.get("x-worker-secret") !== WORKER_SECRET) return new Response("unauthorized", { status: 401 });

  try {
    const { participation_id, submission_id, caption, content_url } = await req.json();
    if (!participation_id) return new Response(JSON.stringify({ error: "participation_id required" }), { status: 400 });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: "intel" } });

    const { data: part } = await admin.from("ci_campaign_participation").select("campaign_id").eq("participation_id", participation_id).maybeSingle();
    if (!part) return new Response(JSON.stringify({ error: "participation not found" }), { status: 404 });
    const { data: brief } = await admin.from("ci_campaign_brief").select("requirements").eq("campaign_id", part.campaign_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: dlv } = await admin.from("ci_campaign_deliverable").select("content_format,quantity").eq("participation_id", participation_id);

    let verdict = "error", findings: string[] = ["review unavailable"], model = "";
    try {
      const res = await getContentReviewer().review({ brief: brief?.requirements ?? {}, deliverables: dlv ?? [], caption, content_url });
      verdict = res.verdict; findings = res.findings; model = res.model;
    } catch (e) { findings = [(e as Error).message]; }

    await admin.rpc("ci_record_content_check", {
      p_participation: participation_id, p_subject_kind: "submission", p_subject_id: submission_id ?? null,
      p_kind: "brief_adherence", p_verdict: verdict, p_findings: findings, p_model: model || null,
    });
    return new Response(JSON.stringify({ ok: true, verdict, findings }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
