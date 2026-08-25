// THE COMMERCIAL CHAIN, END TO END, AGAINST A REAL EMULATOR.
//
// GOVERNANCE: Owner Slice 4 §I.
//
//   Opportunity → Create Agreement → Edit Draft → Accept → WON → Sales Order → projection
//
// ════════════════════ WHY THIS FILE EXISTS SEPARATELY ════════════════════
//
// Every link in this chain already had its own test, and the chain still did not work: D1 shipped
// the pure commands with ZERO callers, so `sales_agreements` had no write path and the WON route
// was correct and unreachable. Unit tests cannot find that, because each one is right.
//
// So this test walks the path a person walks, through the REAL callables, and asserts the VALUES
// that come out — not that the functions were called. The committed price is followed from the
// agreement line a salesperson typed to the Sales Order line invoicing will bill.
//
// The callable boundary is exercised for auth/capability gating (`.run()`, the real handler), and
// the transactional cores are exercised directly below the gate — the convention
// createSalesOrderFromOpportunityCallable.test.mjs already establishes, because all four
// capabilities are registered active:false and deny for everyone until a separate grant.
//
// Prerequisite: npm run build; Firestore emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import test, { after } from "node:test";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const agreements = await import("../lib/salesAgreement/salesAgreementCallables.js");
const agreementRead = await import("../lib/salesAgreement/salesAgreementReadService.js");
const { persistCloseOpportunityAsWon } = await import("../lib/opportunity/closeOpportunityAsWon.js");
const { projectSalesOrder } = await import("../lib/salesOrder/salesOrderReadService.js");

const ACTOR = "actor-chain-1";
let seq = 0;
const uniq = (p) => `${p}-${Date.now()}-${++seq}`;
const request = (data, uid) => ({ data, auth: uid ? { uid, token: {} } : undefined });

const createdOpportunities = [];
const createdAgreements = [];

async function seedOpportunity(over = {}) {
  const id = uniq("chain-opp");
  await db.collection("opportunities").doc(id).set({
    opportunityNumber: `OPP-2026-${String(seq).padStart(6, "0")}`,
    accountId: "acct-chain-1",
    ownerEmployeeId: "emp-1",
    salesChannel: "RETAIL",
    stage: "QUOTING",
    outcome: null,
    lines: [{ kind: "PART", ref: "PRT-1005", qty: 1 }],
    ...over,
  });
  createdOpportunities.push(id);
  return id;
}

const tx = (fn) => db.runTransaction(fn);
const createAgreement = (opportunityId, over = {}) =>
  tx((t) =>
    agreements.persistCreateSalesAgreement(
      db, t,
      { opportunityId, ownerEmployeeId: "emp-1", idempotencyKey: over.idempotencyKey ?? `k-${opportunityId}`,
        lines: [{ kind: "PART", ref: "PRT-1005", quantity: 2, unitPrice: 12500 }], ...over },
      over.actorUid ?? ACTOR,
    ),
  ).then((r) => { if (r.salesAgreementId) createdAgreements.push(r.salesAgreementId); return r; });

const editDraft = (salesAgreementId, patch, key = "e-1") =>
  tx((t) => agreements.persistUpdateSalesAgreementDraft(db, t, { salesAgreementId, idempotencyKey: key, ...patch }, ACTOR));

const accept = (salesAgreementId, key = "a-1") =>
  tx((t) => agreements.persistAcceptSalesAgreement(db, t, { salesAgreementId, idempotencyKey: key }, ACTOR));

const won = (opportunityId, over = {}) =>
  tx((t) =>
    persistCloseOpportunityAsWon(
      db, t,
      { opportunityId, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: over.idempotencyKey ?? "w-1", ...over },
      ACTOR,
    ),
  );

const readAgreement = (id) => db.collection("sales_agreements").doc(id).get().then((s) => s.data());
const ordersFor = (opportunityId) =>
  db.collection("sales_orders").where("sourceOpportunityId", "==", opportunityId).get();

// Leaves the collections as it found them: salesOrderIndexRead.test.mjs asserts over the WHOLE
// sales_orders collection, and every order this suite creates would break its truncation
// assertions when both run against the same emulator.
after(async () => {
  for (const id of createdOpportunities) {
    const orders = await ordersFor(id);
    await Promise.all(orders.docs.map((d) => d.ref.delete()));
    await db.collection("opportunities").doc(id).delete().catch(() => {});
  }
  await Promise.all(createdAgreements.map((id) => db.collection("sales_agreements").doc(id).delete().catch(() => {})));
  const audits = await db.collection("auditEvents").where("actorUid", "==", ACTOR).get();
  await Promise.all(audits.docs.map((d) => d.ref.delete()));
});

// ═════════════════════════════════════════ 1-2. the callable boundary

test("every write callable rejects an UNAUTHENTICATED caller", async () => {
  const body = { opportunityId: "x", ownerEmployeeId: "emp-1", idempotencyKey: "k", salesAgreementId: "x" };
  for (const fn of ["createSalesAgreement", "updateSalesAgreementDraft", "acceptSalesAgreement"]) {
    await assert.rejects(agreements[fn].run(request(body)), (e) => e?.code === "unauthenticated", fn);
  }
  for (const fn of ["getSalesAgreementContext", "getSalesAgreementForOpportunity"]) {
    await assert.rejects(agreementRead[fn].run(request(body)), (e) => e?.code === "unauthenticated", fn);
  }
});

test("A CALLER WITHOUT THE CAPABILITY IS DENIED, and nothing is written", async () => {
  // An ACTIVE admin with a real global role grant. All four capabilities are registered
  // active:false, so this is a hard deny for everyone until a separate grant AND per-environment
  // activation — which is the posture the whole sales spine already has.
  const uid = uniq("chain-uid");
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(uniq("chain-role")).set({
    principalUid: uid, roleId: "admin", scope: { type: "global" },
    grantedBy: "test", grantedAt: admin.firestore.Timestamp.now(),
    status: "active", accessVersionAtGrant: 1,
  });
  const opp = await seedOpportunity();

  await assert.rejects(
    agreements.createSalesAgreement.run(request({ opportunityId: opp, ownerEmployeeId: "emp-1", idempotencyKey: "k", lines: [{ kind: "PART", ref: "A", quantity: 1, unitPrice: 1 }] }, uid)),
    (e) => e?.code === "permission-denied",
  );
  await assert.rejects(
    agreements.acceptSalesAgreement.run(request({ salesAgreementId: "any", idempotencyKey: "k" }, uid)),
    (e) => e?.code === "permission-denied",
  );
  await assert.rejects(
    agreementRead.getSalesAgreementContext.run(request({ salesAgreementId: "any" }, uid)),
    (e) => e?.code === "permission-denied",
  );
  const found = await db.collection("sales_agreements").where("sourceOpportunityId", "==", opp).get();
  assert.equal(found.empty, true, "a denied create must write nothing");
});

test("AUTHORIZATION RUNS BEFORE VALIDATION — a denied caller learns nothing about the payload", async () => {
  // My first version of this test asserted invalid-argument for a client-supplied accountId and
  // failed, because the capability gate fires first. That ordering is CORRECT and worth pinning:
  // validating first would tell an unauthorized caller which fields exist, which are required, and
  // which the server owns — a map of the command drawn for somebody who may not call it.
  const uid = uniq("chain-uid");
  for (const derived of ["accountId", "state", "acceptedByUid", "salesAgreementNumber", "totals"]) {
    await assert.rejects(
      agreements.createSalesAgreement.run(request({ opportunityId: "o", ownerEmployeeId: "e", idempotencyKey: "k", [derived]: "x" }, uid)),
      (e) => e?.code === "permission-denied",
      derived,
    );
  }
  // Missing every required field, still permission-denied rather than invalid-argument.
  await assert.rejects(agreements.createSalesAgreement.run(request({}, uid)), (e) => e?.code === "permission-denied");
});

test("THE ACCOUNT IS DERIVED, and a caller's own value does not win", async () => {
  // The guard on the callable rejects a client-supplied accountId outright, but a guard is a
  // promise about a payload. This asserts the BEHAVIOUR underneath it: the core reads the
  // Opportunity, and an accountId smuggled onto the core's input changes nothing.
  const opp = await seedOpportunity();
  const res = await tx((t) =>
    agreements.persistCreateSalesAgreement(
      db, t,
      { opportunityId: opp, ownerEmployeeId: "emp-1", idempotencyKey: "derive-1",
        accountId: "acct-ATTACKER", sourceOpportunityId: "opp-ATTACKER",
        lines: [{ kind: "PART", ref: "A", quantity: 1, unitPrice: 100 }] },
      ACTOR,
    ),
  );
  createdAgreements.push(res.salesAgreementId);
  const agr = await readAgreement(res.salesAgreementId);
  assert.equal(agr.accountId, "acct-chain-1", "the Opportunity's account, not the payload's");
  assert.equal(agr.sourceOpportunityId, opp, "the Opportunity called, not the one claimed");
});

// ═════════════════════════════════════════ 3-5. create derives its own truth

test("CREATE derives the account from the Opportunity and links both ways", async () => {
  const opp = await seedOpportunity();
  const res = await createAgreement(opp);
  assert.equal(res.replayed, false);
  assert.match(res.salesAgreementNumber, /^SA-\d{4}-\d{6}$/, "a human reference is allocated");

  const agr = await readAgreement(res.salesAgreementId);
  assert.equal(agr.accountId, "acct-chain-1", "SERVER-DERIVED from the Opportunity, never sent");
  assert.equal(agr.sourceOpportunityId, opp);
  assert.equal(agr.state, "DRAFT", "creation commits the business to nothing");
  assert.equal(agr.currency, "USD", "server-set");
  assert.equal(agr.salesOrderId, null, "honestly 'not converted yet', not an absent key");
  assert.equal(agr.createdByUid, ACTOR);

  const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
  assert.equal(oppDoc.salesAgreementId, res.salesAgreementId, "written in the SAME commit");
});

test("a second create for the same Opportunity is refused", async () => {
  const opp = await seedOpportunity();
  await createAgreement(opp);
  // A DIFFERENT key means the caller believes there is no agreement. Handing back somebody else's
  // terms as though they were the ones just submitted would launder that into a success.
  await assert.rejects(createAgreement(opp, { idempotencyKey: "different" }), (e) => /already has a Sales Agreement/.test(e.message));
  const all = await db.collection("sales_agreements").where("sourceOpportunityId", "==", opp).get();
  assert.equal(all.size, 1);
});

test("an Opportunity with no account, or a LOST one, cannot produce an agreement", async () => {
  const noAccount = await seedOpportunity({ accountId: null });
  await assert.rejects(createAgreement(noAccount), (e) => /accountId/.test(e.message));
  const lost = await seedOpportunity({ outcome: "LOST" });
  await assert.rejects(createAgreement(lost), (e) => /LOST/.test(e.message));
});

// ═════════════════════════════════════════ 6-8. draft editing and the pricing gate

test("DRAFT EDITING is bounded — terms move, identity does not", async () => {
  const opp = await seedOpportunity();
  const { salesAgreementId } = await createAgreement(opp);

  await editDraft(salesAgreementId, { customerPO: "PO-77", taxMinor: 300 });
  const after = await readAgreement(salesAgreementId);
  assert.equal(after.customerPO, "PO-77");
  assert.equal(after.totals.taxMinor, 300);
  assert.equal(after.totals.totalMinor, 25000 + 300, "totals recomputed, never caller-supplied");
  assert.equal(after.accountId, "acct-chain-1", "identity untouched");
  assert.equal(after.sourceOpportunityId, opp);
  assert.equal(after.state, "DRAFT");

  await assert.rejects(
    editDraft(salesAgreementId, { accountId: "acct-OTHER" }, "e-2"),
    (e) => /cannot be changed/.test(e.message),
  );
  assert.equal((await readAgreement(salesAgreementId)).accountId, "acct-chain-1");
});

test("AN EXPLICIT ZERO SURVIVES; an ABSENT price blocks acceptance", async () => {
  const zeroOpp = await seedOpportunity();
  const zero = await createAgreement(zeroOpp, { lines: [{ kind: "PART", ref: "FREE", quantity: 3, unitPrice: 0 }] });
  await accept(zero.salesAgreementId);
  const zeroDoc = await readAgreement(zero.salesAgreementId);
  assert.equal(zeroDoc.state, "ACCEPTED", "a waived charge is a real commercial act");
  assert.equal(zeroDoc.lines[0].unitPrice, 0);

  const unpricedOpp = await seedOpportunity();
  const unpriced = await createAgreement(unpricedOpp, { lines: [{ kind: "PART", ref: "TBD", quantity: 1 }] });
  await assert.rejects(accept(unpriced.salesAgreementId), (e) => /committed unit price/.test(e.message));
  assert.equal((await readAgreement(unpriced.salesAgreementId)).state, "DRAFT", "a refused accept leaves it a draft");
});

test("a FRACTIONAL price is refused at creation, so it can never reach acceptance", async () => {
  const opp = await seedOpportunity();
  await assert.rejects(
    createAgreement(opp, { lines: [{ kind: "PART", ref: "A", quantity: 1, unitPrice: 12.5 }] }),
    (e) => /integer|minor/i.test(e.message),
  );
  assert.equal((await db.collection("sales_agreements").where("sourceOpportunityId", "==", opp).get()).empty, true);
});

// ═════════════════════════════════════════ 9-10. acceptance is server-stamped and terminal

test("ACCEPT records the trusted actor and the server clock", async () => {
  const opp = await seedOpportunity();
  const { salesAgreementId } = await createAgreement(opp);
  const before = Date.now();
  await accept(salesAgreementId);
  const agr = await readAgreement(salesAgreementId);
  assert.equal(agr.state, "ACCEPTED");
  assert.equal(agr.acceptedByUid, ACTOR, "from request.auth, never from the payload");
  assert.ok(agr.acceptedAtMillis >= before, "from the server clock");
});

test("ACCEPTED COMMERCIAL TERMS ARE IMMUTABLE", async () => {
  const opp = await seedOpportunity();
  const { salesAgreementId } = await createAgreement(opp);
  await accept(salesAgreementId);
  // Prices a Sales Order was created from cannot move underneath it.
  for (const patch of [{ taxMinor: 1 }, { customerPO: "PO-9" }, { lines: [{ kind: "PART", ref: "A", quantity: 1, unitPrice: 1 }] }]) {
    await assert.rejects(editDraft(salesAgreementId, patch, `imm-${Object.keys(patch)[0]}`), (e) => /ACCEPTED/.test(e.message));
  }
  const agr = await readAgreement(salesAgreementId);
  assert.equal(agr.totals.taxMinor, 0);
  assert.equal(agr.lines[0].unitPrice, 12500);
});

// ═════════════════════════════════════════ 11-18. the chain, and the values that cross it

test("WON WITHOUT AN ACCEPTED AGREEMENT FAILS — no order, nothing closed", async () => {
  const none = await seedOpportunity({ stage: "DECISION" });
  await assert.rejects(won(none), (e) => /no sales agreement/i.test(e.message));

  const draftOnly = await seedOpportunity({ stage: "DECISION" });
  await createAgreement(draftOnly);
  await assert.rejects(won(draftOnly), (e) => /has not been accepted/i.test(e.message));

  for (const opp of [none, draftOnly]) {
    assert.equal((await ordersFor(opp)).size, 0);
    assert.equal((await db.collection("opportunities").doc(opp).get()).data().outcome, null);
  }
});

test("THE FULL CHAIN: the price a salesperson typed reaches the Sales Order line", async () => {
  const opp = await seedOpportunity({ stage: "DECISION" });
  const created = await createAgreement(opp, {
    lines: [
      { kind: "EQUIPMENT_MODEL", ref: "C713", quantity: 2, unitPrice: 500000 },
      { kind: "PART", ref: "PRT-1005", quantity: 4, unitPrice: 2500 },
    ],
  });
  // A real negotiation: the customer's PO arrives after the terms, and the price moves once.
  await editDraft(created.salesAgreementId, {
    customerPO: "PO-CHAIN",
    lines: [
      { kind: "EQUIPMENT_MODEL", ref: "C713", quantity: 2, unitPrice: 475000 },
      { kind: "PART", ref: "PRT-1005", quantity: 4, unitPrice: 2500 },
    ],
  });
  await accept(created.salesAgreementId);
  const wonRes = await won(opp);

  const order = (await ordersFor(opp)).docs[0].data();
  // THE POINT OF THE WHOLE SLICE. 475000 is the NEGOTIATED price, not the first one — proving the
  // order reads the agreement as it stands at acceptance, not as it was drafted.
  assert.equal(order.lines.length, 2);
  assert.equal(order.lines[0].unitPrice, 475000);
  assert.equal(order.lines[0].orderedQty, 2);
  assert.equal(order.lines[1].unitPrice, 2500);
  assert.equal(order.lines[1].orderedQty, 4);
  assert.equal(order.customerPO, "PO-CHAIN", "an operational fact travels with the order");
  assert.equal(order.accountId, "acct-chain-1");

  // expectedValue is NEVER substituted for a line price: no line carries the Opportunity's
  // forecast, and every line carries a real committed number.
  for (const l of order.lines) assert.ok(Number.isInteger(l.unitPrice) && l.unitPrice > 0);

  // Four-way lineage, all written in the same commit.
  const oppDoc = (await db.collection("opportunities").doc(opp).get()).data();
  const agr = await readAgreement(created.salesAgreementId);
  assert.equal(order.sourceAgreementId, created.salesAgreementId);
  assert.equal(order.sourceOpportunityId, opp);
  assert.equal(oppDoc.salesAgreementId, created.salesAgreementId);
  assert.equal(oppDoc.salesOrderId, wonRes.salesOrderId, "the pre-existing back-link, preserved");
  assert.equal(agr.salesOrderId, wonRes.salesOrderId, "the agreement names the order it became");
  assert.equal(oppDoc.outcome, "WON");
});

// ═════════════════════════════════════════ 19-20. retries create nothing twice

test("A RETRIED CREATE returns the original and consumes no sequence number", async () => {
  const opp = await seedOpportunity();
  const first = await createAgreement(opp, { idempotencyKey: "same" });
  const second = await createAgreement(opp, { idempotencyKey: "same" });
  assert.equal(second.replayed, true);
  assert.equal(second.salesAgreementId, first.salesAgreementId);
  assert.equal(second.salesAgreementNumber, first.salesAgreementNumber, "no second number was burned");
  assert.equal((await db.collection("sales_agreements").where("sourceOpportunityId", "==", opp).get()).size, 1);
});

test("A RETRIED ACCEPT and a RETRIED WON change nothing", async () => {
  const opp = await seedOpportunity({ stage: "DECISION" });
  const { salesAgreementId } = await createAgreement(opp);
  const firstAccept = await accept(salesAgreementId, "same");
  const replayAccept = await accept(salesAgreementId, "same");
  assert.equal(replayAccept.replayed, true);
  assert.equal(replayAccept.acceptedAtMillis, firstAccept.acceptedAtMillis, "the acceptance time does not move");

  const firstWon = await won(opp, { idempotencyKey: "same-won" });
  const replayWon = await won(opp, { idempotencyKey: "same-won" });
  assert.equal(replayWon.replayed, true);
  assert.equal(replayWon.salesOrderId, firstWon.salesOrderId);
  assert.equal((await ordersFor(opp)).size, 1, "exactly one Sales Order");
});

// ═════════════════════════════════════════ 21-22. what a screen may show, and what a client may reach

test("THE READ PROJECTION carries the values and the lineage, both ways", async () => {
  const opp = await seedOpportunity({ stage: "DECISION" });
  const { salesAgreementId } = await createAgreement(opp);
  await accept(salesAgreementId);
  await won(opp);

  const byId = await agreementRead.readSalesAgreementById(db, salesAgreementId);
  assert.equal(byId.status, "ready");
  assert.equal(byId.salesAgreement.lines[0].unitPriceMinor, 12500, "the committed price arrives");
  assert.equal(byId.salesAgreement.lines[0].extendedMinor, 25000);
  assert.equal(byId.salesAgreement.totalMinor, 25000);
  assert.equal(byId.salesAgreement.sourceOpportunityId, opp, "back to the negotiation");
  assert.ok(byId.salesAgreement.salesOrderId, "forward to the order");

  // The entry point a salesperson actually uses: standing on an Opportunity, not knowing whether an
  // agreement exists. "None yet" is the answer that decides between CREATE and VIEW.
  const byOpp = await agreementRead.readSalesAgreementForOpportunity(db, opp);
  assert.equal(byOpp.salesAgreement.id, salesAgreementId);
  const missing = await agreementRead.readSalesAgreementForOpportunity(db, "opp-that-does-not-exist");
  assert.equal(missing.status, "not-found");
  assert.equal(missing.salesAgreement, null);
});

test("NO RAW DOCUMENT ID IS EVER THE DISPLAYED IDENTITY", async () => {
  // DECISIONS #106. Both records carry an allocated business reference, and neither reference is
  // the document id — so nothing downstream can be tempted to render one.
  const opp = await seedOpportunity({ stage: "DECISION" });
  const { salesAgreementId } = await createAgreement(opp);
  await accept(salesAgreementId);
  await won(opp);

  const agr = (await agreementRead.readSalesAgreementById(db, salesAgreementId)).salesAgreement;
  assert.match(agr.salesAgreementNumber, /^SA-\d{4}-\d{6}$/);
  assert.notEqual(agr.salesAgreementNumber, agr.id);

  const orderDoc = (await ordersFor(opp)).docs[0];
  const so = projectSalesOrder(orderDoc.id, orderDoc.data());
  assert.match(so.salesOrderNumber, /^SO-\d{4}-\d{6}$/);
  assert.notEqual(so.salesOrderNumber, so.id);
  assert.equal(so.sourceAgreementId, salesAgreementId, "lineage is carried, but it is not a label");
});

test("NO CLIENT-DIRECT WRITE IS POSSIBLE — firestore.rules denies the collection outright", async () => {
  // The Admin SDK used above bypasses Rules by design, so this asserts the RULE TEXT rather than
  // attempting a client write the test harness cannot perform. sales_agreements must carry the same
  // explicit deny-all as sales_orders: an undeclared collection is denied by default, but the
  // default is the absence of a decision, and a future catch-all would silently open it.
  const { readFileSync } = await import("node:fs");
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const block = /match\s*\/sales_agreements\/\{[^}]*\}\s*\{\s*allow read,\s*write:\s*if false;\s*\}/;
  assert.match(rules, block, "sales_agreements must be an explicit client deny-all");
});
