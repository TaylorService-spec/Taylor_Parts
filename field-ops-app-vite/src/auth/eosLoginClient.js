// THE EOS LOGIN CLIENT -- the browser half of the human front door. docs/architecture/eos-native-identity.md, 3(e).
//
// Imports NOTHING from Firebase. Talks only to the EOS API's /auth/* routes, and keeps two values in sessionStorage:
//
//   eos.session.v1   the short-lived access token -- the SAME key eosSession.js reads, so every API client's
//                    currentIdToken() sends it with no change of its own
//   eos.refresh.v1   the rotating refresh token
//
// sessionStorage, not localStorage: a session ends with its tab. Not a cookie: the API and the app are on different
// sites, and a cross-site cookie is exactly what browsers are retiring (Owner decision D-3 records the trade-off and
// the same-site alternative).
//
// OFF unless the build says VITE_EOS_HUMAN_LOGIN=enabled AND the bundle is not a production build. Off, the app is the
// Firebase app it was.
import { EOS_SESSION_STORAGE_KEY, readEosSession, clearEosSession } from "./eosSession.js";

export const EOS_REFRESH_STORAGE_KEY = "eos.refresh.v1";
/** Refresh this long before the access token expires, so a request never carries one about to lapse. */
export const REFRESH_LEAD_MS = 60_000;

function defaultStorage() {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

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

export function eosHumanLoginEnabled({ flag = readEnv("VITE_EOS_HUMAN_LOGIN"), role = environmentRole() } = {}) {
  return flag === "enabled" && role !== "production";
}

function apiBase(explicit) {
  const raw = explicit ?? readEnv("VITE_EOS_API_BASE_URL");
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length === 0 ? null : value.replace(/\/$/, "");
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

/**
 * The client. Every dependency is injectable so the module is testable under plain node.
 * @param {{ fetchImpl?: typeof fetch, storage?: Storage|null, baseUrl?: string, now?: () => number }} [deps]
 */
export function createEosLoginClient(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const now = deps.now ?? (() => Date.now());
  let inflightRefresh = null;

  async function post(path, body, accessToken = null) {
    const base = apiBase(deps.baseUrl);
    if (!base || !fetchImpl) throw new EosLoginError("NOT_CONFIGURED");
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(body ?? {}),
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new EosLoginError("NETWORK");
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.ok !== true) {
      throw new EosLoginError(json?.code ?? "UNAVAILABLE", json?.detail ?? null, res.status);
    }
    return json;
  }

  function store(session) {
    if (!storage) throw new EosLoginError("NO_STORAGE");
    storage.setItem(EOS_SESSION_STORAGE_KEY, session.accessToken);
    storage.setItem(EOS_REFRESH_STORAGE_KEY, session.refreshToken);
  }

  function readRefresh() {
    try {
      const v = storage?.getItem(EOS_REFRESH_STORAGE_KEY);
      return typeof v === "string" && v.startsWith("eosrt_") ? v : null;
    } catch {
      return null;
    }
  }

  function clear() {
    clearEosSession({ storage });
    try {
      storage?.removeItem(EOS_REFRESH_STORAGE_KEY);
    } catch {
      // nothing to do
    }
  }

  /** @returns {Promise<{status:"AUTHENTICATED", mfaEnrollmentRequired:boolean}|{status:"MFA_REQUIRED", challenge:string}>} */
  async function login(identifier, password) {
    const r = await post("/auth/login", { identifier, password });
    if (r.status === "AUTHENTICATED") {
      store(r.session);
      return { status: "AUTHENTICATED", mfaEnrollmentRequired: r.session.mfaEnrollmentRequired === true };
    }
    // The challenge lives in memory only (the caller's component state): it is worth five minutes and one factor.
    return { status: "MFA_REQUIRED", challenge: r.challenge, methods: r.methods ?? [] };
  }

  async function completeMfa(challenge, { code = undefined, recoveryCode = undefined } = {}) {
    const r = await post("/auth/login/mfa", { challenge, ...(code ? { code } : {}), ...(recoveryCode ? { recoveryCode } : {}) });
    store(r.session);
    return { status: "AUTHENTICATED", mfaEnrollmentRequired: r.session.mfaEnrollmentRequired === true };
  }

  /** Exchange the refresh token. Single-flight: concurrent callers share one exchange (a second would be REUSE). */
  function refresh() {
    if (inflightRefresh) return inflightRefresh;
    const token = readRefresh();
    if (!token) return Promise.resolve(null);
    inflightRefresh = post("/auth/refresh", { refreshToken: token })
      .then((r) => {
        store(r.session);
        return r.session.accessToken;
      }, (err) => {
        // A refused refresh ends the session here too. A network failure keeps it for the next attempt.
        if (err instanceof EosLoginError && err.code !== "NETWORK") clear();
        return null;
      })
      .finally(() => {
        inflightRefresh = null;
      });
    return inflightRefresh;
  }

  /** The access token to send: refreshed first when it is about to lapse, or null. */
  async function freshAccessToken() {
    const s = readEosSession({ storage, nowMs: now() });
    if (s && s.expiresAtMs - now() > REFRESH_LEAD_MS) return s.token;
    if (readRefresh()) return (await refresh()) ?? null;
    return s ? s.token : null;
  }

  async function logout() {
    const token = readRefresh();
    clear();
    if (token) {
      try {
        await post("/auth/logout", { refreshToken: token });
      } catch {
        // The local session is gone either way; the server session idles out.
      }
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
    hasRefreshToken: () => readRefresh() !== null,
    completeEnrollment: (ticket, password) => post("/auth/enrollment/complete", { ticket, password }),
    completeReset: (ticket, password) => post("/auth/password/reset/complete", { ticket, password }),
    // ── self-service account security ──
    describeAccount: async () => (await authed("/auth/account", {})).account,
    changePassword: async (currentPassword, newPassword) => {
      const r = await authed("/auth/password/change", { currentPassword, newPassword });
      store(r.session);
      return true;
    },
    beginTotp: () => authed("/auth/mfa/totp/begin", {}),
    confirmTotp: async (factorId, code) => (await authed("/auth/mfa/totp/confirm", { factorId, code })).recoveryCodes,
    removeTotp: (password, code) => authed("/auth/mfa/totp/remove", { password, code }),
    regenerateRecoveryCodes: async (password, code) => (await authed("/auth/mfa/recovery-codes/regenerate", { password, code })).recoveryCodes,
    revokeSession: (sessionId) => authed("/auth/sessions/revoke", { sessionId }),
    revokeOtherSessions: () => authed("/auth/sessions/revoke-others", {}),
  });
}

/** The app's one client. */
export const eosLoginClient = createEosLoginClient();

/** Words for the codes a person can act on. Never echoes a value back. */
export function eosLoginMessage(code, detail) {
  switch (code) {
    case "LOGIN_REFUSED": return "Sign-in failed. Check your sign-in name and password, or ask your administrator.";
    case "MFA_CODE_REFUSED": return "That code was not accepted. Enter the current code from your authenticator app.";
    case "MFA_CHALLENGE_INVALID": return "This sign-in step expired. Start again.";
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
    case "NOT_CONFIGURED": return "Sign-in is not configured for this environment.";
    case "NETWORK": return "The sign-in service could not be reached. Check your connection.";
    default: return "Something went wrong. Try again.";
  }
}
