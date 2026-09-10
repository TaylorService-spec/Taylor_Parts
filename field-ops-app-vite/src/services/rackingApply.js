// APPLYING A RACKING PLAN — one governed createBin per proposed bin, a few at a time.
//
// There is deliberately NO bulk callable. `createBin` is the single governed create, one transaction
// per bin, and a batch endpoint would be a second write authority with its own atomicity story. The
// cost of that choice is N round trips, which is what this runner manages.
//
// PARTIAL SUCCESS IS THE NORMAL OUTCOME, not an error state. Bin 40 hitting a reserved code says
// nothing about bins 1-39, which are created and correct. The runner therefore never aborts the
// remaining work on a failure and never reports an aggregate verdict: every row comes back with its
// own outcome, and the screen shows them per row.
//
// Concurrency is bounded because an operator generating three aisles can propose several hundred
// bins, and firing them all at once is a self-inflicted burst against per-document transactions.
// Four is empirical breathing room, not a tuned number.
// ponytail: fixed width; make it adaptive only if a real layout measurably drags.

import { runBounded } from "../domain/boundedRun.js";

export const APPLY_CONCURRENCY = 4;

/**
 * Create every proposed bin, bounded, preserving input order in the results.
 *
 * `createBin` is injected so this is testable without Firebase and so the screen can pass the same
 * governed client it uses everywhere else.
 */
export async function applyProposals({ rows, createBin, concurrency = APPLY_CONCURRENCY }) {
  // The bounded runner is shared with the BIN-P6 movement session (domain/boundedRun.js).
  return runBounded(rows, async (row) => {
    try {
      const response = await createBin(row.request);
      return {
        idempotencyKey: row.request.idempotencyKey,
        // `unchanged` is a SUCCESS: the bin the operator asked for exists and is the one they
        // meant. Reporting a replay as a failure would push people into re-running work that is
        // already done.
        outcome: response?.outcome === "unchanged" ? "unchanged" : "created",
        code: response?.code ?? null,
        binId: response?.binId ?? null,
        error: null,
      };
    } catch (err) {
      return {
        idempotencyKey: row.request.idempotencyKey,
        outcome: "failed",
        code: null,
        binId: null,
        // The server's sanitized message. Nothing is invented here, and a failure is never
        // rendered as a success.
        error: err?.message || "That bin could not be created.",
      };
    }
  }, concurrency);
}

/** A count per outcome, for a summary line that is derived rather than asserted. */
export function summarizeApply(results) {
  return results.reduce(
    (acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }),
    { created: 0, unchanged: 0, failed: 0 },
  );
}
