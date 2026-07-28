// D4 Stage B.2 — Firestore adapters for the two D1 identity authorities:
//   equipment_models        doc id = equipmentModelId (canonical `manufacturer--model`)
//   equipment_model_aliases doc id = encodeModelAliasDocId(aliasKey)
//
// ALL validation and identity is delegated to the merged D1 contracts — this module never re-derives or
// re-checks an id shape. A stored document that fails the D1 validator is MalformedStoredRecordError,
// never a silently repaired or partially trusted record.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  encodeModelAliasDocId,
  isCanonicalEquipmentModelId,
  isCanonicalModelAliasKey,
  normalizeModelAliasKey,
  validateEquipmentModel,
  validateEquipmentModelAlias,
} from "./domain/equipmentModel";
import {
  EQUIPMENT_MODELS_COLLECTION,
  EQUIPMENT_MODEL_ALIASES_COLLECTION,
  MalformedStoredRecordError,
  metaToFirestore,
  readDoc,
  readMeta,
  type StoredMeta,
} from "./repository";

export interface StoredEquipmentModel extends StoredMeta {
  readonly model: any; // the D1-validated model value
}
export interface StoredEquipmentModelAlias extends StoredMeta {
  readonly alias: any; // the D1-validated alias value
}

// ---------------------------------------------------------------------------
// equipment_models
// ---------------------------------------------------------------------------
export function modelToFirestore(stored: StoredEquipmentModel): Record<string, unknown> {
  const v = validateEquipmentModel(stored.model);
  if (!v.valid) throw new MalformedStoredRecordError(`refusing to persist invalid equipment model: ${v.reason}`);
  const m = v.value;
  return {
    equipmentModelId: m.equipmentModelId,
    manufacturerId: m.manufacturerId,
    manufacturerName: m.manufacturerName,
    modelNumber: m.modelNumber,
    displayName: m.displayName,
    family: m.family,
    subtype: m.subtype,
    revision: m.revision,
    status: m.status,
    sourceAuthority: m.sourceAuthority,
    version: m.version,
    ...metaToFirestore(stored),
  };
}

export function modelFromFirestore(docId: string, data: Record<string, unknown>): StoredEquipmentModel {
  if (data.equipmentModelId !== docId) {
    throw new MalformedStoredRecordError(`equipment model document ${docId} carries mismatched equipmentModelId ${String(data.equipmentModelId)}`);
  }
  // Document identity IS domain identity: the id must be canonical in its own right, not merely equal
  // to a stored field that could itself be noncanonical.
  if (!isCanonicalEquipmentModelId(docId)) {
    throw new MalformedStoredRecordError(`equipment model document id ${docId} is not a canonical equipment model id`);
  }
  const v = validateEquipmentModel({
    equipmentModelId: data.equipmentModelId,
    manufacturerId: data.manufacturerId,
    manufacturerName: data.manufacturerName,
    modelNumber: data.modelNumber,
    displayName: data.displayName,
    family: data.family,
    subtype: data.subtype,
    revision: data.revision,
    status: data.status,
    sourceAuthority: data.sourceAuthority,
    version: data.version,
  });
  if (!v.valid) throw new MalformedStoredRecordError(`equipment model ${docId} failed D1 validation: ${v.reason}`);
  return { model: v.value, ...readMeta(docId, data) };
}

// ---------------------------------------------------------------------------
// equipment_model_aliases
// ---------------------------------------------------------------------------
// The alias KEY is the pure identity; the DOC ID is its percent-encoded, storage-safe form (the
// governed Part Master precedent). Identity and persistence stay separate, and only this function
// bridges them.
export function aliasDocIdFor(aliasKey: string): string {
  if (!isCanonicalModelAliasKey(aliasKey)) {
    throw new MalformedStoredRecordError(`alias key ${String(aliasKey)} is not canonical`);
  }
  return encodeModelAliasDocId(aliasKey);
}

// Derive the storage doc id for an alias input through the SINGLE D1 key authority. Returns null on any
// input the D1 contract refuses — callers never fabricate a key.
export function deriveAliasDocId(input: any): { docId: string; aliasKey: string } | null {
  const v = validateEquipmentModelAlias(input);
  if (!v.valid) return null;
  return { docId: encodeModelAliasDocId(v.value.aliasKey), aliasKey: v.value.aliasKey };
}

export function aliasToFirestore(stored: StoredEquipmentModelAlias): Record<string, unknown> {
  const a = stored.alias;
  const v = validateEquipmentModelAlias({
    aliasType: a?.aliasType,
    manufacturerId: a?.manufacturerId,
    rawValue: a?.aliasValue,
    equipmentModelId: a?.equipmentModelId,
    aliasKey: a?.aliasKey,
  });
  if (!v.valid) throw new MalformedStoredRecordError(`refusing to persist invalid model alias: ${v.reason}`);
  return {
    aliasKey: v.value.aliasKey,
    aliasType: v.value.aliasType,
    manufacturerId: v.value.manufacturerId,
    aliasValue: v.value.aliasValue,
    equipmentModelId: v.value.equipmentModelId,
    ...metaToFirestore(stored),
  };
}

export function aliasFromFirestore(docId: string, data: Record<string, unknown>): StoredEquipmentModelAlias {
  const aliasKey = data.aliasKey;
  if (typeof aliasKey !== "string" || encodeModelAliasDocId(aliasKey) !== docId) {
    throw new MalformedStoredRecordError(`alias document ${docId} carries mismatched aliasKey ${String(aliasKey)}`);
  }
  const v = validateEquipmentModelAlias({
    aliasType: data.aliasType,
    manufacturerId: data.manufacturerId,
    rawValue: data.aliasValue,
    equipmentModelId: data.equipmentModelId,
    aliasKey,
  });
  if (!v.valid) throw new MalformedStoredRecordError(`model alias ${docId} failed D1 validation: ${v.reason}`);
  // The stored key must be the key D1 DERIVES from the stored segments — a hand-edited aliasKey that
  // merely encodes to the right doc id is still a disagreement.
  if (normalizeModelAliasKey({ aliasType: v.value.aliasType, manufacturerId: v.value.manufacturerId, rawValue: v.value.aliasValue }) !== aliasKey) {
    throw new MalformedStoredRecordError(`model alias ${docId} carries an aliasKey that disagrees with its own segments`);
  }
  return { alias: v.value, ...readMeta(docId, data) };
}

// ---------------------------------------------------------------------------
// Repository contracts + Firestore adapters
// ---------------------------------------------------------------------------
// No delete, no list, no query: D4 uses point access by document id only.
export interface EquipmentModelRepository {
  getById(txn: Transaction | null, equipmentModelId: string): Promise<StoredEquipmentModel | null>;
  stageCreate(txn: Transaction, stored: StoredEquipmentModel): void;
  stageUpdate(txn: Transaction, stored: StoredEquipmentModel): void;
}
export interface EquipmentModelAliasRepository {
  getByAliasKey(txn: Transaction | null, aliasKey: string): Promise<StoredEquipmentModelAlias | null>;
  stageCreate(txn: Transaction, stored: StoredEquipmentModelAlias): void;
  stageUpdate(txn: Transaction, stored: StoredEquipmentModelAlias): void;
}

export function buildFirestoreEquipmentModelRepository(db: Firestore): EquipmentModelRepository {
  const ref = (id: string) => db.collection(EQUIPMENT_MODELS_COLLECTION).doc(id);
  const idOf = (stored: StoredEquipmentModel): string => {
    const id = stored.model?.equipmentModelId;
    if (!isCanonicalEquipmentModelId(id)) throw new MalformedStoredRecordError(`refusing to persist noncanonical equipment model id ${String(id)}`);
    return id;
  };
  return {
    async getById(txn, equipmentModelId) {
      const doc = await readDoc(db, txn, EQUIPMENT_MODELS_COLLECTION, equipmentModelId);
      return doc === null ? null : modelFromFirestore(doc.id, doc.data);
    },
    stageCreate(txn, stored) {
      txn.create(ref(idOf(stored)), modelToFirestore(stored));
    },
    stageUpdate(txn, stored) {
    // update() REQUIRES the document to exist -- "update" must never quietly become a create and
    // bypass the separate stageCreate surface. Every field the record owns is written, so this is a
    // full overwrite of the governed field set, not a partial merge.
      txn.update(ref(idOf(stored)), modelToFirestore(stored));
    },
  };
}

export function buildFirestoreEquipmentModelAliasRepository(db: Firestore): EquipmentModelAliasRepository {
  const ref = (aliasKey: string) => db.collection(EQUIPMENT_MODEL_ALIASES_COLLECTION).doc(aliasDocIdFor(aliasKey));
  return {
    async getByAliasKey(txn, aliasKey) {
      const doc = await readDoc(db, txn, EQUIPMENT_MODEL_ALIASES_COLLECTION, aliasDocIdFor(aliasKey));
      return doc === null ? null : aliasFromFirestore(doc.id, doc.data);
    },
    stageCreate(txn, stored) {
      txn.create(ref(stored.alias?.aliasKey), aliasToFirestore(stored));
    },
    stageUpdate(txn, stored) {
    // update() REQUIRES the document to exist -- "update" must never quietly become a create and
    // bypass the separate stageCreate surface. Every field the record owns is written, so this is a
    // full overwrite of the governed field set, not a partial merge.
      txn.update(ref(stored.alias?.aliasKey), aliasToFirestore(stored));
    },
  };
}
