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
  type ReceiveInventoryStockDeps,
  type ReceiveInventoryStockOutcome,
  type ResolvedPart,
  type ReceiveAuditInput,
} from "./receiveInventoryStockCommand.js";
import { makeResolveWarehouseLocationActive } from "./receivingLocationResolver.js";

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

// Production entry: run the receiveInventoryStock command with the pinned governed-warehouse resolver.
export function receiveInventoryStockProduction(request: unknown, input: ReceiveInventoryStockCompositionInput): Promise<ReceiveInventoryStockOutcome> {
  return receiveInventoryStock(request, buildReceiveInventoryStockDeps(input));
}
