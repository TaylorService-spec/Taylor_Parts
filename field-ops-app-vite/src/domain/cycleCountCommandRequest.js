// Cycle Count -- PURE request builders for the A1 sheet/line callables. No Firebase, no I/O.
//
// Validation here is for the operator's benefit (say what is wrong before a round trip); the server
// re-validates everything and is the authority. Nothing here ever carries an expected quantity, a
// variance or a materiality decision -- those are server-derived.

// BIN since BIN-P7: a Bin is an admissible SHAPE; whether it may be counted is the server's
// conversion-gated eligibility policy.
const LOCATION_TYPES = new Set(["WAREHOUSE", "MOBILE", "BIN"]);
const REVIEW_DECISIONS = new Set(["APPROVE", "REJECT"]);

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isNonNegativeInteger = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;

export function makeIdempotencyKey() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `ccs_${c.randomUUID()}`;
  return `ccs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

/** A sheet is one governed location. It names no Part: Parts become lines as they are counted. */
export function buildCreateSheetRequest(draft, { idempotencyKey } = {}) {
  const src = draft && typeof draft === "object" ? draft : {};
  const errors = {};
  if (!LOCATION_TYPES.has(src.locationType)) errors.locationType = "Choose a warehouse, a bin or a truck.";
  if (!isNonEmptyString(src.locationId)) errors.locationId = "Location is required.";
  if (Object.keys(errors).length > 0) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: {},
    value: {
      location: { type: src.locationType, locationId: src.locationId.trim() },
      idempotencyKey: isNonEmptyString(idempotencyKey) ? idempotencyKey : makeIdempotencyKey(),
    },
  };
}

export function buildLineRequest(sheetId, partId) {
  if (!isNonEmptyString(sheetId) || !isNonEmptyString(partId)) return { ok: false, value: null };
  return { ok: true, value: { sheetId, partId } };
}

export function buildSheetRequest(sheetId) {
  if (!isNonEmptyString(sheetId)) return { ok: false, value: null };
  return { ok: true, value: { sheetId } };
}

/** The observed count for ONE line: a quantity (zero is a real count), or the list of serials seen. */
export function buildSubmitLineRequest(sheetId, partId, trackingMode, draft) {
  if (!isNonEmptyString(sheetId) || !isNonEmptyString(partId)) return { ok: false, errors: { line: "Missing line." }, value: null };
  const src = draft && typeof draft === "object" ? draft : {};
  if (trackingMode === "SERIAL") {
    const serials = Array.isArray(src.countedSerialNumbers) ? src.countedSerialNumbers.filter(isNonEmptyString).map((s) => s.trim()) : [];
    if (new Set(serials).size !== serials.length) return { ok: false, errors: { countedSerialNumbers: "Counted serial numbers must be unique." }, value: null };
    return { ok: true, errors: {}, value: { sheetId, partId, countedSerialNumbers: serials } };
  }
  const q = typeof src.countedQuantity === "string" ? Number(src.countedQuantity) : src.countedQuantity;
  if (!isNonNegativeInteger(q)) return { ok: false, errors: { countedQuantity: "Counted quantity must be a whole number, zero or greater." }, value: null };
  return { ok: true, errors: {}, value: { sheetId, partId, countedQuantity: q } };
}

export function buildReconcileLineRequest(sheetId, partId, reasonText, decision = "APPROVE") {
  if (!isNonEmptyString(sheetId) || !isNonEmptyString(partId) || !REVIEW_DECISIONS.has(decision)) return { ok: false, value: null };
  const reason = isNonEmptyString(reasonText) ? reasonText.trim() : undefined;
  return { ok: true, value: { sheetId, partId, decision, ...(reason ? { reason } : {}) } };
}
