// Enterprise Inventory -- Cycle Count operating authority: pure, deterministic request-shape
// validation. No Firebase, no persistence, no stock math (mirrors transferOrderValidation.ts).

import {
  CYCLE_COUNT_LOCATION_TYPES,
  CYCLE_COUNT_SUPPORTED_TRACKING_MODES,
  CYCLE_COUNT_REVIEW_DECISIONS,
  type CycleCountLocationRef,
  type CycleCountLocationType,
  type CycleCountReviewDecision,
  type CycleCountTrackingMode,
  type CycleCountValue,
  type ValidationResult,
} from "./cycleCountTypes.js";

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

export function validateCycleCountLocationRef(ref: unknown): CycleCountLocationRef | null {
  if (!isPlainObject(ref)) return null;
  const keys = Object.keys(ref);
  if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "locationId")) return null;
  if (typeof ref.type !== "string" || !(CYCLE_COUNT_LOCATION_TYPES as readonly string[]).includes(ref.type)) return null;
  if (!isNonEmptyString(ref.locationId)) return null;
  return { type: ref.type as CycleCountLocationType, locationId: ref.locationId };
}

export interface CycleCountPartAuthority {
  readonly part: { readonly partId: string; readonly trackingMode: string };
}

// Validates a createCycleCount request SHAPE, bound to the authoritative Part's identity/trackingMode.
// expectedQuantity/expectedSerialNumbers are NEVER accepted from input -- the command computes them
// server-side from the ledger/registry authority; this validator only shapes location/partId/idempotencyKey.
export function validateCreateCycleCountInput(input: unknown, authority: CycleCountPartAuthority): ValidationResult<{
  readonly partId: string;
  readonly trackingMode: CycleCountTrackingMode;
  readonly location: CycleCountLocationRef;
  readonly idempotencyKey: string;
}> {
  if (!isPlainObject(input)) return { valid: false, value: null, reason: "not_object" };
  if (!isNonEmptyString(input.partId) || input.partId !== authority.part.partId) {
    return { valid: false, value: null, reason: "part_mismatch" };
  }
  if (!(CYCLE_COUNT_SUPPORTED_TRACKING_MODES as readonly string[]).includes(authority.part.trackingMode)) {
    return { valid: false, value: null, reason: "tracking_mode_unsupported" };
  }
  const trackingMode = authority.part.trackingMode as CycleCountTrackingMode;
  const location = validateCycleCountLocationRef(input.location);
  if (location === null) return { valid: false, value: null, reason: "location_invalid" };
  if (!isNonEmptyString(input.idempotencyKey)) return { valid: false, value: null, reason: "idempotency_key_invalid" };
  return {
    valid: true,
    value: { partId: authority.part.partId, trackingMode, location, idempotencyKey: input.idempotencyKey },
    reason: null,
  };
}

// Validates a submitCycleCount request against the authoritative stored order's trackingMode.
export function validateSubmitCycleCountInput(
  input: unknown,
  trackingMode: CycleCountTrackingMode,
): ValidationResult<{ readonly countedQuantity?: number; readonly countedSerialNumbers?: readonly string[] }> {
  if (!isPlainObject(input)) return { valid: false, value: null, reason: "not_object" };
  if (trackingMode === "NONE") {
    if (input.countedSerialNumbers !== undefined) return { valid: false, value: null, reason: "unknown_field" };
    if (typeof input.countedQuantity !== "number" || !Number.isInteger(input.countedQuantity) || input.countedQuantity < 0) {
      return { valid: false, value: null, reason: "counted_quantity_invalid" };
    }
    return { valid: true, value: { countedQuantity: input.countedQuantity }, reason: null };
  }
  // SERIAL
  if (input.countedQuantity !== undefined) return { valid: false, value: null, reason: "unknown_field" };
  if (!Array.isArray(input.countedSerialNumbers) || !input.countedSerialNumbers.every((s) => isNonEmptyString(s))) {
    return { valid: false, value: null, reason: "counted_serial_numbers_invalid" };
  }
  const serials = input.countedSerialNumbers as string[];
  if (new Set(serials).size !== serials.length) return { valid: false, value: null, reason: "counted_serial_numbers_duplicate" };
  return { valid: true, value: { countedSerialNumbers: [...serials] }, reason: null };
}

// `decision` defaults to APPROVE when omitted, preserving every pre-M23 caller's request shape --
// reconcileCycleCount's original meaning (approve + stage ADJUSTED ledger evidence) is decision APPROVE.
// decision REJECT is the M23 manager-review addition: dispose of the count as disputed, no ledger effect.
export function validateReconcileCycleCountInput(
  input: unknown,
): ValidationResult<{ readonly reason: string | null; readonly decision: CycleCountReviewDecision }> {
  if (!isPlainObject(input)) return { valid: false, value: null, reason: "not_object" };
  if (input.reason !== undefined && !isNonEmptyString(input.reason)) {
    return { valid: false, value: null, reason: "reason_invalid" };
  }
  if (input.decision !== undefined && !(CYCLE_COUNT_REVIEW_DECISIONS as readonly string[]).includes(input.decision as string)) {
    return { valid: false, value: null, reason: "decision_invalid" };
  }
  const decision = (input.decision as CycleCountReviewDecision | undefined) ?? "APPROVE";
  return { valid: true, value: { reason: input.reason !== undefined ? (input.reason as string) : null, decision }, reason: null };
}

export type { CycleCountValue };
