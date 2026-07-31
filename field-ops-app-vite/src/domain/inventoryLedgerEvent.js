// Enterprise Inventory -- EI-P1b-1 pure Inventory Ledger EVENT ENVELOPE contract.
//
// PURE and DETERMINISTIC: no Firebase import, no persistence, no quantities summed, no
// on-hand/available/reservation math, no transfer pairing, no opening balances. It ONLY
// validates the SHAPE of a single operational physical-movement event against the
// governed EI-P1b envelope decisions. Node-importable and unit-tested directly
// (test/inventoryLedgerEvent.test.mjs). Mirrors the EI-P1a pure-contract precedent
// (partTrackingMode / inventoryLocation / serializedAssetIdentity).
//
// GOVERNANCE (durable, DECISIONS EI-P1b):
//   * These seven types are the OPERATIONAL movement subset -- explicitly NOT the
//     complete UD-3 physical-ledger taxonomy. OPENING_BALANCE / initialization and any
//     further governed types remain DEFERRED and are added only by their own governed
//     gate. This contract computes no projections, so it structurally cannot "close" the
//     taxonomy or block the later opening-balance event.
//   * Tracking mode stays Part-owned {NONE, SERIAL, LOT}. Legacy controlType is translated
//     ONLY at the Part boundary via resolveTrackingModeFromControlType(); SERIALIZED_LOT
//     fails closed (dual-tracking-unsupported) -- never a lossy collapse to SERIAL/LOT.
//   * SYSTEM actors are constrained to an exported allowlist (initially only the existing
//     trusted Work-Order-transition actor). Future actors require additive governance.
//   * occurredAt is caller-supplied business time; recordedAt is reserved for the future
//     trusted server writer and is a FORBIDDEN input here.
//
// BOUNDARIES: no aggregation, on-hand/available calculation, transfer pairing, opening
// balances, persistence, Firestore, Rules, indexes, Functions, migration, or UI.
import { validateLocationRef } from "./inventoryLocation.js";
import { isTrackingMode } from "./partTrackingMode.js";

// The OPERATIONAL physical-movement subset (NOT the complete UD-3 taxonomy). The
// existing WO reservation/consumption ledger (RESERVED/RELEASED/CONSUMED) and the
// deferred OPENING_BALANCE event are deliberately NOT members here.
export const OPERATIONAL_MOVEMENT_TYPES = Object.freeze([
  "RECEIVED",
  "ADJUSTED",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "COUNTED",
  "RETURNED",
  "SCRAPPED",
]);

// Direction is metadata carried by the TYPE (never inferred from a quantity sign). IN/OUT
// are positive magnitudes; SIGNED (ADJUSTED) is a signed nonzero delta; SNAPSHOT (COUNTED)
// is an observed absolute. This is classification only -- no on-hand math is performed.
export const MOVEMENT_DIRECTION = Object.freeze({
  RECEIVED: "IN",
  RETURNED: "IN",
  TRANSFER_IN: "IN",
  TRANSFER_OUT: "OUT",
  SCRAPPED: "OUT",
  ADJUSTED: "SIGNED",
  COUNTED: "SNAPSHOT",
});

// Bounded source-object taxonomy, DECLARED AHEAD of persistence. WORK_ORDER and
// TRANSFER_ORDER have backing collections today; the rest are governed objects that
// remain WRITE-BLOCKED at the trusted layer until separately governed. This pure
// contract validates the reference SHAPE only; it never asserts the object exists.
export const SOURCE_OBJECT_TYPES = Object.freeze([
  "WORK_ORDER",
  "RECEIVING_ORDER",
  "TRANSFER_ORDER",
  "COUNT_SHEET",
  "ADJUSTMENT",
  "RMA",
  "SCRAP",
]);

// Movement/source compatibility matrix: each operational movement type is produced by
// exactly one source-object type, so the source discriminant can never contradict the
// movement. WORK_ORDER is intentionally absent -- it belongs to the deferred
// reservation/consumption ledger, not to any operational movement type here.
export const MOVEMENT_SOURCE_TYPE = Object.freeze({
  RECEIVED: "RECEIVING_ORDER",
  RETURNED: "RMA",
  TRANSFER_OUT: "TRANSFER_ORDER",
  TRANSFER_IN: "TRANSFER_ORDER",
  COUNTED: "COUNT_SHEET",
  ADJUSTED: "ADJUSTMENT",
  SCRAPPED: "SCRAP",
});

export const ACTOR_KINDS = Object.freeze(["USER", "SYSTEM"]);

// Exported SYSTEM-actor allowlist. Initially only the existing trusted Work-Order-
// transition actor (functions/src/inventoryService.ts triggerInventoryEffects). Adding a
// SYSTEM actor is an additive governance change here, never an ad-hoc string.
export const SYSTEM_ACTOR_IDS = Object.freeze(["WORK_ORDER_TRANSITION"]);

// Legacy Part-Master controlType -> canonical Part tracking mode. Boundary-only
// translation (used where a Part is expressed in controlType before injection). Total or
// fail: STANDARD->NONE, SERIALIZED->SERIAL, LOT->LOT; SERIALIZED_LOT has no canonical
// single mode and fails closed. { mode, reason } -- mode is null on failure.
const CONTROL_TYPE_TO_MODE = Object.freeze({
  STANDARD: "NONE",
  SERIALIZED: "SERIAL",
  LOT: "LOT",
});
export function resolveTrackingModeFromControlType(controlType) {
  if (controlType === "SERIALIZED_LOT") return { mode: null, reason: "dual_tracking_unsupported" };
  const mode = Object.prototype.hasOwnProperty.call(CONTROL_TYPE_TO_MODE, controlType)
    ? CONTROL_TYPE_TO_MODE[controlType]
    : null;
  return mode ? { mode, reason: null } : { mode: null, reason: "control_type_unknown" };
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// The maximum time value representable by a JavaScript Date, in epoch milliseconds
// (ECMA-262: +/-8.64e15). A larger integer is finite but not a usable instant -- it
// yields an Invalid Date / range failure downstream -- so it is rejected here.
const MAX_EPOCH_MILLIS = 8_640_000_000_000_000;

// A positive, representable epoch-millisecond instant (repo convention: Date.now()).
// Integer, > 0, and within Date's representable range. Number.isInteger already excludes
// NaN and Infinity.
function isEpochMillis(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_EPOCH_MILLIS;
}

function fail(reason) {
  return { valid: false, value: null, reason };
}

// Validate a discriminated source-object reference { type, id }.
function validateSourceObject(sourceObject, requiredType) {
  if (!isPlainObject(sourceObject)) return "source_object_invalid";
  const keys = Object.keys(sourceObject);
  if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "id")) return "source_object_invalid";
  if (!SOURCE_OBJECT_TYPES.includes(sourceObject.type)) return "source_object_invalid";
  if (!isNonEmptyString(sourceObject.id)) return "source_object_invalid";
  // The source discriminant may never contradict the movement type.
  if (sourceObject.type !== requiredType) return "source_incompatible";
  return null;
}

// Validate an actor reference { kind, id }; SYSTEM ids must be on the exported allowlist.
function validateActor(actor) {
  if (!isPlainObject(actor)) return "actor_invalid";
  const keys = Object.keys(actor);
  if (keys.length !== 2 || !keys.every((k) => k === "kind" || k === "id")) return "actor_invalid";
  if (!ACTOR_KINDS.includes(actor.kind)) return "actor_kind_invalid";
  if (!isNonEmptyString(actor.id)) return "actor_id_invalid";
  if (actor.kind === "SYSTEM" && !SYSTEM_ACTOR_IDS.includes(actor.id)) return "system_actor_not_allowed";
  return null;
}

// Per-mode quantity/identifier + per-type quantity rules (SHAPE only; no stock math).
// SERIAL is dominant: quantity === 1 exactly. NONE/LOT apply the per-direction rule:
// IN/OUT -> finite > 0 (fractional allowed); SIGNED -> finite nonzero; SNAPSHOT -> finite >= 0.
function validateQuantity(mode, direction, quantity) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return "quantity_invalid";
  if (mode === "SERIAL") return quantity === 1 ? null : "quantity_invalid";
  if (direction === "SNAPSHOT") return quantity >= 0 ? null : "quantity_invalid";
  if (direction === "SIGNED") return quantity !== 0 ? null : "quantity_invalid";
  return quantity > 0 ? null : "quantity_invalid"; // IN / OUT
}

// ---------------------------------------------------------------------------
// The pure envelope validator. `part` is the injected Part authority supplying the
// canonical tracking mode (NONE/SERIAL/LOT) and partId. Returns { valid, value, reason };
// `value` is a normalized, shape-validated event. Fail-closed on anything unexpected.
// ---------------------------------------------------------------------------
export function validateInventoryMovementEvent(event, part) {
  if (!isPlainObject(event)) return fail("not_object");
  if (!OPERATIONAL_MOVEMENT_TYPES.includes(event.type)) return fail("type_invalid");
  const direction = MOVEMENT_DIRECTION[event.type];
  const isTransfer = event.type === "TRANSFER_OUT" || event.type === "TRANSFER_IN";

  // Part authority: canonical tracking mode + identity (mirrors EI-P1a authority separation).
  if (!isPlainObject(part) || !isNonEmptyString(part.partId)) return fail("part_invalid");
  if (!isTrackingMode(part.trackingMode)) return fail("tracking_mode_invalid");
  if (!isNonEmptyString(event.partId)) return fail("part_id_invalid");
  if (event.partId !== part.partId) return fail("part_mismatch");
  const mode = part.trackingMode;

  // Unknown-field gate: allowed keys depend on tracking mode and movement type. recordedAt
  // is always forbidden (reserved for the trusted server writer); a stray transferId is an
  // unknown field (transfer linkage is the TRANSFER_ORDER sourceObject, never a separate id).
  const allowed = new Set(["type", "partId", "location", "quantity", "sourceObject", "idempotencyKey", "actor", "occurredAt"]);
  if (mode === "SERIAL") allowed.add("serialNo");
  if (mode === "LOT") allowed.add("lotId");
  if (isTransfer) allowed.add("counterpartyLocation");
  if (Object.prototype.hasOwnProperty.call(event, "recordedAt")) return fail("recorded_at_forbidden");
  if (Object.keys(event).some((k) => !allowed.has(k))) return fail("unknown_field");

  // Mode-scoped serial/lot identifiers. A wrong-mode identifier is already rejected by the
  // allowed-key gate above (unknown_field); here we only require the mode's own identifier.
  if (mode === "SERIAL" && !isNonEmptyString(event.serialNo)) return fail("serial_no_invalid");
  if (mode === "LOT" && !isNonEmptyString(event.lotId)) return fail("lot_id_invalid");

  // Own location (EI-P1a discriminated reference).
  const location = validateLocationRef(event.location);
  if (!location.valid) return fail("location_invalid");

  // Transfer counterparty: required for transfers, forbidden otherwise. TRANSFER_OUT
  // location=origin/counterparty=destination; TRANSFER_IN location=destination/counterparty=origin.
  // A Location identity is the WHOLE {type, locationId} reference, so origin and destination
  // are the same endpoint only when BOTH match -- WAREHOUSE/X and BIN/X are distinct
  // governed locations. (Pairing across the two events stays DEFERRED.)
  let counterparty = null;
  if (isTransfer) {
    const cp = validateLocationRef(event.counterpartyLocation);
    if (!cp.valid) return fail("counterparty_invalid");
    if (cp.value.type === location.value.type && cp.value.locationId === location.value.locationId) {
      return fail("transfer_same_location");
    }
    counterparty = cp.value;
  }
  // (counterpartyLocation on a non-transfer type is already rejected as unknown_field.)

  // Quantity (shape only).
  const quantityReason = validateQuantity(mode, direction, event.quantity);
  if (quantityReason) return fail(quantityReason);

  // Source object + movement/source compatibility.
  const sourceReason = validateSourceObject(event.sourceObject, MOVEMENT_SOURCE_TYPE[event.type]);
  if (sourceReason) return fail(sourceReason);

  // Idempotency key (per-entry dedup; caller-supplied, never minted here).
  if (!isNonEmptyString(event.idempotencyKey)) return fail("idempotency_key_invalid");

  // Actor.
  const actorReason = validateActor(event.actor);
  if (actorReason) return fail(actorReason);

  // Business time only; recordedAt already rejected above.
  if (!isEpochMillis(event.occurredAt)) return fail("occurred_at_invalid");

  const value = {
    type: event.type,
    direction,
    partId: event.partId,
    trackingMode: mode,
    location: location.value,
    quantity: event.quantity,
    sourceObject: { type: event.sourceObject.type, id: event.sourceObject.id },
    idempotencyKey: event.idempotencyKey,
    actor: { kind: event.actor.kind, id: event.actor.id },
    occurredAt: event.occurredAt,
  };
  if (mode === "SERIAL") value.serialNo = event.serialNo;
  if (mode === "LOT") value.lotId = event.lotId;
  if (isTransfer) value.counterpartyLocation = counterparty;
  return { valid: true, value, reason: null };
}

export function isInventoryMovementEvent(event, part) {
  return validateInventoryMovementEvent(event, part).valid;
}
