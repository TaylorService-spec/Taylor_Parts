// Receiving Location Authority -- I-LA5: Firestore-emulator integration of the PINNED concrete resolver
// with the unexported receiveInventoryStock command (via the production composition). Requires the
// Firestore emulator (127.0.0.1:8080). Proves receipt-proceeds for a governed ACTIVE warehouse, fail-
// closed DESTINATION_INVALID + zero writes for INACTIVE/missing, and that a concurrent ACTIVE->INACTIVE
// transition AFTER the resolver read cannot commit a receipt. Never touches production. Prereq: build + emulator.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const { receiveInventoryStockProduction, buildReceiveInventoryStockDeps } = await import("../lib/inventoryReceiving/receiveInventoryStockComposition.js");
const { receiveInventoryStock, DestinationInvalidError } = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);
const TS = Timestamp.fromMillis(1_700_000_000_000);
const flipper = admin.initializeApp({ projectId: "taylor-parts" }, "flipper-la5").firestore();

function governedWarehouse(id, status = "ACTIVE") {
  return { id, name: "Main", location: "L", status, version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u" };
}
async function seedScenario({ warehouse = "ACTIVE" } = {}) {
  const rrid = nextId("rr"), partId = nextId("part"), actorId = nextId("actor"), wh = nextId("wh");
  await db.collection("reorder_purchase_orders").doc(rrid).set({ reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1", orderedQuantity: 5, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(rrid).set({ partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  if (warehouse) await db.collection("warehouses").doc(wh).set(governedWarehouse(wh, warehouse));
  return { rrid, partId, actorId, wh };
}
function input(sc, over = {}) {
  const audits = [];
  const deps = {
    db,
    actor: { kind: "USER", id: sc.actorId },
    authorize: async (txn, id) => { const s = await txn.get(db.collection("receiving_grants").doc(id)); return s.exists && s.data().granted === true; },
    resolvePart: async (_txn, partId) => ({ partId, trackingMode: "NONE", active: true }),
    stageAudit: (txn, audit) => { audits.push(audit); txn.create(db.collection("receiving_audit_la5").doc(audit.receivingId), { ...audit, at: FieldValue.serverTimestamp() }); },
    now: () => NOW,
    ...over,
  };
  return { deps, audits };
}
function request(sc, locationId) {
  return {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: sc.rrid, purchaseOrderId: sc.rrid },
    receivingLocation: { type: "WAREHOUSE", locationId },
    lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: 5, receivedQuantity: 5 }],
    idempotencyKey: nextId("idem"),
  };
}
const reorderStatus = async (rrid) => (await db.collection("reorder_requests").doc(rrid).get()).data().status;
const auditCount = async (rrid) => (await db.collection("receiving_audit_la5").where("reorderRequestId", "==", rrid).get()).size;

await check("governed ACTIVE WAREHOUSE via pinned resolver -> receipt proceeds atomically", async () => {
  const sc = await seedScenario({ warehouse: "ACTIVE" });
  const { deps } = input(sc);
  const out = await receiveInventoryStockProduction(request(sc, sc.wh), deps);
  assert.equal(out.outcome, "applied");
  assert.equal(await reorderStatus(sc.rrid), "RECEIVED");
  assert.equal(await auditCount(sc.rrid), 1);
});

await check("INACTIVE warehouse -> DESTINATION_INVALID, zero writes", async () => {
  const sc = await seedScenario({ warehouse: "INACTIVE" });
  const { deps, audits } = input(sc);
  await assert.rejects(receiveInventoryStockProduction(request(sc, sc.wh), deps), DestinationInvalidError);
  assert.equal(await reorderStatus(sc.rrid), "ORDERED"); // unchanged
  assert.equal(audits.length, 0);
  assert.equal(await auditCount(sc.rrid), 0);
});

await check("missing warehouse -> DESTINATION_INVALID, zero writes", async () => {
  const sc = await seedScenario({ warehouse: null }); // no warehouse doc
  const { deps } = input(sc);
  await assert.rejects(receiveInventoryStockProduction(request(sc, nextId("ghost")), deps), DestinationInvalidError);
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

await check("non-WAREHOUSE location type -> DESTINATION_INVALID", async () => {
  const sc = await seedScenario({ warehouse: "ACTIVE" });
  const { deps } = input(sc);
  const req = request(sc, sc.wh); req.receivingLocation = { type: "BIN", locationId: sc.wh };
  await assert.rejects(receiveInventoryStockProduction(req, deps), DestinationInvalidError);
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

await check("concurrent ACTIVE->INACTIVE AFTER the resolver read cannot commit a receipt (fail closed, zero writes)", async () => {
  const sc = await seedScenario({ warehouse: "ACTIVE" });
  let flipped = false;
  // Build the PINNED-resolver deps, then add a test-only hook that flips the warehouse INACTIVE via a
  // SEPARATE connection right after the resolver's (successful) read. The command's txn read the warehouse,
  // so the concurrent change conflicts the commit -> retry -> resolver re-reads INACTIVE -> fail closed.
  const deps = {
    ...buildReceiveInventoryStockDeps(input(sc).deps),
    __afterLocationReadHook: async () => { if (!flipped) { flipped = true; await flipper.collection("warehouses").doc(sc.wh).update({ status: "INACTIVE" }); } },
  };
  // FAIL CLOSED: the warehouse was read in the command's transaction, so a concurrent retire cannot
  // commit a receipt. (On the emulator this surfaces as a raw transaction-conflict; production ABORTs and
  // retries, and the retry's resolver re-read of INACTIVE yields DESTINATION_INVALID -- both never commit.)
  await assert.rejects(receiveInventoryStock(request(sc, sc.wh), deps));
  assert.equal(await reorderStatus(sc.rrid), "ORDERED", "no receipt committed under a concurrent retire");
  assert.equal(await auditCount(sc.rrid), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
