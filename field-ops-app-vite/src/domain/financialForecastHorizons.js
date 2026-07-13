// Account Commercial Profile and Financial Forecast Horizons -- PR 4,
// Phase 3 + 4 (docs/specifications/account-commercial-profile-and-financial-
// forecast-horizons.md; docs/architecture/enterprise-business-metrics-
// framework.md).
//
// PURE definitions + render-decision layer for the two provider-neutral
// Financial Forecast Horizon FAMILIES (Receivables and Pipeline / order).
// No Firebase import, unit-testable in Node.
//
// DEFINITIONS ONLY -- NO COMPUTATION. There is no financial provider (external
// or governed local ledger) and no data connected in this initiative, so:
//   * the surface is built to the Framework FULL five-state provider contract
//     (complete/partial/stale/error/unconfigured) but ONLY `unconfigured` is
//     reachable -- it renders the exact copy "Sales data source not connected"
//     and NEVER a dollar figure, $0, bucketed aging value, or any real figure;
//   * the label set, the cumulative Current/30/60/90 boundaries, the per-family
//     date bases, and the receivables COMPONENT POLICY are encoded here as
//     DEFINITIONS (constants/data) only. NO bucketing function and NO component
//     arithmetic is implemented -- there is nothing to compute against.
// Connecting a real provider (real receivables/pipeline figures, drill-down,
// export, AI access) is a SEPARATE future initiative (Spec Phase 5), not built
// here. This module deliberately exposes no calculation/real-figure path.

import { financialSummaryView, FINANCIAL_PROVIDER_STATE, UNCONFIGURED_COPY } from "./financialSummaryView.js";

// The two forecast families -- ALWAYS reported separately under their own
// labeled sub-sections; NEVER merged into one unlabeled total (Spec "Shared
// rules": a receivables view and a pipeline view are different questions).
export const FORECAST_FAMILY = {
  RECEIVABLES: "receivables",
  PIPELINE_ORDER: "pipelineOrder",
};

// Family 1's due-date aging is labeled EXACTLY `Receivables Due` -- an aging
// view of outstanding receivables grouped by due date. It is NEVER labeled
// `Cash Collected` (that is actual cash already received) and NEVER
// `Projected Collections` (reserved below for a future governed model).
export const RECEIVABLES_DUE_LABEL = "Receivables Due";

// Reserved for a separately-governed collection-probability model that does
// NOT exist in this initiative. Declared so the due-date aging is never
// silently relabeled as a collection forecast.
export const PROJECTED_COLLECTIONS_RESERVED_LABEL = "Projected Collections";

// The cumulative Current/30/60/90 aging boundaries (each INCLUDES the prior).
// DEFINITION ONLY -- no bucketing function consumes these here; there is no
// data to bucket against.
export const FORECAST_HORIZON_BOUNDARIES = [
  { key: "current", label: "Current", cumulativeThroughDays: 0, definition: "due on/before today (due-now + overdue)" },
  { key: "through30", label: "30", cumulativeThroughDays: 30, definition: "due on/before today+30" },
  { key: "through60", label: "60", cumulativeThroughDays: 60, definition: "due on/before today+60" },
  { key: "through90", label: "90", cumulativeThroughDays: 90, definition: "due on/before today+90" },
];

// Receivables component policy -- `Outstanding Receivables` / `Receivables Due`
// is the full customer amount owed and is EXPLICITLY NON-REVENUE. DEFINITION
// ONLY: the formula is encoded as data, and NO arithmetic is implemented.
//
//   amountOwed = invoiceSubtotal + tax + shipping + fees
//              - appliedPayments - componentizedCredits - approvedWriteOffs
//              - refundsReversals + validAdjustments
//
// It deliberately INCLUDES tax, shipping, and fees because it answers "what
// does the customer owe", so it is never a revenue figure and is never labeled
// or summed as revenue (Framework Section 9: tax/shipping/fees are excluded
// from REVENUE metrics; here they are legitimate parts of the BALANCE OWED).
export const RECEIVABLES_COMPONENT_POLICY = {
  additive: ["invoiceSubtotal", "tax", "shipping", "fees", "validAdjustments"],
  subtractive: ["appliedPayments", "componentizedCredits", "approvedWriteOffs", "refundsReversals"],
  // These are part of the balance owed but are NEVER revenue.
  includedNonRevenueComponents: ["tax", "shipping", "fees"],
  // The balance owed is never labeled or summed as a revenue figure.
  isRevenue: false,
  // Cancelled/voided invoices contribute nothing to the balance.
  excludedFromBalance: ["cancelledInvoices", "voidedInvoices"],
};

// Per-family definitions -- labels, date basis, boundaries, and (Family 1 only)
// the component policy. DEFINITION ONLY; nothing here is computed.
export const FORECAST_FAMILIES = {
  [FORECAST_FAMILY.RECEIVABLES]: {
    key: FORECAST_FAMILY.RECEIVABLES,
    label: "Receivables",
    // Each a distinct, separately-labeled figure -- never conflated. The
    // due-date aging is `Receivables Due`, distinct from actual `Cash
    // Collected` and current `Outstanding Receivables`.
    metricLabels: ["Cash Collected", "Outstanding Receivables", RECEIVABLES_DUE_LABEL],
    agingLabel: RECEIVABLES_DUE_LABEL,
    reservedLabel: PROJECTED_COLLECTIONS_RESERVED_LABEL,
    dateBasis: "each invoice's snapshotted due date",
    boundaries: FORECAST_HORIZON_BOUNDARIES,
    componentPolicy: RECEIVABLES_COMPONENT_POLICY,
  },
  [FORECAST_FAMILY.PIPELINE_ORDER]: {
    key: FORECAST_FAMILY.PIPELINE_ORDER,
    label: "Pipeline / order",
    metricLabels: ["Open Pipeline", "Committed Backlog"],
    dateBasis: "expectedCloseDate (pipeline) / expected fulfillment date (backlog)",
    boundaries: FORECAST_HORIZON_BOUNDARIES,
    componentPolicy: null, // sourced from Sales Order / Opportunity -- not receivables
  },
};

// The ordered family list -- exactly two, always rendered separately.
export const FORECAST_FAMILY_ORDER = [FORECAST_FAMILY.RECEIVABLES, FORECAST_FAMILY.PIPELINE_ORDER];

// The only provider state reachable in production today.
export const PRODUCTION_FORECAST_STATE = { status: FINANCIAL_PROVIDER_STATE.UNCONFIGURED };

// state -> render descriptor for a forecast-horizon family. Reuses the merged
// five-state message mapping (financialSummaryView) for the contract's
// message states (loading/error/stale/unconfigured), but this surface has NO
// metrics/bucketing/figure path: a status that financialSummaryView would turn
// into a `metrics` kind (partial/complete) is UNREACHABLE here and is coerced
// to `unconfigured`, because no provider and no bucketing exist to produce a
// figure. There is therefore no reachable path to a real figure through this
// function -- it only ever yields a message state, never a dollar value.
export function forecastHorizonView(state = PRODUCTION_FORECAST_STATE) {
  const view = financialSummaryView(state);
  if (view.kind === "metrics") {
    // No figure path exists in this initiative -- never render a figure/$0.
    return { kind: "message", tone: "muted", text: UNCONFIGURED_COPY };
  }
  return view;
}
