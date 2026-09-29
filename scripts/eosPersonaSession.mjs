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

/** The sessionStorage key the client reads (field-ops-app-vite/src/auth/eosSession.js). */
export const EOS_SESSION_STORAGE_KEY = "eos.session.v1";

export function clearEosPersonaSessionCache() {
  SESSION_CACHE.clear();
}
