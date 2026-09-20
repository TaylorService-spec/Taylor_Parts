// The HTTP transport for the trusted Operations API — domain-separated from Administration.
//
// ════════════════════ WHY A SEPARATE TRANSPORT, NOT A THIRD adminPolicy OPERATION ════════════════════
//
// `adminPolicyApi.ts`'s closed operation lists (`ADMIN_READ_OPERATIONS` / `ADMIN_MUTATION_OPERATIONS`)
// are the Administration domain's list -- Objects, Fields, Roles, permissions, Workflows. An
// operational command like "resolve my Cycle Count capabilities" is not an Administration act, and
// putting it on that list would blur the one property that makes the closed list meaningful: that
// every entry on it names a governed Administration operation. A SECOND closed list, for a SECOND
// domain, keeps both lists meaning exactly what they say.
//
// ════════════════════ THE SHAPE IS DELIBERATELY IDENTICAL TO adminPolicyHttp.ts ════════════════════
//
// Same rule: this file is a TRANSPORT. It verifies identity, resolves the operational context, hands
// one named operation to `executeOperation`, and writes the result. No SQL, no policy decision that
// belongs to a command, and it must not grow either.
//
// There is deliberately no `POST /sql`, no `mutate(table, id, patch)`, no Firestore proxy, and no
// route that takes a table name.
import { resolveOperationalContext } from "./capabilityAuthority";
import {
  ReorderLifecycleError, createGovernedReorderRequest, reviewReorderRequest,
  startPurchasingOnReorder, postPurchasingUpdate, markReorderReceived, cancelReorderRequest,
  readReorderQueue, readMyAssignedReorders, voidReorderPurchaseOrder, type ReorderActor,
} from "./reorderLifecycleCommands.js";
import { ReorderAssignmentError, assignReorderRequestToEmployee } from "./reorderAssignmentAuthority.js";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import type { Pool } from "pg";

export interface VerifiedIdentity {
  readonly externalSubject: string;
  readonly identityProvider: string;
}
export type TokenVerifier = (bearerToken: string) => Promise<VerifiedIdentity>;

// ════════════════════ the closed operation list ════════════════════
//
// ONE operation in this P0: a bounded, non-mutating capability read. It proves the full path --
// HTTP -> identity verification -> EOS principal/tenant resolution -> Postgres capability
// authorization -- without wiring a mutating Cycle Count command end to end, which the Owner ruling
// explicitly does not require of this PR.
export const OPERATIONS_READ_OPERATIONS = Object.freeze([
  "resolveMyCapabilities",
  // THE REORDER READS. `readMyAssignedReorders` is the seam this cutover closes: the legacy client
  // asked Firestore `where(assignedToUserId == user.uid)`, and this asks the governed Employee
  // assignment instead. Reading the queue is a different question from reading your own work, so
  // they are different capabilities and different operations.
  "readReorderQueue",
  "readMyAssignedReorders",
] as const);
export type OperationsReadOperation = (typeof OPERATIONS_READ_OPERATIONS)[number];

/**
 * THE REORDER LIFECYCLE, as a closed list.
 *
 * Composing a route does not activate anything: each command refuses unless the caller holds the
 * capability the Role catalog already governs, and the three assignee-scoped commands refuse again
 * unless the caller resolves to the assigned Employee.
 */
export const OPERATIONS_MUTATION_OPERATIONS = Object.freeze([
  "createReorderRequest",
  "reviewReorderRequest",
  "assignReorderRequest",
  "startPurchasingOnReorder",
  "postPurchasingUpdate",
  "markReorderReceived",
  "cancelReorderRequest",
  "voidReorderPurchaseOrder",
] as const);
export type OperationsMutationOperation = (typeof OPERATIONS_MUTATION_OPERATIONS)[number];

export type OperationsOperation = OperationsReadOperation | OperationsMutationOperation;

const READS = new Set<string>(OPERATIONS_READ_OPERATIONS);
const MUTATIONS = new Set<string>(OPERATIONS_MUTATION_OPERATIONS);
export const isOperationsOperation = (name: unknown): name is OperationsOperation =>
  typeof name === "string" && (READS.has(name) || MUTATIONS.has(name));

export interface OperationsApiDeps {
  readonly reader: PolicyReader;
  readonly pool: Pool;
}

export type OperationsApiFailureCode =
  | "UNKNOWN_OPERATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PRECONDITION_FAILED"
  | "CONFLICT"
  | "INTERNAL";

export type OperationsApiResult =
  | { readonly ok: true; readonly operation: OperationsOperation; readonly result: unknown }
  | { readonly ok: false; readonly operation: string; readonly code: OperationsApiFailureCode; readonly message: string };

/**
 * Execute one named operational read.
 *
 * `resolveMyCapabilities` never throws for "authenticated but holds nothing" -- it returns an empty
 * list, which is the honest answer for a caller with no qualifying Role. It DOES fail closed for an
 * unknown principal, a disabled principal, no tenant membership, or an ambiguous tenant, by letting
 * `PrincipalContextError` surface as FORBIDDEN.
 */
export async function executeOperation(
  deps: OperationsApiDeps,
  request: {
    readonly caller: { readonly externalSubject: string; readonly identityProvider: string; readonly requestedTenantId: string | null };
    readonly operation: OperationsOperation;
    /** Command input. Reads ignore it; every command validates it and accepts no extra field. */
    readonly input?: Record<string, unknown>;
  },
): Promise<OperationsApiResult> {
  try {
    // ONE resolution for every Reorder operation: the caller's EOS Principal, tenant and the
    // capabilities the Role catalog grants them. `principalContext.uid` IS the EOS principal id --
    // every downstream record identifies the actor by it, and no Firebase uid reaches these commands.
    const reorderActor = async (): Promise<{ actor: ReorderActor; pool: Pool }> => {
      const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
        identityProvider: request.caller.identityProvider,
        externalSubject: request.caller.externalSubject,
        requestedTenantId: request.caller.requestedTenantId,
      });
      return {
        pool: deps.pool,
        actor: {
          tenantId: ctx.principalContext.tenantId,
          principalId: ctx.principalContext.uid,
          capabilities: new Set(ctx.capabilities),
        },
      };
    };
    const ok = (result: unknown): OperationsApiResult =>
      ({ ok: true, operation: request.operation, result });

    switch (request.operation) {
      case "resolveMyCapabilities": {
        const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
          identityProvider: request.caller.identityProvider,
          externalSubject: request.caller.externalSubject,
          requestedTenantId: request.caller.requestedTenantId,
        });
        return {
          ok: true,
          operation: "resolveMyCapabilities",
          result: {
            tenantId: ctx.principalContext.tenantId,
            uid: ctx.principalContext.uid,
            heldRoleKeys: ctx.principalContext.heldRoleKeys,
            capabilities: [...ctx.capabilities].sort(),
          },
        };
      }
      case "readReorderQueue": {
        const { actor, pool } = await reorderActor();
        return ok(await readReorderQueue({ pool }, actor));
      }
      case "readMyAssignedReorders": {
        const { actor, pool } = await reorderActor();
        return ok(await readMyAssignedReorders({ pool }, actor));
      }
      case "createReorderRequest": {
        const { actor, pool } = await reorderActor();
        return ok(await createGovernedReorderRequest({ pool }, actor, request.input ?? {}));
      }
      case "reviewReorderRequest": {
        const { actor, pool } = await reorderActor();
        return ok(await reviewReorderRequest({ pool }, actor, request.input ?? {}));
      }
      case "assignReorderRequest": {
        const { actor, pool } = await reorderActor();
        return ok(await assignReorderRequestToEmployee({ pool }, actor, request.input ?? {}));
      }
      case "startPurchasingOnReorder": {
        const { actor, pool } = await reorderActor();
        return ok(await startPurchasingOnReorder({ pool }, actor, request.input ?? {}));
      }
      case "postPurchasingUpdate": {
        const { actor, pool } = await reorderActor();
        return ok(await postPurchasingUpdate({ pool }, actor, request.input ?? {}));
      }
      case "markReorderReceived": {
        const { actor, pool } = await reorderActor();
        return ok(await markReorderReceived({ pool }, actor, request.input ?? {}));
      }
      case "cancelReorderRequest": {
        const { actor, pool } = await reorderActor();
        return ok(await cancelReorderRequest({ pool }, actor, request.input ?? {}));
      }
      case "voidReorderPurchaseOrder": {
        const { actor, pool } = await reorderActor();
        return ok(await voidReorderPurchaseOrder({ pool }, actor, request.input ?? {}));
      }
      default:
        return { ok: false, operation: request.operation, code: "UNKNOWN_OPERATION", message: "no such Operations operation" };
    }
  } catch (err) {
    if (err instanceof PrincipalContextError) {
      return { ok: false, operation: request.operation, code: "FORBIDDEN", message: err.refusal };
    }
    // A governed refusal is the ANSWER, not a failure: the caller is told which rule refused them,
    // with the command's own category preserved rather than flattened to 500.
    if (err instanceof ReorderLifecycleError || err instanceof ReorderAssignmentError) {
      const code: OperationsApiFailureCode = err.category === "FAILED" ? "INTERNAL" : err.category;
      return { ok: false, operation: request.operation, code, message: err.message };
    }
    // eslint-disable-next-line no-console -- same posture as adminPolicyHttp.ts's unhandled-error log
    console.error("[eosOpsHttp] unhandled", err);
    return { ok: false, operation: request.operation, code: "INTERNAL", message: "the request could not be completed" };
  }
}

// ════════════════════ transport ════════════════════

export interface OperationsHttpOptions extends OperationsApiDeps {
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

const STATUS_BY_CODE: Readonly<Record<OperationsApiFailureCode, number>> = Object.freeze({
  UNKNOWN_OPERATION: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  PRECONDITION_FAILED: 409,
  CONFLICT: 409,
  INTERNAL: 500,
});

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

/**
 * Handle one request.
 *
 *   POST /operations/inventory   one named operation from the closed list above. Authenticated.
 *   OPTIONS *                    CORS preflight.
 *
 * There is no `/health` here -- `/health` is process-wide and already served by adminPolicyHttp's
 * handler in server.ts; this transport answers only its own route.
 */
export async function handleOperationsRequest(
  options: OperationsHttpOptions,
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

  if (path !== "/operations/inventory") return json(404, notFound(path), origin);
  if (method !== "POST") return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);

  let payload: Record<string, unknown>;
  try {
    payload = parseBody(request.body);
  } catch {
    return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
  }

  const operation = payload.operation;
  if (!isOperationsOperation(operation)) return json(404, notFound(String(operation ?? "")), origin);

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

  const result = await executeOperation(options, {
    caller: {
      externalSubject: identity.externalSubject,
      identityProvider: identity.identityProvider,
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

/** Adapt the pure handler onto node:http, matching adminPolicyHttp.ts's own adapter. */
export function createOperationsHttpHandler(options: OperationsHttpOptions) {
  return async function nodeHandler(
    req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; on: Function },
    res: { writeHead: Function; end: Function },
  ): Promise<void> {
    const body = await readBody(req);
    let response: HttpResponseShape;
    try {
      response = await handleOperationsRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
    } catch (err) {
      console.error("[eosOpsHttp] unhandled", err);
      response = json(500, { ok: false, code: "INTERNAL", message: "the request could not be completed" }, null);
    }
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };
}

// ════════════════════ small helpers (mirrors adminPolicyHttp.ts) ════════════════════

const MAX_BODY_BYTES = 1_000_000;
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

function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body || body.trim().length === 0) return {};
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
  return allowed.includes(origin) ? origin : null;
}
const notFound = (what: string) => ({ ok: false as const, operation: what, code: "UNKNOWN_OPERATION" as const, message: "no such Operations operation" });
