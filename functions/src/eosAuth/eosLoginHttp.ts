// THE HUMAN FRONT DOOR'S TRANSPORT: /auth/* routes over EosLoginService. docs/architecture/eos-native-identity.md, 3(c).
//
//   unauthenticated (the credential is the body or the cookie)         authenticated (Bearer EOS human access token)
//   POST /auth/login     {identifier, password[, tenantId]}            POST /auth/account                       {}
//   POST /auth/login/mfa {challenge, code|recoveryCode}                POST /auth/password/change               {currentPassword, newPassword}
//   POST /auth/refresh   {}  + __Host-eos_refresh cookie               POST /auth/mfa/totp/begin                {password}
//   POST /auth/logout    {}  + cookie (and/or Bearer: its sid)         POST /auth/mfa/totp/confirm              {factorId, code}
//   POST /auth/enrollment/complete      {ticket, password}             POST /auth/mfa/totp/remove               {password, code|recoveryCode}
//   POST /auth/password/reset/complete  {ticket, password}             POST /auth/mfa/recovery-codes/regenerate {password, code}
//                                                                      POST /auth/sessions/revoke               {sessionId}
//                                                                      POST /auth/sessions/revoke-others        {}
//                                                                      POST /auth/session/switch-tenant         {tenantId}  (D-12)
//
// NOT MOUNTED unless EOS_HUMAN_LOGIN=enabled: every path is then the same 404 as any unknown route.
//
// ════════════════════ THE REFRESH COOKIE (Owner correction 1, 2026-10-11) ════════════════════
//
// The refresh token travels ONLY in `__Host-eos_refresh`: HttpOnly (no script can read it), Secure, Path=/, no Domain
// (the __Host- prefix makes a browser refuse it otherwise, so a sibling subdomain cannot plant or shadow it), SameSite
// from EOS_AUTH_COOKIE_SAMESITE, and Partitioned when SameSite=None. It never appears in a response body and is never
// accepted from a request body. The ACCESS token (5 minutes) is returned in the body and held in memory by the client.
//
// ════════════════════ ORIGIN AND CSRF (Owner correction 2) ════════════════════
//
// Every human /auth/* request -- not only the cookie-bearing ones, so login CSRF is closed too -- must carry:
//   Origin        exactly one of EOS_ALLOWED_ORIGINS (absent, "null" or anything else: 403 ORIGIN_REFUSED)
//   X-EOS-CSRF: 1 a custom header no HTML form can send and no cross-origin script can send without passing a CORS
//                 preflight this handler answers only for an allowed origin (absent: 403 CSRF_REFUSED)
//   Content-Type  application/json (else 415)
// CORS is served for allowed origins only, with Access-Control-Allow-Credentials so the cookie is sent. No wildcard.
// Every response is `no-store`. A per-client-address limiter answers 429 before any password work is spent.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VerifiedEosToken } from "./eosAccessToken";
import { EosLoginService, LoginRefusal, isHumanSubject, type ClientFacts, type IssuedLoginSession } from "./eosLoginService";
import { PasswordWorkSaturated } from "./credentialCrypto";
import type { EosCookieSameSite } from "./eosAuthConfig";

export const REFRESH_COOKIE_NAME = "__Host-eos_refresh";
export const CSRF_HEADER = "x-eos-csrf";

export const LOGIN_ROUTES = Object.freeze({
  login: "/auth/login",
  loginMfa: "/auth/login/mfa",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
  enrollmentComplete: "/auth/enrollment/complete",
  resetComplete: "/auth/password/reset/complete",
  account: "/auth/account",
  passwordChange: "/auth/password/change",
  totpBegin: "/auth/mfa/totp/begin",
  totpConfirm: "/auth/mfa/totp/confirm",
  totpRemove: "/auth/mfa/totp/remove",
  recoveryCodesRegenerate: "/auth/mfa/recovery-codes/regenerate",
  sessionRevoke: "/auth/sessions/revoke",
  sessionsRevokeOthers: "/auth/sessions/revoke-others",
  /** D-12: move this person to another of their tenants -- a NEW session bound to it; the current one ends. */
  switchTenant: "/auth/session/switch-tenant",
} as const);
const ROUTE_SET = new Set<string>(Object.values(LOGIN_ROUTES));
export const isLoginRoute = (path: string): boolean => ROUTE_SET.has(path);

/** Which budget a route spends. Credential guesses are expensive and scarce; refresh is routine. */
const ROUTE_BUDGET: Readonly<Record<string, "credential" | "routine">> = Object.freeze({
  [LOGIN_ROUTES.login]: "credential", [LOGIN_ROUTES.loginMfa]: "credential",
  [LOGIN_ROUTES.enrollmentComplete]: "credential", [LOGIN_ROUTES.resetComplete]: "credential",
  [LOGIN_ROUTES.passwordChange]: "credential", [LOGIN_ROUTES.totpConfirm]: "credential",
  [LOGIN_ROUTES.totpRemove]: "credential", [LOGIN_ROUTES.recoveryCodesRegenerate]: "credential",
});

// ════════════════════ rate limiting ════════════════════

export interface RateLimitPolicy { readonly credentialPerMinute: number; readonly routinePerMinute: number }
export const DEFAULT_RATE_LIMIT: RateLimitPolicy = Object.freeze({ credentialPerMinute: 10, routinePerMinute: 120 });

/**
 * A fixed one-minute window per (client address, budget). In-process: with several instances each enforces its own,
 * which still bounds a single attacker per instance; the per-ACCOUNT lockout in PostgreSQL is the cross-instance bound.
 */
/**
 * The bucket an address belongs to: an IPv4 address as is; an IPv6 address by its /64 (one subscriber's allocation is
 * a /64 or larger, so per-address buckets would give one attacker 2^64 of them -- security review finding 5).
 */
export function rateLimitBucket(address: string): string {
  const a = address.trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  if (!a.includes(":")) return a;
  const [head, tail = ""] = a.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = a.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export const RATE_LIMIT_MAX_KEYS = 50_000;

export function createRateLimiter(policy: RateLimitPolicy = DEFAULT_RATE_LIMIT, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return function allow(address: string, budget: "credential" | "routine"): { ok: boolean; retryAfterSeconds: number } {
    const t = now();
    if (windows.size >= RATE_LIMIT_MAX_KEYS) {
      // Evict EXPIRED windows, then the OLDEST -- never everyone's at once (finding 6: clearing all would let an attacker
      // with many addresses reset every other client's budget).
      for (const [k, w] of windows) if (t - w.start >= 60_000) windows.delete(k);
      for (const k of windows.keys()) {
        if (windows.size < RATE_LIMIT_MAX_KEYS) break;
        windows.delete(k);
      }
    }
    const key = `${budget}|${rateLimitBucket(address)}`;
    const w = windows.get(key);
    if (!w || t - w.start >= 60_000) {
      windows.set(key, { start: t, count: 1 });
      return { ok: true, retryAfterSeconds: 0 };
    }
    w.count += 1;
    const limit = budget === "credential" ? policy.credentialPerMinute : policy.routinePerMinute;
    return w.count <= limit ? { ok: true, retryAfterSeconds: 0 } : { ok: false, retryAfterSeconds: Math.ceil((w.start + 60_000 - t) / 1000) };
  };
}

// ════════════════════ the pure handler ════════════════════

export interface LoginHttpOptions {
  readonly service: EosLoginService;
  /** The EOS token verifier (signature, iss/aud/env, lifetime). Required: the self routes take a Bearer. */
  readonly verify: (token: string) => VerifiedEosToken;
  readonly allowedOrigins?: readonly string[];
  readonly rateLimit?: ReturnType<typeof createRateLimiter>;
  /**
   * How many proxies append X-Forwarded-For in front of this service (EOS_AUTH_TRUSTED_PROXY_HOPS). The client address
   * is the entry that many places from the RIGHT; everything left of it is whatever the client claimed. 0 = the socket.
   */
  readonly trustedProxyHops: number;
  /** An edge-SET client-address header (EOS_AUTH_CLIENT_IP_HEADER); takes precedence over hop counting when present. */
  readonly clientIpHeader?: "true-client-ip" | "cf-connecting-ip" | null;
  /** The refresh cookie's SameSite (EOS_AUTH_COOKIE_SAMESITE). None also sets Partitioned. */
  readonly cookieSameSite: EosCookieSameSite;
  readonly now?: () => Date;
}

export interface LoginHttpRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers?: Record<string, string | string[] | undefined>;
  readonly body?: string;
  readonly remoteAddress?: string | null;
}
export interface LoginHttpResponse { readonly status: number; readonly headers: Record<string, string>; readonly body: string }

function headers(origin: string | null): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    vary: "Origin",
    ...(origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } : {}),
  };
}
/** Response headers may carry ONE Set-Cookie here; node's writeHead takes a string. */
const json = (status: number, body: unknown, origin: string | null, extra: Record<string, string> = {}): LoginHttpResponse =>
  ({ status, headers: { ...headers(origin), ...extra }, body: JSON.stringify(body) });

function refreshCookie(options: LoginHttpOptions, token: string, expiresAtIso: string): string {
  const now = (options.now ?? (() => new Date()))().getTime();
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAtIso) - now) / 1000));
  return [`${REFRESH_COOKIE_NAME}=${token}`, "Path=/", "Secure", "HttpOnly", `SameSite=${options.cookieSameSite}`,
    `Max-Age=${maxAge}`, ...(options.cookieSameSite === "None" ? ["Partitioned"] : [])].join("; ");
}
function clearedCookie(options: LoginHttpOptions): string {
  return [`${REFRESH_COOKIE_NAME}=`, "Path=/", "Secure", "HttpOnly", `SameSite=${options.cookieSameSite}`, "Max-Age=0",
    ...(options.cookieSameSite === "None" ? ["Partitioned"] : [])].join("; ");
}

/** The refresh token from the Cookie header, or null. First occurrence only; never a body field. */
export function readRefreshCookie(cookieHeader: string | string[] | undefined): string | null {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader;
  if (typeof raw !== "string") return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === REFRESH_COOKIE_NAME) {
      const v = part.slice(i + 1).trim();
      return v.length > 0 ? v : null;
    }
  }
  return null;
}

/** The session as the body carries it: everything but the refresh token, which went into the cookie. */
function publicSession(session: IssuedLoginSession) {
  const { refreshToken: _omitted, ...rest } = session;
  return rest;
}

const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function originOf(allowed: readonly string[] | undefined, value: string | undefined): string | null {
  if (!value || !allowed || allowed.length === 0) return null;
  return allowed.includes(value) ? value : null;
}

const IP_LITERAL = /^[0-9A-Fa-f:.]{2,45}$/;

function clientFacts(options: LoginHttpOptions, request: LoginHttpRequest): ClientFacts {
  const ua0 = single(request.headers?.["user-agent"]);
  if (options.clientIpHeader) {
    const v = single(request.headers?.[options.clientIpHeader])?.trim();
    // The edge sets it; a value that is not an address literal is ignored, never trusted.
    if (v && IP_LITERAL.test(v)) return { address: v, label: typeof ua0 === "string" ? ua0.slice(0, 200) : null };
  }
  const hops = options.trustedProxyHops;
  const chain = hops > 0 ? (single(request.headers?.["x-forwarded-for"]) ?? "").split(",").map((x) => x.trim()).filter(Boolean) : [];
  // With N trusted appending proxies, the client is the N-th entry from the right. Fewer entries than that: the request
  // did not come through the proxies we were told about, so the socket address is used.
  const forwarded = hops > 0 && chain.length >= hops ? chain[chain.length - hops] : undefined;
  const ua = single(request.headers?.["user-agent"]);
  return { address: forwarded || request.remoteAddress || null, label: typeof ua === "string" ? ua.slice(0, 200) : null };
}

function bearer(request: LoginHttpRequest): string | null {
  const h = single(request.headers?.authorization);
  if (!h) return null;
  const m = /^Bearer ([A-Za-z0-9._-]{16,4096})$/.exec(h.trim());
  return m ? m[1] : null;
}

const refusalBody = (err: LoginRefusal) => ({
  ok: false, code: err.code,
  // A policy refusal names which rule (PASSWORD_TOO_SHORT, ...) so a form can say why; nothing else carries detail.
  ...(err.code === "PASSWORD_POLICY" || err.status === 400 || err.status === 403 || err.status === 404 || err.status === 409
    ? { detail: err.detail } : {}),
});

export async function handleLoginRequest(options: LoginHttpOptions, request: LoginHttpRequest): Promise<LoginHttpResponse> {
  const method = (request.method ?? "GET").toUpperCase();
  const path = (request.url ?? "/").split("?")[0].replace(/\/$/, "");
  const origin = originOf(options.allowedOrigins, single(request.headers?.origin));
  if (!isLoginRoute(path)) return json(404, { ok: false, code: "NOT_FOUND", message: "no such route" }, origin);
  if (method === "OPTIONS") {
    return { status: 204, headers: { ...headers(origin), ...(origin ? { "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": `authorization, content-type, ${CSRF_HEADER}`, "access-control-max-age": "600" } : {}) }, body: "" };
  }
  if (method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST only" }, origin);
  // ORIGIN + CSRF, before anything else is read or spent.
  if (!origin) return json(403, { ok: false, code: "ORIGIN_REFUSED", message: "this origin may not call the sign-in service" }, null);
  if (single(request.headers?.[CSRF_HEADER]) !== "1") {
    return json(403, { ok: false, code: "CSRF_REFUSED", message: `the ${CSRF_HEADER} header is required` }, origin);
  }
  if (!/^application\/json\b/i.test(single(request.headers?.["content-type"]) ?? "")) {
    return json(415, { ok: false, code: "UNSUPPORTED_MEDIA_TYPE", message: "send application/json" }, origin);
  }

  const facts = clientFacts(options, request);
  if (options.rateLimit) {
    const verdict = options.rateLimit(facts.address ?? "unknown", ROUTE_BUDGET[path] ?? "routine");
    if (!verdict.ok) {
      return json(429, { ok: false, code: "RATE_LIMITED", message: "too many attempts; wait and try again" }, origin,
        { "retry-after": String(verdict.retryAfterSeconds) });
    }
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = request.body && request.body.trim() ? JSON.parse(request.body) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, code: "INVALID_INPUT", message: "the body must be a JSON object" }, origin);
  }

  const s = options.service;
  // A session goes out as: access token in the body, refresh token in the cookie -- never both in one place.
  const issued = (session: IssuedLoginSession, extra: Record<string, unknown> = {}) =>
    json(200, { ok: true, ...extra, session: publicSession(session) }, origin,
      { "set-cookie": refreshCookie(options, session.refreshToken, session.refreshTokenExpiresAt) });
  const cookieToken = readRefreshCookie(request.headers?.cookie);
  try {
    switch (path) {
      case LOGIN_ROUTES.login:
      case LOGIN_ROUTES.loginMfa: {
        const r = path === LOGIN_ROUTES.login
          ? await s.login({ identifier: body.identifier, password: body.password, tenantId: body.tenantId }, facts)
          : await s.completeMfaLogin({ challenge: body.challenge, code: body.code, recoveryCode: body.recoveryCode }, facts);
        if (r.status === "AUTHENTICATED") return issued(r.session, { status: r.status });
        return json(200, { ok: true, ...r }, origin);
      }
      case LOGIN_ROUTES.refresh:
        try {
          return issued(await s.refresh({ refreshToken: cookieToken }, facts));
        } catch (err) {
          // A sibling tab already rotated: the browser holds the successor; keep the cookie and let the client retry.
          if (err instanceof LoginRefusal && err.code === "REFRESH_SUPERSEDED") throw err;
          if (err instanceof LoginRefusal) {
            return json(err.status, refusalBody(err), origin, { "set-cookie": clearedCookie(options) });
          }
          throw err;
        }
      case LOGIN_ROUTES.logout: {
        // Server-side first: the session row is revoked, so the refresh token is dead wherever a copy may be. By the
        // cookie when it is sent; ALSO by the access token's session when one is presented (finding 11).
        await s.logout({ refreshToken: cookieToken }, facts);
        const t = bearer(request);
        if (t) {
          try {
            const v = options.verify(t);
            if (isHumanSubject(v.externalSubject) && v.sessionId) await s.logoutSession(v.externalSubject, v.sessionId, facts);
          } catch {
            // An unverifiable bearer revokes nothing and reveals nothing.
          }
        }
        return json(200, { ok: true }, origin, { "set-cookie": clearedCookie(options) });
      }
      case LOGIN_ROUTES.enrollmentComplete:
        return json(200, { ok: true, ...(await s.completeEnrollment({ ticket: body.ticket, password: body.password }, facts)) }, origin);
      case LOGIN_ROUTES.resetComplete:
        return json(200, { ok: true, ...(await s.completeReset({ ticket: body.ticket, password: body.password }, facts)) }, origin);
      default:
        break;
    }

    // ── authenticated self-service ──
    const token = bearer(request);
    if (!token) return json(401, { ok: false, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
    let verified: VerifiedEosToken;
    try {
      verified = options.verify(token);
    } catch {
      return json(401, { ok: false, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
    }
    // Self-service is for HUMAN login sessions. A persona or Firebase identity has no login account to manage.
    if (!isHumanSubject(verified.externalSubject) || !verified.sessionId) {
      return json(403, { ok: false, code: "NOT_A_LOGIN_SESSION", message: "account security requires an EOS login session" }, origin);
    }
    const sub = verified.externalSubject;
    const sid = verified.sessionId;
    switch (path) {
      case LOGIN_ROUTES.account:
        return json(200, { ok: true, account: await s.describeSelf(sub, sid) }, origin);
      case LOGIN_ROUTES.passwordChange:
        return issued(await s.changePassword(sub, sid, { currentPassword: body.currentPassword, newPassword: body.newPassword }, facts));
      case LOGIN_ROUTES.totpBegin:
        return json(200, { ok: true, ...(await s.beginTotpEnrollment(sub, sid, { password: body.password }, facts)) }, origin);
      case LOGIN_ROUTES.totpConfirm:
        return json(200, { ok: true, ...(await s.confirmTotpEnrollment(sub, sid, { factorId: body.factorId, code: body.code }, facts)) }, origin);
      case LOGIN_ROUTES.totpRemove:
        return json(200, { ok: true, ...(await s.removeTotp(sub, sid, { password: body.password, code: body.code, recoveryCode: body.recoveryCode }, facts)) }, origin);
      case LOGIN_ROUTES.recoveryCodesRegenerate:
        return json(200, { ok: true, ...(await s.regenerateRecoveryCodes(sub, sid, { password: body.password, code: body.code }, facts)) }, origin);
      case LOGIN_ROUTES.sessionRevoke:
        return json(200, { ok: true, ...(await s.revokeOwnSession(sub, sid, { sessionId: body.sessionId }, facts)) }, origin);
      case LOGIN_ROUTES.sessionsRevokeOthers:
        return json(200, { ok: true, ...(await s.revokeOtherSessions(sub, sid, facts)) }, origin);
      case LOGIN_ROUTES.switchTenant:
        return issued(await s.switchTenant(sub, sid, { tenantId: body.tenantId }, facts));
      default:
        return json(404, { ok: false, code: "NOT_FOUND", message: "no such route" }, origin);
    }
  } catch (err) {
    if (err instanceof LoginRefusal) return json(err.status, refusalBody(err), origin);
    if (err instanceof PasswordWorkSaturated) {
      return json(503, { ok: false, code: "TRY_LATER", message: "the sign-in service is busy; try again shortly" }, origin, { "retry-after": "5" });
    }
    // eslint-disable-next-line no-console -- the class only: never a body, a token or an identifier
    console.error("[eosLogin] unhandled", (err as Error)?.name ?? "error");
    return json(500, { ok: false, code: "INTERNAL", message: "the request could not be completed" }, origin);
  }
}

const MAX_BODY_BYTES = 8192;

export function createLoginHttpHandler(options: LoginHttpOptions) {
  return async function nodeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let response: LoginHttpResponse;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > MAX_BODY_BYTES) throw new Error("TOO_LARGE");
        chunks.push(buf);
      }
      response = await handleLoginRequest(options, {
        method: req.method, url: req.url, headers: req.headers as Record<string, string | string[] | undefined>,
        body: Buffer.concat(chunks).toString("utf8"), remoteAddress: req.socket?.remoteAddress ?? null,
      });
    } catch {
      response = json(400, { ok: false, code: "INVALID_INPUT", message: "the request could not be read" }, null);
    }
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };
}
