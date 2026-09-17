// The HTTP transport for the governed PostgreSQL CRM surface (Account, Contact, customer site). Domain-separated from
// Administration, Operations and Commercial; composed by server.ts only.
//
//   bearer token -> injected TokenVerifier (external subject + provider, nothing else)
//               -> resolveOperationalContext (EOS Principal, ACTIVE tenant membership, Roles, role_capabilities)
//               -> the resolved CRM actor { tenantId, principalId = EOS Principal id, capabilities }
//               -> ONE operation from the closed list below -> the exact governed CRM authority function
//               -> a safe HTTP response
//
// ACTIVATION GATE: the PostgreSQL CRM authority is not the CRM source of truth until the cutover's ACTIVATE_POSTGRES
// transition is committed (crm/crmWriterState.ts CRM_WRITER_AUTHORITY). Until then EVERY operation -- reads included,
// because an un-copied PostgreSQL CRM is not an authoritative answer -- refuses 503 POSTGRES_CRM_WRITER_INACTIVE after
// authentication and before the caller context or any CRM table is touched. The authority is a code constant; server.ts
// never supplies `writerAuthority`, and a static test holds that.
//
// No SQL, no capability policy and no CRM business rule lives here. Firebase is TRANSITIONAL IDENTITY ONLY and never
// imported: the verifier is injected. The tenant arrives only as the x-eos-tenant header, which the resolver checks
// against membership and never adopts; authority fields in the body are refused (and refused again by the authority).
import type { Pool } from "pg";
import { resolveOperationalContext } from "../eosOps/capabilityAuthority";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { CrmAuthorityError, CALLER_AUTHORITY_FIELDS, type CrmActorContext, type CrmErrorCategory, type CrmRowFinding } from "./crmAuthorityKernel";
import { createAccount, getAccount, listAccountOwnershipHistory, listAccounts, updateAccount } from "./accountAuthority";
import { createContact, getContact, importAccountContacts, listAccountContacts, updateContact } from "./contactAuthority";
import { createAccountLocation, getAccountLocation, listAccountLocations, updateAccountLocation } from "./accountLocationAuthority";
import { CRM_WRITER_AUTHORITY, PostgresCrmWriterInactiveError, assertPostgresCrmWriterActive, type CrmWriterAuthority } from "../crm/crmWriterState";

export interface VerifiedIdentity {
  readonly externalSubject: string;
  readonly identityProvider: string;
}
export type TokenVerifier = (bearerToken: string) => Promise<VerifiedIdentity>;

export const CRM_ROUTE = "/crm/customer";

export interface CrmApiDeps {
  readonly reader: PolicyReader;
  readonly pool: Pool;
  /** TEST SEAM ONLY. Production composition never sets it, so the committed CRM_WRITER_AUTHORITY decides. */
  readonly writerAuthority?: CrmWriterAuthority;
}

type Input = Record<string, unknown>;
type Runner = (deps: { pool: Pool }, actor: CrmActorContext, input: Input) => Promise<unknown>;

const RUNNERS = Object.freeze({
  createAccount, updateAccount, getAccount, listAccounts, listAccountOwnershipHistory,
  createContact, importAccountContacts, updateContact, getContact, listAccountContacts,
  createAccountLocation, updateAccountLocation, getAccountLocation, listAccountLocations,
} as const satisfies Record<string, Runner>);

export type CrmOperation = keyof typeof RUNNERS;
export const CRM_OPERATIONS = Object.freeze(Object.keys(RUNNERS) as CrmOperation[]);
export const isCrmOperation = (name: unknown): name is CrmOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(RUNNERS, name);

export const STATUS_BY_CATEGORY: Readonly<Record<CrmErrorCategory, number>> = Object.freeze({
  INVALID_INPUT: 400, NOT_FOUND: 404, PRECONDITION_FAILED: 412, CONFLICT: 409, FORBIDDEN: 403, UNAVAILABLE: 503, FAILED: 500,
});

export type CrmApiResult =
  | { readonly ok: true; readonly operation: CrmOperation; readonly result: unknown }
  | {
      readonly ok: false; readonly operation: string; readonly code: string; readonly message: string; readonly status: number;
      /** Per-row refusals of a multi-row command (importAccountContacts), by zero-based row index. */
      readonly findings?: readonly CrmRowFinding[];
    };

/** Execute one named CRM operation for an already-verified caller. */
export async function executeCrmOperation(
  deps: CrmApiDeps,
  request: {
    readonly caller: { readonly externalSubject: string; readonly identityProvider: string; readonly requestedTenantId: string | null };
    readonly operation: CrmOperation;
    readonly input: Input;
  },
): Promise<CrmApiResult> {
  const { operation } = request;
  try {
    assertPostgresCrmWriterActive(`crm.transport.${operation}`, deps.writerAuthority ?? CRM_WRITER_AUTHORITY);
    const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
      identityProvider: request.caller.identityProvider,
      externalSubject: request.caller.externalSubject,
      requestedTenantId: request.caller.requestedTenantId,
    });
    const actor: CrmActorContext = Object.freeze({
      tenantId: ctx.principalContext.tenantId,
      principalId: ctx.principalContext.uid,
      capabilities: ctx.capabilities,
    });
    const run = RUNNERS[operation] as Runner;
    return { ok: true, operation, result: await run({ pool: deps.pool }, actor, request.input) };
  } catch (err) {
    if (err instanceof PostgresCrmWriterInactiveError) {
      return { ok: false, operation, code: err.code, message: "the PostgreSQL CRM authority is not active yet; the CRM cutover has not completed", status: 503 };
    }
    if (err instanceof PrincipalContextError) return { ok: false, operation, code: "FORBIDDEN", message: err.refusal, status: 403 };
    if (err instanceof CrmAuthorityError) {
      return {
        ok: false, operation, code: err.code, message: err.message, status: STATUS_BY_CATEGORY[err.category] ?? 500,
        ...(err.findings ? { findings: err.findings } : {}),
      };
    }
    // eslint-disable-next-line no-console -- same posture as the sibling transports' unhandled-error log
    console.error("[crmHttp] unhandled", err);
    return { ok: false, operation, code: "INTERNAL", message: "the request could not be completed", status: 500 };
  }
}

// ════════════════════ transport ════════════════════

export interface CrmHttpOptions extends CrmApiDeps {
  readonly verifyToken: TokenVerifier;
  readonly allowedOrigins?: readonly string[];
}
export interface HttpRequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: string;
}
export interface HttpResponseShape {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export const MAX_CRM_BODY_BYTES = 1_000_000;

const baseHeaders = (origin: string | null): Record<string, string> => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
});
const json = (status: number, body: unknown, origin: string | null): HttpResponseShape => ({ status, headers: baseHeaders(origin), body: JSON.stringify(body) });
const failure = (status: number, operation: string, code: string, message: string, origin: string | null, findings?: readonly CrmRowFinding[]) =>
  json(status, { ok: false, operation, code, message, ...(findings ? { findings } : {}) }, origin);

/**
 *   POST    /crm/customer   { "operation": <closed name>, "input": { ... } }. Authenticated.
 *   OPTIONS /crm/customer   CORS preflight.
 */
export async function handleCrmRequest(options: CrmHttpOptions, request: HttpRequestLike): Promise<HttpResponseShape> {
  const method = (request.method ?? "GET").toUpperCase();
  const path = pathOf(request.url ?? "/");
  const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));

  if (path !== CRM_ROUTE) return failure(404, "", "UNKNOWN_OPERATION", "no such CRM route", origin);
  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        ...baseHeaders(origin),
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-eos-tenant",
        "access-control-max-age": "600",
      },
      body: "",
    };
  }
  if (method !== "POST") return failure(405, "", "METHOD_NOT_ALLOWED", "use POST", origin);
  if (typeof request.body === "string" && Buffer.byteLength(request.body, "utf8") > MAX_CRM_BODY_BYTES) {
    return failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", origin);
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = parseEnvelope(request.body);
  } catch {
    return failure(400, "", "INVALID_INPUT", "body must be a JSON object", origin);
  }
  if (Object.keys(envelope).some((k) => k !== "operation" && k !== "input")) {
    return failure(400, String(envelope.operation ?? ""), "INVALID_INPUT", "the envelope accepts only operation and input", origin);
  }
  const operation = envelope.operation;
  if (!isCrmOperation(operation)) return failure(404, typeof operation === "string" ? operation : "", "UNKNOWN_OPERATION", "no such CRM operation", origin);
  const input = envelope.input === undefined && operation === "listAccounts" ? {} : envelope.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure(400, operation, "INVALID_INPUT", "input must be a JSON object", origin);
  const stated = CALLER_AUTHORITY_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(input, f));
  if (stated.length > 0) {
    return failure(400, operation, "AUTHORITY_FIELD_NOT_ACCEPTED", `authority is resolved from the verified caller, never supplied: ${stated.join(", ")}`, origin);
  }

  const bearer = bearerToken(header(request, "authorization"));
  if (!bearer) return failure(401, operation, "UNAUTHENTICATED", "a bearer token is required", origin);
  let identity: VerifiedIdentity;
  try {
    identity = await options.verifyToken(bearer);
  } catch {
    return failure(401, operation, "UNAUTHENTICATED", "the token could not be verified", origin);
  }

  const result = await executeCrmOperation(options, {
    caller: { externalSubject: identity.externalSubject, identityProvider: identity.identityProvider, requestedTenantId: singleHeader(header(request, "x-eos-tenant")) },
    operation,
    input: input as Input,
  });
  if (result.ok) return json(200, result, origin);
  return failure(result.status, result.operation, result.code, result.message, origin, result.findings);
}

/** Adapt the pure handler onto node:http, matching the sibling transports' adapters. */
export function createCrmHttpHandler(options: CrmHttpOptions) {
  return async function nodeHandler(
    req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; on: Function },
    res: { writeHead: Function; end: Function },
  ): Promise<void> {
    let response: HttpResponseShape;
    try {
      const body = await readBody(req);
      response = body === null
        ? failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", resolveOrigin(options.allowedOrigins, req.headers.origin))
        : await handleCrmRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
    } catch (err) {
      console.error("[crmHttp] unhandled", err);
      response = failure(500, "", "INTERNAL", "the request could not be completed", null);
    }
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };
}

function readBody(req: { on: Function }): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_CRM_BODY_BYTES) { tooLarge = true; chunks.length = 0; return; }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function parseEnvelope(body: string | undefined): Record<string, unknown> {
  if (!body || body.trim().length === 0) throw new Error("empty");
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  return parsed as Record<string, unknown>;
}
const header = (req: HttpRequestLike, name: string) => req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
const singleHeader = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
};
function bearerToken(value: string | string[] | undefined): string | null {
  const raw = singleHeader(value);
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}
function pathOf(url: string): string {
  const idx = url.indexOf("?");
  const path = idx >= 0 ? url.slice(0, idx) : url;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
function resolveOrigin(allowed: readonly string[] | undefined, value: string | string[] | undefined): string | null {
  const origin = singleHeader(value);
  if (!origin || !allowed || allowed.length === 0) return null;
  return origin !== "*" && allowed.includes(origin) ? origin : null;
}
