// Phase 2C — Meta OAuth boundary (pure, testable helpers + a mockable client).
// DARK: not deployed. The security-critical DB work lives in intel.ci_ig_complete_connection.
// Production must set real config; NO secrets live in this file.

export interface ProviderConfig {
  provider: string;
  appEnvironment: string;
  apiVersion: string;
  clientId: string;
  authorizeUrl: string;
  tokenExchangeUrl: string;
  graphBaseUrl: string;
  redirectUri: string;
  scopes: string[];
}

export interface TokenExchangeResult {
  accessToken: string;
  tokenType?: string;
  expiresAt?: string | null;
  grantedScopes: string[];   // ACTUAL permissions returned by Meta (never the requested list)
}

export interface AccountIdentity {
  platformUserId: string;    // STABLE anchor — never the username/handle
  username?: string;
  accountType?: string;
}

// Abstract the Meta HTTP boundary so CI can emulate it deterministically (no network, no creds).
export interface MetaOAuthClient {
  exchangeCode(code: string, redirectUri: string): Promise<TokenExchangeResult>;
  fetchAccount(accessToken: string): Promise<AccountIdentity>;
}

// ---- pure helpers (unit-tested) ----

export function buildAuthorizeUrl(cfg: ProviderConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.scopes.join(","),
    state,
  });
  return `${cfg.authorizeUrl}?${p.toString()}`;
}

// Only scopes that were BOTH requested and actually returned are considered granted.
export function selectGrantedScopes(requested: string[], returned: string[]): string[] {
  const set = new Set(returned);
  return requested.filter((s) => set.has(s));
}

// Redact anything secret before logging (tokens, codes, state, secrets).
const SECRET_KEYS = /(access_token|refresh_token|token|code|state|client_secret|app_secret|secret)/i;
export function redactForLog(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/([?&](?:state|code|access_token)=)[^&\s]+/gi, "$1REDACTED");
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "REDACTED" : redactForLog(v);
    }
    return out;
  }
  return obj;
}

// The real client (used only when configured with real env in a deployed environment).
export class RealMetaOAuthClient implements MetaOAuthClient {
  constructor(
    private cfg: ProviderConfig,
    private appSecret: string, // from Edge env — NEVER hardcoded, NEVER logged
  ) {}

  async exchangeCode(code: string, redirectUri: string): Promise<TokenExchangeResult> {
    const form = new FormData();
    form.append("client_id", this.cfg.clientId);
    form.append("client_secret", this.appSecret);
    form.append("grant_type", "authorization_code");
    form.append("redirect_uri", redirectUri);
    form.append("code", code);
    const r = await fetch(this.cfg.tokenExchangeUrl, { method: "POST", body: form });
    const d = await r.json();
    if (!r.ok || !d.access_token) throw new Error("meta_code_exchange_failed");
    // Meta returns granted permissions; capability-test the field rather than assuming its shape.
    const granted: string[] = Array.isArray(d.permissions)
      ? d.permissions
      : (typeof d.scope === "string" ? d.scope.split(/[,\s]+/).filter(Boolean) : []);
    return {
      accessToken: d.access_token,
      tokenType: d.token_type,
      expiresAt: d.expires_in ? new Date(Date.now() + Number(d.expires_in) * 1000).toISOString() : null,
      grantedScopes: selectGrantedScopes(this.cfg.scopes, granted),
    };
  }

  async fetchAccount(accessToken: string): Promise<AccountIdentity> {
    const r = await fetch(
      `${this.cfg.graphBaseUrl}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(accessToken)}`,
    );
    const d = await r.json();
    const id = d.user_id ?? d.id;
    if (!id) throw new Error("meta_missing_stable_user_id");
    return { platformUserId: String(id), username: d.username, accountType: d.account_type };
  }
}
