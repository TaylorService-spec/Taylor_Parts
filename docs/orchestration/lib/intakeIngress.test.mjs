import { test } from "node:test";
import assert from "node:assert/strict";
import { assessIntakeExecution, assessCapability, ingestIntake, CAPABILITIES } from "./intakeIngress.mjs";
import { intakeDigest, stableJson } from "./workIntake.mjs";

const NOW = "2026-08-11T06:00:00Z";

// Build a valid, hash-correct intake artifact for a given status/authority.
function artifact(over = {}) {
  const base = {
    requestId: over.requestId || "EOS-TEST-001",
    title: "t", intent: "i",
    scope: ["docs/orchestration/work-intake/"],
    contextScope: ["orchestration"],
    source: { producer: "Owner/ChatGPT", provenance: "test" },
    status: over.status || "DESIGN_STAGING",
    authority: over.authority || { authorizationState: "REPO_SAFE", basis: "b", protectedBoundary: null },
    artifactLocation: `docs/orchestration/work-intake/${over.requestId || "EOS-TEST-001"}.work.json`,
    createdAt: "2026-08-11T05:00:00Z", updatedAt: "2026-08-11T05:00:00Z",
    relatedRefs: { issues: [], pullRequests: [] },
  };
  const sha256 = intakeDigest(base);
  return { ...base, sha256 };
}
const bytesOf = (a) => Buffer.from(JSON.stringify(a), "utf8");

test("intake-state gate: only EXECUTION_AUTHORIZED + AUTHORIZED (no protected boundary) may execute", () => {
  assert.equal(assessIntakeExecution(artifact({ status: "DESIGN_STAGING" })).mayExecute, false);
  assert.equal(assessIntakeExecution(artifact({ status: "DISCOVERY" })).mayExecute, false);
  assert.equal(assessIntakeExecution(artifact({ status: "EOS_READY" })).mayExecute, false);
  const authd = artifact({ status: "EXECUTION_AUTHORIZED", authority: { authorizationState: "AUTHORIZED", basis: "owner", protectedBoundary: null } });
  assert.equal(assessIntakeExecution(authd).mayExecute, true);
  // EXECUTION_AUTHORIZED but not independently AUTHORIZED → refused
  assert.equal(assessIntakeExecution(artifact({ status: "EXECUTION_AUTHORIZED", authority: { authorizationState: "REPO_SAFE", basis: "b", protectedBoundary: null } })).mayExecute, false);
});

test("intake-state gate: EOS_READY is selector-eligible but explicitly NOT execution authority", () => {
  const g = assessIntakeExecution(artifact({ status: "EOS_READY" }));
  assert.equal(g.mayEnterSelector, true);
  assert.equal(g.mayExecute, false);
  assert.match(g.reason, /EOS_READY is selector-eligible but is NOT execution authority/);
});

test("intake-state gate: OWNER_REQUIRED surfaces an owner gate", () => {
  const g = assessIntakeExecution(artifact({ status: "EXECUTION_AUTHORIZED", authority: { authorizationState: "OWNER_REQUIRED", basis: "b", protectedBoundary: null, ownerQuestion: "ok?" } }));
  assert.equal(g.ownerRequired, true);
  assert.equal(g.mayExecute, false);
});

test("capability seam: no broker → NEEDS_ACTIVATION (fail-closed); it never returns a secret", () => {
  const c = assessCapability({ name: "OPENAI_REVIEW", broker: null });
  assert.equal(c.available, false);
  assert.equal(c.state, "NEEDS_ACTIVATION");
  assert.match(c.reason, /Secret Broker is not present/);
  // the seam only reports availability — no key/secret field anywhere
  assert.ok(!("secret" in c) && !("key" in c) && !("token" in c));
  assert.equal(assessCapability({ name: "OPENAI_REVIEW", broker: { hasCapability: (n) => n === "OPENAI_REVIEW" } }).available, true);
  assert.equal(assessCapability({ name: "NOPE", broker: null }).state, "UNKNOWN_CAPABILITY");
  assert.deepEqual([...CAPABILITIES], ["OPENAI_REVIEW"]);
});

test("capability seam accepts the MERGED Secret Broker (credentialStatus) — availability only, no key", () => {
  // The #790 broker shape: credentialStatus returns { credentialAvailable, secretValue: "REDACTED" }.
  const available = { credentialStatus: (n) => ({ capability: n, credentialAvailable: true, credentialId: "eos-openai-review", secretValue: "REDACTED" }) };
  const missing = { credentialStatus: () => ({ credentialAvailable: false, secretValue: "REDACTED" }) };
  const a = assessCapability({ name: "OPENAI_REVIEW", broker: available });
  assert.equal(a.available, true);
  assert.equal(a.state, "AVAILABLE");
  assert.match(a.reason, /withCredential still gates the spend/);
  assert.equal(assessCapability({ name: "OPENAI_REVIEW", broker: missing }).available, false);
  // no secret ever surfaces from the seam
  assert.ok(!JSON.stringify(a).match(/sk-|OPENAI_API_KEY|Bearer/));
});

test("ingestIntake (DESIGN_STAGING): resolves, projects, STAGED status, does not execute", () => {
  const a = artifact({ status: "DESIGN_STAGING" });
  const r = ingestIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes: bytesOf(a), now: NOW });
  assert.equal(r.gate.mayExecute, false);
  assert.equal(r.status.state, "STAGED");
  assert.equal(r.item.workstream, "EOS_INTAKE");
  assert.equal(r.blockedByCapability, false);
  // capabilities are not even assessed for a non-executable stage
  assert.deepEqual(r.capabilities, []);
});

test("ingestIntake (EXECUTION_AUTHORIZED, requires OPENAI_REVIEW, no broker): BLOCKED, not executed", () => {
  const a = artifact({ status: "EXECUTION_AUTHORIZED", authority: { authorizationState: "AUTHORIZED", basis: "owner", protectedBoundary: null } });
  const r = ingestIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes: bytesOf(a), now: NOW, requiresCapabilities: ["OPENAI_REVIEW"], capabilityBroker: null });
  assert.equal(r.gate.mayExecute, true);
  assert.equal(r.blockedByCapability, true);
  assert.equal(r.status.state, "BLOCKED");
});

test("ingestIntake fails closed on a hash mismatch (tampered bytes)", () => {
  const a = artifact({ status: "DESIGN_STAGING" });
  const tampered = { ...a, title: "changed after hashing" };
  assert.throws(() => ingestIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes: bytesOf(tampered), now: NOW }), /hash mismatch/);
});

test("ingestIntake creates NO second queue — it projects a single item through the existing selectNextWork", () => {
  const a = artifact({ status: "EOS_READY" });
  let receivedItems = null;
  const selectFn = (items) => { receivedItems = items; return { decision: "RUN", item: items[0] }; };
  const r = ingestIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes: bytesOf(a), now: NOW, selectFn });
  assert.equal(receivedItems.length, 1, "exactly one projected item handed to the EXISTING selector");
  assert.equal(r.selection.decision, "RUN");
  assert.equal(r.status.state, "READY");
});
