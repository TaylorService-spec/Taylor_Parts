"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORWARD_STATUS_ORDER = exports.TRIGGER_EFFECT = exports.TRIGGER_STATES = void 0;
exports.lifecycleEvidenceFor = lifecycleEvidenceFor;
exports.detectWorkOrderInventoryEffects = detectWorkOrderInventoryEffects;
exports.detectBatchInventoryEffects = detectBatchInventoryEffects;
exports.TRIGGER_STATES = [
    "DISPATCHED",
    "COMPLETED",
    "CANCELLED",
];
exports.TRIGGER_EFFECT = {
    DISPATCHED: "RESERVE",
    COMPLETED: "CONSUME_AND_FINALIZE",
    CANCELLED: "RELEASE",
};
// ---------------------------------------------------------------------------
// Lifecycle evidence
// ---------------------------------------------------------------------------
// Forward chain of the approved Work Order lifecycle (transitionEngine.ts
// TRANSITIONS). Kept as an explicit ordered list here so the detector stays
// standalone-pure; the unit tests assert this array agrees with the
// transition table, so drift fails the build rather than misclassifying.
exports.FORWARD_STATUS_ORDER = [
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
];
const KNOWN_STATUSES = new Set([
    ...exports.FORWARD_STATUS_ORDER,
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
];
function isPresent(value) {
    return value !== undefined && value !== null;
}
function timestampPresent(wo, field) {
    const ts = wo.executionTimestamps;
    if (ts === null || typeof ts !== "object")
        return false;
    return isPresent(ts[field]);
}
function statusAtOrAfter(status, state) {
    if (status === null)
        return false;
    const statusIdx = exports.FORWARD_STATUS_ORDER.indexOf(status);
    if (statusIdx === -1)
        return false; // CANCELLED or unknown: no forward-chain position
    const stateIdx = exports.FORWARD_STATUS_ORDER.indexOf(state);
    return statusIdx >= stateIdx;
}
/**
 * Strongest lifecycle evidence that the Work Order reached `state`, in the
 * fixed strength order TIMESTAMP > STATUS > IMPLIED_BY_LATER > NONE.
 * (Immutable timestamps outrank current status -- status can advance past a
 * state, but a written execution timestamp can never be unwritten.)
 */
function lifecycleEvidenceFor(wo, state, knownStatus) {
    switch (state) {
        case "DISPATCHED": {
            if (timestampPresent(wo, "dispatchedAt"))
                return "TIMESTAMP";
            if (statusAtOrAfter(knownStatus, "DISPATCHED"))
                return "STATUS";
            if (LATER_THAN_DISPATCH_TIMESTAMPS.some((f) => timestampPresent(wo, f))) {
                return "IMPLIED_BY_LATER";
            }
            return "NONE";
        }
        case "COMPLETED": {
            if (timestampPresent(wo, "completedAt"))
                return "TIMESTAMP";
            if (statusAtOrAfter(knownStatus, "COMPLETED"))
                return "STATUS";
            return "NONE"; // nothing later than completedAt is usable (closedAt is ambiguous)
        }
        case "CANCELLED": {
            // Cancel has no dedicated immutable timestamp (it reuses closedAt,
            // which Close also writes) -- the terminal status is the only evidence.
            return knownStatus === "CANCELLED" ? "STATUS" : "NONE";
        }
    }
}
function markerEvidenceFor(sync, state) {
    const out = {
        processedMarker: false,
        processedMalformed: false,
        failureRecorded: false,
        failureMalformed: false,
        retryNeeded: false,
    };
    if (!sync.exists)
        return out;
    const processed = sync.processedStates;
    if (processed !== null && processed !== undefined && typeof processed === "object") {
        if (state in processed) {
            if (processed[state] === true)
                out.processedMarker = true;
            else
                out.processedMalformed = true; // present but not the canonical literal true
        }
    }
    const failures = sync.failures;
    if (failures !== null && failures !== undefined && typeof failures === "object") {
        if (state in failures) {
            const entry = failures[state];
            if (entry !== null && typeof entry === "object") {
                out.failureRecorded = true;
                out.retryNeeded = entry.retryNeeded === true;
            }
            else {
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
function classifyItem(workOrderId, state, wo, sync, knownStatus) {
    const marker = markerEvidenceFor(sync, state);
    const lifecycle = lifecycleEvidenceFor(wo, state, knownStatus);
    const warnings = [];
    if (marker.processedMalformed)
        warnings.push("PROCESSED_MARKER_MALFORMED");
    if (marker.failureMalformed)
        warnings.push("FAILURE_ENTRY_MALFORMED");
    const finalizedFlag = state === "COMPLETED" ? sync.finalized === true : null;
    let classification;
    let reasonCode;
    if (marker.processedMarker) {
        classification = "PROCESSED";
        reasonCode = "PROCESSED_MARKER_PRESENT";
        if (marker.failureRecorded) {
            // markStateProcessed() deletes the state's failure entry in the same
            // merge write -- both present should be impossible in current code.
            warnings.push("PROCESSED_AND_FAILURE_CONFLICT");
        }
    }
    else if (marker.failureRecorded && marker.retryNeeded) {
        classification = "RECORDED_FAILURE";
        reasonCode = "RETRY_NEEDED_FAILURE_RECORDED";
    }
    else if (lifecycle !== "NONE") {
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
    }
    else {
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
    const retryCandidate = classification === "RECORDED_FAILURE" || classification === "SILENT_MISS";
    const operatorReviewRequired = classification === "SILENT_MISS" || warnings.length > 0;
    return {
        workOrderId,
        state,
        effect: exports.TRIGGER_EFFECT[state],
        classification,
        reasonCode,
        evidence: {
            processedMarker: marker.processedMarker,
            failureRecorded: marker.failureRecorded,
            retryNeeded: marker.retryNeeded,
            lifecycleEvidence: lifecycle,
            finalizedFlag,
            inventorySnapshotItemCount: typeof wo.inventorySnapshotItemCount === "number"
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
function detectWorkOrderInventoryEffects(workOrder, syncStatus) {
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
    if (syncStatus === null ||
        typeof syncStatus !== "object" ||
        typeof syncStatus.exists !== "boolean") {
        return {
            valid: false,
            reasonCode: "INVALID_INPUT_SHAPE",
            message: "syncStatus input must be an object with a boolean `exists`",
            workOrderId: workOrder.workOrderId,
        };
    }
    const woWarnings = [];
    // Status normalization: only known lifecycle statuses participate in
    // evidence derivation; anything else is warned and ignored (immutable
    // timestamps still work, so legacy/malformed statuses degrade safely).
    let knownStatus = null;
    if (workOrder.status === undefined || workOrder.status === null) {
        woWarnings.push("STATUS_ABSENT");
    }
    else if (typeof workOrder.status === "string" && KNOWN_STATUSES.has(workOrder.status)) {
        knownStatus = workOrder.status;
    }
    else {
        woWarnings.push("UNKNOWN_STATUS_VALUE");
    }
    // Unrecognized marker keys (current code never writes non-trigger states
    // into either map -- see inventoryService.ts STATE_TRIGGERS comment).
    const triggerSet = new Set(exports.TRIGGER_STATES);
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
    const items = exports.TRIGGER_STATES.map((state) => classifyItem(workOrder.workOrderId, state, workOrder, syncStatus, knownStatus));
    // Degraded status evidence means expectations may be under-derived --
    // require operator review on every item that came out NOT_EXPECTED, since
    // "not expected" may only mean "could not tell".
    if (woWarnings.includes("UNKNOWN_STATUS_VALUE") || woWarnings.includes("STATUS_ABSENT")) {
        for (const item of items) {
            if (item.classification === "NOT_EXPECTED")
                item.operatorReviewRequired = true;
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
function detectBatchInventoryEffects(entries) {
    return entries.map((e) => detectWorkOrderInventoryEffects(e === null || typeof e !== "object" ? null : e.workOrder, e === null || typeof e !== "object"
        ? null
        : e.syncStatus));
}
//# sourceMappingURL=inventoryEffectDetection.js.map