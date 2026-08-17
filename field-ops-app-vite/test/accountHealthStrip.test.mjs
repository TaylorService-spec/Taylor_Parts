// Account health strip -- OFFLINE tests for the pure view model.
//
// The property under test is honesty: every tile must be traceable to a real account-scoped
// authority, and a source that cannot answer must never degrade into a number a salesperson would
// believe. A fabricated "0 past due" is the specific failure these lock out.
import assert from "node:assert/strict";
import { buildAccountHealthStrip, HEALTH_METRIC_STATE } from "../src/domain/accountHealthStrip.js";
import { accountArView, ACCOUNT_AR_STATE } from "../src/domain/accountArView.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("accountHealthStrip.test.mjs");

const byId = (metrics, id) => metrics.find((m) => m.id === id);

const readyAr = (over = {}) => ({
  kind: ACCOUNT_AR_STATE.READY,
  overdueCount: 0,
  outstandingLines: [{ currency: "USD", text: "$1,200.00" }],
  ...over,
});

check("projects exactly the three metrics that have an authoritative account-scoped read", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 2, loading: false, error: false }, arView: readyAr() });
  assert.deepEqual(metrics.map((m) => m.id), ["openWorkOrders", "outstandingAr", "pastDueAr"]);
});

check("does NOT project pipeline, sales order backlog or equipment count", () => {
  // None of these has an account-scoped read today; a tile would imply knowledge the app lacks.
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 0, loading: false, error: false }, arView: readyAr() });
  for (const absent of ["openPipeline", "salesOrderBacklog", "equipmentCount"]) {
    assert.equal(byId(metrics, absent), undefined, absent);
  }
});

check("a real zero renders as a value, and does not link anywhere", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 0, loading: false, error: false }, arView: readyAr() });
  const wo = byId(metrics, "openWorkOrders");
  assert.equal(wo.state, HEALTH_METRIC_STATE.READY);
  assert.equal(wo.value, "0");
  assert.equal(wo.href, null); // nothing to navigate to
});

check("a non-zero count links to the underlying records", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 3, loading: false, error: false }, arView: readyAr() });
  assert.equal(byId(metrics, "openWorkOrders").href, "/service/work-orders");
});

check("a FAILED work-order read is UNAVAILABLE -- never a fabricated 0", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: null, loading: false, error: true }, arView: readyAr() });
  const wo = byId(metrics, "openWorkOrders");
  assert.equal(wo.state, HEALTH_METRIC_STATE.UNAVAILABLE);
  assert.equal(wo.value, undefined);
});

check("a DENIED AR read stays DENIED -- never collapsed into empty or zero", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 1, loading: false, error: false }, arView: { kind: ACCOUNT_AR_STATE.DENIED } });
  assert.equal(byId(metrics, "outstandingAr").state, HEALTH_METRIC_STATE.DENIED);
  assert.equal(byId(metrics, "pastDueAr").state, HEALTH_METRIC_STATE.DENIED);
  assert.equal(byId(metrics, "pastDueAr").value, undefined);
});

check("an account with genuinely no invoices reports a real answer, not unavailable", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 1, loading: false, error: false }, arView: { kind: ACCOUNT_AR_STATE.EMPTY } });
  assert.equal(byId(metrics, "outstandingAr").state, HEALTH_METRIC_STATE.READY);
  assert.equal(byId(metrics, "outstandingAr").value, "None");
  assert.equal(byId(metrics, "pastDueAr").value, "0");
});

check("an UNAVAILABLE AR source does not become zero", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 1, loading: false, error: false }, arView: { kind: ACCOUNT_AR_STATE.UNAVAILABLE } });
  assert.equal(byId(metrics, "outstandingAr").state, HEALTH_METRIC_STATE.UNAVAILABLE);
  assert.equal(byId(metrics, "pastDueAr").state, HEALTH_METRIC_STATE.UNAVAILABLE);
});

check("past due is toned and linked only when there is genuinely something past due", () => {
  const none = buildAccountHealthStrip({ workOrderCount: { value: 1, loading: false, error: false }, arView: readyAr({ overdueCount: 0 }) });
  assert.equal(byId(none, "pastDueAr").tone, undefined);
  assert.equal(byId(none, "pastDueAr").href, null);

  const some = buildAccountHealthStrip({ workOrderCount: { value: 1, loading: false, error: false }, arView: readyAr({ overdueCount: 4 }) });
  assert.equal(byId(some, "pastDueAr").value, "4");
  assert.equal(byId(some, "pastDueAr").tone, "warn");
  assert.equal(byId(some, "pastDueAr").href, "#account-financials");
});

check("multi-currency outstanding is shown honestly, never summed across currencies", () => {
  const metrics = buildAccountHealthStrip({
    workOrderCount: { value: 1, loading: false, error: false },
    arView: readyAr({ outstandingLines: [{ currency: "USD", text: "$100.00" }, { currency: "CAD", text: "CA$50.00" }] }),
  });
  const value = byId(metrics, "outstandingAr").value;
  assert.ok(value.includes("$100.00") && value.includes("CA$50.00"));
  assert.ok(!value.includes("150"));
});

check("loading is its own state, distinct from unavailable", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: null, loading: true, error: false }, arView: { kind: ACCOUNT_AR_STATE.LOADING } });
  for (const m of metrics) assert.equal(m.state, HEALTH_METRIC_STATE.LOADING);
});

check("missing/malformed inputs never throw and never fabricate a value", () => {
  for (const args of [undefined, {}, { workOrderCount: null, arView: null }, { workOrderCount: {}, arView: {} }]) {
    const metrics = buildAccountHealthStrip(args);
    assert.equal(metrics.length, 3);
    for (const m of metrics) assert.equal(m.value, undefined, `${m.id} fabricated a value`);
  }
});


// Issue #1094 regression. accountHealthStrip.js compared arView.kind against hardcoded
// uppercase literals while accountArView.js emits lowercase ones, so no branch could match
// and the strip reported "Unavailable" on EVERY account forever -- including accounts whose
// AR read had succeeded and whose AR section, three components down the same page, was
// rendering a real balance. These assert the real producer's real values, not local strings,
// so a future divergence between the two files fails here rather than in a browser.
check("#1094 — health strip renders READY AR from the producer's own discriminants", () => {
  const arView = accountArView({
    loading: false,
    errorStatus: null,
    result: {
      status: "ready",
      invoices: [{ invoiceId: "i1", invoiceNumber: "INV-1", outstandingMinor: 5000, currency: "USD", arPosition: "CURRENT" }],
      summary: { count: 1, openCount: 1, overdueCount: 0, outstandingByCurrency: { USD: 5000 } },
    },
  });
  assert.equal(arView.kind, ACCOUNT_AR_STATE.READY);

  const metrics = buildAccountHealthStrip({ workOrderCount: { loading: false, value: 0 }, arView });
  const outstanding = metrics.find((m) => m.id === "outstandingAr");
  const pastDue = metrics.find((m) => m.id === "pastDueAr");

  assert.equal(outstanding.state, HEALTH_METRIC_STATE.READY, "a successful AR read must not render as Unavailable");
  assert.equal(pastDue.state, HEALTH_METRIC_STATE.READY);
});

check("#1094 — EMPTY is a real answer (None/0), never Unavailable", () => {
  const arView = accountArView({
    loading: false,
    errorStatus: null,
    result: { status: "ready", invoices: [], summary: { count: 0, openCount: 0, overdueCount: 0, outstandingByCurrency: {} } },
  });
  assert.equal(arView.kind, ACCOUNT_AR_STATE.EMPTY);

  const metrics = buildAccountHealthStrip({ workOrderCount: { loading: false, value: 0 }, arView });
  const outstanding = metrics.find((m) => m.id === "outstandingAr");
  assert.equal(outstanding.state, HEALTH_METRIC_STATE.READY);
  assert.equal(outstanding.value, "None", "an account with no invoices has a real answer, not an absent source");
});

check("#1094 — DENIED stays distinct from UNAVAILABLE", () => {
  // "you may not see this" and "the source could not answer" are different facts and must not
  // collapse into each other.
  const denied = accountArView({ loading: false, errorStatus: ACCOUNT_AR_STATE.DENIED, result: null });
  const metrics = buildAccountHealthStrip({ workOrderCount: { loading: false, value: 0 }, arView: denied });
  assert.equal(metrics.find((m) => m.id === "outstandingAr").state, HEALTH_METRIC_STATE.DENIED);
});

check("#1094 — every ACCOUNT_AR_STATE value is handled by the strip", () => {
  // The guard against the original bug reappearing under a NEW state: if accountArView gains a
  // discriminant the strip does not handle, it silently degrades to UNAVAILABLE. This asserts
  // each known state maps to a deliberate metric state.
  const expected = {
    [ACCOUNT_AR_STATE.LOADING]: HEALTH_METRIC_STATE.LOADING,
    [ACCOUNT_AR_STATE.DENIED]: HEALTH_METRIC_STATE.DENIED,
    [ACCOUNT_AR_STATE.EMPTY]: HEALTH_METRIC_STATE.READY,
    [ACCOUNT_AR_STATE.UNAVAILABLE]: HEALTH_METRIC_STATE.UNAVAILABLE,
    [ACCOUNT_AR_STATE.READY]: HEALTH_METRIC_STATE.READY,
  };
  for (const [kind, want] of Object.entries(expected)) {
    const arView = kind === ACCOUNT_AR_STATE.READY
      ? { kind, openCount: 1, overdueCount: 0, outstandingLines: [{ currency: "USD", text: "USD 50.00" }] }
      : { kind };
    const metrics = buildAccountHealthStrip({ workOrderCount: { loading: false, value: 0 }, arView });
    assert.equal(metrics.find((m) => m.id === "outstandingAr").state, want, `kind ${kind}`);
  }
});
console.log(`\n${passed} passed, 0 failed`);
