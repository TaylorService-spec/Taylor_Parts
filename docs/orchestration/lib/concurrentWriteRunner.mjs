// Concurrent-write RUNNER — turns the Agent Manager's planning smarts into live parallelism WITHOUT breaking
// the single-worker EOS runtime (this is a NEW, additive module; runIntakeExecution/executeWake are untouched).
//
// It drains a set of approved WRITE items through the manager's own decisions:
//   • planConcurrentWriteSectors → WAVES of pairwise-disjoint file-sets. Every item in a wave writes a
//     different sector, so the whole wave is safe to run at once; later waves (which may overlap earlier
//     ones) are serialized AFTER their predecessor drains. This is the structural anti-fratricide guard.
//   • a per-request atomic CLAIM (injected claimFactory → makeRequestClaim) so two workers SHARING the same
//     lock filesystem can never grab the same item. NOTE: this excludes duplicates among workers that share the
//     `lockRoot` volume (the current single self-hosted runtime, or a shared/durable volume) — it is NOT
//     distributed locking; two hosts on independent local disks do not exclude each other (see makeRequestClaim).
//   • REVALIDATE before write (injected) — the serial model's freshness guard applied per item: rebase on
//     latest main + re-check the finding still applies, so a wave-mate's merge can't make a stale write land.
//   • adaptConcurrency (AIMD) reading detectThrottle across each batch's outcomes — the number of workers fired
//     at once shrinks on a throttle signal and grows back on a sustained clear streak. The manager "learns to
//     read for system throttling" and self-tunes the fire rate.
//
// PURE of real I/O: the worker (real Claude spawn in an isolated worktree), the claim (file lease), and the
// revalidate step are ALL injected. In tests they are fakes; in production the caller wires the real spawn.
// The runner never throws for a worker failure — a throwing/failed worker becomes a recorded outcome so the
// wave keeps draining and the batch can still read throttling. Nothing here merges: workers PRODUCE writes;
// integration stays governed and serial downstream.

import { planConcurrentWriteSectors, adaptConcurrency, detectThrottle } from "./agentManager.mjs";

/**
 * @param {object}   opts
 * @param {Array}    opts.items         approved WRITE items: [{ requestId, paths:[...], ... }]
 * @param {Function} opts.runWorker     async (item) => outcome — spawns the real writer in an isolated worktree
 * @param {Function} opts.claimFactory  (requestId) => lease-like { acquire(), release() } (per-request claim)
 * @param {Function} [opts.revalidate]  (item) => { stillApplies:boolean, reason? } — rebase+recheck before write
 * @param {number}   [opts.minConcurrency=1]
 * @param {number}   [opts.maxConcurrency=4]
 * @param {number}   [opts.growAfter=3]  clear batches before additive grow
 * @returns {Promise<{waves:number, finalConcurrency:number, results:Array<{requestId, disposition, outcome}>}>}
 */
export async function runConcurrentWrites({
  items = [],
  runWorker,
  claimFactory,
  revalidate = () => ({ stillApplies: true }),
  minConcurrency = 1,
  maxConcurrency = 4,
  growAfter = 3,
} = {}) {
  if (typeof runWorker !== "function") throw new Error("runConcurrentWrites: runWorker is required");
  if (typeof claimFactory !== "function") throw new Error("runConcurrentWrites: claimFactory is required");

  const waves = planConcurrentWriteSectors(items);
  const results = [];
  let concurrency = Math.max(1, Math.floor(minConcurrency));
  let clearStreak = 0;

  // Process one item end-to-end: claim → revalidate → write → release. Never throws (a failure is an outcome),
  // so one bad item can't sink its batch or abort the wave. Always releases the claim it acquired.
  const processItem = async (item) => {
    const requestId = item?.requestId;
    let claim = null;
    try {
      claim = claimFactory(requestId);
    } catch (e) {
      return { requestId, disposition: "SKIPPED_INVALID_CLAIM", outcome: { error: String(e && e.message || e) } };
    }
    let acq;
    try { acq = claim.acquire(); } catch (e) { acq = { acquired: false, reason: String(e && e.message || e) }; }
    if (!acq || acq.acquired !== true) {
      // Another worker already holds this item — not our work to do, not a failure.
      return { requestId, disposition: "SKIPPED_CLAIM_HELD", outcome: { reason: acq && acq.reason || "held" } };
    }
    try {
      let check;
      try { check = revalidate(item); } catch (e) { check = { stillApplies: false, reason: String(e && e.message || e) }; }
      if (!check || check.stillApplies !== true) {
        // The finding no longer applies after rebasing on latest main — skip the stale write (freshness guard).
        return { requestId, disposition: "SKIPPED_STALE", outcome: { reason: check && check.reason || "revalidation failed" } };
      }
      let outcome;
      try { outcome = await runWorker(item); } catch (e) { outcome = { error: String(e && e.message || e), failed: true }; }
      const disposition = outcome && outcome.failed ? "WORKER_FAILED" : "WORKER_DONE";
      return { requestId, disposition, outcome: outcome || {} };
    } finally {
      try { claim.release(); } catch { /* best-effort release; a stale lock self-reclaims via the lease */ }
    }
  };

  for (const wave of waves) {
    // Every item in `wave` is pairwise-disjoint, so the ONLY reason to cap parallelism here is
    // throughput/throttling — drain the wave in batches of the current adaptive concurrency.
    for (let i = 0; i < wave.length; i += concurrency) {
      const batch = wave.slice(i, i + concurrency);
      const settled = await Promise.all(batch.map(processItem));
      results.push(...settled);
      // Read throttling across the batch's outcomes and self-tune concurrency for the next batch/wave.
      const throttled = settled.some((s) => detectThrottle(s.outcome || {}).throttled);
      clearStreak = throttled ? 0 : clearStreak + 1;
      const next = adaptConcurrency({ current: concurrency, min: minConcurrency, max: maxConcurrency, throttle: throttled, clearStreak, growAfter });
      concurrency = next.concurrency;
    }
  }

  return Object.freeze({ waves: waves.length, finalConcurrency: concurrency, results: Object.freeze(results) });
}
