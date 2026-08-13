// Shared Agent Manager — minimum dispatcher over the existing orchestrator.
//
// An EXECUTION SERVICE, not a product/architecture/UX authority and not a second
// scheduler competing with the durable backlog (#703). It decides, for one
// request against current state, exactly one action:
//
//   REJECT_INVALID   — request fails its contract
//   DEDUPE_REUSE     — an equivalent, valid, current result already exists
//   WAIT_NETWORK     — remote request, network disallows new remote work now
//   READY_BUT_WAITING_RESOURCE — valid, but no global resource slot free
//   DISPATCH         — run a bounded worker with this allocation
//
// Pure and stateless: the session driver holds in-flight allocations, performs the
// actual bounded-worker run (via the harness), writes the durable result, routes
// it back to the requesting workstream, releases the slot, and calls again.

import { validateAgentRequest } from "./agentRequest.mjs";
import { isReusableResult } from "./agentResult.mjs";
import { classifyResourceNeed, allocate } from "./resourceGovernor.mjs";
import { remotePolicy } from "./networkState.mjs";
import { resolveDispatchModel } from "./modelPolicy.mjs";

export const DISPATCH_DECISIONS = Object.freeze([
  "REJECT_INVALID", "DEDUPE_REUSE", "WAIT_NETWORK", "READY_BUT_WAITING_RESOURCE", "DISPATCH",
]);

// An existing result is equivalent when it answers the same request fingerprint,
// concluded cleanly, and — if the request declares a freshness anchor — was
// produced against the same repository state (avoid reruns when nothing changed, §6).
export function findEquivalentResult(request, results = [], requestsById = new Map()) {
  return (results || []).find((r) => {
    if (!isReusableResult(r)) return false;
    const originating = requestsById.get(r.requestId);
    if (!originating || originating.fingerprint !== request.fingerprint) return false;
    if (request.freshnessAnchor && r.freshnessAnchor && request.freshnessAnchor !== r.freshnessAnchor) return false;
    return true;
  }) || null;
}

// The Agent Manager owns the "don't re-dispatch already-completed work" decision for the work-intake
// execution path too — the SAME DEDUPE_REUSE responsibility as decideDispatch, applied to the durable intake
// status instead of the agent-request result ledger. Pure: the runtime reads the committed status.json and
// asks. A COMPLETE status carrying a resultRef for the SAME authorized work-artifact sha means the result
// already exists → DEDUPE_REUSE (skip the wake). A non-terminal or FAILED/BLOCKED status, a missing status,
// or a changed work sha → DISPATCH (so a re-authorized item, or a previously-failed item, still runs and can
// self-heal). This is what stops the execute loop from re-running finished workers on every pass.
export function decideIntakeDispatch({ requestId, workSha256, committedStatus = null } = {}) {
  const s = committedStatus;
  const alreadyComplete = !!s
    && s.state === "COMPLETE"
    && !!s.resultRef
    && !!s.workArtifact
    && s.workArtifact.sha256 === workSha256;
  if (alreadyComplete) {
    return { decision: "DEDUPE_REUSE", requestId, resultRef: s.resultRef, reason: "a COMPLETE result already exists for this authorized work (same work sha) — not re-dispatching" };
  }
  return { decision: "DISPATCH", requestId };
}

// ── Smarter-manager capabilities (additive; the EOS single-worker path is unchanged) ─────────────────────
//
// These give the Agent Manager the intelligence the manual manager was performing by hand: partition approved
// WRITE work into non-overlapping sectors it can run concurrently, read provider throttling and adapt the
// concurrency, and bound retries so failing work stops re-spawning paid workers. They are PURE — a runner
// consumes them; nothing here spawns, and the existing sequential runtime keeps working untouched.

// A path carrying any glob/wildcard metacharacter can't be resolved to a concrete file-set at plan time, so its
// true scope is UNKNOWN and it must not be treated as a single concrete path. (`*` `?` `[...]` `{...}`.)
const GLOB_META = /[*?[\]{}]/;
// Normalize to a canonical concrete form so equality/containment compare like-for-like: backslashes → `/`,
// strip a leading `./`, collapse duplicate slashes, drop a trailing slash. Purely lexical — it does NOT
// resolve `..`, symlinks, case-folding, or a glob's expansion (that's the caller's normalization precondition).
function normalizePath(p) {
  return String(p).trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}
// Two CONCRETE paths overlap if identical, OR one is a directory prefix of the other at a SEGMENT boundary:
// `src/foo` vs `src/foo/bar.js` overlap (dir contains file); `src/foo` vs `src/foobar` do NOT. This is what
// makes exact-equality insufficient — a directory scope and a file inside it are the same sector.
function pathsOverlap(a, b) {
  return a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
}

/**
 * Partition approved WRITE items into concurrency-safe WAVES: within a wave, every item's file-set is pairwise
 * DISJOINT (different sectors → safe to write in parallel — no fratricide); an item that shares any path with a
 * wave member is pushed to a later wave (serialized). This is what lets the manager run MULTIPLE non-overlapping
 * areas of write at once. Deterministic greedy first-fit (interval-graph coloring).
 *
 * Disjointness is proven STRUCTURALLY over CONCRETE, normalized paths: exact equality AND directory containment
 * (`src/foo` ∋ `src/foo/bar.js`) both count as overlap. Fail-safe on anything it can't prove concrete: an item
 * with NO declared paths, OR any path bearing a glob/wildcard, has UNKNOWN scope → it takes a wave ALONE and
 * blocks its wave for others. What this canNOT see from paths alone — rename source/target pairs, generated or
 * shared output files, case-insensitive-fs collisions — must be declared/normalized upstream by the caller;
 * that normalization is an ACTIVATION precondition for live parallel writes (see agent-manager-scaling.md).
 * @param {Array<{requestId?:string, paths?:string[]}>} items
 * @returns {ReadonlyArray<ReadonlyArray<object>>} waves; waves[0] is the max set of concurrently-writable sectors
 */
export function planConcurrentWriteSectors(items = []) {
  const waves = []; // internal wave: [{ item, paths: string[] | null }]  (null = unknown/unprovable scope)
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = (Array.isArray(item?.paths) ? item.paths.filter((p) => typeof p === "string") : [])
      .map(normalizePath).filter(Boolean);
    // Provable ⇔ at least one path AND none of them is a glob. Otherwise scope is UNKNOWN (fail-safe → alone).
    const provable = normalized.length > 0 && !normalized.some((p) => GLOB_META.test(p));
    let placed = false;
    if (provable) {
      for (const wave of waves) {
        const clash = wave.some((w) => w.paths === null || w.paths.some((q) => normalized.some((p) => pathsOverlap(p, q))));
        if (!clash) { wave.push({ item, paths: normalized }); placed = true; break; }
      }
    }
    if (!placed) waves.push([{ item, paths: provable ? normalized : null }]);
  }
  return Object.freeze(waves.map((w) => Object.freeze(w.map((x) => x.item))));
}

const THROTTLE_RE = /\b(?:429|rate[ _-]?limit(?:ed|ing)?|overloaded|too many requests|usage limit|quota exceeded|retry[ _-]?after)\b/i;

/**
 * Read a worker/provider outcome for a system-throttling signal (so the manager can back off instead of
 * hammering a rate-limited provider). Looks at explicit flags, status/exit codes, and the sanitized diagnostic
 * text. Never throws. `retryAfterSec` is parsed from a `retry-after: N` hint when present.
 * @returns {{throttled:boolean, retryAfterSec:(number|null)}}
 */
export function detectThrottle(outcome = {}) {
  const o = outcome && typeof outcome === "object" ? outcome : {};
  const text = [o.failureDetail, o.diagnostic, o.stderr, o.error, o.reason, o.message].filter((s) => typeof s === "string").join(" ");
  const throttled = o.throttled === true || o.statusCode === 429 || o.exitCode === 429 || THROTTLE_RE.test(text);
  const m = /retry[ _-]?after[:\s]+(\d+)/i.exec(text);
  return Object.freeze({ throttled: !!throttled, retryAfterSec: m ? Number(m[1]) : (Number.isFinite(o.retryAfterSec) ? o.retryAfterSec : null) });
}

/**
 * Adaptive concurrency (AIMD — additive-increase / multiplicative-decrease, the standard congestion-control
 * shape): on a throttle signal, HALVE concurrency (fast back-off, floored at `min`); after a sustained clear
 * streak, grow by one (up to `max`). Bounded and deterministic — this is how the manager "learns to read for
 * throttling" and self-tunes how many sectors it fires at once.
 * @returns {{concurrency:number, reason:string}}
 */
export function adaptConcurrency({ current = 1, min = 1, max = 4, throttle = false, clearStreak = 0, growAfter = 3 } = {}) {
  const cur = Math.max(min, Math.min(max, Math.floor(Number(current) || min)));
  if (throttle) return { concurrency: Math.max(min, Math.floor(cur / 2)), reason: "throttle detected — multiplicative back-off" };
  if (clearStreak >= growAfter && cur < max) return { concurrency: cur + 1, reason: `${clearStreak} clear cycles — additive grow` };
  return { concurrency: cur, reason: "hold" };
}

/**
 * Bounded retry policy for a failing item: retry with backoff up to `maxAttempts`, then ESCALATE to the Owner —
 * so a permanently-failing item stops re-spawning paid workers on every wake (the cost-bleed the review found).
 * A non-failed state just PROCEEDs. Pure: the caller supplies the durable attempt count + elapsed time.
 * @returns {{decision:("PROCEED"|"RETRY"|"HOLD_BACKOFF"|"ESCALATE_OWNER"), reason:string}}
 */
export function decideRetry({ state, attempts = 0, maxAttempts = 3, sinceLastAttemptSec = Infinity, backoffSec = 900 } = {}) {
  const FAILED = new Set(["FAILED", "BLOCKED_EXECUTION", "RETURN_FOR_CORRECTION", "CORRECTING"]);
  if (!FAILED.has(state)) return { decision: "PROCEED", reason: "not a failed state" };
  const n = Math.max(0, Math.floor(Number(attempts) || 0));
  if (n >= maxAttempts) return { decision: "ESCALATE_OWNER", reason: `exhausted ${n}/${maxAttempts} attempts — hand to Owner, stop re-running` };
  if ((Number(sinceLastAttemptSec) || 0) < backoffSec) return { decision: "HOLD_BACKOFF", reason: `within ${backoffSec}s backoff` };
  return { decision: "RETRY", reason: `attempt ${n + 1}/${maxAttempts} after backoff` };
}

export function decideDispatch({ request, allocations = [], results = [], requestsById = new Map(), networkState = "NORMAL" } = {}) {
  const errors = validateAgentRequest(request);
  if (errors.length) return { decision: "REJECT_INVALID", errors };

  const reuse = findEquivalentResult(request, results, requestsById);
  if (reuse) return { decision: "DEDUPE_REUSE", result: reuse };

  const isRemote = request.execution === "REMOTE";
  if (isRemote && !remotePolicy(networkState).allowNewRemote) {
    return { decision: "WAIT_NETWORK", networkState };
  }

  const need = classifyResourceNeed(request);
  const slot = allocate(allocations, need);
  if (slot.decision === "WAIT_RESOURCE") {
    return { decision: "READY_BUT_WAITING_RESOURCE", waitingOn: slot.waitingOn };
  }
  return { decision: "DISPATCH", allocation: need };
}

// C-7 STANDARD-DISPATCH CONTEXT (Owner directive): every ORDINARY worker is bootstrapped with the
// SAME reproducible context package the Wake Supervisor uses — never a second bootstrap path. Pure:
// the package builder (contextPackageFor from context/build-package.mjs) is INJECTED so this module
// performs no I/O. Only a DISPATCH decision attaches a package; other decisions pass through unchanged.
// If the request's scope has no L1 authority in the map, the package's sufficiency is EVIDENCE_REQUIRED
// — the worker must escalate, not guess.
export function attachDispatchContext(dispatchResult, request, contextPackageFn, { sourceCommit = null } = {}) {
  if (!dispatchResult || dispatchResult.decision !== "DISPATCH") return dispatchResult;
  if (typeof contextPackageFn !== "function") throw new Error("attachDispatchContext: contextPackageFn is required (inject contextPackageFor — the shared package mechanism)");
  const contextPackage = contextPackageFn({
    id: request.requestId,
    scope: request.scope || [],
    role: request.requestedByWorkstream,
    objective: request.purpose,
    sourceCommit,
  });
  // Standard dispatch dispatches a DELEGATED worker → resolve the concrete model via the ratified
  // two-model policy (delegated → SONNET). modelTier is preserved as portability metadata. This is
  // the SAME resolver the Wake Supervisor uses, so the two paths cannot silently diverge.
  const modelSelection = resolveDispatchModel({ modelTier: request.modelTier, workstream: request.requestedByWorkstream, delegated: true });
  return { ...dispatchResult, contextPackage, selectedModel: modelSelection.selectedModel, modelSelection };
}

// Convenience: decide + attach the C-7 package in one call (the standard dispatch path).
export function dispatchWithContext({ contextPackageFn, sourceCommit = null, ...args } = {}) {
  const decision = decideDispatch(args);
  return attachDispatchContext(decision, args.request, contextPackageFn, { sourceCommit });
}

// Pick the next request to consider: blocking before non-blocking, then lower
// priority number first, then declared order. Only PENDING/validated-waiting states.
const SELECTABLE = new Set(["PENDING", "VALIDATED", "READY_BUT_WAITING_RESOURCE", "WAITING_NETWORK"]);
export function selectNextQueuedRequest(requests = []) {
  const queue = (requests || []).map((r, index) => ({ r, index })).filter((x) => SELECTABLE.has(x.r.status));
  if (!queue.length) return null;
  queue.sort((a, b) => {
    if (!!b.r.blocking !== !!a.r.blocking) return (b.r.blocking ? 1 : 0) - (a.r.blocking ? 1 : 0);
    const pa = Number.isFinite(a.r.priority) ? a.r.priority : Infinity;
    const pb = Number.isFinite(b.r.priority) ? b.r.priority : Infinity;
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });
  return queue[0].r;
}

const INTEGRITY_RANK = Object.freeze({ SECURITY: 0, INTEGRITY: 1, NORMAL: 2 });
const SHA256 = /^[0-9a-f]{64}$/;
const READY_INTEGRATION = "READY";

export function validateIntegrationBacklogItem(item) {
  const errors = [];
  if (!item?.requestId) errors.push("requestId is required");
  if (!item?.target?.repo || !item?.target?.branch) errors.push("target repo/branch is required");
  if (!item?.approvedArtifact?.location || !SHA256.test(item?.approvedArtifact?.sha256 || "")) errors.push("approved patch/result location and SHA-256 are required");
  if (!Number.isFinite(item?.priority)) errors.push("numeric priority is required");
  if (!Array.isArray(item?.dependencies)) errors.push("dependencies must be an array");
  if (!Array.isArray(item?.paths) || !item.paths.length) errors.push("paths must be a non-empty array");
  if (!Array.isArray(item?.overlappingPaths)) errors.push("overlappingPaths must be an array");
  if (!Object.hasOwn(INTEGRITY_RANK, item?.integrityPriority)) errors.push("integrityPriority must be SECURITY, INTEGRITY, or NORMAL");
  if (!new Set(["PASS", "PENDING", "FAILED"]).has(item?.verificationState)) errors.push("invalid verificationState");
  if (!new Set(["PASS", "PENDING", "FAILED"]).has(item?.scopeState)) errors.push("invalid scopeState");
  if (!new Set(["PASS", "PENDING", "FAILED"]).has(item?.hashState)) errors.push("invalid hashState");
  if (!new Set(["APPROVED", "PENDING", "REJECTED"]).has(item?.approvalState)) errors.push("invalid approvalState");
  if (!new Set(["READY", "BLOCKED", "INTEGRATED"]).has(item?.integrationReadiness)) errors.push("invalid integrationReadiness");
  if (item?.blocker != null && typeof item.blocker !== "string") errors.push("blocker must be null or a string");
  return errors;
}

const targetKey = (item) => `${item.target.repo}#${item.target.branch}`;
const pathOverlap = (a, b) => a.paths.filter((path) => b.paths.includes(path));

// A pure ordering projection over the one durable Agent Manager backlog. It does not dispatch,
// approve, verify, or apply anything; the governed integration workflow remains the sole writer.
export function planIntegrationBacklog(items = []) {
  if (!Array.isArray(items)) throw new Error("integration backlog must be an array");
  const indexed = items.map((item, order) => ({ ...item, order, errors: validateIntegrationBacklogItem(item) }));
  const byId = new Map(indexed.map((item) => [item.requestId, item]));
  if (byId.size !== indexed.length) throw new Error("duplicate integration requestId");

  const blocked = new Map();
  for (const item of indexed) {
    if (item.errors.length) blocked.set(item.requestId, `INVALID: ${item.errors.join("; ")}`);
    else if (item.integrationReadiness === "BLOCKED" || item.blocker) blocked.set(item.requestId, item.blocker || "integration readiness is BLOCKED");
    else if (item.integrationReadiness !== "BLOCKED" && item.verificationState !== "PASS") blocked.set(item.requestId, "verification has not passed");
    else if (item.integrationReadiness !== "BLOCKED" && item.scopeState !== "PASS") blocked.set(item.requestId, "scope validation has not passed");
    else if (item.integrationReadiness !== "BLOCKED" && item.hashState !== "PASS") blocked.set(item.requestId, "artifact hash validation has not passed");
    else if (item.integrationReadiness !== "BLOCKED" && item.approvalState !== "APPROVED") blocked.set(item.requestId, "artifact is not approved");
    for (const dependency of item.dependencies || []) if (!byId.has(dependency)) blocked.set(item.requestId, `missing dependency: ${dependency}`);
  }

  const pending = new Set(indexed.filter((item) => item.integrationReadiness === READY_INTEGRATION && !blocked.has(item.requestId)).map((item) => item.requestId));
  const ordered = [];
  const compare = (a, b) => {
    const ai = INTEGRITY_RANK[a.integrityPriority], bi = INTEGRITY_RANK[b.integrityPriority];
    if (ai !== bi) return ai - bi;
    const aConflicts = indexed.some((other) => other.requestId !== a.requestId && targetKey(other) === targetKey(a) && pathOverlap(a, other).length);
    const bConflicts = indexed.some((other) => other.requestId !== b.requestId && targetKey(other) === targetKey(b) && pathOverlap(b, other).length);
    if (aConflicts !== bConflicts) return aConflicts ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.order - b.order;
  };

  while (pending.size) {
    const eligible = [...pending].map((id) => byId.get(id)).filter((item) => item.dependencies.every((id) => (byId.get(id)?.integrationReadiness === "INTEGRATED" && !blocked.has(id)) || ordered.some((done) => done.requestId === id)));
    if (!eligible.length) {
      for (const id of pending) blocked.set(id, "dependency cycle or dependency blocked");
      break;
    }
    eligible.sort(compare);
    const next = eligible[0];
    const overlaps = indexed.filter((other) => other.requestId !== next.requestId && targetKey(other) === targetKey(next)).flatMap((other) => pathOverlap(next, other));
    ordered.push({ ...next, overlappingPaths: [...new Set([...next.overlappingPaths, ...overlaps])].sort(), serializationKey: targetKey(next) });
    pending.delete(next.requestId);
  }

  return Object.freeze({
    ordered: Object.freeze(ordered),
    nextByTarget: Object.freeze(Object.fromEntries(ordered.map((item) => item.serializationKey).filter((key, i, keys) => keys.indexOf(key) === i).map((key) => [key, ordered.find((item) => item.serializationKey === key)]))),
    blocked: Object.freeze(indexed.filter((item) => blocked.has(item.requestId)).map((item) => ({ ...item, blocker: blocked.get(item.requestId) }))),
  });
}

// Efficiency counters over a request/result set (§6): all derivable from durable
// records, never fabricated. Token/runtime only where the runtime exposed them.
export function efficiencyMetrics(requests = [], results = []) {
  const byStatus = (s) => requests.filter((r) => r.status === s).length;
  const tokenResults = results.filter((r) => r.metrics && typeof r.metrics.tokens === "number");
  return {
    requestsCreated: requests.length,
    executed: results.length,
    dedupedOrReused: byStatus("DEDUPED"),
    rejected: byStatus("REJECTED"),
    waitingResource: byStatus("READY_BUT_WAITING_RESOURCE"),
    waitingNetwork: byStatus("WAITING_NETWORK"),
    retries: results.reduce((a, r) => a + (r.retries || 0), 0),
    acceptedFindings: results.reduce((a, r) => a + (r.findings ? r.findings.length : 0), 0),
    tokensReported: tokenResults.length, // how many results carried real token metrics
    tokensTotal: tokenResults.reduce((a, r) => a + r.metrics.tokens, 0), // sum of only the reported ones
  };
}
