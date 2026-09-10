// Cycle Count A1 -- the SHEET / LINE stored shape (schema v2), per the Owner-approved A1 Revision 2
// (docs/specifications/cycle-count-multi-part-sheet.md, Decision #179).
//
//   cycle_counts/{sheetId}                 schemaVersion 2 -- location, lifecycle, identity, audit
//   cycle_counts/{sheetId}/lines/{lineId}  schemaVersion 1 -- one per Part: expected snapshot, count,
//                                          variance, disposition, ledger evidence
//
// STRICT VERSION BOUNDARY (M-1). v1 records stay in the same collection as inert history. A sheet id is
// "ccs_" + sha256(idempotencyKey), never v1's "cyc_" derivation, so a v2 sheet can never land on a v1
// document; every reader here refuses anything that is not exactly schema v2 / line v1. There is no v1
// reader in this module and none may be added (no dual reader, no v1 -> v2 interpretation).
//
// Fail-closed deserialize: unknown fields, missing invariants or a wrong schema are
// CycleCountMalformedStoredRecordError -- never "normalized" into validity, never UNKNOWN turned into 0.

import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { isOperatingCompanyIdShape } from "../ownership/operatingCompanyAuthority.js";
import {
  CycleCountMalformedStoredRecordError,
  CYCLE_COUNT_SUPPORTED_TRACKING_MODES,
  CYCLE_COUNT_REVIEW_DECISIONS,
  type CycleCountActor,
  type CycleCountLocationRef,
  type CycleCountTrackingMode,
  type CycleCountReviewDecision,
  type SerialVariance,
} from "./cycleCountTypes.js";
import { validateCycleCountLocationRef, isPlainObject, isNonEmptyString } from "./cycleCountValidation.js";

export const CYCLE_COUNT_SHEET_SCHEMA_VERSION = 2;
export const CYCLE_COUNT_LINE_SCHEMA_VERSION = 1;
export const CYCLE_COUNT_LINES_SUBCOLLECTION = "lines";

export const SHEET_STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];
export const LINE_STATUSES = ["OPEN", "COUNTED", "RECONCILED", "REJECTED", "CANCELLED"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export interface CycleCountSheet {
  readonly sheetId: string;
  readonly location: CycleCountLocationRef;
  readonly status: SheetStatus;
  readonly version: number;
  readonly idempotencyKey: string;
  readonly actor: CycleCountActor;
  readonly createdAt: number;
  readonly createdBy: string;
  readonly updatedAt: number;
  readonly updatedBy: string;
  readonly fingerprint: string;
  /** Ownership Model v1: inherited from the counted location's governed Warehouse, immutable. */
  readonly operatingCompanyId?: string;
  readonly closedAt?: number;
  readonly closedBy?: string;
}

export interface CycleCountLine {
  readonly sheetId: string;
  readonly lineId: string;
  readonly partId: string;
  readonly trackingMode: CycleCountTrackingMode;
  readonly expectedQuantity: number;
  readonly expectedSerialNumbers?: readonly string[];
  /** The ACTUAL instant this line's expected value was computed. There is no sheet-level instant. */
  readonly expectedSnapshotAt: number;
  readonly status: LineStatus;
  readonly version: number;
  readonly fingerprint: string;
  readonly openedBy: string;
  readonly openedAt: number;
  readonly updatedAt: number;
  readonly updatedBy: string;
  readonly countedQuantity?: number;
  readonly countedSerialNumbers?: readonly string[];
  readonly variance?: number;
  readonly serialVariance?: SerialVariance;
  readonly submittedBy?: string;
  readonly submittedAt?: number;
  readonly reviewDecision?: CycleCountReviewDecision;
  readonly reconciliationReason?: string;
  readonly reconciledAt?: number;
  readonly reconciledBy?: string;
  readonly ledgerEventIds?: readonly string[];
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

export const cycleCountSheetId = (idempotencyKey: string) => "ccs_" + hash(["cycle-count-sheet", idempotencyKey]).slice(0, 40);
/** One Part, one addressable line per sheet: the path IS the one-part-one-line rule (D5). */
export const cycleCountLineId = (partId: string) => "ccl_" + hash(["cycle-count-line", partId]).slice(0, 40);

/** Request-derived identity ONLY -- server-computed values never participate (replay must not turn into conflict). */
export const fingerprintSheet = (location: CycleCountLocationRef, idempotencyKey: string) =>
  hash({ location: { type: location.type, locationId: location.locationId }, idempotencyKey }).slice(0, 16);
export const fingerprintLine = (partId: string, trackingMode: CycleCountTrackingMode) => hash({ partId, trackingMode }).slice(0, 16);

const ts = (ms: number) => Timestamp.fromMillis(ms);
function millis(v: unknown, field: string): number {
  if (!(v instanceof Timestamp)) throw new CycleCountMalformedStoredRecordError(`stored ${field} invalid`);
  return v.toMillis();
}
function optionalMillis(v: unknown, field: string): number | undefined {
  return v === undefined ? undefined : millis(v, field);
}
function sortedUniqueSerials(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || !v.every((s) => isNonEmptyString(s))) throw new CycleCountMalformedStoredRecordError(`stored ${field} invalid`);
  const out = [...(v as string[])];
  if (new Set(out).size !== out.length) throw new CycleCountMalformedStoredRecordError(`stored ${field} duplicate`);
  return out;
}

// ------------------------------------------------------------------ sheet
export function serializeNewSheet(
  sheetId: string, location: CycleCountLocationRef, idempotencyKey: string, actor: CycleCountActor, now: Date, operatingCompanyId: string | null,
): Record<string, unknown> {
  return {
    schemaVersion: CYCLE_COUNT_SHEET_SCHEMA_VERSION,
    location: { type: location.type, locationId: location.locationId },
    status: "OPEN",
    version: 1,
    idempotencyKey,
    actor: { kind: actor.kind, id: actor.id },
    createdAt: ts(now.getTime()), createdBy: actor.id,
    updatedAt: ts(now.getTime()), updatedBy: actor.id,
    fingerprint: fingerprintSheet(location, idempotencyKey),
    ...(operatingCompanyId ? { operatingCompanyId } : {}),
  };
}

const SHEET_KEYS = new Set([
  "schemaVersion", "location", "status", "version", "idempotencyKey", "actor", "createdAt", "createdBy",
  "updatedAt", "updatedBy", "fingerprint", "operatingCompanyId", "closedAt", "closedBy",
]);

export function deserializeSheet(sheetId: string, data: unknown): CycleCountSheet {
  if (!isPlainObject(data)) throw new CycleCountMalformedStoredRecordError("stored sheet is not an object");
  if (data.schemaVersion !== CYCLE_COUNT_SHEET_SCHEMA_VERSION) throw new CycleCountMalformedStoredRecordError("stored record is not a schema v2 sheet");
  if (Object.keys(data).some((k) => !SHEET_KEYS.has(k))) throw new CycleCountMalformedStoredRecordError("stored sheet has unknown field");
  const location = validateCycleCountLocationRef(data.location);
  if (location === null) throw new CycleCountMalformedStoredRecordError("stored location invalid");
  if (!(SHEET_STATUSES as readonly string[]).includes(data.status as string)) throw new CycleCountMalformedStoredRecordError("stored status invalid");
  if (!Number.isInteger(data.version) || (data.version as number) < 1) throw new CycleCountMalformedStoredRecordError("stored version invalid");
  if (!isNonEmptyString(data.idempotencyKey) || cycleCountSheetId(data.idempotencyKey) !== sheetId) throw new CycleCountMalformedStoredRecordError("stored idempotencyKey does not derive the sheet id");
  const actor = data.actor as Record<string, unknown> | undefined;
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !isNonEmptyString(actor.id)) throw new CycleCountMalformedStoredRecordError("stored actor invalid");
  if (!isNonEmptyString(data.createdBy) || !isNonEmptyString(data.updatedBy)) throw new CycleCountMalformedStoredRecordError("stored audit fields invalid");
  if (data.fingerprint !== fingerprintSheet(location, data.idempotencyKey)) throw new CycleCountMalformedStoredRecordError("stored sheet fingerprint mismatch");
  if (data.operatingCompanyId !== undefined && !isOperatingCompanyIdShape(data.operatingCompanyId)) throw new CycleCountMalformedStoredRecordError("stored operatingCompanyId invalid");
  const closed = data.status === "CLOSED";
  if (closed !== (data.closedAt !== undefined) || closed !== (data.closedBy !== undefined)) throw new CycleCountMalformedStoredRecordError("stored close fields inconsistent with status");
  return {
    sheetId,
    location,
    status: data.status as SheetStatus,
    version: data.version as number,
    idempotencyKey: data.idempotencyKey,
    actor: { kind: actor.kind as "USER" | "SYSTEM", id: actor.id as string },
    createdAt: millis(data.createdAt, "createdAt"),
    createdBy: data.createdBy,
    updatedAt: millis(data.updatedAt, "updatedAt"),
    updatedBy: data.updatedBy,
    fingerprint: data.fingerprint as string,
    ...(data.operatingCompanyId !== undefined ? { operatingCompanyId: data.operatingCompanyId as string } : {}),
    ...(closed ? { closedAt: millis(data.closedAt, "closedAt"), closedBy: data.closedBy as string } : {}),
  };
}

export const sheetStatusFields = (status: SheetStatus, nextVersion: number, actor: CycleCountActor, now: Date): Record<string, unknown> => ({
  status, version: nextVersion, updatedAt: ts(now.getTime()), updatedBy: actor.id,
  ...(status === "CLOSED" ? { closedAt: ts(now.getTime()), closedBy: actor.id } : {}),
});

// ------------------------------------------------------------------ line
export function serializeNewLine(
  partId: string, trackingMode: CycleCountTrackingMode, expectedQuantity: number, expectedSerialNumbers: readonly string[] | undefined,
  actor: CycleCountActor, now: Date,
): Record<string, unknown> {
  return {
    schemaVersion: CYCLE_COUNT_LINE_SCHEMA_VERSION,
    partId, trackingMode, expectedQuantity,
    ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers: [...expectedSerialNumbers] }),
    expectedSnapshotAt: ts(now.getTime()),
    status: "OPEN", version: 1,
    fingerprint: fingerprintLine(partId, trackingMode),
    openedBy: actor.id, openedAt: ts(now.getTime()),
    updatedAt: ts(now.getTime()), updatedBy: actor.id,
  };
}

const LINE_KEYS = new Set([
  "schemaVersion", "partId", "trackingMode", "expectedQuantity", "expectedSerialNumbers", "expectedSnapshotAt",
  "status", "version", "fingerprint", "openedBy", "openedAt", "updatedAt", "updatedBy",
  "countedQuantity", "countedSerialNumbers", "variance", "serialVariance", "submittedBy", "submittedAt",
  "reviewDecision", "reconciliationReason", "reconciledAt", "reconciledBy", "ledgerEventIds",
]);

export function deserializeLine(sheetId: string, lineId: string, data: unknown): CycleCountLine {
  if (!isPlainObject(data)) throw new CycleCountMalformedStoredRecordError("stored line is not an object");
  if (data.schemaVersion !== CYCLE_COUNT_LINE_SCHEMA_VERSION) throw new CycleCountMalformedStoredRecordError("stored line schemaVersion invalid");
  if (Object.keys(data).some((k) => !LINE_KEYS.has(k))) throw new CycleCountMalformedStoredRecordError("stored line has unknown field");
  if (!isNonEmptyString(data.partId) || cycleCountLineId(data.partId) !== lineId) throw new CycleCountMalformedStoredRecordError("stored partId does not derive the line id");
  if (!(CYCLE_COUNT_SUPPORTED_TRACKING_MODES as readonly string[]).includes(data.trackingMode as string)) throw new CycleCountMalformedStoredRecordError("stored trackingMode invalid");
  const trackingMode = data.trackingMode as CycleCountTrackingMode;
  if (data.fingerprint !== fingerprintLine(data.partId, trackingMode)) throw new CycleCountMalformedStoredRecordError("stored line fingerprint mismatch");
  if (!Number.isInteger(data.expectedQuantity) || (data.expectedQuantity as number) < 0) throw new CycleCountMalformedStoredRecordError("stored expectedQuantity invalid");
  let expectedSerialNumbers: string[] | undefined;
  if (trackingMode === "SERIAL") {
    expectedSerialNumbers = sortedUniqueSerials(data.expectedSerialNumbers, "expectedSerialNumbers");
    if (expectedSerialNumbers.length !== data.expectedQuantity) throw new CycleCountMalformedStoredRecordError("stored expected serial count mismatch");
  } else if (data.expectedSerialNumbers !== undefined) {
    throw new CycleCountMalformedStoredRecordError("NONE line must not carry expectedSerialNumbers");
  }
  if (!(LINE_STATUSES as readonly string[]).includes(data.status as string)) throw new CycleCountMalformedStoredRecordError("stored line status invalid");
  const status = data.status as LineStatus;
  if (!Number.isInteger(data.version) || (data.version as number) < 1) throw new CycleCountMalformedStoredRecordError("stored line version invalid");
  if (!isNonEmptyString(data.openedBy) || !isNonEmptyString(data.updatedBy)) throw new CycleCountMalformedStoredRecordError("stored line actors invalid");

  const submitted = status === "COUNTED" || status === "RECONCILED" || status === "REJECTED";
  const decided = status === "RECONCILED" || status === "REJECTED";
  const hasCounted = data.countedQuantity !== undefined || data.countedSerialNumbers !== undefined;
  if (submitted !== hasCounted || submitted !== isNonEmptyString(data.submittedBy) || submitted !== (data.submittedAt !== undefined)) {
    throw new CycleCountMalformedStoredRecordError("stored count fields inconsistent with status");
  }
  let countedQuantity: number | undefined;
  let countedSerialNumbers: string[] | undefined;
  let variance: number | undefined;
  let serialVariance: SerialVariance | undefined;
  if (submitted) {
    if (trackingMode === "NONE") {
      if (!Number.isInteger(data.countedQuantity) || (data.countedQuantity as number) < 0) throw new CycleCountMalformedStoredRecordError("stored countedQuantity invalid");
      countedQuantity = data.countedQuantity as number;
      if (data.variance !== countedQuantity - (data.expectedQuantity as number)) throw new CycleCountMalformedStoredRecordError("stored variance disagrees with counted - expected");
      variance = data.variance as number;
    } else {
      countedSerialNumbers = sortedUniqueSerials(data.countedSerialNumbers, "countedSerialNumbers");
      const sv = data.serialVariance as Record<string, unknown> | undefined;
      if (!isPlainObject(sv)) throw new CycleCountMalformedStoredRecordError("stored serialVariance invalid");
      serialVariance = { missing: sortedUniqueSerials(sv.missing, "missing"), unexpected: sortedUniqueSerials(sv.unexpected, "unexpected") };
    }
  }
  if (decided !== (data.reviewDecision !== undefined) || decided !== isNonEmptyString(data.reconciledBy) || decided !== (data.reconciledAt !== undefined) || decided !== Array.isArray(data.ledgerEventIds)) {
    throw new CycleCountMalformedStoredRecordError("stored disposition fields inconsistent with status");
  }
  if (decided) {
    if (!(CYCLE_COUNT_REVIEW_DECISIONS as readonly string[]).includes(data.reviewDecision as string)) throw new CycleCountMalformedStoredRecordError("stored reviewDecision invalid");
    if ((data.reviewDecision === "REJECT") !== (status === "REJECTED")) throw new CycleCountMalformedStoredRecordError("stored reviewDecision disagrees with status");
    if (!(data.ledgerEventIds as unknown[]).every((x) => isNonEmptyString(x))) throw new CycleCountMalformedStoredRecordError("stored ledgerEventIds invalid");
  }
  if (data.reconciliationReason !== undefined && !isNonEmptyString(data.reconciliationReason)) throw new CycleCountMalformedStoredRecordError("stored reason invalid");

  return {
    sheetId, lineId, partId: data.partId, trackingMode,
    expectedQuantity: data.expectedQuantity as number,
    ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers }),
    expectedSnapshotAt: millis(data.expectedSnapshotAt, "expectedSnapshotAt"),
    status, version: data.version as number, fingerprint: data.fingerprint as string,
    openedBy: data.openedBy, openedAt: millis(data.openedAt, "openedAt"),
    updatedAt: millis(data.updatedAt, "updatedAt"), updatedBy: data.updatedBy,
    ...(countedQuantity === undefined ? {} : { countedQuantity }),
    ...(countedSerialNumbers === undefined ? {} : { countedSerialNumbers }),
    ...(variance === undefined ? {} : { variance }),
    ...(serialVariance === undefined ? {} : { serialVariance }),
    ...(submitted ? { submittedBy: data.submittedBy as string, submittedAt: optionalMillis(data.submittedAt, "submittedAt") } : {}),
    ...(decided ? {
      reviewDecision: data.reviewDecision as CycleCountReviewDecision,
      reconciledAt: optionalMillis(data.reconciledAt, "reconciledAt"),
      reconciledBy: data.reconciledBy as string,
      ledgerEventIds: [...(data.ledgerEventIds as string[])],
    } : {}),
    ...(data.reconciliationReason === undefined ? {} : { reconciliationReason: data.reconciliationReason as string }),
  } as CycleCountLine;
}

export const lineSubmitFields = (
  line: CycleCountLine, actor: CycleCountActor, now: Date,
  counted: { countedQuantity: number; variance: number } | { countedSerialNumbers: readonly string[]; serialVariance: SerialVariance },
): Record<string, unknown> => ({
  status: "COUNTED", version: line.version + 1, updatedAt: ts(now.getTime()), updatedBy: actor.id,
  submittedBy: actor.id, submittedAt: ts(now.getTime()),
  ...("countedQuantity" in counted
    ? { countedQuantity: counted.countedQuantity, variance: counted.variance }
    : { countedSerialNumbers: [...counted.countedSerialNumbers].sort(), serialVariance: counted.serialVariance }),
});

export const lineDecisionFields = (
  line: CycleCountLine, actor: CycleCountActor, now: Date, decision: CycleCountReviewDecision, reason: string | null, ledgerEventIds: readonly string[],
): Record<string, unknown> => ({
  status: decision === "REJECT" ? "REJECTED" : "RECONCILED", version: line.version + 1,
  updatedAt: ts(now.getTime()), updatedBy: actor.id,
  reviewDecision: decision, reconciledAt: ts(now.getTime()), reconciledBy: actor.id,
  ledgerEventIds: [...ledgerEventIds],
  ...(reason ? { reconciliationReason: reason } : {}),
});

export const lineCancelFields = (line: CycleCountLine, actor: CycleCountActor, now: Date): Record<string, unknown> => ({
  status: "CANCELLED", version: line.version + 1, updatedAt: ts(now.getTime()), updatedBy: actor.id,
});

export { isPlainObject, isNonEmptyString };
