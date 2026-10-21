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
// THE TARGET ALLOWLIST. The target is the EOS API base URL: explicit (`baseUrl`), else EOS_API_BASE_URL, else the
// eosApi.baseUrl of a NON-production environment in config/environments.json. Whatever the source, it is accepted ONLY
// if it EXACTLY equals (scheme + host + port, normalised) a nonproduction environment's registered eosApi.baseUrl; a
// browser `origin` only if it equals that SAME environment's registered EOS application surface. There is no
// production-URL denylist to go stale: anything not registered is refused. The check runs BEFORE any password, MFA code,
// issuer credential or token is sent, and authentication requests never follow a redirect.
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

// The nonproduction roles in config/environments.json (scripts/environmentArchitecture.test.mjs pins the full set:
// sandbox, integration, production). Anything else is REGISTRY_ROLE_UNKNOWN.
const NONPROD_ROLES = new Set(["sandbox", "integration"]);
const REGISTRY_PATH = join(REPO_ROOT, "config", "environments.json");

/** What may be echoed about a refused URL: scheme://host[:port] only -- never userinfo, path, query or an unparseable string. */
function describeUrl(raw) {
  try { const u = new URL(String(raw)); return `${u.protocol}//${u.host}`; } catch { return "<unparseable URL>"; }
}

/** Normalise to a bare origin (lower-case host, default port dropped). https only; no userinfo, path, query or fragment. */
function normalizeOrigin(raw, what, allowLoopbackHttp = false) {
  // The RAW text must already be plain: the URL parser would quietly decode "%2d" or turn "\" into "/", and strip tabs/newlines.
  // http is accepted ONLY for a loopback host and ONLY when the caller injected the registry (allowLoopbackHttp); the
  // committed registry, env vars and a bare baseUrl never get it.
  const plain = /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(String(raw))
    || (allowLoopbackHttp && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(String(raw)));
  if (!plain) {
    throw new EosPersonaSessionError("INVALID_TARGET_URL", `${what} is not a plain https origin: ${describeUrl(raw)}`);
  }
  let u;
  try { u = new URL(String(raw)); } catch { throw new EosPersonaSessionError("INVALID_TARGET_URL", `${what} is not a URL: ${describeUrl(raw)}`); }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.search || u.hash || u.pathname !== "/") {
    throw new EosPersonaSessionError("INVALID_TARGET_URL", `${what} must be a bare https origin: ${describeUrl(raw)}`);
  }
  return u.origin;
}

/**
 * THE one validator for BOTH the password+MFA login and the persona issuer. Returns { environmentId, base, origin }
 * (`origin` null when no browser origin is needed and none was supplied). Throws EosPersonaSessionError, code + URL only.
 */
function resolveWith(registry, allowLoopbackHttp, { baseUrl, origin, environmentId, env = process.env, needOrigin = false } = {}) {
  const norm = (raw, what) => normalizeOrigin(raw, what, allowLoopbackHttp);
  const envs = registry.environments ?? [];
  // Explicit roles, fail closed: one entry whose role is neither listed nor exactly "production" voids the WHOLE
  // resolution, so a typo ("Production", "prod", "production ", a missing role) can never make a production entry look nonprod.
  for (const e of envs) {
    if (!NONPROD_ROLES.has(e.role) && e.role !== "production") {
      throw new EosPersonaSessionError("REGISTRY_ROLE_UNKNOWN", `environment '${e.id}' has an unrecognised role; the target allowlist cannot be trusted`);
    }
  }
  const nonprod = envs.filter((e) => NONPROD_ROLES.has(e.role));
  const production = envs.filter((e) => e.role === "production");
  const surfaceOrigins = (e) => (e.surfaces ?? []).filter((x) => x.eosApplication === true).map((x) => norm(x.url, "registered surface"));
  const apiOwner = (o) => nonprod.find((e) => e.eosApi?.baseUrl && norm(e.eosApi.baseUrl, "registered eosApi") === o);
  const originOwner = (o) => nonprod.find((e) => surfaceOrigins(e).includes(o));
  // A production entry owning the URL refuses it OUTRIGHT, even if a nonprod entry also lists it (overlap).
  const registeredOrigin = (raw) => {
    try { return new URL(String(raw)).origin; } catch { throw new EosPersonaSessionError("INVALID_TARGET_URL", "a registered production URL is not a URL"); }
  };
  const isProduction = (o) => production.some((e) => (e.eosApi?.baseUrl && registeredOrigin(e.eosApi.baseUrl) === o)
    || (e.surfaces ?? []).some((x) => registeredOrigin(x.url) === o));

  let apiInput = baseUrl ?? env.EOS_API_BASE_URL;
  if (!apiInput) {
    const id = environmentId ?? "platform-sandbox";
    const entry = envs.find((e) => e.id === id);
    if (!entry) throw new EosPersonaSessionError("UNKNOWN_ENVIRONMENT", `no environment '${id}'`);
    if (entry.role === "production") throw new EosPersonaSessionError("PRODUCTION_REFUSED", `'${id}' is role=production`);
    if (!entry.eosApi?.baseUrl) throw new EosPersonaSessionError("NO_EOS_API", `'${id}' declares no eosApi.baseUrl`);
    apiInput = entry.eosApi.baseUrl;
  }
  const base = norm(apiInput, "the EOS API base URL");
  if (isProduction(base)) throw new EosPersonaSessionError("PRODUCTION_REFUSED", `the EOS API ${base} is a production URL`);
  const owner = apiOwner(base);
  if (!owner) throw new EosPersonaSessionError("API_NOT_REGISTERED", `the EOS API ${base} is not a registered nonproduction EOS API`);
  if (environmentId && owner.id !== environmentId) {
    throw new EosPersonaSessionError("ENVIRONMENT_MISMATCH", `the EOS API ${base} belongs to '${owner.id}', not '${environmentId}'`);
  }

  let resolvedOrigin = null;
  if (origin !== undefined && origin !== null) {
    resolvedOrigin = norm(origin, "the browser origin");
    if (isProduction(resolvedOrigin)) throw new EosPersonaSessionError("PRODUCTION_REFUSED", `the browser origin ${resolvedOrigin} is a production URL`);
    const o = originOwner(resolvedOrigin);
    if (!o) {
      throw new EosPersonaSessionError("ORIGIN_NOT_REGISTERED", `the browser origin ${resolvedOrigin} is not a registered nonproduction EOS application surface`);
    }
    if (o.id !== owner.id) {
      throw new EosPersonaSessionError("ENVIRONMENT_MISMATCH", `the browser origin ${resolvedOrigin} belongs to '${o.id}' but the EOS API ${base} belongs to '${owner.id}'`);
    }
  } else if (needOrigin) {
    resolvedOrigin = surfaceOrigins(owner)[0] ?? null;
    if (!resolvedOrigin) throw new EosPersonaSessionError("NO_APPLICATION_ORIGIN", `'${owner.id}' declares no EOS application surface; pass a registered origin`);
  }
  return Object.freeze({ environmentId: owner.id, base, origin: resolvedOrigin });
}

/**
 * Validate against an EXPLICITLY INJECTED registry (a test seam: a suite that runs a local EOS API passes a synthetic
 * registry whose nonprod entry is that loopback server). Only here may a registered entry be http, and only on loopback.
 */
export function resolveEosTargetFrom(registry, options = {}) {
  return resolveWith(registry, true, options);
}

/** Validate against the committed registry, or an injected `options.registry`. Never loopback/http for the committed one. */
export function resolveEosTarget({ registry, ...options } = {}) {
  return registry
    ? resolveEosTargetFrom(registry, options)
    : resolveWith(JSON.parse(readFileSync(REGISTRY_PATH, "utf8")), false, options);
}

/** Resolve the EOS API base URL; only a registered nonproduction EOS API is returned (see resolveEosTarget). */
export function eosApiBaseUrl(options = {}) {
  return resolveEosTarget(options).base;
}

/**
 * POST to a validated target without following redirects: a client that follows a redirect would forward the
 * secrets, so ANY redirect is refused (the Location is never followed or echoed).
 * ponytail: same-origin redirects are refused too; no auth route redirects, so validate-then-follow is not built.
 */
async function postGuarded(fetchImpl, url, init) {
  const res = await fetchImpl(url, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new EosPersonaSessionError("REDIRECT_REFUSED", `${describeUrl(url)} answered with a redirect; an authentication request must not leave the approved environment`);
  }
  return res;
}

const SESSION_CACHE = new Map();

/**
 * Issue (or reuse, while more than 2 minutes remain) an EOS session for a persona.
 * Returns { proof: "issuer-api", token, expiresAt, personaKey, principalId }. Throws EosPersonaSessionError; never leaks secrets.
 */
export async function issueEosPersonaSession(personaKey, options = {}) {
  const env = options.env ?? process.env;
  const credential = options.credential ?? env[PERSONA_ISSUER_CREDENTIAL_ENV];
  if (typeof credential !== "string" || credential.length === 0) {
    throw new EosPersonaSessionError("NO_ISSUER_CREDENTIAL",
      `${PERSONA_ISSUER_CREDENTIAL_ENV} is not set. It is supplied explicitly (CI secret or operator shell); it is never discovered.`);
  }
  const { base } = resolveEosTarget({ ...options, env });
  const cacheKey = `${base}::${personaKey}`;
  const cached = SESSION_CACHE.get(cacheKey);
  if (cached && Date.parse(cached.expiresAt) - Date.now() > 2 * 60 * 1000) return cached;

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const res = await postGuarded(fetchImpl, `${base}${PERSONA_SESSION_ROUTE}`, {
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
  const session = Object.freeze({ proof: "issuer-api", token: body.token, expiresAt: body.expiresAt, personaKey: body.personaKey, principalId: body.principalId });
  SESSION_CACHE.set(cacheKey, session);
  return session;
}

/** Call one EOS API route as a persona. Returns the parsed JSON body and status. */
export async function callEosApiAsPersona(personaKey, route, payload, options = {}) {
  // The route is a PATH on the validated base, never an authority: "@evil.example/x", ".evil.example/x", ":1@evil.example/",
  // "//evil.example/x" and a leading backslash would all move the bearer token off-environment. Checked BEFORE a session is issued.
  if (typeof route !== "string" || !/^\/(?![\/\\])/.test(route)) {
    throw new EosPersonaSessionError("INVALID_ROUTE", "the route must be a path beginning with a single '/'");
  }
  const session = await issueEosPersonaSession(personaKey, options);
  const { base } = resolveEosTarget({ ...options, env: options.env ?? process.env });
  let target;
  try { target = new URL(base + route); } catch { throw new EosPersonaSessionError("INVALID_ROUTE", "the route does not form a URL"); }
  if (target.origin !== base) throw new EosPersonaSessionError("INVALID_ROUTE", "the route leaves the approved EOS API origin");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const res = await postGuarded(fetchImpl, `${base}${route}`, {
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
 * Sign an ENROLLED persona in with its password and authenticator. Returns { proof: "login-mfa", token, expiresAt, personaKey }.
 * Throws EosPersonaSessionError carrying a code only.
 */
export async function loginEosPersona(personaKey, options = {}) {
  const env = options.env ?? process.env;
  const file = options.credentialsFile ?? env[PERSONA_CREDENTIALS_FILE_ENV];
  if (typeof file !== "string" || file.length === 0) {
    throw new EosPersonaSessionError("NO_CREDENTIALS_FILE", `${PERSONA_CREDENTIALS_FILE_ENV} is not set. The enrollment tool's output file is named explicitly; it is never discovered.`);
  }
  // The target is validated BEFORE the credentials file is even read, so a refused target never touches a secret.
  const { base, origin } = resolveEosTarget({ ...options, env, needOrigin: true });
  let entry;
  try {
    entry = (JSON.parse(readFileSync(file, "utf8")).entries ?? []).find((e) => e.personaKey === personaKey && e.state === "enrolled");
  } catch {
    throw new EosPersonaSessionError("CREDENTIAL_FILE_INVALID", "the credentials file could not be read as JSON");
  }
  if (!entry) throw new EosPersonaSessionError("PERSONA_NOT_ENROLLED", `no enrolled entry for '${personaKey}'`);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const post = async (path, body) => {
    const res = await postGuarded(fetchImpl, `${base}${path}`, {
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
  return Object.freeze({ proof: "login-mfa", token: session.accessToken, expiresAt: session.accessTokenExpiresAt, personaKey });
}

/** The sessionStorage key the client reads (field-ops-app-vite/src/auth/eosSession.js). */
export const EOS_SESSION_STORAGE_KEY = "eos.session.v1";

export function clearEosPersonaSessionCache() {
  SESSION_CACHE.clear();
}
