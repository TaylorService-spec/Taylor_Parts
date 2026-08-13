// Emulator integration test for the createWorkOrder idempotency guard (Track A / stress-run #2).
//
// Same harness as functions/test/completeAssignedJob.test.js: the compiled onCall handler is invoked directly
// via `.run(request)` against a LIVE Firestore emulator. Proves the invariant the pure workOrderCreateMath
// test cannot (it is I/O): a retry carrying the SAME idempotencyKey returns the already-created Work Order --
// no second WO, no burned WO number.
//
// Prerequisite (also how CI runs it):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/createWorkOrderIdempotency.test.js
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

const assert = require("node:assert/strict");
const test = require("node:test");
const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const { createWorkOrder } = require("../lib/createWorkOrder.js");

const USERS = "users";
const WOS = "fieldops_wos";
const AUDIT = "auditEvents";

let counter = 0;
const id = (label) => `${label}-${Date.now()}-${(counter += 1)}`;
const callRequest = (data, uid) => ({ data, auth: uid !== undefined ? { uid, token: {} } : undefined });
const seedAdmin = (uid) => db.collection(USERS).doc(uid).set({ role: "admin" });
const woCountFor = async (customerId) => (await db.collection(WOS).where("customerId", "==", customerId).get()).size;

test("same idempotencyKey twice -> ONE Work Order, same id + woNumber, replayed:true on retry", async () => {
  const uid = id("uid"), customerId = id("cust"), locationId = id("loc"), key = id("key");
  await seedAdmin(uid);

  const first = await createWorkOrder.run(
    callRequest({ customerId, locationId, priority: 1, complaint: "no cooling", idempotencyKey: key }, uid),
  );
  assert.ok(first.id && first.woNumber, "first create returns id + woNumber");
  assert.notEqual(first.replayed, true);

  const retry = await createWorkOrder.run(
    callRequest({ customerId, locationId, priority: 1, complaint: "no cooling", idempotencyKey: key }, uid),
  );
  assert.equal(retry.replayed, true, "retry with same key is a replay");
  assert.equal(retry.id, first.id, "replay returns the SAME Work Order id");
  assert.equal(retry.woNumber, first.woNumber, "replay returns the SAME WO number (no burned sequence)");
  assert.equal(await woCountFor(customerId), 1, "exactly one Work Order exists for this customer");
});

test("a DIFFERENT idempotencyKey mints a new Work Order with a new number", async () => {
  const uid = id("uid"), customerId = id("cust"), locationId = id("loc");
  await seedAdmin(uid);
  const a = await createWorkOrder.run(callRequest({ customerId, locationId, priority: 2, complaint: "x", idempotencyKey: id("k") }, uid));
  const b = await createWorkOrder.run(callRequest({ customerId, locationId, priority: 2, complaint: "x", idempotencyKey: id("k") }, uid));
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.woNumber, b.woNumber);
  assert.equal(await woCountFor(customerId), 2);
});

test("keyless legacy create still works (deploy-safe) and writes no idempotency marker", async () => {
  const uid = id("uid"), customerId = id("cust"), locationId = id("loc");
  await seedAdmin(uid);
  const r = await createWorkOrder.run(callRequest({ customerId, locationId, priority: 3, complaint: "y" }, uid));
  assert.ok(r.id && r.woNumber);
  assert.notEqual(r.replayed, true);
  const markers = await db.collection(AUDIT).where("action", "==", "createWorkOrder").where("targetId", "==", r.id).get();
  assert.equal(markers.size, 0, "no key -> no idempotency marker (legacy behavior preserved)");
});

test("empty idempotencyKey is rejected", async () => {
  const uid = id("uid");
  await seedAdmin(uid);
  await assert.rejects(
    createWorkOrder.run(callRequest({ customerId: id("c"), locationId: id("l"), priority: 1, complaint: "z", idempotencyKey: "  " }, uid)),
    (err) => err.code === "invalid-argument",
  );
});
