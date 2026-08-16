// Enterprise Inventory Phase 4 -- transfer_orders PERSISTENCE boundary (serialize / fail-closed
// deserialize / deterministic identity + fingerprint). Reuses the SAME `transfer_orders` collection the
// read model (transferOrderView.js) and Rules (`firestore.rules` transfer_orders match block, already
// create/update/delete: if false for every principal) already govern -- no second collection, no Rules
// change. Additively writes the legacy `fromWarehouseId`/`toWarehouseId` scalar fields WHEN both endpoints
// are WAREHOUSE, so a warehouse-manager's existing Rules-scoped read (isAssignedToWarehouse(resource.data.
// fromWarehouseId)) and the legacy RawTransferOrder client shape keep working unchanged; a WAREHOUSE<->
// MOBILE(truck) transfer carries no legacy fields (transferOrderView.js's generalized origin/destination
// path already reads that shape).

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import {
  TRANSFER_ORDER_STATUSES,
  TRANSFER_SCHEMA_VERSION,
  TRANSFER_SUPPORTED_TRACKING_MODES,
  TransferMalformedStoredRecordError,
  type DeserializedTransferOrder,
  type TransferActor,
  type TransferLocationRef,
  type TransferOrderStatus,
  type TransferOrderValue,
  type TransferTrackingMode,
} from "./transferOrderTypes.js";
import { validateTransferLocationRef } from "./transferOrderValidation.js";
import { isNonEmptyString, isPlainObject } from "../inventoryLedger/operationalMovementValidation.js";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// 16-hex fingerprint over the request-derived CREATE value only (mirrors the ledger/receiving precedent):
// replay iff equal, conflict iff not.
export function fingerprintTransferOrder(value: TransferOrderValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}

// Deterministic, PATH-SAFE transfer identity from the caller idempotencyKey.
export function transferOrderDocId(idempotencyKey: string): string {
  return "trf_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}

function isActor(a: unknown): a is TransferActor {
  return isPlainObject(a) && (a.kind === "USER" || a.kind === "SYSTEM") && isNonEmptyString(a.id);
}

// Serialize a validated CREATE value into the stored REQUESTED/version-1 order.
export function serializeTransferOrder(value: TransferOrderValue, actor: TransferActor, now: Date, fingerprint: string): Record<string, unknown> {
  const legacyWarehouseOnly = value.origin.type === "WAREHOUSE" && value.destination.type === "WAREHOUSE";
  return {
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    partId: value.partId,
    trackingMode: value.trackingMode,
    quantity: value.quantity,
    origin: { type: value.origin.type, locationId: value.origin.locationId },
    destination: { type: value.destination.type, locationId: value.destination.locationId },
    ...(value.serialNumbers === undefined ? {} : { serialNumbers: [...value.serialNumbers] }),
    ...(legacyWarehouseOnly ? { fromWarehouseId: value.origin.locationId, toWarehouseId: value.destination.locationId } : {}),
    status: "REQUESTED" as TransferOrderStatus,
    version: 1,
    idempotencyKey: value.idempotencyKey,
    actor: { kind: actor.kind, id: actor.id },
    createdAt: Timestamp.fromDate(now),
    createdBy: actor.id,
    updatedAt: Timestamp.fromDate(now),
    updatedBy: actor.id,
    fingerprint,
  };
}

const STORED_KEYS = new Set([
  "schemaVersion", "partId", "trackingMode", "quantity", "origin", "destination", "serialNumbers",
  "fromWarehouseId", "toWarehouseId", "status", "version", "idempotencyKey", "actor",
  "createdAt", "createdBy", "updatedAt", "updatedBy", "fingerprint",
]);

// Fail-closed deserialize of a stored transfer_orders record. Never normalizes malformed data into
// validity -- throws TransferMalformedStoredRecordError on anything unexpected.
export function deserializeTransferOrder(docId: string, data: unknown): DeserializedTransferOrder {
  if (!isPlainObject(data)) throw new TransferMalformedStoredRecordError("stored transfer order is not an object");
  if (data.schemaVersion !== TRANSFER_SCHEMA_VERSION) throw new TransferMalformedStoredRecordError("stored schemaVersion invalid");
  if (Object.keys(data).some((k) => !STORED_KEYS.has(k))) throw new TransferMalformedStoredRecordError("stored record has unknown field");

  if (!isNonEmptyString(data.partId)) throw new TransferMalformedStoredRecordError("stored partId invalid");
  if (typeof data.trackingMode !== "string" || !(TRANSFER_SUPPORTED_TRACKING_MODES as readonly string[]).includes(data.trackingMode)) {
    throw new TransferMalformedStoredRecordError("stored trackingMode invalid");
  }
  const trackingMode = data.trackingMode as TransferTrackingMode;
  if (typeof data.quantity !== "number" || !Number.isInteger(data.quantity) || data.quantity <= 0) {
    throw new TransferMalformedStoredRecordError("stored quantity invalid");
  }
  const origin = validateTransferLocationRef(data.origin);
  if (origin === null) throw new TransferMalformedStoredRecordError("stored origin invalid");
  const destination = validateTransferLocationRef(data.destination);
  if (destination === null) throw new TransferMalformedStoredRecordError("stored destination invalid");
  if (origin.type === destination.type && origin.locationId === destination.locationId) {
    throw new TransferMalformedStoredRecordError("stored transfer has same origin/destination");
  }

  let serialNumbers: string[] | undefined;
  if (trackingMode === "SERIAL") {
    if (!Array.isArray(data.serialNumbers)) throw new TransferMalformedStoredRecordError("stored SERIAL transfer has no serialNumbers");
    const serials = data.serialNumbers as unknown[];
    if (!serials.every((s) => isNonEmptyString(s))) throw new TransferMalformedStoredRecordError("stored serialNumbers invalid");
    if (serials.length !== data.quantity) throw new TransferMalformedStoredRecordError("stored serialNumbers count does not match quantity");
    if (new Set(serials as string[]).size !== serials.length) throw new TransferMalformedStoredRecordError("stored serialNumbers contain duplicates");
    serialNumbers = [...(serials as string[])];
  } else if (data.serialNumbers !== undefined) {
    throw new TransferMalformedStoredRecordError("stored NONE transfer must not carry serialNumbers");
  }

  if (typeof data.status !== "string" || !(TRANSFER_ORDER_STATUSES as readonly string[]).includes(data.status)) {
    throw new TransferMalformedStoredRecordError("stored status invalid");
  }
  if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < 1) {
    throw new TransferMalformedStoredRecordError("stored version invalid");
  }
  if (!isNonEmptyString(data.idempotencyKey)) throw new TransferMalformedStoredRecordError("stored idempotencyKey invalid");
  if (!isActor(data.actor)) throw new TransferMalformedStoredRecordError("stored actor invalid");
  if (!isNonEmptyString(data.createdBy) || !isNonEmptyString(data.updatedBy)) throw new TransferMalformedStoredRecordError("stored createdBy/updatedBy invalid");
  if (!(data.createdAt instanceof Timestamp) || !(data.updatedAt instanceof Timestamp)) throw new TransferMalformedStoredRecordError("stored timestamps are not server Timestamps");
  if (typeof data.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(data.fingerprint)) throw new TransferMalformedStoredRecordError("stored fingerprint invalid");

  const value: TransferOrderValue = {
    partId: data.partId,
    trackingMode,
    quantity: data.quantity,
    origin,
    destination,
    ...(serialNumbers === undefined ? {} : { serialNumbers }),
    idempotencyKey: data.idempotencyKey,
  };
  return {
    transferOrderId: docId,
    value,
    status: data.status as TransferOrderStatus,
    version: data.version,
    actor: { kind: data.actor.kind, id: data.actor.id },
    createdAt: data.createdAt.toDate().getTime(),
    updatedAt: data.updatedAt.toDate().getTime(),
    createdBy: data.createdBy,
    updatedBy: data.updatedBy,
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    fingerprint: data.fingerprint,
  };
}

// Build the fields for a status-transition update (dispatch/receive/cancel). Never touches the
// create-time value fields (partId/quantity/origin/destination/serialNumbers/idempotencyKey/createdAt/
// createdBy) -- only status/version/updatedAt/updatedBy move.
export function transitionFields(nextStatus: TransferOrderStatus, nextVersion: number, actor: TransferActor, now: Date): Record<string, unknown> {
  return { status: nextStatus, version: nextVersion, updatedAt: Timestamp.fromDate(now), updatedBy: actor.id };
}

export type { TransferLocationRef };
