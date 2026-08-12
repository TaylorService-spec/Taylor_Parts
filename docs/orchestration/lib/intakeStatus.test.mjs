import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_STATE, statusLocation, resultIndexLocation, resolvePointer,
  deriveStatusState, buildIntakeStatus, verifyIntakeStatus, buildResultIndex,
  reviewReadyLocation, buildReviewReady,
} from "./intakeStatus.mjs";

const NOW = "2026-08-11T06:00:00Z";

test("deterministic locations are derivable from the requestId alone (ChatGPT-readable, no search)", () => {
  assert.equal(statusLocation("EOS-CHATGPT-CC-001"), "docs/orchestration/work-intake/status/EOS-CHATGPT-CC-001.status.json");
  assert.equal(resultIndexLocation("EOS-123"), "docs/orchestration/work-intake/results/EOS-123/latest.result.json");
  assert.throws(() => statusLocation("bad id"), /invalid requestId/);
});

test("resolvePointer maps status:// / result:// / work:// to deterministic paths + siblings", () => {
  const s = resolvePointer("status://EOS-123");
  assert.equal(s.kind, "status");
  assert.equal(s.location, "docs/orchestration/work-intake/status/EOS-123.status.json");
  const r = resolvePointer("result://EOS-123");
  assert.equal(r.location, "docs/orchestration/work-intake/results/EOS-123/latest.result.json");
  // every pointer exposes the sibling status/result paths so one read reaches the others
  assert.equal(s.resultIndexLocation, r.location);
  assert.throws(() => resolvePointer("https://evil"), /not a work\/status\/result pointer/);
});

test("deriveStatusState: staging never reports executing; owner/blocked/worker take precedence", () => {
  assert.equal(deriveStatusState({ intakeStatus: "DESIGN_STAGING", authorizationState: "REPO_SAFE" }), "STAGED");
  assert.equal(deriveStatusState({ intakeStatus: "DISCOVERY", authorizationState: "REPO_SAFE" }), "STAGED");
  assert.equal(deriveStatusState({ intakeStatus: "EOS_READY", authorizationState: "REPO_SAFE" }), "READY");
  assert.equal(deriveStatusState({ intakeStatus: "EXECUTION_AUTHORIZED", authorizationState: "AUTHORIZED" }), "READY");
  assert.equal(deriveStatusState({ intakeStatus: "EXECUTION_AUTHORIZED", authorizationState: "OWNER_REQUIRED" }), "OWNER_REQUIRED");
  assert.equal(deriveStatusState({ intakeStatus: "EXECUTION_AUTHORIZED", authorizationState: "AUTHORIZED", capability: { available: false } }), "BLOCKED");
  assert.equal(deriveStatusState({ intakeStatus: "EXECUTION_AUTHORIZED", authorizationState: "AUTHORIZED", worker: { phase: "ACTIVE" } }), "ACTIVE");
  assert.equal(deriveStatusState({ intakeStatus: "EXECUTION_AUTHORIZED", authorizationState: "AUTHORIZED", worker: { phase: "COMPLETE" } }), "COMPLETE");
});

test("buildIntakeStatus produces a compact, self-verifying artifact at the deterministic path", () => {
  const s = buildIntakeStatus({
    requestId: "EOS-123", state: "STAGED", currentWork: "design only", updatedAt: NOW,
    workArtifact: { location: "docs/orchestration/work-intake/EOS-123.work.json", sha256: "a".repeat(64) },
    provenance: { producer: "Owner/ChatGPT" },
  });
  assert.equal(s.artifactLocation, "docs/orchestration/work-intake/status/EOS-123.status.json");
  assert.equal(s.pointer, "status://EOS-123");
  assert.equal(s.work, "work://EOS-123");
  assert.equal(s.result, "result://EOS-123");
  assert.equal(verifyIntakeStatus(s).ok, true);
  // tamper → fail closed
  assert.equal(verifyIntakeStatus({ ...s, state: "COMPLETE" }).ok, false);
});

test("buildIntakeStatus: COMPLETE requires a resultRef; ownerActionRequired requires a question", () => {
  assert.throws(() => buildIntakeStatus({ requestId: "EOS-1", state: "COMPLETE", updatedAt: NOW }), /COMPLETE requires a resultRef/);
  assert.throws(() => buildIntakeStatus({ requestId: "EOS-1", state: "OWNER_REQUIRED", updatedAt: NOW, ownerActionRequired: true }), /ownerActionRequired needs an ownerQuestion/);
  const done = buildIntakeStatus({ requestId: "EOS-1", state: "COMPLETE", updatedAt: NOW, resultRef: { location: "docs/orchestration/work-intake/results/EOS-1/x.result.json", sha256: "b".repeat(64) } });
  assert.equal(done.resultRef.pointer, "result://EOS-1");
  assert.ok(STATUS_STATE.includes(done.state));
});

test("buildResultIndex is a deterministic pointer into the content-addressed manifest", () => {
  const idx = buildResultIndex({ requestId: "EOS-1", manifestLocation: "docs/orchestration/work-intake/results/EOS-1/deadbeef.result.json", manifestSha256: "c".repeat(64), updatedAt: NOW });
  assert.equal(idx.artifactLocation, "docs/orchestration/work-intake/results/EOS-1/latest.result.json");
  assert.equal(idx.pointer, "result://EOS-1");
  assert.equal(idx.manifestSha256, "c".repeat(64));
});

test("REVIEW_READY: deterministic signal path derivable from the workId alone", () => {
  assert.equal(reviewReadyLocation("TAYLOR-SITE-AUDIT-802"), "docs/orchestration/work-intake/review-ready/TAYLOR-SITE-AUDIT-802.json");
  assert.throws(() => reviewReadyLocation("bad id"), /invalid requestId/);
});

test("REVIEW_READY signal is minimal by contract: exactly event + workId + artifact + commit (+schema tag)", () => {
  const sig = buildReviewReady({ requestId: "TAYLOR-SITE-AUDIT-802", artifact: "docs/audits/taylor-site-audit-802/master-audit.md", commit: "936fe4a" });
  assert.deepEqual(Object.keys(sig).sort(), ["artifact", "commit", "event", "schema", "workId"]);
  assert.equal(sig.event, "REVIEW_READY");
  assert.equal(sig.workId, "TAYLOR-SITE-AUDIT-802");
  assert.equal(sig.artifact, "docs/audits/taylor-site-audit-802/master-audit.md");
  assert.equal(sig.commit, "936fe4a");
  // carries no content/summary/telemetry — the repo is the payload
  const blob = JSON.stringify(sig);
  assert.ok(!/summary|cost|token|content|usage/i.test(blob), "signal must carry no substance");
});

test("REVIEW_READY commit is optional (null ⇒ retrieve from default-branch HEAD) and validated when present", () => {
  const sig = buildReviewReady({ requestId: "EOS-1", artifact: "docs/orchestration/work-intake/results/EOS-1/ab.content.md" });
  assert.equal(sig.commit, null);
  assert.throws(() => buildReviewReady({ requestId: "EOS-1", artifact: "" }), /artifact/);
  assert.throws(() => buildReviewReady({ requestId: "bad id", artifact: "x" }), /invalid requestId/);
  assert.throws(() => buildReviewReady({ requestId: "EOS-1", artifact: "x", commit: "nope!" }), /commit must be a git sha/);
});
