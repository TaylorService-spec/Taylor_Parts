// BOUNDED ACTIONABLE PREVIEWS -- Owner Decision #172.
//
// ============================ A LIST OF REAL WORK IS ALLOWED. ============================
// ============================ A TOTAL DERIVED FROM THAT LIST IS NOT. ====================
//
// Most current-work queues in this platform are governed WORKING LISTS: bounded, paginated, ordered
// by their domain's own rule, and read at that domain's own scope. None of them carries a complete
// count. The dashboard previously rendered every one of them as a blocker sentence pointing at the
// workspace where the real list lives, because the only figure a dashboard tile knew how to show was
// a number -- and a number taken from a page is a lie wearing a total's clothes.
//
// #172 settles it: the dashboard MAY show the ROWS. It may never show a count, a percentage, a rate,
// a share, a trend, or an "all clear" derived from them.
//
// This module is the gate that makes that difference structural rather than a matter of care. It
// deliberately has NO function that returns a length, and `hasMore` is a BOOLEAN -- there is nothing
// here to accidentally render as "7 reorder requests".
//
// ============================ THE THREE OUTCOMES ARE NOT TWO ============================
//
//   READY    the read resolved and returned rows. Show them.
//   EMPTY    the read resolved and ESTABLISHED there are none. "Nothing waiting" is a real claim
//            and is allowed here, because the read is what proved it.
//   UNKNOWN  the read failed, was denied, or has not resolved. NOT zero, NOT "all caught up".
//
// Collapsing EMPTY and UNKNOWN is the single most damaging thing this file could do: it would tell
// someone their queue is clear when the truth is that nobody could read it.
//
// PURE. No fetch, no clock, no React.

/**
 * Presentation limit, not a data limit and not a metric.
 *
 * Five rows is enough to see what is waiting and act on one. It is deliberately NOT configurable:
 * a paging system on a dashboard tile would make the tile a second list workspace, and the real one
 * is one click away.
 */
export const PREVIEW_ROW_LIMIT = 5;

export const PREVIEW_STATE = Object.freeze({
  READY: "READY",
  EMPTY: "EMPTY",
  UNKNOWN: "UNKNOWN",
});

/**
 * Build one preview from a domain's already-ordered, already-scoped rows.
 *
 * @param rows      the domain read's rows, IN ITS OWN CANONICAL ORDER. This function never sorts:
 *                  inventing a priority the domain did not define is exactly the "urgency score in
 *                  the dashboard" #172 forbids. Whatever order the workspace shows, this shows.
 * @param resolved  did the read actually answer? false -> UNKNOWN, whatever `rows` happens to be.
 * @param hasMore   OPTIONAL, and only when the READ ITSELF says more exist (e.g. it asked for
 *                  limit+1 and got it). When omitted, it is inferred ONLY from the rows overflowing
 *                  the presentation limit -- which proves more exist without claiming how many.
 * @param limit     presentation limit.
 *
 * @returns `{ state, rows, hasMore }`. No count, by construction.
 */
export function boundedPreview({ rows, resolved = true, hasMore = null, limit = PREVIEW_ROW_LIMIT } = {}) {
  if (!resolved || !Array.isArray(rows)) {
    // UNKNOWN carries no rows at all. Returning a partial list beside "could not read" would invite
    // a reader to treat what they can see as what there is.
    return { state: PREVIEW_STATE.UNKNOWN, rows: [], hasMore: false };
  }
  if (rows.length === 0) {
    return { state: PREVIEW_STATE.EMPTY, rows: [], hasMore: false };
  }
  const shown = rows.slice(0, limit);
  return {
    state: PREVIEW_STATE.READY,
    rows: shown,
    // `hasMore === true` from the read wins. Otherwise: more exist iff the domain handed us more than
    // we are showing. Both are proofs that MORE EXIST; neither is a claim about HOW MANY.
    hasMore: hasMore === true || rows.length > shown.length,
  };
}

/**
 * The href of a destination this principal can actually open, or null.
 *
 * Derived from `buildReachableGroups` -- the SAME function the Go To section and the nav rail use --
 * rather than from a hardcoded path. A dashboard that offers a door which does not open is the
 * defect this reuse exists to prevent: a plausible-looking URL previously fell through to Dashboard,
 * and nothing failed.
 *
 * Returning null means NO "View all" is rendered. #172: do not fabricate the CTA.
 */
export function reachableHref(groups, domainKey, itemKey) {
  for (const group of groups ?? []) {
    if (group?.domain?.key !== domainKey) continue;
    for (const item of group.items ?? []) {
      if (item?.key !== itemKey) continue;
      return item.path ? `/${group.domain.path}/${item.path}` : `/${group.domain.path}`;
    }
  }
  return null;
}
