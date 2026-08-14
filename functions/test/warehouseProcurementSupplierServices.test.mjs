// Firestore-emulator regression coverage for the otherwise-uncovered warehouse/procurement/supplier services.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
import assert from "node:assert/strict";
import { test } from "node:test";
import admin from "firebase-admin";
import { updateStockLocation } from "../lib/warehouseService.js";
import { createPurchaseOrder, updatePurchaseOrderStatus } from "../lib/procurementService.js";
import { findBestSupplierForPart } from "../lib/supplierService.js";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
let sequence = 0;
const id = (prefix) => `${prefix}-${Date.now()}-${++sequence}`;

test("warehouse stock cannot be reduced below zero", async () => {
  const warehouseId = id("warehouse"), partId = id("part"), binCode = "A1";
  await updateStockLocation(warehouseId, partId, binCode, 2);
  await assert.rejects(updateStockLocation(warehouseId, partId, binCode, -3), /Insufficient stock/);
  const stock = await db.collection("stock_locations").doc(`${warehouseId}__${partId}__${binCode}`).get();
  assert.equal(stock.data().quantity, 2);
});

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

test("supplier selection breaks equal-price ties by shorter lead time", async () => {
  const partId = id("part"), slow = id("slow"), fast = id("fast");
  await db.collection("suppliers").doc(slow).set({ id: slow, name: "Slow", contactEmail: "slow@example.test", leadTimeDays: 8 });
  await db.collection("suppliers").doc(fast).set({ id: fast, name: "Fast", contactEmail: "fast@example.test", leadTimeDays: 2 });
  await db.collection("supplier_catalog").doc(id("item")).set({ id: id("item"), supplierId: slow, partId, unitPrice: 10, available: true });
  await db.collection("supplier_catalog").doc(id("item")).set({ id: id("item"), supplierId: fast, partId, unitPrice: 10, available: true });
  assert.equal((await findBestSupplierForPart(partId)).id, fast);
});
