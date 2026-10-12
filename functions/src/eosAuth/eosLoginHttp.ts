// THE HUMAN FRONT DOOR'S TRANSPORT: /auth/* routes over EosLoginService. docs/architecture/eos-native-identity.md, 3(c).
//
//   unauthenticated (the body is the credential)          authenticated (Bearer EOS human access token)
//   POST /auth/login             {identifier, password}   POST /auth/account                   {}
//   POST /auth/login/mfa         {challenge, code|recoveryCode}
//   POST /auth/refresh           {refreshToken}           POST /auth/password/change           {currentPassword, newPassword}
//   POST /auth/logout            {refreshToken}           POST /auth/mfa/totp/begin            {}
//   POST /auth/enrollment/complete {ticket, password}     POST /auth/mfa/totp/confirm          {factorId, code}
//   POST /auth/password/reset/complete {ticket, password} POST /auth/mfa/totp/remove           {password, code|recoveryCode}
//                                                         POST /auth/mfa/recovery-codes/regenerate {password, code}
//                                                         POST /auth/sessions/revoke           {sessionId}
//                                                         POST /auth/sessions/revoke-others    {}
//
// NOT MOUNTED unless EOS_HUMAN_LOGIN=enabled: every path is then the same 404 as any unknown route.
//
// Browser-facing, so CORS is served for EOS_ALLOWED_ORIGINS exactly as the domain transports serve it (no wildcard, no
// credentials mode: tokens travel in the body and the Authorization header, never a cookie -- see D-3). Every response
// is `no-store`. A per-client-address limiter answers 429 before any password work is spent.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VerifiedEosToken } from "./eosAccessToken";
import { EosLoginService, LoginRefusal, isHumanSubject, type ClientFacts } from "./eosLoginService";

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
export function createRateLimiter(policy: RateLimitPolicy = DEFAULT_RATE_LIMIT, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return function allow(address: string, budget: "credential" | "routine"): { ok: boolean; retryAfterSeconds: number } {
    const t = now();
    if (windows.size > 50_000) {
      for (const [k, w] of windows) if (t - w.start >= 60_000) windows.delete(k);
      if (windows.size > 50_000) windows.clear();
    }
    const key = `${budget}|${address}`;
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
  /** Take the client address from X-Forwarded-For (rightmost hop) -- only behind a proxy that appends it (Render). */
  readonly trustForwardedFor?: boolean;
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
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  };
}
const json = (status: number, body: unknown, origin: string | null, extra: Record<string, string> = {}): LoginHttpResponse =>
  ({ status, headers: { ...headers(origin), ...extra }, body: JSON.stringify(body) });

const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function originOf(allowed: readonly string[] | undefined, value: string | undefined): string | null {
  if (!value || !allowed || allowed.length === 0) return null;
  return allowed.includes(value) ? value : null;
}

function clientFacts(options: LoginHttpOptions, request: LoginHttpRequest): ClientFacts {
  // The RIGHTMOST hop is the one the trusted proxy appended; everything left of it is whatever the client claimed.
  const forwarded = options.trustForwardedFor ? single(request.headers?.["x-forwarded-for"])?.split(",").pop()?.trim() : undefined;
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
    return { status: 204, headers: { ...headers(origin), "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "600" }, body: "" };
  }
  if (method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST only" }, origin);

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
  try {
    switch (path) {
      case LOGIN_ROUTES.login:
        return json(200, { ok: true, ...(await s.login({ identifier: body.identifier, password: body.password }, facts)) }, origin);
      case LOGIN_ROUTES.loginMfa:
        return json(200, { ok: true, ...(await s.completeMfaLogin({ challenge: body.challenge, code: body.code, recoveryCode: body.recoveryCode }, facts)) }, origin);
      case LOGIN_ROUTES.refresh:
        return json(200, { ok: true, session: await s.refresh({ refreshToken: body.refreshToken }, facts) }, origin);
      case LOGIN_ROUTES.logout:
        await s.logout({ refreshToken: body.refreshToken }, facts);
        return json(200, { ok: true }, origin);
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
        return json(200, { ok: true, session: await s.changePassword(sub, sid, { currentPassword: body.currentPassword, newPassword: body.newPassword }, facts) }, origin);
      case LOGIN_ROUTES.totpBegin:
        return json(200, { ok: true, ...(await s.beginTotpEnrollment(sub, sid)) }, origin);
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
      default:
        return json(404, { ok: false, code: "NOT_FOUND", message: "no such route" }, origin);
    }
  } catch (err) {
    if (err instanceof LoginRefusal) return json(err.status, refusalBody(err), origin);
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
