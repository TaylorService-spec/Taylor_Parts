import test from "node:test";
import assert from "node:assert/strict";
import { mapOpportunityReadResult } from "../src/access/opportunitySource.js";

test("success maps to ready with the projected opportunities and no embedded names", () => {
  const r = mapOpportunityReadResult({ ok: true, payload: { status: "ready", opportunities: [{ id: "A" }] } });
  assert.equal(r.status, "ready");
  assert.equal(r.opportunities.length, 1);
  assert.deepEqual(r.accountNameById, {}); // names resolve from canonical Account authority, not here
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
