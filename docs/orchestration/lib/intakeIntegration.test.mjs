// Integration proof for the ChatGPT → GitHub → EOS → status/result loop. Fake/injected workers only —
// NO network, NO model, NO OpenAI call, $0. Covers the two required flows (harmless DESIGN_STAGING; a
// tiny EXECUTION_AUTHORIZED fixture through selector → worker → result → COMPLETE) plus the security and
// determinism proofs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { intakeDigest, sha256Bytes, buildContentAddressedResult } from "./workIntake.mjs";
import { ingestIntake, assessCapability } from "./intakeIngress.mjs";
import { buildIntakeStatus, buildResultIndex, verifyIntakeStatus, resolvePointer, statusLocation, resultIndexLocation } from "./intakeStatus.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = "2026-08-11T06:00:00Z";
const bytesOf = (a) => Buffer.from(JSON.stringify(a), "utf8");

// The ACTUAL artifact ChatGPT submitted on branch chatgpt/eos-intake-cc-001 (PR #791) — note its embedded
// sha256 is the value ChatGPT computed, which does NOT match the EOS canonical digest.
const CHATGPT_SUBMITTED = {
  requestId: "EOS-CHATGPT-CC-001",
  title: "Control Center owner dashboard information architecture",
  intent: "Stage the approved Control Center redesign: keep the front Dashboard limited to system health, Owner needs, active work, and stuck/cost signals; organize detailed information into purpose-specific Work, Decisions, AI & Agents, Governance, Costs, and System tabs. This is design staging only; no implementation authorization.",
  scope: ["docs/orchestration/work-intake/", "project-keystone/apps/control-center/"],
  contextScope: ["orchestration"],
  source: { producer: "Owner/ChatGPT", provenance: "Owner requested a harmless DESIGN_STAGING submission through the ChatGPT→GitHub→EOS intake bridge." },
  status: "DESIGN_STAGING",
  authority: { authorizationState: "REPO_SAFE", basis: "Owner authorized staging only; implementation/execution is not authorized.", protectedBoundary: null },
  artifactLocation: "docs/orchestration/work-intake/EOS-CHATGPT-CC-001.work.json",
  sha256: "3163f0e4a8c5cd41494bc8fc1fa4c506ac3c38f14967143b0ff1da6b65aee9d9",
  createdAt: "2026-08-11T05:32:00Z",
  updatedAt: "2026-08-11T05:32:00Z",
  relatedRefs: { issues: [], pullRequests: [] },
};

test("STAGING TEST (real #791 bytes): ChatGPT's submitted hash mismatches → EOS fails closed (no execution)", () => {
  assert.notEqual(CHATGPT_SUBMITTED.sha256, intakeDigest(CHATGPT_SUBMITTED), "the submitted hash is not the EOS canonical digest");
  assert.throws(() => ingestIntake({
    requestId: CHATGPT_SUBMITTED.requestId, location: CHATGPT_SUBMITTED.artifactLocation,
    sha256: CHATGPT_SUBMITTED.sha256, bytes: bytesOf(CHATGPT_SUBMITTED), now: NOW,
  }), /hash mismatch/);
});

test("STAGING TEST (corrected artifact, committed): resolve → STAGED → no execution → deterministic refs, $0", () => {
  const location = "docs/orchestration/work-intake/EOS-CHATGPT-CC-001.work.json";
  const bytes = readFileSync(join(REPO, location));
  const a = JSON.parse(bytes);
  const r = ingestIntake({ requestId: "EOS-CHATGPT-CC-001", location, sha256: a.sha256, bytes, now: NOW, sourceCommit: "abc1234" });
  assert.equal(r.artifact.status, "DESIGN_STAGING");
  assert.equal(r.gate.mayExecute, false, "DESIGN_STAGING must not execute");
  assert.equal(r.status.state, "STAGED");
  assert.equal(verifyIntakeStatus(r.status).ok, true);
  // deterministic, ChatGPT-readable references derivable from the requestId alone
  assert.equal(r.status.artifactLocation, statusLocation("EOS-CHATGPT-CC-001"));
  assert.equal(resolvePointer(r.status.pointer).location, statusLocation("EOS-CHATGPT-CC-001"));
  assert.equal(resolvePointer(r.status.result).resultIndexLocation, resultIndexLocation("EOS-CHATGPT-CC-001"));
  assert.equal(r.status.result, "result://EOS-CHATGPT-CC-001");
  // no worker ran, no cost
  assert.equal(r.status.actualProviderCostUsd, "UNKNOWN");
  assert.equal(r.status.estimatedExecutionCostUsd, null);
  assert.equal(r.status.activeWorker, null);
});

test("EXECUTION TEST (fake workers): AUTHORIZED intake → selector → worker → result → COMPLETE, no live call", () => {
  // A tiny repo-safe EXECUTION_AUTHORIZED fixture.
  const payload = {
    requestId: "EOS-EXEC-TEST-001", title: "echo a fixed line", intent: "write a deterministic result file",
    scope: ["docs/orchestration/work-intake/"], contextScope: ["orchestration"],
    source: { producer: "Owner", provenance: "test fixture" },
    status: "EXECUTION_AUTHORIZED",
    authority: { authorizationState: "AUTHORIZED", basis: "test fixture — repo-safe echo worker", protectedBoundary: null },
    artifactLocation: "docs/orchestration/work-intake/EOS-EXEC-TEST-001.work.json",
    createdAt: "2026-08-11T05:00:00Z", updatedAt: "2026-08-11T05:00:00Z", relatedRefs: { issues: [], pullRequests: [] },
  };
  const a = { ...payload, sha256: intakeDigest(payload) };

  // 1) ingest — authorized, no paid capability required, selector eligible
  const ing = ingestIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes: bytesOf(a), now: NOW });
  assert.equal(ing.gate.mayExecute, true);
  assert.equal(ing.item.authorized, true);

  // 2) FAKE worker runs (no model): produces deterministic output bytes
  const outputBytes = Buffer.from("# EOS-EXEC-TEST-001 result\n\nEcho worker wrote this deterministic line.\n", "utf8");
  const result = buildContentAddressedResult({ request: ing.artifact, outputBytes, status: "COMPLETE", summary: "echo worker completed", createdAt: NOW });

  // 3) result hash verifies (content address = sha256 of normalized content)
  assert.equal(result.manifest.contentSha256, sha256Bytes(result.content));
  assert.match(result.manifest.contentLocation, /results\/EOS-EXEC-TEST-001\//);

  // 4) deterministic result index points at the exact content-addressed manifest
  const index = buildResultIndex({ requestId: a.requestId, manifestLocation: result.manifestLocation, manifestSha256: result.manifest.sha256, contentLocation: result.contentLocation, updatedAt: NOW });
  assert.equal(index.artifactLocation, resultIndexLocation("EOS-EXEC-TEST-001"));

  // 5) COMPLETE status carries the resultRef so result:// resolves from the deterministic status
  const status = buildIntakeStatus({
    requestId: a.requestId, state: "COMPLETE", updatedAt: NOW,
    activeWorker: "echo-worker", costToDateUsd: 0,
    workArtifact: { location: a.artifactLocation, sha256: a.sha256 },
    resultRef: { location: result.manifestLocation, sha256: result.manifest.sha256 },
  });
  assert.equal(status.state, "COMPLETE");
  assert.equal(verifyIntakeStatus(status).ok, true);
  assert.equal(status.resultRef.pointer, "result://EOS-EXEC-TEST-001");
  assert.equal(status.resultRef.sha256, result.manifest.sha256);
});

test("Secret Broker seam: paid capability blocks without a broker; staging/read-only never need it", () => {
  // paid path with no broker → blocked
  assert.equal(assessCapability({ name: "OPENAI_REVIEW", broker: null }).available, false);
  // with a broker that has the capability → available (the credential itself never appears here)
  const c = assessCapability({ name: "OPENAI_REVIEW", broker: { hasCapability: () => true } });
  assert.equal(c.available, true);
  assert.ok(!JSON.stringify(c).match(/sk-|key|secret|token|Bearer/i));
});

test("no API key / secret ever appears in any produced artifact", () => {
  const location = "docs/orchestration/work-intake/EOS-CHATGPT-CC-001.work.json";
  const bytes = readFileSync(join(REPO, location));
  const a = JSON.parse(bytes);
  const r = ingestIntake({ requestId: "EOS-CHATGPT-CC-001", location, sha256: a.sha256, bytes, now: NOW });
  const blob = JSON.stringify(r.status);
  assert.doesNotMatch(blob, /sk-[A-Za-z0-9]|AIza|Bearer |OPENAI_API_KEY|api[_-]?key/i);
});
