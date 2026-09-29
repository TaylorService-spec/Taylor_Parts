import { useCallback } from "react";

/**
 * Complete Account portfolio counts, from the governed aggregate read.
 *
 * The Customers headline numbers are claims about the whole book of business, so they
 * come from `getAccountPortfolioSummary` — a server-side count over the complete scope —
 * and never from the rows currently on screen. A total computed from a page is smaller
 * than the truth while still being labelled "Total", which is a worse failure than the
 * unbounded client subscription it replaces: that one was merely slow.
 *
 * There is deliberately no pageSize, cursor, or filter argument. An aggregate that
 * accepted a bound would be able to produce a partial number under a complete name.
 *
 * DENIED AND UNAVAILABLE STAY SEPARATE, for the same reason they do everywhere else in
 * this program: a surface that renders "—" for both tells someone their data is missing
 * when the real answer is that they may not see it.
 */
export function useAccountPortfolioSummary({ enabled = true } = {}) {
  // CRM CUTOVER: the whole-book counts came from a Firebase callable over the retired Firestore `accounts` collection,
  // which no longer holds the book of business. No PostgreSQL CRM aggregate exists yet, so the counts are UNAVAILABLE
  // (rendered as a dash, never a zero) rather than a number about the wrong data.
  const retry = useCallback(() => undefined, []);
  return { summary: null, state: enabled ? "UNAVAILABLE" : "IDLE", retry };
}
