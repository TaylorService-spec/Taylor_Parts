// THE SALES AGREEMENT BY-ID READ SEAM — PR 2, asserted offline.
//
// The seam a routed record page needs: it accepts a governed Sales Agreement identity, invokes the
// EXISTING `getSalesAgreementContext` callable, keeps the honest read states apart, and hands the
// projection to PR 1's derivation unchanged.
//
// Every decision the seam makes lives in domain/salesAgreementRead.js precisely so this suite can
// reach it under `node --test` without a DOM. What remains in the hook is two React guards, and the
// source assertions at the bottom hold the line that matters about the hook: it reads through the
// governed callable and through nothing else.
//
// The case this suite exists to pin down is the one the view model alone cannot answer: NONE means
// two different things depending on which question produced it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  planSalesAgreementRead,
  interpretSalesAgreementReadResponse,
  salesAgreementAbsence,
  SALES_AGREEMENT_READ_MODE,
  SALES_AGREEMENT_ABSENCE,
  SALES_AGREEMENT_ABSENCE_SENTENCE,
  SALES_AGREEMENT_READ_NOT_ENABLED,
} from "../src/domain/salesAgreementRead.js";
import { salesAgreementView, SALES_AGREEMENT_VIEW_STATE as STATE } from "../src/domain/salesAgreementView.js";
import {
  salesAgreementHeader,
  salesAgreementLines,
  salesAgreementMoneyLadder,
  salesAgreementAcceptance,
  salesAgreementDownstream,
  salesAgreementActions,
} from "../src/domain/salesAgreementNorthStar.js";
import { UNKNOWN_ACTOR_DISPLAY_NAME } from "../src/domain/actorDisplayName.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.resolve(here, "../src", p), "utf8");

const AGREEMENT_ID = "MHc7xk2QpLbR9vTn4sYe";
const ACTOR_UID = "uid_9f2c4b81aa";
const ACCEPTED_AT = 1_755_542_460_000;

/** Exactly the shape functions/src/salesAgreement/salesAgreementReadService.ts returns. */
function projection(overrides = {}) {
  return {
    status: "ready",
    salesAgreement: {
      id: AGREEMENT_ID,
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
      lines: [
        { lineId: "ln-1", kind: "EQUIPMENT_MODEL", ref: "TAY-C712", quantity: 2, unitPriceMinor: 980000, extendedMinor: 1960000, condition: "NEW", warranty: "12 mo parts & labour", estimatedArrivalMillis: 1_756_000_000_000 },
        { lineId: "ln-2", kind: "PART", ref: "X49463-3", quantity: 12, unitPriceMinor: 17500, extendedMinor: 210000, condition: "NEW", warranty: null, estimatedArrivalMillis: null },
      ],
      subtotalMinor: 2170000, shippingMinor: 60000, installChargeMinor: 25000, taxMinor: 164605,
      totalMinor: 2419605, downPaymentMinor: 500000, tradeInMinor: 150000, balanceMinor: 1769605,
      sourceOpportunityId: "opp_1842",
      salesOrderId: null,
      acceptedAtMillis: null,
      acceptedByUid: null,
      ...overrides,
    },
  };
}

/** Drives the seam exactly as the hook does: plan → transport → interpret → view. */
function readOnce({ salesAgreementId = AGREEMENT_ID, enabled = true, transport } = {}) {
  const calls = [];
  const plan = planSalesAgreementRead({ salesAgreementId, enabled });
  if (!plan.shouldRead) {
    return { calls, view: salesAgreementView({ result: null, loading: false, errorStatus: plan.errorStatus }) };
  }
  calls.push(plan.salesAgreementId);
  const { result, errorStatus } = interpretSalesAgreementReadResponse(transport(plan.salesAgreementId));
  return { calls, view: salesAgreementView({ result, loading: false, errorStatus }) };
}

const ok = (overrides) => () => ({ result: projection(overrides) });
const fails = (errorStatus) => () => ({ errorStatus });

// ═════════════════════════════════════════ SUCCESS

test("a successful by-id read reaches READY with the governed identity", () => {
  const { calls, view } = readOnce({ transport: ok() });
  assert.deepEqual(calls, [AGREEMENT_ID], "the governed id is what gets asked for, verbatim");
  assert.equal(view.kind, STATE.READY);
  assert.equal(view.salesAgreementNumber, "SA-2026-000003");
  assert.equal(view.id, AGREEMENT_ID, "the id is carried for routing");
});

test("a DRAFT record derives through the PR 1 contract", () => {
  const { view } = readOnce({ transport: ok() });
  const header = salesAgreementHeader(view);
  assert.equal(header.stateWords, "Draft");
  assert.equal(header.isTerminal, false);
  assert.equal(salesAgreementLines(view).length, 2);
  assert.equal(salesAgreementMoneyLadder(view).complete, true);
  assert.equal(salesAgreementAcceptance(view).accepted, false);
});

test("an ACCEPTED record derives through the PR 1 contract", () => {
  const { view } = readOnce({
    transport: ok({ state: "ACCEPTED", acceptedAtMillis: ACCEPTED_AT, acceptedByUid: ACTOR_UID, salesOrderId: "so_15" }),
  });
  const header = salesAgreementHeader(view);
  assert.equal(header.stateWords, "Accepted");
  assert.equal(header.isTerminal, true);
  const acceptance = salesAgreementAcceptance(view, {
    byUserId: new Map([[ACTOR_UID, { displayName: "R. Amado" }]]),
    formatWhen: () => "Aug 18, 2026 · 2:41 PM",
  });
  assert.equal(acceptance.accepted, true);
  assert.equal(acceptance.recordedAtMillis, ACCEPTED_AT);
  assert.equal(acceptance.actorName, "R. Amado");
  assert.equal(salesAgreementDownstream(view).hasOrder, true);
});

test("an unresolved acceptance actor derives the governed fallback, never the raw uid", () => {
  const { view } = readOnce({
    transport: ok({ state: "ACCEPTED", acceptedAtMillis: ACCEPTED_AT, acceptedByUid: ACTOR_UID }),
  });
  const acceptance = salesAgreementAcceptance(view, { byUserId: new Map() });
  assert.equal(acceptance.actorName, UNKNOWN_ACTOR_DISPLAY_NAME);
  assert.equal(acceptance.actorResolved, false);
  assert.notEqual(acceptance.actorName, ACTOR_UID);
});

test("an accepted record with no Sales Order derives the honest no-downstream state", () => {
  const { view } = readOnce({
    transport: ok({ state: "ACCEPTED", acceptedAtMillis: ACCEPTED_AT, acceptedByUid: ACTOR_UID, salesOrderId: null }),
  });
  const downstream = salesAgreementDownstream(view);
  assert.equal(downstream.hasOrder, false);
  assert.match(downstream.noOrderSentence, /Opportunity is closed as won/);
  assert.equal(downstream.acceptanceIsPrecondition, true);
});

// ═════════════════════════════════════════ THE HONEST STATES, KEPT APART

test("loading is its own state and claims nothing about whether a record exists", () => {
  const view = salesAgreementView({ result: null, loading: true, errorStatus: null });
  assert.equal(view.kind, STATE.LOADING);
  assert.equal(salesAgreementHeader(view), null);
  assert.equal(salesAgreementAbsence(view, SALES_AGREEMENT_READ_MODE.BY_ID), null, "loading is not absence");
});

test("a disabled feature asks nothing at all and reports NOT_ENABLED", () => {
  const { calls, view } = readOnce({ enabled: false, transport: () => assert.fail("no read may be attempted") });
  assert.deepEqual(calls, [], "not-enabled must not produce a doomed round trip");
  assert.equal(view.kind, STATE.NOT_ENABLED);
  assert.equal(planSalesAgreementRead({ salesAgreementId: AGREEMENT_ID, enabled: false }).errorStatus, SALES_AGREEMENT_READ_NOT_ENABLED);
  // Any value that is not exactly `true` disables the read — a truthy string or a 0 must not be
  // mistaken for an opt-in. An ABSENT `enabled` takes the documented default of true, matching
  // useSalesAgreement's own signature; this is a read behind a capability-gated callable, so the
  // default governs console noise rather than authority, and the two hooks agreeing matters more.
  for (const enabled of [null, 0, "yes", false, 1]) {
    assert.equal(planSalesAgreementRead({ salesAgreementId: AGREEMENT_ID, enabled }).shouldRead, false, `enabled=${JSON.stringify(enabled)}`);
  }
  assert.equal(planSalesAgreementRead({ salesAgreementId: AGREEMENT_ID }).shouldRead, true, "absent enabled defaults to true");
});

test("permission denied is a permission answer, not an outage", () => {
  const { view } = readOnce({ transport: fails("permission-denied") });
  assert.equal(view.kind, STATE.DENIED);
  assert.notEqual(view.kind, STATE.UNAVAILABLE);
  assert.notEqual(view.kind, STATE.NONE);
});

test("a read failure is unavailable, and never reads as 'no agreement'", () => {
  for (const code of ["internal", "unavailable", "deadline-exceeded", "unauthenticated"]) {
    const { view } = readOnce({ transport: fails(code) });
    assert.equal(view.kind, STATE.UNAVAILABLE, `${code} must be UNAVAILABLE`);
    assert.notEqual(view.kind, STATE.NONE);
    assert.equal(salesAgreementAbsence(view, SALES_AGREEMENT_READ_MODE.BY_ID), null, "a failed read is not an absence");
  }
});

test("an id with nothing behind it is NOT_FOUND, never an invitation to create", () => {
  const { view } = readOnce({ transport: () => ({ result: { status: "not-found", salesAgreement: null } }) });
  assert.equal(view.kind, STATE.NONE);
  // The finding this seam exists to record: the SAME view state means two different things.
  assert.equal(salesAgreementAbsence(view, SALES_AGREEMENT_READ_MODE.BY_ID), SALES_AGREEMENT_ABSENCE.NOT_FOUND);
  assert.equal(salesAgreementAbsence(view, SALES_AGREEMENT_READ_MODE.BY_OPPORTUNITY), SALES_AGREEMENT_ABSENCE.NONE_YET);
  assert.equal(SALES_AGREEMENT_ABSENCE_SENTENCE.NOT_FOUND, "No sales agreement matches this address.");
  assert.notEqual(SALES_AGREEMENT_ABSENCE_SENTENCE.NOT_FOUND, SALES_AGREEMENT_ABSENCE_SENTENCE.NONE_YET);
});

test("no identity yet is idle, not an error", () => {
  for (const id of [null, undefined, "", "   "]) {
    const plan = planSalesAgreementRead({ salesAgreementId: id, enabled: true });
    assert.equal(plan.shouldRead, false);
    assert.equal(plan.errorStatus, null, "a route parameter still resolving has not failed");
  }
  const plan = planSalesAgreementRead({ salesAgreementId: `  ${AGREEMENT_ID}  ` });
  assert.equal(plan.salesAgreementId, AGREEMENT_ID, "the id is trimmed, never re-derived");
});

// ═════════════════════════════════════════ THE PROJECTION ARRIVES UNCHANGED

test("the derivation contract receives the actual projection, field for field", () => {
  const { view } = readOnce({ transport: ok() });
  const agreement = projection().salesAgreement;
  // A reference is not an arrival: feed values in, assert the values that come out.
  for (const key of [
    "id", "salesAgreementNumber", "state", "accountId", "ownerEmployeeId", "locationId", "currency",
    "customerPO", "fulfillmentIntent", "shippingInstructions", "shipVia", "specialInstructions",
    "subtotalMinor", "shippingMinor", "installChargeMinor", "taxMinor", "totalMinor",
    "downPaymentMinor", "tradeInMinor", "balanceMinor", "sourceOpportunityId", "salesOrderId",
    "acceptedAtMillis", "acceptedByUid",
  ]) {
    assert.deepEqual(view[key], agreement[key], `${key} did not survive the seam`);
  }
  const [line] = salesAgreementLines(view);
  assert.equal(line.ref, "TAY-C712");
  assert.equal(line.quantity, 2);
  assert.equal(line.unitPriceMinor, 980000);
  assert.equal(salesAgreementMoneyLadder(view).saleComposition.total.minor, 2419605);
});

test("the seam interprets transport answers without renaming the callable's own codes", () => {
  assert.deepEqual(interpretSalesAgreementReadResponse({ errorStatus: "permission-denied" }), { result: null, errorStatus: "permission-denied" });
  assert.deepEqual(interpretSalesAgreementReadResponse({ result: { status: "ready" } }), { result: { status: "ready" }, errorStatus: null });
  assert.deepEqual(interpretSalesAgreementReadResponse({}), { result: null, errorStatus: null });
  assert.deepEqual(interpretSalesAgreementReadResponse(undefined), { result: null, errorStatus: null });
});

// ═════════════════════════════════════════ THE FENCES, HELD AT THE SOURCE

test("the seam reads through the governed callable and through nothing else", () => {
  const hook = src("hooks/useSalesAgreementById.js");
  const plan = src("domain/salesAgreementRead.js");
  assert.match(hook, /getSalesAgreementContext/, "the governed by-id callable is the read");
  for (const file of [hook, plan]) {
    assert.ok(!/firebase\/firestore/.test(file), "no direct Firestore read may compete with the callable");
    assert.ok(!/collection\(|onSnapshot\(|getDocs\(|getDoc\(/.test(file), "no direct document read");
  }
  // And it reads by id only — the by-opportunity read stays with the hook that owns it.
  assert.ok(!/getSalesAgreementForOpportunity/.test(hook));
});

test("the seam exposes no mutation authority", () => {
  const hook = src("hooks/useSalesAgreementById.js");
  for (const command of [
    "createSalesAgreement", "updateSalesAgreementDraft", "acceptSalesAgreement",
    "decline", "revise", "supersede", "reopen", "replaceAgreement",
  ]) {
    assert.ok(!new RegExp(`\\b${command}\\b`).test(hook), `${command} must not be reachable from the read seam`);
  }
  assert.ok(!/idempotencyKey/.test(hook), "a read needs no retry key; carrying one implies a write");
});

test("no unsupported acceptance or customer-signature language enters the seam", () => {
  const FORBIDDEN = [/\bbinding\b/i, /\bsigned\b/i, /\bsignature\b/i, /\belectronic(ally)?\b/i, /\bcustomer accepted\b/i, /customer'?s commitment/i];
  const strings = [
    ...Object.values(SALES_AGREEMENT_ABSENCE_SENTENCE),
    ...Object.values(SALES_AGREEMENT_ABSENCE),
    ...Object.values(SALES_AGREEMENT_READ_MODE),
    SALES_AGREEMENT_READ_NOT_ENABLED,
  ];
  for (const s of strings) for (const p of FORBIDDEN) assert.ok(!p.test(s), `unproven language ${p} in: ${s}`);

  // And an accepted record read through this seam still says only what EOS proves.
  const { view } = readOnce({ transport: ok({ state: "ACCEPTED", acceptedAtMillis: ACCEPTED_AT, acceptedByUid: ACTOR_UID }) });
  const acceptance = salesAgreementAcceptance(view, { byUserId: new Map() });
  assert.equal(acceptance.holdsCustomerSignatureEvidence, false);
  for (const s of acceptance.statements) {
    if (/No customer-signature evidence is stored/.test(s)) continue; // the one permitted denial
    for (const p of FORBIDDEN) assert.ok(!p.test(s), `unproven language ${p} in: ${s}`);
  }
});

test("state restriction and permission restriction survive the seam intact", () => {
  const unpriced = ok({ lines: [
    { lineId: "ln-1", kind: "PART", ref: "X49463-3", quantity: 12, unitPriceMinor: null, extendedMinor: null, condition: null, warranty: null, estimatedArrivalMillis: null },
  ] });
  const blocked = readOnce({ transport: unpriced }).view;
  const stateBlocked = salesAgreementActions(blocked, { hasCapability: () => true });
  assert.equal(stateBlocked.accept.restriction, "state");
  assert.match(stateBlocked.accept.reason, /X49463-3/);

  const denied = salesAgreementActions(readOnce({ transport: ok() }).view, { hasCapability: () => false });
  assert.equal(denied.accept.restriction, "permission");
  assert.match(denied.accept.reason, /do not have permission/i);

  // A DENIED READ is a third thing again, and derives no actions at all.
  const deniedRead = readOnce({ transport: fails("permission-denied") }).view;
  assert.deepEqual(salesAgreementActions(deniedRead, { hasCapability: () => true }), { edit: null, accept: null });
});

test("the stale capability comment in the by-opportunity hook is corrected", () => {
  // Named by the merged work order as belonging to this PR, because the file is open for a real
  // reason. environmentCapabilityOverrides.ts activates all four capabilities for the sandbox.
  const hook = src("hooks/useSalesAgreement.js");
  assert.ok(!/which today is EVERY environment/.test(hook), "the stale claim must be gone");
  assert.match(hook, /environmentCapabilityOverrides/, "and replaced by a pointer to the current authority");
});
