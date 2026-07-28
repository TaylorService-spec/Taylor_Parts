// D4 Stage B.2 — Firestore adapters for the two D2 authorities:
//   equipment_part_compatibility   doc id = compatibilityId (deterministic opaque hash, D2)
//   equipment_compatibility_sources doc id = sourceId       (independent deterministic hash, D2)
//
// ALL validation and identity is delegated to the merged D2 contracts. The deterministic ids are
// RE-DERIVED by the validator on every read and write, so a document whose stored id disagrees with its
// own content is malformed rather than authoritative.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  isCanonicalCompatibilityId,
  isCanonicalCompatibilitySourceId,
  validateCompatibility,
  validateCompatibilitySource,
} from "./domain/compatibility";
import {
  EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION,
  EQUIPMENT_PART_COMPATIBILITY_COLLECTION,
  MalformedStoredRecordError,
  metaToFirestore,
  readDoc,
  readMeta,
  type StoredMeta,
} from "./repository";

export interface StoredCompatibility extends StoredMeta {
  readonly compatibility: any; // the D2-validated relationship value
}
export interface StoredCompatibilitySource extends StoredMeta {
  readonly source: any; // the D2-validated evidence value
}

// Serial schemes are a governed registry, not repository state. A SERIAL_RANGE relationship cannot be
// validated without its scheme, so the registry is an explicit dependency: an unresolved scheme makes
// the stored record MALFORMED (fail closed, per the D3 resolution contract), never silently accepted.
export interface CompatibilityRepositoryDeps {
  readonly serialSchemes?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// equipment_part_compatibility
// ---------------------------------------------------------------------------
function validateCompat(input: any, deps: CompatibilityRepositoryDeps): any {
  return validateCompatibility(input, { serialSchemes: deps.serialSchemes ?? {} });
}

export function compatibilityToFirestore(stored: StoredCompatibility, deps: CompatibilityRepositoryDeps = {}): Record<string, unknown> {
  const v = validateCompat(stored.compatibility, deps);
  if (!v.valid) throw new MalformedStoredRecordError(`refusing to persist invalid compatibility: ${v.reason}`);
  const c = v.value;
  return {
    compatibilityId: c.compatibilityId,
    uniquenessKey: c.uniquenessKey,
    equipmentModelId: c.equipmentModelId,
    partId: c.partId,
    compatibilityType: c.compatibilityType,
    assembly: c.assembly,
    installationPosition: c.installationPosition,
    quantityRequired: c.quantityRequired,
    applicability: { ...c.applicability },
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
    sourceSummary: c.sourceSummary,
    confidenceLevel: c.confidenceLevel,
    verificationStatus: c.verificationStatus,
    notes: c.notes,
    version: c.version,
    ...metaToFirestore(stored),
  };
}

export function compatibilityFromFirestore(docId: string, data: Record<string, unknown>, deps: CompatibilityRepositoryDeps = {}): StoredCompatibility {
  if (!isCanonicalCompatibilityId(docId)) {
    throw new MalformedStoredRecordError(`compatibility document id ${docId} is not a canonical compatibility id`);
  }
  if (data.compatibilityId !== docId) {
    throw new MalformedStoredRecordError(`compatibility document ${docId} carries mismatched compatibilityId ${String(data.compatibilityId)}`);
  }
  // Passing the stored compatibilityId and uniquenessKey back through the validator makes D2 re-derive
  // both from the content and reject a mismatch — a tampered id cannot masquerade as authoritative.
  const v = validateCompat({
    compatibilityId: data.compatibilityId,
    uniquenessKey: data.uniquenessKey,
    equipmentModelId: data.equipmentModelId,
    partId: data.partId,
    compatibilityType: data.compatibilityType,
    assembly: data.assembly,
    installationPosition: data.installationPosition,
    quantityRequired: data.quantityRequired,
    applicability: data.applicability,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo,
    sourceSummary: data.sourceSummary,
    confidenceLevel: data.confidenceLevel,
    verificationStatus: data.verificationStatus,
    notes: data.notes,
    version: data.version,
  }, deps);
  if (!v.valid) throw new MalformedStoredRecordError(`compatibility ${docId} failed D2 validation: ${v.reason}`);
  return { compatibility: v.value, ...readMeta(docId, data) };
}

// ---------------------------------------------------------------------------
// equipment_compatibility_sources — IMMUTABLE evidence
// ---------------------------------------------------------------------------
export function sourceToFirestore(stored: StoredCompatibilitySource): Record<string, unknown> {
  const v = validateCompatibilitySource(stored.source);
  if (!v.valid) throw new MalformedStoredRecordError(`refusing to persist invalid compatibility source: ${v.reason}`);
  const s = v.value;
  return {
    sourceId: s.sourceId,
    compatibilityId: s.compatibilityId,
    authorityType: s.authorityType,
    sourceReference: s.sourceReference,
    sourceVersion: s.sourceVersion,
    observedClaim: s.observedClaim,
    contentFingerprint: s.contentFingerprint,
    capturedAt: s.capturedAt,
    capturedBy: s.capturedBy,
    notes: s.notes,
    ...metaToFirestore(stored),
  };
}

export function sourceFromFirestore(docId: string, data: Record<string, unknown>): StoredCompatibilitySource {
  if (!isCanonicalCompatibilitySourceId(docId)) {
    throw new MalformedStoredRecordError(`compatibility source document id ${docId} is not a canonical source id`);
  }
  if (data.sourceId !== docId) {
    throw new MalformedStoredRecordError(`compatibility source document ${docId} carries mismatched sourceId ${String(data.sourceId)}`);
  }
  const v = validateCompatibilitySource({
    sourceId: data.sourceId,
    compatibilityId: data.compatibilityId,
    authorityType: data.authorityType,
    sourceReference: data.sourceReference,
    sourceVersion: data.sourceVersion,
    observedClaim: data.observedClaim,
    contentFingerprint: data.contentFingerprint,
    capturedAt: data.capturedAt,
    capturedBy: data.capturedBy,
    notes: data.notes,
  });
  if (!v.valid) throw new MalformedStoredRecordError(`compatibility source ${docId} failed D2 validation: ${v.reason}`);
  return { source: v.value, ...readMeta(docId, data) };
}

// ---------------------------------------------------------------------------
// Repository contracts + Firestore adapters
// ---------------------------------------------------------------------------
export interface CompatibilityRepository {
  getById(txn: Transaction | null, compatibilityId: string): Promise<StoredCompatibility | null>;
  stageCreate(txn: Transaction, stored: StoredCompatibility): void;
  stageUpdate(txn: Transaction, stored: StoredCompatibility): void;
}

// NO stageUpdate. D2 evidence is immutable: a changed observed claim or capture-provenance field is a
// NEW record (a different sourceId) or a collision for review — never an in-place edit. The absence of
// an update method is the enforcement, not a convention.
export interface CompatibilitySourceRepository {
  getById(txn: Transaction | null, sourceId: string): Promise<StoredCompatibilitySource | null>;
  stageCreate(txn: Transaction, stored: StoredCompatibilitySource): void;
}

export function buildFirestoreCompatibilityRepository(db: Firestore, deps: CompatibilityRepositoryDeps = {}): CompatibilityRepository {
  const ref = (id: string) => db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION).doc(id);
  const idOf = (stored: StoredCompatibility): string => {
    const id = stored.compatibility?.compatibilityId;
    if (!isCanonicalCompatibilityId(id)) throw new MalformedStoredRecordError(`refusing to persist noncanonical compatibilityId ${String(id)}`);
    return id;
  };
  return {
    async getById(txn, compatibilityId) {
      const doc = await readDoc(db, txn, EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compatibilityId);
      return doc === null ? null : compatibilityFromFirestore(doc.id, doc.data, deps);
    },
    stageCreate(txn, stored) {
      txn.create(ref(idOf(stored)), compatibilityToFirestore(stored, deps));
    },
    stageUpdate(txn, stored) {
      txn.set(ref(idOf(stored)), compatibilityToFirestore(stored, deps));
    },
  };
}

export function buildFirestoreCompatibilitySourceRepository(db: Firestore): CompatibilitySourceRepository {
  const ref = (id: string) => db.collection(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION).doc(id);
  const idOf = (stored: StoredCompatibilitySource): string => {
    const id = stored.source?.sourceId;
    if (!isCanonicalCompatibilitySourceId(id)) throw new MalformedStoredRecordError(`refusing to persist noncanonical sourceId ${String(id)}`);
    return id;
  };
  return {
    async getById(txn, sourceId) {
      const doc = await readDoc(db, txn, EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, sourceId);
      return doc === null ? null : sourceFromFirestore(doc.id, doc.data);
    },
    // create() only — a second write to the same sourceId FAILS rather than overwriting evidence.
    stageCreate(txn, stored) {
      txn.create(ref(idOf(stored)), sourceToFirestore(stored));
    },
  };
}
