// Edge Function: media-migrate (verify_jwt = true, Super Admin only) — one-off copy of old Supabase storage files to Cloudflare R2.
// Same key on R2: "<bucket>/<path>". Nothing is deleted from Supabase. Payment proofs are NOT copied (they stay private).
//   POST { action: "copy", bucket, offset = 0, limit = 10 }  → copies a batch (skips files already on R2 with the same size)
// File list: api.media_migrate_items() (service role only). Run on 2026-11-18: 102 files copied, 0 failed;
// then { action: "delete", bucket } removed them from Supabase (only after checking each R2 copy) — Supabase storage is empty.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const ACCOUNT = (Deno.env.get("R2_ACCOUNT_ID") || "").trim(), KEY_ID = (Deno.env.get("R2_ACCESS_KEY_ID") || "").trim(), SECRET = (Deno.env.get("R2_SECRET_ACCESS_KEY") || "").trim();
const BUCKET = (Deno.env.get("R2_BUCKET") || "geek-media").trim();
const aws = new AwsClient({ accessKeyId: KEY_ID, secretAccessKey: SECRET, service: "s3", region: "auto" });
const url = (key: string) => `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
const BUCKETS = ["campaign-files", "post-thumbs", "ig-media", "review-proofs"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SB = Deno.env.get("SUPABASE_URL")!, SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const uc = createClient(SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: "sign in" }, 401);
    const admin = createClient(SB, SR, { auth: { persistSession: false } });
    const { data: pa } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!pa) return json({ error: "Super Admin only" }, 403);
    const b = await req.json().catch(() => ({}));
    const all = ((await admin.schema("api").rpc("media_migrate_items")).data || []) as { bucket: string; name: string; size: number; type: string }[];
    const head = async (key: string) => { const r = await aws.fetch(url(key), { method: "HEAD" }); return r.ok ? Number(r.headers.get("content-length") || 0) : -1; };
    if (b.action === "delete") {
      // delete from Supabase ONLY files whose R2 copy exists with the same size (payment-proofs: only the listed unlinked files)
      const bk = String(b.bucket || "");
      if (bk === "payment-proofs") {
        const names = (Array.isArray(b.names) ? b.names : []).map(String);
        if (names.length) { const { error } = await admin.storage.from(bk).remove(names); if (error) return json({ error: error.message }, 500); }
        return json({ ok: true, bucket: bk, deleted: names });
      }
      if (!BUCKETS.includes(bk)) return json({ error: "bucket?" }, 400);
      const ok: string[] = [], kept: string[] = [];
      for (const o of all.filter((x) => x.bucket === bk)) { const h = await head(`${bk}/${o.name}`); if (h === Number(o.size) && h >= 0) ok.push(o.name); else kept.push(`${o.name} (R2 ${h} vs ${o.size})`); }
      for (let i = 0; i < ok.length; i += 50) { const { error } = await admin.storage.from(bk).remove(ok.slice(i, i + 50)); if (error) return json({ error: error.message }, 500); }
      return json({ ok: true, bucket: bk, deleted: ok.length, kept });
    }
    if (b.action !== "copy") return json({ error: "action?" }, 400);
    const bk = String(b.bucket || "");
    if (!BUCKETS.includes(bk)) return json({ error: "bucket?" }, 400);
    const os = all.filter((o) => o.bucket === bk);
    const off = Number(b.offset || 0), lim = Math.min(Number(b.limit || 10), 25);
    const res = { copied: 0, skipped: 0, failed: [] as string[] };
    for (const o of os.slice(off, off + lim)) {
      const key = `${bk}/${o.name}`, size = Number(o.size ?? -2);
      try {
        if ((await head(key)) === size) { res.skipped++; continue; }
        const { data: blob, error } = await admin.storage.from(bk).download(o.name);
        if (error || !blob) throw new Error(error?.message || "download failed");
        const r = await aws.fetch(url(key), { method: "PUT", body: blob, headers: { "content-type": o.type || blob.type || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
        if (!r.ok) throw new Error(`R2 ${r.status} ${(await r.text()).slice(0, 120)}`);
        const h = await head(key);
        if (h !== size && size >= 0) throw new Error(`size mismatch ${h} vs ${size}`);
        res.copied++;
      } catch (e) { res.failed.push(`${o.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return json({ ok: true, bucket: bk, total: os.length, next: off + lim < os.length ? off + lim : null, ...res });
  } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }
});
