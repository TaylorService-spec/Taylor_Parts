// D4 Stage B.2 — shared persistence envelope for the Part–Equipment Compatibility authorities.
// Mirrors the established Part Master repository pattern (ADR-008 / Decision #40,
// functions/src/partMaster/partMasterRepository.ts): storage-independent interfaces plus strict Admin
// SDK adapters, no DocumentSnapshot leaking through the public API, and malformed stored data surfaced
// explicitly rather than silently defaulted. Physical delete does not exist for any D4 authority.
//
// DELIBERATELY NO `version` IN THE ENVELOPE. D1 and D2 already define `version` INSIDE the governed
// record (equipment models and compatibility relationships), and aliases and evidence sources have no
// version by contract. Adding a second envelope version would create a competing authority, so the
// domain record's own version is the only one, and expected-version concurrency (Stage C) reads it
// from the validated domain value.
//
// Emulator-only, server-only. All five collections are client-closed by the Stage D Rules proposal.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

export const EQUIPMENT_MODELS_COLLECTION = "equipment_models";
export const EQUIPMENT_MODEL_ALIASES_COLLECTION = "equipment_model_aliases";
export const EQUIPMENT_PART_COMPATIBILITY_COLLECTION = "equipment_part_compatibility";
export const EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION = "equipment_compatibility_sources";
export const EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION = "equipment_compatibility_operations";

// The five collections a D4 repository may touch. Nothing else is reachable from this module.
export const EQUIPMENT_COMPATIBILITY_COLLECTIONS = Object.freeze([
  EQUIPMENT_MODELS_COLLECTION,
  EQUIPMENT_MODEL_ALIASES_COLLECTION,
  EQUIPMENT_PART_COMPATIBILITY_COLLECTION,
  EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION,
  EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION,
]);

export class MalformedStoredRecordError extends Error {}

const MAX_ACTOR_UID = 128;

// Audit stamps are REPOSITORY authority — never client- or caller-supplied through the domain record.
export interface StoredMeta {
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

const isActorUid = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ACTOR_UID;

export function metaToFirestore(meta: StoredMeta): Record<string, unknown> {
  return {
    createdAt: Timestamp.fromDate(meta.createdAt),
    createdBy: meta.createdBy,
    updatedAt: Timestamp.fromDate(meta.updatedAt),
    updatedBy: meta.updatedBy,
  };
}

export function readMeta(docId: string, data: Record<string, unknown>): StoredMeta {
  const { createdAt, createdBy, updatedAt, updatedBy } = data;
  if (!(createdAt instanceof Timestamp) || !(updatedAt instanceof Timestamp) || !isActorUid(createdBy) || !isActorUid(updatedBy)) {
    throw new MalformedStoredRecordError(`stored record ${docId} has malformed audit metadata`);
  }
  if (updatedAt.toMillis() < createdAt.toMillis()) {
    throw new MalformedStoredRecordError(`stored record ${docId} was updated before it was created`);
  }
  return { createdAt: createdAt.toDate(), createdBy, updatedAt: updatedAt.toDate(), updatedBy };
}

// A stored document must be a plain data map. Firestore never returns anything else, so an exotic shape
// means the read path was tampered with or a test double is wrong — fail closed either way.
export function requireData(docId: string, data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (data === undefined || data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new MalformedStoredRecordError(`stored record ${docId} has no readable data`);
  }
  return data;
}

// Read helper shared by every adapter: point access by document id, inside a transaction when one is
// supplied. There is intentionally no list/query/delete surface in D4 — the trusted commands use point
// access only, which is also why no compound index is proposed (deferred to D5).
export async function readDoc(
  db: Firestore,
  txn: Transaction | null,
  collection: string,
  docId: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const ref = db.collection(collection).doc(docId);
  const snap = txn ? await txn.get(ref) : await ref.get();
  if (!snap.exists) return null;
  return { id: snap.id, data: requireData(snap.id, snap.data()) };
}
