// THE REORDER SNAPSHOT -- the legacy Firestore Reorder documents, as a file, and the pure mappers that hand them to
// the three EXISTING copy modules (functions/scripts/reorderCutover.js runs census / copy / verify on it).
//
// MIGRATION_ONLY. Pure: no database, no Firebase, no I/O, no clock. It decides nothing about WHAT may be copied --
// reorderObjectMigration.ts, reorderAssignmentMigration.ts and reorderPurchaseOrderMigration.ts own every
// classification, and this module only parses the file and reshapes it into their source inputs, unchanged.
//
// ════════════════════ WHY A FILE ════════════════════
//
// Same reason as the catalog snapshot (catalogMaster/catalogSnapshot.ts): the PostgreSQL side of the cutover never
// loads a Firebase module. The Firestore read is a separate, read-only export step that writes this file and its
// immutable `<file>.sha256`; census, copy and verify consume the file. The exact bytes that were copied are then a
// durable, hashable artifact rather than a moment in a live collection.
//
// ════════════════════ THE FORMAT (version 1) ════════════════════
//
//   { "format": "EOS_REORDER_SNAPSHOT", "version": 1,
//     "source": { "firebaseProjectId": "<project>", "exportedAt": "<ISO-8601 instant>" },
//     "counts": { "reorder_requests": <n>, "reorder_purchase_orders": <n>, "reorder_purchase_order_voids": <n> },
//     "collections": {
//       "reorder_requests":             [ { "id": "<document id>", "data": { ...document fields } }, ... ],
//       "reorder_purchase_orders":      [ { "id": "<document id>", "data": { ...document fields } }, ... ],
//       "reorder_purchase_order_voids": [ { "id": "<document id>", "data": { ...document fields } }, ... ] } }
//
// EXACTLY those three collections, all three present (an empty list is a true statement; an absent one is not), and
// `counts` must equal each list's length. A document is exactly `{ id, data }`.
//
// ════════════════════ INSTANTS ════════════════════
//
// The Reorder callables write every instant (`createdAt`, `reviewedAt`, `purchasingStartedAt`,
// `lastPurchasingUpdateAt`, `cancelledAt`, `receivedAt`, ...) as EPOCH MILLISECONDS -- firestore.rules asserts
// `createdAt is number` -- so in this file an instant is a plain JSON number, exactly as stored. The object
// classifier (reorderObjectMigration.ts#instant) accepts a positive safe-integer epoch-millisecond number or an ISO
// `yyyy-mm-ddT...` string and REFUSES anything else with INVALID_INSTANT.
//
// A Firestore Timestamp is encoded by the migration-only Reorder exporter (which reuses the catalog snapshot's
// encoder) as { "$timestamp": { "seconds": <int>, "nanoseconds": <int> } }. The mappers DECODE exactly that tag, on a
// top-level field, to the ISO instant it denotes (millisecond precision -- the legacy writers stored milliseconds, so
// only sub-millisecond digits a Timestamp might carry are dropped). Any other shape is passed through unchanged and the
// classifier refuses it (INVALID_INSTANT) -- nothing is guessed. The census still reports how many encoded values each
// field carried, so the operator sees them before copying.
// Purchase-order dates (`orderedDate`, `expectedArrivalDate`) are ISO calendar-day STRINGS in Firestore and are
// read by purchasingMigrationMapping.ts#isoCalendarDay, which refuses every other shape.
//
// ════════════════════ WHAT THE MAPPERS DERIVE, AND WHAT THEY DO NOT ════════════════════
//
//   objects      every `reorder_requests` document, as { id, data }.
//   assignments  one row per `reorder_requests` document whose `assignedToUserId` is PRESENT (not null/absent), as
//                { reorderRequestId: <doc id>, assignedToUserId, assignedBy, assignedAt } -- raw values, so the assignment
//                classifier sees a blank or non-string assignee and refuses it (REMEDIATION_REQUIRED) itself.
//   purchasing   `reorder_purchase_orders` and `reorder_purchase_order_voids` as { id, data }, and the request
//                back-links: reorder id -> its `purchaseOrderId`, EXACTLY as the source states it (absent stays
//                absent), which the purchase-order classifier checks as the third statement of the PO identity.
//
// Nothing is repaired, defaulted, trimmed or filtered here. A problem is a classifier finding, never a mapper fix.

import type { LegacyReorderDocument } from "./reorderObjectMigration.js";
import type { LegacyReorderAssignment } from "./reorderAssignmentMigration.js";
import type { PurchasingMigrationSource } from "./reorderPurchaseOrderMigrationCopy.js";

export const REORDER_SNAPSHOT_FORMAT = "EOS_REORDER_SNAPSHOT";
export const REORDER_SNAPSHOT_VERSION = 1;

/** The three legacy Firestore collections, in foreign-key order. Nothing else is accepted. */
export const REORDER_SNAPSHOT_COLLECTIONS = Object.freeze([
  "reorder_requests", "reorder_purchase_orders", "reorder_purchase_order_voids",
] as const);
export type ReorderSnapshotCollection = (typeof REORDER_SNAPSHOT_COLLECTIONS)[number];

/** The customer production project. A production snapshot is never a nonprod cutover input. */
export const PRODUCTION_FIREBASE_PROJECT_ID = "taylor-parts";
/** The frozen Certification world. It is neither read as a source nor written as a target. */
export const CERTIFICATION_FIREBASE_PROJECT_ID = "eos-platform-certification";

/** The governed Reorder status vocabulary (purchasingMigrationMapping.ts OPS_REORDER_REQUEST_STATUSES). */
const GOVERNED_STATUSES = new Set([
  "PENDING_REVIEW", "APPROVED", "REJECTED",
  "READY_FOR_PARTS_MANAGER", "ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS",
  "ORDERED", "RECEIVED", "CANCELLED", "VOIDED",
]);

export class ReorderSnapshotError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReorderSnapshotError";
  }
}

export interface ReorderSnapshotDocument {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ReorderSnapshot {
  readonly source: { readonly firebaseProjectId: string; readonly exportedAt: string };
  readonly counts: Readonly<Record<ReorderSnapshotCollection, number>>;
  readonly collections: Readonly<Record<ReorderSnapshotCollection, readonly ReorderSnapshotDocument[]>>;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

const TOP_LEVEL_KEYS = new Set(["format", "version", "source", "counts", "collections"]);
const isCollection = (k: string): k is ReorderSnapshotCollection =>
  (REORDER_SNAPSHOT_COLLECTIONS as readonly string[]).includes(k);

/**
 * Structural parse and validation. Content problems (a bad status, an unresolvable uid) are classifier findings,
 * not parse errors; everything that makes the FILE untrustworthy is refused here.
 */
export function parseReorderSnapshot(json: unknown): ReorderSnapshot {
  if (!isPlain(json) || json.format !== REORDER_SNAPSHOT_FORMAT || json.version !== REORDER_SNAPSHOT_VERSION) {
    throw new ReorderSnapshotError("SNAPSHOT_FORMAT_INVALID", `not an ${REORDER_SNAPSHOT_FORMAT} version ${REORDER_SNAPSHOT_VERSION} file`);
  }
  for (const key of Object.keys(json)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new ReorderSnapshotError("SNAPSHOT_FORMAT_INVALID", `unknown top-level key '${key}'`);
  }

  const source = json.source;
  if (!isPlain(source) || typeof source.firebaseProjectId !== "string" || source.firebaseProjectId === ""
    || typeof source.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(source.exportedAt)
    || Number.isNaN(Date.parse(source.exportedAt))) {
    throw new ReorderSnapshotError("SNAPSHOT_FORMAT_INVALID", "source.firebaseProjectId and an ISO source.exportedAt are required");
  }
  if (source.firebaseProjectId === PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new ReorderSnapshotError("SNAPSHOT_PRODUCTION_SOURCE",
      `the snapshot was exported from the production project '${PRODUCTION_FIREBASE_PROJECT_ID}'; refused`);
  }
  if (source.firebaseProjectId === CERTIFICATION_FIREBASE_PROJECT_ID) {
    throw new ReorderSnapshotError("SNAPSHOT_CERTIFICATION_SOURCE",
      `the snapshot was exported from the frozen Certification project '${CERTIFICATION_FIREBASE_PROJECT_ID}'; refused`);
  }

  const counts = json.counts;
  const collections = json.collections;
  if (!isPlain(counts)) throw new ReorderSnapshotError("SNAPSHOT_FORMAT_INVALID", "counts must be an object");
  if (!isPlain(collections)) throw new ReorderSnapshotError("SNAPSHOT_FORMAT_INVALID", "collections must be an object");
  for (const key of [...Object.keys(counts), ...Object.keys(collections)]) {
    if (!isCollection(key)) {
      throw new ReorderSnapshotError("SNAPSHOT_UNKNOWN_COLLECTION",
        `'${key}' is not one of ${REORDER_SNAPSHOT_COLLECTIONS.join(", ")}`);
    }
  }

  const parsedCounts = {} as Record<ReorderSnapshotCollection, number>;
  const parsedCollections = {} as Record<ReorderSnapshotCollection, readonly ReorderSnapshotDocument[]>;
  for (const name of REORDER_SNAPSHOT_COLLECTIONS) {
    const list = collections[name];
    if (!Array.isArray(list)) throw new ReorderSnapshotError("SNAPSHOT_FORMAT_INVALID", `collections.${name} must be a list`);
    const declared = counts[name];
    if (!Number.isSafeInteger(declared) || (declared as number) < 0) {
      throw new ReorderSnapshotError("SNAPSHOT_FORMAT_INVALID", `counts.${name} must be a whole number >= 0`);
    }
    if (declared !== list.length) {
      throw new ReorderSnapshotError("SNAPSHOT_COUNT_MISMATCH",
        `counts.${name} declares ${String(declared)} but the file holds ${list.length}`);
    }
    const seen = new Set<string>();
    parsedCollections[name] = Object.freeze(list.map((d, i): ReorderSnapshotDocument => {
      if (!isPlain(d) || Object.keys(d).length !== 2 || typeof d.id !== "string" || d.id === "" || !isPlain(d.data)) {
        throw new ReorderSnapshotError("SNAPSHOT_FORMAT_INVALID", `collections.${name}[${i}] must be exactly { id, data }`);
      }
      if (seen.has(d.id)) {
        throw new ReorderSnapshotError("SNAPSHOT_DUPLICATE_ID", `collections.${name} holds document id '${d.id}' more than once`);
      }
      seen.add(d.id);
      return Object.freeze({ id: d.id, data: d.data });
    }));
    parsedCounts[name] = list.length;
  }

  return Object.freeze({
    source: Object.freeze({ firebaseProjectId: source.firebaseProjectId, exportedAt: source.exportedAt }),
    counts: Object.freeze(parsedCounts),
    collections: Object.freeze(parsedCollections),
  });
}

// ---------------------------------------------------------------------------------------------
// The mappers. Shapes only -- each returns exactly the source input its copy module already takes.
// ---------------------------------------------------------------------------------------------

/** `{ $timestamp: { seconds, nanoseconds } }` with integer parts in range -> the ISO instant; anything else -> as-is. */
function decodeTimestampTag(v: unknown): unknown {
  if (!isPlain(v) || Object.keys(v).length !== 1 || !isPlain(v.$timestamp)) return v;
  const t = v.$timestamp as Record<string, unknown>;
  const seconds = t.seconds; const nanos = t.nanoseconds;
  if (Object.keys(t).length !== 2 || !Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanos)) return v;
  if ((nanos as number) < 0 || (nanos as number) > 999_999_999 || (seconds as number) <= 0) return v;
  return new Date((seconds as number) * 1000 + Math.floor((nanos as number) / 1_000_000)).toISOString();
}

/** A document's top-level fields with every encoded Timestamp decoded. Never mutates the snapshot. */
function decoded(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, decodeTimestampTag(v)]));
}

/** reorderObjectMigration.ts LegacyReorderDocument[] */
export function toReorderObjectSource(snapshot: ReorderSnapshot): LegacyReorderDocument[] {
  return snapshot.collections.reorder_requests.map((d) => ({ id: d.id, data: decoded(d.data) }));
}

/** reorderAssignmentMigration.ts LegacyReorderAssignment[] -- one per Reorder that states an assignee. */
export function toReorderAssignmentSource(snapshot: ReorderSnapshot): LegacyReorderAssignment[] {
  return snapshot.collections.reorder_requests
    .filter((d) => d.data.assignedToUserId !== null && d.data.assignedToUserId !== undefined)
    .map((d) => ({
      reorderRequestId: d.id,
      assignedToUserId: d.data.assignedToUserId,
      assignedBy: d.data.assignedBy === undefined ? null : d.data.assignedBy,
      assignedAt: d.data.assignedAt === undefined ? null : decodeTimestampTag(d.data.assignedAt),
    }));
}

/** reorderPurchaseOrderMigrationCopy.ts PurchasingMigrationSource */
export function toPurchasingSource(snapshot: ReorderSnapshot): PurchasingMigrationSource {
  return {
    purchaseOrders: snapshot.collections.reorder_purchase_orders.map((d) => ({ id: d.id, data: decoded(d.data) })),
    voids: snapshot.collections.reorder_purchase_order_voids.map((d) => ({ id: d.id, data: decoded(d.data) })),
    // Every source Reorder is present in the map (SOURCE_REORDER_REQUEST_ABSENT depends on it), carrying its
    // back-link exactly as stated -- including `undefined` when the field is absent.
    requestBackLinks: new Map(snapshot.collections.reorder_requests.map((d) => [d.id, d.data.purchaseOrderId])),
  };
}

// ---------------------------------------------------------------------------------------------
// The file census: counts and shapes only. No field VALUE leaves this function except governed statuses.
// ---------------------------------------------------------------------------------------------

const isEncodedTimestamp = (v: unknown): boolean => isPlain(v) && Object.keys(v).length === 1 && isPlain(v.$timestamp);

export interface ReorderSnapshotCensus {
  readonly counts: Readonly<Record<ReorderSnapshotCollection, number>>;
  /** Reorder status distribution. A status outside the governed vocabulary is bucketed, never echoed. */
  readonly statusDistribution: Readonly<Record<string, number>>;
  /** How many Reorders state an assignee (the assignment stage's source rows). */
  readonly statedAssignments: number;
  /** `collection.field` -> count of Firestore-Timestamp-encoded values (decoded to instants by the mappers). */
  readonly encodedTimestampFields: Readonly<Record<string, number>>;
}

export function censusReorderSnapshot(snapshot: ReorderSnapshot): ReorderSnapshotCensus {
  const statusDistribution: Record<string, number> = {};
  for (const d of snapshot.collections.reorder_requests) {
    const s = d.data.status;
    const bucket = typeof s === "string" && GOVERNED_STATUSES.has(s) ? s : s === undefined || s === null ? "(ABSENT)" : "(UNGOVERNED)";
    statusDistribution[bucket] = (statusDistribution[bucket] ?? 0) + 1;
  }
  const encodedTimestampFields: Record<string, number> = {};
  for (const name of REORDER_SNAPSHOT_COLLECTIONS) {
    for (const d of snapshot.collections[name]) {
      for (const [field, value] of Object.entries(d.data)) {
        if (isEncodedTimestamp(value)) encodedTimestampFields[`${name}.${field}`] = (encodedTimestampFields[`${name}.${field}`] ?? 0) + 1;
      }
    }
  }
  const sorted = (o: Record<string, number>) => Object.freeze(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
  return Object.freeze({
    counts: snapshot.counts,
    statusDistribution: sorted(statusDistribution),
    statedAssignments: toReorderAssignmentSource(snapshot).length,
    encodedTimestampFields: sorted(encodedTimestampFields),
  });
}
