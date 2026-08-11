import { test } from "node:test";
import assert from "node:assert/strict";
import { makePhase, summarizeTiming, makeEfficiencyLedger, PHASE_KINDS, EFFICIENCY_COUNTERS } from "./reviewInstrumentation.mjs";
import { buildFactFeed, makeFact } from "./reviewFacts.mjs";

test("timing: rolls phases up by kind; separates OWNER_WAIT; surfaces unaccounted time", () => {
  const phases = [
    makePhase({ name: "discovery", kind: "ACTIVE", startedAt: 0, completedAt: 100 }),
    makePhase({ name: "gpt-call", kind: "WAIT", startedAt: 100, completedAt: 400 }),
    makePhase({ name: "owner-decision", kind: "OWNER_WAIT", startedAt: 400, completedAt: 900 }),
    makePhase({ name: "consume", kind: "ACTIVE", startedAt: 950, completedAt: 1000 }), // 50ms gap before this
  ];
  const s = summarizeTiming({ startedAt: 0, completedAt: 1000, phases });
  assert.equal(s.totalElapsedMs, 1000);
  assert.equal(s.ACTIVE_PROCESSING_TIME, 150);
  assert.equal(s.WAIT_TIME, 300);
  assert.equal(s.OWNER_WAIT_TIME, 500);
  assert.equal(s.accountedMs, 950);
  assert.equal(s.unaccountedMs, 50, "the 50ms gap is surfaced, not hidden");
});

test("makePhase validates kind and numeric timestamps", () => {
  assert.throws(() => makePhase({ name: "x", kind: "NOPE", startedAt: 0, completedAt: 1 }), /kind/);
  assert.throws(() => makePhase({ name: "x", kind: "ACTIVE", startedAt: "0", completedAt: 1 }), /numeric/);
  assert.deepEqual([...PHASE_KINDS], ["ACTIVE", "WAIT", "OWNER_WAIT"]);
});

test("efficiency: per-call token breakdown accumulates by the seven categories", () => {
  const { breakdown } = buildFactFeed({
    questionId: "Q1", ask: "safe?",
    facts: [makeFact({ kind: "DETERMINISTIC_FACT", statement: "suite green and fully deterministic here", materialDecision: "safety" })],
  });
  const ledger = makeEfficiencyLedger();
  ledger.recordCall({ breakdown, inputTokens: 7620, outputTokens: 1351 });
  const snap = ledger.snapshot();
  assert.equal(snap.providerCalls, 1);
  assert.equal(snap.measuredInputTokens, 7620);
  assert.equal(snap.measuredOutputTokens, 1351);
  // every category present in per-call and totals
  for (const c of ["protocol", "question", "facts", "authority", "deterministicEvidence", "rawSource", "provenance"]) {
    assert.ok(c in snap.perCategoryTotals, `total has ${c}`);
  }
  assert.ok(snap.estimatedTotalTokens > 0);
});

test("efficiency: counters bump + merge a plain counters object (shared with reviewRecovery)", () => {
  const ledger = makeEfficiencyLedger();
  ledger.bump("artifactsCreated", 3);
  ledger.bump("artifactsReused");
  ledger.merge({ duplicateProviderCallsAvoided: 2, wakeOnlyRecoveries: 1, ignoredKey: 99 });
  const snap = ledger.snapshot();
  assert.equal(snap.artifactsCreated, 3);
  assert.equal(snap.artifactsReused, 1);
  assert.equal(snap.duplicateProviderCallsAvoided, 2);
  assert.equal(snap.wakeOnlyRecoveries, 1);
  assert.equal(snap.hashesReused, 0);
  assert.throws(() => ledger.bump("nope"), /unknown counter/);
  assert.deepEqual([...EFFICIENCY_COUNTERS].sort(), ["artifactsCreated", "artifactsReused", "duplicateProviderCallsAvoided", "hashesReused", "wakeOnlyRecoveries"]);
});

test("efficiency: initial counters seed the ledger", () => {
  const ledger = makeEfficiencyLedger({ artifactsCreated: 5 });
  assert.equal(ledger.snapshot().artifactsCreated, 5);
});

test("efficiency: the structured-output schema is attributed as its own category", () => {
  const ledger = makeEfficiencyLedger();
  ledger.recordCall({ breakdown: { question: 50, facts: 100, structuredOutputSchema: 135, totalEstimate: 285 }, inputTokens: 300 });
  const snap = ledger.snapshot();
  assert.equal(snap.perCategoryTotals.structuredOutputSchema, 135);
  assert.equal(snap.calls[0].structuredOutputSchema, 135);
  assert.equal(snap.estimatedTotalTokens, 285);
  // an omitted schema is an honest zero
  const l2 = makeEfficiencyLedger();
  l2.recordCall({ breakdown: { question: 10, totalEstimate: 10 } });
  assert.equal(l2.snapshot().perCategoryTotals.structuredOutputSchema, 0);
});
