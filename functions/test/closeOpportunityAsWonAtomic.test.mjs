// Atomic WON + Sales Order — EMULATOR tests.
//
// These exercise the behaviours that only a real transaction can demonstrate: read/write
// ordering, idempotent replay, concurrent serialization, counter allocation, and the
// recovery paths for a split-brain left by the older two-call sequence.
//
// THE ORDERING TEST IS THE POINT. The reason this operation exists as its own orchestrator
// rather than a composition of the two existing cores is that Firestore requires all reads
// before all writes, and `allocateSalesOrderNumber` is itself read-then-write. If the order
// regresses, the transaction fails at RUNTIME on the one path that must never fail. A test
// that merely asserts the happy path would catch that only by luck; the first test below
// asserts it deliberately.
//
// Prerequisite: npm run build; Firestore emulator running.
// Run: node --test test/closeOpportunityAsWonAtomic.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import test, { after } from "node:test";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { persistCloseOpportunityAsWon } = await import("../lib/opportunity/closeOpportunityAsWon.js");
// Imported, not hardcoded: an assertion about the counter must point at the SAME document the
// allocator uses, or it silently measures an empty doc and passes for the wrong reason.
const { salesOrderCounterDocId } = await import("../lib/salesOrder/salesOrderNumbering.js");

const ACTOR = "actor-won-1";
let seq = 0;
const uniq = () => `won-${Date.now()}-${++seq}`;

// WHY EVERY FIXTURE NOW SEEDS AN AGREEMENT
//
// An Opportunity alone can no longer produce a Sales Order, and that is the point of the change
// under test: an Opportunity carries `expectedValue`, one forecast number, and lines with NO price.
// Orders derived from it were unpriced, which is where the seven unpriced CONFIRMED sandbox records
// came from. Prices now come from the ACCEPTED Agreement.
//
// So a WON-convertible Opportunity is an Opportunity PLUS an accepted Agreement. Seeding one here is
// not a workaround for the gate -- it is the fixture telling the truth about the precondition. The
// refusal cases below pass `agreement: null` and assert the gate directly.
async function seedAgreement(opportunityId, over = {}) {
  const id = `agr-${opportunityId}`;
  await db.collection("sales_agreements").doc(id).set({
    accountId: "acct-1",
    ownerEmployeeId: "emp-1",
    sourceOpportunityId: opportunityId,
    state: "ACCEPTED",
    currency: "USD",
    lines: [{ lineId: "l1", kind: "PART", ref: "PRT-1005", quantity: 1, unitPrice: 2500, extendedMinor: 2500 }],
    ...over,
  });
  createdAgreements.push(id);
  return id;
}

async function seedOpportunity(over = {}) {
  const { agreement, ...oppOver } = over;
  const id = uniq();
  await db.collection("opportunities").doc(id).set({
    opportunityNumber: `OPP-2026-${String(seq).padStart(6, "0")}`,
    accountId: "acct-1",
    ownerEmployeeId: "emp-1",
    salesChannel: "RETAIL",
    stage: "DECISION",
    outcome: null,
    lines: [{ kind: "PART", ref: "PRT-1005", qty: 1 }],
    ...oppOver,
  });
  createdOpportunities.push(id);
  // `agreement: null` means "seed no agreement" -- for the cases that assert the refusal.
  if (agreement !== null) await seedAgreement(id, agreement ?? {});
  return id;
}

const run = (opportunityId, over = {}) =>
  db.runTransaction((tx) =>
    persistCloseOpportunityAsWon(
      db,
      tx,
      {
        opportunityId,
        ownerEmployeeId: "emp-1",
        salesChannel: "RETAIL",
        idempotencyKey: over.idempotencyKey ?? "key-1",
        ...over,
      },
      over.actorUid ?? ACTOR,
    ),
  );

const ordersFor = (opportunityId) =>
  db.collection("sales_orders").where("sourceOpportunityId", "==", opportunityId).get();

// THIS SUITE CLEANS UP AFTER ITSELF, and that is not tidiness -- it is required.
// salesOrderIndexRead.test.mjs asserts over the WHOLE sales_orders collection and says so in
// its own comments ("the whole collection is exactly the 7 rows seeded above"). Every order
// this suite creates would be an extra row that breaks that suite's truncation assertions
// when both run against the same emulator. Leaving the collection as we found it keeps the
// two suites independent without either having to know about the other.
const createdOpportunities = [];
const createdAgreements = [];
const seededIds = () => createdOpportunities;

after(async () => {
  for (const id of createdOpportunities) {
    const orders = await ordersFor(id);
    await Promise.all(orders.docs.map((d) => d.ref.delete()));
    await db.collection("opportunities").doc(id).delete().catch(() => {});
  }
  await Promise.all(createdAgreements.map((id) => db.collection("sales_agreements").doc(id).delete().catch(() => {})));
  // Audit events are keyed by this suite's actor, so they are removable without touching
  // anything another suite depends on.
  const audits = await db.collection("auditEvents").where("actorUid", "==", ACTOR).get();
  await Promise.all(audits.docs.map((d) => d.ref.delete()));
});

// ---------------------------------------------------------------- ordering

test("READ-AFTER-WRITE PREVENTION: the transaction commits, proving the counter read precedes every write", async () => {
  // If allocateSalesOrderNumber (read-then-write) ran after the transition or audit writes,
  // Firestore would reject this outright. A clean commit IS the assertion.
  const opp = await seedOpportunity();
  const res = await run(opp);
  assert.equal(res.success, true);
  assert.equal(res.replayed, false);
  assert.ok(res.salesOrderId, "a Sales Order id must be returned");
  assert.match(res.salesOrderNumber ?? "", /^SO-\d{4}-\d{6}$/, "a human-readable number must be allocated");
});

// ---------------------------------------------------------------- happy path

test("DECISION + open + no order -> atomically WON with exactly one Sales Order and correct lineage", async () => {
  const opp = await seedOpportunity();
  const res = await run(opp);

  const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
  assert.equal(oppDoc.outcome, "WON", "the Opportunity must be WON");
  assert.equal(oppDoc.salesOrderId, res.salesOrderId, "forward lineage: Opportunity -> Sales Order");

  const orders = await ordersFor(opp);
  assert.equal(orders.size, 1, "exactly one Sales Order");
  assert.equal(orders.docs[0].data().sourceOpportunityId, opp, "back lineage: Sales Order -> Opportunity");
  assert.equal(orders.docs[0].data().accountId, "acct-1", "account is server-derived from the Opportunity");
});

test("THE AGREEMENT'S PRICED LINES REACH THE PERSISTED ORDER -- not the Opportunity's", async () => {
  // The Opportunity says qty 3 of PRT-1005 with no price; the Agreement commits qty 7 at 12,500.
  // They are deliberately different, because a test where both agree cannot tell you which one
  // the code read. What lands in Firestore names the authority.
  const opp = await seedOpportunity({
    lines: [{ kind: "PART", ref: "PRT-1005", qty: 3 }],
    agreement: {
      lines: [{ lineId: "l1", kind: "PART", ref: "PRT-9", quantity: 7, unitPrice: 12500, extendedMinor: 87500 }],
    },
  });
  await run(opp);
  const order = (await ordersFor(opp)).docs[0].data();
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].ref, "PRT-9", "the Agreement's line, not the Opportunity's");
  assert.equal(order.lines[0].orderedQty, 7);
  assert.equal(order.lines[0].unitPrice, 12500, "THE COMMITTED PRICE ARRIVES -- this is the whole slice");
  assert.equal(order.currency, "USD");
});

test("LINEAGE: the order, the opportunity and the agreement all point at each other after one commit", async () => {
  const opp = await seedOpportunity();
  const res = await run(opp);
  const order = (await ordersFor(opp)).docs[0].data();
  const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
  const agr = (await db.collection("sales_agreements").doc(`agr-${opp}`).get()).data();
  assert.equal(order.sourceAgreementId, `agr-${opp}`, "the order names the commitment it fulfils");
  assert.equal(oppDoc.salesAgreementId, `agr-${opp}`, "added beside salesOrderId, not replacing it");
  assert.equal(oppDoc.salesOrderId, res.salesOrderId, "the existing backlink is preserved exactly");
  // Written in the SAME transaction, so it can never point at an order that was not committed.
  assert.equal(agr.salesOrderId, res.salesOrderId);
});

// ---------------------------------------------------------------- the gate

test("NO AGREEMENT: an Opportunity alone cannot become a Sales Order, and NOTHING is written", async () => {
  const opp = await seedOpportunity({ agreement: null });
  await assert.rejects(run(opp), (e) => /no sales agreement/i.test(e.message));
  const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
  assert.equal(oppDoc.outcome, null, "the opportunity must not be closed");
  assert.equal(oppDoc.salesOrderId ?? null, null);
  assert.equal((await ordersFor(opp)).size, 0, "no order, and no counter consumed for one");
});

test("DRAFT AGREEMENT: provisional prices are not a commitment", async () => {
  const opp = await seedOpportunity({ agreement: { state: "DRAFT" } });
  await assert.rejects(run(opp), (e) => /has not been accepted/i.test(e.message));
  assert.equal((await ordersFor(opp)).size, 0);
});

test("AN AGREEMENT FOR ANOTHER ACCOUNT is refused rather than converted", async () => {
  const opp = await seedOpportunity({ agreement: { accountId: "acct-OTHER" } });
  await assert.rejects(run(opp), (e) => /different customer/i.test(e.message));
  assert.equal((await ordersFor(opp)).size, 0);
});

// ---------------------------------------------------------------- replay + retry

test("SAME-KEY REPLAY returns the same Sales Order and creates nothing new", async () => {
  const opp = await seedOpportunity();
  const first = await run(opp, { idempotencyKey: "same-key" });
  const second = await run(opp, { idempotencyKey: "same-key" });
  assert.equal(second.replayed, true);
  assert.equal(second.salesOrderId, first.salesOrderId);
  assert.equal((await ordersFor(opp)).size, 1, "still exactly one order");
  // REGRESSION: this returned null on every replay. The number was read off the audit event, and
  // buildAuditEventDoc writes a FIXED field set -- so the salesOrderNumber staged onto its input
  // was silently dropped and never stored. A retrying caller lost the reference to the order it had
  // just created, and "replayed: true, salesOrderNumber: null" reads like an order without a
  // number. Asserting the VALUE, not just that the ids match, is what catches it.
  assert.match(first.salesOrderNumber ?? "", /^SO-\d{4}-\d{6}$/);
  assert.equal(second.salesOrderNumber, first.salesOrderNumber, "a replay returns the SAME number");
});

test("DIFFERENT-KEY RETRY on an already-ordered Opportunity RETURNS the order rather than throwing", async () => {
  // The behaviour the standalone callable gets wrong: it raises failed-precondition. A Won
  // retry must be safe to repeat, so it returns what exists.
  const opp = await seedOpportunity();
  const first = await run(opp, { idempotencyKey: "key-a" });
  const second = await run(opp, { idempotencyKey: "key-b" });
  assert.equal(second.salesOrderId, first.salesOrderId, "the SAME order is returned");
  assert.equal((await ordersFor(opp)).size, 1);
});

// ---------------------------------------------------------------- recovery

test("ALREADY WON WITH NO ORDER recovers by creating the missing Sales Order", async () => {
  // The exact split-brain the old two-call sequence could leave behind.
  const opp = await seedOpportunity({ stage: "DECISION", outcome: "WON" });
  const res = await run(opp, { idempotencyKey: "recover-1" });
  assert.equal(res.recovered, true, "reported as a recovery, not an ordinary close");
  assert.equal((await ordersFor(opp)).size, 1);
  const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
  assert.equal(oppDoc.salesOrderId, res.salesOrderId, "lineage repaired");
});

test("EXISTING ORDER WITH A MISSING BACKLINK repairs the Opportunity without creating a second order", async () => {
  const opp = await seedOpportunity({ outcome: "WON" });
  const first = await run(opp, { idempotencyKey: "k1" });
  // Simulate the half-write: clear the Opportunity's pointer.
  await db.collection("opportunities").doc(opp).update({ salesOrderId: admin.firestore.FieldValue.delete() });
  const second = await run(opp, { idempotencyKey: "k2" });
  assert.equal(second.salesOrderId, first.salesOrderId);
  const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
  assert.equal(oppDoc.salesOrderId, first.salesOrderId, "backlink restored");
  assert.equal((await ordersFor(opp)).size, 1, "no second order");
});

test("CONFLICTING EXISTING ORDER fails closed rather than being silently accepted", async () => {
  const opp = await seedOpportunity();
  await run(opp, { idempotencyKey: "k1" });
  // Corrupt the lineage: the existing order now claims a different account.
  const order = (await ordersFor(opp)).docs[0];
  await order.ref.update({ accountId: "acct-SOMEONE-ELSE" });
  await assert.rejects(
    run(opp, { idempotencyKey: "k2" }),
    (e) => /not this Opportunity's account/.test(String(e?.message)),
    "a mismatched account must not be laundered into a success",
  );
});

// ---------------------------------------------------------------- rejections

test("LOST is rejected", async () => {
  const opp = await seedOpportunity({ outcome: "LOST" });
  await assert.rejects(run(opp), (e) => /LOST/.test(String(e?.message)));
  assert.equal((await ordersFor(opp)).size, 0, "no order for a lost Opportunity");
});

test("a stage before DECISION is rejected, and leaves NEITHER a Won nor an order", async () => {
  for (const stage of ["IDENTIFIED", "QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW"]) {
    const opp = await seedOpportunity({ stage });
    await assert.rejects(run(opp), `WON must be rejected from ${stage}`);
    const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
    assert.equal(oppDoc.outcome, null, `${stage}: outcome must be untouched`);
    assert.equal((await ordersFor(opp)).size, 0, `${stage}: no order`);
  }
});

test("FAILURE BEFORE COMMIT leaves neither a Won Opportunity nor a Sales Order", async () => {
  // No lines -> buildTransitionPatch raises NO_LINES before any write. The whole transaction
  // must be a no-op, which is the property the old two-call sequence could not offer.
  const opp = await seedOpportunity({ lines: [] });
  await assert.rejects(run(opp));
  const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
  assert.equal(oppDoc.outcome, null, "not Won");
  assert.equal(oppDoc.salesOrderId ?? null, null, "no lineage written");
  assert.equal((await ordersFor(opp)).size, 0, "no order");
});

// ---------------------------------------------------------------- concurrency

test("CONCURRENT Won attempts produce exactly one Sales Order", async () => {
  const opp = await seedOpportunity();
  const results = await Promise.allSettled([
    run(opp, { idempotencyKey: "c1" }),
    run(opp, { idempotencyKey: "c2" }),
    run(opp, { idempotencyKey: "c3" }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  assert.ok(ok.length >= 1, "at least one attempt must succeed");
  const orders = await ordersFor(opp);
  assert.equal(orders.size, 1, "exactly one Sales Order despite concurrent attempts");
  // Every attempt that succeeded must name the SAME order.
  const ids = new Set(ok.map((r) => r.value.salesOrderId));
  assert.equal(ids.size, 1, "all successful attempts must report the same Sales Order");
});

test("COUNTER INCREMENTS EXACTLY ONCE per created order, and not at all on a returned one", async () => {
  const year = new Date().getUTCFullYear();
  const counterRef = db.collection("counters").doc(salesOrderCounterDocId(year));
  const before = (await counterRef.get()).data()?.sequence ?? 0;

  const opp = await seedOpportunity();
  await run(opp, { idempotencyKey: "count-1" });
  const afterCreate = (await counterRef.get()).data()?.sequence ?? 0;
  assert.equal(afterCreate, before + 1, "one create consumes exactly one sequence value");

  // A different-key retry returns the existing order and must NOT burn a number.
  await run(opp, { idempotencyKey: "count-2" });
  const afterRetry = (await counterRef.get()).data()?.sequence ?? 0;
  assert.equal(afterRetry, afterCreate, "returning an existing order allocates no number");
});
