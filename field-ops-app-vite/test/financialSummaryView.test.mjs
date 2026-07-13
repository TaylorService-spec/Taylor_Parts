// Customer/Account Business Model -- Customer PR 4, Financial Summary.
// Deterministic unit test for the pure five-state render layer in
// src/domain/financialSummaryView.js -- exercises ALL FIVE Framework
// provider-contract states (complete/partial/stale/error/unconfigured) plus
// the transient loading state with fixtures, asserting the exact unconfigured
// wording and the complete-state unsupported-metric disclosure. Only
// `unconfigured` is reachable in production; the other states are proven here
// with fixtures.
//
// Run: node test/financialSummaryView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  financialSummaryView,
  FINANCIAL_PROVIDER_STATE,
  CANONICAL_FINANCIAL_METRICS,
  UNCONFIGURED_COPY,
  ERROR_COPY,
} from "../src/domain/financialSummaryView.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

// --- unconfigured: exact copy, muted, and NEVER a $0/dollar figure ---
ok("unconfigured: exact copy 'Sales data source not connected', muted, no $", () => {
  const v = financialSummaryView({ status: FINANCIAL_PROVIDER_STATE.UNCONFIGURED });
  assert.deepEqual(v, { kind: "message", tone: "muted", text: "Sales data source not connected" });
  assert.equal(UNCONFIGURED_COPY, "Sales data source not connected");
  assert.equal(v.text.includes("$"), false); // never a fabricated $0/dollar figure
});

// --- unknown/missing status falls back to unconfigured (never a $0/blank) ---
ok("unknown status falls back to unconfigured copy", () => {
  assert.deepEqual(financialSummaryView({ status: "bogus" }), { kind: "message", tone: "muted", text: "Sales data source not connected" });
  assert.deepEqual(financialSummaryView({}), { kind: "message", tone: "muted", text: "Sales data source not connected" });
  assert.deepEqual(financialSummaryView(null), { kind: "message", tone: "muted", text: "Sales data source not connected" });
});

// --- loading (transient) ---
ok("loading: distinct loading descriptor", () => {
  const v = financialSummaryView({ status: "loading" });
  assert.equal(v.kind, "loading");
});

// --- error ---
ok("error: exact 'Sales data temporarily unavailable', warning tone", () => {
  const v = financialSummaryView({ status: FINANCIAL_PROVIDER_STATE.ERROR });
  assert.deepEqual(v, { kind: "message", tone: "warning", text: "Sales data temporarily unavailable" });
  assert.equal(ERROR_COPY, "Sales data temporarily unavailable");
});

// --- stale (carries asOf) ---
ok("stale: warning text carries the asOf freshness time", () => {
  const v = financialSummaryView({ status: FINANCIAL_PROVIDER_STATE.STALE, asOf: "2026-07-01" });
  assert.equal(v.kind, "message");
  assert.equal(v.tone, "warning");
  assert.equal(v.text, "Sales data may be stale as of 2026-07-01");
});

// The canonical seven, in the exact order the surface must always render.
const rowNames = (v) => v.rows.map((r) => r.name);

// --- partial: ALWAYS renders all seven canonical metrics; supplied figures
//     carry a per-figure partial warning; every absent one is disclosed as
//     unavailable; noncanonical names are ignored ---
ok("partial: renders all seven canonical metrics; supplied carries partial warning; absent disclosed; noncanonical ignored", () => {
  const v = financialSummaryView({
    status: FINANCIAL_PROVIDER_STATE.PARTIAL,
    asOf: "2026-07-01",
    metrics: [
      { name: "Cash Collected", available: true, value: "$1,200" },
      { name: "Booked Value", available: false, unavailableReason: "December sync incomplete" },
      { name: "Totally Made Up Metric", available: true, value: "$999" }, // noncanonical -> ignored
    ],
  });
  assert.equal(v.kind, "metrics");
  assert.equal(v.partial, true);
  assert.equal(v.rows.length, 7); // ALL seven, always
  assert.deepEqual(rowNames(v), CANONICAL_FINANCIAL_METRICS); // exact set + order
  assert.equal(v.rows.find((r) => r.name === "Cash Collected").text, "Cash Collected: $1,200 (partial data)");
  assert.equal(v.rows.find((r) => r.name === "Booked Value").text, "Booked Value: unavailable — December sync incomplete");
  // Every metric NOT supplied is disclosed as unavailable, never omitted, never $0.
  for (const name of ["Open Pipeline", "Quoted Value", "Committed Backlog", "Invoiced Net Sales", "Credited Net Sales"]) {
    const row = v.rows.find((r) => r.name === name);
    assert.equal(row.available, false);
    assert.equal(row.text, `${name}: unavailable`);
  }
  assert.equal(v.rows.some((r) => r.name === "Totally Made Up Metric"), false); // noncanonical never renders
});

// --- complete: ALWAYS renders all seven; a genuine $0 is allowed only as
//     provider-supplied data; every unsupported/absent metric is explicitly
//     disclosed as unavailable, never silently omitted; noncanonical ignored ---
ok("complete: renders all seven; supported $0 allowed (provider-supplied); unsupported/absent disclosed; noncanonical ignored", () => {
  const v = financialSummaryView({
    status: FINANCIAL_PROVIDER_STATE.COMPLETE,
    asOf: "2026-07-01",
    metrics: [
      { name: "Invoiced Net Sales", available: true, value: "$0" }, // genuine, provider-supplied zero
      { name: "Cash Collected", available: true, value: "$0" },
      { name: "Booked Value", available: false, unavailableReason: "this provider does not supply Sales Orders" },
      { name: "Open Pipeline", available: false, unavailableReason: "this provider does not supply Opportunities" },
      { name: "Not A Real KPI", available: true, value: "$42" }, // noncanonical -> ignored
    ],
  });
  assert.equal(v.kind, "metrics");
  assert.equal(v.partial, false);
  assert.equal(v.rows.length, 7); // ALL seven, always -- nothing silently omitted
  assert.deepEqual(rowNames(v), CANONICAL_FINANCIAL_METRICS);
  assert.equal(v.rows.find((r) => r.name === "Invoiced Net Sales").text, "Invoiced Net Sales: $0"); // supported $0
  assert.equal(v.rows.find((r) => r.name === "Cash Collected").text, "Cash Collected: $0");
  assert.equal(v.rows.find((r) => r.name === "Booked Value").text, "Booked Value: unavailable — this provider does not supply Sales Orders");
  assert.equal(v.rows.find((r) => r.name === "Open Pipeline").text, "Open Pipeline: unavailable — this provider does not supply Opportunities");
  // Metrics the provider never mentioned at all -> disclosed as unavailable, no $0.
  for (const name of ["Quoted Value", "Committed Backlog", "Credited Net Sales"]) {
    const row = v.rows.find((r) => r.name === name);
    assert.equal(row.text, `${name}: unavailable`);
    assert.equal(row.text.includes("$0"), false);
  }
  assert.equal(v.rows.some((r) => r.name === "Not A Real KPI"), false); // noncanonical never renders
  assert.equal(v.footer, "Complete through 2026-07-01");
});

console.log(`\n${passed} passed, 0 failed`);
