// The HTTP transport for the governed PostgreSQL Commercial surface — wave C4. Domain-separated from Administration
// and Operations.
//
// ════════════════════ A TRANSPORT, AND ONLY A TRANSPORT ════════════════════
//
//   bearer token -> injected TokenVerifier (external subject + provider, nothing else)
//               -> resolveOperationalContext (EOS Principal, ACTIVE tenant membership, qualifying Roles,
//                  eos_policy.role_capabilities) -- the SAME resolver the Operations transport uses
//               -> the resolved Commercial actor { tenantId, principalId = EOS Principal id, capabilities }
//               -> ONE operation from the closed list below -> the exact C2 command or C3 read
//               -> a safe HTTP response
//
// No SQL, no capability policy and no Commercial business rule lives here: each C2 command and C3 read requires its
// own precise capability, and this file only hands them the resolved set. There is no generic route, no table name,
// no arbitrary command, and no D2 execution operation.
//
// Firebase is TRANSITIONAL IDENTITY ONLY and never imported here: the verifier is injected, and server.ts is the only
// concrete composition. The requested tenant arrives ONLY as the x-eos-tenant header, which resolveOperationalContext
// checks against membership and never adopts; a tenant, principal, capability or identity field in the JSON body is
// refused.
//
// The deployed composition supplies no catalog authority, so any command that validates a PART or EQUIPMENT_MODEL
// reference refuses CATALOG_AUTHORITY_UNAVAILABLE until a governed PostgreSQL catalog exists.
import type { Pool } from "pg";
import { resolveOperationalContext } from "../eosOps/capabilityAuthority";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import {
  CommercialCommandError, type CommercialActorContext, type CommercialCatalogAuthority, type CommercialErrorCategory,
} from "./commands/commercialCommandKernel";
import { closeOpportunityAsWon, createOpportunity, transitionOpportunity, updateOpportunity } from "./commands/opportunityCommandService";
import { acceptSalesAgreement, createSalesAgreement, updateSalesAgreementDraft } from "./commands/salesAgreementCommandService";
import { createSalesOrder, createSalesOrderFromOpportunity, transitionSalesOrder } from "./commands/salesOrderCommandService";
import { getAccountCommercialProjection } from "./reads/accountCommercialProjection";
import { getOpportunityDetail, listOpportunities } from "./reads/opportunityReadProjection";
import { getSalesAgreementDetail, listSalesAgreements } from "./reads/salesAgreementReadProjection";
import { getSalesOrderDetail, listSalesOrders } from "./reads/salesOrderReadProjection";

export interface VerifiedIdentity {
  readonly externalSubject: string;
  readonly identityProvider: string;
}
export type TokenVerifier = (bearerToken: string) => Promise<VerifiedIdentity>;

export const COMMERCIAL_ROUTE = "/commercial/sales";

export interface CommercialApiDeps {
  readonly reader: PolicyReader;
  readonly pool: Pool;
  /** TEST INJECTION ONLY. The deployed server supplies none. */
  readonly catalog?: CommercialCatalogAuthority;
  /** TEST INJECTION ONLY: the C2 command clock. */
  readonly now?: () => Date;
}

type Input = Record<string, unknown>;
type Runner = (deps: CommercialApiDeps, actor: CommercialActorContext, input: Input) => Promise<unknown>;
const command = (fn: (d: { pool: Pool; catalog?: CommercialCatalogAuthority; now?: () => Date }, a: CommercialActorContext, i: Input) => Promise<unknown>): Runner =>
  (deps, actor, input) => fn({ pool: deps.pool, catalog: deps.catalog, now: deps.now }, actor, input);
const read = (fn: (d: { pool: Pool }, a: CommercialActorContext, i: Input) => Promise<unknown>): Runner =>
  (deps, actor, input) => fn({ pool: deps.pool }, actor, input);

// ════════════════════ the closed operation lists ════════════════════

const READ_RUNNERS = Object.freeze({
  getOpportunityDetail: read(getOpportunityDetail),
  listOpportunities: read(listOpportunities),
  getSalesAgreementDetail: read(getSalesAgreementDetail),
  listSalesAgreements: read(listSalesAgreements),
  getSalesOrderDetail: read(getSalesOrderDetail),
  listSalesOrders: read(listSalesOrders),
  getAccountCommercialProjection: read(getAccountCommercialProjection),
} as const);

const MUTATION_RUNNERS = Object.freeze({
  createOpportunity: command(createOpportunity),
  updateOpportunity: command(updateOpportunity),
  transitionOpportunity: command(transitionOpportunity),
  closeOpportunityAsWon: command(closeOpportunityAsWon),
  createSalesAgreement: command(createSalesAgreement),
  updateSalesAgreementDraft: command(updateSalesAgreementDraft),
  acceptSalesAgreement: command(acceptSalesAgreement),
  createSalesOrder: command(createSalesOrder),
  createSalesOrderFromOpportunity: command(createSalesOrderFromOpportunity),
  transitionSalesOrder: command(transitionSalesOrder),
} as const);

export type CommercialReadOperation = keyof typeof READ_RUNNERS;
export type CommercialMutationOperation = keyof typeof MUTATION_RUNNERS;
export type CommercialOperation = CommercialReadOperation | CommercialMutationOperation;

export const COMMERCIAL_READ_OPERATIONS = Object.freeze(Object.keys(READ_RUNNERS) as CommercialReadOperation[]);
export const COMMERCIAL_MUTATION_OPERATIONS = Object.freeze(Object.keys(MUTATION_RUNNERS) as CommercialMutationOperation[]);

const RUNNERS: Readonly<Record<CommercialOperation, Runner>> = Object.freeze({ ...READ_RUNNERS, ...MUTATION_RUNNERS });
export const isCommercialOperation = (name: unknown): name is CommercialOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(RUNNERS, name);

/** Fields that would state authority. Authority comes from the verified subject and PostgreSQL, never from the body. */
export const AUTHORITY_BEARING_FIELDS = Object.freeze([
  "tenantId", "principalId", "capabilities", "externalSubject", "identityProvider", "uid", "heldRoleKeys", "roles",
  "securityRole", "jobRole",
]);

// ════════════════════ execution ════════════════════

export type CommercialApiResult =
  | { readonly ok: true; readonly operation: CommercialOperation; readonly result: unknown }
  | { readonly ok: false; readonly operation: string; readonly code: string; readonly message: string; readonly status: number };

export const STATUS_BY_CATEGORY: Readonly<Record<CommercialErrorCategory, number>> = Object.freeze({
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  PRECONDITION_FAILED: 412,
  CONFLICT: 409,
  FORBIDDEN: 403,
  UNAVAILABLE: 503,
  FAILED: 500,
});

/**
 * Execute one named Commercial operation for an already-verified caller.
 *
 * An unknown, disabled or non-member Principal refuses FORBIDDEN through resolveOperationalContext's own errors; it is
 * never downgraded to an empty authority context. A Principal that resolves with no Commercial capability reaches the
 * operation, which refuses CAPABILITY_REQUIRED itself.
 */
export async function executeCommercialOperation(
  deps: CommercialApiDeps,
  request: {
    readonly caller: { readonly externalSubject: string; readonly identityProvider: string; readonly requestedTenantId: string | null };
    readonly operation: CommercialOperation;
    readonly input: Input;
  },
): Promise<CommercialApiResult> {
  const { operation } = request;
  try {
    const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
      identityProvider: request.caller.identityProvider,
      externalSubject: request.caller.externalSubject,
      requestedTenantId: request.caller.requestedTenantId,
    });
    const actor: CommercialActorContext = Object.freeze({
      tenantId: ctx.principalContext.tenantId,
      principalId: ctx.principalContext.uid,
      capabilities: ctx.capabilities,
    });
    return { ok: true, operation, result: await RUNNERS[operation](deps, actor, request.input) };
  } catch (err) {
    if (err instanceof PrincipalContextError) {
      return { ok: false, operation, code: "FORBIDDEN", message: err.refusal, status: 403 };
    }
    if (err instanceof CommercialCommandError) {
      return { ok: false, operation, code: err.code, message: err.message, status: STATUS_BY_CATEGORY[err.category] ?? 500 };
    }
    // eslint-disable-next-line no-console -- same posture as the sibling transports' unhandled-error log
    console.error("[commercialHttp] unhandled", err);
    return { ok: false, operation, code: "INTERNAL", message: "the request could not be completed", status: 500 };
  }
}

// ════════════════════ transport ════════════════════

export interface CommercialHttpOptions extends CommercialApiDeps {
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

export const MAX_COMMERCIAL_BODY_BYTES = 1_000_000;

function baseHeaders(origin: string | null): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  };
}
const json = (status: number, body: unknown, origin: string | null): HttpResponseShape => ({ status, headers: baseHeaders(origin), body: JSON.stringify(body) });
const failure = (status: number, operation: string, code: string, message: string, origin: string | null) =>
  json(status, { ok: false, operation, code, message }, origin);

/**
 *   POST    /commercial/sales   { "operation": <closed name>, "input": { ... } }. Authenticated.
 *   OPTIONS /commercial/sales   CORS preflight.
 */
export async function handleCommercialRequest(options: CommercialHttpOptions, request: HttpRequestLike): Promise<HttpResponseShape> {
  const method = (request.method ?? "GET").toUpperCase();
  const path = pathOf(request.url ?? "/");
  const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));

  if (path !== COMMERCIAL_ROUTE) return failure(404, "", "UNKNOWN_OPERATION", "no such Commercial route", origin);
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

  if (typeof request.body === "string" && Buffer.byteLength(request.body, "utf8") > MAX_COMMERCIAL_BODY_BYTES) {
    return failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", origin);
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = parseEnvelope(request.body);
  } catch {
    return failure(400, "", "INVALID_INPUT", "body must be a JSON object", origin);
  }
  const extra = Object.keys(envelope).filter((k) => k !== "operation" && k !== "input");
  if (extra.length > 0) return failure(400, String(envelope.operation ?? ""), "INVALID_INPUT", "the envelope accepts only operation and input", origin);

  const operation = envelope.operation;
  if (!isCommercialOperation(operation)) return failure(404, typeof operation === "string" ? operation : "", "UNKNOWN_OPERATION", "no such Commercial operation", origin);

  const input = envelope.input === undefined ? {} : envelope.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure(400, operation, "INVALID_INPUT", "input must be a JSON object", origin);
  const stated = AUTHORITY_BEARING_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(input, f));
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

  const result = await executeCommercialOperation(options, {
    caller: {
      externalSubject: identity.externalSubject,
      identityProvider: identity.identityProvider,
      requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
    },
    operation,
    input: input as Input,
  });
  if (result.ok) return json(200, result, origin);
  return failure(result.status, result.operation, result.code, result.message, origin);
}

/** Adapt the pure handler onto node:http, matching the sibling transports' adapters. */
export function createCommercialHttpHandler(options: CommercialHttpOptions) {
  return async function nodeHandler(
    req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; on: Function },
    res: { writeHead: Function; end: Function },
  ): Promise<void> {
    let response: HttpResponseShape;
    try {
      const body = await readBody(req);
      response = body === null
        ? failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", resolveOrigin(options.allowedOrigins, req.headers.origin))
        : await handleCommercialRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
    } catch (err) {
      console.error("[commercialHttp] unhandled", err);
      response = failure(500, "", "INTERNAL", "the request could not be completed", null);
    }
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };
}

// ════════════════════ small helpers (mirrors eosOpsHttp.ts) ════════════════════

/** Resolves null once the body exceeds the limit; the rest of the stream is drained, not buffered. */
function readBody(req: { on: Function }): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_COMMERCIAL_BODY_BYTES) { tooLarge = true; chunks.length = 0; return; }
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
  // A wildcard is never an origin grant, even if configuration somehow carried one.
  return origin !== "*" && allowed.includes(origin) ? origin : null;
}
