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

const { receiveInventoryStockProduction, buildReceiveInventoryStockDeps, runReceiveInventoryStockSanitized } = await import("../lib/inventoryReceiving/receiveInventoryStockComposition.js");
const { receiveInventoryStock, DestinationInvalidError, ReceiveCommandError, ReceivingIntegrityError, SourceNotReceivableError } = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");
const { receivingOrderDocId, canonicalReceivingOrderDocId } = await import("../lib/inventoryReceiving/receivingRepository.js");
const { ReorderSourceFrozenError } = await import("../lib/reorderRequest/reorderSourceFreeze.js");
const RAW_LEAK_RE = /INVALID_ARGUMENT|Transaction is invalid|ABORTED|firestore|\bcode\b|a\/b/i;

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
// REORDER SOURCE FREEZE (Catalog + Reorder cutover, step 2): the legacy REORDER_PURCHASE_ORDER receipt branch is frozen,
// so the pinned-resolver DESTINATION proofs below run on the unfrozen CANONICAL purchase_orders source through the SAME
// production composition (ruling B); the legacy branch is pinned as the FROZEN refusal (ruling A).
async function seedScenario({ warehouse = "ACTIVE" } = {}) {
  const poId = nextId("po"), partId = nextId("part"), actorId = nextId("actor"), wh = nextId("wh");
  await db.collection("purchase_orders").doc(poId).set({ supplierId: nextId("sup"), status: "SENT", items: [{ lineId: "L1", partId, quantity: 5, unitPrice: 1 }] });
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  if (warehouse) await db.collection("warehouses").doc(wh).set(governedWarehouse(wh, warehouse));
  return { poId, partId, actorId, wh };
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
    source: { type: "PURCHASE_ORDER", purchaseOrderId: sc.poId },
    receivingLocation: { type: "WAREHOUSE", locationId },
    lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: 5, receivedQuantity: 5 }],
    idempotencyKey: nextId("idem"),
  };
}
const poOf = async (sc) => (await db.collection("purchase_orders").doc(sc.poId).get()).data();
const auditCount = async (sc) => (await db.collection("receiving_audit_la5").where("purchaseOrderId", "==", sc.poId).get()).size;
const receiptIdOf = (sc, req) => canonicalReceivingOrderDocId({ operation: "receiveInventoryStock", sourceType: "PURCHASE_ORDER", purchaseOrderId: sc.poId, actorId: sc.actorId, idempotencyKey: req.idempotencyKey });
// Prove a fail-closed receipt committed ZERO of the primary writes: the deterministic receiving_orders
// document is absent, no inventory_transactions ledger event references that Receiving Order, the
// purchase order is untouched (not even its version), and no audit was staged.
async function assertNoReceipt(req, sc) {
  const receivingId = receiptIdOf(sc, req);
  assert.equal((await db.collection("receiving_orders").doc(receivingId).get()).exists, false, "no receiving_orders document");
  assert.equal((await db.collection("inventory_transactions").where("sourceObject.id", "==", receivingId).get()).size, 0, "no ledger event for the receiving order");
  const po = await poOf(sc);
  assert.equal(po.status, "SENT", "purchase order unchanged"); assert.equal(po.version, undefined, "purchase order version unchanged");
  assert.equal(await auditCount(sc), 0, "no audit staged");
}

// Ruling B: the pinned resolver admitting a governed ACTIVE warehouse is receiving domain logic -- proven on the canonical source.
await check("governed ACTIVE WAREHOUSE via pinned resolver -> receipt proceeds atomically", async () => {
  const sc = await seedScenario({ warehouse: "ACTIVE" });
  const { deps } = input(sc);
  const out = await receiveInventoryStockProduction(request(sc, sc.wh), deps);
  assert.equal(out.outcome, "applied");
  assert.equal((await poOf(sc)).status, "RECEIVED");
  assert.equal(await auditCount(sc), 1);
});

// Ruling A: a legacy REORDER_PURCHASE_ORDER receipt through the SANITIZED production composition is a superseded Reorder
// source write: it surfaces as the typed ReorderSourceFrozenError (not collapsed to RECEIVING_INTEGRITY), zero writes.
await check("legacy REORDER_PURCHASE_ORDER receipt via the production composition -> ReorderSourceFrozenError (not sanitized away), zero writes", async () => {
  const rrid = nextId("rr"), partId = nextId("part"), actorId = nextId("actor"), wh = nextId("wh");
  await db.collection("reorder_purchase_orders").doc(rrid).set({ reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1", orderedQuantity: 5, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(rrid).set({ partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  await db.collection("warehouses").doc(wh).set(governedWarehouse(wh, "ACTIVE"));
  const req = { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid }, receivingLocation: { type: "WAREHOUSE", locationId: wh }, lines: [{ lineId: "L1", partId, expectedQuantity: 5, receivedQuantity: 5 }], idempotencyKey: nextId("idem") };
  await assert.rejects(receiveInventoryStockProduction(req, input({ actorId }).deps), (e) => e instanceof ReorderSourceFrozenError && e.code === "REORDER_SOURCE_FROZEN");
  const receivingId = receivingOrderDocId(req.idempotencyKey);
  assert.equal((await db.collection("receiving_orders").doc(receivingId).get()).exists, false);
  assert.equal((await db.collection("inventory_transactions").where("sourceObject.id", "==", receivingId).get()).size, 0);
  assert.equal((await db.collection("reorder_requests").doc(rrid).get()).data().status, "ORDERED");
  assert.equal((await db.collection("receiving_audit_la5").where("reorderRequestId", "==", rrid).get()).size, 0);
});

// Ruling B: destination validation is receiving domain logic -- proven on the canonical source.
await check("INACTIVE warehouse -> DESTINATION_INVALID, zero writes", async () => {
  const sc = await seedScenario({ warehouse: "INACTIVE" });
  const { deps } = input(sc);
  const req = request(sc, sc.wh);
  await assert.rejects(receiveInventoryStockProduction(req, deps), DestinationInvalidError);
  await assertNoReceipt(req, sc);
});

// Ruling B: destination validation is receiving domain logic -- proven on the canonical source.
await check("missing warehouse -> DESTINATION_INVALID, zero writes", async () => {
  const sc = await seedScenario({ warehouse: null }); // no warehouse doc
  const { deps } = input(sc);
  const req = request(sc, nextId("ghost"));
  await assert.rejects(receiveInventoryStockProduction(req, deps), DestinationInvalidError);
  await assertNoReceipt(req, sc);
});

// Ruling B: destination validation is receiving domain logic -- proven on the canonical source.
await check("non-WAREHOUSE location type -> DESTINATION_INVALID, zero writes", async () => {
  const sc = await seedScenario({ warehouse: "ACTIVE" });
  const { deps } = input(sc);
  const req = request(sc, sc.wh); req.receivingLocation = { type: "BIN", locationId: sc.wh };
  await assert.rejects(receiveInventoryStockProduction(req, deps), DestinationInvalidError);
  await assertNoReceipt(req, sc);
});

// Ruling B: a concurrent warehouse retire must not commit a receipt -- proven on the canonical source.
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
  // FAIL CLOSED through the SANITIZED production boundary: the warehouse was read in the command's
  // transaction, so a concurrent retire cannot commit a receipt. Production ABORTs->retries and the
  // retry's resolver re-read yields DESTINATION_INVALID; the emulator surfaces a raw transaction-conflict
  // which the sanitized boundary maps to RECEIVING_INTEGRITY. Either way the error is a GOVERNED command
  // error with no raw transaction detail, and zero writes commit.
  const req = request(sc, sc.wh);
  await assert.rejects(
    runReceiveInventoryStockSanitized(req, deps),
    (e) => e instanceof ReceiveCommandError && (e.code === "DESTINATION_INVALID" || e.code === "RECEIVING_INTEGRITY") && !RAW_LEAK_RE.test(e.message),
  );
  await assertNoReceipt(req, sc); // no receiving_orders doc, no ledger event, PO untouched, no audit
});

// Ruling B: destination validation is receiving domain logic -- proven on the canonical source.
await check("path-unsafe locationId -> DESTINATION_INVALID, zero writes", async () => {
  const sc = await seedScenario({ warehouse: "ACTIVE" });
  const { deps } = input(sc);
  const req = request(sc, sc.wh); req.receivingLocation = { type: "WAREHOUSE", locationId: "a/b/c" };
  await assert.rejects(receiveInventoryStockProduction(req, deps), DestinationInvalidError);
  await assertNoReceipt(req, sc);
});

await check("composition sanitizes a raw transaction error -> RECEIVING_INTEGRITY (no raw leak)", async () => {
  const raw = Object.assign(new Error("3 INVALID_ARGUMENT: Transaction is invalid or closed; path warehouses/a/b"), { code: 3 });
  const fakeInput = { db: { runTransaction: async () => { throw raw; } }, actor: { kind: "USER", id: "a" }, authorize: async () => true, resolvePart: async () => ({ partId: "p", trackingMode: "NONE", active: true }), stageAudit: () => {}, now: () => NOW };
  // The source must NAME its authority to get past the pre-transaction shape gate, which is now
  // authority-agnostic (it checks that a supported type was declared, nothing legacy-specific). This
  // fixture omitted `type` and previously slipped through a gate that only looked for a
  // reorderRequestId. The property under test -- a RAW transaction error is sanitized to
  // RECEIVING_INTEGRITY with no leak -- is unchanged; only reaching the transaction requires a
  // well-formed source now.
  const req = { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "rr-x", purchaseOrderId: "rr-x" } };
  await assert.rejects(receiveInventoryStockProduction(req, fakeInput), (e) => e instanceof ReceivingIntegrityError && e.code === "RECEIVING_INTEGRITY" && !RAW_LEAK_RE.test(e.message));
});

await check("composition preserves a governed ReceiveCommandError (not remapped)", async () => {
  const fakeInput = { db: { runTransaction: async () => { throw new Error("unused"); } }, actor: { kind: "USER", id: "a" }, authorize: async () => true, resolvePart: async () => null, stageAudit: () => {}, now: () => NOW };
  // request missing source -> the command throws SourceNotReceivableError BEFORE runTransaction -> preserved
  await assert.rejects(receiveInventoryStockProduction({}, fakeInput), (e) => e instanceof SourceNotReceivableError && e.code === "SOURCE_NOT_RECEIVABLE");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
