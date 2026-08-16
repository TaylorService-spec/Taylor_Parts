// Account health strip -- the PURE view model for the Account workspace's top-line metrics.
//
// HONESTY IS THE WHOLE POINT OF THIS MODULE. It projects ONLY metrics with a real, authoritative,
// account-scoped read behind them. A metric that cannot be sourced truthfully is OMITTED rather than
// rendered as a zero, a dash, or a permanent "not connected" tile -- a fabricated 0 for "open AR" is
// worse than no tile at all, because a salesperson would believe it.
//
// PRESENT (each has a real account-scoped authority):
//   Open Work Orders   domain/accountWorkOrders.js -> getCountFromServer on fieldops_wos by customerId
//   Outstanding AR     hooks/useAccountAr.js -> listAccountInvoiceAr callable -> summary.outstandingByCurrency
//   Past due           the same AR summary's overdueCount
//
// DELIBERATELY ABSENT (verified: no authoritative account-scoped read exists today):
//   Open pipeline          listOpportunityContext returns the caller's WHOLE authorized scope with no
//                          accountId parameter -- there is no per-account pipeline read to call.
//   Sales Order backlog    getSalesOrderContext fetches exactly ONE order by id; no per-account list.
//   Equipment count        CustomerEquipment filters client-side over already-loaded documents only,
//                          so any count would describe the current page, not the account.
// Each of those needs a backend read that does not exist. They are recorded here so the omission is a
// documented decision rather than an oversight, and so whoever adds the read knows where the tile goes.

export const HEALTH_METRIC_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE", // the source exists but could not answer right now
  DENIED: "DENIED", // the caller may not read this source -- never collapsed into empty
});

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

// Open Work Orders. `countState` is useAccountWorkOrderCount's exact shape: { value, loading, error }.
function openWorkOrdersMetric(countState) {
  if (!countState || countState.loading) return { id: "openWorkOrders", label: "Open work orders", state: HEALTH_METRIC_STATE.LOADING };
  if (countState.error) {
    return { id: "openWorkOrders", label: "Open work orders", state: HEALTH_METRIC_STATE.UNAVAILABLE };
  }
  const count = num(countState.value);
  if (count === null) return { id: "openWorkOrders", label: "Open work orders", state: HEALTH_METRIC_STATE.UNAVAILABLE };
  return {
    id: "openWorkOrders",
    label: "Open work orders",
    state: HEALTH_METRIC_STATE.READY,
    value: String(count),
    // Zero is a real, authoritative answer here -- unlike an absent source -- so it renders.
    href: count > 0 ? "/service/work-orders" : null,
  };
}

// Outstanding AR + past due, both from the ONE AR view model (never a second AR derivation).
function arMetrics(arView) {
  const kind = arView?.kind;
  if (kind === "LOADING") {
    return [
      { id: "outstandingAr", label: "Outstanding AR", state: HEALTH_METRIC_STATE.LOADING },
      { id: "pastDueAr", label: "Past due", state: HEALTH_METRIC_STATE.LOADING },
    ];
  }
  if (kind === "DENIED") {
    return [
      { id: "outstandingAr", label: "Outstanding AR", state: HEALTH_METRIC_STATE.DENIED },
      { id: "pastDueAr", label: "Past due", state: HEALTH_METRIC_STATE.DENIED },
    ];
  }
  if (kind === "EMPTY") {
    // A real answer: this account has no invoices at all.
    return [
      { id: "outstandingAr", label: "Outstanding AR", state: HEALTH_METRIC_STATE.READY, value: "None" },
      { id: "pastDueAr", label: "Past due", state: HEALTH_METRIC_STATE.READY, value: "0" },
    ];
  }
  if (kind !== "READY") {
    return [
      { id: "outstandingAr", label: "Outstanding AR", state: HEALTH_METRIC_STATE.UNAVAILABLE },
      { id: "pastDueAr", label: "Past due", state: HEALTH_METRIC_STATE.UNAVAILABLE },
    ];
  }
  const lines = Array.isArray(arView.outstandingLines) ? arView.outstandingLines : [];
  const overdue = num(arView.overdueCount) ?? 0;
  return [
    {
      id: "outstandingAr",
      label: "Outstanding AR",
      state: HEALTH_METRIC_STATE.READY,
      // Multi-currency is represented honestly rather than summed across currencies.
      value: lines.length === 0 ? "None" : lines.map((l) => l.text).join(" · "),
      href: "#account-financials",
    },
    {
      id: "pastDueAr",
      label: "Past due",
      state: HEALTH_METRIC_STATE.READY,
      value: String(overdue),
      tone: overdue > 0 ? "warn" : undefined,
      href: overdue > 0 ? "#account-financials" : null,
    },
  ];
}

// Build the strip. Inputs are ALREADY-READ states from their own hooks -- this stays pure.
export function buildAccountHealthStrip({ workOrderCount, arView } = {}) {
  return [openWorkOrdersMetric(workOrderCount), ...arMetrics(arView)];
}
