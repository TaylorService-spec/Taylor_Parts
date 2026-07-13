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

// --- partial: per-figure "(partial data)" warning; missing shown unavailable, not $0 ---
ok("partial: available metric carries a per-figure partial warning; missing metric disclosed, not $0", () => {
  const v = financialSummaryView({
    status: FINANCIAL_PROVIDER_STATE.PARTIAL,
    asOf: "2026-07-01",
    metrics: [
      { name: "Cash Collected", available: true, value: "$1,200" },
      { name: "Booked Value", available: false, unavailableReason: "December sync incomplete" },
    ],
  });
  assert.equal(v.kind, "metrics");
  assert.equal(v.partial, true);
  const cash = v.rows.find((r) => r.name === "Cash Collected");
  const booked = v.rows.find((r) => r.name === "Booked Value");
  assert.equal(cash.text, "Cash Collected: $1,200 (partial data)"); // warning travels with the figure
  assert.equal(booked.available, false);
  assert.equal(booked.text, "Booked Value: unavailable — December sync incomplete"); // never $0
  assert.equal(booked.text.includes("$0"), false);
});

// --- complete: each metric explicit; a genuine $0 is allowed for a supported
//     metric, but an UNSUPPORTED metric must be explicitly disclosed as
//     unavailable, never silently omitted ---
ok("complete: supported metrics render (incl. legit $0); unsupported metric explicitly disclosed, never omitted", () => {
  const v = financialSummaryView({
    status: FINANCIAL_PROVIDER_STATE.COMPLETE,
    asOf: "2026-07-01",
    metrics: [
      { name: "Invoiced Net Sales", available: true, value: "$0" }, // genuine, known zero
      { name: "Cash Collected", available: true, value: "$0" },
      { name: "Booked Value", available: false, unavailableReason: "this provider does not supply Sales Orders" },
      { name: "Open Pipeline", available: false, unavailableReason: "this provider does not supply Opportunities" },
    ],
  });
  assert.equal(v.kind, "metrics");
  assert.equal(v.partial, false);
  assert.equal(v.rows.length, 4); // nothing silently omitted
  assert.equal(v.rows.find((r) => r.name === "Invoiced Net Sales").text, "Invoiced Net Sales: $0");
  const booked = v.rows.find((r) => r.name === "Booked Value");
  assert.equal(booked.available, false);
  assert.equal(booked.text, "Booked Value: unavailable — this provider does not supply Sales Orders");
  const pipeline = v.rows.find((r) => r.name === "Open Pipeline");
  assert.equal(pipeline.text, "Open Pipeline: unavailable — this provider does not supply Opportunities");
  assert.equal(v.footer, "Complete through 2026-07-01");
});

console.log(`\n${passed} passed, 0 failed`);
