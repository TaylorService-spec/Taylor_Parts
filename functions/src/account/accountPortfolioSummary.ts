// Account portfolio summary — a governed AGGREGATE read.
//
// The Customers page shows five headline numbers: total, active, prospect, inactive,
// archived. They are claims about the whole book of business, not about the rows
// currently on screen, and the Owner ruling keeps them as such.
//
// THIS IS AN AGGREGATE CONTRACT, NOT A LIST CONTRACT. The distinction is the entire
// reason this module exists separately from the list runtime. A list may honestly return
// a page and say so. A total may not: bounding the input to an aggregate produces a
// number that is smaller than the truth while still being labelled "Total", which is
// worse than the unbounded read it replaces — that one was merely slow.
//
// So there is no cursor here, no pageSize, and no limit. Counting is done by Firestore's
// server-side count() aggregation over the complete declared scope, which reads no
// documents into this process and none into the browser.
//
// STATUS INTEGRITY (ruling §5). Canonical status values are uppercase, and a production
// audit of legacy title-cased Account statuses is still open and unauthorized to fix.
// This module must not quietly assume those records are absent. It does not count them
// by guessing: it counts the total independently of the per-status counts, and reports
// the difference as `unclassified`. A record whose status is "Active", or missing, or
// anything else the enum does not know, therefore shows up as a number a reader can see
// rather than silently vanishing from a total that still calls itself complete.
//
// NOT MATERIALIZED (ruling §3). No trigger-maintained counters. Complete server-side
// aggregation is tried first; a governed materialized projection stays a future option
// if scale, latency or cost ever justify it, and nothing here forecloses that.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";

export const ACCOUNTS_COLLECTION = "accounts";

/**
 * The canonical Account read authority.
 *
 * Deliberately the SAME capability the record read uses, rather than a new one. A
 * summary of accounts is accounts: inventing `account.portfolio.read` would create a
 * second audience for the same data, and the two would drift the first time somebody
 * granted one without the other.
 */
export const ACCOUNT_PORTFOLIO_READ_CAPABILITY = "account.record.read";

/** Canonical machine status values. Uppercase; never a display label. */
export const ACCOUNT_STATUS_VALUES = ["ACTIVE", "PROSPECT", "INACTIVE", "ARCHIVED"] as const;
export type AccountStatusValue = (typeof ACCOUNT_STATUS_VALUES)[number];

export interface AccountPortfolioSummary {
  /** Complete count over the authorized scope. Never a page, never a sample. */
  total: number;
  /** Complete count per canonical status. */
  byStatus: Record<AccountStatusValue, number>;
  /**
   * Records counted in `total` whose status matched no canonical value.
   *
   * Derived by subtraction from independently-counted totals, so it cannot be defeated
   * by a value nobody predicted. Non-zero means the per-status numbers do not add up to
   * the book of business, and a surface must say so rather than presenting four
   * categories as if they were all of it.
   */
  unclassified: number;
}

/**
 * Assemble the summary from independently-obtained complete counts.
 *
 * Pure, so the arithmetic that makes `unclassified` meaningful is testable without
 * Firestore. `total` is NOT derived by summing the statuses — deriving it that way would
 * make the two agree by construction and destroy the only signal that says a record is
 * unaccounted for.
 */
export function assembleSummary(total: number, statusCounts: Record<string, number>): AccountPortfolioSummary {
  const byStatus = {} as Record<AccountStatusValue, number>;
  let classified = 0;
  for (const status of ACCOUNT_STATUS_VALUES) {
    const count = statusCounts[status] ?? 0;
    byStatus[status] = count;
    classified += count;
  }
  return {
    total,
    byStatus,
    // Clamped at zero: a negative would mean the counts were read at different instants
    // and the collection shrank between them, which is a racing snapshot rather than a
    // fact about the data, and reporting "-2 unclassified" would be nonsense.
    unclassified: Math.max(0, total - classified),
  };
}

/** Complete counts, straight from Firestore's aggregation service. */
export async function readPortfolioSummary(db: FirebaseFirestore.Firestore): Promise<AccountPortfolioSummary> {
  const accounts = db.collection(ACCOUNTS_COLLECTION);

  // count() runs server-side and returns a number, not documents. That is what makes a
  // complete total affordable at 250,000 accounts without any client owning the dataset.
  const [totalSnap, ...statusSnaps] = await Promise.all([
    accounts.count().get(),
    ...ACCOUNT_STATUS_VALUES.map((status) => accounts.where("status", "==", status).count().get()),
  ]);

  const statusCounts: Record<string, number> = {};
  ACCOUNT_STATUS_VALUES.forEach((status, i) => {
    statusCounts[status] = statusSnaps[i].data().count;
  });

  return assembleSummary(totalSnap.data().count, statusCounts);
}

export const getAccountPortfolioSummary = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  // Fail closed on resolver error, matching every sibling governed read: an authority
  // service that is down must deny, not default to allowing a read of the whole book.
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [ACCOUNT_PORTFOLIO_READ_CAPABILITY],
    });
    allowed = decisions[ACCOUNT_PORTFOLIO_READ_CAPABILITY] === true;
  } catch (err) {
    console.error(`[getAccountPortfolioSummary] capability resolution failed for ${ACCOUNT_PORTFOLIO_READ_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "Not authorized to read customers.");

  return { summary: await readPortfolioSummary(getFirestore()) };
});
