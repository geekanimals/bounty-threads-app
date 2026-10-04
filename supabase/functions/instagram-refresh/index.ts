// Edge Function: instagram-refresh
// verify_jwt = false

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fetchProfileBundle } from "../_shared/ig.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const GRAPH = "https://graph.instagram.com";

// Lightweight sync — followers/profile only.
// Token ko unnecessarily rotate nahi karta.
async function syncProfileOnly(admin: any, tok: any) {
  const fields =
    "user_id,username,name,account_type,followers_count,follows_count,media_count,profile_picture_url,biography,website";

  const res = await fetch(
    `${GRAPH}/me?fields=${fields}&access_token=${encodeURIComponent(tok.access_token)}`
  );

  const profile = await res.json();

  if (!res.ok || profile?.error) {
    throw new Error(
      profile?.error?.message ||
        `Instagram profile sync failed (${res.status})`
    );
  }

  const canonicalIgUserId = String(
    profile.user_id || tok.ig_user_id || ""
  );

  const now = new Date().toISOString();

  // Keep Instagram ID synchronized in both tables.
  await admin
    .from("social_tokens")
    .update({
      ig_user_id: canonicalIgUserId,
      updated_at: now,
    })
    .eq("member_id", tok.member_id)
    .eq("platform", "instagram");

  const { error } = await admin
    .from("social_accounts")
    .update({
      ig_user_id: canonicalIgUserId,
      username: profile.username ?? null,
      name: profile.name ?? null,
      account_type: profile.account_type ?? null,
      followers_count: Number(profile.followers_count || 0),
      follows_count: Number(profile.follows_count || 0),
      media_count: Number(profile.media_count || 0),
      profile_picture_url: profile.profile_picture_url ?? null,
      biography: profile.biography ?? null,
      website: profile.website ?? null,
      updated_at: now,
    })
    .eq("member_id", tok.member_id)
    .eq("platform", "instagram");

  if (error) throw error;

  return {
    followers_count: Number(profile.followers_count || 0),
    username: profile.username ?? null,
    updated_at: now,
  };
}


// Full long-lived token refresh.
async function refreshOne(admin: any, tok: any) {
  const response = await fetch(
    `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(
      tok.access_token
    )}`
  );

  const result = await response.json();

  if (result?.error) {
    throw new Error(
      result.error.message || "Instagram token refresh failed"
    );
  }

  const newToken = result.access_token || tok.access_token;

  const expiresAt = new Date(
    Date.now() + (Number(result.expires_in) || 5184000) * 1000
  ).toISOString();

  await admin
    .from("social_tokens")
    .update({
      access_token: newToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("member_id", tok.member_id)
    .eq("platform", "instagram");

  // Resolve canonical Instagram ID.
  const meRes = await fetch(
    `${GRAPH}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(
      newToken
    )}`
  );

  const me = await meRes.json();

  const canonicalIgUserId = String(
    me?.user_id || tok.ig_user_id || ""
  );

  await admin
    .from("social_tokens")
    .update({
      ig_user_id: canonicalIgUserId,
    })
    .eq("member_id", tok.member_id)
    .eq("platform", "instagram");

  await admin
    .from("social_accounts")
    .update({
      ig_user_id: canonicalIgUserId,
    })
    .eq("member_id", tok.member_id)
    .eq("platform", "instagram");

  // Full Media Kit sync.
  try {
    const {
      profile,
      media,
      avgReach,
      audience,
      mentions,
    } = await fetchProfileBundle(newToken, canonicalIgUserId);

    await admin
      .from("social_accounts")
      .update({
        username: profile.username ?? null,
        name: profile.name ?? null,
        account_type: profile.account_type ?? null,
        followers_count: Number(profile.followers_count || 0),
        follows_count: Number(profile.follows_count || 0),
        media_count: Number(profile.media_count || 0),
        profile_picture_url: profile.profile_picture_url ?? null,
        biography: profile.biography ?? null,
        website: profile.website ?? null,
        recent_media: media ?? [],
        avg_reach: avgReach,
        audience,
        mentions,
        updated_at: new Date().toISOString(),
      })
      .eq("member_id", tok.member_id)
      .eq("platform", "instagram");
  } catch (_) {
    // Profile sync is best effort.
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json(
      {
        error: "Method not allowed",
      },
      405
    );
  }

  try {
    const admin = createClient(
      SUPABASE_URL,
      SERVICE_ROLE
    );

    // =========================
    // CRON MODE
    // =========================

    const cronHeader =
      req.headers.get("x-cron-secret") || "";

    if (
      CRON_SECRET &&
      cronHeader === CRON_SECRET
    ) {
      const cutoff = new Date(
        Date.now() + 12 * 86400 * 1000
      ).toISOString();

      const { data, error } = await admin
        .from("social_tokens")
        .select("*")
        .eq("platform", "instagram")
        .lt("expires_at", cutoff);

      if (error) throw error;

      let count = 0;

      for (const tok of data || []) {
        try {
          await refreshOne(admin, tok);
          count++;
        } catch (_) {
          // Continue with next creator.
        }
      }

      return json({
        ok: true,
        mode: "cron",
        refreshed: count,
      });
    }

    // =========================
    // USER MODE
    // =========================

    const authHeader =
      req.headers.get("Authorization") || "";

    const userClient = createClient(
      SUPABASE_URL,
      ANON_KEY,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return json(
        {
          error: "Not authenticated",
        },
        401
      );
    }

    const { data: tok, error: tokenError } =
      await admin
        .from("social_tokens")
        .select("*")
        .eq("member_id", user.id)
        .eq("platform", "instagram")
        .maybeSingle();

    if (tokenError) throw tokenError;

    if (!tok) {
      return json({
        ok: true,
        skipped: "not connected",
      });
    }

    // Read optional body.
    let body: any = {};

    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }

    // =========================
    // LIGHTWEIGHT AUTO SYNC
    // =========================

    if (body?.sync_only === true) {
      try {
        const result = await syncProfileOnly(
          admin,
          tok
        );

        return json({
          ok: true,
          mode: "sync_only",
          synced: 1,
          ...result,
        });
      } catch (syncError) {
        // Token may have expired.
        // Recover once using full token refresh.
        try {
          await refreshOne(admin, tok);

          const { data: freshTok } =
            await admin
              .from("social_tokens")
              .select("*")
              .eq("member_id", user.id)
              .eq("platform", "instagram")
              .maybeSingle();

          if (!freshTok) {
            throw syncError;
          }

          const result =
            await syncProfileOnly(
              admin,
              freshTok
            );

          return json({
            ok: true,
            mode: "sync_only",
            synced: 1,
            recovered_with_token_refresh: true,
            ...result,
          });
        } catch (_) {
          throw syncError;
        }
      }
    }

    // =========================
    // NORMAL FULL REFRESH
    // =========================

    await refreshOne(admin, tok);

    return json({
      ok: true,
      mode: "full_refresh",
      refreshed: 1,
    });

  } catch (e) {
    console.error(
      "instagram-refresh error:",
      String(e)
    );

    return json(
      {
        error: String(e),
      },
      500
    );
  }
});