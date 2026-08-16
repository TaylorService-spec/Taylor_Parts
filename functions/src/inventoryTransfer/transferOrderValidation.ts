// Enterprise Inventory Phase 4 -- pure CREATE-request validation for the Transfer command family.
// PURE and DETERMINISTIC: no Firebase, no persistence, no stock math. Validates the UNTRUSTED create
// request against the injected authoritative Part (partId + trackingMode). Server-authored fields
// (status/version/actor/timestamps) are FORBIDDEN in the input. Reuses the ledger's isPlainObject /
// isNonEmptyString helpers so "well-formed" means the same thing everywhere in the backend.

import { isPlainObject, isNonEmptyString } from "../inventoryLedger/operationalMovementValidation.js";
import {
  TRANSFER_ENDPOINT_TYPES,
  TRANSFER_SUPPORTED_TRACKING_MODES,
  type TransferEndpointType,
  type TransferLocationRef,
  type TransferOrderValue,
  type TransferTrackingMode,
  type ValidationResult,
} from "./transferOrderTypes.js";

function fail(reason: string): ValidationResult<TransferOrderValue> {
  return { valid: false, value: null, reason };
}

// Phase-4-scoped location reference: {type, locationId}, type restricted to WAREHOUSE|MOBILE. A
// CUSTOMER/BIN/VENDOR/VIRTUAL endpoint (legal in the broader EI-P1a vocabulary) fails closed HERE --
// deliberately narrower than the general ledger validator, because this authority does not implement
// customer delivery.
export function validateTransferLocationRef(ref: unknown): TransferLocationRef | null {
  if (!isPlainObject(ref)) return null;
  const keys = Object.keys(ref);
  if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "locationId")) return null;
  if (typeof ref.type !== "string" || !(TRANSFER_ENDPOINT_TYPES as readonly string[]).includes(ref.type)) return null;
  if (!isNonEmptyString(ref.locationId)) return null;
  return { type: ref.type as TransferEndpointType, locationId: ref.locationId };
}

function sameLocation(a: TransferLocationRef, b: TransferLocationRef): boolean {
  return a.type === b.type && a.locationId === b.locationId;
}

export interface TransferPartAuthority {
  readonly partId: string;
  readonly trackingMode: string;
}

const ALLOWED_INPUT_KEYS = new Set(["partId", "quantity", "origin", "destination", "serialNumbers", "idempotencyKey"]);

// Validate a create-transfer request. `authority` supplies the canonical Part (partId + trackingMode).
// Returns the normalized value on success. Location ACTIVE-ness and origin stock sufficiency are NOT
// checked here -- those are commit-time, transaction-read concerns the command checks separately
// (mirrors receiveInventoryStockCommand.ts's split between structural validation and injected resolvers).
export function validateCreateTransferInput(input: unknown, authority: unknown): ValidationResult<TransferOrderValue> {
  if (!isPlainObject(input)) return fail("not_object");
  if (Object.keys(input).some((k) => !ALLOWED_INPUT_KEYS.has(k))) return fail("unknown_field");

  if (!isPlainObject(authority)) return fail("authority_invalid");
  const partAuthority = isPlainObject(authority.part) ? (authority.part as Record<string, unknown>) : null;
  if (!partAuthority || !isNonEmptyString(partAuthority.partId)) return fail("part_invalid");
  if (typeof partAuthority.trackingMode !== "string" || !(TRANSFER_SUPPORTED_TRACKING_MODES as readonly string[]).includes(partAuthority.trackingMode)) {
    return fail("tracking_mode_unsupported"); // LOT deferred
  }
  const trackingMode = partAuthority.trackingMode as TransferTrackingMode;

  if (!isNonEmptyString(input.partId)) return fail("part_id_invalid");
  if (input.partId !== partAuthority.partId) return fail("part_mismatch");

  const origin = validateTransferLocationRef(input.origin);
  if (origin === null) return fail("origin_invalid");
  const destination = validateTransferLocationRef(input.destination);
  if (destination === null) return fail("destination_invalid");
  if (sameLocation(origin, destination)) return fail("same_location");

  if (typeof input.quantity !== "number" || !Number.isFinite(input.quantity) || !Number.isInteger(input.quantity) || input.quantity <= 0) {
    return fail("quantity_invalid");
  }
  const quantity = input.quantity;

  let serialNumbers: string[] | null = null;
  if (trackingMode === "SERIAL") {
    if (!Array.isArray(input.serialNumbers)) return fail("serial_numbers_missing");
    const trimmed: string[] = [];
    for (const raw of input.serialNumbers) {
      if (!isNonEmptyString(raw)) return fail("serial_number_invalid");
      trimmed.push((raw as string).trim());
    }
    if (trimmed.length !== quantity) return fail("serial_count_mismatch");
    if (new Set(trimmed).size !== trimmed.length) return fail("serial_numbers_duplicated");
    serialNumbers = trimmed;
  } else if (input.serialNumbers !== undefined) {
    return fail("serial_numbers_not_allowed"); // NONE transfer carries no serial identity
  }

  if (!isNonEmptyString(input.idempotencyKey)) return fail("idempotency_key_invalid");

  const value: TransferOrderValue = {
    partId: input.partId,
    trackingMode,
    quantity,
    origin,
    destination,
    ...(serialNumbers === null ? {} : { serialNumbers }),
    idempotencyKey: input.idempotencyKey,
  };
  return { valid: true, value, reason: null };
}
