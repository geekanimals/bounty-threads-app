// Brief-adherence reviewer backed by Claude (Anthropic Messages API). Provider-agnostic shape like the
// other adapters. Given the campaign brief + what the creator submitted, it returns a structured verdict
// the operator sees next to the submission. Dark until ANTHROPIC_API_KEY is set. Model is configurable
// (ANTHROPIC_MODEL); it defaults to a current Claude model id.

export type ReviewInput = { brief: unknown; deliverables?: unknown; caption?: string; content_url?: string };
export type ReviewResult = { verdict: "pass" | "issues" | "error"; findings: string[]; model: string };

const ANTHROPIC_VERSION = "2023-06-01";

export interface ContentReviewer { review(i: ReviewInput): Promise<ReviewResult>; }

class ClaudeReviewer implements ContentReviewer {
  constructor(private key: string, private model: string) {}
  async review(i: ReviewInput): Promise<ReviewResult> {
    if (!this.key) throw new Error("content review not configured (ANTHROPIC_API_KEY).");
    const system = "You review influencer campaign content against the brand brief. Judge only what the supplied "
      + "text supports — do not assume you can watch the video. Reply ONLY with compact JSON: "
      + '{"verdict":"pass"|"issues","findings":["short actionable note", ...]}. "pass" means it clearly meets the brief; '
      + '"issues" means something is missing, off-message, or unverifiable from what was provided.';
    const user = "CAMPAIGN BRIEF (JSON):\n" + JSON.stringify(i.brief ?? {}) + "\n\n"
      + "EXPECTED DELIVERABLES (JSON):\n" + JSON.stringify(i.deliverables ?? []) + "\n\n"
      + "CREATOR SUBMISSION:\n- content link: " + (i.content_url || "(none)") + "\n- caption/notes: " + (i.caption || "(none)");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, max_tokens: 512, system, messages: [{ role: "user", content: user }] }),
    });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((raw as any)?.error?.message || "content review failed");
    const text = ((raw as any)?.content || []).map((b: any) => b?.text || "").join("").trim();
    const json = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      const parsed = JSON.parse(json);
      const verdict = parsed?.verdict === "pass" ? "pass" : "issues";
      const findings = Array.isArray(parsed?.findings) ? parsed.findings.map((x: unknown) => String(x)).slice(0, 20) : [];
      return { verdict, findings, model: this.model };
    } catch {
      return { verdict: "issues", findings: ["Could not parse the review; please check manually."], model: this.model };
    }
  }
}

export function getContentReviewer(): ContentReviewer {
  return new ClaudeReviewer(Deno.env.get("ANTHROPIC_API_KEY") || "", Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5");
}
