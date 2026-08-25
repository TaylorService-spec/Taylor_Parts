import test from "node:test";
import assert from "node:assert/strict";
import { mapOpportunityReadResult } from "../src/access/opportunitySource.js";

test("success maps to ready with the projected opportunities and no embedded names", () => {
  const r = mapOpportunityReadResult({ ok: true, payload: { status: "ready", opportunities: [{ id: "A" }] } });
  assert.equal(r.status, "ready");
  assert.equal(r.opportunities.length, 1);
  // A payload carrying no names still yields {} -- a client ahead of its deployed functions degrades
  // to the em dash rather than throwing.
  assert.deepEqual(r.accountNameById, {});
  assert.equal(r.synthetic, false);
});

test("degraded payload surfaces honestly", () => {
  const r = mapOpportunityReadResult({ ok: true, payload: { status: "degraded", opportunities: [] } });
  assert.equal(r.status, "degraded");
  assert.equal(r.error, "degraded");
});

test("permission-denied maps to denied (distinct from unavailable/empty)", () => {
  const r = mapOpportunityReadResult({ ok: false, errorCode: "permission-denied" });
  assert.equal(r.status, "denied");
  assert.deepEqual(r.opportunities, []);
});

test("any other error maps to unavailable, never a false-empty", () => {
  assert.equal(mapOpportunityReadResult({ ok: false, errorCode: "internal" }).status, "unavailable");
  assert.equal(mapOpportunityReadResult({}).status, "unavailable");
});

test("THE RESOLVED CUSTOMER NAMES REACH THE WORKSPACE", () => {
  // The line this asserts used to read `accountNameById: {}`, hard-coded, under a comment saying
  // names "resolve separately from the canonical Account authority". True as an intention, and
  // there was no mechanism -- so the Customer column of the Sales pipeline was an em dash for every
  // Opportunity in the product. The old test asserted the empty map and passed, which is how a
  // missing feature survives a green suite: the test agreed with the defect.
  const r = mapOpportunityReadResult({
    ok: true,
    payload: {
      status: "ready",
      opportunities: [{ id: "A", accountId: "acct-harbor" }],
      accountNameById: { "acct-harbor": "Harbor Foods" },
    },
  });
  assert.deepEqual(r.accountNameById, { "acct-harbor": "Harbor Foods" });
});

test("a malformed names payload degrades to {} rather than propagating garbage", () => {
  for (const bad of [null, "nope", 42, undefined]) {
    const r = mapOpportunityReadResult({
      ok: true,
      payload: { status: "ready", opportunities: [], accountNameById: bad },
    });
    assert.deepEqual(r.accountNameById, {}, `accountNameById: ${JSON.stringify(bad)} must not reach the UI`);
  }
});
