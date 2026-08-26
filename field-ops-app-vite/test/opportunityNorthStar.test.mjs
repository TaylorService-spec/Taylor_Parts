// THE OPPORTUNITY DERIVATION LAYER, ASSERTED OFFLINE.
//
// The composition is asserted in test/opportunityNorthStarPage.test.jsx. This suite asserts the
// PURE layer beneath it: domain/opportunityView.js (the honest read states) and
// domain/opportunityNorthStar.js (every fact the record page states, derived once).
//
// The assertions that carry the most weight are the ones about what must NOT be produced — a
// fabricated stage time, a document id as a label, a raw enum, an attention item on a closed deal,
// a second derivation of a fact the shared lifecycle authority already owns.
import test from "node:test";
import assert from "node:assert/strict";
import { opportunityView, OPPORTUNITY_VIEW_STATE } from "../src/domain/opportunityView.js";
import {
  opportunityHeader,
  opportunitySpine,
  opportunityAttention,
  opportunityStageDetail,
  opportunityTimeline,
  opportunityLineage,
  opportunityStateWords,
  opportunityStateSentence,
  opportunityStateTone,
  opportunityValueDisplay,
  SEVERITY,
  EDGE,
} from "../src/domain/opportunityNorthStar.js";
import { OPPORTUNITY_STAGES, stageProgress } from "../src/domain/opportunityLifecycle.js";

const NOW = 1_756_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function projection(overrides = {}) {
  return {
    id: "opp_doc_secret",
    opportunityNumber: "OPP-2026-000007",
    name: null,
    accountId: "acct_doc_1",
    salesChannel: "RETAIL",
    ownerEmployeeId: "EMP-3",
    stage: "QUOTING",
    outcome: null,
    need: "Two reach-in freezers for the new prep line.",
    expectedValue: 56000,
    expectedCloseAt: NOW + 30 * DAY,
    nextAction: "Send the revised quote.",
    lines: [{ kind: "PART", ref: "PRT-9", qty: 2 }],
    salesOrderId: null,
    salesAgreementId: null,
    createdAtMillis: NOW - 60 * DAY,
    updatedAtMillis: NOW - DAY,
    closedAtMillis: null,
    ...overrides,
  };
}

function ready(overrides = {}, envelope = {}) {
  return opportunityView({
    result: {
      status: "ready",
      opportunity: projection(overrides),
      accountName: "Harbor Grill Restaurant Group",
      salesOrderNumber: null,
      ...envelope,
    },
  });
}

// ═══════════════════════════ the honest read states

test("the five read states are distinct and never collapse into each other", () => {
  assert.equal(opportunityView({ loading: true }).kind, OPPORTUNITY_VIEW_STATE.LOADING);
  assert.equal(opportunityView({ errorStatus: "denied" }).kind, OPPORTUNITY_VIEW_STATE.DENIED);
  assert.equal(opportunityView({ errorStatus: "unavailable" }).kind, OPPORTUNITY_VIEW_STATE.UNAVAILABLE);
  assert.equal(opportunityView({ result: { status: "not-found", opportunity: null } }).kind, OPPORTUNITY_VIEW_STATE.NOT_FOUND);
  assert.equal(ready().kind, OPPORTUNITY_VIEW_STATE.READY);
  // A missing result is UNAVAILABLE, never NOT_FOUND: "the read failed" and "there is no such
  // record" are different answers and a reader acts differently on each.
  assert.equal(opportunityView({}).kind, OPPORTUNITY_VIEW_STATE.UNAVAILABLE);
  // A "ready" envelope with no opportunity is a malformed answer, not an empty one.
  assert.equal(opportunityView({ result: { status: "ready", opportunity: null } }).kind, OPPORTUNITY_VIEW_STATE.UNAVAILABLE);
});

test("the view model carries the id for routing and the reference for identity, and never confuses them", () => {
  const v = ready();
  assert.equal(v.id, "opp_doc_secret");
  assert.equal(v.opportunityNumber, "OPP-2026-000007");
  // An Opportunity that predates numbering is honestly null. It is NOT backfilled from the id.
  const unnumbered = ready({ opportunityNumber: null });
  assert.equal(unnumbered.opportunityNumber, null);
  assert.notEqual(unnumbered.opportunityNumber, unnumbered.id);
});

test("a line with no quantity keeps its absence — it is not softened to zero", () => {
  // Load-bearing: the missing qty is what blocks WON forever (LINE_QTY_REQUIRED_FOR_WON), so a
  // view model that defaulted it to 0 would hide the one fact the page most needs to state.
  const v = ready({ lines: [{ kind: "PART", ref: "PRT-9", qty: null }] });
  assert.equal(v.lines[0].qty, null);
});

// ═══════════════════════════ state in words (R04)

test("state is a word, sourced from the one vocabulary, and never a raw enum", () => {
  assert.equal(opportunityStateWords({ stage: "CUSTOMER_REVIEW" }), "Customer review");
  assert.equal(opportunityStateWords({ stage: "QUOTING", outcome: "WON" }), "Won");
  assert.equal(opportunityStateWords({ stage: "QUOTING", outcome: "LOST" }), "Lost");
  // A stage neither vocabulary recognises is reported as unplaceable rather than echoed back.
  assert.equal(opportunityStateWords({ stage: "NEGOTIATING" }), null);
  assert.equal(opportunityStateWords({}), null);
});

test("the state sentence names the next legal stage, and the engine decides which that is", () => {
  // Not copy: `allowedActions` is the authority, and the sentence must follow it.
  assert.equal(opportunityStateSentence({ stage: "IDENTIFIED" }), "Identified — next stage Qualifying");
  assert.equal(opportunityStateSentence({ stage: "QUOTING" }), "Quoting — next stage Customer review");
  assert.equal(opportunityStateSentence({ stage: "DECISION" }), "Decision — awaiting the customer's decision");
  // Terminal states are not padded into a clause for symmetry.
  assert.equal(opportunityStateSentence({ stage: "DECISION", outcome: "WON" }), "Won");
  assert.equal(opportunityStateSentence({ stage: "QUOTING", outcome: "LOST" }), "Lost");
});

test("tone and word always agree, so state is never carried by colour alone", () => {
  assert.equal(opportunityStateTone({ outcome: "WON" }), "positive");
  assert.equal(opportunityStateTone({ outcome: "LOST" }), "negative");
  assert.equal(opportunityStateTone({ stage: "DECISION" }), "attention");
  assert.equal(opportunityStateTone({ stage: "QUOTING" }), "info");
});

test("the header states channel in words and never leaks the stored enum", () => {
  assert.equal(opportunityHeader(ready({ salesChannel: "NATIONAL_ACCOUNTS" })).channelWords, "National Accounts");
  assert.equal(opportunityHeader(ready({ salesChannel: "STRATEGIC_ACCOUNTS" })).channelWords, "Strategic Accounts");
  // An unrecognised channel returns null rather than passing the raw value through.
  assert.equal(opportunityHeader(ready({ salesChannel: "WHOLESALE" })).channelWords, null);
});

// ═══════════════════════════ the spine (NS-P1)

test("the spine IS stageProgress — the record page and the pipeline row cannot disagree", () => {
  // The falsifiable form of "one derivation". If this file ever grew its own progression logic,
  // this assertion is what fails.
  for (const stage of [...OPPORTUNITY_STAGES, null]) {
    for (const outcome of [null, "WON", "LOST"]) {
      const opp = { stage, outcome };
      assert.deepEqual(opportunitySpine(opp).steps, stageProgress(opp).stages);
      assert.deepEqual(opportunitySpine(opp).terminal, stageProgress(opp).terminal);
    }
  }
});

test("a stage the vocabulary cannot place is REPORTED, not silently drawn as step one", () => {
  assert.equal(opportunitySpine({ stage: "NEGOTIATING" }).unrecognised, true);
  assert.equal(opportunitySpine({ stage: "QUOTING" }).unrecognised, false);
  // A record with no stage at all is not "unrecognised" — there is nothing to fail to recognise.
  assert.equal(opportunitySpine({}).unrecognised, false);
});

test("a closed opportunity carries its outcome as a terminal badge, not as a stage", () => {
  const won = opportunitySpine({ stage: "DECISION", outcome: "WON" });
  assert.equal(won.terminal.label, "Won");
  assert.ok(!won.steps.some((s) => s.label === "Won"), "the outcome must not appear as a spine step");
});

// ═══════════════════════════ ND-12 — the stage times that exist, and the ones that do not

test("only Identified and a CLOSED Decision may state a time; every other stage says so", () => {
  const when = (v) => (v == null ? null : `@${v}`);
  const open = ready();

  const identified = opportunityStageDetail(open, "IDENTIFIED", when);
  assert.match(identified.fact, /Opportunity created @/);

  for (const stage of ["QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW"]) {
    const detail = opportunityStageDetail(open, stage, when);
    assert.match(detail.fact, /No time is recorded for this stage/, `${stage} must not claim a time`);
    // The specific fabrication this guards: `updatedAt` presented as a stage time.
    assert.ok(!detail.fact.includes(`@${open.updatedAtMillis}`), `${stage} borrowed updatedAt`);
  }

  // An OPEN Decision has not ended, so it claims nothing.
  assert.match(opportunityStageDetail(open, "DECISION", when).fact, /decision is outstanding/);

  // A CLOSED Decision states the close time, which the record genuinely holds.
  const closed = ready({ stage: "DECISION", outcome: "WON", closedAtMillis: NOW });
  assert.equal(opportunityStageDetail(closed, "DECISION", when).fact.startsWith(`Won @${NOW}.`), true);
});

test("a closed opportunity with no recorded close time says so rather than borrowing one", () => {
  const when = (v) => (v == null ? null : `@${v}`);
  const closed = ready({ stage: "DECISION", outcome: "LOST", closedAtMillis: null });
  const detail = opportunityStageDetail(closed, "DECISION", when);
  assert.match(detail.fact, /no close time is recorded/);
  assert.ok(!detail.fact.includes(`@${closed.updatedAtMillis}`));
});

test("stage detail states line counts, never a percentage — a percentage implies a schedule", () => {
  const when = () => "then";
  assert.match(opportunityStageDetail(ready(), "SOLUTION", when).fact, /1 solution line recorded/);
  assert.match(opportunityStageDetail(ready({ lines: [] }), "SOLUTION", when).fact, /No solution lines/);
  assert.ok(!/%/.test(opportunityStageDetail(ready(), "QUOTING", when).fact));
});

// ═══════════════════════════ attention (NS pattern 3)

test("a closed opportunity raises nothing at all", () => {
  for (const outcome of ["WON", "LOST"]) {
    // Every condition that WOULD raise something on an open deal, on a closed one.
    const closed = ready({ outcome, stage: "DECISION", lines: [], nextAction: null, expectedCloseAt: NOW - DAY });
    assert.deepEqual(opportunityAttention(closed, NOW), []);
  }
});

test("the blockers are the engine's own WON guards, not rules invented here", () => {
  const noLines = opportunityAttention(ready({ lines: [], nextAction: "x", expectedCloseAt: null }), NOW);
  assert.equal(noLines.length, 1);
  assert.equal(noLines[0].severity, SEVERITY.BLOCKING);
  assert.match(noLines[0].fact, /no solution lines/i);

  const qtyless = opportunityAttention(
    ready({ lines: [{ kind: "PART", ref: "A", qty: null }, { kind: "PART", ref: "B", qty: 0 }], nextAction: "x", expectedCloseAt: null }),
    NOW,
  );
  assert.equal(qtyless[0].severity, SEVERITY.BLOCKING);
  assert.match(qtyless[0].fact, /2 solution lines carry no quantity/);
});

test("informational status never enters the band", () => {
  // "Closing within a week" is true and is not a call to act. The moment the band carries things
  // that are merely true it stops meaning "something needs you".
  const soon = opportunityAttention(ready({ expectedCloseAt: NOW + 2 * DAY, nextAction: "x" }), NOW);
  assert.deepEqual(soon, []);
});

test("DECISION_PENDING is dropped because the header sentence already states it (NS-P4)", () => {
  const opp = ready({ stage: "DECISION", nextAction: "x", expectedCloseAt: null });
  const items = opportunityAttention(opp, NOW);
  assert.ok(!items.some((i) => i.key === "DECISION_PENDING"));
  // ...and the fact is genuinely still stated, once, higher up the page.
  assert.match(opportunityHeader(opp).stateSentence, /awaiting the customer's decision/);
});

test("an overdue close and a missing next action are stated in plain language, not as rule names", () => {
  const items = opportunityAttention(ready({ nextAction: null, expectedCloseAt: NOW - DAY }), NOW);
  const keys = items.map((i) => i.key);
  assert.deepEqual(keys, ["NO_NEXT_ACTION", "CLOSE_OVERDUE"]);
  for (const item of items) {
    assert.equal(item.severity, SEVERITY.ATTENTION);
    assert.ok(/[a-z] [a-z]/.test(item.fact), `not a sentence: ${item.fact}`);
    assert.ok(!/_/.test(item.fact), `a rule name leaked into copy: ${item.fact}`);
  }
});

test("a clean opportunity produces nothing, so the band renders nothing", () => {
  assert.deepEqual(opportunityAttention(ready({ nextAction: "Send the quote.", expectedCloseAt: NOW + 30 * DAY }), NOW), []);
});

// ═══════════════════════════ lineage (R03 / DECISIONS #106)

test("every lineage edge is RESOLVED, UNRESOLVED or ABSENT — and never carries a document id as a label", () => {
  const linked = ready({ salesOrderId: "so_doc_9", salesAgreementId: "agr_doc_5" }, { salesOrderNumber: "SO-2026-000141" });
  const edges = opportunityLineage(linked);
  const by = Object.fromEntries(edges.map((e) => [e.key, e]));

  assert.equal(by.account.state, EDGE.RESOLVED);
  assert.equal(by.account.reference, "Harbor Grill Restaurant Group");
  assert.equal(by.salesOrder.state, EDGE.RESOLVED);
  assert.equal(by.salesOrder.reference, "SO-2026-000141");
  // The agreement is always UNRESOLVED or ABSENT: nothing resolves a Sales Agreement to a
  // reference in this build (ND-9). Naming the entity and stating the absence is the contract.
  assert.equal(by.agreement.state, EDGE.UNRESOLVED);

  for (const edge of edges) {
    assert.ok(!("reference" in edge) || !String(edge.reference).includes("_doc_"), `document id used as a label: ${edge.key}`);
  }
});

test("an unresolvable customer name never degrades to the accountId", () => {
  const edges = opportunityLineage(ready({}, { accountName: null }));
  const account = edges.find((e) => e.key === "account");
  assert.equal(account.state, EDGE.UNRESOLVED);
  assert.equal(account.reference, undefined);
  assert.equal(account.targetId, "acct_doc_1");
});

test("a linked order whose reference does not resolve is UNRESOLVED, never labelled with its id", () => {
  const edges = opportunityLineage(ready({ salesOrderId: "so_doc_9" }, { salesOrderNumber: null }));
  const salesOrder = edges.find((e) => e.key === "salesOrder");
  assert.equal(salesOrder.state, EDGE.UNRESOLVED);
  assert.equal(salesOrder.reference, undefined);
  // A malformed reference is UNRESOLVED too — the shape is checked, not merely the presence.
  const malformed = opportunityLineage(ready({ salesOrderId: "so_doc_9" }, { salesOrderNumber: "so_doc_9" }));
  assert.equal(malformed.find((e) => e.key === "salesOrder").state, EDGE.UNRESOLVED);
});

test("no relationship is ABSENT, which is a different fact from unresolved", () => {
  const edges = opportunityLineage(ready());
  assert.equal(edges.find((e) => e.key === "salesOrder").state, EDGE.ABSENT);
  assert.equal(edges.find((e) => e.key === "agreement").state, EDGE.ABSENT);
});

// ═══════════════════════════ milestones

test("the timeline reports only times the record actually holds", () => {
  const open = opportunityTimeline(ready());
  assert.deepEqual(open.map((e) => e.key), ["created", "updated"]);
  // "Last changed" is labelled for what it is. `updatedAt` moves on any write at all.
  assert.equal(open.find((e) => e.key === "updated").label, "Last changed");

  const won = opportunityTimeline(ready({ outcome: "WON", stage: "DECISION", closedAtMillis: NOW }));
  assert.deepEqual(won.map((e) => e.key), ["created", "closed", "updated"]);
  assert.equal(won.find((e) => e.key === "closed").label, "Won");
});

test("a close time on an OPEN record is never presented as a close", () => {
  // Defence against a stray value: the row is gated on the outcome as well as on the timestamp.
  const open = opportunityTimeline(ready({ outcome: null, closedAtMillis: NOW }));
  assert.ok(!open.some((e) => e.key === "closed"));
});

// ═══════════════════════════ the money that is not money

test("expected value is stated without a currency the data does not carry, and null is not zero", () => {
  const shown = opportunityValueDisplay(ready(), (n) => n.toLocaleString("en-US"));
  assert.equal(shown.text, "Expected value 56,000");
  assert.ok(!/[$€£]/.test(shown.text), "a currency symbol was asserted that nobody stored");
  assert.match(shown.title, /no currency recorded/);

  // An unestimated deal shows NO number. A zero would read as a worthless deal.
  const none = opportunityValueDisplay(ready({ expectedValue: null }), (n) => String(n));
  assert.equal(none.text, null);
  assert.match(none.title, /No expected value/);

  // A genuine zero is still a number the owner typed, and is shown.
  assert.equal(opportunityValueDisplay(ready({ expectedValue: 0 }), (n) => String(n)).text, "Expected value 0");
});
