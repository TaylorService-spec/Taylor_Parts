// Enterprise Inventory -- EI Phase-2 Receiving, Phase A: pure first-slice Receiving Order VALIDATION.
// PURE and DETERMINISTIC: no Firebase, no persistence, no stock math. Validates the UNTRUSTED receive
// request against the injected authoritative context (Part authority + PO ordered quantity), producing
// the normalized PUTAWAY_COMPLETE / version-1 / single-NONE-line value. Server-authored fields (actor,
// timestamps, status, version) are FORBIDDEN in the input. Reuses the merged inventoryLedger validation
// helpers (validateLocationRef / isPlainObject / isNonEmptyString / isTrackingMode).

import {
  validateLocationRef,
  isPlainObject,
  isNonEmptyString,
  isTrackingMode,
} from "../inventoryLedger/operationalMovementValidation.js";
import {
  RECEIVING_SOURCE_TYPES,
  RECEIVING_INITIAL_VERSION,
  RECEIVING_SUPPORTED_TRACKING_MODES,
  RECEIVING_LINE_STATUS,
  type ReceivingLineTrackingMode,
  type ReceivingOrderValue,
  type ReceivingLineValue,
  type ReceivingAuthority,
  type ValidationResult,
} from "./receivingTypes.js";

function fail(reason: string): ValidationResult<ReceivingOrderValue> {
  return { valid: false, value: null, reason };
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// The ONLY keys the untrusted input may carry. Any server-authored / unknown field fails closed.
const ALLOWED_INPUT_KEYS = new Set(["source", "receivingLocation", "lines", "idempotencyKey"]);
const ALLOWED_SOURCE_KEYS = new Set(["type", "reorderRequestId", "purchaseOrderId"]);
// `serialNumbers` is permitted as a KEY here but is only LEGAL on a SERIAL line -- see the per-mode
// rules below, which reject it on a NONE line and require it on a SERIAL one. `lotId` and the
// server-authored fields (status/trackingMode/timestamps) remain rejected outright.
const ALLOWED_LINE_KEYS = new Set(["lineId", "partId", "expectedQuantity", "receivedQuantity", "serialNumbers"]);

// Validate a first-slice receive request. `authority` supplies the canonical Part (partId + trackingMode)
// and the authoritative PO orderedQuantity the single line is bound to. Returns the normalized value on
// success (status PUTAWAY_COMPLETE, version 1, one NONE line, status RECEIVED).
export function validateReceivingOrderInput(input: unknown, authority: unknown): ValidationResult<ReceivingOrderValue> {
  if (!isPlainObject(input)) return fail("not_object");
  if (Object.keys(input).some((k) => !ALLOWED_INPUT_KEYS.has(k))) return fail("unknown_field");

  // Injected authority (Part + ordered quantity). Not part of the untrusted input.
  if (!isPlainObject(authority)) return fail("authority_invalid");
  const part = authority.part;
  if (!isPlainObject(part) || !isNonEmptyString(part.partId)) return fail("part_invalid");
  if (!isTrackingMode(part.trackingMode)) return fail("tracking_mode_invalid");
  // NONE (original behavior) and SERIAL (Wave 7 Owner decision) are supported. LOT is deliberately not
  // in RECEIVING_SUPPORTED_TRACKING_MODES and still fails closed here.
  if (!(RECEIVING_SUPPORTED_TRACKING_MODES as readonly string[]).includes(part.trackingMode)) {
    return fail("tracking_mode_unsupported"); // LOT deferred
  }
  const trackingMode = part.trackingMode as ReceivingLineTrackingMode;
  if (!isFiniteNumber(authority.orderedQuantity) || authority.orderedQuantity <= 0) return fail("ordered_quantity_invalid");
  const orderedQuantity = authority.orderedQuantity;

  // Source (first slice: REORDER_PURCHASE_ORDER; purchaseOrderId == reorderRequestId).
  const source = input.source;
  if (!isPlainObject(source)) return fail("source_invalid");
  if (Object.keys(source).some((k) => !ALLOWED_SOURCE_KEYS.has(k))) return fail("source_invalid");
  if (typeof source.type !== "string" || !(RECEIVING_SOURCE_TYPES as readonly string[]).includes(source.type)) return fail("source_type_invalid");
  if (!isNonEmptyString(source.reorderRequestId)) return fail("reorder_request_id_invalid");
  if (!isNonEmptyString(source.purchaseOrderId)) return fail("purchase_order_id_invalid");
  if (source.purchaseOrderId !== source.reorderRequestId) return fail("source_identity_mismatch");

  // Destination (EI-P1a discriminated reference; reused from the ledger validator).
  const receivingLocation = validateLocationRef(input.receivingLocation);
  if (receivingLocation === null) return fail("receiving_location_invalid");

  // Exactly one line (reject empty / multiple).
  if (!Array.isArray(input.lines)) return fail("lines_invalid");
  if (input.lines.length !== 1) return fail("line_count_invalid");
  const line = input.lines[0];
  if (!isPlainObject(line)) return fail("line_invalid");
  if (Object.keys(line).some((k) => !ALLOWED_LINE_KEYS.has(k))) return fail("line_unknown_field"); // serialNo/lotId/status/trackingMode/server fields rejected
  if (!isNonEmptyString(line.lineId)) return fail("line_id_invalid");
  if (!isNonEmptyString(line.partId)) return fail("line_part_id_invalid");
  if (line.partId !== part.partId) return fail("part_mismatch");
  if (!isFiniteNumber(line.expectedQuantity) || !isFiniteNumber(line.receivedQuantity)) return fail("quantity_invalid");
  // Full, exact receipt bound to the ordered quantity: reject partial / over / under (and, via ordered
  // quantity > 0, any zero/negative). expected must equal received must equal ordered.
  if (line.expectedQuantity !== orderedQuantity) return fail("expected_quantity_mismatch");
  if (line.receivedQuantity !== orderedQuantity) return fail("received_quantity_mismatch");

  // ---- per-mode serial identity ----
  // SERIAL: exactly one serial per received unit, each a non-empty string, no duplicates within the
  // line. Serials are normalized by trimming ONLY -- case is preserved, because serial numbers are
  // manufacturer identity and case can be significant. Duplicate detection is therefore exact-match,
  // which is the same comparison the registry's deterministic document id uses, so "accepted here"
  // and "unique there" can never disagree.
  // NONE: serialNumbers must be absent entirely.
  let serialNumbers: string[] | null = null;
  if (trackingMode === "SERIAL") {
    if (!Array.isArray(line.serialNumbers)) return fail("serial_numbers_missing");
    const trimmed: string[] = [];
    for (const raw of line.serialNumbers) {
      if (!isNonEmptyString(raw)) return fail("serial_number_invalid");
      trimmed.push((raw as string).trim());
    }
    // One serial per physical unit -- bound to the AUTHORITATIVE ordered quantity, not to a
    // client-supplied count, so a caller cannot under- or over-declare serials for the receipt.
    if (trimmed.length !== orderedQuantity) return fail("serial_count_mismatch");
    if (new Set(trimmed).size !== trimmed.length) return fail("serial_numbers_duplicated");
    serialNumbers = trimmed;
  } else if (line.serialNumbers !== undefined) {
    return fail("serial_numbers_not_allowed"); // NONE line carries no serial identity
  }

  if (!isNonEmptyString(input.idempotencyKey)) return fail("idempotency_key_invalid");

  const normalizedLine: ReceivingLineValue = {
    lineId: line.lineId,
    partId: line.partId,
    trackingMode,
    expectedQuantity: line.expectedQuantity,
    receivedQuantity: line.receivedQuantity,
    status: RECEIVING_LINE_STATUS,
    ...(serialNumbers === null ? {} : { serialNumbers }),
  };
  const value: ReceivingOrderValue = {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: source.reorderRequestId, purchaseOrderId: source.purchaseOrderId },
    receivingLocation: { type: receivingLocation.type, locationId: receivingLocation.locationId },
    status: "PUTAWAY_COMPLETE",
    version: RECEIVING_INITIAL_VERSION,
    lines: [normalizedLine],
    idempotencyKey: input.idempotencyKey,
  };
  return { valid: true, value, reason: null };
}

export function isValidReceivingOrderInput(input: unknown, authority: unknown): boolean {
  return validateReceivingOrderInput(input, authority).valid;
}
