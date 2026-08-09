// Tests for the Shared Agent Manager stack (request/result contracts, resource
// governor, network state, dispatcher). Run:
//   node --test docs/orchestration/lib/agentManager.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRequest, validateAgentRequest, requestFingerprint } from "./agentRequest.mjs";
import { createAgentResult, validateAgentResult, isReusableResult } from "./agentResult.mjs";
import { CAPACITY, classifyResourceNeed, allocate, capacitySnapshot } from "./resourceGovernor.mjs";
import { transition, remotePolicy } from "./networkState.mjs";
import { decideDispatch, findEquivalentResult, selectNextQueuedRequest, efficiencyMetrics } from "./agentManager.mjs";

const req = (over = {}) => createAgentRequest({ requestId: "r1", requestedByWorkstream: "Design", purpose: "verify X", outputContract: "PASS/FAIL", ...over });

// --- Request contract ---
test("a well-formed request validates; missing required fields are caught", () => {
  assert.deepEqual(validateAgentRequest(req()), []);
  assert.ok(validateAgentRequest(createAgentRequest({ requestId: "r" })).length > 0); // no workstream/purpose/outputContract
});

test("requiresBrowser implies REMOTE execution", () => {
  const bad = createAgentRequest({ requestId: "r", requestedByWorkstream: "UX", purpose: "p", outputContract: "o", requiresBrowser: true, execution: "LOCAL" });
  assert.ok(validateAgentRequest(bad).some((e) => /requiresBrowser implies/.test(e)));
});

test("fingerprint is stable across id/priority and ignores ordering of surfaces", () => {
  const a = req({ requestId: "a", priority: 1, allowedSurfaces: ["x", "y"] });
  const b = req({ requestId: "b", priority: 9, allowedSurfaces: ["y", "x"] });
  assert.equal(requestFingerprint(a), requestFingerprint(b));
});

// --- Result contract ---
test("result validates and reusability excludes contaminated/retracted/failed", () => {
  const good = createAgentResult({ resultId: "res1", requestId: "r1", routedBackTo: "Design", status: "COMPLETE", verdict: "PASS" });
  assert.deepEqual(validateAgentResult(good), []);
  assert.ok(isReusableResult(good));
  assert.ok(!isReusableResult(createAgentResult({ resultId: "x", requestId: "r1", routedBackTo: "Design", status: "COMPLETE", retracted: true })));
  assert.ok(!isReusableResult(createAgentResult({ resultId: "x", requestId: "r1", routedBackTo: "Design", status: "FAILED" })));
});

test("result never fabricates tokens — metrics.tokens only when a number", () => {
  const r = createAgentResult({ resultId: "res", requestId: "r1", routedBackTo: "Design" });
  assert.equal(r.metrics.tokens, undefined); // absent, not zero
});

// --- Resource governor ---
test("LOCAL work consumes no REMOTE_AI slot; REMOTE work consumes one", () => {
  assert.equal(classifyResourceNeed(req({ execution: "LOCAL" })).remoteAi, 0);
  assert.equal(classifyResourceNeed(req({ execution: "REMOTE" })).remoteAi, 1);
});

test("global REMOTE_AI cap = 2; the 3rd concurrent remote agent waits", () => {
  const need = classifyResourceNeed(req());
  const two = [need, need];
  assert.equal(allocate(two, need).decision, "WAIT_RESOURCE");
  assert.deepEqual(allocate(two, need).waitingOn, ["REMOTE_AI"]);
  assert.equal(allocate([need], need).decision, "GRANT"); // 2nd is fine
});

test("browser cap = 1 and mutating remote is sequential (cap 1)", () => {
  const browser = classifyResourceNeed(req({ requiresBrowser: true }));
  assert.equal(allocate([browser], browser).waitingOn.includes("BROWSER_REMOTE"), true);
  const mut = classifyResourceNeed(req({ mutating: true }));
  assert.equal(allocate([mut], mut).waitingOn.includes("MUTATING_REMOTE"), true);
});

test("capacitySnapshot reports used/total per resource", () => {
  const snap = capacitySnapshot([classifyResourceNeed(req())]);
  assert.deepEqual(snap.remoteAi, { used: 1, total: CAPACITY.REMOTE_AI });
});

// --- Network state ---
test("network transitions: unavailable → recovery → normal only after a stability window", () => {
  let s = "NORMAL";
  s = transition(s, "UNAVAILABLE_DETECTED"); assert.equal(s, "NETWORK_UNAVAILABLE");
  s = transition(s, "RECOVERED"); assert.equal(s, "RECOVERY");
  s = transition(s, "STABILITY_WINDOW_ELAPSED"); assert.equal(s, "NORMAL");
});

test("no new remote work while unavailable/recovery; local always continues; no aggressive retry", () => {
  assert.equal(remotePolicy("NETWORK_UNAVAILABLE").allowNewRemote, false);
  assert.equal(remotePolicy("NETWORK_UNAVAILABLE").continueLocal, true);
  assert.equal(remotePolicy("NETWORK_UNAVAILABLE").retry, "NONE");
  assert.equal(remotePolicy("RECOVERY").allowNewRemote, false);
  assert.equal(remotePolicy("NORMAL").allowNewRemote, true);
});

// --- Dispatcher ---
test("invalid request → REJECT_INVALID", () => {
  const d = decideDispatch({ request: createAgentRequest({ requestId: "x" }) });
  assert.equal(d.decision, "REJECT_INVALID");
});

test("equivalent existing result → DEDUPE_REUSE (avoid rerun when nothing changed)", () => {
  const request = req();
  const requestsById = new Map([["r1", request]]);
  const results = [createAgentResult({ resultId: "res", requestId: "r1", routedBackTo: "Design", status: "COMPLETE" })];
  const again = req({ requestId: "r2" }); // same fingerprint, different id
  const d = decideDispatch({ request: again, results, requestsById });
  assert.equal(d.decision, "DEDUPE_REUSE");
});

test("remote request while NETWORK_UNAVAILABLE → WAIT_NETWORK (local would still dispatch)", () => {
  assert.equal(decideDispatch({ request: req(), networkState: "NETWORK_UNAVAILABLE" }).decision, "WAIT_NETWORK");
  assert.equal(decideDispatch({ request: req({ requestId: "r9", execution: "LOCAL" }), networkState: "NETWORK_UNAVAILABLE" }).decision, "DISPATCH");
});

test("no free slot → READY_BUT_WAITING_RESOURCE; else DISPATCH", () => {
  const need = classifyResourceNeed(req());
  assert.equal(decideDispatch({ request: req(), allocations: [need, need] }).decision, "READY_BUT_WAITING_RESOURCE");
  assert.equal(decideDispatch({ request: req() }).decision, "DISPATCH");
});

test("queue selection: blocking first, then priority, then declared order", () => {
  const requests = [
    req({ requestId: "a", priority: 1, blocking: false }),
    req({ requestId: "b", priority: 9, blocking: true }),
    req({ requestId: "c", priority: 2, blocking: false }),
  ];
  assert.equal(selectNextQueuedRequest(requests).requestId, "b"); // blocking wins despite worse priority
});

test("efficiency metrics derive from durable records; tokens only where reported", () => {
  const requests = [req({ requestId: "a", status: "PENDING" }), req({ requestId: "b", status: "DEDUPED" })];
  const results = [createAgentResult({ resultId: "res", requestId: "a", routedBackTo: "Design", findings: ["f1", "f2"], metrics: { tokens: 1000 } })];
  const m = efficiencyMetrics(requests, results);
  assert.equal(m.requestsCreated, 2);
  assert.equal(m.dedupedOrReused, 1);
  assert.equal(m.acceptedFindings, 2);
  assert.equal(m.tokensReported, 1);
  assert.equal(m.tokensTotal, 1000);
});
