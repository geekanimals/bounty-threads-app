// Edge Function: ops-content-review  (verify_jwt = false — service-role, called by the ops UI/worker)
// Runs an AI brief-adherence review for one submission and stores the verdict via
// intel.ci_record_content_check, so the operator sees it next to the creator's submission. The deterministic
// caption/tag check is separate (SQL: intel.ci_check_caption_tags, run on post). Dark until ANTHROPIC_API_KEY
// is set. CI_WORKER_SECRET gates calls. Body: { participation_id, submission_id?, caption?, content_url? }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";
import { getContentReviewer } from "../_shared/content_reviewer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;   // fail-closed, constant-time CI_WORKER_SECRET check

  try {
    const { participation_id, submission_id, caption, content_url } = await req.json();
    if (!participation_id) return new Response(JSON.stringify({ error: "participation_id required" }), { status: 400 });
    const api = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } }).schema("api"); // intel is not exposed
    const { data: ctx, error: cErr } = await api.rpc("ops_content_review_context", { p_participation: participation_id });
    if (cErr) throw new Error(cErr.message);
    if (!ctx?.found) return new Response(JSON.stringify({ error: "participation not found" }), { status: 404 });
    const brief = { requirements: ctx.brief }, dlv = ctx.deliverables as unknown[];

    let verdict = "error", findings: string[] = ["review unavailable"], model = "";
    try {
      const res = await getContentReviewer().review({ brief: brief?.requirements ?? {}, deliverables: dlv ?? [], caption, content_url });
      verdict = res.verdict; findings = res.findings; model = res.model;
    } catch (e) { findings = [(e as Error).message]; }

    const { error: rErr } = await api.rpc("ops_record_content_check", {
      p_participation: participation_id, p_subject_kind: "submission", p_subject_id: submission_id ?? null,
      p_kind: "brief_adherence", p_verdict: verdict, p_findings: findings, p_model: model || null,
    });
    if (rErr) throw new Error(rErr.message);
    return new Response(JSON.stringify({ ok: true, verdict, findings }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
