// Provider-neutral REVIEW ROUTER — pure (no I/O). Decides, for a review need, the cheapest CAPABLE +
// AVAILABLE + AUTHORIZED worker that meets the latency and independence requirements — or that a
// deterministic check already suffices (no AI), or that only the Owner may decide.
//
// AI providers are WORKERS, never the clock/queue/authority/control plane. This module hard-codes NO
// provider name: the classification is provider-neutral; concrete workers arrive as an INJECTED
// registry (data), so a new provider is a registry entry, not a code change.
//
// Routing principle (in order): deterministic verification FIRST → least-expensive capable AI worker
// → stronger/independent reviewer only when needed → Owner only for genuine judgment/authorization.
// Cheap-but-non-independent is NOT a substitute for an independent review when one is required; a
// worker never certifies its own implementation.

import { resolveDispatchModel } from "./modelPolicy.mjs";

// ── Taxonomies ───────────────────────────────────────────────────────────────

// WHAT kind of review a need is — determines who CAN serve it. Provider-neutral.
export const REVIEW_CLASSES = Object.freeze(["DETERMINISTIC", "ROUTINE_AI", "INDEPENDENT_AI", "OWNER"]);

// Latency EXPECTATION, independent of provider selection. Faster is a lower rank.
export const LATENCY_CLASSES = Object.freeze(["IMMEDIATE", "MINUTES", "HOURLY", "DAILY", "WEEKLY"]);
const LATENCY_RANK = Object.freeze(Object.fromEntries(LATENCY_CLASSES.map((l, i) => [l, i])));
export const latencyRank = (l) => (l in LATENCY_RANK ? LATENCY_RANK[l] : Number.POSITIVE_INFINITY);
/** A worker with `workerLatency` can serve a `required` expectation iff it is as-fast-or-faster. */
export const latencySatisfies = (workerLatency, required) => latencyRank(workerLatency) <= latencyRank(required);

// Provider-neutral COST/CAPACITY class. Ordered cheapest→dearest for preference; UNKNOWN is never
// treated as cheap (worst preference) and never fabricated as a real price.
export const CAPACITY_CLASSES = Object.freeze([
  "FREE_DETERMINISTIC",     // local deterministic verification (tests/schema/provenance) — no AI
  "INCLUDED_SUBSCRIPTION",  // covered by a current plan (e.g. a Claude/ChatGPT subscription seat)
  "USAGE_LIMITED",          // included but rate/quota-limited
  "ADDITIONAL_CREDIT",      // consumes prepaid credit
  "PAY_PER_USE_API",        // metered paid API (e.g. OpenAI API) — a real marginal cost
  "INFRA_COST",             // hosting/infra cost to stand up
  "UNKNOWN",                // genuinely unknown — recorded, never fabricated, never assumed free
]);
const CAPACITY_RANK = Object.freeze(Object.fromEntries(CAPACITY_CLASSES.map((c, i) => [c, i])));
const capacityRank = (c) => (c in CAPACITY_RANK ? CAPACITY_RANK[c] : Number.POSITIVE_INFINITY);

// Worker availability. Only AVAILABLE workers are candidates; NOT_CONFIGURED is the honest seam for a
// paid/API path that exists in principle but is not provisioned — never fabricated as available.
export const WORKER_AVAILABILITY = Object.freeze(["AVAILABLE", "NOT_CONFIGURED", "UNAVAILABLE"]);

export const ROUTING_DECISIONS = Object.freeze([
  "DETERMINISTIC_SUFFICIENT", // a deterministic check answers it — NO AI call
  "ROUTE_TO_WORKER",          // an AI worker was selected
  "OWNER",                    // OWNER-class need — never routed to AI
  "OWNER_ATTENTION",          // an independent review is required but no independent worker is configured
  "UNSUITABLE_LATENCY",       // capable workers exist but none meets the latency need — do NOT silently wait
  "NEEDS_ACTIVATION",         // a capable worker exists but is NOT_CONFIGURED/unauthorized (e.g. paid API)
  "NO_CAPABLE_WORKER",        // nothing capable at all
]);

/**
 * A worker descriptor (registry entry, INJECTED). Example shape:
 *   { id, kind: "DETERMINISTIC"|"AI", serves: [REVIEW_CLASSES…], independent: bool,
 *     latency: LATENCY_CLASS, availability: WORKER_AVAILABILITY, authorized: bool,
 *     cost: { capacityClass: CAPACITY_CLASS, estimatedMarginalCost: number|null|"UNKNOWN",
 *             subscriptionBound: bool, apiMetered: bool, tokenBudget: number|null } }
 * No provider name is required by the router; the registry may carry one for display.
 */

// ── Routing ──────────────────────────────────────────────────────────────────

/**
 * Route a review need to a worker (or to deterministic-sufficient / Owner / a fail-closed decision).
 *
 * @param {object} p
 * @param {string} p.reviewClass          one of REVIEW_CLASSES
 * @param {string} p.latencyRequired      one of LATENCY_CLASSES (default MINUTES)
 * @param {boolean} [p.deterministicSufficient]  a deterministic check already answers it → no AI
 * @param {Array}  p.workers              INJECTED worker registry
 * @param {string[]} [p.excludeWorkerIds] workers barred from THIS review (e.g. the implementer — never
 *                                        certify own work)
 * @returns {{ decision, worker?, reviewClass, latencyRequired, independenceRequired, reason,
 *             evidence: string[], fallbackChain: object[] }}
 */
export function routeReview({ reviewClass = "ROUTINE_AI", latencyRequired = "MINUTES", deterministicSufficient = false, workers = [], excludeWorkerIds = [] } = {}) {
  const evidence = [];
  const base = { reviewClass, latencyRequired, independenceRequired: reviewClass === "INDEPENDENT_AI" };
  const done = (decision, extra = {}) => ({ ...base, decision, evidence, fallbackChain: [], ...extra });

  if (!REVIEW_CLASSES.includes(reviewClass)) return done("NO_CAPABLE_WORKER", { reason: `unknown review class ${reviewClass}` });

  // Owner-class judgment/authorization is NEVER routed to an AI worker.
  if (reviewClass === "OWNER") { evidence.push("OWNER-class need — genuine judgment/authorization"); return done("OWNER", { reason: "routed to Owner; a reviewer verdict is not authorization" }); }

  // Deterministic-first: a passing deterministic check (or a DETERMINISTIC-class need) needs no AI.
  if (deterministicSufficient || reviewClass === "DETERMINISTIC") {
    evidence.push(deterministicSufficient ? "deterministic verification sufficient" : "DETERMINISTIC review class");
    return done("DETERMINISTIC_SUFFICIENT", { reason: "answered by deterministic verification — no AI call" });
  }

  const excluded = new Set(excludeWorkerIds);
  const independenceRequired = reviewClass === "INDEPENDENT_AI";

  // Workers that SERVE this class at all (before exclusion) — used to explain any gap honestly.
  const servesClass = (workers || []).filter((w) => w && w.kind === "AI" && Array.isArray(w.serves) && w.serves.includes(reviewClass));
  if (independenceRequired && !servesClass.some((w) => w.independent === true)) {
    evidence.push("independent review required; no INDEPENDENT worker configured — never downgrade to a cheaper non-independent worker");
    return done("OWNER_ATTENTION", { reason: "independent review required but no independent worker configured — escalate to Owner, do not substitute" });
  }

  // Capable = serves the class, not excluded (e.g. the implementer — never certify own work), and
  // (for INDEPENDENT_AI) independent.
  let capable = servesClass.filter((w) => !excluded.has(w.id));
  if (independenceRequired) capable = capable.filter((w) => w.independent === true);
  if (capable.length === 0) {
    if (independenceRequired) {
      evidence.push("the only independent worker(s) were excluded (e.g. they implemented the work) — do not self-certify");
      return done("OWNER_ATTENTION", { reason: "no independent reviewer eligible (implementer excluded) — escalate to Owner, never self-certify" });
    }
    evidence.push(`no worker serves ${reviewClass} (after exclusions)`);
    return done("NO_CAPABLE_WORKER", { reason: `no capable worker for ${reviewClass}` });
  }

  // Availability + authorization gates. A NOT_CONFIGURED/unauthorized paid path is never fabricated as
  // available — but if it is the ONLY thing that could serve, surface NEEDS_ACTIVATION (Owner decision).
  const unavailable = capable.filter((w) => w.availability !== "AVAILABLE");
  const unauthorized = capable.filter((w) => w.availability === "AVAILABLE" && w.authorized === false);
  let live = capable.filter((w) => w.availability === "AVAILABLE" && w.authorized !== false);

  // Latency gate.
  const latencyOK = live.filter((w) => latencySatisfies(w.latency, latencyRequired));
  const latencyBlocked = live.filter((w) => !latencySatisfies(w.latency, latencyRequired));

  if (latencyOK.length === 0) {
    if (latencyBlocked.length > 0) {
      evidence.push(`capable worker(s) exist but none meets ${latencyRequired} (e.g. ${latencyBlocked[0].id}=${latencyBlocked[0].latency}) — do not silently wait`);
      return done("UNSUITABLE_LATENCY", { reason: `no worker meets ${latencyRequired}; surface rather than silently queue`, doNotSilentlyWait: true, fallbackChain: latencyBlocked });
    }
    if (unavailable.length > 0 || unauthorized.length > 0) {
      const why = unavailable.map((w) => `${w.id}:${w.availability}`).concat(unauthorized.map((w) => `${w.id}:UNAUTHORIZED`));
      evidence.push(`only capable workers are not configured/authorized (${why.join(", ")}) — never fabricated as available`);
      return done("NEEDS_ACTIVATION", { reason: "a capable worker exists but requires Owner activation (config/authorization)", candidates: why });
    }
    return done("NO_CAPABLE_WORKER", { reason: "no available, authorized, latency-suitable worker" });
  }

  // Prefer: lowest capacity cost, then fastest, then declared order. UNKNOWN cost sorts worst.
  const ranked = [...latencyOK].sort((a, b) => {
    const ca = capacityRank(a.cost && a.cost.capacityClass), cb = capacityRank(b.cost && b.cost.capacityClass);
    if (ca !== cb) return ca - cb;
    const la = latencyRank(a.latency), lb = latencyRank(b.latency);
    if (la !== lb) return la - lb;
    return 0;
  });
  const worker = ranked[0];
  const model = worker.role === "IMPLEMENTATION" ? null : resolveDispatchModel({ delegated: true }).selectedModel;
  evidence.push(`selected ${worker.id} (${worker.cost && worker.cost.capacityClass}, latency ${worker.latency})${independenceRequired ? " [independent]" : ""}`);
  if ((worker.cost && worker.cost.capacityClass) === "UNKNOWN") evidence.push("WARNING: selected worker cost is UNKNOWN — not assumed free");
  return done("ROUTE_TO_WORKER", { worker, selectedModel: model, reason: "cheapest capable+available+authorized worker meeting latency/independence", fallbackChain: ranked.slice(1) });
}

// ── Control Center projection ────────────────────────────────────────────────

/** Compact routing board for the Owner: how review demand was served, and the paid/API dependency. */
export function projectRoutingBoard(decisions = []) {
  const out = { total: (decisions || []).length, deterministic: 0, routedToWorker: 0, owner: 0, ownerAttention: 0, unsuitableLatency: 0, needsActivation: 0, noCapableWorker: 0, paidApiUsed: 0, byCapacity: {}, ownerRelayCount: 0 };
  for (const c of CAPACITY_CLASSES) out.byCapacity[c] = 0;
  for (const d of decisions || []) {
    switch (d.decision) {
      case "DETERMINISTIC_SUFFICIENT": out.deterministic++; break;
      case "ROUTE_TO_WORKER": {
        out.routedToWorker++;
        const cc = d.worker && d.worker.cost && d.worker.cost.capacityClass;
        if (cc && out.byCapacity[cc] != null) out.byCapacity[cc]++;
        if (cc === "PAY_PER_USE_API") out.paidApiUsed++;
        break;
      }
      case "OWNER": out.owner++; out.ownerRelayCount++; break;
      case "OWNER_ATTENTION": out.ownerAttention++; out.ownerRelayCount++; break;
      case "UNSUITABLE_LATENCY": out.unsuitableLatency++; break;
      case "NEEDS_ACTIVATION": out.needsActivation++; break;
      case "NO_CAPABLE_WORKER": out.noCapableWorker++; break;
    }
  }
  out.note = "AI workers are invoked by EOS; deterministic-first; paid API only when configured+authorized; verdict ≠ authorization.";
  return out;
}
