// THE OPPORTUNITY P1v2 DERIVATION LAYER, ASSERTED OFFLINE.
//
// The composition is asserted in test/opportunityNorthStarPage.test.jsx. This suite asserts the
// PURE layer beneath it: domain/opportunityView.js (the honest read states) and
// domain/opportunityNorthStar.js (the P1v2 presentation of facts the domain already owns).
//
// The assertions that carry the most weight are the ones about what must NOT be produced — a
// currency the data does not justify, a document id as a label, a raw enum, a second derivation of
// something opportunityLifecycle.js already decides, or a converged commercial path.
import test from "node:test";
import assert from "node:assert/strict";
import { opportunityView, OPPORTUNITY_VIEW_STATE } from "../src/domain/opportunityView.js";
import {
  opportunityHeader,
  opportunitySpine,
  opportunityAttentionStrip,
  opportunityDaysOpen,
  opportunityDaysToClose,
  opportunityValueDisplay,
  opportunityConversion,
  opportunityStateWords,
  opportunityStateSentence,
  opportunityStateTone,
  NO_CURRENCY_NOTE,
} from "../src/domain/opportunityNorthStar.js";
import { OPPORTUNITY_STAGES, stageProgress, deriveAttention } from "../src/domain/opportunityLifecycle.js";

const NOW = 1_756_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function projection(overrides = {}) {
  return {
    id: "opp_doc_secret",
    opportunityNumber: "OPP-2026-000041",
    name: null,
    accountId: "acct_doc_1",
    salesChannel: "NATIONAL_ACCOUNTS",
    ownerEmployeeId: "EMP-3",
    stage: "QUOTING",
    outcome: null,
    need: "Second commissary build-out — soft serve and shake capacity.",
    expectedValue: 41000,
    expectedCloseAt: NOW + 30 * DAY,
    nextAction: "Call M. Delgado after their board meeting.",
    lines: [{ kind: "MODEL", ref: "C712", qty: 2 }],
    salesOrderId: null,
    salesAgreementId: null,
    createdAtMillis: NOW - 47 * DAY,
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
      accountName: "Desert Sun Beverage Co.",
      salesOrderNumber: null,
      ...envelope,
    },
  });
}

// ═══════════════════════════ the honest read states (P1v2 1c)

test("the five read states are distinct and never collapse into each other", () => {
  assert.equal(opportunityView({ loading: true }).kind, OPPORTUNITY_VIEW_STATE.LOADING);
  assert.equal(opportunityView({ errorStatus: "denied" }).kind, OPPORTUNITY_VIEW_STATE.DENIED);
  assert.equal(opportunityView({ errorStatus: "unavailable" }).kind, OPPORTUNITY_VIEW_STATE.UNAVAILABLE);
  assert.equal(opportunityView({ result: { status: "not-found", opportunity: null } }).kind, OPPORTUNITY_VIEW_STATE.NOT_FOUND);
  assert.equal(ready().kind, OPPORTUNITY_VIEW_STATE.READY);
  // A missing result is UNAVAILABLE, never NOT_FOUND: "the read failed" and "there is no such
  // record" are different answers and a reader acts differently on each.
  assert.equal(opportunityView({}).kind, OPPORTUNITY_VIEW_STATE.UNAVAILABLE);
  assert.equal(opportunityView({ result: { status: "ready", opportunity: null } }).kind, OPPORTUNITY_VIEW_STATE.UNAVAILABLE);
});

test("the view model carries the id for routing and the reference for identity, and never confuses them", () => {
  const v = ready();
  assert.equal(v.id, "opp_doc_secret");
  assert.equal(v.opportunityNumber, "OPP-2026-000041");
  const unnumbered = ready({ opportunityNumber: null });
  assert.equal(unnumbered.opportunityNumber, null);
  assert.notEqual(unnumbered.opportunityNumber, unnumbered.id);
});

test("a line with no quantity keeps its absence — it is not softened to zero", () => {
  // Load-bearing: a missing qty is what blocks WON (LINE_QTY_REQUIRED_FOR_WON), so a view model
  // that defaulted it to 0 would hide the fact the engine will refuse on.
  const v = ready({ lines: [{ kind: "MODEL", ref: "C712", qty: null }] });
  assert.equal(v.lines[0].qty, null);
});

// ═══════════════════════════ identity (P1v2 §2)

test("the kicker carries the channel in WORDS, and no stored enum reaches it", () => {
  assert.equal(opportunityHeader(ready()).kicker, "Opportunity · National Accounts");
  assert.equal(opportunityHeader(ready({ salesChannel: "RETAIL" })).kicker, "Opportunity · Retail");
  // An unrecognised channel degrades to the bare object type rather than leaking the raw value.
  assert.equal(opportunityHeader(ready({ salesChannel: "WHOLESALE" })).kicker, "Opportunity");
});

test("the title is the governed reference; a pre-numbering record says so and never shows its id", () => {
  assert.equal(opportunityHeader(ready()).title, "OPP-2026-000041");
  const unnumbered = opportunityHeader(ready({ opportunityNumber: null }));
  assert.equal(unnumbered.title, "Opportunity — not numbered");
  assert.ok(!unnumbered.title.includes("opp_doc"));
});

test("the subtitle is `need`, and is omitted rather than fabricated when absent", () => {
  assert.match(opportunityHeader(ready()).subtitle, /Second commissary/);
  assert.equal(opportunityHeader(ready({ need: null })).subtitle, null);
  assert.equal(opportunityHeader(ready({ need: "   " })).subtitle, null);
});

// ═══════════════════════════ state in words (R04)

test("state is a word from the one vocabulary, never a raw enum", () => {
  assert.equal(opportunityStateWords({ stage: "CUSTOMER_REVIEW" }), "Customer review");
  assert.equal(opportunityStateWords({ stage: "QUOTING", outcome: "WON" }), "Won");
  assert.equal(opportunityStateWords({ stage: "QUOTING", outcome: "LOST" }), "Lost");
  assert.equal(opportunityStateWords({ stage: "NEGOTIATING" }), null);
});

test("the state sentence names the next legal stage, and the ENGINE decides which that is", () => {
  assert.equal(opportunityStateSentence({ stage: "IDENTIFIED" }), "Identified — next stage Qualifying");
  assert.equal(opportunityStateSentence({ stage: "QUOTING" }), "Quoting — next stage Customer review");
  // The artifact's own wording at Decision.
  assert.equal(opportunityStateSentence({ stage: "DECISION" }), "Decision — awaiting customer decision");
  assert.equal(opportunityStateSentence({ stage: "DECISION", outcome: "WON" }), "Won");
});

test("tone and word always agree, so state is never carried by colour alone", () => {
  assert.equal(opportunityStateTone({ outcome: "WON" }), "positive");
  assert.equal(opportunityStateTone({ outcome: "LOST" }), "negative");
  assert.equal(opportunityStateTone({ stage: "DECISION" }), "attention");
  assert.equal(opportunityStateTone({ stage: "QUOTING" }), "info");
});

// ═══════════════════════════ the chevrons (P1v2 §3)

test("the spine IS stageProgress — the record page and the pipeline row cannot disagree", () => {
  // The falsifiable form of "one derivation". If this file ever grew its own progression logic,
  // this is what fails.
  for (const stage of [...OPPORTUNITY_STAGES, null]) {
    for (const outcome of [null, "WON", "LOST"]) {
      const opp = { stage, outcome };
      assert.deepEqual(opportunitySpine(opp).steps, stageProgress(opp).stages);
      assert.deepEqual(opportunitySpine(opp).terminal, stageProgress(opp).terminal);
    }
  }
});

test("the phone's words and the desktop's chevrons describe the same position", () => {
  assert.equal(opportunitySpine({ stage: "DECISION" }).positionWords, "stage 6 of 6");
  assert.equal(opportunitySpine({ stage: "IDENTIFIED" }).positionWords, "stage 1 of 6");
  assert.equal(opportunitySpine({ stage: "DECISION" }).isLastStage, true);
  assert.equal(opportunitySpine({ stage: "QUOTING" }).isLastStage, false);
  assert.equal(opportunitySpine({ stage: "NEGOTIATING" }).positionWords, null);
});

test("a stage the vocabulary cannot place is REPORTED, not silently drawn as step one", () => {
  assert.equal(opportunitySpine({ stage: "NEGOTIATING" }).unrecognised, true);
  assert.equal(opportunitySpine({ stage: "QUOTING" }).unrecognised, false);
  assert.equal(opportunitySpine({}).unrecognised, false);
});

test("a closed opportunity carries its outcome as a terminal badge, not as a stage", () => {
  const won = opportunitySpine({ stage: "DECISION", outcome: "WON" });
  assert.equal(won.terminal.label, "Won");
  assert.ok(!won.steps.some((s) => s.label === "Won"), "the outcome must not appear as a spine step");
});

// ═══════════════════════════ the attention strip (P1v2 §5)

test("the strip carries deriveAttention's reasons VERBATIM — it adds none and drops none", () => {
  // The contract that keeps this presentation rather than a second derivation. An earlier build
  // suppressed DECISION_PENDING here; P1v2 keeps every reason the domain raises.
  for (const opp of [
    projection({ stage: "DECISION", nextAction: null, expectedCloseAt: NOW - DAY }),
    projection({ stage: "QUOTING", nextAction: "x", expectedCloseAt: NOW + 2 * DAY }),
    projection({ stage: "IDENTIFIED", nextAction: "x", expectedCloseAt: null }),
    projection({ stage: "DECISION", nextAction: "x", expectedCloseAt: NOW + 90 * DAY }),
  ]) {
    const domainKinds = deriveAttention(opp, NOW).map((r) => r.kind).sort();
    const stripKinds = opportunityAttentionStrip(opp, NOW).reasons.map((r) => r.kind).sort();
    assert.deepEqual(stripKinds, domainKinds, `strip diverged from deriveAttention for stage ${opp.stage}`);
  }
});

test("a closed opportunity raises nothing — the domain already refuses, and the strip follows", () => {
  for (const outcome of ["WON", "LOST"]) {
    const closed = projection({ outcome, stage: "DECISION", nextAction: null, expectedCloseAt: NOW - DAY });
    assert.deepEqual(opportunityAttentionStrip(closed, NOW).reasons, []);
    assert.equal(opportunityAttentionStrip(closed, NOW).present, false);
  }
});

test("reasons are worded as the artifact words them, with real day counts and no rule names", () => {
  const overdue = opportunityAttentionStrip(projection({ stage: "DECISION", nextAction: null, expectedCloseAt: NOW - 3 * DAY }), NOW);
  const byKind = Object.fromEntries(overdue.reasons.map((r) => [r.kind, r.text]));
  assert.equal(byKind.DECISION_PENDING, "Awaiting customer decision");
  assert.equal(byKind.NO_NEXT_ACTION, "No next action on file");
  assert.equal(byKind.CLOSE_OVERDUE, "expected close was 3 days ago");

  // 5 days, not the artifact's illustrative 9: deriveAttention raises CLOSE_SOON only within SEVEN
  // days, and that threshold is domain authority. The artifact's sample number is illustrative, so
  // the engine's rule stands and the wording follows it.
  const soon = opportunityAttentionStrip(projection({ stage: "QUOTING", nextAction: "x", expectedCloseAt: NOW + 5 * DAY }), NOW);
  assert.equal(soon.reasons.find((r) => r.kind === "CLOSE_SOON").text, "expected close is in 5 days");

  for (const r of [...overdue.reasons, ...soon.reasons]) {
    assert.ok(!/_/.test(r.text), `a rule name leaked into copy: ${r.text}`);
  }
});

test("the strip leads with what is owed and trails with timing, as the artifact reads", () => {
  const strip = opportunityAttentionStrip(projection({ stage: "DECISION", nextAction: "x", expectedCloseAt: NOW + 5 * DAY }), NOW);
  assert.deepEqual(strip.reasons.map((r) => r.kind), ["DECISION_PENDING", "CLOSE_SOON"]);
});

test("the stored next action rides the strip, and its absence is itself a reason", () => {
  assert.equal(opportunityAttentionStrip(projection(), NOW).nextAction, "Call M. Delgado after their board meeting.");
  const none = opportunityAttentionStrip(projection({ nextAction: "  " }), NOW);
  assert.equal(none.nextAction, null);
  assert.ok(none.reasons.some((r) => r.kind === "NO_NEXT_ACTION"));
});

// ═══════════════════════════ derived time

test("days open comes from the stored creation time, and is absent when that is", () => {
  assert.equal(opportunityDaysOpen(projection(), NOW), 47);
  assert.equal(opportunityDaysOpen(projection({ createdAtMillis: null }), NOW), null);
  // Never negative: a clock skew must not report a deal opened in the future.
  assert.equal(opportunityDaysOpen(projection({ createdAtMillis: NOW + DAY }), NOW), 0);
});

test("days to close is signed, so overdue and upcoming are one derivation", () => {
  assert.equal(opportunityDaysToClose(projection({ expectedCloseAt: NOW + 9 * DAY }), NOW), 9);
  assert.equal(opportunityDaysToClose(projection({ expectedCloseAt: NOW - 3 * DAY }), NOW), -3);
  assert.equal(opportunityDaysToClose(projection({ expectedCloseAt: null }), NOW), null);
});

// ═══════════════════════════ O1 — the value that is not money

test("expected value renders bare with the no-currency annotation, and null is not zero", () => {
  const shown = opportunityValueDisplay(ready(), (n) => n.toLocaleString("en-US"));
  assert.equal(shown.amount, "41,000");
  assert.equal(shown.note, NO_CURRENCY_NOTE);
  assert.ok(!/[$€£]/.test(shown.amount), "a currency symbol was asserted that nobody stored");

  const none = opportunityValueDisplay(ready({ expectedValue: null }), (n) => String(n));
  assert.equal(none.amount, null);
  assert.equal(none.note, null);

  // A genuine zero is still a number the owner typed, and is shown.
  assert.equal(opportunityValueDisplay(ready({ expectedValue: 0 }), (n) => String(n)).amount, "0");
});

// ═══════════════════════════ O6 — the two commercial paths, never converged

test("the conversion states whichever chain TRULY exists, and never implies the other", () => {
  // Direct path: Won created the order from the opportunity's own lines.
  const direct = opportunityConversion(ready({ salesOrderId: "so_1", outcome: "WON" }, { salesOrderNumber: "SO-2026-000014" }), null);
  assert.equal(direct.hasOrder, true);
  assert.equal(direct.salesOrderNumber, "SO-2026-000014");
  assert.equal(direct.hasAgreement, false);

  // Agreement path: the accepted agreement produced the priced order.
  const viaAgreement = opportunityConversion(ready(), {
    kind: "READY", state: "ACCEPTED", salesOrderId: "so_2",
  });
  assert.equal(viaAgreement.hasOrder, false);
  assert.equal(viaAgreement.hasAgreement, true);
  assert.equal(viaAgreement.agreementAccepted, true);
  assert.equal(viaAgreement.agreementOrderId, "so_2");

  // Neither. An agreement is never a prerequisite, so "no order yet" is an ordinary state.
  const neither = opportunityConversion(ready(), { kind: "NONE" });
  assert.equal(neither.hasOrder, false);
  assert.equal(neither.hasAgreement, false);
  assert.equal(neither.agreementOrderId, null);
});

test("a draft agreement is not treated as an accepted one", () => {
  const draft = opportunityConversion(ready(), { kind: "READY", state: "DRAFT", salesOrderId: null });
  assert.equal(draft.hasAgreement, true);
  assert.equal(draft.agreementAccepted, false);
  assert.equal(draft.agreementOrderId, null);
});
