// Supplier Master (S2) -- the Firestore repository for governed `suppliers/{supplierId}` records.
// Mirrors partMasterRepository's shape: pure to/from Firestore mappers + a transaction-aware repo
// with getById / stageCreate / stageUpdate, plus a dedup-DETECTION query (findActiveByNormalizedKey).
// Reads run the SHARED governed validator (supplierMasterValidation) so a malformed stored record is
// surfaced explicitly (MalformedStoredRecordError), never silently trusted. No physical delete.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { SUPPLIERS_COLLECTION } from "../constants/collections.js";
import { MalformedStoredRecordError } from "../partMaster/partMasterRepository.js";
import { validateGovernedSupplier } from "./supplierMasterValidation.js";
import { SUPPLIER_OPTIONAL_STRING_FIELDS, type GovernedSupplier } from "./supplierMasterTypes.js";

// A governed Supplier serializes as itself (its fields ARE the stored shape); undefined optionals
// are omitted so a document never carries an explicit `undefined`.
export function supplierToFirestore(s: GovernedSupplier): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: s.id,
    name: s.name,
    normalizedKey: s.normalizedKey,
    status: s.status,
    version: s.version,
    createdAt: s.createdAt,
    createdBy: s.createdBy,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
  for (const f of SUPPLIER_OPTIONAL_STRING_FIELDS) {
    const v = s[f];
    if (v !== undefined) out[f] = v;
  }
  return out;
}

// Deserialize a stored Supplier, binding it to its document id. A malformed record fails LOUD.
export function supplierFromFirestore(docId: string, data: Record<string, unknown> | undefined): GovernedSupplier {
  if (data === undefined) throw new MalformedStoredRecordError(`supplier ${docId} has no data`);
  const r = validateGovernedSupplier(data, docId);
  if (!r.valid) throw new MalformedStoredRecordError(`supplier ${docId} is malformed: ${r.reason}`);
  return r.value;
}

export interface SupplierRepository {
  getById(txn: Transaction | null, supplierId: string): Promise<GovernedSupplier | null>;
  stageCreate(txn: Transaction, supplier: GovernedSupplier): void;
  stageUpdate(txn: Transaction, supplier: GovernedSupplier): void;
  // Dedup DETECTION only: ACTIVE suppliers sharing a normalizedKey (a suspected duplicate the
  // caller FLAGS for human review). Single-field equality query (auto-indexed, no composite index).
  findActiveByNormalizedKey(txn: Transaction, normalizedKey: string, excludeId: string): Promise<GovernedSupplier[]>;
}

export function buildFirestoreSupplierRepository(db: Firestore): SupplierRepository {
  const ref = (id: string) => db.collection(SUPPLIERS_COLLECTION).doc(id);
  return {
    async getById(txn, supplierId) {
      const snap = txn ? await txn.get(ref(supplierId)) : await ref(supplierId).get();
      if (!snap.exists) return null;
      return supplierFromFirestore(snap.id, snap.data());
    },
    stageCreate(txn, supplier) {
      txn.create(ref(supplier.id), supplierToFirestore(supplier));
    },
    stageUpdate(txn, supplier) {
      txn.set(ref(supplier.id), supplierToFirestore(supplier));
    },
    async findActiveByNormalizedKey(txn, normalizedKey, excludeId) {
      const q = db.collection(SUPPLIERS_COLLECTION).where("normalizedKey", "==", normalizedKey);
      const snap = await txn.get(q);
      const out: GovernedSupplier[] = [];
      for (const doc of snap.docs) {
        if (doc.id === excludeId) continue;
        let s: GovernedSupplier;
        try {
          s = supplierFromFirestore(doc.id, doc.data());
        } catch {
          continue; // a malformed neighbor never blocks or corrupts dedup detection
        }
        if (s.status === "ACTIVE") out.push(s);
      }
      return out;
    },
  };
}
