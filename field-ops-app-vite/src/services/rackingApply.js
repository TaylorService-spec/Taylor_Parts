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

// ════════════════════ THE EOS BATCH APPLY (Firebase exit B3; Owner ruling 5) ════════════════════
//
// On EOS the server applies a chunk of bins itself (createBins): ONE BIN PER TRANSACTION, never one transaction for the chunk, and it answers
// per item -- CREATED, UNCHANGED (an exact replay) or REFUSED with its classification and reason. The behaviour above is preserved, not redesigned:
// partial success is normal, nothing aborts the remaining work, there is no aggregate verdict, and a retry is per bin UNCHANGED.
//
// A request that does NOT finish (the network drops after the server began) is reported as failed rows whose outcome is UNKNOWN -- never as
// success, and never as "nothing happened": the screen re-reads the bins and re-previews afterwards, which is the registry's answer either way.
export const BATCH_CHUNK = 250;

const REFUSAL_WORDS = Object.freeze({
  POSITION_TAKEN: "That rack position already belongs to another bin.",
  CODE_RESERVED: "Another bin already holds, or once held, this code.",
  INTEGRITY_ERROR: "The stored record is inconsistent; it was left alone.",
  INVALID: "The registry refused this location.",
});
const refusalWords = (item) => `${REFUSAL_WORDS[item.classification] ?? "That bin could not be created."}${item.reason ? ` (${item.reason})` : ""}`;

export async function applyProposalsBatched({ rows, createBins, warehouseId, reason, chunkSize = BATCH_CHUNK }) {
  const results = [];
  for (let at = 0; at < rows.length; at += chunkSize) {
    const group = rows.slice(at, at + chunkSize);
    const failedAll = (message) => group.map((row) => ({ idempotencyKey: row.request.idempotencyKey, outcome: "failed", code: null, binId: null, error: message }));
    try {
      const res = await createBins({ warehouseId, proposals: group.map((row) => row.request), reason });
      const items = Array.isArray(res?.items) ? res.items : null;
      if (items === null) { results.push(...failedAll("The registry's answer could not be read, so the outcome is unknown. Preview again to see what exists.")); continue; }
      const byIndex = new Map(items.map((item) => [item.index, item]));
      group.forEach((row, index) => {
        const item = byIndex.get(index);
        const base = { idempotencyKey: row.request.idempotencyKey, code: item?.code ?? null, binId: item?.binId ?? null };
        if (!item) results.push({ ...base, outcome: "failed", error: "The registry did not answer for this bin, so its outcome is unknown." });
        else if (item.outcome === "CREATED") results.push({ ...base, outcome: "created", error: null });
        else if (item.outcome === "UNCHANGED") results.push({ ...base, outcome: "unchanged", error: null });
        else results.push({ ...base, outcome: "failed", error: refusalWords(item) });
      });
    } catch (err) {
      // A refusal of the whole request (no authority, no reason, a warehouse outside the caller's companies) names itself; anything else is unknown.
      const refused = err?.code === "FORBIDDEN" || err?.code === "INVALID_INPUT" || err?.code === "NOT_FOUND" || err?.code === "CONFLICT";
      results.push(...failedAll(refused ? (err?.message || "The request was refused.")
        : "The request did not finish, so each bin's outcome is unknown. Preview again to see what exists."));
    }
  }
  return results;
}

/** A count per outcome, for a summary line that is derived rather than asserted. */
export function summarizeApply(results) {
  return results.reduce(
    (acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }),
    { created: 0, unchanged: 0, failed: 0 },
  );
}
