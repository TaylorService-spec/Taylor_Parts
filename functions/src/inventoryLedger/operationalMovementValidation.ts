// Enterprise Inventory -- EI-P1 INERT backend foundation: operational movement envelope VALIDATION.
// A faithful TypeScript mirror of field-ops-app-vite/src/domain/inventoryLedgerEvent.js
// (validateInventoryMovementEvent). Same accept/reject decisions and the same `reason` strings, so
// the tests can assert byte-for-byte parity against the merged pure contract. PURE and DETERMINISTIC:
// no Firebase, no persistence, no stock math. recordedAt is a FORBIDDEN input (server-authored only).

import {
  OPERATIONAL_MOVEMENT_TYPES,
  MOVEMENT_DIRECTION,
  SOURCE_OBJECT_TYPES,
  MOVEMENT_SOURCE_TYPE,
  ACTOR_KINDS,
  SYSTEM_ACTOR_IDS,
  INVENTORY_LOCATION_TYPES,
  PART_TRACKING_MODES,
  type OperationalMovementType,
  type MovementDirection,
  type PartTrackingMode,
  type LocationRef,
  type OperationalMovementValue,
  type ValidationResult,
} from "./operationalMovementTypes.js";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
export function isTrackingMode(value: unknown): value is PartTrackingMode {
  return typeof value === "string" && (PART_TRACKING_MODES as readonly string[]).includes(value);
}

// The maximum epoch-millis value representable by a JS Date (ECMA-262 +/-8.64e15).
const MAX_EPOCH_MILLIS = 8_640_000_000_000_000;
export function isEpochMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_EPOCH_MILLIS;
}

// EI-P1a discriminated location reference { type, locationId } -- fail-closed, only those two keys.
export function validateLocationRef(ref: unknown): LocationRef | null {
  if (!isPlainObject(ref)) return null;
  const keys = Object.keys(ref);
  if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "locationId")) return null;
  if (typeof ref.type !== "string" || !(INVENTORY_LOCATION_TYPES as readonly string[]).includes(ref.type)) return null;
  if (!isNonEmptyString(ref.locationId)) return null;
  return { type: ref.type as LocationRef["type"], locationId: ref.locationId };
}

function fail(reason: string): ValidationResult<OperationalMovementValue> {
  return { valid: false, value: null, reason };
}

// Validate a discriminated source-object reference { type, id } against the required type.
export function validateSourceObjectReason(sourceObject: unknown, requiredType: string): string | null {
  if (!isPlainObject(sourceObject)) return "source_object_invalid";
  const keys = Object.keys(sourceObject);
  if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "id")) return "source_object_invalid";
  if (typeof sourceObject.type !== "string" || !(SOURCE_OBJECT_TYPES as readonly string[]).includes(sourceObject.type)) return "source_object_invalid";
  if (!isNonEmptyString(sourceObject.id)) return "source_object_invalid";
  if (sourceObject.type !== requiredType) return "source_incompatible";
  return null;
}

export function validateActorReason(actor: unknown): string | null {
  if (!isPlainObject(actor)) return "actor_invalid";
  const keys = Object.keys(actor);
  if (keys.length !== 2 || !keys.every((k) => k === "kind" || k === "id")) return "actor_invalid";
  if (typeof actor.kind !== "string" || !(ACTOR_KINDS as readonly string[]).includes(actor.kind)) return "actor_kind_invalid";
  if (!isNonEmptyString(actor.id)) return "actor_id_invalid";
  if (actor.kind === "SYSTEM" && !(SYSTEM_ACTOR_IDS as readonly string[]).includes(actor.id)) return "system_actor_not_allowed";
  return null;
}

// Per-mode / per-direction quantity rules (SHAPE only; no stock math). SERIAL -> exactly 1;
// SIGNED -> nonzero; IN/OUT -> > 0. All must be finite numbers.
export function validateQuantityReason(mode: PartTrackingMode, direction: MovementDirection, quantity: unknown): string | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return "quantity_invalid";
  if (mode === "SERIAL") return quantity === 1 ? null : "quantity_invalid";
  if (direction === "SIGNED") return quantity !== 0 ? null : "quantity_invalid";
  return quantity > 0 ? null : "quantity_invalid";
}

export interface PartAuthority {
  readonly partId: string;
  readonly trackingMode: PartTrackingMode;
}

// The pure envelope validator (mirror). `part` supplies the canonical tracking mode + identity.
export function validateOperationalMovementEvent(event: unknown, part: unknown): ValidationResult<OperationalMovementValue> {
  if (!isPlainObject(event)) return fail("not_object");
  if (typeof event.type !== "string" || !(OPERATIONAL_MOVEMENT_TYPES as readonly string[]).includes(event.type)) return fail("type_invalid");
  const type = event.type as OperationalMovementType;
  const direction = MOVEMENT_DIRECTION[type];
  const isTransfer = type === "TRANSFER_OUT" || type === "TRANSFER_IN";

  if (!isPlainObject(part) || !isNonEmptyString(part.partId)) return fail("part_invalid");
  if (!isTrackingMode(part.trackingMode)) return fail("tracking_mode_invalid");
  if (!isNonEmptyString(event.partId)) return fail("part_id_invalid");
  if (event.partId !== part.partId) return fail("part_mismatch");
  const mode = part.trackingMode;

  // Unknown-field gate; recordedAt is always forbidden (reserved for the trusted server writer).
  const allowed = new Set(["type", "partId", "location", "quantity", "sourceObject", "idempotencyKey", "actor", "occurredAt"]);
  if (mode === "SERIAL") allowed.add("serialNo");
  if (mode === "LOT") allowed.add("lotId");
  if (isTransfer) allowed.add("counterpartyLocation");
  if (Object.prototype.hasOwnProperty.call(event, "recordedAt")) return fail("recorded_at_forbidden");
  if (Object.keys(event).some((k) => !allowed.has(k))) return fail("unknown_field");

  if (mode === "SERIAL" && !isNonEmptyString(event.serialNo)) return fail("serial_no_invalid");
  if (mode === "LOT" && !isNonEmptyString(event.lotId)) return fail("lot_id_invalid");

  const location = validateLocationRef(event.location);
  if (location === null) return fail("location_invalid");

  let counterparty: LocationRef | null = null;
  if (isTransfer) {
    const cp = validateLocationRef(event.counterpartyLocation);
    if (cp === null) return fail("counterparty_invalid");
    if (cp.type === location.type && cp.locationId === location.locationId) return fail("transfer_same_location");
    counterparty = cp;
  }

  const quantityReason = validateQuantityReason(mode, direction, event.quantity);
  if (quantityReason) return fail(quantityReason);

  const sourceReason = validateSourceObjectReason(event.sourceObject, MOVEMENT_SOURCE_TYPE[type]);
  if (sourceReason) return fail(sourceReason);

  if (!isNonEmptyString(event.idempotencyKey)) return fail("idempotency_key_invalid");

  const actorReason = validateActorReason(event.actor);
  if (actorReason) return fail(actorReason);

  if (!isEpochMillis(event.occurredAt)) return fail("occurred_at_invalid");

  const source = event.sourceObject as Record<string, unknown>;
  const actor = event.actor as Record<string, unknown>;
  const value: OperationalMovementValue = {
    type,
    direction,
    partId: event.partId,
    trackingMode: mode,
    location,
    quantity: event.quantity as number,
    sourceObject: { type: source.type as never, id: source.id as string },
    idempotencyKey: event.idempotencyKey,
    actor: { kind: actor.kind as never, id: actor.id as string },
    occurredAt: event.occurredAt as number,
    ...(mode === "SERIAL" ? { serialNo: event.serialNo as string } : {}),
    ...(mode === "LOT" ? { lotId: event.lotId as string } : {}),
    ...(isTransfer && counterparty ? { counterpartyLocation: counterparty } : {}),
  };
  return { valid: true, value, reason: null };
}

export function isOperationalMovementEvent(event: unknown, part: unknown): boolean {
  return validateOperationalMovementEvent(event, part).valid;
}
