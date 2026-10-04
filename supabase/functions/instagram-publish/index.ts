// Edge Function: instagram-publish
// Publishes an image post to the signed-in creator's Instagram account.
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
//   image_url: string,
//   caption?: string
// }
//
// image_url MUST be a public HTTPS URL because Instagram's servers
// need to download the image directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

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

    const body = await req.json();

    const image_url = body?.image_url;
    const caption = body?.caption || "";

    if (!image_url) {
      return json(
        {
          error: "Missing image_url",
        },
        400
      );
    }

    // ---------------------------------------------------------
    // 3. Validate image URL
    // ---------------------------------------------------------

    if (!/^https:\/\//i.test(image_url)) {
      return json(
        {
          error:
            "Instagram requires a public HTTPS image URL. The uploaded image URL is not HTTPS.",
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

    createParams.set("image_url", image_url);
    createParams.set("caption", caption);
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

    const MAX_ATTEMPTS = 12;
    const WAIT_MS = 1500;

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
              "Instagram could not process the uploaded image.",
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
            "Instagram is still processing the image. Please try again in a few seconds.",
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
        media_id: published.id,
        container_id: containerId,
        message:
          "Instagram post published successfully.",
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
