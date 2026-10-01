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
import { containsNulCharacter, NUL_CHARACTER_REFUSAL } from "../adminPolicy/requestText";
import { capabilitiesWithoutUnevaluatedConditions, resolveOperationalContext } from "./capabilityAuthority";
import { EOS_CYCLE_COUNT_OPERATIONS, CycleCountOperationError, type EosCycleCountOperation } from "./cycleCountOperations";
import { CYCLE_COUNT_WRITER_AUTHORITY, type PostgresCycleCountWriterState } from "../cycleCount/cycleCountWriterState";
import { EOS_RELOCATION_OPERATIONS, RelocationOperationError, type EosRelocationOperation } from "./stockRelocationOperations";
import { RELOCATION_WRITER_AUTHORITY, type PostgresRelocationWriterState } from "../inventoryLocation/stockRelocationWriterState";
import { EOS_TRANSFER_OPERATIONS, TransferOperationError, type EosTransferOperation } from "./transferOperations";
import { TRANSFER_WRITER_AUTHORITY, type PostgresTransferWriterState } from "../inventoryTransfer/transferWriterState";
import { EOS_PLACEMENT_OPERATIONS, PlacementOperationError, type EosPlacementOperation } from "./binPlacementOperations";
import { PLACEMENT_WRITER_AUTHORITY, type PostgresPlacementWriterState } from "../inventoryLocation/placementWriterState";
import { EOS_ACQUIRE_OPERATIONS, AcquireOperationError, type EosAcquireOperation } from "./serializedAssetAcquireOperations";
import { ACQUIRE_WRITER_AUTHORITY, type PostgresAcquireWriterState } from "../serializedAsset/acquireWriterState";
import { postgresGrantConditionProvider } from "./entitledActionAuthority";
import { resolveExperienceContext } from "./experienceAuthority";
import {
  ReorderLifecycleError, createGovernedReorderRequest, reviewReorderRequest,
  startPurchasingOnReorder, postPurchasingUpdate, markReorderReceived, cancelReorderRequest,
  readReorderQueue, readMyAssignedReorders, readReorderRequest, readMyReorderHistory,
  listReorderWarehouseOptions, readReorderPurchaseOrders,
  recordReorderPurchaseOrder, voidReorderPurchaseOrder, REORDER_POSTGRES_ACTIVE, type ReorderActor,
} from "./reorderLifecycleCommands.js";
import { ReorderAssignmentError, assignReorderRequestToEmployee, listReorderAssignmentTargets } from "./reorderAssignmentAuthority.js";
import { listInventoryLocations, listInventoryWarehouses, listReceipts, listReceivingLocationOptions, listSuppliers, listTransferOrders, readInventoryMovements, readInventoryOnHand, readReceipt } from "./partsReads.js";
import { ReceiveStockError, receiveReorderStock } from "./receiveReorderStockCommand.js";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import { EOS_WORK_ORDER_OPERATIONS, isWorkOrderOperation, type EosWorkOrderOperation } from "./workOrderOperations";
import { EOS_INBOUND_WORK_OPERATIONS, INBOUND_WORK_ROUTE, isInboundWorkOperation } from "./inboundWorkOperations";
import type { WorkOrderOp } from "./workOrderOperationTypes";
import { WORK_ORDER_WRITER_AUTHORITY, type PostgresWorkOrderWriterState } from "./workOrderWriterState";
import { postgresContextualReader } from "./contextualAuthorization";
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
//
// A SECOND, still non-mutating read joins it: `resolveMyExperienceContext`, the canonical principal
// context the client navigates by (experienceAuthority.ts). It is served on its OWN route rather
// than added to /operations/inventory, because that path names the inventory domain and navigation
// is not an inventory act -- the same reason this transport exists separately from /admin/policy.
// One transport, one verifier, two honestly-named routes.
export const OPERATIONS_READ_OPERATIONS = Object.freeze([
  "resolveMyCapabilities",
  "resolveMyExperienceContext",
  // THE REORDER READS. `readMyAssignedReorders` is the seam this cutover closes: the legacy client
  // asked Firestore `where(assignedToUserId == user.uid)`, and this asks the governed Employee
  // assignment instead. Reading the queue is a different question from reading your own work, so
  // they are different capabilities and different operations.
  "readReorderQueue",
  "readMyAssignedReorders",
  "readReorderRequest",
  "readMyReorderHistory",
  "listReorderWarehouseOptions",
  // The Reorder Purchase Order and its void record, by the Reorder Request ids a screen already holds.
  // Same reach as readReorderRequest, applied to every id. It replaces the browser's Firestore reads of
  // reorder_purchase_orders / reorder_purchase_order_voids, which stop being current at activation.
  "readReorderPurchaseOrders",
  // PARTS / PURCHASING / RECEIVING (Controller 2026-10-01): the PostgreSQL reads that replace the journey's Firebase reads
  // -- on-hand derived from the movement ledger, receipts, the governed receiving destinations, the Supplier master and
  // the Reorder assignment targets (eosOps/partsReads.ts, reorderAssignmentAuthority.ts).
  "readInventoryOnHand",
  "readInventoryMovements",
  "listReceipts",
  "readReceipt",
  "listReceivingLocationOptions",
  "listSuppliers",
  "listInventoryWarehouses",
  "listInventoryLocations",
  "listTransferOrders",
  "listReorderAssignmentTargets",
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
  "recordReorderPurchaseOrder",
  "voidReorderPurchaseOrder",
  // RECEIVING, dispatched EXPLICITLY BY SOURCE TYPE (Owner Ruling R1). This operation owns
  // REORDER_PURCHASE_ORDER receipts and refuses every other source type outright. The canonical
  // PURCHASE_ORDER continues to be received by its existing authority until its own cutover, and
  // neither path ever falls back to the other: a receipt lands against the authority the caller
  // named, or it is refused.
  "receiveReorderStock",
] as const);
export type OperationsMutationOperation = (typeof OPERATIONS_MUTATION_OPERATIONS)[number];

export type OperationsOperation = OperationsReadOperation | OperationsMutationOperation;

/**
 * Which route serves which operation. A closed map, not a prefix match: asking for the experience
 * context at the inventory path is a 404, so neither route can quietly grow the other's surface. The Reorder
 * reads, commands and Receiving are served on /operations/inventory (the Reorder domain cutover, #1961).
 */
export const OPERATIONS_ROUTE_BY_OPERATION: Readonly<Record<OperationsOperation, string>> = Object.freeze({
  resolveMyCapabilities: "/operations/inventory",
  resolveMyExperienceContext: "/operations/experience",
  readReorderQueue: "/operations/inventory",
  readMyAssignedReorders: "/operations/inventory",
  readReorderRequest: "/operations/inventory",
  readMyReorderHistory: "/operations/inventory",
  listReorderWarehouseOptions: "/operations/inventory",
  readReorderPurchaseOrders: "/operations/inventory",
  readInventoryOnHand: "/operations/inventory",
  readInventoryMovements: "/operations/inventory",
  listReceipts: "/operations/inventory",
  readReceipt: "/operations/inventory",
  listReceivingLocationOptions: "/operations/inventory",
  listSuppliers: "/operations/inventory",
  listInventoryWarehouses: "/operations/inventory",
  listInventoryLocations: "/operations/inventory",
  listTransferOrders: "/operations/inventory",
  listReorderAssignmentTargets: "/operations/inventory",
  createReorderRequest: "/operations/inventory",
  reviewReorderRequest: "/operations/inventory",
  assignReorderRequest: "/operations/inventory",
  startPurchasingOnReorder: "/operations/inventory",
  postPurchasingUpdate: "/operations/inventory",
  markReorderReceived: "/operations/inventory",
  cancelReorderRequest: "/operations/inventory",
  recordReorderPurchaseOrder: "/operations/inventory",
  voidReorderPurchaseOrder: "/operations/inventory",
  receiveReorderStock: "/operations/inventory",
});

// ════════════════════ the Cycle Count command route (Controller rulings DQ-017 / DQ-018) ════════════════════
//
// The FIRST inventory domain on this transport, and the first operations that WRITE. It is a third,
// honestly-named route with its OWN closed operation table (eosOps/cycleCountOperations.ts) rather than
// entries on the read list: a route names a domain, and the read list stays exactly what it says. The
// shape is unchanged -- verify identity, resolve the operational context from PostgreSQL, hand ONE named
// operation its input, write the result. Warehouse scope is enforced INSIDE each operation, per record.
export const CYCLE_COUNT_ROUTE = "/operations/cycle-count";
export const CYCLE_COUNT_OPERATIONS: readonly EosCycleCountOperation[] =
  Object.freeze(Object.keys(EOS_CYCLE_COUNT_OPERATIONS) as EosCycleCountOperation[]);
export const isCycleCountOperation = (name: unknown): name is EosCycleCountOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_CYCLE_COUNT_OPERATIONS, name);

// ════════════════════ the Stock Relocation command route (Controller ruling DQ-036) ════════════════════
//
// The EXISTING relocation on EOS, on its OWN honestly-named route with its OWN closed table, exactly as
// Cycle Count: a route names a domain. Built and proven; INACTIVE until the inventory baseline COPY
// (inventoryLocation/stockRelocationWriterState.ts).
export const RELOCATION_ROUTE = "/operations/relocation";
export const RELOCATION_OPERATIONS: readonly EosRelocationOperation[] =
  Object.freeze(Object.keys(EOS_RELOCATION_OPERATIONS) as EosRelocationOperation[]);
export const isRelocationOperation = (name: unknown): name is EosRelocationOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_RELOCATION_OPERATIONS, name);

// ════════════════════ the Transfer command route (DQ-024 / DQ-026; HELD) ════════════════════
export const TRANSFER_ROUTE = "/operations/transfer";
export const TRANSFER_OPERATIONS: readonly EosTransferOperation[] =
  Object.freeze(Object.keys(EOS_TRANSFER_OPERATIONS) as EosTransferOperation[]);
export const isTransferOperation = (name: unknown): name is EosTransferOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_TRANSFER_OPERATIONS, name);

// ════════════════════ Bin placement (put-away; DQ-038) and serialized asset acquisition (DQ-036(b)) ════════════════════
export const PLACEMENT_ROUTE = "/operations/placement";
export const PLACEMENT_OPERATIONS: readonly EosPlacementOperation[] =
  Object.freeze(Object.keys(EOS_PLACEMENT_OPERATIONS) as EosPlacementOperation[]);
export const isPlacementOperation = (name: unknown): name is EosPlacementOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_PLACEMENT_OPERATIONS, name);
export const SERIALIZED_ASSET_ROUTE = "/operations/serialized-asset";
export const SERIALIZED_ASSET_OPERATIONS: readonly EosAcquireOperation[] =
  Object.freeze(Object.keys(EOS_ACQUIRE_OPERATIONS) as EosAcquireOperation[]);
export const isSerializedAssetOperation = (name: unknown): name is EosAcquireOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_ACQUIRE_OPERATIONS, name);

// ════════════════════ the Work Order route (WORK ORDER DOMAIN CUTOVER AUTHORIZATION, 2026-09-30) ════════════════════
//
// The governed PostgreSQL Work Order domain on its OWN route with its OWN closed table (workOrderOperations.ts).
// Fail-closed until WORK_ORDER_WRITER_AUTHORITY.postgres is ACTIVE (DQ-S4); only the readiness probe answers before.
export const WORK_ORDER_ROUTE = "/operations/work-orders";

export const OPERATIONS_ROUTES: readonly string[] =
  Object.freeze([...new Set([...Object.values(OPERATIONS_ROUTE_BY_OPERATION), CYCLE_COUNT_ROUTE, RELOCATION_ROUTE, TRANSFER_ROUTE,
    PLACEMENT_ROUTE, SERIALIZED_ASSET_ROUTE, WORK_ORDER_ROUTE, INBOUND_WORK_ROUTE])].sort());

const READS = new Set<string>(OPERATIONS_READ_OPERATIONS);
const MUTATIONS = new Set<string>(OPERATIONS_MUTATION_OPERATIONS);
export const isOperationsOperation = (name: unknown): name is OperationsOperation =>
  typeof name === "string" && (READS.has(name) || MUTATIONS.has(name));

export interface OperationsApiDeps {
  readonly reader: PolicyReader;
  readonly pool: Pool;
  /**
   * TEST INJECTION ONLY: the Cycle Count activation state. The deployed server supplies none, so the
   * governed constant (CYCLE_COUNT_WRITER_AUTHORITY.postgres, INACTIVE) is what production reads.
   */
  readonly cycleCountPostgresState?: PostgresCycleCountWriterState;
  /** The committed REORDER_POSTGRES_ACTIVE unless a test states the state it exercises. */
  readonly reorderPostgresActive?: boolean;
  /**
   * TEST INJECTION ONLY: the Stock Relocation activation state. The deployed server supplies none, so the
   * governed constant (RELOCATION_WRITER_AUTHORITY.postgres, INACTIVE) is what production reads.
   */
  readonly relocationPostgresState?: PostgresRelocationWriterState;
  /** TEST INJECTION ONLY: the Transfer activation state (TRANSFER_WRITER_AUTHORITY.postgres, INACTIVE, otherwise). */
  readonly transferPostgresState?: PostgresTransferWriterState;
  /** TEST INJECTION ONLY: the put-away activation state (PLACEMENT_WRITER_AUTHORITY.postgres, INACTIVE, otherwise). */
  readonly placementPostgresState?: PostgresPlacementWriterState;
  /** TEST INJECTION ONLY: the acquisition activation state (ACQUIRE_WRITER_AUTHORITY.postgres, INACTIVE, otherwise). */
  readonly acquirePostgresState?: PostgresAcquireWriterState;
  /** TEST INJECTION ONLY: the Work Order activation state (WORK_ORDER_WRITER_AUTHORITY.postgres, INACTIVE, otherwise). */
  readonly workOrderPostgresState?: PostgresWorkOrderWriterState;
}

/** Every operation of the PostgreSQL Reorder authority: all but the two principal-context resolvers. */
const REORDER_AUTHORITY_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "readReorderQueue", "readMyAssignedReorders", "readReorderRequest", "readMyReorderHistory", "listReorderWarehouseOptions",
  "readReorderPurchaseOrders",
  "createReorderRequest", "reviewReorderRequest", "assignReorderRequest", "startPurchasingOnReorder", "postPurchasingUpdate",
  "markReorderReceived", "cancelReorderRequest", "recordReorderPurchaseOrder", "voidReorderPurchaseOrder", "receiveReorderStock",
  // The Parts / Purchasing / Receiving reads (2026-10-01) sit behind the same activation boundary.
  "readInventoryOnHand", "readInventoryMovements", "listReceipts", "readReceipt", "listReceivingLocationOptions",
  "listSuppliers", "listReorderAssignmentTargets", "listInventoryWarehouses", "listInventoryLocations", "listTransferOrders",
]);

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
  | { readonly ok: false; readonly operation: string; readonly code: OperationsApiFailureCode; readonly message: string;
      /** Present only when the refusal states facts the caller may act on (e.g. the open Reorder Request to continue). */
      readonly details?: Readonly<Record<string, unknown>> };

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
  // THE ACTIVATION BOUNDARY, before any identity work: until the PostgreSQL Reorder authority is activated, none of its
  // operations answers. The capability and experience resolvers are not Reorder operations and are unaffected.
  if (REORDER_AUTHORITY_OPERATIONS.has(request.operation) && !(deps.reorderPostgresActive ?? REORDER_POSTGRES_ACTIVE)) {
    return { ok: false, operation: request.operation, code: "PRECONDITION_FAILED",
      message: "the PostgreSQL Reorder authority is not active yet; the Reorder cutover has not activated it" };
  }
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
        // Conditions from PostgreSQL -- the source Administration writes. Lazy: this read never asks
        // for entitlements, so composing the provider costs no query.
        const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
          identityProvider: request.caller.identityProvider,
          externalSubject: request.caller.externalSubject,
          requestedTenantId: request.caller.requestedTenantId,
        }, postgresGrantConditionProvider(deps.pool));
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
      case "resolveMyExperienceContext": {
        // Same resolution, same refusals. It returns the caller's OWN context and accepts no
        // selector, so it cannot describe anybody else, and it grants nothing: every surface it
        // names is re-authorized by the read or command behind it.
        const context = await resolveExperienceContext(deps.reader, deps.pool, {
          identityProvider: request.caller.identityProvider,
          externalSubject: request.caller.externalSubject,
          requestedTenantId: request.caller.requestedTenantId,
        });
        return { ok: true, operation: "resolveMyExperienceContext", result: context };
      }
      case "readReorderQueue": {
        const { actor, pool } = await reorderActor();
        return ok(await readReorderQueue({ pool }, actor, request.input ?? {}));
      }
      case "readReorderRequest": {
        const { actor, pool } = await reorderActor();
        return ok(await readReorderRequest({ pool }, actor, request.input ?? {}));
      }
      case "readReorderPurchaseOrders": {
        const { actor, pool } = await reorderActor();
        return ok(await readReorderPurchaseOrders({ pool }, actor, request.input ?? {}));
      }
      case "readMyReorderHistory": {
        const { actor, pool } = await reorderActor();
        return ok(await readMyReorderHistory({ pool }, actor));
      }
      case "listReorderWarehouseOptions": {
        const { actor, pool } = await reorderActor();
        return ok(await listReorderWarehouseOptions({ pool }, actor));
      }
      case "readMyAssignedReorders": {
        const { actor, pool } = await reorderActor();
        return ok(await readMyAssignedReorders({ pool }, actor));
      }
      case "readInventoryOnHand": {
        const { actor, pool } = await reorderActor();
        return ok(await readInventoryOnHand({ pool }, actor, request.input ?? {}));
      }
      case "readInventoryMovements": {
        const { actor, pool } = await reorderActor();
        return ok(await readInventoryMovements({ pool }, actor, request.input ?? {}));
      }
      case "listReceipts": {
        const { actor, pool } = await reorderActor();
        return ok(await listReceipts({ pool }, actor, request.input ?? {}));
      }
      case "readReceipt": {
        const { actor, pool } = await reorderActor();
        return ok(await readReceipt({ pool }, actor, request.input ?? {}));
      }
      case "listReceivingLocationOptions": {
        const { actor, pool } = await reorderActor();
        return ok(await listReceivingLocationOptions({ pool }, actor, request.input ?? {}));
      }
      case "listSuppliers": {
        const { actor, pool } = await reorderActor();
        return ok(await listSuppliers({ pool }, actor, request.input ?? {}));
      }
      case "listInventoryWarehouses": {
        const { actor, pool } = await reorderActor();
        return ok(await listInventoryWarehouses({ pool }, actor, request.input ?? {}));
      }
      case "listInventoryLocations": {
        const { actor, pool } = await reorderActor();
        return ok(await listInventoryLocations({ pool }, actor, request.input ?? {}));
      }
      case "listTransferOrders": {
        const { actor, pool } = await reorderActor();
        return ok(await listTransferOrders({ pool }, actor, request.input ?? {}));
      }
      case "listReorderAssignmentTargets": {
        const { actor, pool } = await reorderActor();
        return ok(await listReorderAssignmentTargets({ pool }, actor, request.input ?? {}));
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
      case "recordReorderPurchaseOrder": {
        const { actor, pool } = await reorderActor();
        return ok(await recordReorderPurchaseOrder({ pool }, actor, request.input ?? {}));
      }
      case "voidReorderPurchaseOrder": {
        const { actor, pool } = await reorderActor();
        return ok(await voidReorderPurchaseOrder({ pool }, actor, request.input ?? {}));
      }
      case "receiveReorderStock": {
        // The SAME resolved Principal context every other operation uses. The receipt's actor is an
        // EOS Principal holding inventory.stock.receive -- never a Firebase uid, and never the
        // Employee the purchasing work happens to be assigned to.
        const { actor, pool } = await reorderActor();
        return ok(await receiveReorderStock({ pool }, actor, request.input ?? {}));
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
    if (err instanceof ReorderLifecycleError || err instanceof ReorderAssignmentError || err instanceof ReceiveStockError) {
      const code: OperationsApiFailureCode = err.category === "FAILED" ? "INTERNAL" : err.category;
      const details = err instanceof ReorderLifecycleError ? err.details : undefined;
      return details === undefined ? { ok: false, operation: request.operation, code, message: err.message }
        : { ok: false, operation: request.operation, code, message: err.message, details };
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

const STATUS_BY_CYCLE_COUNT_CATEGORY: Readonly<Record<CycleCountOperationError["category"], number>> = Object.freeze({
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  PRECONDITION_FAILED: 412,
  CONFLICT: 409,
  FORBIDDEN: 403,
  NOT_ACTIVATED: 503,
  FAILED: 500,
});

/**
 * Execute one Cycle Count operation for an already-verified caller. An unknown / disabled / non-member
 * Principal is FORBIDDEN (PrincipalContextError); a capability reached only through a CONDITIONED grant
 * is withheld (this kernel cannot evaluate conditions -- fail closed), exactly as the Commercial route does.
 */
export async function executeCycleCountOperation(
  deps: OperationsApiDeps,
  request: {
    readonly caller: { readonly externalSubject: string; readonly identityProvider: string; readonly requestedTenantId: string | null };
    readonly operation: EosCycleCountOperation;
    readonly input: Record<string, unknown>;
  },
): Promise<{ readonly status: number; readonly body: unknown }> {
  const { operation } = request;
  try {
    const postgresState = deps.cycleCountPostgresState ?? CYCLE_COUNT_WRITER_AUTHORITY.postgres;
    const conditions = postgresGrantConditionProvider(deps.pool);
    const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
      identityProvider: request.caller.identityProvider,
      externalSubject: request.caller.externalSubject,
      requestedTenantId: request.caller.requestedTenantId,
    }, conditions);
    const capabilities = await capabilitiesWithoutUnevaluatedConditions(deps.pool, ctx.principalContext, ctx.capabilities, conditions);
    const actor = Object.freeze({ tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities });
    const result = await EOS_CYCLE_COUNT_OPERATIONS[operation]({ pool: deps.pool, postgresState }, actor, request.input);
    return { status: 200, body: { ok: true, operation, result } };
  } catch (err) {
    if (err instanceof PrincipalContextError) return { status: 403, body: { ok: false, operation, code: "FORBIDDEN", message: err.refusal } };
    if (err instanceof CycleCountOperationError) {
      return { status: STATUS_BY_CYCLE_COUNT_CATEGORY[err.category] ?? 500, body: { ok: false, operation, code: err.code, message: err.message } };
    }
    // eslint-disable-next-line no-console -- same posture as the read path's unhandled-error log
    console.error("[eosOpsHttp] cycle count unhandled", err);
    return { status: 500, body: { ok: false, operation, code: "INTERNAL", message: "the request could not be completed" } };
  }
}

type CommandRoute = "relocation" | "transfer" | "placement" | "serializedAsset";

/**
 * Execute one Stock Relocation or Transfer operation for an already-verified caller -- the Cycle Count shape
 * exactly: operational context from PostgreSQL, conditioned grants withheld, the domain's own activation constant.
 */
export async function executeInventoryCommandOperation(
  deps: OperationsApiDeps,
  route: CommandRoute,
  request: {
    readonly caller: { readonly externalSubject: string; readonly identityProvider: string; readonly requestedTenantId: string | null };
    readonly operation: string;
    readonly input: Record<string, unknown>;
  },
): Promise<{ readonly status: number; readonly body: unknown }> {
  const { operation } = request;
  try {
    const conditions = postgresGrantConditionProvider(deps.pool);
    const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
      identityProvider: request.caller.identityProvider,
      externalSubject: request.caller.externalSubject,
      requestedTenantId: request.caller.requestedTenantId,
    }, conditions);
    const capabilities = await capabilitiesWithoutUnevaluatedConditions(deps.pool, ctx.principalContext, ctx.capabilities, conditions);
    const actor = Object.freeze({ tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities });
    const result = route === "relocation"
      ? await EOS_RELOCATION_OPERATIONS[operation as EosRelocationOperation](
        { pool: deps.pool, postgresState: deps.relocationPostgresState ?? RELOCATION_WRITER_AUTHORITY.postgres }, actor, request.input)
      : route === "transfer"
        ? await EOS_TRANSFER_OPERATIONS[operation as EosTransferOperation](
          { pool: deps.pool, postgresState: deps.transferPostgresState ?? TRANSFER_WRITER_AUTHORITY.postgres }, actor, request.input)
        : route === "placement"
          ? await EOS_PLACEMENT_OPERATIONS[operation as EosPlacementOperation](
            { pool: deps.pool, postgresState: deps.placementPostgresState ?? PLACEMENT_WRITER_AUTHORITY.postgres }, actor, request.input)
          : await EOS_ACQUIRE_OPERATIONS[operation as EosAcquireOperation](
            { pool: deps.pool, postgresState: deps.acquirePostgresState ?? ACQUIRE_WRITER_AUTHORITY.postgres }, actor, request.input);
    return { status: 200, body: { ok: true, operation, result } };
  } catch (err) {
    if (err instanceof PrincipalContextError) return { status: 403, body: { ok: false, operation, code: "FORBIDDEN", message: err.refusal } };
    if (err instanceof RelocationOperationError || err instanceof TransferOperationError
      || err instanceof PlacementOperationError || err instanceof AcquireOperationError) {
      return { status: STATUS_BY_CYCLE_COUNT_CATEGORY[err.category] ?? 500, body: { ok: false, operation, code: err.code, message: err.message } };
    }
    // eslint-disable-next-line no-console -- same posture as the read path's unhandled-error log
    console.error(`[eosOpsHttp] ${route} unhandled`, err);
    return { status: 500, body: { ok: false, operation, code: "INTERNAL", message: "the request could not be completed" } };
  }
}

const STATUS_BY_WORK_ORDER_CATEGORY: Readonly<Record<string, number>> = Object.freeze({
  INVALID_INPUT: 400, NOT_FOUND: 404, PRECONDITION_FAILED: 412, CONFLICT: 409, FORBIDDEN: 403,
  UNAVAILABLE: 503, NOT_ACTIVATED: 503, FAILED: 500,
});
/** Every governed Work Order refusal class carries { code, category }; each is answered with its own category. */
const WORK_ORDER_ERROR_NAMES: ReadonlySet<string> = new Set([
  "WorkOrderLifecycleError", "WorkOrderAssignmentError", "WorkOrderCreateError", "WorkOrderPartsPlanError", "WorkOrderReadError",
]);

/**
 * Execute one Work Order operation for an already-verified caller. The caller is resolved ONCE, into both the flat
 * capability set (conditioned keys withheld) and the entitled actor the per-record read decision needs.
 */
export async function executeWorkOrderOperation(
  deps: OperationsApiDeps,
  request: {
    readonly caller: { readonly externalSubject: string; readonly identityProvider: string; readonly requestedTenantId: string | null };
    readonly operation: EosWorkOrderOperation | string;
    readonly input: Record<string, unknown>;
  },
  /** The closed table this route serves: the Work Order table, or the Inbound Work table on its own route. */
  table: Readonly<Record<string, WorkOrderOp>> = EOS_WORK_ORDER_OPERATIONS,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const { operation } = request;
  const postgresState = deps.workOrderPostgresState ?? WORK_ORDER_WRITER_AUTHORITY.postgres;
  if (operation === "readWorkOrderAuthorityStatus") {
    return { status: 200, body: { ok: true, operation, result: { postgres: postgresState,
      readiness: postgresState === "ACTIVE" ? "ACTIVE" : "NOT_YET_ACTIVATED" } } };
  }
  if (postgresState !== "ACTIVE") {
    return { status: 503, body: { ok: false, operation, code: "NOT_ACTIVATED",
      message: "the PostgreSQL Work Order authority is not activated yet" } };
  }
  try {
    const conditions = postgresGrantConditionProvider(deps.pool);
    const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
      identityProvider: request.caller.identityProvider,
      externalSubject: request.caller.externalSubject,
      requestedTenantId: request.caller.requestedTenantId,
    }, conditions);
    const capabilities = await capabilitiesWithoutUnevaluatedConditions(deps.pool, ctx.principalContext, ctx.capabilities, conditions);
    const tenantId = ctx.principalContext.tenantId;
    const principalId = ctx.principalContext.uid;
    const caller = Object.freeze({
      actor: Object.freeze({ tenantId, principalId, capabilities }),
      operational: Object.freeze({ tenantId, principalId, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld,
        scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements }),
    });
    const result = await table[operation](
      { pool: deps.pool, reader: postgresContextualReader(deps.pool), postgresState, policyReader: deps.reader }, caller, request.input);
    return { status: 200, body: { ok: true, operation, result } };
  } catch (err) {
    if (err instanceof PrincipalContextError) return { status: 403, body: { ok: false, operation, code: "FORBIDDEN", message: err.refusal } };
    if (err instanceof Error && WORK_ORDER_ERROR_NAMES.has(err.name)) {
      const e = err as Error & { code: string; category: string };
      return { status: STATUS_BY_WORK_ORDER_CATEGORY[e.category] ?? 500, body: { ok: false, operation, code: e.code, message: e.message } };
    }
    // eslint-disable-next-line no-console -- same posture as the read path's unhandled-error log
    console.error("[eosOpsHttp] work order unhandled", err);
    return { status: 500, body: { ok: false, operation, code: "INTERNAL", message: "the request could not be completed" } };
  }
}

const STATUS_BY_CODE: Readonly<Record<OperationsApiFailureCode, number>> = Object.freeze({
  UNKNOWN_OPERATION: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  // 412, as on the Commercial, CRM, Workforce and Catalog transports -- and as the Reorder client maps it. 409 made a
  // governed precondition (e.g. "the PostgreSQL Reorder authority is not active") indistinguishable from CONFLICT, and
  // the client rendered it as one (L5, contract-mismatch auto-fix, 2026-09-28).
  PRECONDITION_FAILED: 412,
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
 *   POST /operations/inventory    resolveMyCapabilities. Authenticated.
 *   POST /operations/experience   resolveMyExperienceContext. Authenticated.
 *   OPTIONS *                     CORS preflight.
 *
 * The operation must match the route it was posted to (OPERATIONS_ROUTE_BY_OPERATION); a mismatch is
 * a 404, not a redirect, so a route never answers for a neighbour.
 *
 * There is no `/health` here -- `/health` is process-wide and already served by adminPolicyHttp's
 * handler in server.ts; this transport answers only its own routes.
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

  if (!OPERATIONS_ROUTES.includes(path)) return json(404, notFound(path), origin);
  if (method !== "POST") return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);

  let payload: Record<string, unknown>;
  try {
    payload = parseBody(request.body);
  } catch {
    return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
  }
  // U+0000 is refused at the envelope, before identity or any query (requestText.ts; Controller XLF-002).
  if (containsNulCharacter(payload)) {
    return json(400, { ok: false, operation: typeof payload.operation === "string" ? payload.operation : "", code: "INVALID_INPUT", message: NUL_CHARACTER_REFUSAL }, origin);
  }

  const operation = payload.operation;

  if (path === CYCLE_COUNT_ROUTE) {
    if (!isCycleCountOperation(operation)) return json(404, notFound(String(operation ?? "")), origin);
    const input = payload.input === undefined ? {} : payload.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json(400, { ok: false, operation, code: "INVALID_INPUT", message: "input must be a JSON object" }, origin);
    }
    const ccBearer = bearerToken(header(request, "authorization"));
    if (!ccBearer) return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
    let ccIdentity: VerifiedIdentity;
    try {
      ccIdentity = await options.verifyToken(ccBearer);
    } catch {
      return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
    }
    const out = await executeCycleCountOperation(options, {
      caller: {
        externalSubject: ccIdentity.externalSubject,
        identityProvider: ccIdentity.identityProvider,
        requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
      },
      operation,
      input: input as Record<string, unknown>,
    });
    return json(out.status, out.body, origin);
  }

  if (path === WORK_ORDER_ROUTE || path === INBOUND_WORK_ROUTE) {
    const inbound = path === INBOUND_WORK_ROUTE;
    if (inbound ? !isInboundWorkOperation(operation) : !isWorkOrderOperation(operation)) {
      return json(404, notFound(String(operation ?? "")), origin);
    }
    const input = payload.input === undefined ? {} : payload.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json(400, { ok: false, operation, code: "INVALID_INPUT", message: "input must be a JSON object" }, origin);
    }
    const woBearer = bearerToken(header(request, "authorization"));
    if (!woBearer) return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
    let woIdentity: VerifiedIdentity;
    try {
      woIdentity = await options.verifyToken(woBearer);
    } catch {
      return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
    }
    const out = await executeWorkOrderOperation(options, {
      caller: {
        externalSubject: woIdentity.externalSubject,
        identityProvider: woIdentity.identityProvider,
        requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
      },
      operation: operation as string,
      input: input as Record<string, unknown>,
    }, inbound ? EOS_INBOUND_WORK_OPERATIONS : EOS_WORK_ORDER_OPERATIONS);
    return json(out.status, out.body, origin);
  }

  if (path === RELOCATION_ROUTE || path === TRANSFER_ROUTE || path === PLACEMENT_ROUTE || path === SERIALIZED_ASSET_ROUTE) {
    const route: CommandRoute = path === RELOCATION_ROUTE ? "relocation" : path === TRANSFER_ROUTE ? "transfer"
      : path === PLACEMENT_ROUTE ? "placement" : "serializedAsset";
    const known = route === "relocation" ? isRelocationOperation(operation) : route === "transfer" ? isTransferOperation(operation)
      : route === "placement" ? isPlacementOperation(operation) : isSerializedAssetOperation(operation);
    if (!known) return json(404, notFound(String(operation ?? "")), origin);
    const input = payload.input === undefined ? {} : payload.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json(400, { ok: false, operation, code: "INVALID_INPUT", message: "input must be a JSON object" }, origin);
    }
    const cmdBearer = bearerToken(header(request, "authorization"));
    if (!cmdBearer) return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
    let cmdIdentity: VerifiedIdentity;
    try {
      cmdIdentity = await options.verifyToken(cmdBearer);
    } catch {
      return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
    }
    const out = await executeInventoryCommandOperation(options, route, {
      caller: {
        externalSubject: cmdIdentity.externalSubject,
        identityProvider: cmdIdentity.identityProvider,
        requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
      },
      operation: operation as string,
      input: input as Record<string, unknown>,
    });
    return json(out.status, out.body, origin);
  }

  if (!isOperationsOperation(operation)) return json(404, notFound(String(operation ?? "")), origin);
  // The operation must belong to the route it arrived on. Without this, /operations/inventory would
  // answer for /operations/experience and the route names would stop describing anything.
  if (OPERATIONS_ROUTE_BY_OPERATION[operation] !== path) return json(404, notFound(operation), origin);

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
