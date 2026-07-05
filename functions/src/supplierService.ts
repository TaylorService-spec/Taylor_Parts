// Epic 5 Procurement + Supplier Management System -- supplier reads.
//
// Read-only. No writes live here; suppliers/catalog items are
// provisioned by an admin (console or Admin SDK), same posture as
// users/{userId} role docs elsewhere in this codebase -- not a
// live vendor integration, just internal reference data.
import { getFirestore } from "firebase-admin/firestore";
import { SUPPLIERS_COLLECTION, SUPPLIER_CATALOG_COLLECTION } from "./constants/collections";
import type { Supplier, SupplierCatalogItem } from "./types/procurement";

const db = () => getFirestore();

export async function getSuppliers(): Promise<Supplier[]> {
  const snap = await db().collection(SUPPLIERS_COLLECTION).get();
  return snap.docs.map((doc) => doc.data() as Supplier);
}

export async function getSupplierCatalog(supplierId: string): Promise<SupplierCatalogItem[]> {
  const snap = await db()
    .collection(SUPPLIER_CATALOG_COLLECTION)
    .where("supplierId", "==", supplierId)
    .get();
  return snap.docs.map((doc) => doc.data() as SupplierCatalogItem);
}

// "Best" = lowest unit price among available catalog listings for this
// part, across all suppliers; ties broken by shorter leadTimeDays.
// Deliberately this simple -- no MOQ/discount-tier/reliability scoring,
// matching this epic's "planning layer, not an optimization engine"
// framing (see procurementBridge.ts for the same restraint).
export async function findBestSupplierForPart(partId: string): Promise<Supplier | null> {
  const [catalogSnap, suppliers] = await Promise.all([
    db()
      .collection(SUPPLIER_CATALOG_COLLECTION)
      .where("partId", "==", partId)
      .where("available", "==", true)
      .get(),
    getSuppliers(),
  ]);

  const candidates = catalogSnap.docs.map((doc) => doc.data() as SupplierCatalogItem);
  if (candidates.length === 0) return null;

  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));

  let best: { item: SupplierCatalogItem; supplier: Supplier } | null = null;
  for (const item of candidates) {
    const supplier = suppliersById.get(item.supplierId);
    if (!supplier) continue;
    if (
      !best ||
      item.unitPrice < best.item.unitPrice ||
      (item.unitPrice === best.item.unitPrice && supplier.leadTimeDays < best.supplier.leadTimeDays)
    ) {
      best = { item, supplier };
    }
  }

  return best?.supplier ?? null;
}
