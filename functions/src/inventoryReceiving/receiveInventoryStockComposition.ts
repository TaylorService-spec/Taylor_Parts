// Receiving Location Authority -- I-LA5: the production dependency COMPOSITION for the unexported
// receiveInventoryStock command. It PINS the concrete governed-ACTIVE WAREHOUSE resolver
// (makeResolveWarehouseLocationActive) into the command's deps, so no production caller can substitute an
// arbitrary or permissive resolver -- the compositional input type deliberately OMITS resolveLocationActive
// and the test-only hooks. Lower-level dependency injection stays available on the command itself for
// focused tests. INERT: not exported from index.ts; no callable.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { ReceivingActor } from "./receivingTypes.js";
import {
  receiveInventoryStock,
  ReceiveCommandError,
  ReceivingIntegrityError,
  type ReceiveInventoryStockDeps,
  type ReceiveInventoryStockOutcome,
  type ResolvedPart,
  type ReceiveAuditInput,
} from "./receiveInventoryStockCommand.js";
import { makeResolveWarehouseLocationActive } from "./receivingLocationResolver.js";
import { ReceivingError } from "./receivingTypes.js";

// The production seams EXCEPT resolveLocationActive (pinned) and the test-only hooks (never in production).
export interface ReceiveInventoryStockCompositionInput {
  readonly db: Firestore;
  readonly actor: ReceivingActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedPart | null>;
  readonly stageAudit: (txn: Transaction, audit: ReceiveAuditInput) => void;
  readonly now: () => Date;
}

// Build the full command deps with the concrete resolver pinned.
export function buildReceiveInventoryStockDeps(input: ReceiveInventoryStockCompositionInput): ReceiveInventoryStockDeps {
  return {
    db: input.db,
    actor: input.actor,
    authorize: input.authorize,
    resolvePart: input.resolvePart,
    resolveLocationActive: makeResolveWarehouseLocationActive(input.db),
    stageAudit: input.stageAudit,
    now: input.now,
  };
}

// Sanitized production error boundary: a governed ReceiveCommandError (PERMISSION_DENIED,
// DESTINATION_INVALID, RECEIVING_INTEGRITY, ...) passes through unchanged; ANY other surviving error --
// e.g. a raw Firestore/transaction failure from a concurrent conflict -- is mapped to the bounded,
// sanitized ReceivingIntegrityError so no raw Firestore code/message/path/retry detail can escape.
export async function runReceiveInventoryStockSanitized(request: unknown, deps: ReceiveInventoryStockDeps): Promise<ReceiveInventoryStockOutcome> {
  try {
    return await receiveInventoryStock(request, deps);
  } catch (err) {
    // Governed command errors AND governed receiving-domain errors (idempotency conflict, malformed
    // stored record, invalid receiving) pass through so the callable can map each to its exact public
    // code; only a truly unknown/raw Firestore/transaction failure collapses to RECEIVING_INTEGRITY.
    if (err instanceof ReceiveCommandError || err instanceof ReceivingError) throw err;
    throw new ReceivingIntegrityError("receiving failed due to a transient transaction/integrity error");
  }
}

// Production entry: run the command with the pinned governed-warehouse resolver, behind the sanitized
// error boundary. No production caller supplies a resolver, hooks, or sees a raw Firestore error.
export function receiveInventoryStockProduction(request: unknown, input: ReceiveInventoryStockCompositionInput): Promise<ReceiveInventoryStockOutcome> {
  return runReceiveInventoryStockSanitized(request, buildReceiveInventoryStockDeps(input));
}
