// Edge Function: ai-chat  (verify_jwt = true)
// Powers the in-app AI Assistant. Holds the OpenAI key server-side (never in the browser),
// takes the conversation + the user's role/page context, and returns the assistant's reply.
//
// Secrets: OPENAI_API_KEY (required), OPENAI_MODEL (optional, defaults to gpt-4o-mini)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Only signed-in users may use the assistant.
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not set on the server." }, 500);

    const { messages, context } = await req.json();
    const ctx = context || {};

    const system = `You are the ${ctx.roleLabel || "AI Assistant"} inside Geek Influencer OS, an operating system for influencer marketing used by creators, brands, and agencies.
You are helping ${ctx.name || "a user"}${ctx.org ? ` from ${ctx.org}` : ""}, whose role is "${ctx.roleLabel || ctx.role || "user"}". They are currently on the "${ctx.page || "app"}" screen.
Be concise, practical, and encouraging. Give specific, actionable next steps for influencer marketing — campaigns, mass barter deals, brand collaborations, audience growth, and (for creators) building their media kit and creator career.
Use short paragraphs or tight bullet points. Do NOT invent numbers or facts about their account; if you need specifics you don't have, ask a brief question. Keep replies under ~180 words unless asked for more.`;

    const chatMessages = [
      { role: "system", content: system },
      // deno-lint-ignore no-explicit-any
      ...(Array.isArray(messages) ? messages : []).slice(-20).map((m: any) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: String(m.content || "").slice(0, 4000),
      })),
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages: chatMessages, temperature: 0.6, max_tokens: 600 }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: data?.error?.message || "OpenAI request failed", detail: data }, 400);

    const reply = (data?.choices?.[0]?.message?.content || "").trim();
    return json({ ok: true, reply });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
