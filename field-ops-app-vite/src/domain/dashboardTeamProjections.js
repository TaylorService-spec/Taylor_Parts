// TEAM PROJECTIONS -- work-order status breakdown and per-technician comparison.
//
// Both read the SAME governed work-order collection the dashboard already subscribes to for Service
// attention. No second listener, no second scope model: whatever Rules let this viewer see is
// exactly what these count, and a viewer who may see nothing gets no module rather than zeros.
//
// ============================ WHY THESE MAY SHOW COUNTS AT ALL ============================
//
// Decision #172 forbids a total derived from a bounded page. `subscribeToWorkOrders` is NOT bounded
// -- it is an unfiltered collection subscription, narrowed only by Firestore Rules -- so a count over
// its result is complete within the viewer's governed reach. That is a different thing from counting
// a page, and it is the only reason a number is permitted here.
//
// The gate is `resolved`. An unresolved read produces NO projection at all, never zeros.
//
// PURE. No fetch, no clock, no React.

/** A status we cannot read is not a status we can chart. Kept as its own bucket, never dropped. */
export const UNKNOWN_STATUS_LABEL = "Status not recorded";

/**
 * Work orders grouped by their ACTUAL stored status.
 *
 * Deliberately NOT past-due / conflict / completed-today. Those are PROJECTIONS over status plus
 * dates, they overlap each other, and mixing them into a "by status" chart would assert a mutual
 * exclusivity that does not hold -- one work order would be counted twice and the chart would total
 * more than the work. Those signals live in Service attention, which says in its own words that its
 * counts are independent and not a total.
 *
 * @returns `[{ status, count }]` sorted by count descending, then status, for stable rendering. An
 *          empty collection returns [] -- which the caller renders as a confirmed-empty state, not
 *          as a missing one.
 */
export function workOrdersByStatus(workOrders) {
  if (!Array.isArray(workOrders)) return null;
  const counts = new Map();
  for (const wo of workOrders) {
    const raw = wo?.status;
    // A missing or malformed status is its OWN bucket. Dropping those rows would make the chart
    // total fewer work orders than exist, and silently: the reader has no way to notice.
    const status = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : UNKNOWN_STATUS_LABEL;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status));
}

/**
 * Statuses that mean the work is finished. Everything else assigned to a technician is open.
 *
 * Read from the work orders themselves rather than hardcoded elsewhere: this list is the ONE place
 * the dashboard decides what "completed" means for the comparison, and it is deliberately narrow.
 */
const COMPLETED_STATUSES = new Set(["COMPLETED", "CLOSED", "VERIFIED"]);

/**
 * Per-technician comparison -- WITH ITS QUALITY SIDE VISIBLY MISSING.
 *
 * ============================ THIS IS NOT A LEADERBOARD ============================
 *
 * It does not rank, score, weight or colour anyone. The North Star's rule is that throughput alone
 * is not the whole of technician performance, and a table sorted by completed count IS a ranking
 * whatever the column headings say -- so rows come back in NAME order, and the quality measures the
 * platform does not have are returned as an explicit `qualityUnavailable` reason rather than being
 * left out. An absent column reads as "there is nothing more to know"; a reserved one reads as
 * "the platform knows this picture is incomplete", which is the truth.
 *
 * First-time fix, on-time completion and jobs-per-workday each need a business definition that does
 * not exist. None is invented here.
 *
 * @param workOrders  the governed collection.
 * @param resolveIdentity (technicianId) -> `{ state, name }` from resolveTechnicianIdentity. The
 *                    STATE is carried through, not flattened to a name: a technician id that does
 *                    not resolve is a DATA QUALITY fact about the Work Order, not a person called
 *                    "Unknown technician", and the screen must be able to say which it is looking at.
 * @returns `[{ technicianId, name, identityResolved, completed, open }]` in name order, or null.
 */
export function technicianComparison(workOrders, resolveIdentity) {
  if (!Array.isArray(workOrders)) return null;
  const byTech = new Map();
  for (const wo of workOrders) {
    const techId = typeof wo?.assignedTechId === "string" && wo.assignedTechId.length > 0 ? wo.assignedTechId : null;
    // UNASSIGNED WORK IS NOT A TECHNICIAN. It belongs in the status breakdown, not in a row that
    // would read as a person with a workload.
    if (!techId) continue;
    const row = byTech.get(techId) ?? { technicianId: techId, completed: 0, open: 0 };
    if (COMPLETED_STATUSES.has(String(wo?.status ?? "").toUpperCase())) row.completed += 1;
    else row.open += 1;
    byTech.set(techId, row);
  }
  return [...byTech.values()]
    .map((row) => {
      const identity = typeof resolveIdentity === "function" ? resolveIdentity(row.technicianId) : null;
      // "resolved" is the ONLY state that yields a person's name. Every other state -- unknown (the
      // Work Order names a technician id no technician record carries), error, loading, unset --
      // is a fact about the DATA, and the row is marked so the screen can present it as one.
      // Never the raw id: nobody can match a document key to a person.
      const resolved = identity?.state === "resolved" && typeof identity.name === "string" && identity.name.length > 0;
      return {
        ...row,
        identityResolved: resolved,
        name: resolved ? identity.name : TECHNICIAN_IDENTITY_UNAVAILABLE,
      };
    })
    // Unresolved rows sort last: they are data to fix, not people to compare.
    .sort((a, b) => (a.identityResolved === b.identityResolved ? a.name.localeCompare(b.name) : a.identityResolved ? -1 : 1));
}

/**
 * What a row says when the Work Order's technician id resolves to no technician record.
 *
 * NOT a name, and deliberately not "Unknown technician" -- that reads like a person whose name
 * happens to be missing, when the truth is that the Work Order points at a technician that does not
 * exist. The live dashboard showed two such rows sitting among real people.
 */
export const TECHNICIAN_IDENTITY_UNAVAILABLE = "Technician identity unavailable";

/** The reason the quality half of the comparison is empty. Rendered verbatim beside the table. */
export const TECHNICIAN_QUALITY_UNAVAILABLE =
  "On-time completion, first-time fix and jobs per workday are not measured. Each needs a business definition the platform does not have yet: what counts as on time, how a repeat visit is linked to its original, and what a workday is when a working schedule may be unrecorded.";
