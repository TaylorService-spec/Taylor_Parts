// INV-1 Phase 1, PR 1.2 -- canonical Part/Manufacturer repository contracts
// and Firestore adapters (ADR-008 Accepted / Decision #40).
//
// Storage-independent interfaces + strict Firestore (Admin SDK) adapters.
// Document identity IS domain identity: parts/{partId}, manufacturers/
// {manufacturerId} -- never derived from mutable business labels. All
// client writes to both collections are denied by Rules (this PR's Tier 2,
// deploy-gated blocks); every mutation flows through partMasterCommands.ts.
// No DocumentSnapshot leaks through the public API; malformed stored data
// is surfaced explicitly (MalformedStoredRecordError), never silently
// defaulted. Physical delete does not exist -- lifecycle status only.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { Manufacturer, ManufacturerId, ManufacturerStatus, Part, PartId } from "./types";
import { MANUFACTURER_STATUSES } from "./types";
import { validatePart } from "./validation";

export const PARTS_COLLECTION = "parts";
export const MANUFACTURERS_COLLECTION = "manufacturers";
export const INITIAL_VERSION = 1;

export class MalformedStoredRecordError extends Error {}

// Persistence envelopes: domain shape + version/audit metadata (metadata is
// repository authority, never client- or caller-supplied).
export interface StoredMeta {
  readonly version: number;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}
export interface StoredPart extends StoredMeta {
  readonly part: Part;
}
export interface StoredManufacturer extends StoredMeta {
  readonly manufacturer: Manufacturer;
}

// Narrow, testable-without-Firestore repository contracts (PR 1.2 scope
// only -- no list/search, no delete; identities are durable).
export interface PartRepository {
  getById(txn: Transaction | null, partId: PartId): Promise<StoredPart | null>;
  stageCreate(txn: Transaction, stored: StoredPart): void;
  stageUpdate(txn: Transaction, stored: StoredPart): void;
}
export interface ManufacturerRepository {
  getById(txn: Transaction | null, manufacturerId: ManufacturerId): Promise<StoredManufacturer | null>;
  stageCreate(txn: Transaction, stored: StoredManufacturer): void;
  stageUpdate(txn: Transaction, stored: StoredManufacturer): void;
}

// ---------------------------------------------------------------------------
// Serialization (strict; no unchecked casting; explicit Timestamp handling)
// ---------------------------------------------------------------------------
function metaToFirestore(meta: StoredMeta): Record<string, unknown> {
  return {
    version: meta.version,
    createdAt: Timestamp.fromDate(meta.createdAt),
    createdBy: meta.createdBy,
    updatedAt: Timestamp.fromDate(meta.updatedAt),
    updatedBy: meta.updatedBy,
  };
}
function readMeta(docId: string, data: Record<string, unknown>): StoredMeta {
  const { version, createdAt, createdBy, updatedAt, updatedBy } = data;
  if (
    typeof version !== "number" || !Number.isInteger(version) || version < INITIAL_VERSION ||
    !(createdAt instanceof Timestamp) || !(updatedAt instanceof Timestamp) ||
    typeof createdBy !== "string" || typeof updatedBy !== "string"
  ) {
    throw new MalformedStoredRecordError(`stored record ${docId} has malformed version/audit metadata`);
  }
  return { version, createdAt: createdAt.toDate(), createdBy, updatedAt: updatedAt.toDate(), updatedBy };
}

export function partToFirestore(stored: StoredPart): Record<string, unknown> {
  const p = stored.part;
  return {
    partId: p.partId,
    internalPartNumber: p.internalPartNumber,
    name: p.name,
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.category !== undefined ? { category: p.category } : {}),
    status: p.status,
    stockingUnit: p.stockingUnit,
    controlType: p.controlType,
    stockingClass: p.stockingClass,
    flags: { ...p.flags },
    ...(p.manufacturerId !== undefined ? { primaryManufacturerId: p.manufacturerId } : {}),
    ...(p.manufacturerPartNumber !== undefined ? { primaryManufacturerPartNumber: p.manufacturerPartNumber } : {}),
    ...(p.oemStatus !== undefined ? { oemStatus: p.oemStatus } : {}),
    ...metaToFirestore(stored),
  };
}

export function partFromFirestore(docId: string, data: Record<string, unknown> | undefined): StoredPart {
  if (data === undefined) throw new MalformedStoredRecordError(`part ${docId} has no data`);
  if (data.partId !== docId) {
    throw new MalformedStoredRecordError(`part document ${docId} carries mismatched partId ${String(data.partId)}`);
  }
  const validated = validatePart({
    partId: data.partId,
    internalPartNumber: data.internalPartNumber,
    name: data.name,
    description: data.description,
    category: data.category,
    status: data.status,
    stockingUnit: data.stockingUnit,
    controlType: data.controlType,
    stockingClass: data.stockingClass,
    flags: data.flags,
    manufacturerId: data.primaryManufacturerId,
    manufacturerPartNumber: data.primaryManufacturerPartNumber,
    oemStatus: data.oemStatus,
  });
  if (!validated.valid) {
    throw new MalformedStoredRecordError(
      `part ${docId} failed domain validation: ${validated.errors.map((e) => `${e.path}:${e.code}`).join(",")}`
    );
  }
  return { part: validated.value, ...readMeta(docId, data) };
}

export function manufacturerToFirestore(stored: StoredManufacturer): Record<string, unknown> {
  const m = stored.manufacturer;
  return {
    manufacturerId: m.manufacturerId,
    name: m.name,
    normalizedName: m.name.trim().replace(/\s+/g, " ").toUpperCase(),
    status: m.status,
    ...metaToFirestore(stored),
  };
}

export function manufacturerFromFirestore(docId: string, data: Record<string, unknown> | undefined): StoredManufacturer {
  if (data === undefined) throw new MalformedStoredRecordError(`manufacturer ${docId} has no data`);
  if (data.manufacturerId !== docId) {
    throw new MalformedStoredRecordError(`manufacturer document ${docId} carries mismatched id ${String(data.manufacturerId)}`);
  }
  if (typeof data.name !== "string" || data.name.trim().length === 0) {
    throw new MalformedStoredRecordError(`manufacturer ${docId} has no name`);
  }
  if (typeof data.status !== "string" || !(MANUFACTURER_STATUSES as readonly string[]).includes(data.status)) {
    throw new MalformedStoredRecordError(`manufacturer ${docId} has invalid status ${String(data.status)}`);
  }
  return {
    manufacturer: {
      manufacturerId: docId as ManufacturerId,
      name: data.name,
      status: data.status as ManufacturerStatus,
    },
    ...readMeta(docId, data),
  };
}

// ---------------------------------------------------------------------------
// Firestore-backed adapters
// ---------------------------------------------------------------------------
export function buildFirestorePartRepository(db: Firestore): PartRepository {
  const ref = (partId: PartId) => db.collection(PARTS_COLLECTION).doc(partId);
  return {
    async getById(txn, partId) {
      const snap = txn ? await txn.get(ref(partId)) : await ref(partId).get();
      if (!snap.exists) return null;
      return partFromFirestore(snap.id, snap.data());
    },
    stageCreate(txn, stored) {
      txn.create(ref(stored.part.partId), partToFirestore(stored));
    },
    stageUpdate(txn, stored) {
      txn.set(ref(stored.part.partId), partToFirestore(stored));
    },
  };
}

export function buildFirestoreManufacturerRepository(db: Firestore): ManufacturerRepository {
  const ref = (id: ManufacturerId) => db.collection(MANUFACTURERS_COLLECTION).doc(id);
  return {
    async getById(txn, manufacturerId) {
      const snap = txn ? await txn.get(ref(manufacturerId)) : await ref(manufacturerId).get();
      if (!snap.exists) return null;
      return manufacturerFromFirestore(snap.id, snap.data());
    },
    stageCreate(txn, stored) {
      txn.create(ref(stored.manufacturer.manufacturerId), manufacturerToFirestore(stored));
    },
    stageUpdate(txn, stored) {
      txn.set(ref(stored.manufacturer.manufacturerId), manufacturerToFirestore(stored));
    },
  };
}
