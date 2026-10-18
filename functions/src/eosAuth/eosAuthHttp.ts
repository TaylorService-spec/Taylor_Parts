// THE EOS AUTH TRANSPORT: the composite bearer verifier, and the nonprod persona-session route.
// docs/architecture/eos-identity-session-foundation.md, sections 3(a), 3(d).
//
// ════════════════════ ONE VERIFIER SEAM, TWO PROVIDERS ════════════════════
//
// Every domain transport takes ONE `verifyToken`. This composes it: a bearer whose (unverified, routing
// only) header says alg EdDSA -- or whose payload names the configured EOS issuer -- goes to the EOS
// verifier and ONLY to it (an EOS-shaped token that fails EOS verification is refused, never retried as
// Firebase). Everything else goes to the Firebase verifier, unchanged. With EOS verification not configured,
// the composite IS the Firebase verifier plus a refusal of EdDSA bearers.
//
// ════════════════════ THE PERSONA ROUTE ════════════════════
//
//   POST /auth/nonprod/persona-session     body { "personaKey": "<one of 16>" }
//   header x-eos-persona-issuer-credential: <credential>
//
// Mounted ONLY when the persona issuer is fully configured, which readEosAuthConfig allows only under
// EOS_ENVIRONMENT=nonprod. Otherwise the path is a 404 like any unknown route. The credential is compared as
// SHA-256 in constant time; the service holds the hash, never the credential. No CORS is served: this is a
// machine-to-machine route. The token is returned to the caller and written nowhere else.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { peekUnverifiedJws, sha256Hex, EosTokenError } from "./eosAccessToken";
import type { EosAuthRuntime } from "./eosAuthConfig";
import { issueNonprodPersonaSession, PersonaIssuanceError } from "./eosSessionIssuer";
import { isHumanSubject } from "./eosLoginService";
import { isNonprodPersonaSubject } from "./nonprodPersonas";
import type { VerifiedPath, VerifierMetrics } from "./verifierMetrics";
import { bindSessionTenant } from "./requestTenantBinding";
import { CLIENT_IP_DIAGNOSTIC_ROUTE, createClientIpDiagnosticHandler } from "./clientIpDiagnostic";
import { isLoginRoute } from "./eosLoginHttp";
import type { PolicyRepository } from "../adminPolicy/policyRepository";

export interface VerifiedIdentity {
  readonly externalSubject: string;
  readonly identityProvider: string;
}
export type TokenVerifier = (bearerToken: string) => Promise<VerifiedIdentity>;

export const PERSONA_SESSION_ROUTE = "/auth/nonprod/persona-session";
export const PERSONA_ISSUER_CREDENTIAL_HEADER = "x-eos-persona-issuer-credential";
/** 32 random bytes, base64url, is 43 characters. Anything shorter is not a credential this route accepts. */
export const PERSONA_ISSUER_CREDENTIAL_MIN_LENGTH = 43;
const MAX_BODY_BYTES = 4096;

/** Should this bearer be judged by the EOS verifier? Routing only -- nothing here is believed. */
export function isEosShapedBearer(token: string, eosIssuer: string | null): boolean {
  const peek = peekUnverifiedJws(token);
  if (!peek) return false;
  if (peek.header.alg === "EdDSA") return true;
  return eosIssuer !== null && peek.payload.iss === eosIssuer;
}

/**
 * The human-session gate (eosLoginService.checkSession in "api" mode): a HUMAN EOS token is good only while its login
 * session is live, its account active and its second-factor obligation met -- checked on every request, so a revoked
 * session or a disabled account stops working immediately, not at `exp`.
 */
export type HumanSessionGate = (subject: string, sessionId: string | null) => Promise<{
  /** The session's ONE tenant (D-12): the request is bound to it (requestTenantBinding.ts). */
  readonly tenantId: string;
  /** Records a refused statement of another tenant. */
  readonly onTenantRefusal?: (requestedTenantId: string) => Promise<void>;
}>;

export function createCompositeTokenVerifier(input: {
  readonly eos: EosAuthRuntime;
  readonly firebase: TokenVerifier;
  /** Absent: human login is not mounted, and a human-subject token is refused outright. */
  readonly humanSessionGate?: HumanSessionGate | null;
  /** Counts which verifier admitted or refused each bearer (verifierMetrics.ts). Absent: nothing is counted. */
  readonly metrics?: VerifierMetrics | null;
}): TokenVerifier {
  const { eos, firebase } = input;
  const gate = input.humanSessionGate ?? null;
  const metrics = input.metrics ?? null;
  // THE VERIFIER SWITCH (EOS_AUTH_FIREBASE_VERIFIER=disabled): a bearer that is not an EOS token is refused here, before
  // the Firebase verifier is ever called -- firebase-admin is not loaded, no Google endpoint is contacted.
  const firebaseOff = eos.firebaseVerifier === "disabled";

  async function verifyEosBearer(bearerToken: string): Promise<{ identity: VerifiedIdentity; path: VerifiedPath }> {
    if (!eos.verify) throw new EosTokenError("ALGORITHM_REFUSED");
    const v = eos.verify(bearerToken);
    const human = isHumanSubject(v.externalSubject);
    // A LOGIN SESSION is a token that names one (`sid`) -- and every human token must. A persona subject may carry `sid`
    // ONLY when it is an enrolled persona's password session (enrollPersonaLogin); the persona ISSUER mints none, so a
    // persona token without `sid` is the machine path and takes none of the session gate.
    if (human || v.sessionId !== null) {
      if (!(human || isNonprodPersonaSubject(v.externalSubject))) throw new EosTokenError("CLAIM_REFUSED");
      if (!gate || !v.sessionId) throw new EosTokenError("CLAIM_REFUSED");
      const live = await gate(v.externalSubject, v.sessionId);
      // BIND this request to the session's tenant, or refuse: an unbindable human token could state any tenant.
      const bound = bindSessionTenant({ identityProvider: v.identityProvider, externalSubject: v.externalSubject,
        tenantId: live.tenantId, onRefusal: live.onTenantRefusal });
      if (!bound) throw new EosTokenError("CLAIM_REFUSED");
      return { identity: { externalSubject: v.externalSubject, identityProvider: v.identityProvider }, path: "eos_human" };
    }
    return { identity: { externalSubject: v.externalSubject, identityProvider: v.identityProvider }, path: "eos_persona" };
  }

  return async function verifyBearer(bearerToken: string): Promise<VerifiedIdentity> {
    if (isEosShapedBearer(bearerToken, eos.issuer)) {
      try {
        const { identity, path } = await verifyEosBearer(bearerToken);
        metrics?.verified(path);
        return identity;
      } catch (err) {
        metrics?.refused("eos_invalid");
        throw err;
      }
    }
    if (firebaseOff) {
      metrics?.refused("firebase_disabled");
      throw new EosTokenError("FIREBASE_VERIFIER_DISABLED");
    }
    try {
      const identity = await firebase(bearerToken);
      metrics?.verified("firebase");
      return identity;
    } catch (err) {
      metrics?.refused("firebase_invalid");
      throw err;
    }
  };
}

// ════════════════════ the persona route ════════════════════

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function credentialMatches(presented: unknown, expectedSha256: string): boolean {
  if (typeof presented !== "string" || presented.length < PERSONA_ISSUER_CREDENTIAL_MIN_LENGTH || presented.length > 512) return false;
  const a = Buffer.from(sha256Hex(presented), "hex");
  const b = Buffer.from(expectedSha256, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("TOO_LARGE");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createEosAuthHttpHandler(deps: {
  readonly repo: PolicyRepository;
  readonly auth: EosAuthRuntime;
  readonly environment: string;
  /** The human front door (eosLoginHttp.ts). Absent unless EOS_HUMAN_LOGIN=enabled: its paths are then 404. */
  readonly login?: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null;
}) {
  const diagnostic = deps.auth.clientIpDiagnosticSha256 && deps.environment === "nonprod"
    ? createClientIpDiagnosticHandler(deps.auth.clientIpDiagnosticSha256) : null;
  return async function handleEosAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "").split("?")[0];
    // The one-time client-address measurement: mounted only while its operator credential hash is configured (nonprod).
    if (diagnostic && path === CLIENT_IP_DIAGNOSTIC_ROUTE) {
      // Contained: a defect in the measurement answers 500 for this request and never rejects into the server loop.
      try {
        await diagnostic(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        if (!res.writableEnded) res.end(JSON.stringify({ ok: false, code: "INTERNAL" }));
      }
      return;
    }
    if (deps.login && isLoginRoute(path.replace(/\/$/, ""))) {
      await deps.login(req, res);
      return;
    }
    const issuer = deps.auth.personaIssuer;
    // NOT MOUNTED unless nonprod and fully configured: indistinguishable from any unknown path.
    if (path !== PERSONA_SESSION_ROUTE || !issuer || deps.environment !== "nonprod"
      || !deps.auth.issuer || !deps.auth.audience) {
      send(res, 404, { ok: false, code: "NOT_FOUND", message: "no such route" });
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "POST only" });
      return;
    }
    const presented = req.headers[PERSONA_ISSUER_CREDENTIAL_HEADER];
    if (!credentialMatches(Array.isArray(presented) ? undefined : presented, issuer.credentialSha256)) {
      send(res, 401, { ok: false, code: "UNAUTHENTICATED", message: "a valid persona issuer credential is required" });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      send(res, 400, { ok: false, code: "INVALID_INPUT", message: "the body must be a JSON object under 4 KB" });
      return;
    }
    // ONE field. A subject, principal, tenant or role in the body is refused rather than ignored.
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !("personaKey" in body)) {
      send(res, 400, { ok: false, code: "INVALID_INPUT", message: "the body must be exactly { personaKey }" });
      return;
    }
    try {
      const session = await issueNonprodPersonaSession({
        repo: deps.repo, signer: issuer.signer, issuer: deps.auth.issuer, audience: deps.auth.audience,
        environment: deps.environment,
      }, (body as { personaKey: unknown }).personaKey);
      send(res, 200, { ok: true, ...session });
    } catch (err) {
      if (err instanceof PersonaIssuanceError) {
        const status = err.refusal === "UNKNOWN_PERSONA" ? 400 : err.refusal === "PERSONA_NOT_ELIGIBLE" ? 403 : 404;
        send(res, status, { ok: false, code: err.refusal, message: err.detail ?? err.refusal });
        return;
      }
      send(res, 503, { ok: false, code: "UNAVAILABLE", message: "the session could not be issued" });
    }
  };
}
