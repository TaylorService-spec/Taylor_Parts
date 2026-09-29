// THE EOS SESSION TOKEN SOURCE (client). docs/architecture/eos-identity-session-foundation.md, section 3(e).
//
// ADDITIVE. When an EOS access token is present in sessionStorage the API clients send it; otherwise they
// send the Firebase ID token exactly as before. This module imports NOTHING from Firebase.
//
// THE CLIENT IS NOT THE VERIFIER. The payload is decoded ONLY to drop an expired or malformed token early
// and to key the session; the EOS API verifies signature, issuer, audience, environment and lifetime, and
// resolves the Principal and Employee itself. No claim read here is authority, and the token carries none.
//
// REFUSED IN A PRODUCTION BUILD: an EOS session is honoured only when the bundle's environment role is not
// "production". The nonprod harness is the only issuer today.

export const EOS_SESSION_STORAGE_KEY = "eos.session.v1";
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

function defaultStorage() {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function defaultEnvironmentRole() {
  try {
    // eslint-disable-next-line no-undef
    return typeof __APP_ENVIRONMENT__ !== "undefined" && __APP_ENVIRONMENT__ ? __APP_ENVIRONMENT__.role ?? null : null;
  } catch {
    return null;
  }
}

function decodeSegment(segment) {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const text = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
  return JSON.parse(text);
}

/**
 * The current EOS session, or null. `{ token, subject, expiresAtMs }`.
 * Options are injectable for tests: storage, nowMs, environmentRole.
 */
export function readEosSession({ storage = defaultStorage(), nowMs = Date.now(), environmentRole = defaultEnvironmentRole() } = {}) {
  if (environmentRole === "production") return null;
  if (!storage) return null;
  let token = null;
  try {
    token = storage.getItem(EOS_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return dropped(storage);
  let header;
  let payload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    return dropped(storage);
  }
  if (!header || header.alg !== "EdDSA" || !payload || typeof payload.exp !== "number"
    || typeof payload.sub !== "string" || !SUBJECT.test(payload.sub)) {
    return dropped(storage);
  }
  const expiresAtMs = payload.exp * 1000;
  if (expiresAtMs <= nowMs) return dropped(storage);
  return Object.freeze({ token, subject: payload.sub, expiresAtMs });
}

function dropped(storage) {
  try {
    storage.removeItem(EOS_SESSION_STORAGE_KEY);
  } catch {
    // nothing to do
  }
  return null;
}

/** The EOS token to send, or null (then the caller falls back to Firebase). */
export function currentEosSessionToken(options) {
  return readEosSession(options)?.token ?? null;
}

export function clearEosSession({ storage = defaultStorage() } = {}) {
  if (!storage) return;
  try {
    storage.removeItem(EOS_SESSION_STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
