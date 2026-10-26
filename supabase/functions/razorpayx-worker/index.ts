// Edge Function: razorpayx-worker  (verify_jwt = false — deploy with --no-verify-jwt; service-role worker)
// Creator payments through RazorpayX:
//   a) new bank / UPI details → RazorpayX account validation (composite: POST /v1/fund_accounts/validations)
//   b) validations in progress → GET /v1/fund_accounts/validations/:id → verified / failed / check by hand
//   c) payouts a Super Admin QUEUED on the Payments tab → POST /v1/payouts (composite, idempotent per payout + attempt)
//   d) payouts in progress → GET /v1/payouts/:id → paid (UTR) / failed (reason)
// Keys live in Vault (Super Admin saves them on the Payments tab). RazorpayX only accepts payout + validation calls from
// allow-listed IPs: api_base is https://api.razorpay.com, or a fixed-IP relay that forwards to it unchanged.
// Nothing is sent without keys: details then wait for a Super Admin's manual check. Never logs account numbers.
// Kicked by the database (new details, queued payouts) and every 15 min by pg_cron. CI_WORKER_SECRET gates calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Prov = { key_id: string | null; key_secret: string | null; account_number: string | null; api_base: string };
type Details = { method: "bank" | "upi"; account_name: string | null; ifsc: string | null; upi_id: string | null; account_no: string | null; phone: string | null };

// RazorpayX accepts letters, digits, space . - ' in names (max 50 for contacts)
const cleanName = (s: string | null) => (s || "").replace(/[^A-Za-z0-9 .'\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "Creator";
const cleanPhone = (s: string | null) => { const d = (s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : undefined; };
// name match: RazorpayX gives 0–100
const GOOD_SCORE = 70;

async function rzp(p: Prov, method: "GET" | "POST", path: string, body?: unknown, idem?: string) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": "Basic " + btoa(`${p.key_id}:${p.key_secret}`),
    };
    if (idem) headers["X-Payout-Idempotency"] = idem;
    const r = await fetch(p.api_base.replace(/\/+$/, "") + path, { method, headers, signal: ctl.signal, body: body ? JSON.stringify(body) : undefined });
    let j: any = null; try { j = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, j };
  } finally { clearTimeout(t); }
}
const errText = (j: any, status: number) =>
  ((j?.error?.description || j?.error?.reason || j?.message || "") + "").slice(0, 200) || `RazorpayX error ${status}`;

function fundAccount(d: Details, ref: string) {
  const contact: Record<string, unknown> = { name: cleanName(d.account_name), type: "vendor", reference_id: ref.slice(0, 40) };
  const ph = cleanPhone(d.phone); if (ph) contact.contact = ph;
  return d.method === "upi"
    ? { account_type: "vpa", vpa: { address: (d.upi_id || "").trim() }, contact }
    : { account_type: "bank_account", bank_account: { name: cleanName(d.account_name), ifsc: (d.ifsc || "").toUpperCase(), account_number: d.account_no }, contact };
}

// a finished validation → valid / invalid / check by hand
function readValidation(j: any): { result: "valid" | "invalid" | "unavailable" | "pending"; name?: string | null; bank?: string | null; message?: string | null } {
  const st = (j?.status || "").toLowerCase();
  const vr = j?.validation_results || j?.results || {};
  const name = vr.registered_name || null, bank = vr.bank_account?.bank_name || null;
  if (st === "created" || st === "") return { result: "pending" };
  if (st === "failed") return { result: "unavailable", message: "automatic check failed (" + (j?.status_details?.description || "RazorpayX") + ") — verify by hand" };
  const acct = (vr.account_status || "").toLowerCase();
  if (acct === "invalid") return { result: "invalid", name, bank, message: vr.details || j?.status_details?.description || "the bank could not verify these details" };
  if (acct === "active" || acct === "valid") {
    const score = typeof vr.name_match_score === "number" ? vr.name_match_score : null;
    if (score !== null && score < GOOD_SCORE)
      return { result: "unavailable", name, bank, message: `account is valid but the name at the bank ("${name ?? "?"}") doesn't match (score ${score}) — check by hand` };
    return { result: "valid", name, bank, message: score !== null ? `name match ${score}/100` : null };
  }
  return { result: "unavailable", name, bank, message: "automatic check gave no clear answer — verify by hand" };
}

// RazorpayX payout status → ours
function readPayout(j: any): { status: "processing" | "paid" | "failed"; utr?: string | null; reason?: string | null } {
  const st = (j?.status || "").toLowerCase();
  if (st === "processed") return { status: "paid", utr: j?.utr || null };
  if (["failed", "reversed", "rejected", "cancelled"].includes(st))
    return { status: "failed", reason: (j?.status_details?.description || j?.error?.description || j?.failure_reason || st) + "" };
  return { status: "processing" };
}

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;   // fail-closed, constant-time CI_WORKER_SECRET check
  const api = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } }).schema("api");
  const { data: work, error } = await api.rpc("ops_rzp_work", { p_limit: 20 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const w = work as any; const p: Prov = w.provider;
  const ready = !!(p?.key_id && p?.key_secret && p?.account_number);
  const t = { validated: 0, manual: 0, invalid: 0, polled: 0, paid: 0, sent: 0, failed: 0, errors: 0 };
  const setResult = (pid: string, o: any) => api.rpc("ops_rzp_validation_result",
    { p_participation: pid, p_result: o.result, p_name_at_bank: o.name ?? null, p_bank_name: o.bank ?? null, p_message: o.message ?? null });

  // a) new details
  for (const d of (w.validate ?? []) as any[]) {
    try {
      if (!ready) { await setResult(d.participation_id, { result: "unavailable", message: "automatic check not set up — verify by hand" }); t.manual++; continue; }
      const { status, j } = await rzp(p, "POST", "/v1/fund_accounts/validations", {
        source_account_number: p.account_number, reference_id: ("val-" + d.participation_id).slice(0, 40),
        fund_account: fundAccount(d, "creator-" + d.participation_id),
        notes: { purpose: "Geek creator payment details" },
      });
      if (status >= 400 || !j?.id) {
        // 400 = the details themselves are wrong; anything else (keys, IP allow-list, balance) → check by hand
        const msg = errText(j, status);
        const bad = status === 400 && !/(key|auth|ip|whitelist|allowlist|balance|account_number|source)/i.test(msg);
        await setResult(d.participation_id, bad ? { result: "invalid", message: msg } : { result: "unavailable", message: `automatic check unavailable (${status}: ${msg}) — verify by hand` });
        bad ? t.invalid++ : t.manual++; continue;
      }
      const o = readValidation(j);
      if (o.result === "pending") { await api.rpc("ops_rzp_validation_started", { p_participation: d.participation_id, p_ref: j.id }); }
      else { await setResult(d.participation_id, o); o.result === "valid" ? t.validated++ : o.result === "invalid" ? t.invalid++ : t.manual++; }
    } catch (_e) { t.errors++; }
  }
  // b) validations in progress
  if (ready) for (const v of (w.validate_poll ?? []) as any[]) {
    try {
      const { status, j } = await rzp(p, "GET", "/v1/fund_accounts/validations/" + encodeURIComponent(v.ref));
      t.polled++;
      if (status >= 400) { await setResult(v.participation_id, { result: "unavailable", message: `automatic check unavailable (${status}) — verify by hand` }); t.manual++; continue; }
      const o = readValidation(j);
      if (o.result !== "pending") { await setResult(v.participation_id, o); o.result === "valid" ? t.validated++ : o.result === "invalid" ? t.invalid++ : t.manual++; }
    } catch (_e) { t.errors++; }
  }
  // c) payouts a Super Admin queued
  if (ready) for (const o of (w.pay ?? []) as any[]) {
    try {
      const mode = o.method === "upi" ? "UPI" : (Number(o.amount) > 200000 ? "NEFT" : "IMPS");
      const { status, j } = await rzp(p, "POST", "/v1/payouts", {
        account_number: p.account_number, amount: Math.round(Number(o.amount) * 100), currency: "INR", mode, purpose: "payout",
        fund_account: fundAccount(o, "creator-" + o.payout_id), queue_if_low_balance: true,
        reference_id: o.ref_code, narration: ("Geek " + (o.campaign || "campaign")).replace(/[^A-Za-z0-9 ]/g, "").slice(0, 30),
        notes: { ref: o.ref_code, part: o.part },
      }, `${o.payout_id}-${o.attempts}`);
      if (status === 429 || status >= 500) { t.errors++; continue; }   // RazorpayX busy → stays queued, same idempotency key next run
      if (status >= 400 || !j?.id) {
        await api.rpc("ops_rzp_payout_update", { p_payout: o.payout_id, p_status: "failed", p_ref: null, p_utr: null, p_reason: errText(j, status) });
        t.failed++; continue;
      }
      const s = readPayout(j);
      await api.rpc("ops_rzp_payout_update", { p_payout: o.payout_id, p_status: s.status, p_ref: j.id, p_utr: s.utr ?? null, p_reason: s.reason ?? null });
      t.sent++; if (s.status === "paid") t.paid++; if (s.status === "failed") t.failed++;
    } catch (_e) { t.errors++; /* stays queued (same idempotency key) → retried safely next run */ }
  }
  // d) payouts in progress
  if (ready) for (const o of (w.pay_poll ?? []) as any[]) {
    try {
      const { status, j } = await rzp(p, "GET", "/v1/payouts/" + encodeURIComponent(o.ref));
      if (status >= 400) continue;
      const s = readPayout(j);
      if (s.status !== "processing") {
        await api.rpc("ops_rzp_payout_update", { p_payout: o.payout_id, p_status: s.status, p_ref: o.ref, p_utr: s.utr ?? null, p_reason: s.reason ?? null });
        s.status === "paid" ? t.paid++ : t.failed++;
      }
    } catch (_e) { t.errors++; }
  }
  // counts only — never account numbers or names
  return new Response(JSON.stringify({ ok: true, keys: ready, ...t }), { headers: { "Content-Type": "application/json" } });
});
