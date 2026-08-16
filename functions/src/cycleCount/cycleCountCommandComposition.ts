// Enterprise Inventory -- Cycle Count operating authority: the production dependency COMPOSITION.
// Pins the concrete governed WAREHOUSE/MOBILE resolver (REUSED from Transfer Phase 4's
// makeResolveTransferLocationActive -- same governed WAREHOUSE/MOBILE authority, not a second one) so no
// production caller can substitute an arbitrary or permissive resolver. Mirrors
// transferCommandComposition.ts exactly.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  createCycleCount,
  submitCycleCount,
  reconcileCycleCount,
  cancelCycleCount,
  type CycleCountCommandDeps,
  type ResolvedCycleCountPart,
  type CycleCountAuditInput,
} from "./cycleCountCommand.js";
import { makeResolveTransferLocationActive } from "../inventoryTransfer/transferLocationResolver.js";
import {
  CycleCountCommandError,
  CycleCountIntegrityError,
  type CycleCountActor,
  type CycleCountCreateOutcome,
  type CycleCountActionOutcome,
} from "./cycleCountTypes.js";

export interface CycleCountCommandCompositionInput {
  readonly db: Firestore;
  readonly actor: CycleCountActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedCycleCountPart | null>;
  readonly stageAudit: (txn: Transaction, audit: CycleCountAuditInput) => void;
  readonly now: () => Date;
}

function buildDeps(input: CycleCountCommandCompositionInput): CycleCountCommandDeps {
  return {
    db: input.db,
    actor: input.actor,
    authorize: input.authorize,
    resolvePart: input.resolvePart,
    // makeResolveTransferLocationActive resolves WAREHOUSE/MOBILE refs; its parameter type is
    // structurally identical to CycleCountLocationRef ({ type: "WAREHOUSE" | "MOBILE", locationId }).
    resolveLocationActive: makeResolveTransferLocationActive(input.db) as CycleCountCommandDeps["resolveLocationActive"],
    stageAudit: input.stageAudit,
    now: input.now,
  };
}

// Sanitized production error boundary: a governed CycleCountCommandError passes through unchanged; any
// other surviving error collapses to the bounded, sanitized CycleCountIntegrityError.
async function runSanitized<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CycleCountCommandError) throw err;
    throw new CycleCountIntegrityError("the cycle count could not be completed due to a transient transaction/integrity error");
  }
}

export function createCycleCountProduction(request: unknown, input: CycleCountCommandCompositionInput): Promise<CycleCountCreateOutcome> {
  return runSanitized(() => createCycleCount(request, buildDeps(input)));
}
export function submitCycleCountProduction(request: unknown, input: CycleCountCommandCompositionInput): Promise<CycleCountActionOutcome> {
  return runSanitized(() => submitCycleCount(request, buildDeps(input)));
}
export function reconcileCycleCountProduction(request: unknown, input: CycleCountCommandCompositionInput): Promise<CycleCountActionOutcome> {
  return runSanitized(() => reconcileCycleCount(request, buildDeps(input)));
}
export function cancelCycleCountProduction(request: unknown, input: CycleCountCommandCompositionInput): Promise<CycleCountActionOutcome> {
  return runSanitized(() => cancelCycleCount(request, buildDeps(input)));
}
