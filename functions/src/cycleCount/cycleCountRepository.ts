// Enterprise Inventory -- Cycle Count operating authority: `cycle_counts` PERSISTENCE boundary
// (serialize / fail-closed deserialize / deterministic identity + fingerprint). Mirrors
// transferOrderRepository.ts exactly.

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import {
  CYCLE_COUNT_STATUSES,
  CYCLE_COUNT_SCHEMA_VERSION,
  CYCLE_COUNT_SUPPORTED_TRACKING_MODES,
  CycleCountMalformedStoredRecordError,
  type CycleCountActor,
  type CycleCountIdentity,
  type CycleCountLocationRef,
  type CycleCountStatus,
  type CycleCountTrackingMode,
  type CycleCountValue,
  type DeserializedCycleCount,
  type SerialVariance,
} from "./cycleCountTypes.js";
import { validateCycleCountLocationRef, isNonEmptyString, isPlainObject } from "./cycleCountValidation.js";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// 16-hex fingerprint over the request-derived IDENTITY only (never the server-computed expected
// snapshot): replay iff equal, conflict iff not.
export function fingerprintCycleCount(identity: CycleCountIdentity): string {
  return createHash("sha256").update(canonicalJson(identity)).digest("hex").slice(0, 16);
}

// Extracts exactly the 4 identity fields from a full stored value -- NEVER pass a CycleCountValue
// directly to fingerprintCycleCount (its extra expectedQuantity/expectedSerialNumbers keys would change
// the hash and defeat the point of freezing the snapshot out of replay detection).
export function toIdentity(value: CycleCountValue): CycleCountIdentity {
  return { partId: value.partId, trackingMode: value.trackingMode, location: value.location, idempotencyKey: value.idempotencyKey };
}

// Deterministic, PATH-SAFE cycle count identity from the caller idempotencyKey.
export function cycleCountDocId(idempotencyKey: string): string {
  return "cyc_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}

function isActor(a: unknown): a is CycleCountActor {
  return isPlainObject(a) && (a.kind === "USER" || a.kind === "SYSTEM") && isNonEmptyString(a.id);
}

// Serialize a validated CREATE value (with its server-computed expected snapshot already attached) into
// the stored OPEN/version-1 record.
export function serializeCycleCount(value: CycleCountValue, actor: CycleCountActor, now: Date, fingerprint: string): Record<string, unknown> {
  return {
    schemaVersion: CYCLE_COUNT_SCHEMA_VERSION,
    partId: value.partId,
    trackingMode: value.trackingMode,
    location: { type: value.location.type, locationId: value.location.locationId },
    expectedQuantity: value.expectedQuantity,
    ...(value.expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers: [...value.expectedSerialNumbers] }),
    status: "OPEN" as CycleCountStatus,
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

// Build the fields for the submitCycleCount transition (OPEN -> COUNTED): records counted values +
// computed variance evidence. Never touches the create-time snapshot fields.
export function submitFields(
  nextVersion: number,
  actor: CycleCountActor,
  now: Date,
  countedQuantity: number | undefined,
  countedSerialNumbers: readonly string[] | undefined,
  variance: number | undefined,
  serialVariance: SerialVariance | undefined,
): Record<string, unknown> {
  return {
    status: "COUNTED" as CycleCountStatus,
    version: nextVersion,
    updatedAt: Timestamp.fromDate(now),
    updatedBy: actor.id,
    ...(countedQuantity === undefined ? {} : { countedQuantity }),
    ...(countedSerialNumbers === undefined ? {} : { countedSerialNumbers: [...countedSerialNumbers] }),
    ...(variance === undefined ? {} : { variance }),
    ...(serialVariance === undefined ? {} : { serialVariance: { missing: [...serialVariance.missing], unexpected: [...serialVariance.unexpected] } }),
  };
}

// Build the fields for the reconcileCycleCount transition (COUNTED -> RECONCILED).
export function reconcileFields(
  nextVersion: number,
  actor: CycleCountActor,
  now: Date,
  reason: string | null,
  ledgerEventIds: readonly string[],
): Record<string, unknown> {
  return {
    status: "RECONCILED" as CycleCountStatus,
    version: nextVersion,
    updatedAt: Timestamp.fromDate(now),
    updatedBy: actor.id,
    ...(reason === null ? {} : { reconciliationReason: reason }),
    reconciledAt: Timestamp.fromDate(now),
    reconciledBy: actor.id,
    ledgerEventIds: [...ledgerEventIds],
  };
}

export function cancelFields(nextVersion: number, actor: CycleCountActor, now: Date): Record<string, unknown> {
  return { status: "CANCELLED" as CycleCountStatus, version: nextVersion, updatedAt: Timestamp.fromDate(now), updatedBy: actor.id };
}

const STORED_KEYS = new Set([
  "schemaVersion", "partId", "trackingMode", "location", "expectedQuantity", "expectedSerialNumbers",
  "status", "version", "idempotencyKey", "actor", "createdAt", "createdBy", "updatedAt", "updatedBy",
  "fingerprint", "countedQuantity", "countedSerialNumbers", "variance", "serialVariance",
  "reconciliationReason", "reconciledAt", "reconciledBy", "ledgerEventIds",
]);

// Fail-closed deserialize of a stored cycle_counts record. Never normalizes malformed data into
// validity -- throws CycleCountMalformedStoredRecordError on anything unexpected.
export function deserializeCycleCount(docId: string, data: unknown): DeserializedCycleCount {
  if (!isPlainObject(data)) throw new CycleCountMalformedStoredRecordError("stored cycle count is not an object");
  if (data.schemaVersion !== CYCLE_COUNT_SCHEMA_VERSION) throw new CycleCountMalformedStoredRecordError("stored schemaVersion invalid");
  if (Object.keys(data).some((k) => !STORED_KEYS.has(k))) throw new CycleCountMalformedStoredRecordError("stored record has unknown field");

  if (!isNonEmptyString(data.partId)) throw new CycleCountMalformedStoredRecordError("stored partId invalid");
  if (typeof data.trackingMode !== "string" || !(CYCLE_COUNT_SUPPORTED_TRACKING_MODES as readonly string[]).includes(data.trackingMode)) {
    throw new CycleCountMalformedStoredRecordError("stored trackingMode invalid");
  }
  const trackingMode = data.trackingMode as CycleCountTrackingMode;
  const location = validateCycleCountLocationRef(data.location);
  if (location === null) throw new CycleCountMalformedStoredRecordError("stored location invalid");

  if (typeof data.expectedQuantity !== "number" || !Number.isInteger(data.expectedQuantity) || data.expectedQuantity < 0) {
    throw new CycleCountMalformedStoredRecordError("stored expectedQuantity invalid");
  }
  let expectedSerialNumbers: string[] | undefined;
  if (trackingMode === "SERIAL") {
    if (!Array.isArray(data.expectedSerialNumbers)) throw new CycleCountMalformedStoredRecordError("stored SERIAL count has no expectedSerialNumbers");
    const serials = data.expectedSerialNumbers as unknown[];
    if (!serials.every((s) => isNonEmptyString(s))) throw new CycleCountMalformedStoredRecordError("stored expectedSerialNumbers invalid");
    if (new Set(serials as string[]).size !== serials.length) throw new CycleCountMalformedStoredRecordError("stored expectedSerialNumbers contain duplicates");
    if (serials.length !== data.expectedQuantity) throw new CycleCountMalformedStoredRecordError("stored expectedSerialNumbers count does not match expectedQuantity");
    expectedSerialNumbers = [...(serials as string[])];
  } else if (data.expectedSerialNumbers !== undefined) {
    throw new CycleCountMalformedStoredRecordError("stored NONE count must not carry expectedSerialNumbers");
  }

  if (typeof data.status !== "string" || !(CYCLE_COUNT_STATUSES as readonly string[]).includes(data.status)) {
    throw new CycleCountMalformedStoredRecordError("stored status invalid");
  }
  if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < 1) {
    throw new CycleCountMalformedStoredRecordError("stored version invalid");
  }
  if (!isNonEmptyString(data.idempotencyKey)) throw new CycleCountMalformedStoredRecordError("stored idempotencyKey invalid");
  if (!isActor(data.actor)) throw new CycleCountMalformedStoredRecordError("stored actor invalid");
  if (!isNonEmptyString(data.createdBy) || !isNonEmptyString(data.updatedBy)) throw new CycleCountMalformedStoredRecordError("stored createdBy/updatedBy invalid");
  if (!(data.createdAt instanceof Timestamp) || !(data.updatedAt instanceof Timestamp)) throw new CycleCountMalformedStoredRecordError("stored timestamps are not server Timestamps");
  if (typeof data.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(data.fingerprint)) throw new CycleCountMalformedStoredRecordError("stored fingerprint invalid");

  const value: CycleCountValue = {
    partId: data.partId,
    trackingMode,
    location,
    expectedQuantity: data.expectedQuantity,
    ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers }),
    idempotencyKey: data.idempotencyKey,
  };

  let countedQuantity: number | undefined;
  if (data.countedQuantity !== undefined) {
    if (typeof data.countedQuantity !== "number" || !Number.isInteger(data.countedQuantity) || data.countedQuantity < 0) {
      throw new CycleCountMalformedStoredRecordError("stored countedQuantity invalid");
    }
    countedQuantity = data.countedQuantity;
  }
  let countedSerialNumbers: string[] | undefined;
  if (data.countedSerialNumbers !== undefined) {
    if (!Array.isArray(data.countedSerialNumbers) || !data.countedSerialNumbers.every((s) => isNonEmptyString(s))) {
      throw new CycleCountMalformedStoredRecordError("stored countedSerialNumbers invalid");
    }
    countedSerialNumbers = [...(data.countedSerialNumbers as string[])];
  }
  let variance: number | undefined;
  if (data.variance !== undefined) {
    if (typeof data.variance !== "number" || !Number.isInteger(data.variance)) throw new CycleCountMalformedStoredRecordError("stored variance invalid");
    variance = data.variance;
  }
  let serialVariance: SerialVariance | undefined;
  if (data.serialVariance !== undefined) {
    const sv = data.serialVariance;
    if (!isPlainObject(sv) || !Array.isArray(sv.missing) || !Array.isArray(sv.unexpected)) {
      throw new CycleCountMalformedStoredRecordError("stored serialVariance invalid");
    }
    if (!sv.missing.every((s) => isNonEmptyString(s)) || !sv.unexpected.every((s) => isNonEmptyString(s))) {
      throw new CycleCountMalformedStoredRecordError("stored serialVariance invalid");
    }
    serialVariance = { missing: [...(sv.missing as string[])], unexpected: [...(sv.unexpected as string[])] };
  }
  let reconciliationReason: string | undefined;
  if (data.reconciliationReason !== undefined) {
    if (!isNonEmptyString(data.reconciliationReason)) throw new CycleCountMalformedStoredRecordError("stored reconciliationReason invalid");
    reconciliationReason = data.reconciliationReason;
  }
  let reconciledAt: number | undefined;
  let reconciledBy: string | undefined;
  if (data.reconciledAt !== undefined || data.reconciledBy !== undefined) {
    if (!(data.reconciledAt instanceof Timestamp) || !isNonEmptyString(data.reconciledBy)) {
      throw new CycleCountMalformedStoredRecordError("stored reconciledAt/reconciledBy invalid");
    }
    reconciledAt = data.reconciledAt.toDate().getTime();
    reconciledBy = data.reconciledBy;
  }
  let ledgerEventIds: string[] | undefined;
  if (data.ledgerEventIds !== undefined) {
    if (!Array.isArray(data.ledgerEventIds) || !data.ledgerEventIds.every((s) => isNonEmptyString(s))) {
      throw new CycleCountMalformedStoredRecordError("stored ledgerEventIds invalid");
    }
    ledgerEventIds = [...(data.ledgerEventIds as string[])];
  }

  return {
    cycleCountId: docId,
    value,
    status: data.status as CycleCountStatus,
    version: data.version,
    actor: { kind: data.actor.kind, id: data.actor.id },
    createdAt: data.createdAt.toDate().getTime(),
    updatedAt: data.updatedAt.toDate().getTime(),
    createdBy: data.createdBy,
    updatedBy: data.updatedBy,
    schemaVersion: CYCLE_COUNT_SCHEMA_VERSION,
    fingerprint: data.fingerprint,
    ...(countedQuantity === undefined ? {} : { countedQuantity }),
    ...(countedSerialNumbers === undefined ? {} : { countedSerialNumbers }),
    ...(variance === undefined ? {} : { variance }),
    ...(serialVariance === undefined ? {} : { serialVariance }),
    ...(reconciliationReason === undefined ? {} : { reconciliationReason }),
    ...(reconciledAt === undefined ? {} : { reconciledAt }),
    ...(reconciledBy === undefined ? {} : { reconciledBy }),
    ...(ledgerEventIds === undefined ? {} : { ledgerEventIds }),
  };
}

export type { CycleCountLocationRef };
