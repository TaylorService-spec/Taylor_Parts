// One-off seed script for the Operations dashboard (Epics 2D/3/4/5).
// Populates a small, realistic dataset across all seven collections so
// the dashboard has something to show besides empty states. Uses the
// Admin SDK directly -- bypasses firestore.rules by design, same as
// any other admin-provisioned reference data in this codebase (see
// supplierService.ts's header comment on suppliers/supplier_catalog
// being "provisioned by an admin (console or Admin SDK), never by the
// client").
//
// Run once, locally, against the live project:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/seedOperationsDemoData.js
// (or `gcloud auth application-default login` first, then just `node scripts/seedOperationsDemoData.js`
// with no env var -- either way you need real credentials for the
// "taylor-parts" project; this sandboxed session has neither available.)
//
// Idempotent-ish: uses fixed doc ids so re-running overwrites the same
// seed docs rather than duplicating them.
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");

initializeApp({ projectId: "taylor-parts" });
const db = getFirestore();

// A handful of real SKUs from field-ops-app-vite/src/data/partsCatalog.ts
// (and its functions/src mirror) so getCatalogItem() resolves names
// correctly in the dashboard instead of falling back to a bare SKU.
const PART_A = "TST-1003"; // Freezer Cylinder - Compact, warehouseQty 20
const PART_B = "TST-1015"; // Condenser Fan Motor - HD, warehouseQty 4
const PART_C = "TST-1031"; // Freezer Cylinder - Pro Series, warehouseQty 0

async function seed() {
  const batch = db.batch();
  const now = Timestamp.now();

  // Warehouses
  const whMain = db.collection("warehouses").doc("wh-main");
  const whSatellite = db.collection("warehouses").doc("wh-satellite");
  batch.set(whMain, { id: whMain.id, name: "Main Warehouse", location: "Dallas, TX" });
  batch.set(whSatellite, { id: whSatellite.id, name: "Satellite Depot", location: "Fort Worth, TX" });

  // Stock locations (bin-level)
  const stockLocs = [
    { id: "sl-1", warehouseId: whMain.id, partId: PART_A, binCode: "A1", quantity: 12 },
    { id: "sl-2", warehouseId: whSatellite.id, partId: PART_A, binCode: "B3", quantity: 3 },
    { id: "sl-3", warehouseId: whMain.id, partId: PART_B, binCode: "A2", quantity: 2 },
    { id: "sl-4", warehouseId: whMain.id, partId: PART_C, binCode: "A3", quantity: 0 },
  ];
  for (const loc of stockLocs) {
    batch.set(db.collection("stock_locations").doc(loc.id), { ...loc, updatedAt: now });
  }

  // Inventory ledger transactions (CONSUMED entries drive both the
  // Inventory Health forecast and the Warehouse reconciliation
  // comparison -- deliberately picked so PART_B shows up CRITICAL and
  // PART_A shows a reconciliation variance).
  const transactions = [
    { id: "tx-1", workOrderId: "seed-wo-1", partId: PART_A, type: "CONSUMED", quantity: 6 },
    { id: "tx-2", workOrderId: "seed-wo-2", partId: PART_B, type: "CONSUMED", quantity: 3 },
    { id: "tx-3", workOrderId: "seed-wo-3", partId: PART_B, type: "RESERVED", quantity: 1 },
  ];
  for (const tx of transactions) {
    batch.set(db.collection("inventory_transactions").doc(tx.id), {
      ...tx,
      timestamp: Timestamp.fromMillis(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
  }

  // Transfer order (in-flight, between the two seeded warehouses)
  batch.set(db.collection("transfer_orders").doc("to-1"), {
    id: "to-1",
    partId: PART_A,
    quantity: 5,
    fromWarehouseId: whMain.id,
    toWarehouseId: whSatellite.id,
    status: "IN_TRANSIT",
    createdAt: now,
    updatedAt: now,
  });

  // Suppliers + catalog
  const supA = db.collection("suppliers").doc("sup-a");
  const supB = db.collection("suppliers").doc("sup-b");
  batch.set(supA, { id: supA.id, name: "Acme Parts Co.", contactEmail: "orders@acmeparts.example", leadTimeDays: 5 });
  batch.set(supB, { id: supB.id, name: "Reliable Supply Inc.", contactEmail: "sales@reliablesupply.example", leadTimeDays: 10 });

  const catalogItems = [
    { id: "cat-1", supplierId: supA.id, partId: PART_A, unitPrice: 245.0, available: true },
    { id: "cat-2", supplierId: supB.id, partId: PART_A, unitPrice: 260.0, available: true },
    { id: "cat-3", supplierId: supA.id, partId: PART_B, unitPrice: 42.5, available: true },
    { id: "cat-4", supplierId: supB.id, partId: PART_C, unitPrice: 210.0, available: false },
  ];
  for (const item of catalogItems) {
    batch.set(db.collection("supplier_catalog").doc(item.id), item);
  }

  // One existing purchase order, already SENT
  batch.set(db.collection("purchase_orders").doc("po-1"), {
    id: "po-1",
    supplierId: supA.id,
    status: "SENT",
    items: [{ partId: PART_A, quantity: 10, unitPrice: 245.0 }],
    totalCost: 2450.0,
    createdAt: now,
    updatedAt: now,
  });

  await batch.commit();
  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
});
