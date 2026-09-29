// Receiving Phase-2 E1: Firestore-emulator tests for the trusted Receiving callables end-to-end
// (functions/src/inventoryReceiving/receivingCallables.ts + receivingCallableWiring.ts). Requires the
// Firestore emulator (127.0.0.1:8080). Proves: real governed authorization for the UNGRANTED
// inventory.stock.receive denies every persona (no bypass); a synthetic grant seam proves valid
// invocation without a repository grant; exact success/replay response; commit-time revocation cannot
// commit/return; sanitized deterministic option list; the real Part adapter; and error-matrix mapping.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { runReceiveInventoryStock, runListReceivingLocationOptions, mapReceiveError } = await import("../lib/inventoryReceiving/receivingCallables.js");
const { receiveInventoryStockProduction } = await import("../lib/inventoryReceiving/receiveInventoryStockComposition.js");
const { receivingOrderDocId } = await import("../lib/inventoryReceiving/receivingRepository.js");
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
const revoker = admin.initializeApp({ projectId: "taylor-parts" }, "revoker-e1").firestore();

function governedWh(id, status = "ACTIVE", name = "Main") {
  return { id, name, location: "L", status, version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u" };
}
// A fully stored Part: domain shape + persistence version/audit metadata (partMaster readMeta).
function partDoc(partId, status = "ACTIVE", controlType = "STANDARD") {
  return { partId, internalPartNumber: partId, name: "Compressor", status, stockingUnit: "EACH", controlType, stockingClass: "STOCKED", version: 1, createdAt: TS, createdBy: "u", updatedAt: TS, updatedBy: "u" };
}
const grant = (uid) => db.collection("receiving_grants").doc(uid).set({ granted: true });
const grantedPermission = async (txn, uid) => { const s = await txn.get(db.collection("receiving_grants").doc(uid)); return s.exists && s.data().granted === true; };
const realPermission = (txn, uid) => resolveReceivePermissionThroughTxn(txn, db, uid);
function wiring(resolvePermission) {
  return { db, resolvePermission, resolvePart: (txn, partId) => resolveReceivePartThroughTxn(txn, db, partId), stageAudit: stageReceiveAuditEvent, now: () => NOW };
}
async function seed({ warehouse = "ACTIVE", partStatus = "ACTIVE", controlType = "STANDARD", grantActor = true } = {}) {
  const rrid = nextId("rr"), partId = nextId("part"), actorId = nextId("actor"), wh = nextId("wh");
  await db.collection("reorder_purchase_orders").doc(rrid).set({ reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1", orderedQuantity: 5, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(rrid).set({ partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  await db.collection("parts").doc(partId).set(partDoc(partId, partStatus, controlType));
  if (warehouse) await db.collection("warehouses").doc(wh).set(governedWh(wh, warehouse));
  if (grantActor) await grant(actorId);
  return { rrid, partId, actorId, wh };
}
function reqData(sc, over = {}) {
  return { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: sc.rrid, purchaseOrderId: sc.rrid }, receivingLocation: { type: "WAREHOUSE", locationId: sc.wh }, lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: 5, receivedQuantity: 5 }], idempotencyKey: nextId("idem"), ...over };
}
const callReq = (uid, data) => ({ auth: { uid }, data });
const reorderStatus = async (rrid) => (await db.collection("reorder_requests").doc(rrid).get()).data().status;
const auditCount = async (targetId) => (await db.collection("auditEvents").where("action", "==", "receiveInventoryStock").where("targetId", "==", targetId).get()).size;

// REORDER SOURCE FREEZE (Catalog + Reorder cutover, step 2). This callable's request contract admits ONLY the legacy
// REORDER_PURCHASE_ORDER source, whose receipt branch is frozen -- so every receipt it accepts is now refused as the governed
// failed-precondition / REORDER_SOURCE_FROZEN (ruling A). The receiving DOMAIN proofs are preserved one boundary below: the
// SAME production composition the callable calls, with the callable's REAL wiring adapters and its REAL error map, against
// the unfrozen CANONICAL purchase order (ruling B). Nothing here reopens the legacy branch.
async function seedCanonical(sc, { ordered = 5 } = {}) {
  const poId = nextId("po");
  await db.collection("purchase_orders").doc(poId).set({ supplierId: nextId("sup"), status: "SENT", items: [{ lineId: "L1", partId: sc.partId, quantity: ordered, unitPrice: 1 }] });
  return poId;
}
const canonicalData = (sc, poId, over = {}) => ({ source: { type: "PURCHASE_ORDER", purchaseOrderId: poId }, receivingLocation: { type: "WAREHOUSE", locationId: sc.wh }, lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: 5, receivedQuantity: 2 }], idempotencyKey: nextId("idem"), ...over });
async function receiveCanonical(uid, data, w) {
  try {
    return await receiveInventoryStockProduction(data, { db: w.db, actor: { kind: "USER", id: uid }, authorize: (txn, actorId) => w.resolvePermission(txn, actorId), resolvePart: w.resolvePart, stageAudit: w.stageAudit, now: w.now });
  } catch (err) { throw mapReceiveError(err); }
}
const poOf = async (poId) => (await db.collection("purchase_orders").doc(poId).get()).data();
const isFrozenRefusal = (e) => e instanceof HttpsError && e.code === "failed-precondition" && e.details?.code === "REORDER_SOURCE_FROZEN";

// Ruling A (callable: a legacy receipt is a superseded Reorder source write -> failed-precondition REORDER_SOURCE_FROZEN,
// zero writes, and a retry is refused the same way) + Ruling B (applied receipt + real audit + exact replay, through the
// callable's composition and real wiring, on the canonical source).
await check("valid invocation via synthetic grant seam: legacy receipt refused FROZEN (zero writes); canonical applies + audits + replays exactly", async () => {
  const sc = await seed();
  const data = reqData(sc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(runReceiveInventoryStock(callReq(sc.actorId, data), wiring(grantedPermission)), isFrozenRefusal);
  }
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(data.idempotencyKey)).get()).exists, false);
  assert.equal(await auditCount(receivingOrderDocId(data.idempotencyKey)), 0);

  const poId = await seedCanonical(sc);
  const cdata = canonicalData(sc, poId);
  const out = await receiveCanonical(sc.actorId, cdata, wiring(grantedPermission));
  assert.equal(out.outcome, "applied");
  assert.ok(typeof out.receivingId === "string" && typeof out.ledgerEventId === "string");
  assert.equal((await poOf(poId)).version, 1);
  assert.equal(await auditCount(out.receivingId), 1);
  // deterministic replay: same payload -> replayed, same ids
  const out2 = await receiveCanonical(sc.actorId, cdata, wiring(grantedPermission));
  assert.equal(out2.outcome, "replayed");
  assert.equal(out2.receivingId, out.receivingId);
  assert.equal(out2.ledgerEventId, out.ledgerEventId);
  assert.equal(await auditCount(out.receivingId), 1, "a replay writes no second audit");
});

await check("UNGRANTED capability denies EVERY persona (no admin/dispatcher/wildcard bypass), zero writes", async () => {
  const sc = await seed({ grantActor: false });
  const personas = { admin: "admin", dispatcher: "dispatcher", technician: "technician" };
  const uids = {};
  for (const [k, role] of Object.entries(personas)) { const uid = nextId(k); await db.collection("users").doc(uid).set({ role }); uids[k] = uid; }
  uids.norole = nextId("norole"); // no users doc
  for (const uid of Object.values(uids)) {
    await assert.rejects(runReceiveInventoryStock(callReq(uid, reqData(sc)), wiring(realPermission)), (e) => e instanceof HttpsError && e.code === "permission-denied", `persona ${uid}`);
  }
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

await check("unauthenticated -> unauthenticated", async () => {
  const sc = await seed();
  await assert.rejects(runReceiveInventoryStock({ data: reqData(sc) }, wiring(grantedPermission)), (e) => e instanceof HttpsError && e.code === "unauthenticated");
});

// Ruling B: destination validation is receiving domain logic -- proven through the callable's composition + error map on
// the canonical source (on the legacy source the freeze would answer first, so it could not prove the destination rule).
await check("INACTIVE warehouse (granted) -> failed-precondition, zero writes", async () => {
  const sc = await seed({ warehouse: "INACTIVE" });
  const poId = await seedCanonical(sc);
  const before = await poOf(poId);
  await assert.rejects(receiveCanonical(sc.actorId, canonicalData(sc, poId), wiring(grantedPermission)), (e) => e instanceof HttpsError && e.code === "failed-precondition" && e.details?.code === undefined);
  assert.deepEqual(await poOf(poId), before);
  assert.equal((await db.collection("receiving_orders").where("source.purchaseOrderId", "==", poId).get()).size, 0);
});

await check("missing approved source (granted) -> not-found", async () => {
  const sc = await seed();
  // ONE ghost id for both. The legacy invariant is that a purchase order's id IS its reorder
  // request's id (firestore.rules pins it on create), and that coherence is now checked in the
  // resolver BEFORE the existence read rather than in the validator after it. This fixture used two
  // different ghost ids, so it was really exercising the identity mismatch and only reaching
  // not-found because the old ordering looked up existence first. Same id → this tests what it says:
  // a well-formed source that does not exist is not-found.
  const ghost = nextId("ghost");
  const data = reqData(sc, { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: ghost, purchaseOrderId: ghost } });
  await assert.rejects(runReceiveInventoryStock(callReq(sc.actorId, data), wiring(grantedPermission)), (e) => e instanceof HttpsError && e.code === "not-found");
});

await check("real Part adapter: STANDARD/ACTIVE -> {NONE, active}; INACTIVE -> !active; SERIALIZED -> SERIAL", async () => {
  const std = nextId("part"); await db.collection("parts").doc(std).set(partDoc(std, "ACTIVE", "STANDARD"));
  const inact = nextId("part"); await db.collection("parts").doc(inact).set(partDoc(inact, "INACTIVE", "STANDARD"));
  const ser = nextId("part"); await db.collection("parts").doc(ser).set(partDoc(ser, "ACTIVE", "SERIALIZED"));
  const resolve = (id) => db.runTransaction((txn) => resolveReceivePartThroughTxn(txn, db, id));
  assert.deepEqual(await resolve(std), { partId: std, trackingMode: "NONE", active: true });
  assert.equal((await resolve(inact)).active, false);
  assert.equal((await resolve(ser)).trackingMode, "SERIAL");
  assert.equal(await resolve(nextId("missing")), null);
});

await check("options: granted -> sanitized deterministic ACTIVE-only list; ungranted -> permission-denied", async () => {
  const clear = await db.collection("warehouses").get();
  const b = db.batch(); clear.docs.forEach((d) => b.delete(d.ref)); await b.commit();
  const a = nextId("wh"), z = nextId("wh"), inactive = nextId("wh"), legacy = nextId("wh");
  await db.collection("warehouses").doc(a).set(governedWh(a, "ACTIVE", "Zeta"));
  await db.collection("warehouses").doc(z).set(governedWh(z, "ACTIVE", "Alpha"));
  await db.collection("warehouses").doc(inactive).set(governedWh(inactive, "INACTIVE", "Inact"));
  await db.collection("warehouses").doc(legacy).set({ id: legacy, name: "Legacy", location: "L", active: true });
  const uid = nextId("actor"); await grant(uid);
  const res = await runListReceivingLocationOptions(callReq(uid, {}), wiring(grantedPermission));
  assert.deepEqual(res, { options: [{ value: z, label: "Alpha", type: "WAREHOUSE" }, { value: a, label: "Zeta", type: "WAREHOUSE" }] });
  const uid2 = nextId("actor"); // ungranted
  await assert.rejects(runListReceivingLocationOptions(callReq(uid2, {}), wiring(realPermission)), (e) => e instanceof HttpsError && e.code === "permission-denied");
});

// Ruling B: commit-time revocation is receiving domain logic -- proven through the callable's composition + error map on
// the canonical source (on the legacy source the freeze would refuse regardless of the revocation).
await check("commit-time revocation cannot commit a receipt (fail closed, zero writes)", async () => {
  const sc = await seed();
  const poId = await seedCanonical(sc);
  const before = await poOf(poId);
  let revoked = false;
  const selfRevoke = async (txn, uid) => { const s = await txn.get(db.collection("receiving_grants").doc(uid)); const g = s.exists && s.data().granted === true; if (g && !revoked) { revoked = true; await revoker.collection("receiving_grants").doc(uid).delete(); } return g; };
  await assert.rejects(receiveCanonical(sc.actorId, canonicalData(sc, poId), wiring(selfRevoke)), (e) => e instanceof HttpsError && (e.code === "permission-denied" || e.code === "internal"));
  assert.deepEqual(await poOf(poId), before);
  assert.equal((await db.collection("receiving_orders").where("source.purchaseOrderId", "==", poId).get()).size, 0);
});

await check("commit-time revocation cannot return options (fail closed)", async () => {
  const uid = nextId("actor"); await grant(uid);
  let revoked = false;
  const selfRevoke = async (txn, u) => { const s = await txn.get(db.collection("receiving_grants").doc(u)); const g = s.exists && s.data().granted === true; if (g && !revoked) { revoked = true; await revoker.collection("receiving_grants").doc(u).delete(); } return g; };
  await assert.rejects(runListReceivingLocationOptions(callReq(uid, {}), wiring(selfRevoke)), (e) => e instanceof HttpsError && (e.code === "permission-denied" || e.code === "internal"));
});

await check("unknown request field rejected at the callable -> invalid-argument, zero writes", async () => {
  const sc = await seed();
  await assert.rejects(runReceiveInventoryStock(callReq(sc.actorId, reqData(sc, { actor: { kind: "USER", id: "evil" } })), wiring(grantedPermission)), (e) => e instanceof HttpsError && e.code === "invalid-argument");
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

await check("options handler: null/undefined/array/primitive/keyed rejected -> invalid-argument BEFORE authorization", async () => {
  const uid = nextId("actor");
  // resolvePermission throws if reached; a rejection with invalid-argument proves validation runs first.
  const throwWiring = wiring(async () => { throw new Error("authorization must not run"); });
  for (const bad of [undefined, null, [], "x", 1, { a: 1 }]) {
    await assert.rejects(runListReceivingLocationOptions({ auth: { uid }, data: bad }, throwWiring), (e) => e instanceof HttpsError && e.code === "invalid-argument", `options data ${JSON.stringify(bad)}`);
  }
});

await check("receive handler: empty/multiple lines rejected -> invalid-argument BEFORE authorization, zero writes", async () => {
  const sc = await seed();
  const line = { lineId: "L1", partId: sc.partId, expectedQuantity: 5, receivedQuantity: 5 };
  const throwWiring = wiring(async () => { throw new Error("authorization must not run"); });
  for (const lines of [[], [line, { ...line, lineId: "L2" }]]) {
    await assert.rejects(runReceiveInventoryStock(callReq(sc.actorId, reqData(sc, { lines })), throwWiring), (e) => e instanceof HttpsError && e.code === "invalid-argument");
  }
  assert.equal(await reorderStatus(sc.rrid), "ORDERED");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
