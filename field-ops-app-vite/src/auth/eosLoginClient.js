// THE EOS LOGIN CLIENT -- the browser half of the human front door. docs/architecture/eos-native-identity.md, 3(e).
//
// Imports NOTHING from Firebase. Talks only to the EOS API's /auth/* routes.
//
// ════════════════════ WHERE THE CREDENTIALS LIVE (Owner correction 1, 2026-10-11) ════════════════════
//
//   refresh token   NOWHERE in this code. The API sets it as an HttpOnly, Secure, __Host- cookie; the browser sends it on
//                   /auth/refresh and /auth/logout (credentials: "include") and no script can read it.
//   access token    in MEMORY only (this module), five minutes. Never sessionStorage, never localStorage. A reload
//                   restores it with one cookie-backed refresh.
//
// Every /auth/* request carries `X-EOS-CSRF: 1` and JSON; the server also checks Origin (correction 2).
//
// CONCURRENCY. Two tabs share one cookie. A refresh is serialised across tabs with the Web Locks API where the browser
// has it, and a REFRESH_SUPERSEDED answer (a sibling tab rotated first) is retried once with the cookie it left behind.
//
// OFF unless the build says VITE_EOS_HUMAN_LOGIN=enabled (or is an EOS-only sign-in build) AND the bundle is not a production build (Owner D-1).

import { setHumanEosTokenSource } from "./eosSession.js";
import { EOS_AUTH_ONLY } from "./authSource.js";

export const CSRF_HEADER = "x-eos-csrf";
/** Refresh this long before the access token expires, so a request never carries one about to lapse. */
export const REFRESH_LEAD_MS = 60_000;
/** Every request to the EOS API is abandoned after this long and reported as the NETWORK failure. */
export const REQUEST_TIMEOUT_MS = 15_000;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

function readEnv(name) {
  try {
    return typeof import.meta !== "undefined" && import.meta.env ? import.meta.env[name] : undefined;
  } catch {
    return undefined;
  }
}

function environmentRole() {
  try {
    // eslint-disable-next-line no-undef
    return typeof __APP_ENVIRONMENT__ !== "undefined" && __APP_ENVIRONMENT__ ? __APP_ENVIRONMENT__.role ?? null : null;
  } catch {
    return null;
  }
}

// An EOS-only sign-in build (auth/authSource.js, Firebase exit B2) IS the front door: it needs no second variable, because it
// has no other way in. Otherwise the flag decides, as before. Never in a production bundle.
export function eosHumanLoginEnabled({ flag = readEnv("VITE_EOS_HUMAN_LOGIN"), role = environmentRole(), eosAuthOnly = EOS_AUTH_ONLY } = {}) {
  return role !== "production" && (eosAuthOnly === true || flag === "enabled");
}

function apiBase(explicit) {
  const raw = explicit ?? readEnv("VITE_EOS_API_BASE_URL");
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length === 0 ? null : value.replace(/\/$/, "");
}

function decodeSegment(segment) {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const text = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
  return JSON.parse(text);
}

/** `{ token, subject, expiresAtMs }` from an access token, for scheduling only -- the server is the verifier. */
function describeAccessToken(token) {
  try {
    const p = decodeSegment(token.split(".")[1]);
    if (typeof p.exp !== "number" || typeof p.sub !== "string" || !SUBJECT.test(p.sub)) return null;
    return Object.freeze({ token, subject: p.sub, expiresAtMs: p.exp * 1000 });
  } catch {
    return null;
  }
}

/** A failure the UI can act on. `code` is the server's (LOGIN_REFUSED, PASSWORD_POLICY, ...) or a client one. */
export class EosLoginError extends Error {
  constructor(code, detail = null, status = 0) {
    super(code);
    this.name = "EosLoginError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

function defaultLocks() {
  try {
    return typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function" ? navigator.locks : null;
  } catch {
    return null;
  }
}

/**
 * The client. Every dependency is injectable so the module is testable under plain node.
 * @param {{ fetchImpl?: typeof fetch, baseUrl?: string, now?: () => number, locks?: { request: Function } | null }} [deps]
 */
export function createEosLoginClient(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const locks = deps.locks === undefined ? defaultLocks() : deps.locks;
  let access = null; // { token, subject, expiresAtMs } -- memory only
  let inflightRefresh = null;
  const listeners = new Set();
  const notify = () => { for (const l of listeners) { try { l(access); } catch { /* a listener's fault is its own */ } } };

  async function post(path, body, accessToken = null) {
    const base = apiBase(deps.baseUrl);
    if (!base || !fetchImpl) throw new EosLoginError("NOT_CONFIGURED");
    // EVERY REQUEST IS BOUNDED. A server that never answers (a cold start, a dropped connection) must end as the existing
    // NETWORK failure, not an endless "Loading..." -- at first load a refresh that fails means signed out, settled. The
    // AbortController cancels the request; the race guarantees the bound even for a transport that ignores the signal.
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer = null;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { controller?.abort(); } catch { /* the bound below still holds */ }
        reject(new EosLoginError("NETWORK"));
      }, timeoutMs);
    });
    let res;
    let json = null;
    try {
      const sent = fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", [CSRF_HEADER]: "1", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(body ?? {}),
        // The refresh cookie rides on every /auth/* call; it is HttpOnly, so this code never sees it.
        credentials: "include",
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
      });
      sent.catch(() => {});
      try {
        res = await Promise.race([sent, timedOut]);
      } catch {
        throw new EosLoginError("NETWORK");
      }
      try {
        json = await Promise.race([res.json(), timedOut]);
      } catch (err) {
        if (err instanceof EosLoginError) throw err;
        json = null;
      }
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !json || json.ok !== true) {
      throw new EosLoginError(json?.code ?? "UNAVAILABLE", json?.detail ?? null, res.status);
    }
    return json;
  }

  function adopt(session) {
    const d = describeAccessToken(session?.accessToken ?? "");
    if (!d) throw new EosLoginError("UNAVAILABLE");
    // `mfaEnrollmentRequired` is the server's word that this session owes a second factor and may use /auth/* only.
    access = Object.freeze({ ...d, mfaEnrollmentRequired: session?.mfaEnrollmentRequired === true });
    notify();
    return d;
  }

  function forget() {
    access = null;
    notify();
  }

  /** @returns {Promise<{status:"AUTHENTICATED", mfaEnrollmentRequired:boolean}|{status:"MFA_REQUIRED", challenge:string}>} */
  async function login(identifier, password) {
    const r = await post("/auth/login", { identifier, password });
    if (r.status === "AUTHENTICATED") {
      adopt(r.session);
      return { status: "AUTHENTICATED", mfaEnrollmentRequired: r.session.mfaEnrollmentRequired === true };
    }
    // The challenge lives in the caller's component state only: it is worth five minutes and one factor.
    return { status: "MFA_REQUIRED", challenge: r.challenge, methods: r.methods ?? [] };
  }

  async function completeMfa(challenge, { code = undefined, recoveryCode = undefined } = {}) {
    const r = await post("/auth/login/mfa", { challenge, ...(code ? { code } : {}), ...(recoveryCode ? { recoveryCode } : {}) });
    adopt(r.session);
    return { status: "AUTHENTICATED", mfaEnrollmentRequired: r.session.mfaEnrollmentRequired === true };
  }

  async function exchangeOnce() {
    const r = await post("/auth/refresh", {});
    return adopt(r.session).token;
  }

  /** Exchange the cookie for a fresh access token, or null. Single-flight in this tab, serialised across tabs. */
  function refresh() {
    if (inflightRefresh) return inflightRefresh;
    const run = async () => {
      // Another tab may have refreshed while this one waited for the lock: its cookie is already the successor.
      try {
        return await exchangeOnce();
      } catch (err) {
        if (err instanceof EosLoginError && err.code === "REFRESH_SUPERSEDED") {
          try { return await exchangeOnce(); } catch (again) { if (again?.code !== "NETWORK") forget(); return null; }
        }
        // A refused refresh means no session (the server already cleared the cookie). A network failure keeps the
        // in-memory token for whatever life it has left.
        if (!(err instanceof EosLoginError) || err.code !== "NETWORK") forget();
        return null;
      }
    };
    inflightRefresh = (locks ? locks.request("eos-login-refresh", run) : run()).finally(() => {
      inflightRefresh = null;
    });
    return inflightRefresh;
  }

  /** The access token to send: refreshed first when absent or about to lapse, or null. */
  async function freshAccessToken() {
    if (access && access.expiresAtMs - now() > REFRESH_LEAD_MS) return access.token;
    return (await refresh()) ?? null;
  }

  async function logout() {
    forget();
    try {
      // Server-side revocation: the session row is revoked and the cookie cleared by the response.
      await post("/auth/logout", {});
    } catch {
      // The local session is gone either way; an unreachable server leaves only an idle-expiring session.
    }
  }

  const authed = async (path, body) => {
    const token = await freshAccessToken();
    if (!token) throw new EosLoginError("SESSION_INVALID");
    return post(path, body, token);
  };

  return Object.freeze({
    login,
    completeMfa,
    refresh,
    freshAccessToken,
    logout,
    /** The in-memory session `{ token, subject, expiresAtMs }`, or null. Never persisted. */
    currentSession: () => access,
    /** Called with the session (or null) whenever it changes. Returns an unsubscribe. */
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    completeEnrollment: (ticket, password) => post("/auth/enrollment/complete", { ticket, password }),
    completeReset: (ticket, password) => post("/auth/password/reset/complete", { ticket, password }),
    // ── self-service account security ──
    describeAccount: async () => (await authed("/auth/account", {})).account,
    changePassword: async (currentPassword, newPassword) => {
      const r = await authed("/auth/password/change", { currentPassword, newPassword });
      adopt(r.session);
      return true;
    },
    // Setting up an authenticator requires the current password (a stolen access token cannot bind the thief's app).
    beginTotp: (password) => authed("/auth/mfa/totp/begin", { password }),
    confirmTotp: async (factorId, code) => (await authed("/auth/mfa/totp/confirm", { factorId, code })).recoveryCodes,
    removeTotp: (password, code) => authed("/auth/mfa/totp/remove", { password, code }),
    regenerateRecoveryCodes: async (password, code) => (await authed("/auth/mfa/recovery-codes/regenerate", { password, code })).recoveryCodes,
    revokeSession: (sessionId) => authed("/auth/sessions/revoke", { sessionId }),
    revokeOtherSessions: () => authed("/auth/sessions/revoke-others", {}),
  });
}

/** The app's one client. */
export const eosLoginClient = createEosLoginClient();

// The API clients' bearer: this client's fresh access token, only while the front door is on AND a human session exists
// (a Firebase-signed-in user's calls never trigger an EOS refresh).
setHumanEosTokenSource(() => (eosHumanLoginEnabled() && eosLoginClient.currentSession() ? eosLoginClient.freshAccessToken() : null));

/** Why a correct-looking code is refused most often: the phone's clock. Shown wherever a six-digit code is asked for. */
export const CLOCK_HINT = "Codes depend on the time, so set your phone's date and time to automatic.";

/** Words for the codes a person can act on. Never echoes a value back. */
export function eosLoginMessage(code, detail) {
  switch (code) {
    case "LOGIN_REFUSED": return "Sign-in failed. Check your sign-in name and password, or ask your administrator.";
    case "MFA_CODE_REFUSED": return `That code was not accepted. Enter the current code from your authenticator app. ${CLOCK_HINT}`;
    case "MFA_CHALLENGE_INVALID": return "This sign-in step expired. Start again.";
    case "MFA_KEY_UNAVAILABLE": return "Two-step verification is temporarily unavailable. Contact your administrator.";
    case "RATE_LIMITED": return "Too many attempts. Wait a minute and try again.";
    case "TICKET_INVALID": return "That setup or reset code is not valid any more. Ask your administrator for a new one.";
    case "CURRENT_PASSWORD_REFUSED": return "Your current password was not accepted.";
    case "PASSWORD_POLICY":
      return {
        PASSWORD_TOO_SHORT: "Use at least 12 characters. A short phrase of ordinary words works well.",
        PASSWORD_TOO_LONG: "Use at most 128 characters.",
        PASSWORD_TOO_COMMON: "That password is too common. Choose something less predictable.",
        PASSWORD_REPETITIVE: "That password repeats too few characters.",
        PASSWORD_CONTAINS_IDENTIFIER: "Your password must not contain your sign-in name.",
        PASSWORD_UNCHANGED: "Choose a password different from your current one.",
      }[detail] ?? "That password does not meet the requirements.";
    case "MFA_NOT_CONFIGURED": return "Two-step verification is not available on this system yet.";
    case "MFA_REQUIRED_BY_POLICY": return "Your administrator requires two-step verification on this account.";
    case "ORIGIN_REFUSED":
    case "CSRF_REFUSED":
    case "NOT_CONFIGURED": return "Sign-in is not configured for this environment.";
    case "NETWORK": return "The sign-in service could not be reached. Check your connection.";
    default: return "Something went wrong. Try again.";
  }
}
