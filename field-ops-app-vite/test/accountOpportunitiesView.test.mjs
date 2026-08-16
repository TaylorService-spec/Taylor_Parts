// Account-scoped Opportunities view-model -- offline, pure. Proves empty is kept visually and
// semantically distinct from every failure mode (denied/unavailable), and that a bounded/truncated
// page is honestly disclosed rather than silently short.
import assert from "node:assert/strict";
import { accountOpportunitiesView, ACCOUNT_OPPORTUNITIES_STATE } from "../src/domain/accountOpportunitiesView.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

ok("loading -> kind=loading", () => {
  const view = accountOpportunitiesView({ loading: true });
  assert.equal(view.kind, ACCOUNT_OPPORTUNITIES_STATE.LOADING);
});

ok("denied transport error -> kind=denied, NEVER collapsed to empty", () => {
  const view = accountOpportunitiesView({ errorStatus: "denied" });
  assert.equal(view.kind, "denied");
  assert.notEqual(view.kind, ACCOUNT_OPPORTUNITIES_STATE.EMPTY);
});

ok("unavailable transport error -> kind=unavailable, NEVER collapsed to empty", () => {
  const view = accountOpportunitiesView({ errorStatus: "unavailable" });
  assert.equal(view.kind, "unavailable");
  assert.notEqual(view.kind, ACCOUNT_OPPORTUNITIES_STATE.EMPTY);
});

ok("no result at all (null, no error, not loading) -> unavailable, never empty", () => {
  const view = accountOpportunitiesView({});
  assert.equal(view.kind, ACCOUNT_OPPORTUNITIES_STATE.UNAVAILABLE);
});

ok("a non-'ready' status payload -> unavailable, never empty", () => {
  const view = accountOpportunitiesView({ result: { status: "degraded-nonsense", opportunities: [] } });
  assert.equal(view.kind, ACCOUNT_OPPORTUNITIES_STATE.UNAVAILABLE);
});

ok("genuinely succeeded read with zero rows -> kind=empty, distinct from every failure kind", () => {
  const view = accountOpportunitiesView({ result: { status: "ready", opportunities: [], skipped: 0, truncated: false } });
  assert.equal(view.kind, ACCOUNT_OPPORTUNITIES_STATE.EMPTY);
  assert.notEqual(view.kind, "denied");
  assert.notEqual(view.kind, "unavailable");
});

ok("populated ready read -> kind=ready with mapped rows, label falls back to id when need is absent", () => {
  const view = accountOpportunitiesView({
    result: {
      status: "ready",
      truncated: false,
      skipped: 0,
      opportunities: [
        { id: "OPP-1", need: "Replace ice machine", stage: "QUOTING", outcome: null, expectedValue: 5000, expectedCloseAt: 1000, ownerEmployeeId: "EMP-1", salesOrderId: null },
        { id: "OPP-2", need: null, stage: "DECISION", outcome: "WON", expectedValue: null, expectedCloseAt: null, ownerEmployeeId: null, salesOrderId: "SO-1" },
      ],
    },
  });
  assert.equal(view.kind, ACCOUNT_OPPORTUNITIES_STATE.READY);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].label, "Replace ice machine");
  assert.equal(view.rows[1].label, "OPP-2"); // fallback to id, never a blank label
  assert.equal(view.truncated, false);
});

ok("truncated page -> truncated=true rides the ready payload, rows are NOT silently short of the truth", () => {
  const opportunities = Array.from({ length: 5 }, (_, i) => ({ id: `OPP-${i}`, need: `n${i}`, stage: "QUOTING" }));
  const view = accountOpportunitiesView({ result: { status: "ready", opportunities, skipped: 0, truncated: true } });
  assert.equal(view.kind, ACCOUNT_OPPORTUNITIES_STATE.READY);
  assert.equal(view.truncated, true);
  assert.equal(view.rows.length, 5);
});

ok("skipped count is surfaced honestly (not hidden), even on a populated read", () => {
  const view = accountOpportunitiesView({
    result: { status: "ready", opportunities: [{ id: "OPP-1", need: "x", stage: "QUOTING" }], skipped: 2, truncated: false },
  });
  assert.equal(view.skipped, 2);
});

console.log(`\n${passed} passed, 0 failed`);
