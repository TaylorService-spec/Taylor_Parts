// Enterprise Inventory -- Cycle Count operating authority: shared TYPES + failure taxonomy.
//
// AUDIT PREMISE (re-established, not assumed): PR #1032 (Transfer operating authority) made the
// location-aware operational ledger (functions/src/inventoryLedger/operationalMovement*) a LIVE
// expected-quantity authority for NONE-mode Parts -- transferOrderCommand.ts's
// computeNoneOnHandThroughTxn sums RECEIVED/RETURNED/TRANSFER_IN (+), TRANSFER_OUT/SCRAPPED (-), and
// ADJUSTED (signed) at a (partId, location) pair, and that sum is what gates whether a Transfer may be
// created. This module reuses the SAME sourcing discipline for Cycle Count's "expected quantity" -- it
// is never a second manually maintained on-hand number (data/partsCatalog.ts's warehouseQty baseline and
// the legacy RESERVED/RELEASED/CONSUMED WO ledger are a DIFFERENT, disjoint, non-location-aware system
// this module never reads). For SERIAL-tracked Parts, the authority is the serialized_assets registry's
// AVAILABLE units at a location (the same rule transferOrderCommand.ts's SERIAL sufficiency check uses),
// not a ledger sum.
//
// LIFECYCLE. COUNTED below is a STATUS ON THIS RECORD, not a ledger movement. There was once a
// COUNTED member of OPERATIONAL_MOVEMENT_TYPES; it never had a writer -- not even this module, which
// stages the real stock correction as ADJUSTED -- and CERT-LEDGER-COUNTED-08 retired it. This module
// is ADJUSTED's first live producer for count-driven reconciliation, and the only producer of the
// COUNTED status:
//   createCycleCount    : (none) -> OPEN        (snapshots expected quantity/serials at creation time)
//   submitCycleCount    : OPEN -> COUNTED        (records counted quantity/serials, computes variance)
//   reconcileCycleCount : COUNTED -> RECONCILED  (manager APPROVES; stages ADJUSTED ledger evidence;
//                                                  reason required on non-zero variance; never
//                                                  overwrites stock truth)
//   reconcileCycleCount : COUNTED -> REJECTED    (manager REJECTS the same submitted count via the same
//                                                  callable's `decision: "REJECT"`; stages NO ledger
//                                                  evidence -- the expected-quantity authority is left
//                                                  untouched, the count is simply recorded as disputed)
//   cancelCycleCount    : OPEN -> CANCELLED       (domain-safe only -- before any count is submitted)
//
// M23 BLIND-COUNT REMEDIATION (Owner ruling, 2026-08-18): the counter no longer sees expectedQuantity
// before submitting (field-ops-app-vite/src/modules/inventory/CycleCounts.jsx), and a manager now
// disposes of every submitted count as APPROVE or REJECT. SEPARATION OF DUTIES is enforced HERE, at the
// only place a variance can be dispositioned: reconcileCycleCount refuses (CycleCountSelfApprovalError)
// when the disposing actor is the SAME principal recorded as `submittedBy` AND the variance is material
// (cycleCountMateriality.ts). This is a server-side authorization check inside the transaction that
// reads and writes the record -- a client cannot bypass it by omitting a button or hiding a UI state.

export const CYCLE_COUNT_STATUSES = ["OPEN", "COUNTED", "RECONCILED", "REJECTED", "CANCELLED"] as const;
export type CycleCountStatus = (typeof CYCLE_COUNT_STATUSES)[number];

export const CYCLE_COUNT_REVIEW_DECISIONS = ["APPROVE", "REJECT"] as const;
export type CycleCountReviewDecision = (typeof CYCLE_COUNT_REVIEW_DECISIONS)[number];

export const CYCLE_COUNT_SCHEMA_VERSION = 1;

// Same endpoint fence as Transfer Phase 4: WAREHOUSE + MOBILE(truck) only. A cycle count at a BIN/VENDOR/
// CUSTOMER/VIRTUAL location is out of scope (matches the reused location-resolver's own fence).
export const CYCLE_COUNT_LOCATION_TYPES = ["WAREHOUSE", "MOBILE"] as const;
export type CycleCountLocationType = (typeof CYCLE_COUNT_LOCATION_TYPES)[number];

// NONE + SERIAL only (LOT deferred, same posture as Receiving/Transfer).
export const CYCLE_COUNT_SUPPORTED_TRACKING_MODES = ["NONE", "SERIAL"] as const;
export type CycleCountTrackingMode = (typeof CYCLE_COUNT_SUPPORTED_TRACKING_MODES)[number];

export interface CycleCountLocationRef {
  readonly type: CycleCountLocationType;
  readonly locationId: string;
}
export interface CycleCountActor {
  readonly kind: "USER" | "SYSTEM";
  readonly id: string;
}

// The request-derived IDENTITY (everything the caller actually supplies, shape-validated and bound to
// the authoritative Part). This -- and ONLY this -- is what the idempotency fingerprint covers: the
// expected-quantity snapshot below is server-computed and frozen at creation time, so it must never
// factor into replay-vs-conflict detection (a later ledger movement must not make an already-created
// count's replay look like a conflict, or vice versa).
export interface CycleCountIdentity {
  readonly partId: string;
  readonly trackingMode: CycleCountTrackingMode;
  readonly location: CycleCountLocationRef;
  readonly idempotencyKey: string;
}

// The full stored value: the request identity plus the server-computed SNAPSHOT (expectedQuantity/
// expectedSerialNumbers), computed server-side at create time from the ledger/registry authority and
// NEVER accepted from input.
export interface CycleCountValue extends CycleCountIdentity {
  readonly expectedQuantity: number; // NONE mode
  readonly expectedSerialNumbers?: readonly string[]; // SERIAL mode
}

// SERIAL reconciliation evidence: which expected units were not found, and which found units were not
// expected. Both are explicit, never collapsed into a single quantity delta (briefing requirement).
export interface SerialVariance {
  readonly missing: readonly string[]; // expected but not counted
  readonly unexpected: readonly string[]; // counted but not expected
}

export interface DeserializedCycleCount {
  readonly cycleCountId: string;
  readonly value: CycleCountValue;
  readonly status: CycleCountStatus;
  readonly version: number;
  readonly actor: CycleCountActor;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly schemaVersion: number;
  readonly fingerprint: string;
  // Present once submitCycleCount has run (status COUNTED or RECONCILED/REJECTED). submittedBy is the
  // separation-of-duties anchor: the principal who submitted THIS count, captured independently of
  // updatedBy (which reconcile/reject would otherwise overwrite) so it survives to the review step.
  readonly countedQuantity?: number; // NONE mode
  readonly countedSerialNumbers?: readonly string[]; // SERIAL mode
  readonly variance?: number; // NONE mode: countedQuantity - expectedQuantity
  readonly serialVariance?: SerialVariance; // SERIAL mode
  readonly submittedBy?: string;
  // Present once reconcileCycleCount has run (status RECONCILED or REJECTED).
  readonly reviewDecision?: CycleCountReviewDecision;
  readonly reconciliationReason?: string;
  readonly reconciledAt?: number;
  readonly reconciledBy?: string;
  readonly ledgerEventIds?: readonly string[];
}

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T; readonly reason: null }
  | { readonly valid: false; readonly value: null; readonly reason: string };

// There is NO client-Firestore read path for cycle_counts (Rules deny all direct client read/write,
// matching receiving_orders' posture -- "Admin-SDK-only, no UI reads it"). So each command's outcome
// carries the full record-relevant fields the caller needs to render its own state, session by session,
// entirely from callable responses -- never a second read authority.
export type CycleCountCreateOutcome = {
  readonly outcome: "applied" | "replayed";
  readonly cycleCountId: string;
  readonly fingerprint: string;
  readonly partId: string;
  readonly trackingMode: CycleCountTrackingMode;
  readonly location: CycleCountLocationRef;
  readonly expectedQuantity: number;
  readonly expectedSerialNumbers?: readonly string[];
  readonly status: CycleCountStatus;
};

export interface CycleCountActionOutcome {
  readonly outcome: "applied" | "replayed";
  readonly cycleCountId: string;
  readonly status: CycleCountStatus;
  readonly ledgerEventIds?: readonly string[];
  readonly countedQuantity?: number;
  readonly countedSerialNumbers?: readonly string[];
  readonly variance?: number;
  readonly serialVariance?: SerialVariance;
  // M23 blind-count remediation: submitCycleCount's outcome now echoes the expected snapshot back to
  // the caller for the FIRST time -- deliberately never present on createCycleCount's outcome (that
  // would let the counter read it off the network response before typing a count, defeating the blind
  // count even if the UI never renders it). By the time submitCycleCount responds, the counted
  // value has already left the counter's hands in the SAME request, so there is nothing left to anchor.
  readonly expectedQuantity?: number;
  readonly expectedSerialNumbers?: readonly string[];
  readonly reviewDecision?: CycleCountReviewDecision;
  readonly reconciliationReason?: string;
}

// -------- sanitized, class-per-reason failure taxonomy (mirrors Receiving/Transfer precedent) --------
export type CycleCountCommandFailureCode =
  | "PERMISSION_DENIED"
  | "SEPARATION_OF_DUTIES"
  | "CYCLE_COUNT_NOT_FOUND"
  | "LOCATION_INVALID"
  | "PART_INVALID"
  | "SERIAL_INVALID"
  | "QUANTITY_INVALID"
  | "REASON_REQUIRED"
  | "STATUS_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "MALFORMED_STORED_RECORD"
  | "CYCLE_COUNT_INTEGRITY";

export class CycleCountCommandError extends Error {
  readonly code: CycleCountCommandFailureCode;
  constructor(code: CycleCountCommandFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}
export class UnauthorizedCycleCountError extends CycleCountCommandError {
  constructor(m = "actor is not authorized to perform this cycle count action") {
    super("PERMISSION_DENIED", m);
  }
}
// M23 blind-count remediation -- separation-of-duties guard. Distinct from UnauthorizedCycleCountError
// (which means "this principal never holds the capability at all"): this principal DOES hold
// inventory.cycleCount.reconcile, but is the same principal who submitted THIS specific count, and the
// variance is material (cycleCountMateriality.ts) -- a self-review, not a missing grant. Still maps to
// HTTP permission-denied at the callable boundary (the caller may not perform this specific action),
// but is kept as its own failure code so a UI/test can tell the two apart.
export class CycleCountSelfApprovalError extends CycleCountCommandError {
  constructor(m = "the actor who submitted this count cannot approve or reject its own material variance") {
    super("SEPARATION_OF_DUTIES", m);
  }
}
export class CycleCountNotFoundError extends CycleCountCommandError {
  constructor(m = "cycle count not found") {
    super("CYCLE_COUNT_NOT_FOUND", m);
  }
}
export class CycleCountLocationInvalidError extends CycleCountCommandError {
  constructor(m: string) {
    super("LOCATION_INVALID", m);
  }
}
export class CycleCountPartInvalidError extends CycleCountCommandError {
  constructor(m: string) {
    super("PART_INVALID", m);
  }
}
export class CycleCountSerialInvalidError extends CycleCountCommandError {
  constructor(m: string) {
    super("SERIAL_INVALID", m);
  }
}
export class CycleCountQuantityInvalidError extends CycleCountCommandError {
  constructor(m: string) {
    super("QUANTITY_INVALID", m);
  }
}
export class CycleCountReasonRequiredError extends CycleCountCommandError {
  constructor(m = "a reconciliation reason is required when there is a non-zero variance") {
    super("REASON_REQUIRED", m);
  }
}
export class CycleCountStatusInvalidError extends CycleCountCommandError {
  constructor(m: string) {
    super("STATUS_INVALID", m);
  }
}
export class CycleCountIdempotencyConflictError extends CycleCountCommandError {
  constructor(m = "idempotencyKey was already used for a different cycle count") {
    super("IDEMPOTENCY_CONFLICT", m);
  }
}
export class CycleCountMalformedStoredRecordError extends CycleCountCommandError {
  constructor(m: string) {
    super("MALFORMED_STORED_RECORD", m);
  }
}
export class CycleCountIntegrityError extends CycleCountCommandError {
  constructor(m = "the cycle count could not be completed due to a transient integrity error") {
    super("CYCLE_COUNT_INTEGRITY", m);
  }
}
