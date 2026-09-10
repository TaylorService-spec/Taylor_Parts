// FROZEN -- CERTIFICATION HISTORY ONLY (Decision #179). This is the v1 single-part Cycle Count family.
// No deployed function reaches it: index.ts exports only the A1 sheet/line callables
// (cycleCountSheetCallables.ts). It remains solely because the frozen Certification tooling
// (functions/scripts/certificationWorld/*) and its tests drive it. Do not extend it and do not wire it
// to a callable, and do not read a v1 record from the sheet/line authority.
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
import { makeResolveCycleCountLocationEligible } from "./cycleCountLocationEligibility.js";
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
    // The governed eligibility policy: the shared WAREHOUSE/MOBILE/BIN resolver, plus -- for a BIN --
    // the parent Warehouse's Bin conversion gate (BIN-P7). Pinned here so no caller can substitute a
    // permissive resolver.
    resolveLocationActive: makeResolveCycleCountLocationEligible(input.db),
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
