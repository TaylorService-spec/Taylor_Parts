import { NAV_DOMAINS } from "./navConfig.js";

// WHERE AN OBJECT'S LIST LIVES — resolved from the nav config, never typed by hand.
//
// ============================ THE DEFECT THIS FIXES ============================
//
// `Back to Work Orders` navigated to `/service/work-orders`. That URL matches NOTHING: the Work
// Orders nav item declares `path: ""`, which makes it the INDEX route of `/service`. A path that
// matches no route falls through to the catch-all, which is the Dashboard — so a button labelled
// "Back to Work Orders" reliably went somewhere else.
//
// The label was telling the truth about intent and the code was not, which is the worst kind of
// navigation bug: nothing errors, and the user is simply somewhere they did not ask to be.
//
// ============================ WHY DERIVE RATHER THAN CORRECT ============================
//
// Changing the string to "/service" fixes today and breaks the next time a nav item moves. The nav
// config already holds the answer, so this reads it — a renamed path or a re-parented item follows
// automatically, and `objectListPath` throwing on an unknown key means a typo fails loudly at the
// call site rather than silently routing to a dashboard.
//
// ============================ NOT BROWSER HISTORY, DELIBERATELY ============================
//
// An explicit "Back to Work Orders" must go to Work Orders whether the record was opened from the
// list, from Dispatch, from a dashboard tile or from a pasted link. History would send the first
// case to the list and the rest somewhere arbitrary — the same control behaving four different ways.

/** Find the domain + item that own a nav key. */
function locate(itemKey) {
  for (const domain of NAV_DOMAINS) {
    for (const item of domain.subnav ?? []) {
      if (item.key === itemKey) return { domain, item };
    }
  }
  return null;
}

/**
 * The URL for an object's list.
 *
 * @throws when the key is unknown — a mistyped key must fail at the call site, not route to a
 *         plausible-looking wrong screen.
 */
export function objectListPath(itemKey) {
  const found = locate(itemKey);
  if (!found) throw new Error(`objectListPath: no nav item "${itemKey}"`);
  const { domain, item } = found;
  // An empty item path means the item IS the domain index -- which is exactly the case that was
  // being got wrong.
  return item.path ? `/${domain.path}/${item.path}` : `/${domain.path}`;
}

/**
 * The URL for an object's list INCLUDING a caller's saved list state.
 *
 * This is what makes "back to the list" return to the list somebody was actually looking at —
 * filters, sort and search intact — rather than a reset one.
 */
export function objectListPathWithState(itemKey, search = "") {
  const base = objectListPath(itemKey);
  const query = typeof search === "string" ? search.replace(/^\?/, "") : "";
  return query ? `${base}?${query}` : base;
}

/** The pilot objects' list keys, so a caller names an OBJECT rather than a route. */
export const OBJECT_LIST_KEY = Object.freeze({
  WORK_ORDERS: "workOrders",
  SALES_ORDERS: "salesOrders",
  EQUIPMENT: "equipment",
  CUSTOMERS: "customers",
});
