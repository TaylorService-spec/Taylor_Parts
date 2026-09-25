// EI Phase-2 Receiving -- Capability Grant Gate: Firestore-emulator proof that the granted capability
// works END-TO-END through the real E1 callables + the real governed permission resolver (real
// roleAssignments, NOT a synthetic seam). Requires the Firestore emulator (127.0.0.1:8080). Proves the
// THREE real holders (ADMIN + DISPATCHER + INVENTORY RECEIVING CLERK) can receive/list, every excluded
// persona -- OWNER now included -- is denied, stale accessVersion denies, and revocation prevents both
// receive and option access. Never touches production. Prereq: build + emulator.
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

// PIN MOVED 2026-09-24 (Owner ruling A -- narrow the compiled Owner Role). This loop used to read
// ["admin", "dispatcher", "owner"] under the comment "owner is Owner-ratified as an inherited holder
// (owner >= admin)", which named the mechanism honestly: Owner held receiving because
// OWNER_PERMISSIONS spread ADMIN_ROLE.permissions, never because anyone decided the Owner should
// receive stock. Ruling A removed that spread and the Owner has ruled the resulting strict subset
// correct, so `owner` leaves the ALLOW loop and gets its own DENY check below.
//
// `inventoryReceivingClerk` takes its place rather than the slot simply shrinking to two. That is
// the narrow standalone Role the Owner directed for this capability, it is the third and last real
// holder in the merged catalog (admin + dispatcher + inventoryReceivingClerk, pinned by
// receivingCapabilityRegistration.test.mjs), and it had NO end-to-end coverage here before. The
// loop therefore proves strictly MORE than it did: the complete holder set now runs the real
// callables, and it is the only non-privileged Role among them.
for (const role of ["admin", "dispatcher", "inventoryReceivingClerk"]) {
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

// Ruling A's teeth at the CALLABLE boundary, not just in the pure resolver. A real, active,
// non-stale governed `owner` roleAssignment -- the exact shape that used to succeed -- must now be
// refused by both callables, and must leave no trace: the reorder request stays ORDERED, so the
// refusal happens BEFORE any write, not after a partial receipt.
await check("OWNER roleAssignment -> receive + options permission-denied (inventory.stock.receive is admin-only; ruling A)", async () => {
  const sc = await seedReceive();
  const uid = nextId("actor"); await grantRole(uid, "owner");
  await assert.rejects(runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  await assert.rejects(runListReceivingLocationOptions(callReq(uid, {}), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

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

// PIN MOVED 2026-09-24 (Owner ruling A). These two checks exercise the ASSIGNMENT-STATE machinery --
// stale accessVersion, and revocation -- and they were previously driven through `owner` as a second,
// non-admin holder. They are now driven through `inventoryReceivingClerk`, because a stale-version or
// revoked-assignment check run against a Role that no longer HOLDS the capability would deny for the
// wrong reason (noQualifyingGrant) and prove nothing at all. Same assertions, live subject; the
// non-vacuity is established by the ALLOW loop above, which proves this Role receives when its
// assignment is healthy. The unconditional OWNER denial is covered by its own check above.
await check("non-admin holder with stale accessVersion -> permission-denied (same enforcement, non-privileged Role)", async () => {
  const sc = await seedReceive();
  const uid = nextId("actor");
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await grantRole(uid, "inventoryReceivingClerk", { accessVersionAtGrant: 2 }); // ahead of current -> stale
  await assert.rejects(runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  await assert.rejects(runListReceivingLocationOptions(callReq(uid, {}), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

await check("non-admin holder revocation (deactivate the assignment) prevents BOTH receive and options", async () => {
  const sc = await seedReceive();
  const uid = nextId("actor");
  const asgId = nextId("asg");
  await db.collection("roleAssignments").doc(asgId).set({ principalUid: uid, roleId: "inventoryReceivingClerk", scope: { type: "global" }, status: "active", accessVersionAtGrant: 0, grantedBy: "seed", grantedAt: TS });
  // The granted half runs FIRST and must succeed: that is what makes the revoked half non-vacuous.
  assert.ok((await runListReceivingLocationOptions(callReq(uid, {}), wiring)).options.some((o) => o.value === sc.wh)); // granted
  await db.collection("roleAssignments").doc(asgId).update({ status: "inactive" }); // revoke
  await assert.rejects(runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  await assert.rejects(runListReceivingLocationOptions(callReq(uid, {}), wiring), (e) => e instanceof HttpsError && e.code === "permission-denied");
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
