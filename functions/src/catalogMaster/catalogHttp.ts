// THE GOVERNED RENDER CATALOG API.
//
//   Vercel UI  ->  Render EOS API  ->  PostgreSQL Catalog authority
//
// ONE route with an operation discriminator, exactly as `/operations/inventory` already does. A
// route per table would put the shape of the database in the URL space and make every future schema
// change a public API change; the discriminator keeps the contract about BUSINESS OPERATIONS.
//
// ════════════════════ IDENTITY ════════════════════
//
//   external authenticated identity -> EOS Principal -> tenant membership -> effective capability
//
// `resolveOperationalContext` performs all four, and `principalContext.uid` IS the EOS Principal id.
// NO Firebase uid becomes the Catalog actor: the commands take `principalId`, every actor column
// carries it, and a uid never reaches this layer as anything but a token subject to be resolved.
//
// ════════════════════ READS ARE BOUNDED ════════════════════
//
// There is deliberately no "list every Part" operation. The Firestore client reads the whole
// collection from six surfaces; re-exposing that as an HTTP endpoint would move the defect rather
// than remove it. `searchParts` is a bounded, searchable, keyset-paged answer and its limit is
// CLAMPED rather than trusted, so an unbounded read is not reachable through this API at all.

import type { Pool } from "pg";
import { resolveOperationalContext } from "../eosOps/capabilityAuthority";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import type { TokenVerifier, VerifiedIdentity } from "../adminPolicy/adminPolicyHttp";
import { CatalogMasterError, type CatalogActorContext } from "./catalogMasterKernel.js";
import {
  CATALOG_WRITER_AUTHORITY, PostgresCatalogWriterInactiveError, assertPostgresCatalogActive, type CatalogWriterAuthority,
} from "./catalogWriterState.js";
import { createPart, updatePart, changePartStatus } from "./postgresPartMasterWriter.js";
import {
  createPartAlias, deactivatePartAlias, reactivatePartAlias,
  listPartAliases, probePartAlias, resolveScannedPartIdentifier,
} from "./postgresPartAliasWriter.js";
import { readPart, readPartsByIds, searchParts, countParts, type PartSearchFilters } from "./postgresCatalogReads.js";

/** Reads: bounded by construction. Nothing here can return the whole catalogue. */
export const CATALOG_READ_OPERATIONS = Object.freeze([
  "readPart",
  "readPartsByIds",
  "searchParts",
  "countParts",
  "listPartAliases",
  "probePartAlias",
  "lookupScannedPart",
] as const);
export type CatalogReadOperation = (typeof CATALOG_READ_OPERATIONS)[number];

/** Writes: the governed Part and alias commands, each with its own capability check. */
export const CATALOG_MUTATION_OPERATIONS = Object.freeze([
  "createPart",
  "updatePart",
  "changePartStatus",
  "createPartAlias",
  "deactivatePartAlias",
  "reactivatePartAlias",
] as const);
export type CatalogMutationOperation = (typeof CATALOG_MUTATION_OPERATIONS)[number];

export type CatalogOperation = CatalogReadOperation | CatalogMutationOperation;

const READS = new Set<string>(CATALOG_READ_OPERATIONS);
const MUTATIONS = new Set<string>(CATALOG_MUTATION_OPERATIONS);
export const isCatalogOperation = (name: unknown): name is CatalogOperation =>
  typeof name === "string" && (READS.has(name) || MUTATIONS.has(name));

export const CATALOG_ROUTE = "/operations/catalog";

export type CatalogApiFailureCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT"
  | "PRECONDITION_FAILED" | "CONFLICT" | "UNAVAILABLE" | "UNKNOWN_OPERATION" | "INTERNAL";

export interface CatalogApiDeps {
  readonly reader: PolicyReader;
  readonly pool: Pool;
  /** The committed CATALOG_WRITER_AUTHORITY unless a test states the state it exercises. */
  readonly writerAuthority?: CatalogWriterAuthority;
}

export type CatalogApiResult =
  | { readonly ok: true; readonly operation: CatalogOperation; readonly result: unknown }
  | { readonly ok: false; readonly operation: string; readonly code: CatalogApiFailureCode; readonly message: string };

/**
 * The governed search filters a caller may state -- the SAME set for a page and for its count.
 *
 * Only the named keys are carried, so nothing else a body happens to contain reaches the query; their
 * VALUES are validated by postgresCatalogReads, which refuses anything outside the governed enums.
 */
function searchFilters(input: Record<string, unknown>): PartSearchFilters {
  return {
    query: input.query as never,
    status: input.status as never,
    statuses: input.statuses as never,
    stockingClass: input.stockingClass as never,
    stockingClasses: input.stockingClasses as never,
    controlType: input.controlType as never,
    wholeUnit: input.wholeUnit as never,
  };
}

/**
 * Execute one named Catalog operation.
 *
 * The actor is resolved ONCE per request, the same way every other EOS operation resolves one, and
 * the capability check lives in the command rather than here -- a transport that decided
 * authorization would be a second place the answer could differ from the authority's.
 */
export async function executeCatalogOperation(
  deps: CatalogApiDeps,
  request: {
    readonly caller: { readonly externalSubject: string; readonly identityProvider: string; readonly requestedTenantId: string | null };
    readonly operation: CatalogOperation;
    readonly input?: Record<string, unknown>;
  },
): Promise<CatalogApiResult> {
  const input = request.input ?? {};
  try {
    // FIRST ACT: the PostgreSQL Catalog authority must be ACTIVE (the activation window's step 18). Before that, the
    // transport answers nothing -- not a read of a not-yet-copied catalogue, and certainly not a write.
    assertPostgresCatalogActive(`catalog.transport.${request.operation}`, deps.writerAuthority ?? CATALOG_WRITER_AUTHORITY);
    const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
      identityProvider: request.caller.identityProvider,
      externalSubject: request.caller.externalSubject,
      requestedTenantId: request.caller.requestedTenantId,
    });
    // THE EOS PRINCIPAL. Never the Firebase uid the token happened to carry.
    const actor: CatalogActorContext = {
      tenantId: ctx.principalContext.tenantId,
      principalId: ctx.principalContext.uid,
      capabilities: new Set(ctx.capabilities),
    };
    const commandDeps = { pool: deps.pool };
    const ok = (result: unknown): CatalogApiResult => ({ ok: true, operation: request.operation, result });
    const withClient = async <T>(fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> => {
      const c = await deps.pool.connect();
      try { return await fn(c); } finally { c.release(); }
    };
    const str = (v: unknown): string => (typeof v === "string" ? v : "");

    switch (request.operation) {
      // ---- READS ----
      case "readPart":
        return ok(await withClient((c) => readPart(c, actor.tenantId, str(input.partId))));
      case "readPartsByIds":
        return ok(await withClient((c) => readPartsByIds(c, actor.tenantId, Array.isArray(input.partIds) ? input.partIds as string[] : [])));
      case "searchParts":
        // PASSED THROUGH, NOT FILTERED BY TYPE HERE. The read validates every value against the
        // governed vocabulary and REFUSES what it does not recognise; dropping a malformed filter at
        // the transport would answer a narrower question with a broader list and say nothing.
        return ok(await withClient((c) => searchParts(c, actor.tenantId, {
          ...searchFilters(input),
          limit: typeof input.limit === "number" ? input.limit : undefined,
          cursor: input.cursor as never,
          sort: input.sort as never,
        })));
      case "countParts":
        return ok(await withClient((c) => countParts(c, actor.tenantId, searchFilters(input))));
      case "listPartAliases":
        return ok(await withClient((c) => listPartAliases(c, actor.tenantId, str(input.partId))));
      case "probePartAlias":
        return ok(await withClient((c) => probePartAlias(c, actor.tenantId, {
          aliasType: input.aliasType as never,
          rawValue: str(input.rawValue),
          ...(typeof input.manufacturerId === "string" ? { manufacturerId: input.manufacturerId } : {}),
        })));
      case "lookupScannedPart":
        return ok(await withClient((c) => resolveScannedPartIdentifier(c, actor.tenantId, {
          rawValue: str(input.rawValue),
          ...(typeof input.manufacturerId === "string" ? { manufacturerId: input.manufacturerId } : {}),
        })));

      // ---- WRITES ----
      case "createPart":
        return ok(await createPart(commandDeps, actor, { part: input.part }));
      case "updatePart":
        return ok(await updatePart(commandDeps, actor, {
          partId: input.partId, expectedVersion: input.expectedVersion, changes: input.changes,
        }));
      case "changePartStatus":
        return ok(await changePartStatus(commandDeps, actor, {
          partId: input.partId, expectedVersion: input.expectedVersion, newStatus: input.newStatus ?? input.status,
        }));
      case "createPartAlias":
        return ok(await createPartAlias(commandDeps, actor, {
          partId: input.partId, aliasType: input.aliasType, rawValue: input.rawValue,
          source: input.source, manufacturerId: input.manufacturerId,
          effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
        }));
      case "deactivatePartAlias":
        return ok(await deactivatePartAlias(commandDeps, actor, { aliasId: input.aliasId, expectedVersion: input.expectedVersion }));
      case "reactivatePartAlias":
        return ok(await reactivatePartAlias(commandDeps, actor, { aliasId: input.aliasId, expectedVersion: input.expectedVersion }));

      default:
        return { ok: false, operation: request.operation, code: "UNKNOWN_OPERATION", message: "no such Catalog operation" };
    }
  } catch (err) {
    if (err instanceof PostgresCatalogWriterInactiveError) {
      return { ok: false, operation: request.operation, code: "PRECONDITION_FAILED", message: err.message };
    }
    if (err instanceof PrincipalContextError) {
      return { ok: false, operation: request.operation, code: "FORBIDDEN", message: err.refusal };
    }
    // A governed refusal is the ANSWER, not a failure: the caller is told which rule refused them,
    // with the command's own category preserved rather than flattened to 500.
    if (err instanceof CatalogMasterError) {
      const code: CatalogApiFailureCode = err.category === "FAILED" ? "INTERNAL" : err.category;
      return { ok: false, operation: request.operation, code, message: err.message };
    }
    return { ok: false, operation: request.operation, code: "INTERNAL", message: "the operation could not be completed" };
  }
}


// ═══════════════════════════════════ THE TRANSPORT ═══════════════════════════════════
//
// Adapted onto node:http exactly as the Operations, Commercial, Workforce and CRM transports are:
// same verifier, same pool, same origin handling, same body limit. It is a SIXTH domain-separated
// handler rather than an operation added to an existing list -- merging Catalog into the Operations
// route would make one closed list answer for two domains, and the first time either grew the other
// would have to be reviewed for it.

export interface CatalogHttpOptions extends CatalogApiDeps {
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

const STATUS_BY_CODE: Readonly<Record<CatalogApiFailureCode, number>> = Object.freeze({
  UNKNOWN_OPERATION: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  PRECONDITION_FAILED: 412,
  CONFLICT: 409,
  UNAVAILABLE: 503,
  INTERNAL: 500,
});

const MAX_BODY_BYTES = 1_000_000;

function baseHeaders(origin: string | null): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  };
}
const json = (status: number, body: unknown, origin: string | null): HttpResponseShape => ({
  status, headers: baseHeaders(origin), body: JSON.stringify(body),
});

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
  return allowed.includes(origin) ? origin : null;
}
function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body || body.trim().length === 0) return {};
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  return parsed as Record<string, unknown>;
}
function readBody(req: { on: Function }): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) { reject(new Error("request body too large")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Handle one request.
 *
 *   POST /operations/catalog   one named operation from the closed lists above. Authenticated.
 *   OPTIONS *                  CORS preflight.
 *
 * `/health` is process-wide and served by the Administration handler; this transport answers only
 * its own route.
 */
export async function handleCatalogRequest(
  options: CatalogHttpOptions,
  request: HttpRequestLike,
): Promise<HttpResponseShape> {
  const method = (request.method ?? "GET").toUpperCase();
  const path = pathOf(request.url ?? "/");
  const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));

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

  if (path !== CATALOG_ROUTE) {
    return json(404, { ok: false, operation: path, code: "UNKNOWN_OPERATION", message: "no such Catalog route" }, origin);
  }
  if (method !== "POST") return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);

  let payload: Record<string, unknown>;
  try {
    payload = parseBody(request.body);
  } catch {
    return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
  }

  const operation = payload.operation;
  if (!isCatalogOperation(operation)) {
    return json(404, { ok: false, operation: String(operation ?? ""), code: "UNKNOWN_OPERATION", message: "no such Catalog operation" }, origin);
  }

  // AUTHENTICATION BEFORE ANYTHING ELSE. A caller with no token learns which operations exist and
  // nothing more, and no database connection is taken on their behalf.
  const bearer = bearerToken(header(request, "authorization"));
  if (!bearer) {
    return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
  }
  let identity: VerifiedIdentity;
  try {
    identity = await options.verifyToken(bearer);
  } catch {
    return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
  }

  const result = await executeCatalogOperation(options, {
    caller: {
      externalSubject: identity.externalSubject,
      identityProvider: identity.identityProvider,
      // STATED, never adopted: the server checks it against membership.
      requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
    },
    operation,
    input: payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
      ? payload.input as Record<string, unknown>
      : {},
  });

  if (result.ok) return json(200, result, origin);
  return json(STATUS_BY_CODE[result.code] ?? 500, result, origin);
}

/** Adapt the pure handler onto node:http, matching every other EOS transport's adapter. */
export function createCatalogHttpHandler(options: CatalogHttpOptions) {
  return async function nodeHandler(
    req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; on: Function },
    res: { writeHead: Function; end: Function },
  ): Promise<void> {
    const body = await readBody(req);
    let response: HttpResponseShape;
    try {
      response = await handleCatalogRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
    } catch (err) {
      console.error("[catalogHttp] unhandled", err);
      response = json(500, { ok: false, code: "INTERNAL", message: "the request could not be completed" }, null);
    }
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };
}
