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

ok("populated ready read -> kind=ready with mapped rows, and identity never falls back to a document id", () => {
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
  // CHANGED, and the old expectation was the defect. This asserted that a row with no
  // descriptor falls back to its Firestore document id — which is exactly how
  // `95kFz8WWgiSn2nU2O3Ml` reached a user-facing row label. A database key is not a name:
  // it cannot be read aloud, searched for, or repeated on a phone call.
  //
  // "Unnamed opportunity" tells the reader something TRUE about the record instead of
  // showing them a key. Where a reference exists it is carried separately and identifies
  // the record precisely.
  assert.equal(view.rows[1].label, "Unnamed opportunity");
  assert.equal(view.rows[1].reference, null, "a legacy record has no reference, and none is invented");
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


ok("identity preference: name, then need, then reference — never the document id", () => {
  const view = accountOpportunitiesView({
    loading: false,
    errorStatus: null,
    result: {
      status: "ready",
      skipped: 0,
      opportunities: [
        { id: "docid-a", name: "Harbor Grill — 2 ice machines", need: "Replace ice machine", opportunityNumber: "OPP-2026-000042" },
        { id: "docid-b", name: null, need: "Replace ice machine", opportunityNumber: "OPP-2026-000043" },
        { id: "docid-c", name: null, need: null, opportunityNumber: "OPP-2026-000044" },
        { id: "docid-d", name: null, need: null, opportunityNumber: null },
      ],
    },
  });

  assert.equal(view.rows[0].label, "Harbor Grill — 2 ice machines", "a human name wins");
  assert.equal(view.rows[1].label, "Replace ice machine", "then the descriptor");
  assert.equal(view.rows[2].label, "OPP-2026-000044", "then the reference");
  assert.equal(view.rows[3].label, "Unnamed opportunity", "and never the document id");

  // The guarantee, stated as a property rather than four cases: no document id reaches a label.
  for (const row of view.rows) {
    assert.ok(!/^docid-/.test(row.label), `document id leaked into a label: ${row.label}`);
  }
});

ok("the reference is carried separately from the label, so a row can show both", () => {
  const view = accountOpportunitiesView({
    loading: false,
    errorStatus: null,
    result: {
      status: "ready",
      skipped: 0,
      opportunities: [{ id: "docid-a", name: "Harbor Grill — 2 ice machines", opportunityNumber: "OPP-2026-000042" }],
    },
  });
  assert.equal(view.rows[0].label, "Harbor Grill — 2 ice machines");
  assert.equal(view.rows[0].reference, "OPP-2026-000042");
});
console.log(`\n${passed} passed, 0 failed`);
