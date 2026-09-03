// DASHBOARD GOAL ACTUALS -- pairing each governed target with the actual its OWN domain produced.
//
// ============================ THE INVARIANT THIS FILE SERVES ============================
//
//     DOMAIN AUTHORITY OWNS THE ACTUAL.
//     PERFORMANCE GOAL AUTHORITY OWNS THE TARGET.
//     THE DASHBOARD COMPARES THEM.
//
// So this file computes NOTHING. It receives outputs that domain authorities have already produced --
// the work-order attention projection's grouped sections, the account portfolio aggregate -- and maps
// them onto the goal scopes they answer for. Reading `items.length` from a list the projection built
// is the same act `ServiceAttentionModule` already performs to render that number; deriving the list
// is the domain's job and stays there.
//
// If this file ever grows a query, a filter, a sum over rows, or a date comparison, the invariant has
// been broken and the dashboard has become a second implementation of domain logic.
//
// ============================ WHY SCOPE IS PART OF THE ANSWER, NOT AN AFTERTHOUGHT ============
//
// An actual is only an answer to a goal at the SAME scope. `service.workOrder.pastDue.count` measured
// across the whole governed work-order collection answers a FIRM goal and answers nothing else -- the
// identical number against a LOCATION goal would silently report firm-wide work as one warehouse's.
// So every entry here carries its `targetScopeType`/`targetScopeId`, and a caller matching only on
// metricId would have to discard that on purpose.
//
// ============================ AND WHY MOST METRICS ARE ABSENT ============================
//
// Twelve metrics are active for goals. Four have a COMPLETE governed read reachable from this
// surface. The rest are named in GOAL_ACTUAL_BLOCKER with the specific reason -- a bounded read that
// cannot produce a total, a scope this surface does not hold, an input it deliberately refuses to
// guess. "Not connected yet" for all of them was true and useless; a reader could not tell which were
// engineering debt and which were governance boundaries.
//
// PURE. No fetch, no clock, no React.

/**
 * The attention projection's section label for each service metric.
 *
 * Keyed by label because that is what `groupWorkOrderAttentionItemsBySection` returns. The labels are
 * `WO_ATTENTION_SECTION_ORDER`'s, and a rename there without a change here shows up as a missing
 * actual -- NO_ACTUAL with its reason -- never as a wrong number.
 */
const SERVICE_METRIC_BY_SECTION_LABEL = Object.freeze({
  "Past Due": "service.workOrder.pastDue.count",
  "Ready to Schedule": "service.workOrder.readyToSchedule.count",
  "Scheduling Conflict": "service.workOrder.schedulingConflict.count",
  // "Parts Blocked" is deliberately ABSENT. The projection only emits it when the caller supplies a
  // parts-readiness input, which this dashboard does not hold; a zero here would be indistinguishable
  // from "nothing is blocked", which is a claim rather than an absence. See GOAL_ACTUAL_BLOCKER.
});

/**
 * Why an active metric has no actual on THIS surface, in the reader's words.
 *
 * One sentence each, naming the actual obstruction. These are rendered verbatim on the goal tile
 * beside a real target, so "this measurement is not connected yet" is not good enough: it describes
 * every one of them and distinguishes none.
 */
export const GOAL_ACTUAL_BLOCKER = Object.freeze({
  "service.workOrder.partsBlocked.count":
    "Parts-blocked work needs a parts-readiness answer for every job, which this dashboard does not hold. Counting only the jobs it can see would report fewer blocked jobs than there are.",
  "technician.workOrder.completed.cumulative.count":
    "Your all-time completed count is measured on the technician screen, against your own technician identity. This dashboard does not resolve that binding.",
  "technician.workOrder.open.count":
    "Open assigned work is read on the technician screen, and that read returns at most the first 100 jobs — enough to work from, not enough to count.",
  "sales.billed.amount":
    "Billed is a period total. The financial fact read returns a bounded page rather than a period sum, so a complete figure for the period cannot be stated yet.",
  "sales.collected.amount":
    "Collected is a period total. The financial fact read returns a bounded page rather than a period sum, so a complete figure for the period cannot be stated yet.",
  "parts.reorderRequest.open.count":
    "The reorder queue is read a page at a time for working through. No complete open count over your locations exists yet.",
  "receiving.purchaseOrder.receivable.count":
    "Receivable purchase orders are read as a working list rather than a count, so the number awaiting receipt cannot be stated completely yet.",
  "purchasing.purchaseOrder.open.count":
    "Open purchase orders are read as a working list rather than a count, so a complete open total cannot be stated yet.",
});

/** The one sentence used when a metric has no entry of its own. Should never be reached in practice. */
export const GOAL_ACTUAL_BLOCKER_DEFAULT =
  "This measurement is not connected to the dashboard yet.";

/**
 * Every actual this surface can state, with the scope it answers for.
 *
 * @param attentionSections `groupWorkOrderAttentionItemsBySection(...)` output, or null when the
 *        work-order read did not resolve. NULL IS NOT ZERO: a denied or still-loading read yields no
 *        entries at all, so the tile shows its target and says the measurement is missing.
 * @param portfolio the `getAccountPortfolioSummary` summary, or null.
 *
 * @returns `[{ metricId, targetScopeType, targetScopeId, value }]` -- only entries whose value is a
 *          real number over a COMPLETE governed read.
 */
export function dashboardGoalActuals({ attentionSections = null, portfolio = null } = {}) {
  const entries = [];

  // -- service work-order counts, FIRM scope ------------------------------------------------------
  //
  // Complete by construction: the projection runs over `subscribeToWorkOrders`, an unbounded
  // subscription to the governed collection, so a section's length is the whole of that signal within
  // the viewer's Rules-enforced reach. An empty section is omitted by the grouping, which is why zero
  // is stated explicitly below rather than inferred from absence -- a section missing because nothing
  // matched and a section missing because the read failed must not produce the same number.
  if (Array.isArray(attentionSections)) {
    const lengthByLabel = new Map(
      attentionSections
        .filter((s) => s && typeof s.sectionLabel === "string" && Array.isArray(s.items))
        .map((s) => [s.sectionLabel, s.items.length]),
    );
    for (const [label, metricId] of Object.entries(SERVICE_METRIC_BY_SECTION_LABEL)) {
      entries.push({
        metricId,
        targetScopeType: "FIRM",
        targetScopeId: null,
        // The read resolved, so a signal with no items is a CONFIRMED zero, not an unknown.
        value: lengthByLabel.get(label) ?? 0,
      });
    }
  }

  // -- active accounts, FIRM scope ----------------------------------------------------------------
  //
  // `getAccountPortfolioSummary` is a server-side count over the complete authorized scope and takes
  // no bound by design -- "an aggregate that accepted a bound would be able to produce a partial
  // number under a complete name". That is exactly the property a goal actual requires.
  if (portfolio && typeof portfolio.active === "number" && Number.isFinite(portfolio.active)) {
    entries.push({
      metricId: "crm.account.active.count",
      targetScopeType: "FIRM",
      targetScopeId: null,
      value: portfolio.active,
    });
  }

  return entries;
}

/**
 * Index the entries by the goal key a caller already uses.
 *
 * `keyFor` is injected rather than imported so this module stays free of the hooks layer; callers
 * pass `goalKey` from usePerformanceGoals, which is the only key format the feed understands.
 */
export function actualsByGoalKey(entries, keyFor) {
  const out = Object.create(null);
  for (const e of entries ?? []) {
    out[keyFor(e.metricId, e.targetScopeType, e.targetScopeId)] = e.value;
  }
  return out;
}
