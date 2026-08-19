// Enterprise Inventory -- Cycle Count operating authority: PURE request builders for the cycle count
// command family (functions/src/cycleCount/cycleCountCallables.ts). No Firebase, no I/O;
// Node-importable and unit-testable. Mirrors domain/transferCommandRequest.js's validate-then-build
// shape and idempotency-key factory convention.
//
// Endpoint fence: WAREHOUSE + MOBILE(truck) only, matching the backend's scope.

const ENDPOINT_TYPES = new Set(["WAREHOUSE", "MOBILE"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
function isNonNegativeInteger(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function makeIdempotencyKey() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `cyc_${c.randomUUID()}`;
  return `cyc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

// Validate + normalize a New Cycle Count form draft into the EXACT createCycleCount request shape.
// `draft`: { partId, locationType, locationId }. Returns { ok, errors, value }.
export function buildCreateCycleCountRequest(draft, { idempotencyKey } = {}) {
  const errors = {};
  const src = draft && typeof draft === "object" ? draft : {};

  if (!isNonEmptyString(src.partId)) errors.partId = "Part is required.";
  if (!ENDPOINT_TYPES.has(src.locationType)) errors.locationType = "Location type must be a warehouse or a truck.";
  if (!isNonEmptyString(src.locationId)) errors.locationId = "Location is required.";

  const key = isNonEmptyString(idempotencyKey) ? idempotencyKey : makeIdempotencyKey();
  if (Object.keys(errors).length > 0) return { ok: false, errors, value: null };

  return {
    ok: true,
    errors: {},
    value: {
      partId: src.partId.trim(),
      location: { type: src.locationType, locationId: src.locationId },
      idempotencyKey: key,
    },
  };
}

// Validate + normalize a submit-count draft. `trackingMode` decides which shape is required.
// NONE: { cycleCountId, countedQuantity }. SERIAL: { cycleCountId, countedSerialNumbers: string[] }.
export function buildSubmitCycleCountRequest(cycleCountId, trackingMode, draft) {
  if (!isNonEmptyString(cycleCountId)) return { ok: false, errors: { cycleCountId: "Missing cycle count." }, value: null };
  const errors = {};
  const src = draft && typeof draft === "object" ? draft : {};

  if (trackingMode === "SERIAL") {
    const serials = Array.isArray(src.countedSerialNumbers) ? src.countedSerialNumbers.filter((s) => isNonEmptyString(s)) : [];
    if (new Set(serials).size !== serials.length) errors.countedSerialNumbers = "Counted serial numbers must be unique.";
    if (Object.keys(errors).length > 0) return { ok: false, errors, value: null };
    return { ok: true, errors: {}, value: { cycleCountId, countedSerialNumbers: serials } };
  }

  const countedQuantity = typeof src.countedQuantity === "string" ? Number(src.countedQuantity) : src.countedQuantity;
  if (!isNonNegativeInteger(countedQuantity)) errors.countedQuantity = "Counted quantity must be a whole number, zero or greater.";
  if (Object.keys(errors).length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: {}, value: { cycleCountId, countedQuantity } };
}

const REVIEW_DECISIONS = new Set(["APPROVE", "REJECT"]);

// Reconcile: { cycleCountId, reason?, decision }. `decision` is the M23 manager-review step -- APPROVE
// (the pre-M23 default meaning of "reconcile": stage the ADJUSTED ledger correction) or REJECT (record
// the count as disputed, no ledger effect). A reason is required by the SERVER only when there is a
// non-zero variance -- this builder does not pre-empt that decision, it just shapes what was typed.
export function buildReconcileCycleCountRequest(cycleCountId, reasonText, decision = "APPROVE") {
  if (!isNonEmptyString(cycleCountId)) return { ok: false, value: null };
  if (!REVIEW_DECISIONS.has(decision)) return { ok: false, value: null };
  const reason = typeof reasonText === "string" && reasonText.trim() !== "" ? reasonText.trim() : undefined;
  return { ok: true, value: { cycleCountId, decision, ...(reason ? { reason } : {}) } };
}

// The cycleCountId-only request (cancel) shares one exact shape.
export function buildCycleCountIdOnlyRequest(cycleCountId) {
  if (!isNonEmptyString(cycleCountId)) return { ok: false, value: null };
  return { ok: true, value: { cycleCountId } };
}
