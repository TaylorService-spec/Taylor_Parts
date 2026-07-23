// INV-1 Phase 1, PR 1.10 -- Part Master migration cutover-readiness
// evaluation (ADR-008 Accepted / Decision #40). Pure module: takes the
// dry-run analysis totals produced by the PR 1.8 analyzer plus the recorded
// governance/approval state and computes a deterministic PASS/BLOCKED
// readiness verdict per criterion. ANALYSIS ONLY -- no persistence, no
// Firestore import, no write capability of any kind. Cutover EXECUTION
// remains unauthorized and is governed by its own future Owner gate(s);
// this module can only ever say "ready" or "blocked", never act.

/** Owner decisions that must be resolved before any cutover authorization.
 * Recorded here as the single authority the evidence generator and the
 * runbook both render; each stays UNRESOLVED until an Owner gate resolves
 * it (resolution is recorded in DECISIONS.md, then removed from the
 * unresolved set passed to evaluateCutoverReadiness). */
export const OWNER_CUTOVER_DECISIONS: readonly { id: string; question: string }[] = [
  { id: "D-M1", question: "Do CREATE and UPDATE populations execute in one cutover or in separate Owner gates?" },
  { id: "D-M2", question: "Are LEGACY/INTERNAL_PN aliases created in the same execution as the Part writes, or in a follow-up gate?" },
  { id: "D-M3", question: "Are inactive-target Parts excluded from the input, or remediated (reactivated/superseded) before cutover?" },
  { id: "D-M4", question: "Are part_supplier_items relationships deferred to a separate migration, or included?" },
  { id: "D-M5", question: "Do historical identifiers require a LEGACY-alias backfill pass beyond what rows declare?" },
  { id: "D-M6", question: "Is PART_MASTER_REFERENCE activation a separate gate from migration execution (recommended: yes)?" },
  { id: "D-M7", question: "Does the repository-only client-read Rules posture deploy before, during, or after cutover?" },
];

export type CriterionStatus = "PASS" | "BLOCKED";

export interface CriterionResult {
  readonly id: string;
  readonly description: string;
  readonly status: CriterionStatus;
  readonly detail: string;
}

export interface CutoverApprovals {
  readonly createPopulationApproved: boolean;
  readonly updatePopulationApproved: boolean;
  readonly rollbackPointApproved: boolean;
  readonly reconciliationMethodApproved: boolean;
  readonly productionOperatorApproved: boolean;
  readonly maintenanceWindowApprovedOrWaived: boolean;
  readonly supplierItemInconsistenciesReviewed: boolean;
  readonly rulesStateConfirmed: boolean;
}

export interface ReadinessInput {
  /** Classification totals from the analyzer summary (CREATE/UPDATE/NO_CHANGE/CONFLICT/INVALID). */
  readonly counts: Readonly<Record<string, number>>;
  /** Reason-code totals from the analyzer summary. */
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly duplicateCount: number;
  /** Owner decisions still unresolved (ids from OWNER_CUTOVER_DECISIONS). */
  readonly unresolvedDecisions: readonly string[];
  /** True only when PART_MASTER_REFERENCE is verified OFF. */
  readonly featureFlagOff: boolean;
  /** True by construction for the PR 1.8 analyzer (quantity columns informational-only). */
  readonly quantityScopeExcluded: boolean;
  /** True by construction: no historical Work Order rewrite is part of the plan. */
  readonly historicalWorkOrdersUntouched: boolean;
  readonly approvals: CutoverApprovals;
}

const reason = (input: ReadinessInput, code: string): number => input.reasonCounts[code] ?? 0;

/** Deterministic readiness evaluation. Overall status is BLOCKED unless
 * every criterion passes. Never throws on well-formed input. */
export function evaluateCutoverReadiness(input: ReadinessInput): {
  readonly status: CriterionStatus;
  readonly criteria: readonly CriterionResult[];
} {
  const c = (id: string, description: string, pass: boolean, detail: string): CriterionResult => ({
    id,
    description,
    status: pass ? "PASS" : "BLOCKED",
    detail,
  });
  const criteria: CriterionResult[] = [
    c("C1", "zero INVALID rows", (input.counts.INVALID ?? 0) === 0, `INVALID=${input.counts.INVALID ?? 0}`),
    c("C2", "zero unresolved duplicate partIds", reason(input, "DUPLICATE_PART_ID_IN_FILE") === 0, `DUPLICATE_PART_ID_IN_FILE=${reason(input, "DUPLICATE_PART_ID_IN_FILE")}`),
    c("C3", "zero unresolved duplicate normalized internal part numbers", reason(input, "DUPLICATE_IPN_IN_FILE") === 0, `DUPLICATE_IPN_IN_FILE=${reason(input, "DUPLICATE_IPN_IN_FILE")}`),
    c("C4", "zero ambiguous create-versus-update rows", reason(input, "AMBIGUOUS_CREATE_VS_UPDATE") + reason(input, "MULTIPLE_MATCHES") === 0, `AMBIGUOUS=${reason(input, "AMBIGUOUS_CREATE_VS_UPDATE")} MULTIPLE_MATCHES=${reason(input, "MULTIPLE_MATCHES")}`),
    c("C5", "zero conflicting aliases", reason(input, "ALIAS_OWNED_BY_OTHER_PART") === 0, `ALIAS_OWNED_BY_OTHER_PART=${reason(input, "ALIAS_OWNED_BY_OTHER_PART")}`),
    c("C6", "all required units recognized", reason(input, "UNKNOWN_UNIT") === 0, `UNKNOWN_UNIT=${reason(input, "UNKNOWN_UNIT")}`),
    c("C7", "all inactive-target conflicts resolved", reason(input, "TARGET_PART_INACTIVE") === 0, `TARGET_PART_INACTIVE=${reason(input, "TARGET_PART_INACTIVE")}`),
    c("C8", "immutable identifier changes rejected and absent from the approved input", reason(input, "IMMUTABLE_ID_MUTATION") === 0, `IMMUTABLE_ID_MUTATION=${reason(input, "IMMUTABLE_ID_MUTATION")}`),
    c("C9", "supplier-item inconsistencies reviewed", input.approvals.supplierItemInconsistenciesReviewed, "Owner/operator review of part_supplier_items consistency"),
    c("C10", "Owner approval of the CREATE population", input.approvals.createPopulationApproved, `CREATE=${input.counts.CREATE ?? 0}`),
    c("C11", "Owner approval of the UPDATE population", input.approvals.updatePopulationApproved, `UPDATE=${input.counts.UPDATE ?? 0}`),
    c("C12", "approved rollback point", input.approvals.rollbackPointApproved, "pre-cutover backup/export identity recorded and Owner-approved"),
    c("C13", "approved reconciliation method", input.approvals.reconciliationMethodApproved, "post-write reconciliation procedure Owner-approved"),
    c("C14", "approved production operator", input.approvals.productionOperatorApproved, "named operator + reviewer approved"),
    c("C15", "approved maintenance window (or explicit waiver)", input.approvals.maintenanceWindowApprovedOrWaived, "window approved or formally waived"),
    c("C16", "PART_MASTER_REFERENCE remains OFF before cutover authorization", input.featureFlagOff, "flag verified OFF"),
    c("C17", "repository and production Rules state confirmed", input.approvals.rulesStateConfirmed, "repo Rules vs deployed Rules divergence reviewed and accepted"),
    c("C18", "no quantity or availability recalculation included", input.quantityScopeExcluded, "quantity columns are informational-only; ledger untouched"),
    c("C19", "no historical Work Order rewrite included", input.historicalWorkOrdersUntouched, "snapshots preserved verbatim (PR 1.7 contract)"),
    c("C20", "all Owner cutover decisions resolved", input.unresolvedDecisions.length === 0, input.unresolvedDecisions.length === 0 ? "none unresolved" : `unresolved: ${[...input.unresolvedDecisions].join(", ")}`),
  ];
  return {
    status: criteria.every((r) => r.status === "PASS") ? "PASS" : "BLOCKED",
    criteria,
  };
}
