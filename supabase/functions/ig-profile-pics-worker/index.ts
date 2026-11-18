// Edge Function: ig-profile-pics-worker  (verify_jwt = false — CI_WORKER_SECRET, pg_cron every 6 hours)
// Keeps every connected creator's Instagram profile picture link alive.
//
// Instagram CDN picture links are signed and expire after a few days (`oe=` = expiry, hex unix time). Until now a
// creator's picture was only re-read when the creator opened the app, so inactive creators ended up with dead
// pictures (Super Admin shows initials; the agency website hides them). This worker re-reads ONLY the picture
// (+ follower count) with each creator's own stored token — no token refresh, no media/insights calls — for
// every account whose picture is missing or expires within the next 24 hours.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRow } from "../_shared/token_crypto.ts";
import { workerGuard } from "../_shared/worker_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com";
const MAX_PER_RUN = 80;
const SOON_MS = 24 * 3600 * 1000;

function pictureExpiry(url: string | null): number | null {
  if (!url) return null;
  try {
    const oe = new URL(url).searchParams.get("oe");
    return oe && /^[0-9a-f]+$/i.test(oe) ? parseInt(oe, 16) * 1000 : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: accounts, error } = await admin.from("social_accounts")
    .select("member_id, username, profile_picture_url")
    .eq("platform", "instagram").not("member_id", "is", null);
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });

  const now = Date.now();
  const due = (accounts ?? [])
    .map((a) => ({ ...a, exp: pictureExpiry(a.profile_picture_url) }))
    .filter((a) => !a.profile_picture_url || a.exp === null || a.exp < now + SOON_MS)
    .sort((a, b) => (a.exp ?? 0) - (b.exp ?? 0))          // most-dead first
    .slice(0, MAX_PER_RUN);

  let refreshed = 0, noToken = 0, failed = 0;
  for (const a of due) {
    try {
      const { data: tokRaw } = await admin.from("social_tokens").select("*")
        .eq("member_id", a.member_id).eq("platform", "instagram").maybeSingle();
      const tok = await openRow(tokRaw);
      if (!tok?.access_token || (tok.expires_at && new Date(tok.expires_at).getTime() < now)) { noToken++; continue; }
      const r = await fetch(`${GRAPH}/me?fields=username,profile_picture_url,followers_count&access_token=${encodeURIComponent(tok.access_token)}`);
      const p = await r.json().catch(() => ({}));
      if (!r.ok || p?.error || !p?.profile_picture_url) { failed++; continue; }
      const patch: Record<string, unknown> = { profile_picture_url: p.profile_picture_url };
      if (typeof p.followers_count === "number") patch.followers_count = p.followers_count;
      const { error: upErr } = await admin.from("social_accounts").update(patch)
        .eq("member_id", a.member_id).eq("platform", "instagram");
      if (upErr) failed++; else refreshed++;
    } catch (_) { failed++; }
  }
  return new Response(JSON.stringify({ ok: true, checked: (accounts ?? []).length, due: due.length, refreshed, noToken, failed }),
    { headers: { "Content-Type": "application/json" } });
});
