import test from "node:test";
import assert from "node:assert/strict";
import { selectNextQueuedRequest } from "./agentManager.mjs";
import { buildShadowInput, buildShadowStatus, computeAgentManagerRecommendation, verifyShadowStatus } from "./integrationShadow.mjs";

const item = (requestId, over = {}) => ({
  requestId, target: { repo: "TaylorService-spec/Taylor_Parts", branch: "main" },
  approvedArtifact: { kind: "PATCH", location: `results/${requestId}.patch`, sha256: "a".repeat(64) },
  priority: 50, integrityPriority: "NORMAL", dependencies: [], paths: [`src/${requestId}.mjs`], overlappingPaths: [],
  verificationState: "PASS", scopeState: "PASS", hashState: "PASS", approvalState: "APPROVED", integrationReadiness: "READY", blocker: null, ...over,
});
const backlog = (items) => ({ schema: "agent-manager.integration-backlog/1", items });
const meta = { generatedAt: "2026-08-12T23:40:00Z", sourceCommit: "a".repeat(40) };

test("Claude Agent Manager path works when shadow provider is absent", () => {
  assert.equal(selectNextQueuedRequest([{ requestId: "claude", status: "PENDING", blocking: false, priority: 1 }]).requestId, "claude");
  const status = buildShadowStatus({ backlog: backlog([]), ...meta });
  assert.equal(status.availability, "UNAVAILABLE");
  assert.equal(status.agreement, "NOT_EVALUATED");
});

test("normal shadow recommendation matches Agent Manager", () => {
  const state = backlog([item("security", { integrityPriority: "SECURITY" }), item("normal")]);
  const recommendation = computeAgentManagerRecommendation(state);
  const status = buildShadowStatus({ backlog: state, shadowRecommendation: recommendation, ...meta });
  assert.equal(status.agreement, "MATCH");
  assert.equal(status.agentManager.nextByTarget["TaylorService-spec/Taylor_Parts#main"], "security");
  assert.ok(verifyShadowStatus(status));
});

test("dependency, conflict, blocker, and cycle evidence remains fail-closed", () => {
  const state = backlog([
    item("cycle-a", { dependencies: ["cycle-b"] }), item("cycle-b", { dependencies: ["cycle-a"] }),
    item("blocked", { verificationState: "PENDING" }),
    item("conflict-a", { paths: ["src/shared.mjs"], priority: 1 }), item("conflict-b", { paths: ["src/shared.mjs"], priority: 2 }),
  ]);
  const recommendation = computeAgentManagerRecommendation(state);
  assert.deepEqual(recommendation.orderedRequestIds, ["conflict-a", "conflict-b"]);
  assert.equal(recommendation.conflicts.length, 2);
  assert.ok(recommendation.blockers.some((entry) => entry.requestId === "cycle-a" && /cycle/.test(entry.blocker)));
  assert.deepEqual(recommendation.waitingOnGates.map((entry) => entry.requestId), ["blocked"]);
});

test("shadow input cannot mutate or authorize integration", () => {
  const state = backlog([item("one")]);
  const before = JSON.stringify(state);
  const input = buildShadowInput(state);
  assert.throws(() => { input.backlog.items[0].priority = 1; }, TypeError);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(input.capabilities, { mutateBacklog: false, authorize: false, integrate: false, routeClaude: false });
  const disagreement = buildShadowStatus({ backlog: state, shadowRecommendation: { orderedRequestIds: [] }, ...meta });
  assert.equal(disagreement.agreement, "DISAGREEMENT");
  assert.ok(disagreement.disagreementEvidence);
  assert.ok(Object.values(disagreement.capabilities).every((value) => value === false));
});
