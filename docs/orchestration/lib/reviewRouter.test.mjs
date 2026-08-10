import { test } from "node:test";
import assert from "node:assert/strict";
import { routeReview, projectRoutingBoard, latencySatisfies, REVIEW_CLASSES, CAPACITY_CLASSES } from "./reviewRouter.mjs";

// A provider-neutral worker registry (INJECTED). No provider name drives the routing logic.
const claudeIncluded = { id: "claude-code", kind: "AI", role: "IMPLEMENTATION", serves: ["ROUTINE_AI"], independent: false, latency: "IMMEDIATE", availability: "AVAILABLE", authorized: true, cost: { capacityClass: "INCLUDED_SUBSCRIPTION", subscriptionBound: true, apiMetered: false } };
const claudeReview  = { id: "claude-review", kind: "AI", role: "REVIEW", serves: ["ROUTINE_AI", "INDEPENDENT_AI"], independent: true, latency: "IMMEDIATE", availability: "AVAILABLE", authorized: true, cost: { capacityClass: "INCLUDED_SUBSCRIPTION", subscriptionBound: true } };
const gptScheduled  = { id: "gpt-work", kind: "AI", role: "INDEPENDENT_REVIEW", serves: ["INDEPENDENT_AI"], independent: true, latency: "HOURLY", availability: "AVAILABLE", authorized: true, cost: { capacityClass: "INCLUDED_SUBSCRIPTION", subscriptionBound: true } };
const openaiApi     = { id: "openai-api", kind: "AI", role: "INDEPENDENT_REVIEW", serves: ["INDEPENDENT_AI", "ROUTINE_AI"], independent: true, latency: "IMMEDIATE", availability: "NOT_CONFIGURED", authorized: false, cost: { capacityClass: "PAY_PER_USE_API", apiMetered: true, estimatedMarginalCost: "UNKNOWN" } };

test("latencySatisfies: faster-or-equal only (HOURLY worker cannot serve IMMEDIATE)", () => {
  assert.equal(latencySatisfies("IMMEDIATE", "MINUTES"), true);
  assert.equal(latencySatisfies("HOURLY", "IMMEDIATE"), false);
  assert.equal(latencySatisfies("HOURLY", "DAILY"), true);
});

test("deterministic verification sufficient → NO AI call", () => {
  const d = routeReview({ reviewClass: "ROUTINE_AI", deterministicSufficient: true, workers: [claudeIncluded] });
  assert.equal(d.decision, "DETERMINISTIC_SUFFICIENT");
  assert.match(d.reason, /no AI/i);
});

test("DETERMINISTIC review class → no AI worker consulted", () => {
  assert.equal(routeReview({ reviewClass: "DETERMINISTIC", workers: [] }).decision, "DETERMINISTIC_SUFFICIENT");
});

test("routine review → cheapest capable included worker; decision carries reason/evidence", () => {
  const d = routeReview({ reviewClass: "ROUTINE_AI", latencyRequired: "MINUTES", workers: [openaiApi, claudeIncluded] });
  assert.equal(d.decision, "ROUTE_TO_WORKER");
  assert.equal(d.worker.id, "claude-code");           // INCLUDED_SUBSCRIPTION preferred over PAY_PER_USE_API
  assert.ok(d.reason && d.evidence.length > 0);
});

test("independent review required → an INDEPENDENT worker is selected (never a cheaper non-independent one)", () => {
  const d = routeReview({ reviewClass: "INDEPENDENT_AI", latencyRequired: "HOURLY", workers: [claudeIncluded, claudeReview, gptScheduled] });
  assert.equal(d.decision, "ROUTE_TO_WORKER");
  assert.equal(d.worker.independent, true);
  assert.ok(["claude-review", "gpt-work"].includes(d.worker.id));
});

test("a worker never certifies its own implementation (excludeWorkerIds)", () => {
  // claude-review is the only independent worker; exclude it (it did the impl) → escalate, don't self-certify
  const d = routeReview({ reviewClass: "INDEPENDENT_AI", latencyRequired: "IMMEDIATE", workers: [claudeReview], excludeWorkerIds: ["claude-review"] });
  assert.notEqual(d.decision, "ROUTE_TO_WORKER");
  assert.equal(d.decision, "OWNER_ATTENTION");
});

test("hourly worker + IMMEDIATE requirement → UNSUITABLE_LATENCY, do NOT silently wait", () => {
  const d = routeReview({ reviewClass: "INDEPENDENT_AI", latencyRequired: "IMMEDIATE", workers: [gptScheduled] });
  assert.equal(d.decision, "UNSUITABLE_LATENCY");
  assert.equal(d.doNotSilentlyWait, true);
});

test("provider unavailable → fallback to next capable per policy", () => {
  const gptDown = { ...gptScheduled, availability: "UNAVAILABLE" };
  const d = routeReview({ reviewClass: "INDEPENDENT_AI", latencyRequired: "HOURLY", workers: [gptDown, claudeReview] });
  assert.equal(d.decision, "ROUTE_TO_WORKER");
  assert.equal(d.worker.id, "claude-review");         // fell back to the available independent worker
});

test("paid API not configured → never fabricated as available (NEEDS_ACTIVATION, not routed)", () => {
  // only the paid API can serve, but it is NOT_CONFIGURED + unauthorized
  const d = routeReview({ reviewClass: "INDEPENDENT_AI", latencyRequired: "IMMEDIATE", workers: [openaiApi] });
  assert.equal(d.decision, "NEEDS_ACTIVATION");
  assert.ok(!d.worker);                                // the paid worker is NOT selected
  assert.match(JSON.stringify(d.candidates), /openai-api/);
});

test("OWNER class → never routed to an AI worker", () => {
  const d = routeReview({ reviewClass: "OWNER", workers: [claudeReview, openaiApi] });
  assert.equal(d.decision, "OWNER");
  assert.ok(!d.worker);
});

test("UNKNOWN cost is flagged and never treated as cheapest", () => {
  const unknownCheap = { id: "mystery", kind: "AI", serves: ["ROUTINE_AI"], latency: "IMMEDIATE", availability: "AVAILABLE", authorized: true, cost: { capacityClass: "UNKNOWN" } };
  const d = routeReview({ reviewClass: "ROUTINE_AI", latencyRequired: "MINUTES", workers: [unknownCheap, claudeIncluded] });
  assert.equal(d.worker.id, "claude-code");           // INCLUDED preferred; UNKNOWN sorts worst
  assert.deepEqual(CAPACITY_CLASSES[CAPACITY_CLASSES.length - 1], "UNKNOWN");
});

test("projectRoutingBoard: counts deterministic/worker/owner and the paid-API dependency", () => {
  const board = projectRoutingBoard([
    routeReview({ reviewClass: "DETERMINISTIC", workers: [] }),
    routeReview({ reviewClass: "ROUTINE_AI", workers: [claudeIncluded] }),
    routeReview({ reviewClass: "OWNER", workers: [] }),
    routeReview({ reviewClass: "INDEPENDENT_AI", latencyRequired: "IMMEDIATE", workers: [openaiApi] }),
  ]);
  assert.equal(board.deterministic, 1);
  assert.equal(board.routedToWorker, 1);
  assert.equal(board.owner, 1);
  assert.equal(board.needsActivation, 1);
  assert.equal(board.paidApiUsed, 0);                 // paid API never used (not configured)
  assert.ok(REVIEW_CLASSES.includes("INDEPENDENT_AI"));
});
