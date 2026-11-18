// Cloudflare R2 (S3 API) — the keys live only in Edge Function secrets, never in the app.
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  (+ R2_PUBLIC_URL: the bucket's public address, R2_BUCKET: default "geek-media")
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const ACCOUNT = (Deno.env.get("R2_ACCOUNT_ID") || "").trim();
const KEY_ID = (Deno.env.get("R2_ACCESS_KEY_ID") || "").trim();
const SECRET = (Deno.env.get("R2_SECRET_ACCESS_KEY") || "").trim();
export const R2_BUCKET = (Deno.env.get("R2_BUCKET") || "geek-media").trim();
// private files (payment proofs): own bucket if R2_PRIVATE_BUCKET is set, else the same bucket under private/ with an
// unguessable name — the public link is never shown; they open only through 10-minute signed links
export const R2_PRIVATE_BUCKET = (Deno.env.get("R2_PRIVATE_BUCKET") || Deno.env.get("R2_BUCKET") || "geek-media").trim();
export const R2_PUBLIC = (Deno.env.get("R2_PUBLIC_URL") || "").trim().replace(/\/+$/, "");
export const r2Ready = () => !!(ACCOUNT && KEY_ID && SECRET);

let _c: AwsClient | null = null;
const client = () => (_c ||= new AwsClient({ accessKeyId: KEY_ID, secretAccessKey: SECRET, service: "s3", region: "auto" }));
const bucketOf = (key: string) => (key.startsWith("private/") ? R2_PRIVATE_BUCKET : R2_BUCKET);
const objUrl = (key: string) => `https://${ACCOUNT}.r2.cloudflarestorage.com/${bucketOf(key)}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** public address of a key (null for private/ keys or when no public URL is set) */
export const publicUrl = (key: string) => (R2_PUBLIC && !key.startsWith("private/") ? `${R2_PUBLIC}/${key}` : null);

export async function r2Put(key: string, body: BodyInit, contentType: string, cache = "public, max-age=31536000, immutable") {
  if (!r2Ready()) throw new Error("R2 is not set up yet");
  const r = await client().fetch(objUrl(key), { method: "PUT", body, headers: { "content-type": contentType, "cache-control": cache } });
  if (!r.ok) throw new Error(`R2 upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return { key, url: publicUrl(key) };
}
export async function r2Head(key: string) {
  const r = await client().fetch(objUrl(key), { method: "HEAD" });
  return r.ok ? { size: Number(r.headers.get("content-length") || 0), type: r.headers.get("content-type") || "" } : null;
}
/** time-limited link for a private file (payment proofs) */
export async function r2SignedGet(key: string, seconds = 600, download = false) {
  const u = new URL(objUrl(key));
  u.searchParams.set("X-Amz-Expires", String(seconds));
  if (download) u.searchParams.set("response-content-disposition", `attachment; filename="${key.split("/").pop()}"`);
  const s = await client().sign(u.toString(), { method: "GET", aws: { signQuery: true } });
  return s.url;
}
