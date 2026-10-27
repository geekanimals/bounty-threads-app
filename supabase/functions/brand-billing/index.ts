// Edge Function: brand-billing  (verify_jwt = false — deploy with --no-verify-jwt; "webhook" comes from Razorpay,
// every other action checks the caller's sign-in itself)
// Brand bills paid online through Razorpay Payment Links:
//   { action: "pay",   invoice_id }  → (brand login of that brand, not view-only; or the Super Admin) a Razorpay payment link
//                                       for the bill (made once, reused) → { url }
//   { action: "check", invoice_id? } → asks Razorpay whether the link (or every open link) was paid → bill marked paid
//   { action: "status" }             → is online payment set up (keys work)
//   POST ?webhook=1 (Razorpay)       → payment_link.paid → bill marked paid at once (needs RAZORPAY_WEBHOOK_SECRET)
// Secrets: RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET (the same Razorpay account), optional RAZORPAY_WEBHOOK_SECRET, APP_URL.
// Without the webhook the bill is still marked paid: the brand comes back from Razorpay to Billing, which checks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KEY_ID = (Deno.env.get("RAZORPAY_KEY_ID") || "").trim();
const KEY_SECRET = (Deno.env.get("RAZORPAY_KEY_SECRET") || "").trim();
const HOOK_SECRET = (Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "").trim();
const APP_URL = (Deno.env.get("APP_URL") || "").trim().replace(/\/+$/, "");
const RZP = "https://api.razorpay.com/v1";

const rzp = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(RZP + path, {
    method, headers: { Authorization: "Basic " + btoa(`${KEY_ID}:${KEY_SECRET}`), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j: j as any };
};
const rzpErr = (j: any, s: number) => j?.error?.description || j?.error?.reason || `Razorpay said ${s}`;

async function hmacHex(secret: string, data: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const safeEq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const api = admin.schema("api");
  try {
    // ---- Razorpay webhook (signed with the webhook secret)
    if (new URL(req.url).searchParams.get("webhook")) {
      const raw = await req.text();
      if (!HOOK_SECRET) return json({ error: "webhook secret not set" }, 400);
      const sig = req.headers.get("x-razorpay-signature") || "";
      if (!safeEq(await hmacHex(HOOK_SECRET, raw), sig)) return json({ error: "bad signature" }, 401);
      const ev = JSON.parse(raw || "{}");
      if (ev?.event === "payment_link.paid") {
        const link = ev?.payload?.payment_link?.entity, pay = ev?.payload?.payment?.entity;
        const inv = link?.notes?.invoice_id;
        if (inv) await api.rpc("ops_invoice_paid", { p_invoice: inv, p_payment_id: pay?.id || link?.id, p_amount: (Number(link?.amount_paid ?? pay?.amount) || 0) / 100 || null });
      }
      return json({ ok: true });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: "Please sign in." }, 401);

    if (!KEY_ID || !KEY_SECRET) {
      await api.rpc("ops_billing_online", { p_ok: false, p_mode: null, p_error: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set" });
      return json({ error: "Online payment isn't switched on yet — pay by bank transfer / UPI using the details on the bill, and the Geek team marks it paid.", not_configured: true });
    }
    const mode = KEY_ID.startsWith("rzp_test_") ? "test" : "live";

    if (action === "status") {
      const { status, j } = await rzp("GET", "/payment_links?count=1");
      const ok = status < 400;
      await api.rpc("ops_billing_online", { p_ok: ok, p_mode: mode, p_error: ok ? null : rzpErr(j, status) });
      return json({ ok, mode, error: ok ? null : rzpErr(j, status) });
    }

    // ask Razorpay about one link (or every open one) and mark paid bills
    const checkOne = async (invoice: string, linkId: string) => {
      const { status, j } = await rzp("GET", `/payment_links/${encodeURIComponent(linkId)}`);
      if (status >= 400) return { invoice, status: "error", error: rzpErr(j, status) };
      if (j?.status === "paid") {
        const payId = (j?.payments || []).find((p: any) => p?.status === "captured")?.payment_id || (j?.payments || [])[0]?.payment_id || linkId;
        await api.rpc("ops_invoice_paid", { p_invoice: invoice, p_payment_id: payId, p_amount: (Number(j?.amount_paid) || 0) / 100 || null });
        return { invoice, status: "paid" };
      }
      return { invoice, status: j?.status || "created" };
    };

    if (action === "check") {
      const { data: open } = await api.rpc("ops_invoices_open_links");
      const list = ((open || []) as any[]).filter((x) => !body.invoice_id || x.invoice_id === body.invoice_id).slice(0, 25);
      const out = [];
      for (const x of list) out.push(await checkOne(x.invoice_id, x.link_id));
      await api.rpc("ops_billing_online", { p_ok: true, p_mode: mode, p_error: null });
      return json({ ok: true, checked: out });
    }

    if (action === "pay") {
      const inv = String(body?.invoice_id || "");
      const { data: b, error: be } = await api.rpc("ops_invoice_for_payer", { p_member: user.id, p_invoice: inv });
      if (be) return json({ error: be.message }, 403);
      const bill = b as any;
      if (bill.status !== "requested") return json({ error: bill.status === "paid" ? "This bill is already paid." : "This bill was cancelled." });
      if (bill.rzp_link_id && bill.rzp_link_url) {
        const c = await checkOne(inv, bill.rzp_link_id);
        if (c.status === "paid") return json({ paid: true });
        if (["created", "partially_paid"].includes(String(c.status))) return json({ ok: true, url: bill.rzp_link_url });
      }
      const origin = APP_URL || (req.headers.get("origin") || "").replace(/\/+$/, "");
      const payer = bill.payer || {};
      const { status, j } = await rzp("POST", "/payment_links", {
        amount: Math.round(Number(bill.total) * 100), currency: bill.currency || "INR", accept_partial: false,
        description: `${bill.invoice_no} · ${String(bill.title).slice(0, 120)}`,
        reference_id: `${bill.invoice_no}-${Date.now().toString(36)}`.slice(0, 40),
        customer: { name: String(bill.buyer?.name || payer.name || "Brand").slice(0, 100), email: payer.email || undefined, contact: payer.phone || undefined },
        notify: { sms: false, email: false }, reminder_enable: false,
        notes: { invoice_id: inv, invoice_no: bill.invoice_no },
        callback_url: origin ? `${origin}/app.html?door=brand&go=billing&rzpbill=${inv}` : undefined, callback_method: origin ? "get" : undefined,
      });
      if (status >= 400 || !j?.short_url) {
        await api.rpc("ops_billing_online", { p_ok: false, p_mode: mode, p_error: rzpErr(j, status) });
        return json({ error: `Couldn't start the payment: ${rzpErr(j, status)}` });
      }
      await api.rpc("ops_invoice_link", { p_invoice: inv, p_link_id: j.id, p_url: j.short_url });
      await api.rpc("ops_billing_online", { p_ok: true, p_mode: mode, p_error: null });
      return json({ ok: true, url: j.short_url });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("brand-billing", (e as Error).message);
    return json({ error: "Something went wrong — please try again." }, 500);
  }
});
