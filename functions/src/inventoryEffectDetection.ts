// INV-1 Phase 0, PR 0.1 -- pure inventory-effect detection engine.
//
// Governing chain: docs/implementation-plans/enterprise-inventory-architecture.md
// (Phase 0), adopted per docs/DECISIONS.md #37. This module DETECTS missing
// Work Order inventory effects; it never executes, retries, reads, or writes
// anything. PR 0.2's operator tooling maps Firestore documents into this
// module's plain-data inputs and acts on its output under separate Owner
// gates (Gate 0.4a/0.4b).
//
// Purity contract (load-bearing):
// - No firebase-admin import (not even types). Inputs are plain data
//   projections of fieldops_wos / inventory_sync_status documents.
// - No Firestore access, no wall clock, no global mutable state.
// - Deterministic: same inputs, same output, always.
// - Never throws on legacy-data omissions -- malformed input produces a
//   typed validation result, ambiguous evidence produces warnings.
//
// Effect model (mirrors functions/src/inventoryService.ts STATE_TRIGGERS --
// verified against the current implementation, not invented):
//   DISPATCHED -> reserveParts            (ledger RESERVED entries)
//   COMPLETED  -> consumeParts + finalize (ledger CONSUMED + finalized flag)
//   CANCELLED  -> releaseParts            (ledger RELEASED entries)
// triggerInventoryEffects() marks inventory_sync_status.processedStates[state]
// = true on success and records failures[state] = { error, at,
// retryNeeded: true } on failure; a crash between the Work Order transition
// commit and the post-commit trigger leaves NO marker at all (the silent-miss
// class this detector exists to find).
//
// Evidence semantics (mirrors functions/src/transitionEngine.ts
// ACTION_TIMESTAMP_FIELD and functions/src/types/workOrder.ts):
// - dispatchedAt/acceptedAt/enRouteAt/arrivedAt/workStartedAt/completedAt are
//   immutable execution timestamps written only by transitionWorkOrder().
// - closedAt is AMBIGUOUS: Close and Cancel both write it. It is therefore
//   never used as lifecycle evidence by this detector.
// - CANCELLED has no dedicated timestamp; its only evidence is the terminal
//   status itself.

import type { WorkOrderStatus } from "./types/workOrder";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type TriggerState = "DISPATCHED" | "COMPLETED" | "CANCELLED";

export const TRIGGER_STATES: readonly TriggerState[] = [
  "DISPATCHED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type InventoryEffect = "RESERVE" | "CONSUME_AND_FINALIZE" | "RELEASE";

export const TRIGGER_EFFECT: Record<TriggerState, InventoryEffect> = {
  DISPATCHED: "RESERVE",
  COMPLETED: "CONSUME_AND_FINALIZE",
  CANCELLED: "RELEASE",
};

export type EffectClassification =
  | "PROCESSED"
  | "RECORDED_FAILURE"
  | "SILENT_MISS"
  | "NOT_EXPECTED";

// Stable machine-readable reason codes -- one per item, the single
// classification driver. Warnings (below) carry anomalies that do NOT
// change the classification.
export type ReasonCode =
  | "PROCESSED_MARKER_PRESENT" // processedStates[state] === true
  | "RETRY_NEEDED_FAILURE_RECORDED" // failures[state].retryNeeded === true
  | "EXPECTED_BY_TIMESTAMP_NO_MARKER" // own immutable timestamp present, no marker
  | "EXPECTED_BY_STATUS_NO_MARKER" // current status proves state reached, no marker
  | "EXPECTED_BY_LATER_EVIDENCE_NO_MARKER" // later execution timestamp implies state passed, no marker
  | "LIFECYCLE_EVIDENCE_ABSENT"; // no evidence the state was ever reached

export type WarningCode =
  | "PROCESSED_AND_FAILURE_CONFLICT" // both markers present (markStateProcessed deletes failures -- should be impossible)
  | "FAILURE_WITHOUT_RETRY_FLAG" // failures[state] exists but retryNeeded !== true
  | "FAILURE_ENTRY_MALFORMED" // failures[state] present but not an object
  | "PROCESSED_MARKER_MALFORMED" // processedStates[state] present but not exactly true
  | "FINALIZED_FLAG_MISSING" // COMPLETED processed but finalized !== true
  | "FINALIZED_WITHOUT_PROCESSED_MARKER" // finalized === true but COMPLETED not processed
  | "UNKNOWN_STATUS_VALUE" // status is not a known WorkOrderStatus
  | "STATUS_ABSENT" // status missing entirely (legacy)
  | "SYNC_STATUS_ABSENT" // no inventory_sync_status doc while >=1 effect expected
  | "UNRECOGNIZED_PROCESSED_STATE_KEY" // processedStates key outside the 3 trigger states
  | "UNRECOGNIZED_FAILURE_STATE_KEY"; // failures key outside the 3 trigger states

export type LifecycleEvidenceSource =
  | "TIMESTAMP" // the state's own immutable timestamp
  | "STATUS" // current status at/after the state on the forward chain
  | "IMPLIED_BY_LATER" // a later immutable execution timestamp
  | "NONE";

// ---------------------------------------------------------------------------
// Input model -- plain-data projections mapped by the caller (PR 0.2).
// All fields tolerate absence/unknown shapes; only documented semantics are
// trusted. Timestamp fields are presence-only: any non-null, non-undefined
// value counts as "present" (the detector never interprets time values, so
// it has no wall-clock or Timestamp-type dependency).
// ---------------------------------------------------------------------------

export interface WorkOrderEvidenceInput {
  workOrderId: string;
  /** Current fieldops_wos status. Unknown/absent values are tolerated (warned). */
  status?: unknown;
  /** Immutable execution timestamps (presence-only). closedAt is accepted but never used as evidence (ambiguous: Close and Cancel both write it). */
  executionTimestamps?: {
    dispatchedAt?: unknown;
    acceptedAt?: unknown;
    enRouteAt?: unknown;
    arrivedAt?: unknown;
    workStartedAt?: unknown;
    completedAt?: unknown;
    closedAt?: unknown;
  } | null;
  /** Descriptive only -- NEVER changes effect expectation (triggerInventoryEffects marks a state processed even for empty snapshots). Surfaced in evidence for operator context. */
  inventorySnapshotItemCount?: number | null;
}

export interface SyncStatusEvidenceInput {
  /** Whether an inventory_sync_status/{workOrderId} document exists at all. */
  exists: boolean;
  processedStates?: Record<string, unknown> | null;
  failures?: Record<string, unknown> | null;
  finalized?: unknown;
}

// ---------------------------------------------------------------------------
// Output contract
// ---------------------------------------------------------------------------

export interface EffectEvidenceSummary {
  processedMarker: boolean; // processedStates[state] === true
  failureRecorded: boolean; // failures[state] is an object
  retryNeeded: boolean; // failures[state].retryNeeded === true
  lifecycleEvidence: LifecycleEvidenceSource;
  /** Only meaningful for COMPLETED; null for the other states. */
  finalizedFlag: boolean | null;
  /** Pass-through operator context; null when the caller did not project it. */
  inventorySnapshotItemCount: number | null;
}

export interface EffectDetectionItem {
  workOrderId: string;
  state: TriggerState;
  effect: InventoryEffect;
  classification: EffectClassification;
  reasonCode: ReasonCode;
  evidence: EffectEvidenceSummary;
  /** True when re-invoking triggerInventoryEffects(workOrderId, state) is the documented remediation (RECORDED_FAILURE, SILENT_MISS). Execution is PR 0.2 / Gate 0.4b -- never this module. */
  retryCandidate: boolean;
  /** True when a human must look before any action: every SILENT_MISS, and any item carrying a warning. */
  operatorReviewRequired: boolean;
  warnings: WarningCode[];
}

export interface WorkOrderDetectionResult {
  valid: true;
  workOrderId: string;
  /** Exactly one item per trigger state, in TRIGGER_STATES order. */
  items: EffectDetectionItem[];
  /** Work-Order-level warnings (unknown status, unrecognized marker keys, absent sync doc). */
  warnings: WarningCode[];
}

export interface DetectionValidationError {
  valid: false;
  reasonCode: "INVALID_WORK_ORDER_ID" | "INVALID_INPUT_SHAPE";
  message: string;
  workOrderId: string | null;
}

export type DetectionOutcome = WorkOrderDetectionResult | DetectionValidationError;

// ---------------------------------------------------------------------------
// Lifecycle evidence
// ---------------------------------------------------------------------------

// Forward chain of the approved Work Order lifecycle (transitionEngine.ts
// TRANSITIONS). Kept as an explicit ordered list here so the detector stays
// standalone-pure; the unit tests assert this array agrees with the
// transition table, so drift fails the build rather than misclassifying.
export const FORWARD_STATUS_ORDER: readonly WorkOrderStatus[] = [
  "CREATED",
  "READY_TO_DISPATCH",
  "SCHEDULED",
  "DISPATCHED",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "WORK_IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
] as const;

const KNOWN_STATUSES: ReadonlySet<string> = new Set<string>([
  ...FORWARD_STATUS_ORDER,
  "CANCELLED",
]);

// Timestamps that prove execution progressed past DISPATCHED even when
// dispatchedAt itself is missing (legacy records). Ordered; closedAt is
// deliberately excluded everywhere (Cancel writes it too).
const LATER_THAN_DISPATCH_TIMESTAMPS = [
  "acceptedAt",
  "enRouteAt",
  "arrivedAt",
  "workStartedAt",
  "completedAt",
] as const;

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function timestampPresent(
  wo: WorkOrderEvidenceInput,
  field: (typeof LATER_THAN_DISPATCH_TIMESTAMPS)[number] | "dispatchedAt"
): boolean {
  const ts = wo.executionTimestamps;
  if (ts === null || typeof ts !== "object") return false;
  return isPresent((ts as Record<string, unknown>)[field]);
}

function statusAtOrAfter(status: string | null, state: "DISPATCHED" | "COMPLETED"): boolean {
  if (status === null) return false;
  const statusIdx = FORWARD_STATUS_ORDER.indexOf(status as WorkOrderStatus);
  if (statusIdx === -1) return false; // CANCELLED or unknown: no forward-chain position
  const stateIdx = FORWARD_STATUS_ORDER.indexOf(state);
  return statusIdx >= stateIdx;
}

/**
 * Strongest lifecycle evidence that the Work Order reached `state`, in the
 * fixed strength order TIMESTAMP > STATUS > IMPLIED_BY_LATER > NONE.
 * (Immutable timestamps outrank current status -- status can advance past a
 * state, but a written execution timestamp can never be unwritten.)
 */
export function lifecycleEvidenceFor(
  wo: WorkOrderEvidenceInput,
  state: TriggerState,
  knownStatus: string | null
): LifecycleEvidenceSource {
  switch (state) {
    case "DISPATCHED": {
      if (timestampPresent(wo, "dispatchedAt")) return "TIMESTAMP";
      if (statusAtOrAfter(knownStatus, "DISPATCHED")) return "STATUS";
      if (LATER_THAN_DISPATCH_TIMESTAMPS.some((f) => timestampPresent(wo, f))) {
        return "IMPLIED_BY_LATER";
      }
      return "NONE";
    }
    case "COMPLETED": {
      if (timestampPresent(wo, "completedAt")) return "TIMESTAMP";
      if (statusAtOrAfter(knownStatus, "COMPLETED")) return "STATUS";
      return "NONE"; // nothing later than completedAt is usable (closedAt is ambiguous)
    }
    case "CANCELLED": {
      // Cancel has no dedicated immutable timestamp (it reuses closedAt,
      // which Close also writes) -- the terminal status is the only evidence.
      return knownStatus === "CANCELLED" ? "STATUS" : "NONE";
    }
  }
}

// ---------------------------------------------------------------------------
// Marker evidence
// ---------------------------------------------------------------------------

interface MarkerEvidence {
  processedMarker: boolean;
  processedMalformed: boolean;
  failureRecorded: boolean;
  failureMalformed: boolean;
  retryNeeded: boolean;
}

function markerEvidenceFor(sync: SyncStatusEvidenceInput, state: TriggerState): MarkerEvidence {
  const out: MarkerEvidence = {
    processedMarker: false,
    processedMalformed: false,
    failureRecorded: false,
    failureMalformed: false,
    retryNeeded: false,
  };
  if (!sync.exists) return out;

  const processed = sync.processedStates;
  if (processed !== null && processed !== undefined && typeof processed === "object") {
    if (state in processed) {
      if (processed[state] === true) out.processedMarker = true;
      else out.processedMalformed = true; // present but not the canonical literal true
    }
  }

  const failures = sync.failures;
  if (failures !== null && failures !== undefined && typeof failures === "object") {
    if (state in failures) {
      const entry = failures[state];
      if (entry !== null && typeof entry === "object") {
        out.failureRecorded = true;
        out.retryNeeded = (entry as Record<string, unknown>).retryNeeded === true;
      } else {
        out.failureMalformed = true;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Fail-safe precedence (Owner-approved, PR 0.1 authorization §5):
 *   1. canonical processed evidence          -> PROCESSED
 *   2. recorded retry-needed failure         -> RECORDED_FAILURE
 *   3. lifecycle evidence implying the state -> SILENT_MISS
 *   4. otherwise                             -> NOT_EXPECTED
 * A retry-needed failure outranks lifecycle evidence deliberately: the
 * failure record is direct proof the trigger ran and failed, valid even for
 * legacy Work Orders whose lifecycle evidence is incomplete.
 */
function classifyItem(
  workOrderId: string,
  state: TriggerState,
  wo: WorkOrderEvidenceInput,
  sync: SyncStatusEvidenceInput,
  knownStatus: string | null
): EffectDetectionItem {
  const marker = markerEvidenceFor(sync, state);
  const lifecycle = lifecycleEvidenceFor(wo, state, knownStatus);
  const warnings: WarningCode[] = [];

  if (marker.processedMalformed) warnings.push("PROCESSED_MARKER_MALFORMED");
  if (marker.failureMalformed) warnings.push("FAILURE_ENTRY_MALFORMED");

  const finalizedFlag = state === "COMPLETED" ? sync.finalized === true : null;

  let classification: EffectClassification;
  let reasonCode: ReasonCode;

  if (marker.processedMarker) {
    classification = "PROCESSED";
    reasonCode = "PROCESSED_MARKER_PRESENT";
    if (marker.failureRecorded) {
      // markStateProcessed() deletes the state's failure entry in the same
      // merge write -- both present should be impossible in current code.
      warnings.push("PROCESSED_AND_FAILURE_CONFLICT");
    }
  } else if (marker.failureRecorded && marker.retryNeeded) {
    classification = "RECORDED_FAILURE";
    reasonCode = "RETRY_NEEDED_FAILURE_RECORDED";
  } else if (lifecycle !== "NONE") {
    classification = "SILENT_MISS";
    reasonCode =
      lifecycle === "TIMESTAMP"
        ? "EXPECTED_BY_TIMESTAMP_NO_MARKER"
        : lifecycle === "STATUS"
          ? "EXPECTED_BY_STATUS_NO_MARKER"
          : "EXPECTED_BY_LATER_EVIDENCE_NO_MARKER";
    if (marker.failureRecorded && !marker.retryNeeded) {
      // A failure entry that lacks retryNeeded: true is not canonical
      // failure evidence (recordFailure() always writes the flag) -- fall
      // through to the lifecycle classification but flag the anomaly.
      warnings.push("FAILURE_WITHOUT_RETRY_FLAG");
    }
  } else {
    classification = "NOT_EXPECTED";
    reasonCode = "LIFECYCLE_EVIDENCE_ABSENT";
    if (marker.failureRecorded && !marker.retryNeeded) {
      warnings.push("FAILURE_WITHOUT_RETRY_FLAG");
    }
  }

  // COMPLETED finalize cross-checks (informational; never re-classify).
  if (state === "COMPLETED") {
    if (classification === "PROCESSED" && sync.finalized !== true) {
      warnings.push("FINALIZED_FLAG_MISSING");
    }
    if (classification !== "PROCESSED" && sync.finalized === true) {
      warnings.push("FINALIZED_WITHOUT_PROCESSED_MARKER");
    }
  }

  const retryCandidate =
    classification === "RECORDED_FAILURE" || classification === "SILENT_MISS";
  const operatorReviewRequired =
    classification === "SILENT_MISS" || warnings.length > 0;

  return {
    workOrderId,
    state,
    effect: TRIGGER_EFFECT[state],
    classification,
    reasonCode,
    evidence: {
      processedMarker: marker.processedMarker,
      failureRecorded: marker.failureRecorded,
      retryNeeded: marker.retryNeeded,
      lifecycleEvidence: lifecycle,
      finalizedFlag,
      inventorySnapshotItemCount:
        typeof wo.inventorySnapshotItemCount === "number"
          ? wo.inventorySnapshotItemCount
          : null,
    },
    retryCandidate,
    operatorReviewRequired,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Detect the classification of every inventory-effect state for one Work
 * Order. Pure and deterministic; never throws on data-shaped problems --
 * structurally invalid input returns a DetectionValidationError instead.
 */
export function detectWorkOrderInventoryEffects(
  workOrder: WorkOrderEvidenceInput,
  syncStatus: SyncStatusEvidenceInput
): DetectionOutcome {
  if (workOrder === null || typeof workOrder !== "object") {
    return {
      valid: false,
      reasonCode: "INVALID_INPUT_SHAPE",
      message: "workOrder input must be an object",
      workOrderId: null,
    };
  }
  if (typeof workOrder.workOrderId !== "string" || workOrder.workOrderId.length === 0) {
    return {
      valid: false,
      reasonCode: "INVALID_WORK_ORDER_ID",
      message: "workOrder.workOrderId must be a non-empty string",
      workOrderId: null,
    };
  }
  if (
    syncStatus === null ||
    typeof syncStatus !== "object" ||
    typeof syncStatus.exists !== "boolean"
  ) {
    return {
      valid: false,
      reasonCode: "INVALID_INPUT_SHAPE",
      message: "syncStatus input must be an object with a boolean `exists`",
      workOrderId: workOrder.workOrderId,
    };
  }

  const woWarnings: WarningCode[] = [];

  // Status normalization: only known lifecycle statuses participate in
  // evidence derivation; anything else is warned and ignored (immutable
  // timestamps still work, so legacy/malformed statuses degrade safely).
  let knownStatus: string | null = null;
  if (workOrder.status === undefined || workOrder.status === null) {
    woWarnings.push("STATUS_ABSENT");
  } else if (typeof workOrder.status === "string" && KNOWN_STATUSES.has(workOrder.status)) {
    knownStatus = workOrder.status;
  } else {
    woWarnings.push("UNKNOWN_STATUS_VALUE");
  }

  // Unrecognized marker keys (current code never writes non-trigger states
  // into either map -- see inventoryService.ts STATE_TRIGGERS comment).
  const triggerSet: ReadonlySet<string> = new Set(TRIGGER_STATES);
  const processed = syncStatus.processedStates;
  if (processed !== null && processed !== undefined && typeof processed === "object") {
    if (Object.keys(processed).some((k) => !triggerSet.has(k))) {
      woWarnings.push("UNRECOGNIZED_PROCESSED_STATE_KEY");
    }
  }
  const failures = syncStatus.failures;
  if (failures !== null && failures !== undefined && typeof failures === "object") {
    if (Object.keys(failures).some((k) => !triggerSet.has(k))) {
      woWarnings.push("UNRECOGNIZED_FAILURE_STATE_KEY");
    }
  }

  const items = TRIGGER_STATES.map((state) =>
    classifyItem(workOrder.workOrderId, state, workOrder, syncStatus, knownStatus)
  );

  // Degraded status evidence means expectations may be under-derived --
  // require operator review on every item that came out NOT_EXPECTED, since
  // "not expected" may only mean "could not tell".
  if (woWarnings.includes("UNKNOWN_STATUS_VALUE") || woWarnings.includes("STATUS_ABSENT")) {
    for (const item of items) {
      if (item.classification === "NOT_EXPECTED") item.operatorReviewRequired = true;
    }
  }

  if (!syncStatus.exists && items.some((i) => i.classification !== "NOT_EXPECTED")) {
    woWarnings.push("SYNC_STATUS_ABSENT");
  }

  return { valid: true, workOrderId: workOrder.workOrderId, items, warnings: woWarnings };
}

/**
 * Batch convenience wrapper: one outcome per entry, order preserved.
 * Entries are independent; an invalid entry yields its own validation
 * error without affecting the others.
 */
export function detectBatchInventoryEffects(
  entries: ReadonlyArray<{
    workOrder: WorkOrderEvidenceInput;
    syncStatus: SyncStatusEvidenceInput;
  }>
): DetectionOutcome[] {
  return entries.map((e) =>
    detectWorkOrderInventoryEffects(
      e === null || typeof e !== "object" ? (null as unknown as WorkOrderEvidenceInput) : e.workOrder,
      e === null || typeof e !== "object"
        ? (null as unknown as SyncStatusEvidenceInput)
        : e.syncStatus
    )
  );
}
