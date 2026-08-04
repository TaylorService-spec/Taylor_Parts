// EI Phase-2 Receiving -- Capability Grant Gate: Firestore-emulator proof that the granted capability
// works END-TO-END through the real E1 callables + the real governed permission resolver (real
// roleAssignments, NOT a synthetic seam). Requires the Firestore emulator (127.0.0.1:8080). Proves ADMIN
// + DISPATCHER can receive/list, every excluded persona is denied, stale accessVersion denies, and
// revocation prevents both receive and option access. Never touches production. Prereq: build + emulator.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { runReceiveInventoryStock, runListReceivingLocationOptions } = await import("../lib/inventoryReceiving/receivingCallables.js");
const { resolveReceivePermissionThroughTxn, resolveReceivePartThroughTxn, stageReceiveAuditEvent } = await import("../lib/inventoryReceiving/receivingCallableWiring.js");

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

const wiring = { db, resolvePermission: (txn, uid) => resolveReceivePermissionThroughTxn(txn, db, uid), resolvePart: (txn, id) => resolveReceivePartThroughTxn(txn, db, id), stageAudit: stageReceiveAuditEvent, now: () => NOW };
// A REAL governed grant: an active roleAssignment to a governed role. accessVersionAtGrant<=users accessVersion(0).
async function grantRole(uid, roleId, over = {}) {
  await db.collection("roleAssignments").doc(nextId("asg")).set({ principalUid: uid, roleId, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0, grantedBy: "seed", grantedAt: TS, ...over });
}
function governedWh(id, status = "ACTIVE", name = "Main") { return { id, name, location: "L", status, version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u" }; }
function partDoc(partId) { return { partId, internalPartNumber: partId, name: "Compressor", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", version: 1, createdAt: TS, createdBy: "u", updatedAt: TS, updatedBy: "u" }; }
async function seedReceive() {
  const rrid = nextId("rr"), partId = nextId("part"), wh = nextId("wh");
  await db.collection("reorder_purchase_orders").doc(rrid).set({ reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1", orderedQuantity: 5, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(rrid).set({ partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  await db.collection("parts").doc(partId).set(partDoc(partId));
  await db.collection("warehouses").doc(wh).set(governedWh(wh));
  return { rrid, partId, wh };
}
const reqData = (sc) => ({ source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: sc.rrid, purchaseOrderId: sc.rrid }, receivingLocation: { type: "WAREHOUSE", locationId: sc.wh }, lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: 5, receivedQuantity: 5 }], idempotencyKey: nextId("idem") });
const callReq = (uid, data) => ({ auth: { uid }, data });
const reorderStatus = async (rrid) => (await db.collection("reorder_requests").doc(rrid).get()).data().status;

for (const role of ["admin", "dispatcher"]) {
  await check(`${role} roleAssignment -> receive APPLIED + options returns (real governed grant)`, async () => {
    const sc = await seedReceive();
    const uid = nextId("actor"); await grantRole(uid, role);
    const out = await runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring);
    assert.equal(out.outcome, "applied");
    assert.equal(await reorderStatus(sc.rrid), "RECEIVED");
    const opt = await runListReceivingLocationOptions(callReq(uid, {}), wiring);
    assert.ok(opt.options.some((o) => o.value === sc.wh));
  });
}

await check("technician roleAssignment -> receive + options permission-denied", async () => {
  const sc = await seedReceive();
  const uid = nextId("actor"); await grantRole(uid, "technician");
  await assert.rejects(runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  await assert.rejects(runListReceivingLocationOptions(callReq(uid, {}), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

await check("no roleAssignment -> permission-denied (catalog/export alone does not grant)", async () => {
  const sc = await seedReceive();
  const uid = nextId("actor"); // no assignment
  await assert.rejects(runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  await assert.rejects(runListReceivingLocationOptions(callReq(uid, {}), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
});

await check("stale accessVersion -> permission-denied", async () => {
  const sc = await seedReceive();
  const uid = nextId("actor");
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await grantRole(uid, "admin", { accessVersionAtGrant: 2 }); // granted at a version ahead of current -> stale
  await assert.rejects(runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
});

await check("revocation (deactivate the assignment) prevents BOTH receive and options", async () => {
  const sc = await seedReceive();
  const uid = nextId("actor");
  const asgId = nextId("asg");
  await db.collection("roleAssignments").doc(asgId).set({ principalUid: uid, roleId: "admin", scope: { type: "global" }, status: "active", accessVersionAtGrant: 0, grantedBy: "seed", grantedAt: TS });
  // granted -> options work
  assert.ok((await runListReceivingLocationOptions(callReq(uid, {}), wiring)).options.some((o) => o.value === sc.wh));
  // revoke
  await db.collection("roleAssignments").doc(asgId).update({ status: "inactive" });
  await assert.rejects(runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  await assert.rejects(runListReceivingLocationOptions(callReq(uid, {}), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
