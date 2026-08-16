// Enterprise Inventory Phase 4 -- the production dependency COMPOSITION for the transfer command
// family. Pins the concrete governed WAREHOUSE/MOBILE resolver (makeResolveTransferLocationActive) so
// no production caller can substitute an arbitrary or permissive resolver -- mirrors
// receiveInventoryStockComposition.ts exactly.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  createTransferOrder,
  dispatchTransferOrder,
  receiveTransferOrder,
  cancelTransferOrder,
  type TransferCommandDeps,
  type ResolvedTransferPart,
  type TransferAuditInput,
  type TransferActionOutcome,
} from "./transferOrderCommand.js";
import { makeResolveTransferLocationActive } from "./transferLocationResolver.js";
import { TransferCommandError, TransferIntegrityError, type TransferActor, type TransferCreateOutcome } from "./transferOrderTypes.js";

export interface TransferCommandCompositionInput {
  readonly db: Firestore;
  readonly actor: TransferActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedTransferPart | null>;
  readonly stageAudit: (txn: Transaction, audit: TransferAuditInput) => void;
  readonly now: () => Date;
}

function buildDeps(input: TransferCommandCompositionInput): TransferCommandDeps {
  return {
    db: input.db,
    actor: input.actor,
    authorize: input.authorize,
    resolvePart: input.resolvePart,
    resolveLocationActive: makeResolveTransferLocationActive(input.db),
    stageAudit: input.stageAudit,
    now: input.now,
  };
}

// Sanitized production error boundary: a governed TransferCommandError passes through unchanged; any
// other surviving error collapses to the bounded, sanitized TransferIntegrityError.
async function runSanitized<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TransferCommandError) throw err;
    throw new TransferIntegrityError("the transfer could not be completed due to a transient transaction/integrity error");
  }
}

export function createTransferOrderProduction(request: unknown, input: TransferCommandCompositionInput): Promise<TransferCreateOutcome> {
  return runSanitized(() => createTransferOrder(request, buildDeps(input)));
}
export function dispatchTransferOrderProduction(request: unknown, input: TransferCommandCompositionInput): Promise<TransferActionOutcome> {
  return runSanitized(() => dispatchTransferOrder(request, buildDeps(input)));
}
export function receiveTransferOrderProduction(request: unknown, input: TransferCommandCompositionInput): Promise<TransferActionOutcome> {
  return runSanitized(() => receiveTransferOrder(request, buildDeps(input)));
}
export function cancelTransferOrderProduction(request: unknown, input: TransferCommandCompositionInput): Promise<TransferActionOutcome> {
  return runSanitized(() => cancelTransferOrder(request, buildDeps(input)));
}
