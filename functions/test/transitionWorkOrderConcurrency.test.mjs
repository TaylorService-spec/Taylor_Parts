// Site-work r3 item M -- regression for the same-technician cross-Work-Order concurrency gap in
// transitionWorkOrder.ts's Dispatch/Schedule double-booking guard.
//
// The guard reads the technician's OTHER Work Orders inside the transaction, then writes only the CURRENT
// Work Order doc. Firestore only conflict-detects on documents actually in a transaction's read/write set, so
// two concurrent transitions targeting two DIFFERENT Work Order docs for the SAME technician each see a
// pre-commit snapshot with no conflict -- both could commit, double-booking the technician despite the guard.
// The fix adds a per-technician sentinel doc (work_order_tech_locks/{technicianId}), deliberately read AND
// written inside the same transaction (mirrors inventoryService.ts's reservationLockRef pattern), so a second
// concurrent same-technician transition collides on that doc, Firestore retries it, and the retry re-reads the
// first transition's already-committed state -- correctly finding (and rejecting) the conflict instead of
// missing it.
//
// Same harness as functions/test/inventoryService.test.mjs / functions/test/completeAssignedJob.test.js: the
// compiled onCall handler is invoked directly via `.run(request)` against a live Firestore emulator. Imported
// from its own compiled module, never via lib/index.js (which calls initializeApp() itself).
//
// Prerequisite (also how CI runs it):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/transitionWorkOrderConcurrency.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";

const admin = (await import("firebase-admin")).default;
const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const { transitionWorkOrder } = await import("../lib/transitionWorkOrder.js");

const WOS = "fieldops_wos";
const USERS = "users";
const TECH_LOCKS = "work_order_tech_locks";

let counter = 0;
function id(label) {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}

function callRequest(data, uid) {
  return { data, auth: uid !== undefined ? { uid, token: {} } : undefined };
}

async function seedDispatcher(uid) {
  await db.collection(USERS).doc(uid).set({ role: "dispatcher" });
}

async function seedWorkOrder(woId, fields) {
  await db.collection(WOS).doc(woId).set({ id: woId, ...fields });
}

test("CONCURRENCY GUARD: two concurrent Dispatch calls for the SAME technician on DIFFERENT Work Orders cannot both succeed", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techId = id("tech-race");
  const woA = id("wo-race-a");
  const woB = id("wo-race-b");
  await seedWorkOrder(woA, { status: "SCHEDULED" });
  await seedWorkOrder(woB, { status: "SCHEDULED" });

  const results = await Promise.allSettled([
    transitionWorkOrder.run(callRequest({ workOrderId: woA, action: "Dispatch", assignedTechId: techId }, dispatcherUid)),
    transitionWorkOrder.run(callRequest({ workOrderId: woB, action: "Dispatch", assignedTechId: techId }, dispatcherUid)),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one Dispatch may win the race for the same technician");
  assert.equal(rejected.length, 1, "the other Dispatch must be rejected, not silently succeed");
  // The loser's rejection reason varies with exactly how the emulator schedules the retried transaction: usually
  // it's our own "failed-precondition" (the retry re-read the winner's committed DISPATCHED status and correctly
  // found the conflict), but under heavy contention Firestore can instead exhaust the transaction's internal
  // retry budget on the lock doc's write-write collision itself (surfacing as an ABORTED/INVALID_ARGUMENT
  // transport error) before ever getting back into our precondition check. Either way proves the same thing: the
  // lock forces real contention between the two same-technician transitions, which is the invariant under test
  // -- the dispatchedCount assertion below is what actually proves no double-booking occurred, regardless of
  // which rejection shape got there.
  assert.ok(rejected[0].reason, "the loser must reject with a real error, not resolve silently");

  // Confirm only ONE of the two Work Orders actually ended up DISPATCHED with this technician -- the true
  // invariant the guard protects, not just "an error was thrown somewhere."
  const [snapA, snapB] = await Promise.all([db.collection(WOS).doc(woA).get(), db.collection(WOS).doc(woB).get()]);
  const dispatchedCount = [snapA, snapB].filter(
    (s) => s.data()?.status === "DISPATCHED" && s.data()?.assignedTechId === techId
  ).length;
  assert.equal(dispatchedCount, 1, "the technician must end up dispatched to exactly one Work Order, never both");
});

test("the per-technician lock doc is written (proves the fix's read+write-in-transaction contention path actually ran)", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techId = id("tech-solo");
  const woId = id("wo-solo");
  await seedWorkOrder(woId, { status: "SCHEDULED" });

  await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Dispatch", assignedTechId: techId }, dispatcherUid));

  const lockSnap = await db.collection(TECH_LOCKS).doc(techId).get();
  assert.equal(lockSnap.exists, true, "Dispatch must touch the per-technician lock sentinel");
});

test("DETERMINISTIC PROOF: two transactions that read+write the SAME per-technician lock doc cannot both commit -- one is forced to abort", async () => {
  // The two tests above exercise the real transitionWorkOrder callable end-to-end, but on a fast local emulator
  // both concurrent calls can round-trip quickly enough that they happen to serialize on their own, without ever
  // genuinely overlapping -- which would make those tests pass whether or not the lock is doing any work. This
  // test removes that timing luck entirely: it runs two bare transactions against the exact lock document path
  // production code uses (work_order_tech_locks/{technicianId}), with an artificial delay between the read and
  // the write so their execution windows are GUARANTEED to overlap, and disables automatic retry (maxAttempts: 1)
  // so a collision surfaces as an explicit rejection instead of being silently retried away. This directly proves
  // the mechanism the fix relies on: reading AND writing the same doc inside the transaction is what forces
  // Firestore write-write contention between two same-technician transitions.
  const techId = id("tech-direct-race");
  const lockRef = db.collection(TECH_LOCKS).doc(techId);

  const attempt = (label) =>
    db.runTransaction(
      async (tx) => {
        await tx.get(lockRef); // same read-before-write shape as techLockRef's call site in transitionWorkOrder.ts
        await new Promise((resolve) => setTimeout(resolve, 250)); // force the overlap
        tx.set(lockRef, { technicianId: techId, touchedBy: label }, { merge: true });
        return label;
      },
      { maxAttempts: 1 }
    );

  const results = await Promise.allSettled([attempt("first"), attempt("second")]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  // Empirically the emulator surfaces this as a real lock-hold conflict ("ABORTED: Transaction lock timeout")
  // rather than a version-mismatch conflict, since both transactions overlap on the SAME document -- either
  // shape proves the same thing: two transactions cannot both hold a live read+write on this doc at once.
  assert.ok(fulfilled.length <= 1, "at most one transaction may win the write-write collision on the shared lock doc (both winning would mean no contention at all)");
  assert.ok(rejected.length >= 1, "at least one MUST be forced to abort by Firestore -- both silently committing would mean the lock provides no contention");
});

test("Dispatch for DIFFERENT technicians on concurrent Work Orders is unaffected (no false contention)", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techA = id("tech-a");
  const techB = id("tech-b");
  const woA = id("wo-diff-a");
  const woB = id("wo-diff-b");
  await seedWorkOrder(woA, { status: "SCHEDULED" });
  await seedWorkOrder(woB, { status: "SCHEDULED" });

  const results = await Promise.allSettled([
    transitionWorkOrder.run(callRequest({ workOrderId: woA, action: "Dispatch", assignedTechId: techA }, dispatcherUid)),
    transitionWorkOrder.run(callRequest({ workOrderId: woB, action: "Dispatch", assignedTechId: techB }, dispatcherUid)),
  ]);

  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2, "different technicians must not contend with each other");
});
