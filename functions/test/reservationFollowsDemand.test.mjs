// RESERVATION FOLLOWS CURRENT DEMAND (DECISIONS #165, ruling 3).
//
// Prerequisite (also how CI runs it):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/reservationFollowsDemand.test.mjs
//
// THE GAPS THESE CLOSE. A reservation was made at DISPATCH against that moment's qtyPlanned and
// then frozen. Change the plan afterwards and the commitment no longer described the obligation:
//   · decrease  → stock stayed over-committed, invisible and unusable to every other demand
//   · increase  → stock stayed under-committed; the extra was only picked up at COMPLETED, where
//                 it could fail closed long after anyone could do something about it
//   · removal   → releaseParts iterated the CURRENT plan, so a deleted requirement's reservation
//                 had nothing to iterate and was orphaned until… nothing. It simply leaked.
//
// Same harness as inventoryService.test.mjs: the compiled module against a live emulator. Stock is
// seeded as GOVERNED LEDGER EVIDENCE (RECEIVED at an ACTIVE warehouse), never the static catalogue
// — that baseline is retired and a part with no ledger evidence is UNKNOWN, not stocked.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";

const admin = (await import("firebase-admin")).default;
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { reserveParts, releaseParts, reconcileReservation } = await import("../lib/inventoryService.js");

const WOS = "fieldops_wos";
const LEDGER = "inventory_transactions";
const WAREHOUSES = "warehouses";
const WH = "wh-reservation-follows-demand";

let n = 0;
const uid = (label) => `${label}-${Date.now()}-${++n}`;

async function seedStock(partId, quantity) {
  await db.collection(WAREHOUSES).doc(WH).set({ id: WH, status: "ACTIVE" }, { merge: true });
  await db.collection(LEDGER).add({
    workOrderId: "",
    partId,
    type: "RECEIVED",
    quantity,
    trackingMode: "NONE",
    location: { type: "WAREHOUSE", locationId: WH },
    schemaVersion: 2,
    timestamp: admin.firestore.Timestamp.now(),
  });
}

const setPlan = (woId, items) => db.collection(WOS).doc(woId).set({ id: woId, inventorySnapshot: items });

/** Outstanding commitment this WO holds for a part: RESERVED − RELEASED − CONSUMED. */
async function outstanding(woId, partId) {
  const snap = await db.collection(LEDGER).where("workOrderId", "==", woId).where("partId", "==", partId).get();
  return snap.docs.reduce((sum, d) => {
    const t = d.data();
    if (t.type === "RESERVED") return sum + t.quantity;
    if (t.type === "RELEASED" || t.type === "CONSUMED") return sum - t.quantity;
    return sum;
  }, 0);
}

// ─────────────────────────── increase ───────────────────────────

test("qtyPlanned INCREASE reserves only the delta, not the whole line again", async () => {
  const part = uid("PART-INC");
  const wo = uid("wo");
  await seedStock(part, 10);
  await setPlan(wo, [{ sku: part, qtyPlanned: 3 }]);
  await reserveParts(wo);
  assert.equal(await outstanding(wo, part), 3);

  await setPlan(wo, [{ sku: part, qtyPlanned: 5 }]);
  await reconcileReservation(wo);

  assert.equal(await outstanding(wo, part), 5, "the commitment tracks the new obligation");
  const snap = await db.collection(LEDGER).where("workOrderId", "==", wo).where("partId", "==", part).get();
  const reserved = snap.docs.map((d) => d.data()).filter((t) => t.type === "RESERVED").map((t) => t.quantity).sort();
  assert.deepEqual(reserved, [2, 3], "a 3 then a DELTA of 2 — never a second full 5");
});

test("an INCREASE that cannot be covered fails closed and lands nothing", async () => {
  const part = uid("PART-INC-SHORT");
  const wo = uid("wo");
  await seedStock(part, 4);
  await setPlan(wo, [{ sku: part, qtyPlanned: 4 }]);
  await reserveParts(wo);

  await setPlan(wo, [{ sku: part, qtyPlanned: 9 }]);
  await assert.rejects(() => reconcileReservation(wo), /Insufficient stock/);
  assert.equal(await outstanding(wo, part), 4, "the original commitment is untouched — no partial top-up");
});

test("an INCREASE is all-or-nothing ACROSS parts", async () => {
  const ok = uid("PART-OK");
  const short = uid("PART-SHORT");
  const wo = uid("wo");
  await seedStock(ok, 10);
  await seedStock(short, 2);
  await setPlan(wo, [{ sku: ok, qtyPlanned: 1 }, { sku: short, qtyPlanned: 1 }]);
  await reserveParts(wo);

  await setPlan(wo, [{ sku: ok, qtyPlanned: 4 }, { sku: short, qtyPlanned: 8 }]);
  await assert.rejects(() => reconcileReservation(wo), /Insufficient stock/);
  assert.equal(await outstanding(wo, ok), 1, "the coverable part must not be topped up alone");
  assert.equal(await outstanding(wo, short), 1);
});

// ─────────────────────────── decrease ───────────────────────────

test("qtyPlanned DECREASE releases exactly the excess", async () => {
  const part = uid("PART-DEC");
  const wo = uid("wo");
  await seedStock(part, 10);
  await setPlan(wo, [{ sku: part, qtyPlanned: 6 }]);
  await reserveParts(wo);

  await setPlan(wo, [{ sku: part, qtyPlanned: 2 }]);
  await reconcileReservation(wo);

  assert.equal(await outstanding(wo, part), 2);
  const snap = await db.collection(LEDGER).where("workOrderId", "==", wo).where("partId", "==", part).get();
  const released = snap.docs.map((d) => d.data()).filter((t) => t.type === "RELEASED");
  assert.equal(released.length, 1);
  assert.equal(released[0].quantity, 4, "exactly the excess, not the whole reservation");
});

test("released stock genuinely returns to the pool for a DIFFERENT Work Order", async () => {
  // The point of releasing promptly: someone else can use it. Proven end to end rather than by
  // reading the ledger, because the ledger arithmetic being right is only half the claim.
  const part = uid("PART-POOL");
  const first = uid("wo");
  const second = uid("wo");
  await seedStock(part, 5);
  await setPlan(first, [{ sku: part, qtyPlanned: 5 }]);
  await reserveParts(first);

  await setPlan(second, [{ sku: part, qtyPlanned: 3 }]);
  await assert.rejects(() => reserveParts(second), /Insufficient stock/, "nothing is free yet");

  await setPlan(first, [{ sku: part, qtyPlanned: 1 }]);
  await reconcileReservation(first);
  await reserveParts(second);
  assert.equal(await outstanding(second, part), 3, "the freed units are usable by other demand");
  assert.equal(await outstanding(first, part), 1);
});

// ─────────────────────────── removal ───────────────────────────

test("a REMOVED requirement releases its whole outstanding reservation", async () => {
  const kept = uid("PART-KEPT");
  const dropped = uid("PART-DROPPED");
  const wo = uid("wo");
  await seedStock(kept, 10);
  await seedStock(dropped, 10);
  await setPlan(wo, [{ sku: kept, qtyPlanned: 2 }, { sku: dropped, qtyPlanned: 7 }]);
  await reserveParts(wo);
  assert.equal(await outstanding(wo, dropped), 7);

  await setPlan(wo, [{ sku: kept, qtyPlanned: 2 }]); // the requirement is gone entirely
  await reconcileReservation(wo);

  assert.equal(await outstanding(wo, dropped), 0, "the orphan is released, not leaked");
  assert.equal(await outstanding(wo, kept), 2, "and the surviving requirement is untouched");
});

test("CANCEL releases a reservation whose requirement was already removed from the plan", async () => {
  // The orphan gap on the cancel path: releaseParts used to iterate the CURRENT plan, so a
  // reservation whose plan row had been deleted had nothing to iterate and leaked forever.
  const part = uid("PART-ORPHAN");
  const wo = uid("wo");
  await seedStock(part, 6);
  await setPlan(wo, [{ sku: part, qtyPlanned: 6 }]);
  await reserveParts(wo);

  await setPlan(wo, []); // plan emptied WITHOUT reconciling — the reservation is now an orphan
  assert.equal(await outstanding(wo, part), 6, "precondition: the orphan exists");

  await releaseParts(wo);
  assert.equal(await outstanding(wo, part), 0, "cancel releases from the LEDGER, not from the plan");
});

// ─────────────────────────── idempotency / no-op ───────────────────────────

test("reconciling an unchanged plan writes nothing", async () => {
  const part = uid("PART-NOOP");
  const wo = uid("wo");
  await seedStock(part, 10);
  await setPlan(wo, [{ sku: part, qtyPlanned: 4 }]);
  await reserveParts(wo);
  const before = (await db.collection(LEDGER).where("workOrderId", "==", wo).get()).size;

  await reconcileReservation(wo);
  await reconcileReservation(wo);

  assert.equal((await db.collection(LEDGER).where("workOrderId", "==", wo).get()).size, before, "no churn");
  assert.equal(await outstanding(wo, part), 4);
});

test("reconciling a Work Order that never reserved commits nothing", async () => {
  // Planning before dispatch must stay side-effect free: there is no commitment to follow yet.
  // (The caller also gates on the governed DISPATCHED marker; this proves the function itself is
  // safe even if that gate were bypassed... for a plan whose parts it has never reserved.)
  const part = uid("PART-UNDISPATCHED");
  const wo = uid("wo");
  await seedStock(part, 10);
  await setPlan(wo, [{ sku: part, qtyPlanned: 0 }]);
  await reconcileReservation(wo);
  assert.equal(await outstanding(wo, part), 0);
  assert.equal((await db.collection(LEDGER).where("workOrderId", "==", wo).get()).size, 0, "no ledger entry at all");
});
