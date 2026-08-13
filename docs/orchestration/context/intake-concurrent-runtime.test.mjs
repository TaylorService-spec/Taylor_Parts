import { test } from "node:test";
import assert from "node:assert/strict";
import { runAuthorizedWritesConcurrently } from "./intake-concurrent-runtime.mjs";

// An always-acquire claim factory (per-request atomic claim is proven in wakeLease.test.mjs). `held` simulates
// an item another worker already claimed.
const claimFactory = ({ held = new Set() } = {}) => (requestId) => ({
  acquire: () => ({ acquired: !held.has(requestId), reason: held.has(requestId) ? "held" : undefined }),
  release: () => {},
});

// An in-memory attempts store standing in for the durable status field.
const memAttempts = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { m, read: (id) => m.get(id) || { attempts: 0, lastAttemptAt: null, lastState: null }, write: (id, v) => m.set(id, v) };
};

const NOW = Date.parse("2026-08-13T08:00:00Z");

test("disjoint authorized items run concurrently through EOS; overlapping sectors serialize", async () => {
  const order = [];
  const out = await runAuthorizedWritesConcurrently({
    items: [
      { requestId: "A", location: "a.work.json", sha256: "a", paths: ["x.ts"] },
      { requestId: "B", location: "b.work.json", sha256: "b", paths: ["y.ts"] },   // disjoint from A
      { requestId: "C", location: "c.work.json", sha256: "c", paths: ["x.ts"] },   // overlaps A → later wave
    ],
    deps: {
      nowMs: NOW,
      makeClaim: claimFactory(),
      attemptsStore: memAttempts(),
      executeItem: (item) => { order.push(item.requestId); return { disposition: "COMPLETE" }; },
    },
  });
  assert.equal(out.waves, 2, "A/B disjoint → wave 0; C overlaps A → wave 1");
  assert.equal(out.results.length, 3);
  assert.ok(out.results.every((r) => r.eos === "COMPLETE"));
  assert.ok(order.indexOf("C") > order.indexOf("A"), "overlapping write serialized after its predecessor");
});

test("authorization is NEVER bypassed — an EOS-BLOCKED item stays BLOCKED, not promoted", async () => {
  const out = await runAuthorizedWritesConcurrently({
    items: [{ requestId: "PAID-NO-CRED", location: "p.work.json", sha256: "p", paths: ["z.ts"] }],
    deps: {
      nowMs: NOW,
      makeClaim: claimFactory(),
      attemptsStore: memAttempts(),
      // Simulates executeIntakeItem's own gate: unavailable capability → BLOCKED. The runner must not change it.
      executeItem: () => ({ disposition: "BLOCKED" }),
    },
  });
  assert.equal(out.results[0].eos, "BLOCKED", "the wrapped EOS decision is preserved verbatim");
});

test("executeItem receives a NO-OP lease so it never double-contends the runner's per-request claim", async () => {
  let seenLease = null;
  await runAuthorizedWritesConcurrently({
    items: [{ requestId: "A", location: "a", sha256: "a", paths: ["x.ts"] }],
    deps: {
      nowMs: NOW, makeClaim: claimFactory(), attemptsStore: memAttempts(),
      executeItem: (_item, itemDeps) => { seenLease = itemDeps.lease; return { disposition: "COMPLETE" }; },
    },
  });
  assert.ok(seenLease, "a lease was injected");
  assert.equal(seenLease.acquire().acquired, true, "no-op lease always acquires (exclusivity is the claim's job)");
});

test("retry gate holds a recently-failed item in backoff and does NOT re-run it", async () => {
  const ran = [];
  const seed = { "FAIL-RECENT": { attempts: 1, lastAttemptAt: new Date(NOW - 100_000).toISOString(), lastState: "FAILED" } };
  const out = await runAuthorizedWritesConcurrently({
    items: [
      { requestId: "FAIL-RECENT", location: "f", sha256: "f", paths: ["a.ts"] }, // 100s ago, backoff 900s → HOLD
      { requestId: "FRESH", location: "n", sha256: "n", paths: ["b.ts"] },
    ],
    deps: {
      nowMs: NOW, backoffSec: 900, makeClaim: claimFactory(), attemptsStore: memAttempts(seed),
      executeItem: (item) => { ran.push(item.requestId); return { disposition: "COMPLETE" }; },
    },
  });
  assert.deepEqual(ran, ["FRESH"], "the in-backoff item is not re-dispatched");
  assert.equal(out.gated.find((g) => g.requestId === "FAIL-RECENT").disposition, "HOLD_BACKOFF");
});

test("retry gate escalates a budget-exhausted item to the Owner instead of re-spawning a paid worker", async () => {
  const ran = [];
  const seed = { "FAIL-EXHAUSTED": { attempts: 3, lastAttemptAt: new Date(NOW - 10_000_000).toISOString(), lastState: "FAILED" } };
  const out = await runAuthorizedWritesConcurrently({
    items: [{ requestId: "FAIL-EXHAUSTED", location: "f", sha256: "f", paths: ["a.ts"] }],
    deps: {
      nowMs: NOW, maxAttempts: 3, makeClaim: claimFactory(), attemptsStore: memAttempts(seed),
      executeItem: (item) => { ran.push(item.requestId); return { disposition: "COMPLETE" }; },
    },
  });
  assert.deepEqual(ran, [], "exhausted item never runs");
  assert.equal(out.gated[0].disposition, "ESCALATE_OWNER");
});

test("attempt persistence: a failed run increments; a clean run resets the failure counter", async () => {
  const store = memAttempts();
  await runAuthorizedWritesConcurrently({
    items: [
      { requestId: "BOOM", location: "x", sha256: "x", paths: ["a.ts"] },
      { requestId: "OK", location: "y", sha256: "y", paths: ["b.ts"] },
    ],
    deps: {
      nowMs: NOW, makeClaim: claimFactory(), attemptsStore: store,
      executeItem: (item) => ({ disposition: item.requestId === "BOOM" ? "FAILED" : "COMPLETE" }),
    },
  });
  assert.equal(store.read("BOOM").attempts, 1, "failed run recorded for the next wake's retry gate");
  assert.equal(store.read("BOOM").lastState, "FAILED");
  assert.equal(store.read("OK").attempts, 0, "clean run resets the counter");
});

test("a claimed item is skipped (never double-run across concurrent drains)", async () => {
  const ran = [];
  const out = await runAuthorizedWritesConcurrently({
    items: [
      { requestId: "HELD", location: "h", sha256: "h", paths: ["a.ts"] },
      { requestId: "FREE", location: "n", sha256: "n", paths: ["b.ts"] },
    ],
    deps: {
      nowMs: NOW, makeClaim: claimFactory({ held: new Set(["HELD"]) }), attemptsStore: memAttempts(),
      executeItem: (item) => { ran.push(item.requestId); return { disposition: "COMPLETE" }; },
    },
  });
  assert.deepEqual(ran, ["FREE"], "the already-claimed item is not executed");
  assert.equal(out.results.find((r) => r.requestId === "HELD").disposition, "SKIPPED_CLAIM_HELD");
});
