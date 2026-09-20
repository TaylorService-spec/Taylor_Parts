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
import { CatalogMasterError, type CatalogActorContext } from "./catalogMasterKernel.js";
import { createPart, updatePart, changePartStatus } from "./postgresPartMasterWriter.js";
import {
  createPartAlias, deactivatePartAlias, reactivatePartAlias,
  listPartAliases, probePartAlias, resolveScannedPartIdentifier,
} from "./postgresPartAliasWriter.js";
import { readPart, readPartsByIds, searchParts, countParts } from "./postgresCatalogReads.js";

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

export type CatalogApiFailureCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT"
  | "PRECONDITION_FAILED" | "CONFLICT" | "UNAVAILABLE" | "UNKNOWN_OPERATION" | "INTERNAL";

export interface CatalogApiDeps {
  readonly reader: PolicyReader;
  readonly pool: Pool;
}

export type CatalogApiResult =
  | { readonly ok: true; readonly operation: CatalogOperation; readonly result: unknown }
  | { readonly ok: false; readonly operation: string; readonly code: CatalogApiFailureCode; readonly message: string };

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
        return ok(await withClient((c) => searchParts(c, actor.tenantId, {
          query: typeof input.query === "string" ? input.query : undefined,
          status: typeof input.status === "string" ? input.status : undefined,
          limit: typeof input.limit === "number" ? input.limit : undefined,
          cursor: typeof input.cursor === "string" ? input.cursor : null,
        })));
      case "countParts":
        return ok(await withClient((c) => countParts(c, actor.tenantId)));
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

export const CATALOG_ROUTE = "/operations/catalog";
