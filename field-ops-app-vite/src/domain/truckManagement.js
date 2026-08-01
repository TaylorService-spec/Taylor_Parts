// EI Truck Registry (ADR-010 / Decision #60) -- PURE domain for the Truck Management
// UI. No React, no firebase: directly node-testable. It owns the governed option sets,
// the sanitized error-outcome mapping, the raw-registry-doc projection the Manage
// drawer needs (current governed ids + version for optimistic concurrency), and the
// client-side create pre-validation that mirrors the backend's validateCreateInput.
//
// The eight trusted commands (truckRegistryCommandClient.js) are the ONLY write path.
// This module never writes and never fabricates a generic "update" -- it just shapes
// inputs for, and normalizes outcomes from, those eight callables.

// Governed truck statuses -- MUST be explicitly selected (never inferred). Mirrors
// functions/src/truckRegistry/types.ts TRUCK_STATUSES.
export const TRUCK_STATUS_OPTIONS = Object.freeze(["ACTIVE", "IDLE", "OUT_OF_SERVICE"]);
// Reactivation may only target an operational status (mirrors REACTIVATION_STATUSES).
export const REACTIVATION_TARGET_OPTIONS = Object.freeze(["ACTIVE", "IDLE"]);
export const DEACTIVATED_STATUS = "OUT_OF_SERVICE";

const STATUS_LABELS = Object.freeze({
  ACTIVE: "Active",
  IDLE: "Idle",
  OUT_OF_SERVICE: "Out of service",
});
export const truckStatusLabel = (status) => STATUS_LABELS[status] ?? "Unavailable";

// The sanitized outcome kinds the UI acts on. NEVER a raw backend message.
export const TRUCK_COMMAND_OUTCOME = Object.freeze({
  OK: "ok",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  CONFLICT: "conflict", // version/idempotency -> reload-required
  INVALID: "invalid",
  FAILURE: "failure",
});

// Fixed, generic per-kind client messages. These are the ONLY strings the UI shows for
// a failed command -- the raw HttpsError/FunctionsError message (which may embed
// internal ids/versions) is never surfaced.
const OUTCOME_MESSAGE = Object.freeze({
  [TRUCK_COMMAND_OUTCOME.DENIED]: "You are not authorized to perform this action.",
  [TRUCK_COMMAND_OUTCOME.UNAVAILABLE]: "Truck management is temporarily unavailable. Please try again shortly.",
  [TRUCK_COMMAND_OUTCOME.CONFLICT]: "This truck changed since you loaded it. Reload and retry.",
  [TRUCK_COMMAND_OUTCOME.INVALID]: "That change can’t be completed as requested. Check the details and try again.",
  [TRUCK_COMMAND_OUTCOME.FAILURE]: "Something went wrong. Please try again.",
});

// Normalize a thrown callable error to a stable code suffix. Firebase Functions throws
// a FunctionsError whose `.code` is like "functions/permission-denied"; Firestore uses
// "permission-denied". We key off the final path segment and never read `.message`.
function normalizedCode(err) {
  const raw = err && typeof err === "object" && typeof err.code === "string" ? err.code : "";
  const seg = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  return seg.toLowerCase();
}

const CODE_TO_KIND = Object.freeze({
  unauthenticated: TRUCK_COMMAND_OUTCOME.DENIED,
  "permission-denied": TRUCK_COMMAND_OUTCOME.DENIED,
  aborted: TRUCK_COMMAND_OUTCOME.CONFLICT,
  "invalid-argument": TRUCK_COMMAND_OUTCOME.INVALID,
  "failed-precondition": TRUCK_COMMAND_OUTCOME.INVALID,
  "not-found": TRUCK_COMMAND_OUTCOME.INVALID,
  "already-exists": TRUCK_COMMAND_OUTCOME.INVALID,
  unavailable: TRUCK_COMMAND_OUTCOME.UNAVAILABLE,
  "deadline-exceeded": TRUCK_COMMAND_OUTCOME.UNAVAILABLE,
});

// Map a thrown callable error to a sanitized { kind, message }. Unknown/undefined codes
// and transport failures collapse to a generic FAILURE. The returned message is ALWAYS
// one of the fixed OUTCOME_MESSAGE strings -- proven by tests that pass a raw error whose
// `.message` contains sensitive text and assert it never appears in the result.
export function mapTruckCommandError(err) {
  const kind = CODE_TO_KIND[normalizedCode(err)] ?? TRUCK_COMMAND_OUTCOME.FAILURE;
  return { kind, message: OUTCOME_MESSAGE[kind] };
}

// A generic sanitized failure outcome (used when readiness is off or a client seam is
// missing/throws before any callable is reached).
export function blockedOutcome(kind = TRUCK_COMMAND_OUTCOME.UNAVAILABLE) {
  return { kind, message: OUTCOME_MESSAGE[kind] ?? OUTCOME_MESSAGE[TRUCK_COMMAND_OUTCOME.FAILURE] };
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isInteger = (v) => typeof v === "number" && Number.isInteger(v);

// Pure projection of the raw `trucks` registry docs into the governed management shape
// the Manage drawer needs: current status, home warehouse, assigned driver, and the
// VERSION for optimistic concurrency (expectedVersion). Fail-closed: a doc missing a
// usable id or an integer version is skipped (never a management row with an unknown
// version, which would make a CAS write unsafe). `docId` is authoritative over any
// stored id, matching truckRegistryQueries' {docId,data} contract.
export function projectManagementRecords(truckDocs) {
  if (!Array.isArray(truckDocs)) return [];
  const out = [];
  for (const entry of truckDocs) {
    const docId = entry && typeof entry === "object" ? entry.docId : undefined;
    const data = entry && typeof entry === "object" && entry.data && typeof entry.data === "object" ? entry.data : null;
    if (!isNonEmptyString(docId) || !data || !isInteger(data.version)) continue;
    const status = TRUCK_STATUS_OPTIONS.includes(data.status) ? data.status : null;
    out.push({
      truckId: docId,
      version: data.version,
      status,
      homeWarehouseId: isNonEmptyString(data.homeWarehouseId) ? data.homeWarehouseId : null,
      assignedDriverEmployeeId: isNonEmptyString(data.assignedDriverEmployeeId) ? data.assignedDriverEmployeeId : null,
      displayLabel: isNonEmptyString(data.displayLabel) ? data.displayLabel : null,
      vehicleNumber: isNonEmptyString(data.vehicleNumber) ? data.vehicleNumber : null,
    });
  }
  return out;
}

// Build a Map<truckId, record> for O(1) drawer lookup.
export function indexManagementRecords(records) {
  const map = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (isNonEmptyString(r?.truckId)) map.set(r.truckId, r);
  }
  return map;
}

// Client-side pre-validation for Create Truck. Mirrors the backend's required-field
// contract (truckId, locationId, homeWarehouseId, displayLabel, vehicleNumber all
// non-empty; status an explicit governed value). This is a UX guard only -- the trusted
// service re-validates authoritatively -- so it never relaxes the backend rule.
export const CREATE_REQUIRED_FIELDS = Object.freeze([
  "truckId",
  "locationId",
  "homeWarehouseId",
  "displayLabel",
  "vehicleNumber",
]);

export function validateCreateInput(input) {
  const src = input && typeof input === "object" ? input : {};
  const errors = {};
  for (const field of CREATE_REQUIRED_FIELDS) {
    if (!isNonEmptyString(src[field])) errors[field] = "Required.";
  }
  if (!TRUCK_STATUS_OPTIONS.includes(src.status)) errors.status = "Select a status.";
  const ok = Object.keys(errors).length === 0;
  const value = ok
    ? {
        truckId: src.truckId.trim(),
        locationId: src.locationId.trim(),
        homeWarehouseId: src.homeWarehouseId.trim(),
        displayLabel: src.displayLabel.trim(),
        vehicleNumber: src.vehicleNumber.trim(),
        status: src.status,
        assignedDriverEmployeeId: isNonEmptyString(src.assignedDriverEmployeeId) ? src.assignedDriverEmployeeId : null,
      }
    : null;
  return { ok, errors, value };
}

// Idempotency-key factory seam. Every command carries an idempotencyKey so a retried
// submit collapses to the same governed mutation. Injectable so tests are deterministic;
// the default uses crypto.randomUUID when available with a sufficiently-unique fallback.
export function makeIdempotencyKey() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `tmui_${c.randomUUID()}`;
  // Fallback: time + two random segments (browser only; never reached under crypto).
  return `tmui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}
