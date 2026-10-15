// Access tokens (Instagram / Facebook) are encrypted at rest with AES-256-GCM before they are written to
// public.social_tokens, and decrypted only inside Edge Functions at the moment they are used.
//   stored value: "enc1:<iv base64url>:<ciphertext+tag base64url>"
//   key: TOKEN_ENC_KEY secret — 32 random bytes, base64 (create with:  openssl rand -base64 32)
// Old plain-text tokens still work (they are read as-is) and are sealed the next time they are written or by
// the daily token refresh. Without TOKEN_ENC_KEY nothing breaks: tokens are stored as before and the Super
// Admin system check flags it.

const PREFIX = "enc1:";
let keyPromise: Promise<CryptoKey | null> | null = null;

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function key(): Promise<CryptoKey | null> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const raw = (Deno.env.get("TOKEN_ENC_KEY") || "").trim();
      if (!raw) return null;
      let bytes: Uint8Array;
      try { bytes = unb64u(raw); } catch (_e) { console.error("TOKEN_ENC_KEY is not valid base64"); return null; }
      if (bytes.length !== 32) { console.error("TOKEN_ENC_KEY must be 32 bytes (openssl rand -base64 32)"); return null; }
      return await crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
    })();
  }
  return keyPromise;
}

export const tokenEncryptionOn = async () => !!(await key());

export async function sealToken(plain: string | null | undefined): Promise<string | null> {
  if (plain == null || plain === "") return plain ?? null;
  if (String(plain).startsWith(PREFIX)) return String(plain);
  const k = await key();
  if (!k) return String(plain);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(String(plain))));
  return `${PREFIX}${b64u(iv)}:${b64u(ct)}`;
}

export async function openToken(stored: string | null | undefined): Promise<string | null> {
  if (stored == null || stored === "") return stored ?? null;
  const s = String(stored);
  if (!s.startsWith(PREFIX)) return s;                       // legacy plain value
  const k = await key();
  if (!k) throw new Error("This token is encrypted but TOKEN_ENC_KEY is not set on the server.");
  const [, iv, ct] = s.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) as BufferSource }, k, unb64u(ct) as BufferSource);
  return new TextDecoder().decode(pt);
}

// decrypt the access_token on a row read from social_tokens (returns a copy)
export async function openRow<T extends { access_token?: string | null } | null | undefined>(row: T): Promise<T> {
  if (!row || !row.access_token) return row;
  return { ...row, access_token: await openToken(row.access_token) } as T;
}
