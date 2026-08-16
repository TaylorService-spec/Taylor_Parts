// Account health strip -- OFFLINE tests for the pure view model.
//
// The property under test is honesty: every tile must be traceable to a real account-scoped
// authority, and a source that cannot answer must never degrade into a number a salesperson would
// believe. A fabricated "0 past due" is the specific failure these lock out.
import assert from "node:assert/strict";
import { buildAccountHealthStrip, HEALTH_METRIC_STATE } from "../src/domain/accountHealthStrip.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("accountHealthStrip.test.mjs");

const byId = (metrics, id) => metrics.find((m) => m.id === id);

const readyAr = (over = {}) => ({
  kind: "READY",
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
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 1, loading: false, error: false }, arView: { kind: "DENIED" } });
  assert.equal(byId(metrics, "outstandingAr").state, HEALTH_METRIC_STATE.DENIED);
  assert.equal(byId(metrics, "pastDueAr").state, HEALTH_METRIC_STATE.DENIED);
  assert.equal(byId(metrics, "pastDueAr").value, undefined);
});

check("an account with genuinely no invoices reports a real answer, not unavailable", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 1, loading: false, error: false }, arView: { kind: "EMPTY" } });
  assert.equal(byId(metrics, "outstandingAr").state, HEALTH_METRIC_STATE.READY);
  assert.equal(byId(metrics, "outstandingAr").value, "None");
  assert.equal(byId(metrics, "pastDueAr").value, "0");
});

check("an UNAVAILABLE AR source does not become zero", () => {
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: 1, loading: false, error: false }, arView: { kind: "UNAVAILABLE" } });
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
  const metrics = buildAccountHealthStrip({ workOrderCount: { value: null, loading: true, error: false }, arView: { kind: "LOADING" } });
  for (const m of metrics) assert.equal(m.state, HEALTH_METRIC_STATE.LOADING);
});

check("missing/malformed inputs never throw and never fabricate a value", () => {
  for (const args of [undefined, {}, { workOrderCount: null, arView: null }, { workOrderCount: {}, arView: {} }]) {
    const metrics = buildAccountHealthStrip(args);
    assert.equal(metrics.length, 3);
    for (const m of metrics) assert.equal(m.value, undefined, `${m.id} fabricated a value`);
  }
});

console.log(`\n${passed} passed, 0 failed`);
