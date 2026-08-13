// ACCEPTANCE TEST — the whole ChatGPT → GitHub → EOS → status/result loop, end to end, with injected fakes
// (no network, no model, no key, $0). Proves every arrow of the acceptance criteria in ONE non-interactive
// call chain: no Owner PowerShell, no Claude GUI — the loop is code + injected worker.
//
//   valid work:// item  →  EOS validates automatically  →  status:// appears automatically
//   →  EXECUTION_AUTHORIZED wakes the (injected) Claude worker automatically  →  worker completes
//   →  result:// appears automatically  →  status/result readable at deterministic GitHub paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { intakeDigest, resolveWorkIntake, sha256Bytes } from "./workIntake.mjs";
import { ingestIntake } from "./intakeIngress.mjs";
import { executeIntakeItem } from "../context/intake-runtime.mjs";
import { statusLocation, resultIndexLocation, resolvePointer, verifyIntakeStatus } from "./intakeStatus.mjs";

const NOW = "2026-08-11T08:00:00Z";

// A valid EXECUTION_AUTHORIZED intake, as ChatGPT would produce it (correct producer hash recipe).
function chatgptSubmission() {
  const payload = {
    requestId: "EOS-ACCEPT-001", title: "repo-safe echo work", intent: "produce a deterministic result document",
    scope: ["docs/orchestration/work-intake/"], contextScope: ["orchestration"],
    source: { producer: "Owner/ChatGPT", provenance: "ChatGPT created via the GitHub connector" },
    status: "EXECUTION_AUTHORIZED",
    authority: { authorizationState: "AUTHORIZED", basis: "Owner authorized this repo-safe execution", protectedBoundary: null },
    artifactLocation: "docs/orchestration/work-intake/EOS-ACCEPT-001.work.json",
    createdAt: "2026-08-11T07:00:00Z", updatedAt: "2026-08-11T07:00:00Z", relatedRefs: { issues: [], pullRequests: [] },
  };
  return { ...payload, sha256: intakeDigest(payload) };
}

// Injected fakes standing in for GitHub (bytes), the paid worker (deterministic), the lease, and C-7.
const fakeWorker = () => ({ run: () => ({ stdout: JSON.stringify({ result: "# EOS-ACCEPT-001\nThe worker completed the authorized repo-safe task.\n", total_cost_usd: 0 }), exitCode: 0, timedOut: false }) });
const fakeLease = () => { let held = false; return { acquire: () => (!held ? (held = true, { acquired: true }) : { acquired: false }), release: () => { held = false; } }; };
const ctxPkgFn = () => ({ sufficiency: "SUFFICIENT", governingAuthority: "auth", required: [{ id: "auth", retrievalPath: "x.md" }], onDemand: [], provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } });
const FREE_SLOT = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: 5, sourceFreshness: "CURRENT" };

test("ACCEPTANCE: ChatGPT work:// → validate → status:// → wake → complete → result://, no PowerShell/GUI", () => {
  const a = chatgptSubmission();
  const bytes = Buffer.from(JSON.stringify(a), "utf8");
  const repo = new Map();               // stands in for the GitHub repo tree
  repo.set(a.artifactLocation, bytes);

  // (1) EOS validates automatically (fail-closed resolve) + (2) status:// derivable + appears
  const ingress = ingestIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes, now: NOW });
  assert.equal(ingress.artifact.status, "EXECUTION_AUTHORIZED");
  assert.equal(ingress.gate.mayExecute, true);
  assert.equal(ingress.status.state, "READY");
  assert.equal(ingress.status.artifactLocation, statusLocation("EOS-ACCEPT-001"));

  // (3) EXECUTION_AUTHORIZED wakes the (injected) worker automatically → (4) completes → writes artifacts.
  const written = new Map();
  const out = executeIntakeItem({
    requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256,
    deps: {
      readFile: () => bytes,                       // GitHub read
      write: (loc, text) => (written.set(loc, text), loc),
      processRunner: fakeWorker(), lease: fakeLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT, now: NOW,
      capabilityBroker: null,                       // no Secret Broker — but this item needs no paid capability
    },
  });
  assert.equal(out.disposition, "COMPLETE");

  // (5) status:// and result:// appear at deterministic, ChatGPT-readable GitHub paths (no search).
  const statusPath = statusLocation("EOS-ACCEPT-001");
  const resultPath = resultIndexLocation("EOS-ACCEPT-001");
  assert.ok(written.has(statusPath), "status artifact written at the deterministic path");
  assert.ok(written.has(resultPath), "result index written at the deterministic path");
  assert.equal(resolvePointer("status://EOS-ACCEPT-001").location, statusPath);
  assert.equal(resolvePointer("result://EOS-ACCEPT-001").location, resultPath);

  // (6) the readback verifies: status self-hash ok, COMPLETE, and its resultRef points at a real manifest.
  const status = JSON.parse(written.get(statusPath));
  assert.equal(verifyIntakeStatus(status).ok, true);
  assert.equal(status.state, "COMPLETE");
  const manifest = JSON.parse(written.get(status.resultRef.location));
  assert.equal(manifest.requestId, "EOS-ACCEPT-001");
  assert.equal(manifest.sha256, status.resultRef.sha256);
  // result content is content-addressed and verifies
  const content = written.get(manifest.contentLocation);
  assert.equal(manifest.contentSha256, sha256Bytes(Buffer.from(content)));

  // (7) no secret/key anywhere in what a ChatGPT reader would fetch
  const readable = [written.get(statusPath), written.get(resultPath), written.get(status.resultRef.location)].join("\n");
  assert.doesNotMatch(readable, /sk-[A-Za-z0-9]|AIza|Bearer |OPENAI_API_KEY|api[_-]?key/i);

  // Structural: the entire chain ran from ONE call sequence with injected deps — no interactive step,
  // no PowerShell, no Claude GUI. The Owner's only action was ChatGPT creating the work item.
});

test("ACCEPTANCE (paid capability, credential unavailable): authorized review item is BLOCKED, not fabricated", () => {
  const a = { ...chatgptSubmission(), requestId: "EOS-ACCEPT-PAID" };
  a.artifactLocation = "docs/orchestration/work-intake/EOS-ACCEPT-PAID.work.json";
  a.sha256 = intakeDigest({ ...a, sha256: undefined, artifactLocation: a.artifactLocation });
  // recompute hash cleanly
  const { sha256: _omit, ...payload } = a;
  const fixed = { ...payload, sha256: intakeDigest(payload) };
  const bytes = Buffer.from(JSON.stringify(fixed), "utf8");
  const written = new Map();
  // Inject a broker that DETERMINISTICALLY reports the paid credential unavailable. (Passing `null` would be
  // defeated by executeIntakeItem's `deps.capabilityBroker ?? createSecretBroker()` — `null ?? x` builds the
  // REAL broker, which on a machine that actually has the DPAPI OPENAI_API_KEY provisioned reports it AVAILABLE
  // and the item COMPLETEs — making this test pass only where no credential happens to exist. This stub makes
  // the credential-absent → BLOCKED path deterministic on any machine; the credential-PRESENT → COMPLETE path
  // is covered by intakeBrokeredAcceptance.test.mjs's availability broker.)
  const unavailableBroker = { credentialStatus: () => ({ credentialAvailable: false }) };
  const out = executeIntakeItem({
    requestId: fixed.requestId, location: fixed.artifactLocation, sha256: fixed.sha256, requiresCapabilities: ["OPENAI_REVIEW"],
    deps: { readFile: () => bytes, write: (loc, text) => (written.set(loc, text), loc), processRunner: fakeWorker(), lease: fakeLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT, now: NOW, capabilityBroker: unavailableBroker },
  });
  assert.equal(out.disposition, "BLOCKED");
  const status = JSON.parse(written.get(statusLocation("EOS-ACCEPT-PAID")));
  assert.equal(status.state, "BLOCKED");
  assert.ok(!written.has(resultIndexLocation("EOS-ACCEPT-PAID")), "no result fabricated while the capability is unavailable");
});
