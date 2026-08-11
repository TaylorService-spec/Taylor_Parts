import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReviewResultCache, planProviderCall, planWakeRecovery, wakeSucceeded } from "./reviewRecovery.mjs";

test("dedup: an existing result for the same request hash avoids a second paid call", () => {
  const cache = makeReviewResultCache();
  const request = { artifactId: "request:h1", sha256: "h1" };
  const resultRef = { artifactId: "result:r1", sha256: "r1" };
  const counters = {};

  // first time: no cached result → CALL_PROVIDER
  const first = planProviderCall({ requestArtifact: request, cache, counters });
  assert.equal(first.action, "CALL_PROVIDER");

  // provider ran; record the result
  cache.record(request, resultRef);

  // second time, same request hash → REUSE_EXISTING, no paid call
  const second = planProviderCall({ requestArtifact: request, cache, counters });
  assert.equal(second.action, "REUSE_EXISTING");
  assert.deepEqual(second.resultRef, resultRef);
  assert.equal(counters.duplicateProviderCallsAvoided, 1);
});

test("dedup: a different request hash is a genuine new call", () => {
  const cache = makeReviewResultCache();
  cache.record({ sha256: "h1" }, { sha256: "r1" });
  const other = planProviderCall({ requestArtifact: { sha256: "h2" }, cache });
  assert.equal(other.action, "CALL_PROVIDER");
});

test("wake-only recovery: failed wake + persisted result → retry wake only, zero provider delta", () => {
  const counters = {};
  const plan = planWakeRecovery({
    wakeOutcome: "SPAWNED_FAILED",
    persistedResultRef: { artifactId: "result:r1", sha256: "r1" },
    counters,
  });
  assert.equal(plan.action, "RETRY_WAKE_ONLY");
  assert.equal(plan.providerCallCountDelta, 0);
  assert.equal(plan.wakeOnlyRecovery, true);
  assert.deepEqual(plan.resultRef, { artifactId: "result:r1", sha256: "r1" });
  assert.equal(counters.wakeOnlyRecoveries, 1);
});

test("wake-only recovery: failed wake + NO persisted result → cannot recover wake-only (fail closed)", () => {
  const plan = planWakeRecovery({ wakeOutcome: "TIMEOUT", persistedResultRef: null });
  assert.equal(plan.action, "CANNOT_RECOVER_WAKE_ONLY");
  assert.equal(plan.providerCallCountDelta, 0);
  assert.match(plan.reason, /fresh cycle/);
});

test("wake-only recovery: a successful wake needs no recovery", () => {
  const plan = planWakeRecovery({ wakeOutcome: "SPAWNED_COMPLETED", persistedResultRef: { sha256: "r1" } });
  assert.equal(plan.action, "NONE");
  assert.equal(plan.wakeOnlyRecovery, false);
  assert.equal(wakeSucceeded("SPAWNED_COMPLETED"), true);
  assert.equal(wakeSucceeded("HELD"), false);
});
