// THE SALES AGREEMENT P1v2 DERIVATION LAYER, ASSERTED OFFLINE.
//
// This is PR 1 of the Sales Agreement North Star implementation
// (docs/implementation-plans/sales-agreement-north-star.md). The composition will be asserted in
// test/salesAgreementNorthStarPage.test.jsx when the page exists; this suite asserts the pure layer
// beneath it, feeding values in through the REAL projection (`salesAgreementView`) so the whole
// chain from read result to rendered fact is exercised rather than a hand-built view object.
//
// The assertions that carry the most weight are the ones about what must NOT be produced:
//
//   - a document id standing in as business identity
//   - a fabricated product display name (SA-G4)
//   - `$0.00` where the amount is unknown or absent
//   - a total, subtotal or balance on a draft with an unpriced line
//   - any acceptance language EOS cannot prove — the boundary the work order requires be held by
//     test rather than by review
//   - a decline, revise, supersede, reopen or replace command (ND-14, ND-15)
//   - a lifecycle spine (SA-D2)
//   - state and permission restrictions collapsed into one answer
import test from "node:test";
import assert from "node:assert/strict";
import { salesAgreementView, SALES_AGREEMENT_VIEW_STATE } from "../src/domain/salesAgreementView.js";
import * as NS from "../src/domain/salesAgreementNorthStar.js";
import {
  salesAgreementHeader,
  salesAgreementLines,
  salesAgreementMoneyLadder,
  salesAgreementAcceptance,
  salesAgreementProvenance,
  salesAgreementDownstream,
  salesAgreementTerms,
  salesAgreementActions,
  salesAgreementStateWords,
  salesAgreementStateTone,
  salesAgreementIsTerminal,
  SALES_AGREEMENT_STATE_LABEL,
  SALES_AGREEMENT_NO_ORDER_SENTENCE,
} from "../src/domain/salesAgreementNorthStar.js";
import { UNKNOWN_ACTOR_DISPLAY_NAME } from "../src/domain/actorDisplayName.js";
import {
  SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY,
  SALES_AGREEMENT_ACCEPT_CAPABILITY,
} from "../src/access/salesAgreementCapabilityAccess.js";

const DOC_ID = "MHc7xk2QpLbR9vTn4sYe";
const ACCEPTED_AT = 1_755_542_460_000;
const ACTOR_UID = "uid_9f2c4b81aa";

const LINE_EQUIPMENT = {
  lineId: "ln-1", kind: "EQUIPMENT_MODEL", ref: "TAY-C712", quantity: 2,
  unitPrice: 980000, condition: "NEW", warranty: "12 mo parts & labour",
  estimatedArrivalMillis: 1_756_000_000_000,
};
const LINE_PART = { lineId: "ln-2", kind: "PART", ref: "X49463-3", quantity: 12, unitPrice: 17500, condition: "NEW" };
const LINE_SERVICE = { lineId: "ln-3", kind: "SERVICE", ref: "SVC-INSTALL-COMM", quantity: 4, unitPrice: 43750 };

/** Mirrors the read service's own projection shape, including its recomputed `extendedMinor`. */
const projectLine = (l) => ({
  lineId: l.lineId, kind: l.kind, ref: l.ref, quantity: l.quantity,
  unitPriceMinor: typeof l.unitPrice === "number" ? l.unitPrice : null,
  extendedMinor: typeof l.unitPrice === "number" && typeof l.quantity === "number" ? l.unitPrice * l.quantity : null,
  condition: l.condition ?? null, warranty: l.warranty ?? null,
  estimatedArrivalMillis: l.estimatedArrivalMillis ?? null,
});

function agreement(overrides = {}) {
  const lines = (overrides.lines ?? [LINE_EQUIPMENT, LINE_PART, LINE_SERVICE]).map(projectLine);
  const fullyPriced = lines.length > 0 && lines.every((l) => l.extendedMinor !== null);
  const subtotalMinor = fullyPriced ? lines.reduce((n, l) => n + l.extendedMinor, 0) : null;
  const shippingMinor = overrides.shippingMinor ?? 60000;
  const installChargeMinor = overrides.installChargeMinor ?? 25000;
  const taxMinor = overrides.taxMinor ?? 164605;
  const downPaymentMinor = overrides.downPaymentMinor ?? 500000;
  const tradeInMinor = overrides.tradeInMinor ?? 150000;
  const totalMinor = subtotalMinor === null ? null : subtotalMinor + shippingMinor + installChargeMinor + taxMinor;
  return {
    id: DOC_ID,
    salesAgreementNumber: "SA-2026-000003",
    state: "DRAFT",
    accountId: "acct_desert_sun",
    ownerEmployeeId: "emp_ramado",
    locationId: "loc_broadway",
    currency: "USD",
    customerPO: "PO-88231",
    isLease: false,
    fulfillmentIntent: "BOTH",
    shippingInstructions: "Loading dock, 22nd St entrance.",
    shipVia: "Taylor truck",
    specialInstructions: "Commission both freezers on the same visit.",
    sourceOpportunityId: "opp_1842",
    salesOrderId: null,
    acceptedAtMillis: null,
    acceptedByUid: null,
    ...overrides,
    lines,
    subtotalMinor, shippingMinor, installChargeMinor, taxMinor, totalMinor,
    downPaymentMinor, tradeInMinor,
    balanceMinor: totalMinor === null ? null : totalMinor - downPaymentMinor - tradeInMinor,
  };
}

const view = (overrides) =>
  salesAgreementView({ result: { status: "ready", salesAgreement: agreement(overrides) }, loading: false, errorStatus: null });

const DRAFT = () => view();
const DRAFT_UNPRICED = () => view({ lines: [LINE_EQUIPMENT, { ...LINE_PART, unitPrice: undefined }, LINE_SERVICE] });
const ACCEPTED = () => view({ state: "ACCEPTED", acceptedAtMillis: ACCEPTED_AT, acceptedByUid: ACTOR_UID, salesOrderId: "so_15" });
const ACCEPTED_NO_ORDER = () => view({ state: "ACCEPTED", acceptedAtMillis: ACCEPTED_AT, acceptedByUid: ACTOR_UID });
const DECLINED = () => view({ state: "DECLINED" });

const DIRECTORY = new Map([[ACTOR_UID, { displayName: "R. Amado" }]]);
const grantAll = () => true;
const grantNone = () => false;

/** Every string this module can put in front of a reader, for the vocabulary assertions. */
function derivedStrings(v, opts = {}) {
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(salesAgreementHeader(v, opts));
  walk(salesAgreementLines(v, opts));
  walk(salesAgreementMoneyLadder(v));
  walk(salesAgreementAcceptance(v, { byUserId: DIRECTORY, formatWhen: () => "Aug 18, 2026 · 2:41 PM" }));
  walk(salesAgreementProvenance(v));
  walk(salesAgreementDownstream(v, { salesOrderNumber: "SO-2026-000015" }));
  walk(salesAgreementTerms(v));
  walk(salesAgreementActions(v, { hasCapability: grantAll }));
  walk(salesAgreementActions(v, { hasCapability: grantNone }));
  return out;
}

// ═════════════════════════════════════════ 1–2. THE TWO PRIMARY STATES DERIVE

test("a DRAFT agreement derives a complete presentation", () => {
  const v = DRAFT();
  assert.equal(v.kind, SALES_AGREEMENT_VIEW_STATE.READY);
  const h = salesAgreementHeader(v);
  assert.equal(h.stateWords, "Draft");
  assert.equal(h.stateTone, "info");
  assert.equal(h.isTerminal, false);
  assert.equal(salesAgreementLines(v).length, 3);
  assert.equal(salesAgreementMoneyLadder(v).complete, true);
  assert.equal(salesAgreementAcceptance(v).accepted, false);
  assert.ok(salesAgreementTerms(v).rows.length > 0);
});

test("an ACCEPTED agreement derives a complete presentation", () => {
  const v = ACCEPTED();
  const h = salesAgreementHeader(v);
  assert.equal(h.stateWords, "Accepted");
  assert.equal(h.stateTone, "positive");
  assert.equal(h.isTerminal, true);
  assert.equal(salesAgreementMoneyLadder(v).complete, true);
  assert.equal(salesAgreementAcceptance(v, { byUserId: DIRECTORY }).accepted, true);
  assert.equal(salesAgreementDownstream(v).hasOrder, true);
});

// ═════════════════════════════════════════ 3–4. IDENTITY IS THE GOVERNED REFERENCE

test("the governed display number is the title when present", () => {
  const h = salesAgreementHeader(DRAFT());
  assert.equal(h.title, "SA-2026-000003");
  assert.equal(h.reference, "SA-2026-000003");
  assert.equal(h.isNumbered, true);
});

test("a missing display number never exposes the document id as business identity", () => {
  const v = view({ salesAgreementNumber: null });
  const h = salesAgreementHeader(v);
  assert.equal(h.title, "Sales Agreement");
  assert.equal(h.reference, null);
  assert.equal(h.isNumbered, false);
  // The id is carried on the view for routing. It must reach no rendered string, anywhere.
  assert.equal(v.id, DOC_ID);
  for (const s of derivedStrings(v)) assert.ok(!s.includes(DOC_ID), `document id leaked in: ${s}`);
});

// ═════════════════════════════════════════ 5–6. SA-G4 — THE LINE'S IDENTITY IS ITS REF

test("ref remains the truthful line identity when no display name can be resolved", () => {
  const lines = salesAgreementLines(DRAFT());
  assert.deepEqual(lines.map((l) => l.ref), ["TAY-C712", "X49463-3", "SVC-INSTALL-COMM"]);
  for (const l of lines) {
    assert.equal(l.displayName, null);
    assert.equal(l.displayNameResolved, false);
  }
});

test("a missing catalogue display name is never fabricated from the ref", () => {
  const lines = salesAgreementLines(DRAFT(), { resolveDisplayName: () => null });
  for (const l of lines) {
    assert.equal(l.displayName, null, "an unresolved name must stay null, not become the ref");
    assert.notEqual(l.displayName, l.ref);
  }
  // A name that CAN be resolved is composed, and still never replaces the identity.
  const named = salesAgreementLines(DRAFT(), {
    resolveDisplayName: (ref) => (ref === "TAY-C712" ? "Taylor C712 Soft Serve Freezer" : null),
  });
  assert.equal(named[0].displayName, "Taylor C712 Soft Serve Freezer");
  assert.equal(named[0].displayNameResolved, true);
  assert.equal(named[0].ref, "TAY-C712", "the reference stays the identity even when a name resolves");
  assert.equal(named[1].displayNameResolved, false);
});

// ═════════════════════════════════════════ 7–9. MONEY

test("quantity and the governed committed price derive correctly", () => {
  const [equipment] = salesAgreementLines(DRAFT());
  assert.equal(equipment.quantity, 2);
  assert.equal(equipment.unitPriceMinor, 980000);
  assert.equal(equipment.unitPriceFormatted, "$9,800.00");
  assert.equal(equipment.extendedMinor, 1960000);
  assert.equal(equipment.extendedFormatted, "$19,600.00");
  assert.equal(equipment.priced, true);
});

test("an unknown price stays unknown and never becomes $0.00", () => {
  const v = DRAFT_UNPRICED();
  const unpriced = salesAgreementLines(v).find((l) => l.ref === "X49463-3");
  assert.equal(unpriced.unitPriceMinor, null);
  assert.equal(unpriced.unitPriceFormatted, null);
  assert.equal(unpriced.extendedFormatted, null);
  assert.equal(unpriced.priced, false);

  const ladder = salesAgreementMoneyLadder(v);
  assert.equal(ladder.complete, false);
  assert.equal(ladder.unpricedCount, 1);
  assert.deepEqual(ladder.unpricedRefs, ["X49463-3"], "the blocker must name every unpriced line");
  // No partial sum is offered under any name.
  assert.equal(ladder.saleComposition.subtotal, null);
  assert.equal(ladder.saleComposition.total, null);
  assert.equal(ladder.credits.balance, null);
  for (const s of derivedStrings(v)) assert.ok(!/\$0\.00/.test(s), `zero stood in for unknown money: ${s}`);
});

test("an absent or zero charge row is omitted rather than rendered as zero", () => {
  const zeroed = view({ shippingMinor: 0, installChargeMinor: 0, taxMinor: 0, downPaymentMinor: 0, tradeInMinor: 0 });
  const ladder = salesAgreementMoneyLadder(zeroed);
  assert.equal(ladder.complete, true, "zero charges do not make an agreement incomplete");
  assert.equal(ladder.saleComposition.shipping, null);
  assert.equal(ladder.saleComposition.installCharge, null);
  assert.equal(ladder.saleComposition.tax, null);
  assert.equal(ladder.credits.downPayment, null);
  assert.equal(ladder.credits.tradeIn, null);
  assert.ok(ladder.saleComposition.total, "the total still renders — it is a real computed amount");
  for (const s of derivedStrings(zeroed)) assert.ok(!/\$0\.00/.test(s), `a zero charge was rendered: ${s}`);
});

test("currency is preserved from governed truth and drives the one display path", () => {
  const v = DRAFT();
  assert.equal(salesAgreementHeader(v).currency, "USD");
  const ladder = salesAgreementMoneyLadder(v);
  assert.equal(ladder.currency, "USD");
  assert.equal(ladder.saleComposition.total.formatted, "$25,946.05");
  assert.equal(ladder.credits.balance.formatted, "$19,446.05");
  // An agreement with no currency renders bare digits rather than assuming dollars.
  const noCurrency = salesAgreementMoneyLadder(view({ currency: null }));
  assert.equal(noCurrency.currency, null);
  assert.ok(!noCurrency.saleComposition.total.formatted.includes("$"));
});

test("balance is subordinate to the total and is not an accounts-receivable balance", () => {
  const ladder = salesAgreementMoneyLadder(DRAFT());
  assert.equal(ladder.credits.isAccountsReceivable, false);
  assert.ok(ladder.credits.balance.minor < ladder.saleComposition.total.minor);
  assert.equal(ladder.credits.balance.minor, 1944605);
});

// ═════════════════════════════════════════ 10–13. ACCEPTANCE EVIDENCE

test("the accepted timestamp derives when present", () => {
  const a = salesAgreementAcceptance(ACCEPTED(), { byUserId: DIRECTORY, formatWhen: (ms) => `at:${ms}` });
  assert.equal(a.recordedAtMillis, ACCEPTED_AT);
  assert.equal(a.recordedAtText, `at:${ACCEPTED_AT}`);
  // A draft has no acceptance event, and says so rather than showing an empty timestamp.
  const draft = salesAgreementAcceptance(DRAFT(), { byUserId: DIRECTORY });
  assert.equal(draft.recordedAtMillis, null);
  assert.deepEqual(draft.statements, [NS.SALES_AGREEMENT_ACCEPTANCE_STATEMENTS.notRecorded]);
});

test("the acceptance actor derives when the directory resolves it", () => {
  const a = salesAgreementAcceptance(ACCEPTED(), { byUserId: DIRECTORY });
  assert.equal(a.actorName, "R. Amado");
  assert.equal(a.actorResolved, true);
  assert.equal(NS.SALES_AGREEMENT_ACCEPTANCE_LABEL.actor, "Action executed by");
});

test("an unresolved actor derives the governed Unknown user fallback, never the raw uid", () => {
  for (const directory of [new Map(), undefined, null]) {
    const a = salesAgreementAcceptance(ACCEPTED(), { byUserId: directory });
    assert.equal(a.actorName, UNKNOWN_ACTOR_DISPLAY_NAME);
    assert.equal(a.actorName, "Unknown user");
    assert.equal(a.actorResolved, false);
    assert.notEqual(a.actorName, ACTOR_UID);
  }
  // F-UID-1: a raw Firebase uid must never reach a non-Admin DOM, from any derivation.
  for (const s of derivedStrings(ACCEPTED())) assert.ok(!s.includes(ACTOR_UID), `raw uid leaked in: ${s}`);
});

test("ACCEPTANCE BOUNDARY: accepted state never becomes a customer-signature or legal assertion", () => {
  // The rule the implementation work order requires be held by TEST rather than by review.
  // Semantic, not screenshot-shaped: every string any derivation can produce, in every state.
  const FORBIDDEN = [
    /\bbinding\b/i, /\bsigned\b/i, /\bsignature\b/i, /\be-?signature\b/i, /\belectronic(ally)?\b/i,
    /\bcustomer accepted\b/i, /customer'?s commitment/i, /\bcustomer signed\b/i,
    /\blegally\b/i, /\benforceab/i, /\bexecuted by the customer\b/i,
  ];
  const ALLOWED_NEGATIVE = NS.SALES_AGREEMENT_ACCEPTANCE_STATEMENTS.noSignatureEvidence;

  for (const v of [DRAFT(), DRAFT_UNPRICED(), ACCEPTED(), ACCEPTED_NO_ORDER(), DECLINED()]) {
    for (const s of derivedStrings(v)) {
      if (s === ALLOWED_NEGATIVE) continue; // the one permitted mention, and it is a denial
      for (const pattern of FORBIDDEN) {
        assert.ok(!pattern.test(s), `unproven acceptance language ${pattern} in: ${s}`);
      }
    }
  }

  // And the evidence itself is exactly the three facts EOS writes, plus an explicit denial.
  const a = salesAgreementAcceptance(ACCEPTED(), { byUserId: DIRECTORY, formatWhen: () => "when" });
  assert.equal(a.holdsCustomerSignatureEvidence, false);
  assert.ok(a.statements.includes(ALLOWED_NEGATIVE));
  assert.ok(a.statements.includes(NS.SALES_AGREEMENT_ACCEPTANCE_STATEMENTS.recorded));
  assert.ok(a.statements.includes(NS.SALES_AGREEMENT_ACCEPTANCE_STATEMENTS.readOnly));
});

// ═════════════════════════════════════════ 14–17. PROVENANCE AND DOWNSTREAM

test("Opportunity provenance derives correctly", () => {
  assert.equal(salesAgreementProvenance(DRAFT()).sourceOpportunityId, "opp_1842");
  assert.equal(salesAgreementHeader(DRAFT()).sourceOpportunityId, "opp_1842");
});

test("Account/customer provenance derives correctly, and a name only when one is supplied", () => {
  const v = DRAFT();
  assert.equal(salesAgreementProvenance(v).accountId, "acct_desert_sun");
  const bare = salesAgreementHeader(v);
  assert.equal(bare.accountId, "acct_desert_sun");
  assert.equal(bare.accountName, null, "the projection carries an id, not a name");
  const named = salesAgreementHeader(v, { resolveAccountName: () => "Desert Sun Beverage Co." });
  assert.equal(named.accountName, "Desert Sun Beverage Co.");
  assert.equal(named.accountId, "acct_desert_sun");
});

test("existing Sales Order lineage derives correctly", () => {
  const d = salesAgreementDownstream(ACCEPTED(), { salesOrderNumber: "SO-2026-000015" });
  assert.equal(d.hasOrder, true);
  assert.equal(d.salesOrderId, "so_15");
  assert.equal(d.salesOrderNumber, "SO-2026-000015");
  assert.equal(d.noOrderSentence, null);
  assert.equal(salesAgreementProvenance(ACCEPTED()).salesOrderId, "so_15");
});

test("no Sales Order produces the honest no-downstream state and the exact governed trigger", () => {
  const d = salesAgreementDownstream(ACCEPTED_NO_ORDER());
  assert.equal(d.hasOrder, false);
  assert.equal(d.salesOrderId, null);
  assert.equal(d.noOrderSentence, SALES_AGREEMENT_NO_ORDER_SENTENCE);
  // Acceptance is a PRECONDITION; the Opportunity's close is the trigger, and it may refuse.
  assert.equal(d.acceptanceIsPrecondition, true);
  assert.equal(d.triggeredByOpportunityClose, true);
  assert.match(d.noOrderSentence, /Opportunity is closed as won/);
  assert.match(d.noOrderSentence, /requires this agreement to be accepted first/);
  // No inevitability, and no create affordance: the order does not come from this record.
  assert.ok(!/will be created|automatically/i.test(d.noOrderSentence));
  assert.ok(!("createSalesOrder" in d));
});

// ═════════════════════════════════════════ 18–20. STATE, COMMANDS, AND RESTRICTIONS

test("DECLINED is representable as a state, and exposes no command (ND-14)", () => {
  const v = DECLINED();
  assert.equal(salesAgreementStateWords(v), "Declined");
  assert.equal(salesAgreementStateTone(v), "negative");
  assert.equal(salesAgreementIsTerminal(v), true);
  // The state renders; the record stays readable.
  assert.equal(salesAgreementLines(v).length, 3);
  assert.ok(salesAgreementTerms(v).rows.length > 0);
  // No callable produces DECLINED, so no action may offer it — under any capability grant.
  for (const hasCapability of [grantAll, grantNone]) {
    const actions = salesAgreementActions(v, { hasCapability });
    assert.deepEqual(Object.keys(actions).sort(), ["accept", "edit"]);
    assert.equal(actions.edit.present, false);
    assert.equal(actions.accept.present, false);
    for (const s of derivedStrings(v)) assert.ok(!/\bdecline\b/i.test(s), `a decline affordance appeared: ${s}`);
  }
});

test("a terminal agreement derives no edit, revise, reopen or replace command (ND-15)", () => {
  const BANNED = /\b(revise|revision|supersede|superseded|reopen|replace|duplicate|amend|amendment)\b/i;
  for (const v of [ACCEPTED(), DECLINED()]) {
    const actions = salesAgreementActions(v, { hasCapability: grantAll });
    // ABSENT, not disabled — the engine forbids editing a terminal record.
    assert.equal(actions.edit.present, false);
    assert.equal(actions.edit.restriction, "state");
    assert.equal(actions.accept.present, false);
    for (const s of derivedStrings(v)) assert.ok(!BANNED.test(s), `a revision affordance appeared: ${s}`);
  }
  // The only two command ids this family may ever name.
  const ids = Object.values(salesAgreementActions(DRAFT(), { hasCapability: grantAll })).map((a) => a.id);
  assert.deepEqual(ids.sort(), ["acceptSalesAgreement", "updateSalesAgreementDraft"]);
});

test("state restriction and permission restriction stay distinguishable", () => {
  // 1. Blocked by STATE the user can fix: unpriced lines. Carries the view model's OWN reason.
  const blocked = salesAgreementActions(DRAFT_UNPRICED(), { hasCapability: grantAll });
  assert.equal(blocked.accept.present, true);
  assert.equal(blocked.accept.available, false);
  assert.equal(blocked.accept.restriction, "state");
  assert.match(blocked.accept.reason, /Every line needs a price/);
  assert.match(blocked.accept.reason, /X49463-3/, "the reason names the unpriced line");
  assert.ok(!/permission/i.test(blocked.accept.reason), "a state block must not read as a permission problem");

  // 2. Blocked by PERMISSION, with the capability's own sentence.
  const denied = salesAgreementActions(DRAFT(), { hasCapability: grantNone });
  assert.equal(denied.accept.present, true);
  assert.equal(denied.accept.available, false);
  assert.equal(denied.accept.restriction, "permission");
  assert.match(denied.accept.reason, /do not have permission/i);
  assert.equal(denied.edit.restriction, "permission");
  assert.match(denied.edit.reason, /do not have permission/i);

  // 3. Blocked by STATE terminally: the control is gone, not disabled.
  assert.equal(salesAgreementActions(ACCEPTED(), { hasCapability: grantAll }).edit.present, false);

  // 4. Granted and permitted: both live.
  const live = salesAgreementActions(DRAFT(), { hasCapability: grantAll });
  assert.equal(live.accept.available, true);
  assert.equal(live.accept.restriction, null);
  assert.equal(live.edit.available, true);

  // Fail-closed: a caller that injects no capability resolver gets no live control.
  const bare = salesAgreementActions(DRAFT());
  assert.equal(bare.accept.available, false);
  assert.equal(bare.edit.available, false);
  // And the capability ids used are the governed ones, not strings invented here.
  assert.equal(SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY, "salesAgreement.updateDraft");
  assert.equal(SALES_AGREEMENT_ACCEPT_CAPABILITY, "salesAgreement.accept");
});

// ═════════════════════════════════════════ THE ABSENCES THE DESIGN DEPENDS ON

test("SA-D2: this family exports no lifecycle spine, and adding one must fail here first", () => {
  const spineish = Object.keys(NS).filter((k) => /spine|chevron|lifecycle|progress|stages/i.test(k));
  assert.deepEqual(spineish, [], `a lifecycle progression was added: ${spineish.join(", ")}`);
});

test("state words come from the entity definition, not a private copy", () => {
  assert.deepEqual(SALES_AGREEMENT_STATE_LABEL, { DRAFT: "Draft", ACCEPTED: "Accepted", DECLINED: "Declined" });
});

test("non-READY view states derive nothing rather than a half-record", () => {
  for (const errorStatus of ["not-enabled", "permission-denied", "unavailable"]) {
    const v = salesAgreementView({ result: null, loading: false, errorStatus });
    assert.notEqual(v.kind, SALES_AGREEMENT_VIEW_STATE.READY);
    assert.equal(salesAgreementHeader(v), null);
    assert.equal(salesAgreementMoneyLadder(v), null);
    assert.equal(salesAgreementAcceptance(v), null);
    assert.equal(salesAgreementDownstream(v), null);
    assert.deepEqual(salesAgreementLines(v), []);
    assert.deepEqual(salesAgreementActions(v, { hasCapability: grantAll }), { edit: null, accept: null });
  }
});

test("terms omit absent fields rather than dashing them, and never leak a raw enum", () => {
  const full = salesAgreementTerms(DRAFT());
  assert.equal(full.rows.find((r) => r.id === "fulfillmentIntent").value, "Deliver and install");
  assert.equal(full.rows.find((r) => r.id === "isLease").value, "No — purchase");
  const sparse = salesAgreementTerms(view({ customerPO: null, shipVia: null, shippingInstructions: null, specialInstructions: null }));
  assert.equal(sparse.rows.find((r) => r.id === "customerPO"), undefined);
  assert.equal(sparse.rows.find((r) => r.id === "shipVia"), undefined);
  assert.equal(sparse.shippingInstructions, null);
  // The currency row is an ISO code by design and is exempt; every other row must be in words.
  for (const r of full.rows.filter((r) => r.id !== "currency")) {
    assert.ok(!/^[A-Z_]+$/.test(r.value), `raw enum leaked: ${r.value}`);
  }
  // An unrecognised intent is dropped, not echoed.
  const odd = salesAgreementTerms(view({ fulfillmentIntent: "TELEPORT" }));
  assert.equal(odd.rows.find((r) => r.id === "fulfillmentIntent"), undefined);
});
