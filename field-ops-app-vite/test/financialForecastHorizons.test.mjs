// Account Commercial Profile and Financial Forecast Horizons -- PR 4,
// Phase 3 + 4. Deterministic unit test for the pure DEFINITIONS + render
// layer in src/domain/financialForecastHorizons.js.
//
// This surface is DEFINITIONS ONLY -- no computation. These tests assert:
//   * the label set (incl. the exact `Receivables Due` due-date aging label);
//   * the cumulative Current/30/60/90 boundaries + per-family date bases;
//   * the receivables component policy (incl. tax/shipping/fees, marked
//     NON-revenue);
//   * that the two families are always reported separately, never merged;
//   * that NO bucketing/component-calculation function exists to invoke and NO
//     real figure is producible -- the surfaces only ever yield `unconfigured`.
//
// Run: node test/financialForecastHorizons.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import * as forecast from "../src/domain/financialForecastHorizons.js";
import {
  FORECAST_FAMILY,
  FORECAST_FAMILIES,
  FORECAST_FAMILY_ORDER,
  FORECAST_HORIZON_BOUNDARIES,
  RECEIVABLES_COMPONENT_POLICY,
  RECEIVABLES_DUE_LABEL,
  PROJECTED_COLLECTIONS_RESERVED_LABEL,
  PRODUCTION_FORECAST_STATE,
  forecastHorizonView,
} from "../src/domain/financialForecastHorizons.js";
import { FINANCIAL_PROVIDER_STATE, UNCONFIGURED_COPY } from "../src/domain/financialSummaryView.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

// --- Two families, always separate, never merged ---
ok("exactly two families exist and are ordered separately (never merged into one total)", () => {
  assert.deepEqual(FORECAST_FAMILY_ORDER, [FORECAST_FAMILY.RECEIVABLES, FORECAST_FAMILY.PIPELINE_ORDER]);
  assert.equal(FORECAST_FAMILY_ORDER.length, 2);
  // Each family is its own labeled definition object -- there is NO combined/
  // merged family key.
  assert.equal(FORECAST_FAMILIES[FORECAST_FAMILY.RECEIVABLES].label, "Receivables");
  assert.equal(FORECAST_FAMILIES[FORECAST_FAMILY.PIPELINE_ORDER].label, "Pipeline / order");
  assert.notEqual(
    FORECAST_FAMILIES[FORECAST_FAMILY.RECEIVABLES].label,
    FORECAST_FAMILIES[FORECAST_FAMILY.PIPELINE_ORDER].label,
  );
});

// --- Label set, incl. the exact `Receivables Due` aging label ---
ok("Family 1 due-date aging is labeled EXACTLY 'Receivables Due', never Cash Collected / Projected Collections", () => {
  assert.equal(RECEIVABLES_DUE_LABEL, "Receivables Due");
  const recv = FORECAST_FAMILIES[FORECAST_FAMILY.RECEIVABLES];
  assert.equal(recv.agingLabel, "Receivables Due");
  // The aging label is distinct from actual cash and from the reserved model.
  assert.notEqual(recv.agingLabel, "Cash Collected");
  assert.notEqual(recv.agingLabel, PROJECTED_COLLECTIONS_RESERVED_LABEL);
  // The full receivables label set: actual Cash Collected + current Outstanding
  // Receivables + the due-date aging `Receivables Due`.
  assert.deepEqual(recv.metricLabels, ["Cash Collected", "Outstanding Receivables", "Receivables Due"]);
  assert.ok(recv.metricLabels.includes("Receivables Due"));
});

ok("`Projected Collections` is RESERVED (declared) but never used as a family/aging label here", () => {
  assert.equal(PROJECTED_COLLECTIONS_RESERVED_LABEL, "Projected Collections");
  for (const key of FORECAST_FAMILY_ORDER) {
    const fam = FORECAST_FAMILIES[key];
    assert.ok(!fam.metricLabels.includes("Projected Collections"), `${fam.label} must not label a metric Projected Collections`);
    assert.notEqual(fam.agingLabel, "Projected Collections");
  }
});

ok("Family 2 (Pipeline / order) labels are Open Pipeline + Committed Backlog", () => {
  const pipe = FORECAST_FAMILIES[FORECAST_FAMILY.PIPELINE_ORDER];
  assert.deepEqual(pipe.metricLabels, ["Open Pipeline", "Committed Backlog"]);
});

// --- Cumulative Current/30/60/90 boundaries ---
ok("cumulative boundaries are Current / 30 / 60 / 90, each including the prior", () => {
  assert.deepEqual(FORECAST_HORIZON_BOUNDARIES.map((b) => b.label), ["Current", "30", "60", "90"]);
  assert.deepEqual(FORECAST_HORIZON_BOUNDARIES.map((b) => b.cumulativeThroughDays), [0, 30, 60, 90]);
  // Strictly increasing => cumulative (each horizon includes the prior).
  for (let i = 1; i < FORECAST_HORIZON_BOUNDARIES.length; i += 1) {
    assert.ok(FORECAST_HORIZON_BOUNDARIES[i].cumulativeThroughDays > FORECAST_HORIZON_BOUNDARIES[i - 1].cumulativeThroughDays);
  }
  // Both families share the same Current/30/60/90 boundary structure.
  for (const key of FORECAST_FAMILY_ORDER) {
    assert.deepEqual(FORECAST_FAMILIES[key].boundaries.map((b) => b.label), ["Current", "30", "60", "90"]);
  }
});

// --- Per-family date bases (declared, and DIFFERENT per family) ---
ok("each family declares its own date basis -- receivables due date vs pipeline close/fulfillment date", () => {
  const recv = FORECAST_FAMILIES[FORECAST_FAMILY.RECEIVABLES];
  const pipe = FORECAST_FAMILIES[FORECAST_FAMILY.PIPELINE_ORDER];
  assert.match(recv.dateBasis, /snapshotted due date/);
  assert.match(pipe.dateBasis, /expectedCloseDate|fulfillment/);
  assert.notEqual(recv.dateBasis, pipe.dateBasis); // NOT the same basis -- families are different questions
});

// --- Receivables component policy: includes tax/shipping/fees, NON-revenue ---
ok("receivables component policy is amountOwed = subtotal+tax+shipping+fees - payments/credits/writeoffs/refunds + adjustments", () => {
  assert.deepEqual(RECEIVABLES_COMPONENT_POLICY.additive, [
    "invoiceSubtotal",
    "tax",
    "shipping",
    "fees",
    "validAdjustments",
  ]);
  assert.deepEqual(RECEIVABLES_COMPONENT_POLICY.subtractive, [
    "appliedPayments",
    "componentizedCredits",
    "approvedWriteOffs",
    "refundsReversals",
  ]);
});

ok("receivables balance INCLUDES tax/shipping/fees but is explicitly NON-revenue", () => {
  for (const comp of ["tax", "shipping", "fees"]) {
    assert.ok(RECEIVABLES_COMPONENT_POLICY.additive.includes(comp), `${comp} is part of the balance owed`);
    assert.ok(RECEIVABLES_COMPONENT_POLICY.includedNonRevenueComponents.includes(comp), `${comp} is marked a NON-revenue component`);
  }
  // Never labeled or summed as revenue.
  assert.equal(RECEIVABLES_COMPONENT_POLICY.isRevenue, false);
  // Cancelled/voided invoices contribute nothing.
  assert.ok(RECEIVABLES_COMPONENT_POLICY.excludedFromBalance.includes("cancelledInvoices"));
  assert.ok(RECEIVABLES_COMPONENT_POLICY.excludedFromBalance.includes("voidedInvoices"));
  // Family 2 (pipeline) has NO receivables component policy -- it is not a
  // receivables balance.
  assert.equal(FORECAST_FAMILIES[FORECAST_FAMILY.PIPELINE_ORDER].componentPolicy, null);
});

// --- The surface only ever yields `unconfigured`: no real figure producible ---
ok("production forecast state is unconfigured, and the view yields the exact copy with NO figure/$", () => {
  assert.deepEqual(PRODUCTION_FORECAST_STATE, { status: FINANCIAL_PROVIDER_STATE.UNCONFIGURED });
  const v = forecastHorizonView(); // default = production state
  assert.deepEqual(v, { kind: "message", tone: "muted", text: "Sales data source not connected" });
  assert.equal(UNCONFIGURED_COPY, "Sales data source not connected");
  assert.equal(v.text.includes("$"), false);
  // Unknown/missing status also falls back to unconfigured (never a $0/blank).
  assert.equal(forecastHorizonView({ status: "bogus" }).text, "Sales data source not connected");
  assert.equal(forecastHorizonView(null).text, "Sales data source not connected");
});

ok("no figure path: even a fabricated partial/complete provider state can NEVER yield a metrics/figure kind here", () => {
  // financialSummaryView WOULD render figures for partial/complete, but the
  // forecast surface has no metrics path -- it coerces any such state back to
  // the unconfigured message. There is no reachable path to a real figure.
  const fabricatedComplete = {
    status: FINANCIAL_PROVIDER_STATE.COMPLETE,
    asOf: "2026-07-01",
    metrics: [{ name: "Cash Collected", available: true, value: "$9,999" }],
  };
  const v = forecastHorizonView(fabricatedComplete);
  assert.equal(v.kind, "message");
  assert.notEqual(v.kind, "metrics");
  assert.equal(v.text, "Sales data source not connected");
  assert.equal(v.text.includes("$"), false);
  const p = forecastHorizonView({ status: FINANCIAL_PROVIDER_STATE.PARTIAL, metrics: [{ name: "Open Pipeline", available: true, value: "$1" }] });
  assert.equal(p.kind, "message");
  assert.equal(p.text, "Sales data source not connected");
});

ok("no bucketing / component-calculation function is exported to invoke", () => {
  // The module exposes DEFINITIONS + one message-only view function. It must
  // export NO computation function (bucket/compute/calculate/aggregate/sum/
  // age/total) -- there is no data and no provider to compute against.
  const exportedFunctionNames = Object.entries(forecast)
    .filter(([, val]) => typeof val === "function")
    .map(([name]) => name);
  assert.deepEqual(exportedFunctionNames, ["forecastHorizonView"], `unexpected exported functions: ${exportedFunctionNames.join(", ")}`);
  const forbidden = /bucket|comput|calculat|aggregat|\bsum\b|aging|total|amountOwed|balance/i;
  for (const name of exportedFunctionNames) {
    assert.ok(!forbidden.test(name), `exported function "${name}" looks like a computation path, which must not exist`);
  }
});

console.log(`\n${passed} passed, 0 failed`);
