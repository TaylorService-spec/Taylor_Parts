import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessReadiness, nextBackoffMs, buildClaudeInvocation, DEFAULT_GUARDRAILS,
  TRIGGER_MECHANISMS, TRIGGER_KINDS,
} from "./wakeSupervisor.mjs";

const okItem = (over = {}) => ({ id: "W-1", status: "READY", authorized: true, protectedBoundary: null, scope: ["orchestration"], sha: "abc", ...over });
const okCtx = (over = {}) => ({ governor: { remoteAiUsed: 0, remoteAiMax: 2 }, network: "NORMAL", budgetRemainingUsd: 5, triggerKind: "AUTOMATIC_TRIGGER", ...over });

test("TRIGGER only when READY + authorized + repo-safe + slot free + network NORMAL + budget ok", () => {
  const r = assessReadiness(okItem(), okCtx());
  assert.equal(r.decision, "TRIGGER");
  assert.equal(r.triggerMechanism, "AUTOMATIC");
  assert.equal(r.guardrails, DEFAULT_GUARDRAILS);
});

test("THE INVARIANT: READY but NOT authorized → HOLD (READY is not authorization)", () => {
  const r = assessReadiness(okItem({ authorized: false }), okCtx());
  assert.equal(r.decision, "HOLD");
  assert.match(r.reason, /not authorization/);
  assert.equal(r.guardrails, null);
});

test("a protected boundary is NEVER auto-triggered", () => {
  const r = assessReadiness(okItem({ protectedBoundary: "deploy" }), okCtx());
  assert.equal(r.decision, "HOLD");
  assert.match(r.reason, /protected boundary/);
});

test("respects the 2/1/1 governor — no free REMOTE_AI slot → HOLD", () => {
  const r = assessReadiness(okItem(), okCtx({ governor: { remoteAiUsed: 2, remoteAiMax: 2 } }));
  assert.equal(r.decision, "HOLD");
  assert.match(r.reason, /2\/1\/1 governor/);
});

test("holds on network pressure and on exhausted budget", () => {
  assert.equal(assessReadiness(okItem(), okCtx({ network: "NETWORK_PRESSURE" })).decision, "HOLD");
  assert.equal(assessReadiness(okItem(), okCtx({ budgetRemainingUsd: 0 })).decision, "HOLD");
});

test("no-overnight window holds (supervised pilot)", () => {
  assert.equal(assessReadiness(okItem(), okCtx({ overnight: true })).decision, "HOLD");
});

test("dedup: the same item at the same SHA does not re-fire", () => {
  const r = assessReadiness(okItem(), okCtx({ lastRun: { itemId: "W-1", sha: "abc" } }));
  assert.equal(r.decision, "HOLD");
  assert.match(r.reason, /dedup/);
  // a new SHA re-enables the trigger
  assert.equal(assessReadiness(okItem({ sha: "def" }), okCtx({ lastRun: { itemId: "W-1", sha: "abc" } })).decision, "TRIGGER");
});

test("nothing READY → CHECKPOINT, not a trigger", () => {
  assert.equal(assessReadiness(null, okCtx()).decision, "CHECKPOINT");
  assert.equal(assessReadiness(okItem({ status: "OWNER_DECISION" }), okCtx()).decision, "CHECKPOINT");
});

test("a MANUAL runtime trigger is recorded distinctly from AUTOMATIC", () => {
  const r = assessReadiness(okItem(), okCtx({ triggerKind: "MANUAL_RUNTIME_TRIGGER" }));
  assert.equal(r.triggerMechanism, "MANUAL");
  assert.equal(r.triggerKind, "MANUAL_RUNTIME_TRIGGER");
  assert.ok(TRIGGER_KINDS.includes(r.triggerKind) && TRIGGER_MECHANISMS.includes(r.triggerMechanism));
});

test("backoff is exponential and capped", () => {
  assert.equal(nextBackoffMs(0), 60_000);
  assert.equal(nextBackoffMs(3), 480_000);
  assert.equal(nextBackoffMs(99), 900_000); // capped
});

test("the constructed invocation is fully guardrailed and never uses bypass permissions", () => {
  const inv = buildClaudeInvocation({ contextPackage: { role: "worker", scope: ["orchestration"] } });
  assert.equal(inv.bin, "claude");
  const s = inv.argv.join(" ");
  assert.match(s, /--permission-mode dontAsk/);
  assert.match(s, /--max-budget-usd 2/);
  assert.match(s, /--max-turns 40/);
  assert.match(s, /--output-format json/);
  assert.ok(!/bypass|dangerously/i.test(s), "must never use bypass/dangerous permissions");
  assert.ok(inv.argv.includes("--allowedTools") && !s.includes("WebFetch") || s.includes("--disallowedTools WebFetch"));
  assert.ok(inv.wallClockSec >= 1);
  assert.throws(() => buildClaudeInvocation({}), /contextPackage is required/); // must bootstrap via the shared package
});
