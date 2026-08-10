import { test } from "node:test";
import assert from "node:assert/strict";
import { createAiExchange, validateAiExchange, projectAiGovernance, EXCHANGE_VERDICTS } from "./aiExchange.mjs";

const ex = (over = {}) => createAiExchange({
  exchangeId: "X-1", question: "does the review hold up?", verdict: "CONCUR",
  conclusion: "accepted", disposition: "RESOLVED", ownerRelayed: true, ...over,
});

test("an exchange record validates its compact fields", () => {
  assert.deepEqual(validateAiExchange(ex()), []);
  assert.ok(validateAiExchange(createAiExchange({ disposition: "RESOLVED" })).some((e) => /exchangeId/.test(e)));
  assert.ok(validateAiExchange(ex({ verdict: "MADE_UP" })).some((e) => /verdict/.test(e)));
});

test("positions must be COMPACT — a pasted transcript is rejected (context is referenced, not stored)", () => {
  const huge = "x".repeat(1300);
  assert.ok(validateAiExchange(ex({ claudePosition: huge })).some((e) => /COMPACT/.test(e)));
});

test("AI governance is an HONEST gap with no exchanges", () => {
  const g = projectAiGovernance([], { ownerRelayCount: 0 });
  assert.equal(g.available, false);
  assert.equal(g.ownerRelayCount, 0);
});

test("AI governance projects verdict counts, awaiting, Owner-relay, and the expansions=0 invariant", () => {
  const g = projectAiGovernance([
    ex({ exchangeId: "a", verdict: "CONCUR", disposition: "RESOLVED", ownerRelayed: true }),
    ex({ exchangeId: "b", verdict: "CONCUR_WITH_CORRECTION", disposition: "RESOLVED", ownerRelayed: true }),
    ex({ exchangeId: "c", verdict: null, disposition: "OPEN", ownerRelayed: true }),
  ], { ownerRelayCount: 0 });
  assert.equal(g.available, true);
  assert.equal(g.total, 3);
  assert.equal(g.byVerdict.CONCUR, 1);
  assert.equal(g.byVerdict.CONCUR_WITH_CORRECTION, 1);
  assert.equal(g.awaiting, 1);              // the OPEN/unverdicted one
  assert.equal(g.ownerRelayedCount, 3);     // all relayed today — a context defect to drive to 0
  assert.equal(g.authorityExpansions, 0);   // invariant
  assert.equal(g.exchanges.length, 3);
  assert.ok(EXCHANGE_VERDICTS.includes("EVIDENCE_REQUIRED"));
  // records are compact projections, not transcripts
  assert.ok(!("claudePosition" in g.exchanges[0]));
});
