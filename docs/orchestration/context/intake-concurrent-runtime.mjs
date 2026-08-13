// EOS CONCURRENT WRITE-EXECUTION driver — runs MULTIPLE owner-approved-through-EOS work items at once,
// WITHOUT owning authorization and WITHOUT replacing the single-worker runtime.
//
// The load-bearing invariant (do not weaken): this driver NEVER authorizes anything. It only decides WHICH
// already-EOS-authorized items may run concurrently (disjoint write sectors) and HOW MANY at once (throttle-
// adaptive). Every item is still carried through the EXISTING per-item EOS path — executeIntakeItem — so the
// authorization gate, capability/protected-boundary checks, completion-semantic gate, and status/result/
// REVIEW_READY write-back are byte-for-byte the same as the serial path. Concurrency WRAPS EOS; it never
// bypasses it. An item that is not EXECUTION_AUTHORIZED (or hits a protected boundary, or lacks an available
// capability) is BLOCKED by the wrapped executeIntakeItem exactly as it is today — the runner cannot promote it.
//
// Safety composition:
//   • planConcurrentWriteSectors (inside runConcurrentWrites) → items that share any declared write path land in
//     different waves; only pairwise-disjoint sectors co-run. Read-only items (no declared paths) run alone.
//   • makeRequestClaim(requestId) → a per-request atomic claim so two workers can never grab the same item.
//     executeIntakeItem is given a NO-OP lease because the runner's per-request claim already provides
//     exclusivity for that item — the claim is the single owner of "who runs this requestId".
//   • decideRetry(persisted attempts) → a permanently-failing item stops re-spawning paid workers: it holds
//     during backoff and escalates to the Owner after the bounded attempt budget, instead of running every wake.
//   • adaptConcurrency (inside runConcurrentWrites) → the fleet shrinks on a throttle signal and grows back on a
//     clear streak, so the driver self-tunes to the provider/host instead of a hardcoded fan-out.
//
// This module is PURE of real I/O: executeItem, the claim factory, revalidate, and the attempts store are all
// injectable. In tests they are fakes; in production executeItem defaults to the real EOS executeIntakeItem and
// the claim to makeRequestClaim over the EOS lock root. Nothing here is wired into a live workflow — activation
// is gated (see agent-manager-scaling.md); this is the additive driver the gated workflow will call.

import { runConcurrentWrites } from "../lib/concurrentWriteRunner.mjs";
import { makeRequestClaim } from "../lib/wakeLease.mjs";
import { decideRetry } from "../lib/agentManager.mjs";
import { executeIntakeItem } from "./intake-runtime.mjs";

// A lease that is always-acquired / no-op release. The runner's per-request claim already guarantees single
// ownership of the requestId, so the wrapped executeIntakeItem must not ALSO contend a second lock (that would
// deadlock it against the claim the runner is holding). Exclusivity lives in exactly one place: the claim.
const NOOP_LEASE = Object.freeze({ acquire: () => ({ acquired: true }), release: () => {} });

const FAILED_STATES = new Set(["FAILED", "BLOCKED_EXECUTION", "RETURN_FOR_CORRECTION", "CORRECTING", "WORKER_FAILED"]);

/**
 * Drain a set of EOS-authorized write items concurrently, disjoint sectors in parallel, each through the real
 * EOS per-item execution. Returns per-item dispositions plus the plan/throttle summary. Never throws for a
 * worker failure (it becomes a recorded outcome); the whole batch is best-effort and idempotent per item.
 *
 * @param {object}   p
 * @param {Array}    p.items                 EOS-authorized items: [{ requestId, location, sha256, paths?,
 *                                            requiresCapabilities?, sourceCommit? }]. `paths` is the item's
 *                                            declared write scope (used only for disjoint-sector planning).
 * @param {object}   [p.deps]
 * @param {Function} [p.deps.executeItem]     (item, itemDeps) => EOS disposition — defaults to executeIntakeItem
 * @param {Function} [p.deps.makeClaim]       (requestId, opts) => lease — defaults to makeRequestClaim
 * @param {Function} [p.deps.revalidate]      (item) => { stillApplies, reason? } — rebase+recheck before write
 * @param {object}   [p.deps.attemptsStore]   { read(requestId)=>{attempts,lastAttemptAt,lastState}, write(...) }
 * @param {string}   [p.deps.lockRoot]        per-request claim root dir
 * @param {object}   [p.deps.fs]              fs for the claim (readFileSync/writeFileSync/mkdirSync/rmSync/rmdirSync)
 * @param {object}   [p.deps.itemDeps]        deps forwarded to executeItem (write/readFile/processRunner/…)
 * @param {number}   [p.deps.nowMs]           fixed clock for backoff math (defaults to real time)
 * @param {number}   [p.deps.maxConcurrency]  cap on simultaneous workers (default 4)
 * @param {number}   [p.deps.maxAttempts]     bounded retry budget before ESCALATE_OWNER (default 3)
 * @param {number}   [p.deps.backoffSec]      backoff window between attempts (default 900)
 */
export async function runAuthorizedWritesConcurrently({ items = [], deps = {} } = {}) {
  const executeItem = deps.executeItem || ((item, itemDeps) => executeIntakeItem({
    requestId: item.requestId, location: item.location, sha256: item.sha256,
    sourceCommit: item.sourceCommit ?? null, requiresCapabilities: item.requiresCapabilities || [], deps: itemDeps,
  }));
  const makeClaim = deps.makeClaim || ((requestId) => makeRequestClaim(requestId, { lockRoot: deps.lockRoot, fs: deps.fs }));
  const attempts = deps.attemptsStore || { read: () => ({ attempts: 0, lastAttemptAt: null, lastState: null }), write: () => {} };
  const nowMs = typeof deps.nowMs === "number" ? deps.nowMs : Date.now();
  const maxAttempts = deps.maxAttempts ?? 3;
  const backoffSec = deps.backoffSec ?? 900;

  // (1) Retry gate — BEFORE any worker: consult the persisted attempt history so a permanently-failing item is
  // not re-dispatched. HOLD_BACKOFF (too soon) and ESCALATE_OWNER (budget exhausted) are recorded and excluded
  // from this batch; only PROCEED/RETRY items go to the concurrent runner. A fresh item (no prior state) PROCEEDs.
  const gated = [];
  const eligible = [];
  for (const item of Array.isArray(items) ? items : []) {
    const a = attempts.read(item.requestId) || {};
    const sinceLastAttemptSec = a.lastAttemptAt ? Math.max(0, (nowMs - Date.parse(a.lastAttemptAt)) / 1000) : Infinity;
    const decision = decideRetry({ state: a.lastState, attempts: a.attempts || 0, maxAttempts, sinceLastAttemptSec, backoffSec });
    if (decision.decision === "HOLD_BACKOFF" || decision.decision === "ESCALATE_OWNER") {
      gated.push({ requestId: item.requestId, disposition: decision.decision, reason: decision.reason });
    } else {
      eligible.push(item);
    }
  }

  // (2) Concurrent drain — disjoint sectors in parallel, each item through the REAL EOS execution. The runner
  // owns the per-request claim; executeItem gets the no-op lease so exclusivity is not double-contended.
  const run = await runConcurrentWrites({
    items: eligible,
    maxConcurrency: deps.maxConcurrency ?? 4,
    claimFactory: makeClaim,
    revalidate: deps.revalidate,
    runWorker: async (item) => {
      const itemDeps = { ...(deps.itemDeps || {}), lease: NOOP_LEASE };
      const out = executeItem(item, itemDeps);
      const disposition = out && (out.disposition ?? out.state);
      const failed = FAILED_STATES.has(disposition);
      // (3) Attempt persistence — increment on a failed run so the NEXT wake's retry gate can back off / escalate.
      // A clean/held/complete disposition resets the failure counter (the item made progress or is done).
      const prior = attempts.read(item.requestId) || {};
      attempts.write(item.requestId, failed
        ? { attempts: (prior.attempts || 0) + 1, lastAttemptAt: new Date(nowMs).toISOString(), lastState: disposition }
        : { attempts: 0, lastAttemptAt: new Date(nowMs).toISOString(), lastState: disposition });
      // Surface `failed` so the runner's own failure containment + throttle read see it; carry EOS fields through.
      return { ...out, failed };
    },
  });

  return Object.freeze({
    waves: run.waves,
    finalConcurrency: run.finalConcurrency,
    gated: Object.freeze(gated),
    results: Object.freeze(run.results.map((r) => Object.freeze({ requestId: r.requestId, disposition: r.disposition, eos: r.outcome && (r.outcome.disposition ?? r.outcome.state), outcome: r.outcome }))),
  });
}
