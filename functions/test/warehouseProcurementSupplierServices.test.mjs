// Firestore-emulator regression coverage for the otherwise-uncovered procurement service.
//
// BIN-P2: the warehouse-stock case that used to open this file is gone with warehouseService.ts.
// It proved updateStockLocation refused to drive a stock_locations quantity below zero -- a guard on
// a writer that Decision #160 retired, over a collection that is no longer an inventory authority.
//
// W1-C21: the supplier tie-break case that used to close this file is gone with supplierService.ts.
// It proved findBestSupplierForPart broke an equal-price tie by shorter leadTimeDays -- a reader on
// a module that had no importer anywhere in functions/src, and that read the same `suppliers`
// collection as the governed Supplier Master (functions/src/supplierMaster/*) under a different,
// ungoverned shape (contactEmail/leadTimeDays). The `supplier_catalog` collection it also read is
// NOT retired: Operations.jsx's ProcurementPanel still reads it live through
// field-ops-app-vite/src/services/operationsQueries.ts's fetchSupplierCatalog. Only the duplicate
// server-side Firebase supplier authority went away. See docs/handoff/w1-c21-registrations.md.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
import assert from "node:assert/strict";
import { test } from "node:test";
import admin from "firebase-admin";
import { createPurchaseOrder, updatePurchaseOrderStatus } from "../lib/procurementService.js";

admin.initializeApp({ projectId: "taylor-parts" });
let sequence = 0;
const id = (prefix) => `${prefix}-${Date.now()}-${++sequence}`;


test("purchase order lifecycle accepts forward transitions and rejects a terminal rewrite", async () => {
  const order = await createPurchaseOrder({ supplierId: id("supplier"), items: [{ partId: id("part"), quantity: 2, unitPrice: 7 }] });
  assert.equal(order.totalCost, 14);
  await updatePurchaseOrderStatus(order.id, "APPROVED");
  await updatePurchaseOrderStatus(order.id, "SENT");
  await updatePurchaseOrderStatus(order.id, "RECEIVED");
  await assert.rejects(updatePurchaseOrderStatus(order.id, "CANCELLED"), /Illegal PurchaseOrder transition/);
});

test("purchase order creation rejects empty line items", async () => {
  await assert.rejects(
    createPurchaseOrder({ supplierId: id("supplier"), items: [] }),
    /at least one line item/
  );
});

test("purchase order creation rejects a non-positive quantity", async () => {
  await assert.rejects(
    createPurchaseOrder({ supplierId: id("supplier"), items: [{ partId: id("part"), quantity: 0, unitPrice: 5 }] }),
    /quantity must be a positive number/
  );
  await assert.rejects(
    createPurchaseOrder({ supplierId: id("supplier"), items: [{ partId: id("part"), quantity: -1, unitPrice: 5 }] }),
    /quantity must be a positive number/
  );
});

test("purchase order creation rejects a negative unit price", async () => {
  await assert.rejects(
    createPurchaseOrder({ supplierId: id("supplier"), items: [{ partId: id("part"), quantity: 1, unitPrice: -5 }] }),
    /unitPrice must be a non-negative number/
  );
});
