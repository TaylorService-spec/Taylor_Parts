// THE EOS PERSONA SESSION CLIENT for API and browser harnesses -- no SANDBOX_CREDENTIALS_FILE, no Firebase.
// docs/architecture/eos-identity-session-foundation.md, sections 3(d), 3(e), 5.
//
// A harness obtains a short-lived EOS access token for ONE of the 16 governed nonprod personas from the EOS
// API's persona issuer, then calls the EOS API (or seeds a browser) with it. The ONLY input is the persona
// issuer credential, supplied EXPLICITLY through the environment variable EOS_PERSONA_ISSUER_CREDENTIAL
// (a GitHub Actions secret in CI; the operator's shell locally). Nothing is discovered: this module reads no
// file, no password, no ADC, and contacts no Google or Firebase endpoint. It never prints the credential or a
// token.
//
// The target is the EOS API base URL: explicit (`baseUrl`), else EOS_API_BASE_URL, else the eosApi.baseUrl of
// a NON-production environment in config/environments.json. Production is refused.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PERSONA_SESSION_ROUTE = "/auth/nonprod/persona-session";
export const PERSONA_ISSUER_CREDENTIAL_HEADER = "x-eos-persona-issuer-credential";
export const PERSONA_ISSUER_CREDENTIAL_ENV = "EOS_PERSONA_ISSUER_CREDENTIAL";

export class EosPersonaSessionError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EosPersonaSessionError";
    this.code = code;
  }
}

/** Resolve the EOS API base URL, refusing any production-role environment. */
export function eosApiBaseUrl({ baseUrl, environmentId = "platform-sandbox", env = process.env } = {}) {
  if (baseUrl) return String(baseUrl).replace(/\/+$/, "");
  if (env.EOS_API_BASE_URL) return String(env.EOS_API_BASE_URL).replace(/\/+$/, "");
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, "config", "environments.json"), "utf8"));
  const entry = (registry.environments ?? []).find((e) => e.id === environmentId);
  if (!entry) throw new EosPersonaSessionError("UNKNOWN_ENVIRONMENT", `no environment '${environmentId}'`);
  if (entry.role === "production") throw new EosPersonaSessionError("PRODUCTION_REFUSED", `'${environmentId}' is role=production`);
  const url = entry.eosApi?.baseUrl;
  if (!url) throw new EosPersonaSessionError("NO_EOS_API", `'${environmentId}' declares no eosApi.baseUrl`);
  return String(url).replace(/\/+$/, "");
}

const SESSION_CACHE = new Map();

/**
 * Issue (or reuse, while more than 2 minutes remain) an EOS session for a persona.
 * Returns { token, expiresAt, personaKey, principalId }. Throws EosPersonaSessionError; never leaks secrets.
 */
export async function issueEosPersonaSession(personaKey, options = {}) {
  const env = options.env ?? process.env;
  const credential = options.credential ?? env[PERSONA_ISSUER_CREDENTIAL_ENV];
  if (typeof credential !== "string" || credential.length === 0) {
    throw new EosPersonaSessionError("NO_ISSUER_CREDENTIAL",
      `${PERSONA_ISSUER_CREDENTIAL_ENV} is not set. It is supplied explicitly (CI secret or operator shell); it is never discovered.`);
  }
  const base = eosApiBaseUrl({ ...options, env });
  const cacheKey = `${base}::${personaKey}`;
  const cached = SESSION_CACHE.get(cacheKey);
  if (cached && Date.parse(cached.expiresAt) - Date.now() > 2 * 60 * 1000) return cached;

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${base}${PERSONA_SESSION_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json", [PERSONA_ISSUER_CREDENTIAL_HEADER]: credential },
    body: JSON.stringify({ personaKey }),
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body?.ok || typeof body.token !== "string") {
    // The code and status only -- never the request headers or a token.
    throw new EosPersonaSessionError(body?.code ?? "ISSUE_FAILED", `persona session for '${personaKey}' refused (HTTP ${res.status})`);
  }
  const session = Object.freeze({ token: body.token, expiresAt: body.expiresAt, personaKey: body.personaKey, principalId: body.principalId });
  SESSION_CACHE.set(cacheKey, session);
  return session;
}

/** Call one EOS API route as a persona. Returns the parsed JSON body and status. */
export async function callEosApiAsPersona(personaKey, route, payload, options = {}) {
  const session = await issueEosPersonaSession(personaKey, options);
  const base = eosApiBaseUrl({ ...options, env: options.env ?? process.env });
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.token}`, ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}) },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

// ════════════════════ THE PASSWORD SESSION (Firebase exit B2) ════════════════════
//
// After B2 an ENROLLED persona can sign in with its password and authenticator exactly as a person does
// (functions/scripts/enrollPersonaLogins.js). This is the harness side of that: it reads the enrollment tool's credentials
// file -- named EXPLICITLY by EOS_PERSONA_CREDENTIALS_FILE or `options.credentialsFile`, never discovered -- and signs in over
// /auth/login and /auth/login/mfa. It is the SAME front door the browser uses, so a proof made with it is a proof of the login.
// The persona ISSUER above stays the machine path. Neither a credential nor a token is ever printed or put in an error.
export const PERSONA_CREDENTIALS_FILE_ENV = "EOS_PERSONA_CREDENTIALS_FILE";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(text) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(text).toUpperCase().replace(/[=\s]/g, "")) {
    const i = BASE32.indexOf(ch);
    if (i < 0) throw new EosPersonaSessionError("CREDENTIAL_FILE_INVALID", "the authenticator secret is not base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 6238: HMAC-SHA1, 30-second step, six digits. */
export function totpCode(secretBase32, nowMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / 30)));
  const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const n = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Sign an ENROLLED persona in with its password and authenticator. Returns { token, expiresAt, personaKey }.
 * Throws EosPersonaSessionError carrying a code only.
 */
export async function loginEosPersona(personaKey, options = {}) {
  const env = options.env ?? process.env;
  const file = options.credentialsFile ?? env[PERSONA_CREDENTIALS_FILE_ENV];
  if (typeof file !== "string" || file.length === 0) {
    throw new EosPersonaSessionError("NO_CREDENTIALS_FILE", `${PERSONA_CREDENTIALS_FILE_ENV} is not set. The enrollment tool's output file is named explicitly; it is never discovered.`);
  }
  let entry;
  try {
    entry = (JSON.parse(readFileSync(file, "utf8")).entries ?? []).find((e) => e.personaKey === personaKey && e.state === "enrolled");
  } catch {
    throw new EosPersonaSessionError("CREDENTIAL_FILE_INVALID", "the credentials file could not be read as JSON");
  }
  if (!entry) throw new EosPersonaSessionError("PERSONA_NOT_ENROLLED", `no enrolled entry for '${personaKey}'`);
  const base = eosApiBaseUrl({ ...options, env });
  const origin = options.origin ?? (() => {
    const registry = JSON.parse(readFileSync(join(REPO_ROOT, "config", "environments.json"), "utf8"));
    const surface = (registry.environments.find((e) => e.id === (options.environmentId ?? "platform-sandbox"))?.surfaces ?? []).find((s) => s.eosApplication === true);
    if (!surface) throw new EosPersonaSessionError("NO_APPLICATION_ORIGIN", "the environment declares no EOS application surface; pass `origin`");
    return surface.url;
  })();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const post = async (path, body) => {
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin, "x-eos-csrf": "1" }, body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok || !json?.ok) throw new EosPersonaSessionError(json?.code ?? "LOGIN_FAILED", `login for '${personaKey}' refused at ${path} (HTTP ${res.status})`);
    return json;
  };
  let r = await post("/auth/login", { identifier: entry.loginIdentifier, password: entry.password });
  if (r.status === "MFA_REQUIRED") r = await post("/auth/login/mfa", { challenge: r.challenge, code: totpCode(entry.totpSecretBase32, options.nowMs ?? Date.now()) });
  const session = r.session;
  if (typeof session?.accessToken !== "string") throw new EosPersonaSessionError("LOGIN_FAILED", "no session was issued");
  return Object.freeze({ token: session.accessToken, expiresAt: session.accessTokenExpiresAt, personaKey });
}

/** The sessionStorage key the client reads (field-ops-app-vite/src/auth/eosSession.js). */
export const EOS_SESSION_STORAGE_KEY = "eos.session.v1";

export function clearEosPersonaSessionCache() {
  SESSION_CACHE.clear();
}
