process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { updateStockLocation, createTransferOrder, completeTransferOrder } = await import("../lib/warehouseService.js");
const id = `${Date.now()}`;
const from = `source-${id}`, to = `destination-${id}`;
await updateStockLocation(from, "P-1", "A-01", 5);
const order = await createTransferOrder({ partId: "P-1", quantity: 3, fromWarehouseId: from, toWarehouseId: to, fromBinCode: "A-01", toBinCode: "B-02" });
await completeTransferOrder(order.id);
const source = await db.collection("stock_locations").doc(`${from}__P-1__A-01`).get();
const destination = await db.collection("stock_locations").doc(`${to}__P-1__B-02`).get();
assert.equal(source.data().quantity, 2);
assert.equal(destination.data().quantity, 3);
assert.equal((await db.collection("stock_locations").where("binCode", "==", "TRANSFER").get()).empty, true);
await completeTransferOrder(order.id);
assert.equal((await db.collection("stock_locations").doc(`${to}__P-1__B-02`).get()).data().quantity, 3);
console.log("warehouse transfer bin integrity passed");

// ITEM K: a transfer whose source and destination are identical
// (same warehouse AND same bin) must be rejected at creation --
// otherwise completeTransferOrder would apply -qty then +qty to the
// SAME stock_locations doc in one transaction (last write wins),
// fabricating stock from nothing.
const selfId = `${Date.now()}-self`;
const selfWarehouse = `warehouse-${selfId}`;
await updateStockLocation(selfWarehouse, "P-1", "A-01", 5);
await assert.rejects(
  () => createTransferOrder({
    partId: "P-1",
    quantity: 3,
    fromWarehouseId: selfWarehouse,
    toWarehouseId: selfWarehouse,
    fromBinCode: "A-01",
    toBinCode: "A-01",
  }),
  /source and destination must differ/i
);
// Belt-and-suspenders: no phantom stock resulted from the rejected attempt.
const selfStock = await db.collection("stock_locations").doc(`${selfWarehouse}__P-1__A-01`).get();
assert.equal(selfStock.data().quantity, 5);
console.log("warehouse self-transfer rejection passed");
