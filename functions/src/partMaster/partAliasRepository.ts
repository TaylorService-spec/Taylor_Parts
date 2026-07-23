// INV-1 Phase 1, PR 1.3 -- part_aliases persistence contract (ADR-008
// Accepted / Decision #40). Trusted-service only; client-closed by Rules;
// tenant-inert. Alias documents carry identity authority ONLY -- no costs,
// stock, WO data, AI, tenant fields, history arrays, or Part snapshots.
//
// DOC IDENTITY: deterministic, from PR 1.1's buildAliasKey
// (`<type>__<normalizedValue>`, MPN embeds `<manufacturerId>|`), made
// storage-safe here by percent-encoding the two characters Firestore doc
// IDs cannot carry from our normalization charsets: "%" then "/". The
// encoding is deterministic and reversible; a future tenant scope prefixes
// the id under Issue #140 without redesign. Never a random or
// Firestore-generated ID; never derived from mutable display labels.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { ALIAS_STATUSES, ALIAS_TYPES } from "./types";
import type { AliasStatus, AliasType, ManufacturerId, PartAliasId, PartId } from "./types";
import { buildAliasKey, normalizeIdentifier } from "./normalization";
import { parseManufacturerId, parsePartId } from "./validation";
import { INITIAL_VERSION, MalformedStoredRecordError, type StoredMeta } from "./partMasterRepository";

export const PART_ALIASES_COLLECTION = "part_aliases";

/** Storage-safe deterministic alias document id from the PR 1.1 key. */
export function encodeAliasDocId(aliasKey: string): PartAliasId {
  return aliasKey.replace(/%/g, "%25").replace(/\//g, "%2F") as PartAliasId;
}

/** Derive the storage doc id for (type, raw value, scope) via the SINGLE
 * PR 1.1 normalization + key authority. Returns null on invalid input. */
export function deriveAliasDocId(
  aliasType: AliasType,
  rawValue: string,
  manufacturerId?: ManufacturerId
): { docId: PartAliasId; normalizedValue: string } | null {
  const normalized = normalizeIdentifier(aliasType, rawValue, manufacturerId);
  if (!normalized.valid) return null;
  const key = buildAliasKey(aliasType, normalized.value);
  if (!key.valid) return null;
  return { docId: encodeAliasDocId(key.value), normalizedValue: normalized.value };
}

export interface StoredPartAlias extends StoredMeta {
  readonly aliasId: PartAliasId;
  readonly partId: PartId;
  readonly aliasType: AliasType;
  readonly originalValue: string;
  readonly normalizedValue: string;
  readonly status: AliasStatus;
  readonly source: string;
  readonly manufacturerId?: ManufacturerId;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly deactivatedAt?: Date;
  readonly deactivatedBy?: string;
}

export function aliasToFirestore(a: StoredPartAlias): Record<string, unknown> {
  return {
    aliasId: a.aliasId,
    partId: a.partId,
    aliasType: a.aliasType,
    originalValue: a.originalValue,
    normalizedValue: a.normalizedValue,
    status: a.status,
    source: a.source,
    ...(a.manufacturerId !== undefined ? { manufacturerId: a.manufacturerId } : {}),
    ...(a.effectiveFrom !== undefined ? { effectiveFrom: a.effectiveFrom } : {}),
    ...(a.effectiveTo !== undefined ? { effectiveTo: a.effectiveTo } : {}),
    ...(a.deactivatedAt !== undefined ? { deactivatedAt: Timestamp.fromDate(a.deactivatedAt) } : {}),
    ...(a.deactivatedBy !== undefined ? { deactivatedBy: a.deactivatedBy } : {}),
    version: a.version,
    createdAt: Timestamp.fromDate(a.createdAt),
    createdBy: a.createdBy,
    updatedAt: Timestamp.fromDate(a.updatedAt),
    updatedBy: a.updatedBy,
  };
}

export function aliasFromFirestore(docId: string, data: Record<string, unknown> | undefined): StoredPartAlias {
  if (data === undefined) throw new MalformedStoredRecordError(`alias ${docId} has no data`);
  if (data.aliasId !== docId) {
    throw new MalformedStoredRecordError(`alias document ${docId} carries mismatched aliasId ${String(data.aliasId)}`);
  }
  if (typeof data.aliasType !== "string" || !(ALIAS_TYPES as readonly string[]).includes(data.aliasType)) {
    throw new MalformedStoredRecordError(`alias ${docId} has unknown aliasType ${String(data.aliasType)}`);
  }
  const partId = parsePartId(data.partId);
  if (!partId.valid) throw new MalformedStoredRecordError(`alias ${docId} has malformed partId`);
  if (typeof data.originalValue !== "string" || typeof data.normalizedValue !== "string") {
    throw new MalformedStoredRecordError(`alias ${docId} is missing identifier values`);
  }
  let manufacturerId: ManufacturerId | undefined;
  if (data.manufacturerId !== undefined) {
    const m = parseManufacturerId(data.manufacturerId);
    if (!m.valid) throw new MalformedStoredRecordError(`alias ${docId} has malformed manufacturerId`);
    manufacturerId = m.value;
  }
  const aliasType = data.aliasType as AliasType;
  if (aliasType === "MANUFACTURER_PN" && manufacturerId === undefined) {
    throw new MalformedStoredRecordError(`alias ${docId} is MANUFACTURER_PN without manufacturer scope`);
  }
  if (aliasType !== "MANUFACTURER_PN" && manufacturerId !== undefined) {
    throw new MalformedStoredRecordError(`alias ${docId} carries a forbidden manufacturer scope for ${aliasType}`);
  }
  // Normalized-value integrity: re-derive from the original via the single
  // authority; a mismatch means the stored record drifted -- surfaced,
  // never silently renormalized.
  const derived = deriveAliasDocId(aliasType, data.originalValue, manufacturerId);
  if (derived === null || derived.normalizedValue !== data.normalizedValue || derived.docId !== docId) {
    throw new MalformedStoredRecordError(`alias ${docId} normalized-value/id integrity failure`);
  }
  if (typeof data.status !== "string" || !(ALIAS_STATUSES as readonly string[]).includes(data.status)) {
    throw new MalformedStoredRecordError(`alias ${docId} has invalid status ${String(data.status)}`);
  }
  const { version, createdAt, createdBy, updatedAt, updatedBy } = data;
  if (
    typeof version !== "number" || !Number.isInteger(version) || version < INITIAL_VERSION ||
    !(createdAt instanceof Timestamp) || !(updatedAt instanceof Timestamp) ||
    typeof createdBy !== "string" || typeof updatedBy !== "string"
  ) {
    throw new MalformedStoredRecordError(`alias ${docId} has malformed version/audit metadata`);
  }
  return {
    aliasId: docId as PartAliasId,
    partId: partId.value,
    aliasType,
    originalValue: data.originalValue,
    normalizedValue: data.normalizedValue,
    status: data.status as AliasStatus,
    source: typeof data.source === "string" ? data.source : "unknown",
    ...(manufacturerId !== undefined ? { manufacturerId } : {}),
    ...(typeof data.effectiveFrom === "string" ? { effectiveFrom: data.effectiveFrom } : {}),
    ...(typeof data.effectiveTo === "string" ? { effectiveTo: data.effectiveTo } : {}),
    ...(data.deactivatedAt instanceof Timestamp ? { deactivatedAt: data.deactivatedAt.toDate() } : {}),
    ...(typeof data.deactivatedBy === "string" ? { deactivatedBy: data.deactivatedBy } : {}),
    version,
    createdAt: createdAt.toDate(),
    createdBy,
    updatedAt: updatedAt.toDate(),
    updatedBy,
  };
}

// Narrow, storage-independent repository (no list/search, no delete).
export interface PartAliasRepository {
  getByAliasId(txn: Transaction | null, aliasId: PartAliasId): Promise<StoredPartAlias | null>;
  stageCreate(txn: Transaction, stored: StoredPartAlias): void;
  stageUpdate(txn: Transaction, stored: StoredPartAlias): void;
}

export function buildFirestorePartAliasRepository(db: Firestore): PartAliasRepository {
  const ref = (id: PartAliasId) => db.collection(PART_ALIASES_COLLECTION).doc(id);
  return {
    async getByAliasId(txn, aliasId) {
      const snap = txn ? await txn.get(ref(aliasId)) : await ref(aliasId).get();
      if (!snap.exists) return null;
      return aliasFromFirestore(snap.id, snap.data());
    },
    stageCreate(txn, stored) {
      txn.create(ref(stored.aliasId), aliasToFirestore(stored));
    },
    stageUpdate(txn, stored) {
      txn.set(ref(stored.aliasId), aliasToFirestore(stored));
    },
  };
}
