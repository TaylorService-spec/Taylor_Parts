// THE SALES ORDER NORTH STAR CONTRACT, AS ASSERTIONS.
//
// Same standard the Work Order family set: the Design Grammar's rules are only worth having if they
// can fail. These assert the derivations the Sales Order page renders — one fact, one rendering
// (NS-P4) — offline, without a browser and without Firestore.
//
// The load-bearing ones are the REFUSALS: that no stage borrows `updatedAt` for a time it does not
// have (ND-8), that a document id is never returned as a label (R03), and that a partly-priced
// order never produces a total.
//
// Run: node --test test/salesOrderNorthStar.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  SO_SPINE_STEPS,
  salesOrderSpine,
  salesOrderStateWords,
  salesOrderStateSentence,
  salesOrderStateTone,
  salesOrderStageDetail,
  salesOrderTimeline,
  salesOrderAttention,
  salesOrderLineage,
  salesOrderHeader,
  summariseLines,
  SEVERITY,
  EDGE,
} from "../src/domain/salesOrderNorthStar.js";
import { SALES_ORDER_STATE_VALUES } from "../src/domain/salesOrderStatus.js";

const CREATED_AT = 1_724_000_000_000;
const UPDATED_AT = 1_724_500_000_000;

function order(overrides = {}) {
  return {
    id: "so_doc_abc123",
    salesOrderNumber: "SO-2026-000141",
    accountId: "acct_doc_xyz",
    state: "CONFIRMED",
    salesChannel: "RETAIL",
    customerPO: null,
    createdAtMillis: CREATED_AT,
    updatedAtMillis: UPDATED_AT,
    pricingState: "PRICED",
    unpricedLineCount: 0,
    totalMinor: 500000,
    currency: "USD",
    sourceOpportunityId: null,
    sourceOpportunityNumber: null,
    sourceAgreementId: null,
    serviceWorkOrders: [],
    lines: [],
    ...overrides,
  };
}

function line(overrides = {}) {
  const base = { key: "l1", kind: "PART", ref: "SKU-1", orderedQty: 2, allocatedQty: 0, fulfilledQty: 0, billedQty: 0, remainingQty: 2, fullyFulfilled: false };
  const merged = { ...base, ...overrides };
  merged.remainingQty = Math.max(0, merged.orderedQty - merged.fulfilledQty);
  merged.fullyFulfilled = merged.remainingQty === 0;
  return merged;
}

// ───────────────────────────────── the spine

test("every governed state except CANCELLED occupies exactly one spine step", () => {
  for (const state of SALES_ORDER_STATE_VALUES) {
    const spine = salesOrderSpine(state);
    const current = spine.steps.filter((s) => s.status === "current");
    if (state === "CANCELLED") {
      assert.equal(current.length, 0, "CANCELLED must not occupy a step");
      assert.equal(spine.terminal?.key, "cancelled");
      assert.equal(spine.unrecognised, false);
    } else {
      assert.equal(current.length, 1, `${state} must occupy exactly one step`);
      assert.equal(spine.terminal, null);
      assert.equal(spine.unrecognised, false);
    }
  }
});

test("a cancelled order draws no step as reached beyond where it stopped", () => {
  const spine = salesOrderSpine("CANCELLED");
  assert.ok(spine.steps.every((s) => s.status === "future"), "cancelled must not claim completed stages");
});

test("an unrecognised state resolves no step and says so", () => {
  const spine = salesOrderSpine("ON_HOLD_PENDING_CREDIT");
  assert.equal(spine.unrecognised, true);
  assert.equal(spine.steps.filter((s) => s.status !== "future").length, 0);
});

test("CANCELLED is not one of the spine steps", () => {
  assert.ok(!SO_SPINE_STEPS.some((s) => /cancel/i.test(s.key) || /cancel/i.test(s.label)));
});

// ───────────────────────────────── status as words, never an enum (R04)

test("no state renders as its raw machine value", () => {
  for (const state of SALES_ORDER_STATE_VALUES) {
    const words = salesOrderStateWords(state);
    assert.ok(words, `${state} must have words`);
    assert.notEqual(words, state, `${state} must not render as the enum`);
    assert.ok(!/_/.test(words), `${words} still carries an underscore`);
    const sentence = salesOrderStateSentence(state);
    assert.ok(!/[A-Z]{2,}_/.test(sentence), `${sentence} leaks an enum`);
  }
});

test("an unknown state produces no words and no sentence rather than a prettified guess", () => {
  assert.equal(salesOrderStateWords("ON_HOLD"), null);
  assert.equal(salesOrderStateSentence("ON_HOLD"), null);
});

test("the sentence extends the same vocabulary the spine uses — it never invents a second one", () => {
  for (const state of SALES_ORDER_STATE_VALUES) {
    assert.ok(
      salesOrderStateSentence(state).startsWith(salesOrderStateWords(state)),
      `${state}: the sentence must begin with the governed word`,
    );
  }
});

test("terminal states are not padded into a sentence for symmetry", () => {
  assert.equal(salesOrderStateSentence("CLOSED"), "Closed");
  assert.equal(salesOrderStateSentence("CANCELLED"), "Cancelled");
});

test("the IN_FULFILLMENT clause states the engine's actual advance guard", () => {
  // salesOrderActions.canAdvance refuses IN_FULFILLMENT unless allLinesFulfilled. The clause must
  // say that, not something merely plausible.
  assert.match(salesOrderStateSentence("IN_FULFILLMENT"), /every line must be fulfilled/i);
});

test("tone and word always agree, and tone is never the only carrier of meaning", () => {
  assert.equal(salesOrderStateTone("CANCELLED"), "negative");
  assert.equal(salesOrderStateTone("FULFILLED"), "positive");
  assert.equal(salesOrderStateTone("CLOSED"), "positive");
  assert.equal(salesOrderStateTone("IN_FULFILLMENT"), "info");
  assert.equal(salesOrderStateTone("CONFIRMED"), "neutral");
  for (const state of SALES_ORDER_STATE_VALUES) {
    assert.ok(salesOrderStateWords(state), `${state} must carry words alongside its tone`);
  }
});

// ───────────────────────────────── ND-8: no stage borrows a time it does not have

test("only the Confirmed stage states a time, and it is createdAt", () => {
  // LINES ARE LOAD-BEARING IN THIS FIXTURE. Every stage renders a different sentence when the order
  // is empty, so an order with no lines exercises only the empty branch -- and a fabricated stage
  // time in the populated branch survives untouched. That is exactly what the first mutation run of
  // this suite proved: the assertion below passed against a Fulfilled stage that had been rewritten
  // to print `updatedAt`. The fixture carries lines so both branches are reachable, and the loop
  // below runs against both.
  const fmt = (v) => (v === CREATED_AT ? "on 18 Aug 2026" : v === UPDATED_AT ? "on 24 Aug 2026" : null);
  const populated = [line({ key: "a", allocatedQty: 2, fulfilledQty: 2 }), line({ key: "b" })];
  for (const so of [order(), order({ lines: populated }), order({ state: "CLOSED", lines: populated })]) {
    const confirmed = salesOrderStageDetail(so, "confirmed", fmt);
    assert.match(confirmed.fact, /on 18 Aug 2026/);

    for (const key of ["inFulfillment", "fulfilled", "closed"]) {
      const detail = salesOrderStageDetail(so, key, fmt);
      assert.match(detail.fact, /No time is recorded for this stage/i, `${key} must state the absence`);
      assert.ok(!detail.fact.includes("24 Aug 2026"), `${key} must never borrow updatedAt`);
      assert.ok(!detail.fact.includes("18 Aug 2026"), `${key} must never borrow createdAt`);
    }
  }
});

test("a missing creation time is stated, not fabricated", () => {
  const detail = salesOrderStageDetail(order({ createdAtMillis: null }), "confirmed", () => null);
  assert.match(detail.fact, /No creation time is recorded/i);
});

test("stage tone follows the spine, so the strip and the chevrons cannot disagree", () => {
  const so = order({ state: "IN_FULFILLMENT" });
  assert.equal(salesOrderStageDetail(so, "confirmed", () => "x").tone, "complete");
  assert.equal(salesOrderStageDetail(so, "inFulfillment", () => "x").tone, "current");
  assert.equal(salesOrderStageDetail(so, "closed", () => "x").tone, "future");
});

test("stage detail counts lines rather than reporting a percentage complete", () => {
  const so = order({
    state: "IN_FULFILLMENT",
    lines: [line({ key: "a", allocatedQty: 2 }), line({ key: "b", allocatedQty: 0 }), line({ key: "c", orderedQty: 1, allocatedQty: 1, fulfilledQty: 1 })],
  });
  const detail = salesOrderStageDetail(so, "inFulfillment", () => "x");
  assert.match(detail.fact, /2 of 3 lines allocated, 1 fully fulfilled/);
  assert.ok(!/%/.test(detail.fact), "a percentage implies a schedule this record does not have");
});

test("an unknown stage key returns nothing rather than an empty strip", () => {
  assert.equal(salesOrderStageDetail(order(), "invoiced", () => "x"), null);
});

// ───────────────────────────────── the milestone list

test("the timeline carries only the two times the order records", () => {
  const events = salesOrderTimeline(order());
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.key), ["created", "updated"]);
});

test("updatedAt is labelled as a change, never as a lifecycle event", () => {
  const updated = salesOrderTimeline(order()).find((e) => e.key === "updated");
  assert.equal(updated.label, "Last changed");
  assert.ok(!/fulfil|close|confirm|cancel/i.test(updated.label));
});

test("a time the order does not have produces no row at all", () => {
  assert.equal(salesOrderTimeline(order({ updatedAtMillis: null })).length, 1);
  assert.equal(salesOrderTimeline(order({ createdAtMillis: null, updatedAtMillis: null })).length, 0);
});

// ───────────────────────────────── attention (renders nothing when clean)

test("a clean confirmed order raises nothing", () => {
  const so = order({ lines: [line()] });
  assert.deepEqual(salesOrderAttention(so), []);
});

test("a terminal order raises nothing, however it looks", () => {
  for (const state of ["CLOSED", "CANCELLED"]) {
    const so = order({ state, lines: [], pricingState: "UNPRICED" });
    assert.deepEqual(salesOrderAttention(so), [], `${state} must raise nothing`);
  }
});

test("an order with no lines is blocking", () => {
  const items = salesOrderAttention(order({ lines: [], pricingState: "NO_LINES" }));
  const found = items.find((i) => i.key === "no-lines");
  assert.equal(found.severity, SEVERITY.BLOCKING);
});

test("an entirely unpriced order is blocking and a partly-priced one is attention", () => {
  const unpriced = salesOrderAttention(order({ pricingState: "UNPRICED", lines: [line()] }));
  assert.equal(unpriced.find((i) => i.key === "unpriced").severity, SEVERITY.BLOCKING);

  const partly = salesOrderAttention(order({ pricingState: "PARTIALLY_PRICED", unpricedLineCount: 2, lines: [line(), line({ key: "b" })] }));
  const item = partly.find((i) => i.key === "partly-priced");
  assert.equal(item.severity, SEVERITY.ATTENTION);
  assert.match(item.fact, /2 lines carry no price/);
});

test("attention states plain-language facts, never rule names", () => {
  const so = order({ state: "IN_FULFILLMENT", pricingState: "UNPRICED", lines: [line()] });
  for (const item of salesOrderAttention(so)) {
    assert.ok(!/[A-Z]{3,}_[A-Z]{3,}/.test(item.fact), `${item.fact} reads as a rule name`);
    assert.match(item.fact, /[.!]$/, "each fact is a sentence");
  }
});

test("an order in fulfillment with nothing allocated says so", () => {
  const so = order({ state: "IN_FULFILLMENT", lines: [line(), line({ key: "b" })] });
  assert.ok(salesOrderAttention(so).some((i) => i.key === "nothing-allocated"));
  const partly = order({ state: "IN_FULFILLMENT", lines: [line({ allocatedQty: 1 }), line({ key: "b" })] });
  assert.ok(!salesOrderAttention(partly).some((i) => i.key === "nothing-allocated"));
});

test("attention never leaks a document id", () => {
  const so = order({ state: "IN_FULFILLMENT", pricingState: "UNPRICED", lines: [] });
  for (const item of salesOrderAttention(so)) {
    assert.ok(!item.fact.includes("so_doc_abc123"));
    assert.ok(!item.fact.includes("acct_doc_xyz"));
  }
});

// ───────────────────────────────── lineage: a document id is never a label (R03)

test("no lineage edge ever carries a document id as its reference", () => {
  const so = order({
    sourceOpportunityId: "opp_doc_1",
    sourceOpportunityNumber: null,
    sourceAgreementId: "agr_doc_1",
    serviceWorkOrders: [{ workOrderId: "wo_doc_1", workOrderNumber: null }],
  });
  for (const edge of salesOrderLineage(so)) {
    assert.ok(!("reference" in edge) || !/_doc_/.test(edge.reference), `${edge.key} leaked an id as a reference`);
    assert.ok(edge.label && !/_doc_/.test(edge.label), `${edge.key} leaked an id as a label`);
  }
});

test("a real relationship with no resolvable reference is UNRESOLVED, not ABSENT", () => {
  const edges = salesOrderLineage(order({ sourceOpportunityId: "opp_doc_1", sourceOpportunityNumber: null }));
  assert.equal(edges.find((e) => e.key === "opportunity").state, EDGE.UNRESOLVED);
});

test("a resolvable Opportunity reference is carried, and a malformed one is not", () => {
  const good = salesOrderLineage(order({ sourceOpportunityId: "opp_doc_1", sourceOpportunityNumber: "OPP-2026-000007" }));
  const edge = good.find((e) => e.key === "opportunity");
  assert.equal(edge.state, EDGE.RESOLVED);
  assert.equal(edge.reference, "OPP-2026-000007");

  const bad = salesOrderLineage(order({ sourceOpportunityId: "opp_doc_1", sourceOpportunityNumber: "opp_doc_1" }));
  assert.equal(bad.find((e) => e.key === "opportunity").state, EDGE.UNRESOLVED);
});

test("no relationship at all is ABSENT", () => {
  const edges = salesOrderLineage(order());
  assert.equal(edges.find((e) => e.key === "opportunity").state, EDGE.ABSENT);
  assert.equal(edges.find((e) => e.key === "agreement").state, EDGE.ABSENT);
  assert.equal(edges.find((e) => e.key === "workOrders").state, EDGE.ABSENT);
});

test("an agreement is never RESOLVED, because nothing resolves one yet", () => {
  const edges = salesOrderLineage(order({ sourceAgreementId: "agr_doc_1" }));
  assert.equal(edges.find((e) => e.key === "agreement").state, EDGE.UNRESOLVED);
});

test("every linked Work Order gets a row, resolved or not", () => {
  const edges = salesOrderLineage(order({
    serviceWorkOrders: [
      { workOrderId: "wo_1", workOrderNumber: "WO-2026-000012" },
      { workOrderId: "wo_2", workOrderNumber: null },
    ],
  }));
  const wos = edges.filter((e) => e.key.startsWith("workOrder:"));
  assert.equal(wos.length, 2);
  assert.equal(wos[0].state, EDGE.RESOLVED);
  assert.equal(wos[0].reference, "WO-2026-000012");
  assert.equal(wos[1].state, EDGE.UNRESOLVED);
});

// ───────────────────────────────── the header

test("the header reference is the governed number, never the document id", () => {
  assert.equal(salesOrderHeader(order()).reference, "SO-2026-000141");
  assert.equal(salesOrderHeader(order({ salesOrderNumber: null })).reference, null);
  assert.equal(salesOrderHeader(order({ salesOrderNumber: "   " })).reference, null);
});

test("the header derives its state once, and the spine agrees with it", () => {
  for (const state of SALES_ORDER_STATE_VALUES) {
    const header = salesOrderHeader(order({ state }));
    assert.equal(header.rawState, state);
    assert.equal(header.stateWords, salesOrderStateWords(state));
    assert.equal(header.stateTone, salesOrderStateTone(state));
    assert.equal(header.isCancelled, state === "CANCELLED");
    assert.equal(header.isTerminal, state === "CLOSED" || state === "CANCELLED");
  }
});

test("no order at all yields no header rather than an empty one", () => {
  assert.equal(salesOrderHeader(null), null);
});

// ───────────────────────────────── the quantity model

test("a partly allocated line is not an allocated line", () => {
  const q = summariseLines([line({ orderedQty: 3, allocatedQty: 2 })]);
  assert.equal(q.allocatedLines, 0);
  assert.equal(q.anyAllocated, true);
});

test("a line with nothing ordered is never counted as satisfied", () => {
  const q = summariseLines([line({ orderedQty: 0, allocatedQty: 0, billedQty: 0 })]);
  assert.equal(q.allocatedLines, 0);
  assert.equal(q.billedLines, 0);
});

test("hostile input does not throw", () => {
  assert.deepEqual(salesOrderAttention(null), []);
  assert.equal(salesOrderHeader(undefined), null);
  assert.equal(summariseLines(undefined).lineCount, 0);
  assert.equal(summariseLines([null, undefined, {}]).lineCount, 3);
  assert.deepEqual(salesOrderTimeline(undefined), []);
  assert.equal(salesOrderSpine(undefined).unrecognised, true);
});
