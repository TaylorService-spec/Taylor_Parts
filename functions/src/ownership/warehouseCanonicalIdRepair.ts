// Bounded repair of two sandbox warehouse roots that were seeded WITHOUT their canonical stored
// `id` (Owner ruling R-27, DECISIONS #151).
//
// PURE. No Firestore, no clock, no I/O, no throwing for data reasons.
//
// ============================ WHY NOT THE MIGRATION ============================
//
// warehouseGovernanceMigrationCli would have repaired these, and it was refused. It RECONSTRUCTS the
// document, so alongside the missing `id` it would have written:
//
//     provenance              NATIVE -> MIGRATED
//     governanceInitialized*  absent -> populated
//     updatedBy               seed-script -> operator
//
// Those describe a migration event that did not happen. These records were natively created by a
// seed script that forgot one field; saying otherwise would make the provenance field lie about
// their history, and authorship lie about who wrote them.
//
// So the repair is exactly one field per record. It is restoring a canonical identity invariant, not
// recording a business event — which is also why it emits no OWNERSHIP_HANDOFF. Nothing changes
// hands here; a record simply starts stating the id it always had.
//
// ============================ NOT A GENERIC WAREHOUSE PATCHER ============================
//
// Two record ids, one field name, one expected defect. Every one of those is a constant below rather
// than a parameter, because the difference between a bounded repair and a generic mutation utility
// is exactly whether the caller gets to choose.
import { validateGovernedWarehouse, GOVERNED_WAREHOUSE_REASONS } from "../warehouseGovernance/governedWarehouseValidation.js";

/** The ONE field this repair may ever write. */
export const REPAIRED_FIELD = "id" as const;

/** The ONLY records in scope. Not a parameter — see the header. */
export const REPAIRABLE_WAREHOUSE_IDS: readonly string[] = Object.freeze([
  "wh-sandbox-central",
  "wh-sandbox-north",
]);
export const EXPECTED_REPAIR_COUNT = REPAIRABLE_WAREHOUSE_IDS.length;

export const REPAIR_OUTCOME = {
  /** The expected defect, exactly: stored id absent and everything else already governed. */
  REPAIR: "REPAIR",
  /** Already carries the right id. Idempotent success — no write. */
  ALREADY_CORRECT: "ALREADY_CORRECT",
  /** Carries a DIFFERENT id. Never overwritten: that is a data-integrity fault, not this defect. */
  REFUSED_ID_MISMATCH: "REFUSED_ID_MISMATCH",
  /** Exists, but its state is not the defect this repair is authorized for. */
  REFUSED_UNEXPECTED_STATE: "REFUSED_UNEXPECTED_STATE",
  /** No such document. */
  REFUSED_MISSING: "REFUSED_MISSING",
} as const;
export type RepairOutcome = (typeof REPAIR_OUTCOME)[keyof typeof REPAIR_OUTCOME];

export interface RepairCandidate {
  readonly warehouseId: string;
  readonly data: Record<string, unknown> | undefined;
}

export interface RepairDecision {
  readonly warehouseId: string;
  readonly currentId: string | null;
  readonly requestedId: string;
  readonly outcome: RepairOutcome;
  /** The validator's verdict on the stored document, before any patch. */
  readonly validatorBefore: string | null;
  /** The validator's verdict on the document with ONLY `id` added. */
  readonly validatorAfter: string | null;
  /** Exactly the keys the patch would change. Must be ["id"] for a REPAIR. */
  readonly plannedChangedKeys: readonly string[];
  readonly detail: string | null;
}

const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Decide one record against the EXACT expected defect. Never throws.
 *
 * Every precondition the ruling names is checked here rather than in the operator script, so the
 * refusals are testable offline and there is one place they live. A record that differs from the
 * expected defect in ANY respect is refused with the reason, not repaired on the assumption that
 * adding an id is harmless.
 */
export function classifyCanonicalIdRepair(candidate: RepairCandidate): RepairDecision {
  const requestedId = candidate.warehouseId;
  const base = { warehouseId: requestedId, requestedId, plannedChangedKeys: [] as readonly string[] };

  if (candidate.data === undefined) {
    return { ...base, currentId: null, outcome: REPAIR_OUTCOME.REFUSED_MISSING, validatorBefore: null, validatorAfter: null, detail: null };
  }
  const data = candidate.data;
  const before = validateGovernedWarehouse(data, requestedId);
  const storedId = has(data, REPAIRED_FIELD) ? data[REPAIRED_FIELD] : undefined;

  // Already correct -> idempotent success. Checked FIRST so a re-run over a repaired record is a
  // clean no-op rather than a refusal.
  if (typeof storedId === "string" && storedId === requestedId) {
    return {
      ...base,
      currentId: storedId,
      outcome: REPAIR_OUTCOME.ALREADY_CORRECT,
      validatorBefore: before.valid ? null : before.reason,
      validatorAfter: before.valid ? null : before.reason,
      detail: null,
    };
  }
  // Present but wrong -> a data-integrity fault of a different kind. This repair never overwrites an
  // id, because a record whose stored id disagrees with its path is not "missing an id".
  if (storedId !== undefined) {
    return {
      ...base,
      currentId: typeof storedId === "string" ? storedId : JSON.stringify(storedId) ?? null,
      outcome: REPAIR_OUTCOME.REFUSED_ID_MISMATCH,
      validatorBefore: before.valid ? null : before.reason,
      validatorAfter: null,
      detail: "stored id disagrees with the document id -- not the defect this repair is authorized for",
    };
  }

  // From here the id is genuinely absent. Everything below is the ruling's expected-defect contract.
  const unexpected = (detail: string): RepairDecision => ({
    ...base,
    currentId: null,
    outcome: REPAIR_OUTCOME.REFUSED_UNEXPECTED_STATE,
    validatorBefore: before.valid ? null : before.reason,
    validatorAfter: null,
    detail,
  });

  if (before.valid) return unexpected("the record is already governed without a stored id -- contradictory, refuse");
  if (before.reason !== GOVERNED_WAREHOUSE_REASONS.ID_INVALID) {
    return unexpected(`the record fails for a different reason (${before.reason}), so adding an id would not repair it`);
  }
  if (data.provenance !== "NATIVE") return unexpected(`provenance is ${JSON.stringify(data.provenance)}, expected NATIVE`);
  if (has(data, "governanceInitializedAt") || has(data, "governanceInitializedBy")) {
    return unexpected("governance-initialization metadata is present, which a NATIVE seed record must not carry");
  }
  if (has(data, "operatingCompanyId")) {
    return unexpected("an operating company is already present -- out of scope for an identity repair");
  }

  // The proof that one field is sufficient: the SAME canonical validator, on the patched document.
  const after = validateGovernedWarehouse({ ...data, [REPAIRED_FIELD]: requestedId }, requestedId);
  if (!after.valid) return unexpected(`adding the id does not make the record governed (${after.reason})`);

  return {
    ...base,
    currentId: null,
    outcome: REPAIR_OUTCOME.REPAIR,
    validatorBefore: before.reason,
    validatorAfter: null,
    plannedChangedKeys: [REPAIRED_FIELD],
    detail: null,
  };
}

export interface RepairPlan {
  readonly ok: boolean;
  readonly decisions: readonly RepairDecision[];
  readonly toRepair: readonly RepairDecision[];
  readonly alreadyCorrect: readonly RepairDecision[];
  readonly refusals: readonly RepairDecision[];
  readonly blockedReason: string | null;
}

/**
 * Preflight the COMPLETE batch, then mutate. One refusal blocks both records.
 *
 * Two records is small enough that partial repair looks harmless, which is exactly why it is
 * forbidden: a half-applied identity repair leaves a state no ruling describes and gives the next
 * operator no way to tell an intended partial from an aborted run.
 */
export function planCanonicalIdRepair(candidates: readonly RepairCandidate[]): RepairPlan {
  const byId = new Map(candidates.map((c) => [c.warehouseId, c] as const));
  const decisions = REPAIRABLE_WAREHOUSE_IDS.map((id) =>
    classifyCanonicalIdRepair(byId.get(id) ?? { warehouseId: id, data: undefined }),
  );

  const refusals = decisions.filter(
    (d) => d.outcome !== REPAIR_OUTCOME.REPAIR && d.outcome !== REPAIR_OUTCOME.ALREADY_CORRECT,
  );
  const toRepair = decisions.filter((d) => d.outcome === REPAIR_OUTCOME.REPAIR);
  const alreadyCorrect = decisions.filter((d) => d.outcome === REPAIR_OUTCOME.ALREADY_CORRECT);

  let blockedReason: string | null = null;
  if (decisions.length !== EXPECTED_REPAIR_COUNT) {
    blockedReason = `expected ${EXPECTED_REPAIR_COUNT} records, planned ${decisions.length}`;
  } else if (refusals.length > 0) {
    blockedReason = `${refusals.length} refusal(s): ${refusals.map((r) => `${r.warehouseId}=${r.outcome}`).join(", ")}`;
  }

  return { ok: blockedReason === null, decisions, toRepair, alreadyCorrect, refusals, blockedReason };
}

/**
 * The exact patch. ONE key.
 *
 * PATCH, NEVER RECONSTRUCT — the whole reason this tool exists instead of the migration. Returning a
 * single key means the operator path has nothing else it could write even by accident.
 */
export function canonicalIdPatch(decision: RepairDecision): Readonly<Record<string, string>> {
  if (decision.outcome !== REPAIR_OUTCOME.REPAIR) {
    throw new Error(`canonicalIdPatch is only defined for REPAIR, got ${decision.outcome}`);
  }
  return Object.freeze({ [REPAIRED_FIELD]: decision.requestedId });
}
