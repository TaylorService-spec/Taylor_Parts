// Enterprise Inventory Phase 4 -- PURE request builders for the Transfer command family
// (functions/src/inventoryTransfer/transferCallables.ts). No Firebase, no I/O; Node-importable and
// unit-tested. Mirrors domain/truckManagement.js's validate-then-build shape and idempotency-key
// factory convention -- every command carries an idempotencyKey so a retried submit collapses to the
// same governed mutation (the backend's own replay guard, not a client-side dedupe).
//
// Endpoint fence: WAREHOUSE + MOBILE(truck) only, matching the backend's Phase-4 scope. CUSTOMER
// delivery is not modeled here.

const ENDPOINT_TYPES = new Set(["WAREHOUSE", "MOBILE"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
function isPositiveInteger(v) {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function makeIdempotencyKey() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `trf_${c.randomUUID()}`;
  return `trf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

// Validate + normalize a New Transfer form draft into the EXACT createTransferOrder request shape.
// `draft`: { partId, quantity (number|string), originType, originLocationId, destinationType,
//            destinationLocationId, serialNumbersText? }. Returns { ok, errors, value }; value is
// null unless ok. serialNumbersText is a comma/newline-separated free-text field -- present only
// when the operator is transferring SERIAL units; omitted entirely for a NONE transfer.
export function buildCreateTransferRequest(draft, { idempotencyKey } = {}) {
  const errors = {};
  const src = draft && typeof draft === "object" ? draft : {};

  if (!isNonEmptyString(src.partId)) errors.partId = "Part is required.";
  const quantity = typeof src.quantity === "string" ? Number(src.quantity) : src.quantity;
  if (!isPositiveInteger(quantity)) errors.quantity = "Quantity must be a whole number greater than zero.";

  if (!ENDPOINT_TYPES.has(src.originType)) errors.originType = "Origin type must be a warehouse or a truck.";
  if (!isNonEmptyString(src.originLocationId)) errors.originLocationId = "Origin location is required.";
  if (!ENDPOINT_TYPES.has(src.destinationType)) errors.destinationType = "Destination type must be a warehouse or a truck.";
  if (!isNonEmptyString(src.destinationLocationId)) errors.destinationLocationId = "Destination location is required.";
  if (
    !errors.originType && !errors.originLocationId && !errors.destinationType && !errors.destinationLocationId &&
    src.originType === src.destinationType && src.originLocationId === src.destinationLocationId
  ) {
    errors.destinationLocationId = "Origin and destination must be different locations.";
  }

  let serialNumbers;
  const serialText = typeof src.serialNumbersText === "string" ? src.serialNumbersText : "";
  if (serialText.trim() !== "") {
    const parts = serialText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (parts.length === 0) errors.serialNumbersText = "Enter at least one serial number, or leave blank for a non-serialized part.";
    else if (new Set(parts).size !== parts.length) errors.serialNumbersText = "Serial numbers must be unique.";
    else serialNumbers = parts;
  }

  const key = isNonEmptyString(idempotencyKey) ? idempotencyKey : makeIdempotencyKey();
  if (Object.keys(errors).length > 0) return { ok: false, errors, value: null };

  const value = {
    partId: src.partId.trim(),
    quantity,
    origin: { type: src.originType, locationId: src.originLocationId },
    destination: { type: src.destinationType, locationId: src.destinationLocationId },
    ...(serialNumbers ? { serialNumbers } : {}),
    idempotencyKey: key,
  };
  return { ok: true, errors: {}, value };
}

// The three transferOrderId-only action requests (dispatch/receive/cancel) share one exact shape.
export function buildTransferActionRequest(transferOrderId) {
  if (!isNonEmptyString(transferOrderId)) return { ok: false, value: null };
  return { ok: true, value: { transferOrderId } };
}
