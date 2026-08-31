// EOS Ownership Model v1 — FIRST ASSIGNMENT of a physical Warehouse root's operating company.
// Owner rulings R-19 / R-20 / R-21 / R-22 / R-23 (DECISIONS #150).
//
// PURE. No Firestore, no clock, no I/O, no throwing for data reasons. The operator script supplies
// the reads and performs the writes; every decision is made here so it can be tested offline and so
// there is exactly one place the contract lives.
//
// ============================ WHAT THIS IS, AND WHAT IT IS NOT ============================
//
// It is a BOUNDED, ONE-TIME reconciliation: twelve authored root decisions were made by ruling R-1
// and recorded in configuration; five of them concern warehouses and have never been applied to a
// record. This turns exactly those five facts into writes, once.
//
// It is NOT a general warehouse writer, NOT a reassignment mechanism, and NOT a widening of the
// already-authorized ownership backfill. R-23 is explicit about the last one: that applier's safety
// contract WAS its exact document count and population, so raising its caps would retroactively
// change an authority that was reviewed as bounded. This is a separate path that reuses its
// primitives — the company authority, the §3A validator, the root config, the audit writer — and
// owns its own scope, caps and refusals.
//
// ============================ THE CONTRACT (R-19) ============================
//
//     unset            + governed ACTIVE company   -> ASSIGN
//     same company     (already applied)           -> IDEMPOTENT SUCCESS: no write, no audit event
//     different company                            -> REFUSE
//
// NO REASSIGNMENT. The ownership matrix routes a warehouse company CHANGE to the handoff authority,
// but nothing in this repository describes a warehouse moving between operating companies or what
// business event that would be. A routing rule is not a use case, so a mismatch is refused rather
// than treated as a transfer. If that requirement ever becomes real it gets its own ruling.
//
// ============================ WHY IDEMPOTENCY LIVES HERE (R-19) ============================
//
// The handoff authority refuses an identical-owner handoff outright — "a handoff that moves nothing
// is not an event" — and that rule is correct and must not be weakened. So the same-value case is
// resolved HERE, before the handoff authority is ever reached: the command reports success, writes
// nothing, and emits nothing. Retry safety and audit truth both survive intact.
//
// ============================ ACTIVE IS AN ASSIGNMENT QUESTION (R-20) ============================
//
// Storage validity and assignment eligibility are different questions. A warehouse may legitimately
// keep carrying the id of a company that later went inactive — that is history, and this command
// never rewrites it. But creating a NEW operating relationship with an already-inactive company is
// refused. So the validator (2A.1A) accepts INACTIVE in storage while this refuses it in assignment,
// deliberately and not by oversight.
import {
  resolveOperatingCompany,
  OPERATING_COMPANIES_COLLECTION,
} from "./operatingCompanyAuthority.js";
import { validateGovernedWarehouse } from "../warehouseGovernance/governedWarehouseValidation.js";

void OPERATING_COMPANIES_COLLECTION;

/** The ONE field this command may ever write. Named as data so the operator path cannot drift. */
export const ASSIGNED_FIELD = "operatingCompanyId" as const;

/** The ownership-matrix family key these records belong to. */
export const WAREHOUSE_OWNERSHIP_FAMILY = "warehouse" as const;

// ============================ TARGET RESOLUTION ============================
//
// R-22 / operator safety: the target must be proven by PROJECT ID. A registry role of "sandbox" is
// NOT sufficient, because eos-platform-sandbox and eos-platform-certification both carry it — a
// role check cannot tell them apart, and this repository has already been bitten by exactly that.

/** The ordinary sandbox this bounded reconciliation is authorized for. */
export const AUTHORIZED_ASSIGNMENT_PROJECT = "eos-platform-sandbox" as const;
/** The certification world. Shares the `sandbox` role and is NOT authorized by that role. */
export const CERTIFICATION_PROJECT = "eos-platform-certification" as const;
/** Refused by name, first, before anything else is even considered. */
export const PRODUCTION_PROJECT = "taylor-parts" as const;

export const TARGET_DECISION = {
  ELIGIBLE: "ELIGIBLE",
  REFUSED_PRODUCTION: "REFUSED_PRODUCTION",
  REFUSED_CERTIFICATION_NOT_AUTHORIZED: "REFUSED_CERTIFICATION_NOT_AUTHORIZED",
  REFUSED_UNKNOWN_TARGET: "REFUSED_UNKNOWN_TARGET",
} as const;
export type TargetDecision = (typeof TARGET_DECISION)[keyof typeof TARGET_DECISION];

export interface TargetResolution {
  readonly decision: TargetDecision;
  readonly projectId: string | null;
}

/**
 * Prove the target by project id. Fail-closed in every direction: production by name, certification
 * unless separately and explicitly authorized for that exact target, and anything else at all.
 *
 * There is deliberately no "role === sandbox" branch. Adding one would reintroduce the ambiguity the
 * project-id rule exists to remove.
 */
export function resolveAssignmentTarget(
  projectId: unknown,
  options: { certificationAuthorized?: boolean } = {},
): TargetResolution {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    return { decision: TARGET_DECISION.REFUSED_UNKNOWN_TARGET, projectId: null };
  }
  const id = projectId.trim();
  if (id === PRODUCTION_PROJECT) return { decision: TARGET_DECISION.REFUSED_PRODUCTION, projectId: id };
  if (id === CERTIFICATION_PROJECT) {
    return options.certificationAuthorized === true
      ? { decision: TARGET_DECISION.ELIGIBLE, projectId: id }
      : { decision: TARGET_DECISION.REFUSED_CERTIFICATION_NOT_AUTHORIZED, projectId: id };
  }
  if (id === AUTHORIZED_ASSIGNMENT_PROJECT) return { decision: TARGET_DECISION.ELIGIBLE, projectId: id };
  return { decision: TARGET_DECISION.REFUSED_UNKNOWN_TARGET, projectId: id };
}

// ============================ THE AUTHORED FACTS ============================
//
// R-1 authored these; the reconciliation measured them; this command may recognize NOTHING ELSE.
// They are never derived from a warehouse's name, location, line of business, salesperson, creator,
// inventory, region or any display text — and there is no code path here that could.
//
// The pinned set below is a CROSS-CHECK, not the source. The source is the authored configuration.
// If the two disagree in either direction, the run STOPS: a config that has drifted from the ruling
// is exactly as unsafe as a hard-coded list that has drifted from the config.

export const EXPECTED_WAREHOUSE_ASSIGNMENTS: Readonly<Record<string, string>> = Object.freeze({
  "wh-main": "taylor",
  "wh-retired": "taylor",
  "wh-sandbox-central": "taylor",
  "wh-north": "ventana",
  "wh-sandbox-north": "ventana",
});
export const EXPECTED_ASSIGNMENT_COUNT = Object.keys(EXPECTED_WAREHOUSE_ASSIGNMENTS).length;

export const SOURCE_DECISION = {
  MATCHED: "MATCHED",
  MISSING_FROM_CONFIG: "MISSING_FROM_CONFIG",
  UNEXPECTED_IN_CONFIG: "UNEXPECTED_IN_CONFIG",
  COMPANY_DISAGREES: "COMPANY_DISAGREES",
  CONFIG_MALFORMED: "CONFIG_MALFORMED",
} as const;
export type SourceDecision = (typeof SOURCE_DECISION)[keyof typeof SOURCE_DECISION];

export interface AuthoredAssignments {
  readonly decision: SourceDecision;
  /** Populated only when MATCHED. */
  readonly assignments: Readonly<Record<string, string>> | null;
  readonly detail: string | null;
}

/**
 * Read the warehouse assignments out of the authored root configuration and prove they are EXACTLY
 * the expected set. Any drift — an id added, an id removed, a company changed, a malformed entry —
 * stops the run before a single read of live data.
 */
export function resolveAuthoredWarehouseAssignments(config: unknown): AuthoredAssignments {
  const roots = (config as { roots?: unknown } | null)?.roots;
  if (roots === null || typeof roots !== "object") {
    return { decision: SOURCE_DECISION.CONFIG_MALFORMED, assignments: null, detail: "config.roots is not an object" };
  }
  const rows = (roots as { warehouses?: unknown }).warehouses;
  if (!Array.isArray(rows)) {
    return { decision: SOURCE_DECISION.CONFIG_MALFORMED, assignments: null, detail: "config.roots.warehouses is not a list" };
  }

  const authored: Record<string, string> = {};
  for (const row of rows) {
    if (row === null || typeof row !== "object") {
      return { decision: SOURCE_DECISION.CONFIG_MALFORMED, assignments: null, detail: "a warehouse root row is not an object" };
    }
    const { id, operatingCompanyId } = row as { id?: unknown; operatingCompanyId?: unknown };
    if (typeof id !== "string" || id.trim().length === 0) {
      return { decision: SOURCE_DECISION.CONFIG_MALFORMED, assignments: null, detail: "a warehouse root row has no id" };
    }
    if (typeof operatingCompanyId !== "string" || operatingCompanyId.trim().length === 0) {
      return { decision: SOURCE_DECISION.CONFIG_MALFORMED, assignments: null, detail: `root ${id} has no operatingCompanyId` };
    }
    if (Object.prototype.hasOwnProperty.call(authored, id.trim())) {
      return { decision: SOURCE_DECISION.CONFIG_MALFORMED, assignments: null, detail: `root ${id} appears twice` };
    }
    authored[id.trim()] = operatingCompanyId.trim();
  }

  for (const id of Object.keys(EXPECTED_WAREHOUSE_ASSIGNMENTS)) {
    if (!Object.prototype.hasOwnProperty.call(authored, id)) {
      return { decision: SOURCE_DECISION.MISSING_FROM_CONFIG, assignments: null, detail: id };
    }
  }
  for (const id of Object.keys(authored)) {
    if (!Object.prototype.hasOwnProperty.call(EXPECTED_WAREHOUSE_ASSIGNMENTS, id)) {
      return { decision: SOURCE_DECISION.UNEXPECTED_IN_CONFIG, assignments: null, detail: id };
    }
    if (authored[id] !== EXPECTED_WAREHOUSE_ASSIGNMENTS[id]) {
      return {
        decision: SOURCE_DECISION.COMPANY_DISAGREES,
        assignments: null,
        detail: `${id}: config says ${authored[id]}, expected ${EXPECTED_WAREHOUSE_ASSIGNMENTS[id]}`,
      };
    }
  }
  return { decision: SOURCE_DECISION.MATCHED, assignments: Object.freeze({ ...authored }), detail: null };
}

// ============================ PER-WAREHOUSE CLASSIFICATION ============================

export const ASSIGNMENT_OUTCOME = {
  /** Unset, and the requested company is governed and ACTIVE. The only outcome that writes. */
  ASSIGN: "ASSIGN",
  /** Already carries exactly this company. Success, and deliberately silent (R-19/R-21). */
  ALREADY_ASSIGNED: "ALREADY_ASSIGNED",
  /** Carries a DIFFERENT company. No reassignment semantics exist, so this refuses. */
  REFUSED_COMPANY_MISMATCH: "REFUSED_COMPANY_MISMATCH",
  /** The requested company is not a governed company id at all. */
  REFUSED_COMPANY_UNKNOWN: "REFUSED_COMPANY_UNKNOWN",
  /** The requested company exists but is INACTIVE — R-20. */
  REFUSED_COMPANY_NOT_ASSIGNABLE: "REFUSED_COMPANY_NOT_ASSIGNABLE",
  /** The stored document is not a §3A governed warehouse. */
  REFUSED_WAREHOUSE_MALFORMED: "REFUSED_WAREHOUSE_MALFORMED",
  /** No such document. */
  REFUSED_WAREHOUSE_MISSING: "REFUSED_WAREHOUSE_MISSING",
} as const;
export type AssignmentOutcome = (typeof ASSIGNMENT_OUTCOME)[keyof typeof ASSIGNMENT_OUTCOME];

export interface WarehouseCandidate {
  readonly warehouseId: string;
  /** The raw stored document, or `undefined` when it does not exist. */
  readonly data: Record<string, unknown> | undefined;
}

export interface AssignmentDecision {
  readonly warehouseId: string;
  readonly requestedCompanyId: string;
  readonly outcome: AssignmentOutcome;
  /** The company already stored, when there is one. Never invented. */
  readonly currentCompanyId: string | null;
  readonly detail: string | null;
}

const isRefusal = (outcome: AssignmentOutcome): boolean =>
  outcome !== ASSIGNMENT_OUTCOME.ASSIGN && outcome !== ASSIGNMENT_OUTCOME.ALREADY_ASSIGNED;

/**
 * Decide one warehouse. Never throws.
 *
 * ORDER MATTERS, and it is chosen so the refusal a caller sees is about the thing they can act on.
 * The warehouse is checked before the company: if the record is missing or ungoverned, saying so is
 * more useful than complaining about a company that was never the problem. The already-assigned case
 * is checked before company eligibility, because an ALREADY-APPLIED assignment must stay idempotent
 * even if that company has since gone inactive — R-20 is explicit that history is not rewritten
 * merely because a company later became inactive.
 */
export function classifyWarehouseAssignment(
  candidate: WarehouseCandidate,
  requestedCompanyId: string,
  // The company authority, injectable ONLY so the INACTIVE branch can be exercised: no inactive
  // company is seeded today, so without this seam R-20's central refusal would be untestable and
  // would ship on reasoning alone. Production never passes it -- the default IS the authority, and
  // supplying a different one in real code would be a second opinion about what a company is.
  deps: { resolveCompany?: typeof resolveOperatingCompany } = {},
): AssignmentDecision {
  const resolveCompany = deps.resolveCompany ?? resolveOperatingCompany;
  const base = { warehouseId: candidate.warehouseId, requestedCompanyId };

  if (candidate.data === undefined) {
    return { ...base, outcome: ASSIGNMENT_OUTCOME.REFUSED_WAREHOUSE_MISSING, currentCompanyId: null, detail: null };
  }
  const governed = validateGovernedWarehouse(candidate.data, candidate.warehouseId);
  if (!governed.valid) {
    return {
      ...base,
      outcome: ASSIGNMENT_OUTCOME.REFUSED_WAREHOUSE_MALFORMED,
      currentCompanyId: null,
      detail: governed.reason,
    };
  }

  const current = governed.value.operatingCompanyId ?? null;
  if (current !== null && current === requestedCompanyId) {
    // IDEMPOTENT SUCCESS. No write, no handoff, no audit event. Checked before company eligibility
    // on purpose: a re-run must stay a no-op even for a company that has since been deactivated.
    return { ...base, outcome: ASSIGNMENT_OUTCOME.ALREADY_ASSIGNED, currentCompanyId: current, detail: null };
  }
  if (current !== null) {
    return {
      ...base,
      outcome: ASSIGNMENT_OUTCOME.REFUSED_COMPANY_MISMATCH,
      currentCompanyId: current,
      detail: "no governed warehouse company reassignment semantics exist",
    };
  }

  const resolved = resolveCompany(requestedCompanyId);
  if (resolved.company === null) {
    return { ...base, outcome: ASSIGNMENT_OUTCOME.REFUSED_COMPANY_UNKNOWN, currentCompanyId: null, detail: resolved.state };
  }
  if (resolved.state !== "RESOLVED") {
    // R-20: storage tolerates an inactive company; creating a NEW relationship with one does not.
    return {
      ...base,
      outcome: ASSIGNMENT_OUTCOME.REFUSED_COMPANY_NOT_ASSIGNABLE,
      currentCompanyId: null,
      detail: resolved.state,
    };
  }
  return { ...base, outcome: ASSIGNMENT_OUTCOME.ASSIGN, currentCompanyId: null, detail: null };
}

// ============================ THE BATCH PLAN ============================

export interface AssignmentPlan {
  /** True only when EVERY decision is ASSIGN or ALREADY_ASSIGNED and the expected set was complete. */
  readonly ok: boolean;
  readonly decisions: readonly AssignmentDecision[];
  readonly toAssign: readonly AssignmentDecision[];
  readonly alreadyAssigned: readonly AssignmentDecision[];
  readonly refusals: readonly AssignmentDecision[];
  readonly blockedReason: string | null;
}

/**
 * VALIDATE THE COMPLETE INTENDED BATCH, THEN MUTATE — never row-by-row until one fails.
 *
 * A partial assignment is the worst outcome available here: it leaves the sandbox in a state no
 * ruling describes, and the next operator cannot tell an intended partial from an aborted run. So a
 * single refusal anywhere blocks the entire batch, and the caller is expected to write nothing.
 */
export function planWarehouseRootCompanyAssignment(
  authored: Readonly<Record<string, string>>,
  candidates: readonly WarehouseCandidate[],
  deps: { resolveCompany?: typeof resolveOperatingCompany } = {},
): AssignmentPlan {
  const byId = new Map(candidates.map((c) => [c.warehouseId, c] as const));
  const decisions: AssignmentDecision[] = [];

  for (const [warehouseId, companyId] of Object.entries(authored)) {
    const candidate = byId.get(warehouseId) ?? { warehouseId, data: undefined };
    decisions.push(classifyWarehouseAssignment(candidate, companyId, deps));
  }

  const refusals = decisions.filter((d) => isRefusal(d.outcome));
  const toAssign = decisions.filter((d) => d.outcome === ASSIGNMENT_OUTCOME.ASSIGN);
  const alreadyAssigned = decisions.filter((d) => d.outcome === ASSIGNMENT_OUTCOME.ALREADY_ASSIGNED);

  let blockedReason: string | null = null;
  if (decisions.length !== EXPECTED_ASSIGNMENT_COUNT) {
    blockedReason = `expected ${EXPECTED_ASSIGNMENT_COUNT} assignments, planned ${decisions.length}`;
  } else if (refusals.length > 0) {
    blockedReason = `${refusals.length} refusal(s): ${refusals.map((r) => `${r.warehouseId}=${r.outcome}`).join(", ")}`;
  }

  return {
    ok: blockedReason === null,
    decisions,
    toAssign,
    alreadyAssigned,
    refusals,
    blockedReason,
  };
}

/**
 * The exact patch for one assignment. ONE FIELD.
 *
 * PATCH, NEVER RECONSTRUCT. Every whole-document warehouse writer measured in the 2A.1B
 * reconciliation is a replace, and a replace from a fixed field list is precisely how the migration
 * erase path came to exist. This returns a single key so the operator path has nothing else it could
 * accidentally normalize, and so an assignment can never become a silent warehouse migration.
 */
export function assignmentPatch(decision: AssignmentDecision): Readonly<Record<string, string>> {
  if (decision.outcome !== ASSIGNMENT_OUTCOME.ASSIGN) {
    throw new Error(`assignmentPatch is only defined for ASSIGN, got ${decision.outcome}`);
  }
  return Object.freeze({ [ASSIGNED_FIELD]: decision.requestedCompanyId });
}

/** The handoff input for one first assignment: previousOwner is NULL, which the existing ownership
 *  authority explicitly supports and renders as "(none)". No new audit family is introduced. */
export function assignmentHandoffInput(decision: AssignmentDecision): {
  family: string;
  recordId: string;
  previousOwner: null;
  newOwner: { type: "COMPANY"; id: string };
  source: "ADMIN_CORRECTION";
  reason: string;
} {
  if (decision.outcome !== ASSIGNMENT_OUTCOME.ASSIGN) {
    throw new Error(`assignmentHandoffInput is only defined for ASSIGN, got ${decision.outcome}`);
  }
  return {
    family: WAREHOUSE_OWNERSHIP_FAMILY,
    recordId: decision.warehouseId,
    previousOwner: null,
    newOwner: { type: "COMPANY", id: decision.requestedCompanyId },
    // The closest existing source token. `OWNERSHIP_HANDOFF_SOURCES` has none for a first
    // assignment, which the reconciliation recorded as an open gap; using the nearest existing one
    // is deliberate, because inventing a token is an ownership-authority change this is not.
    source: "ADMIN_CORRECTION",
    reason: "R-1 authored physical-root company assignment (Workstream 2A.1B, first assignment)",
  };
}
