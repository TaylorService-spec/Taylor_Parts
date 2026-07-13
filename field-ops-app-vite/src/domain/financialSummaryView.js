// Customer/Account Business Model -- Customer PR 4, Financial Summary
// (docs/specifications/customer-account-business-model.md;
// docs/architecture/enterprise-business-metrics-framework.md Section 17).
//
// PURE render-decision layer for the provider-neutral Financial Summary
// surface -- no Firebase import, unit-testable in Node. The surface is built
// to the Framework's FULL five-state provider contract
// (complete/partial/stale/error/unconfigured), but in this phase ONLY
// `unconfigured` is reachable in production: no financial provider (external
// or governed local ledger) is connected, so the surface renders the exact
// copy below and NO dollar figure, $0, Work Order count, procurement figure,
// or any financial data. The other four states exist so the surface is
// complete against the contract and are exercised by fixtures in
// test/financialSummaryView.test.mjs -- connecting a real provider is a
// separate future initiative.

export const FINANCIAL_PROVIDER_STATE = {
  UNCONFIGURED: "unconfigured",
  ERROR: "error",
  STALE: "stale",
  PARTIAL: "partial",
  COMPLETE: "complete",
};

// The canonical financial metric names (Framework Section 4). The surface
// uses ONLY these -- never a bare "Sales"/"Pending" label, never "revenue"
// as a bare word. Work Order counts are NOT here (they are operational
// activity, rendered under Service Activity, never Financial Summary).
export const CANONICAL_FINANCIAL_METRICS = [
  "Open Pipeline",
  "Quoted Value",
  "Booked Value",
  "Committed Backlog",
  "Invoiced Net Sales",
  "Cash Collected",
  "Credited Net Sales",
];

// Exact production copy for the only state reachable today (Framework
// Section 17 / Section 20). Never $0 -- $0 would read as a known true zero.
// Exact strings from the Framework (Section 17/20) and the merged
// Specification -- no trailing period, matching those authoritative sources.
export const UNCONFIGURED_COPY = "Sales data source not connected";
export const ERROR_COPY = "Sales data temporarily unavailable";
export const LOADING_COPY = "Loading financial summary…";

// state -> render descriptor. Never fabricates a value; an unknown/missing
// status falls back to `unconfigured` (never to a $0 or a blank).
export function financialSummaryView(state) {
  const status = state && state.status;

  if (status === "loading") {
    return { kind: "loading", text: LOADING_COPY };
  }
  if (status === FINANCIAL_PROVIDER_STATE.ERROR) {
    return { kind: "message", tone: "warning", text: ERROR_COPY };
  }
  if (status === FINANCIAL_PROVIDER_STATE.STALE) {
    const asOf = state.asOf ?? "an earlier time";
    return { kind: "message", tone: "warning", text: `Sales data may be stale as of ${asOf}` };
  }
  if (status === FINANCIAL_PROVIDER_STATE.PARTIAL || status === FINANCIAL_PROVIDER_STATE.COMPLETE) {
    const partial = status === FINANCIAL_PROVIDER_STATE.PARTIAL;

    // Index provider-supplied data by CANONICAL metric name only -- any
    // noncanonical name is ignored entirely and never rendered as a financial
    // metric (Framework Section 4/18: an AI/provider metric that doesn't map
    // to a canonical definition is a defect, not something to display).
    const supplied = new Map();
    for (const m of state.metrics ?? []) {
      if (m && CANONICAL_FINANCIAL_METRICS.includes(m.name)) supplied.set(m.name, m);
    }

    // Build a row for EVERY canonical metric, always -- a metric absent from
    // the provider data (or explicitly marked unavailable) is disclosed as
    // unavailable, NEVER silently omitted (Framework Section 17).
    const rows = CANONICAL_FINANCIAL_METRICS.map((name) => {
      const m = supplied.get(name);
      if (!m || m.available === false) {
        const reason = m && m.unavailableReason ? ` — ${m.unavailableReason}` : "";
        return { name, available: false, text: `${name}: unavailable${reason}` };
      }
      // A legitimate, provider-supplied value (including a genuine $0 the
      // provider reports as complete) is rendered as-is, with a per-figure
      // partial warning when the overall state is partial.
      return { name, available: true, text: `${name}: ${m.value}${partial ? " (partial data)" : ""}` };
    });

    return {
      kind: "metrics",
      partial,
      asOf: state.asOf ?? null,
      footer: partial
        ? `Partial data${state.asOf ? ` as of ${state.asOf}` : ""}`
        : `Complete${state.asOf ? ` through ${state.asOf}` : ""}`,
      rows,
    };
  }

  // unconfigured (and any unknown status) -- the only reachable production
  // state today. Never a $0, never a blank section.
  return { kind: "message", tone: "muted", text: UNCONFIGURED_COPY };
}
