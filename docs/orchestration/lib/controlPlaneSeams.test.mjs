import { test } from "node:test";
import assert from "node:assert/strict";
import { freshnessState, FRESHNESS_STATES } from "./controlCenterContract.mjs";
import { projectTokenCapacity, CAPACITY_STATES } from "./tokenCapacity.mjs";
import { createImprovement, validateImprovement, advanceImprovement, isAdmissible } from "./improvementRegister.mjs";

// ---- M5: NOT_AUTHORIZED freshness ----
test("NOT_AUTHORIZED is a freshness state and takes precedence over everything", () => {
  assert.ok(FRESHNESS_STATES.includes("NOT_AUTHORIZED"));
  const good = { schemaVersion: "1.1.0", source: { commit: "abc", generatedAt: new Date(0).toISOString() } };
  // Even a perfectly current payload reads NOT_AUTHORIZED when the viewer isn't authorized —
  // an auth failure must never be shown as merely STALE/UNKNOWN.
  const r = freshnessState(good, 0, { authorized: false });
  assert.equal(r.state, "NOT_AUTHORIZED");
});

test("freshnessState still computes CURRENT/STALE/UNKNOWN when authorized (unchanged behavior)", () => {
  const now = 1_000_000_000_000;
  const current = { schemaVersion: "1.1.0", source: { commit: "abc", generatedAt: new Date(now - 1000).toISOString() } };
  assert.equal(freshnessState(current, now).state, "CURRENT");
  const stale = { schemaVersion: "1.1.0", source: { commit: "abc", generatedAt: new Date(now - 5 * 24 * 3.6e6).toISOString() } };
  assert.equal(freshnessState(stale, now).state, "STALE");
});

// ---- M12: token capacity, honest UNKNOWN ----
test("token capacity is UNKNOWN without an Owner-supplied allowance+spend (never fabricated)", () => {
  const r = projectTokenCapacity({});
  assert.equal(r.state, "UNKNOWN");
  assert.equal(r.remaining, null);
  assert.ok(CAPACITY_STATES.includes(r.state));
});

test("token capacity reports only the runtime-exposed subagent tokens, else null", () => {
  const withMetrics = projectTokenCapacity({ subagentResults: [{ metrics: { tokens: 100 } }, { metrics: { tokens: 50 } }] });
  assert.equal(withMetrics.subagentTokens, 150);
  assert.equal(projectTokenCapacity({ subagentResults: [{ metrics: {} }] }).subagentTokens, null);
});

test("token capacity classifies HEALTHY/LOW/DRAINED only when real numbers are supplied", () => {
  assert.equal(projectTokenCapacity({ weeklyAllowance: 1000, knownSpend: 100 }).state, "HEALTHY");
  assert.equal(projectTokenCapacity({ weeklyAllowance: 1000, knownSpend: 900 }).state, "LOW");
  assert.equal(projectTokenCapacity({ weeklyAllowance: 1000, knownSpend: 1000 }).state, "DRAINED");
});

// ---- M11: improvement register ----
const friction = (over = {}) => createImprovement({
  id: "IMP-1", source: "unnecessary-owner-interruption", evidence: [{ ref: "turn-log" }], ...over,
});

test("an improvement requires evidence and a valid friction source", () => {
  assert.deepEqual(validateImprovement(friction()), []);
  assert.ok(validateImprovement(createImprovement({ id: "x", source: "unnecessary-owner-interruption" })).length > 0); // no evidence
  assert.ok(validateImprovement(createImprovement({ id: "x", source: "because-i-felt-like-it", evidence: [1] })).length > 0);
});

test("THE INVARIANT: an improvement that would expand authority is inadmissible (route to Owner)", () => {
  assert.equal(isAdmissible(friction({ expandsAuthority: true })), false);
  assert.ok(validateImprovement(friction({ expandsAuthority: true })).some((e) => /expand authority/.test(e)));
});

test("improvement advances one forward hop only (no skipping PROVEN)", () => {
  let it = friction();
  it = advanceImprovement(it, "CLASSIFIED");
  it = advanceImprovement(it, "PROPOSED_IMPROVEMENT");
  it = advanceImprovement(it, "PROVEN");
  assert.equal(it.state, "PROVEN");
  assert.throws(() => advanceImprovement(friction(), "ADOPTED"), /illegal/); // OBSERVED_FRICTION can't jump to ADOPTED
});
