// Edge Function: instagram-publish
// Publishes a feed post (image), a Story (image or video) or a Reel (video) to the signed-in creator's
// Instagram account.
//
// Flow:
// 1. Authenticate the signed-in Supabase user
// 2. Get the creator's Instagram token from social_tokens
// 3. Create an Instagram media container
// 4. Wait until Instagram finishes processing the image
// 5. Publish the media container
//
// Request body:
// {
//   kind?: "feed" | "story" | "reel",   // default "feed" (backwards compatible)
//   image_url?: string,                 // feed: required; story: image OR video
//   video_url?: string,                 // reel: required; story: image OR video
//   caption?: string                    // ignored for stories (Instagram has no story captions)
// }
//
// Media URLs MUST be public HTTPS URLs inside the caller's own folder of the ig-media bucket
// (Instagram's servers download them directly; restricting the folder stops publishing arbitrary URLs).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json as jsonRaw } from "../_shared/cors.ts";

// every non-2xx reply is logged (reason only — never tokens) so failures are visible in the function logs
function json(body: unknown, status = 200) {
  if (status >= 400) console.warn(`instagram-publish ${status}:`, JSON.stringify(body).slice(0, 800));
  return jsonRaw(body, status);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Instagram Graph API
const GRAPH = "https://graph.instagram.com/v21.0";

/**
 * Safely read JSON from a Response.
 * Meta sometimes returns non-JSON responses, so we handle both.
 */
async function readJson(res: Response): Promise<any> {
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text,
    };
  }
}

/**
 * Extract the useful Meta error message.
 */
function getMetaError(body: any): string | null {
  return (
    body?.error?.message ||
    body?.error?.error_user_msg ||
    body?.message ||
    null
  );
}

Deno.serve(async (req: Request) => {
  // ---------------------------------------------------------
  // CORS
  // ---------------------------------------------------------

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
    // ---------------------------------------------------------
    // 1. Identify signed-in Supabase user
    // ---------------------------------------------------------

    const authHeader = req.headers.get("Authorization") || "";

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
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json(
        {
          error: "Not authenticated",
        },
        401
      );
    }

    // ---------------------------------------------------------
    // 2. Read request body
    // ---------------------------------------------------------

    const body = await req.json().catch(() => ({}));

    const kind = String(body?.kind || "feed").toLowerCase();
    const image_url: string = body?.image_url || "";
    const video_url: string = body?.video_url || "";
    const caption = kind === "story" ? "" : (body?.caption || "");

    if (!["feed", "story", "reel"].includes(kind)) {
      return json({ error: "kind must be feed, story or reel" }, 400);
    }
    if (kind === "feed" && !image_url) return json({ error: "A feed post needs an image." }, 400);
    if (kind === "reel" && !video_url) return json({ error: "A reel needs a video." }, 400);
    if (kind === "story" && !image_url && !video_url) return json({ error: "A story needs an image or a video." }, 400);
    if (image_url && video_url) return json({ error: "Send either an image or a video, not both." }, 400);

    // ---------------------------------------------------------
    // 3. Validate media URL: HTTPS + the caller's own ig-media folder
    // ---------------------------------------------------------

    const mediaUrl = image_url || video_url;
    const ownPrefix = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/ig-media/${user.id}/`;
    if (!/^https:\/\//i.test(mediaUrl) || !mediaUrl.startsWith(ownPrefix)) {
      return json(
        {
          error:
            "Upload the file through the Media Kit first — only your own uploaded media can be published.",
        },
        400
      );
    }

    // ---------------------------------------------------------
    // 4. Validate caption
    // Instagram caption limit = 2,200 characters
    // ---------------------------------------------------------

    if (typeof caption === "string" && caption.length > 2200) {
      return json(
        {
          error:
            "Caption is too long. Instagram captions can be up to 2,200 characters.",
        },
        400
      );
    }

    // ---------------------------------------------------------
    // 5. Create Supabase admin client
    // Service role is used ONLY server-side.
    // Never send this key to frontend.
    // ---------------------------------------------------------

    const admin = createClient(
      SUPABASE_URL,
      SERVICE_ROLE
    );

    // ---------------------------------------------------------
    // 6. Get Instagram token
    // ---------------------------------------------------------

    const {
      data: tokenData,
      error: tokenError,
    } = await admin
      .from("social_tokens")
      .select(
        "access_token, ig_user_id, expires_at"
      )
      .eq("member_id", user.id)
      .eq("platform", "instagram")
      .maybeSingle();

    if (tokenError) {
      return json(
        {
          error: "Could not read Instagram connection.",
          detail: tokenError.message,
        },
        500
      );
    }

    if (
      !tokenData?.access_token ||
      !tokenData?.ig_user_id
    ) {
      return json(
        {
          error: "Instagram not connected",
        },
        400
      );
    }

    // ---------------------------------------------------------
    // 7. Check token expiration
    // ---------------------------------------------------------

    if (
      tokenData.expires_at &&
      new Date(tokenData.expires_at) < new Date()
    ) {
      return json(
        {
          error:
            "Instagram token expired — please reconnect your Instagram account.",
        },
        400
      );
    }

    const accessToken = tokenData.access_token;
    const igUserId = tokenData.ig_user_id;

    // ---------------------------------------------------------
    // 8. CREATE MEDIA CONTAINER
    // ---------------------------------------------------------

    const createParams = new URLSearchParams();

    if (kind === "story") createParams.set("media_type", "STORIES");
    if (kind === "reel") createParams.set("media_type", "REELS");
    if (image_url) createParams.set("image_url", image_url);
    if (video_url) createParams.set("video_url", video_url);
    if (caption) createParams.set("caption", caption);
    createParams.set(
      "access_token",
      accessToken
    );

    const createResponse = await fetch(
      `${GRAPH}/${igUserId}/media`,
      {
        method: "POST",
        body: createParams,
      }
    );

    const container = await readJson(
      createResponse
    );

    // Instagram rejected container creation
    if (
      !createResponse.ok ||
      !container?.id
    ) {
      return json(
        {
          error:
            "Instagram rejected the media container.",
          detail:
            getMetaError(container) ||
            container,
        },
        400
      );
    }

    const containerId = container.id;

    // ---------------------------------------------------------
    // 9. WAIT FOR INSTAGRAM TO PROCESS IMAGE
    //
    // Instagram can take some time to process the image.
    // Publishing immediately can cause:
    //
    // "Media is not ready"
    // "Media container is still processing"
    //
    // So we poll the container status.
    // ---------------------------------------------------------

    let statusCode = "IN_PROGRESS";
    let lastStatus: any = null;

    // videos take much longer to process than images (stay under the Edge wall-clock limit)
    const MAX_ATTEMPTS = video_url ? 40 : 12;
    const WAIT_MS = video_url ? 3000 : 1500;

    for (
      let attempt = 0;
      attempt < MAX_ATTEMPTS;
      attempt++
    ) {
      // Wait before checking status
      await new Promise((resolve) =>
        setTimeout(resolve, WAIT_MS)
      );

      const statusUrl =
        `${GRAPH}/${containerId}` +
        `?fields=status_code,status` +
        `&access_token=${encodeURIComponent(
          accessToken
        )}`;

      const statusResponse = await fetch(
        statusUrl
      );

      lastStatus = await readJson(
        statusResponse
      );

      statusCode =
        lastStatus?.status_code ||
        lastStatus?.status ||
        statusCode;

      // -------------------------------------------------------
      // Image is ready
      // -------------------------------------------------------

      if (statusCode === "FINISHED") {
        break;
      }

      // -------------------------------------------------------
      // Instagram failed processing
      // -------------------------------------------------------

      if (
        statusCode === "ERROR" ||
        statusCode === "EXPIRED"
      ) {
        return json(
          {
            error:
              "Instagram could not process the uploaded media.",
            detail:
              getMetaError(lastStatus) ||
              lastStatus,
          },
          400
        );
      }
    }

    // ---------------------------------------------------------
    // 10. Image still not ready
    // ---------------------------------------------------------

    if (statusCode !== "FINISHED") {
      return json(
        {
          error:
            "Instagram is still processing your media. Check your Instagram in a minute — if it isn't there, try again.",
          detail: lastStatus,
          container_id: containerId,
        },
        400
      );
    }

    // ---------------------------------------------------------
    // 11. PUBLISH MEDIA CONTAINER
    // ---------------------------------------------------------

    const publishParams =
      new URLSearchParams();

    publishParams.set(
      "creation_id",
      containerId
    );

    publishParams.set(
      "access_token",
      accessToken
    );

    const publishResponse = await fetch(
      `${GRAPH}/${igUserId}/media_publish`,
      {
        method: "POST",
        body: publishParams,
      }
    );

    const published = await readJson(
      publishResponse
    );

    // ---------------------------------------------------------
    // 12. Handle Instagram publish error
    // ---------------------------------------------------------

    if (
      !publishResponse.ok ||
      !published?.id
    ) {
      return json(
        {
          error:
            "Instagram could not publish the post.",
          detail:
            getMetaError(published) ||
            published,
          container_id: containerId,
        },
        400
      );
    }

    // ---------------------------------------------------------
    // 13. SUCCESS
    // ---------------------------------------------------------

    return json(
      {
        ok: true,
        kind,
        media_id: published.id,
        container_id: containerId,
        message:
          kind === "story" ? "Instagram story published successfully."
          : kind === "reel" ? "Instagram reel published successfully."
          : "Instagram post published successfully.",
      },
      200
    );

  } catch (error) {
    // ---------------------------------------------------------
    // Unexpected server error
    // ---------------------------------------------------------

    console.error(
      "instagram-publish error:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500
    );
  }
});
