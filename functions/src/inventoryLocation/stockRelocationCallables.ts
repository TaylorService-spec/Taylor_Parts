// relocateStock -- the callable over the BIN-P6 relocation authority (stockRelocationCommand.ts).
//
// Authorization and Part resolution are the SAME through-transaction resolvers the Transfer commands use
// (transferCallableWiring.ts). Relocation is a sibling movement authority, and two implementations of
// "may this principal do this, as of this transaction" would eventually disagree.
//
// Every failure keeps its own detail token (spec §5.5). A warehouse operator reading "line 7 failed"
// needs to know whether to fix the count, walk to another bin, or use a Transfer instead -- and a
// technical failure must be distinguishable from a business refusal, because only the first is retried.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { stageAuditEvent } from "../access/auditEventWriter.js";
import { makeResolveTransferPermissionThroughTxn, resolveTransferPartThroughTxn } from "../inventoryTransfer/transferCallableWiring.js";
import { relocateStock, RelocationError } from "./stockRelocationCommand.js";
import type { RelocationAuditInput, RelocationDeps } from "./stockRelocationCommand.js";
import { listEligibleReceivingLocationOptions, ReceivingLocationOptionsError } from "../warehouseGovernance/receivingLocationOptionsService.js";
import { WAREHOUSES_COLLECTION } from "../constants/collections.js";

const REGION = { region: "us-central1" } as const;

function requireAuth(request: { auth?: { uid: string } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.", "UNAUTHENTICATED");
  }
  return request.auth.uid;
}

const resolverByCapability = new Map<string, ReturnType<typeof makeResolveTransferPermissionThroughTxn>>();
async function authorizeThroughTxn(txn: Transaction, db: Firestore, actorId: string, capability: string): Promise<boolean> {
  let resolve = resolverByCapability.get(capability);
  if (!resolve) {
    resolve = makeResolveTransferPermissionThroughTxn(capability);
    resolverByCapability.set(capability, resolve);
  }
  try {
    return await resolve(txn, db, actorId);
  } catch {
    return false; // a THROWING resolver is a denial, never an allow
  }
}

export function stageRelocationAuditEvent(txn: Transaction, a: RelocationAuditInput): void {
  const unit = a.serialCount > 0 ? `${a.serialCount} serial(s)` : `qty ${a.quantity}`;
  const summary = `relocateStock ${unit} of part ${a.partId}: ${a.source.type}:${a.source.locationId} -> ${a.destination.type}:${a.destination.locationId}${a.placementRecorded ? " (put-away)" : ""}`.slice(0, 500);
  stageAuditEvent(txn, {
    actorUid: a.actorId,
    action: "relocateStock",
    targetType: "stockRelocation",
    targetId: a.relocationId,
    outcome: "applied",
    summary,
  });
}

const productionDeps = (actorUid: string): RelocationDeps => ({
  db: getFirestore(),
  actor: { kind: "USER", id: actorUid },
  authorize: authorizeThroughTxn,
  resolvePart: resolveTransferPartThroughTxn,
  stageAudit: stageRelocationAuditEvent,
  now: () => new Date(),
});

const MESSAGE: Record<RelocationError["code"], [ConstructorParameters<typeof HttpsError>[0], string]> = {
  DENIED: ["permission-denied", "You are not authorized to move this stock."],
  INVALID: ["invalid-argument", "That move could not be accepted."],
  NOT_FOUND: ["not-found", "Something in that move could not be found."],
  RETIRED_BIN: ["failed-precondition", "That location is not in use."],
  CROSS_WAREHOUSE: ["failed-precondition", "Those locations are in different warehouses. Use a transfer."],
  INSUFFICIENT_STOCK: ["failed-precondition", "There is not enough stock at the source location."],
  SERIAL_NOT_AT_SOURCE: ["failed-precondition", "That serial is not available at the source location."],
  IDEMPOTENCY_CONFLICT: ["already-exists", "This move was already submitted with different details."],
  INTEGRITY: ["internal", "The stored records for this move are inconsistent."],
};

/** Firestore contention and availability failures are the only ones worth retrying, with the SAME key. */
function isRetryableTechnical(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 10 || code === 14 || code === 4 || code === "aborted" || code === "unavailable" || code === "deadline-exceeded";
}

export const relocateStockCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  try {
    return await relocateStock(request.data, productionDeps(actorUid));
  } catch (err) {
    if (err instanceof RelocationError) {
      const [code, message] = MESSAGE[err.code];
      // The detail carries the class and a bounded reason token -- never a stored value.
      throw new HttpsError(code, message, { code: err.code, reason: err.reason });
    }
    if (isRetryableTechnical(err)) {
      throw new HttpsError("unavailable", "The move could not be completed right now. It is safe to retry.", { code: "RETRYABLE_TECHNICAL_FAILURE" });
    }
    console.error("[relocateStock] unexpected failure", err);
    throw new HttpsError("internal", "The move could not be completed.", { code: "RETRYABLE_TECHNICAL_FAILURE" });
  }
});

/**
 * STOCK MOVEMENT LOCATIONS -- the warehouses a relocation operator may choose between, from the server.
 *
 * Replaces Move stock's client-direct `warehouses` read, which firestore.rules admit only for
 * admin/dispatcher and an assigned warehouse manager. REUSES the governed option builder Receiving uses
 * (listEligibleReceivingLocationOptions): governed + ACTIVE warehouses only, sanitized to {value, label},
 * never a raw document. Only the authorizer differs -- the caller must hold inventory.stock.relocate AND
 * inventory.location.bin.read, the two capabilities Move stock itself needs. Relocation authority is
 * global-scope, so this returns exactly the warehouses the command would accept. Bins stay on the
 * existing bin.read callables (resolveBin / resolveBinToken / listBins).
 */
export const listStockMovementLocationsCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const db = getFirestore();
  try {
    const options = await listEligibleReceivingLocationOptions(request.data ?? {}, {
      actor: { kind: "USER", id: actorUid },
      authorize: async (txn, actorId) =>
        (await authorizeThroughTxn(txn, db, actorId, "inventory.stock.relocate"))
        && (await authorizeThroughTxn(txn, db, actorId, "inventory.location.bin.read")),
      readCandidateWarehouses: async (txn) =>
        (await txn.get(db.collection(WAREHOUSES_COLLECTION))).docs.map((d) => ({ warehouseId: d.id, data: d.data() })),
      runRead: (fn) => db.runTransaction(fn, { readOnly: true }),
    });
    return { warehouses: options.map((o) => ({ warehouseId: o.value, name: o.label })) };
  } catch (err) {
    if (err instanceof ReceivingLocationOptionsError) {
      if (err.code === "PERMISSION_DENIED") throw new HttpsError("permission-denied", "You are not authorized to move stock.", { code: "DENIED" });
      if (err.code === "INVALID_REQUEST") throw new HttpsError("invalid-argument", "That request could not be accepted.", { code: "INVALID" });
    }
    throw new HttpsError("unavailable", "Warehouses could not be read right now.", { code: "RETRYABLE_TECHNICAL_FAILURE" });
  }
});
