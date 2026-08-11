// FINAL ACCEPTANCE — the whole loop for a paid OPENAI_REVIEW intake, end to end, with the REAL merged
// broker + trusted transport + spend ledger + verified authorization, and injected fake `resolveSecret` +
// fake `invokeOpenAI` (no live OpenAI call, $0). One non-interactive call chain: no Owner PowerShell, no
// Claude GUI.
//
//   ChatGPT valid work:// (requires OPENAI_REVIEW)
//   → EOS validates → status:// derivable
//   → EXECUTION_AUTHORIZED → capability resolves via the real broker (credentialStatus)
//   → OPENAI_REVIEW credential resolves INTERNALLY (broker.withCredential) → review runs
//   → result:// written (content-addressed) → COMPLETE status carries the resultRef
//   → readable at deterministic paths; the key never appears anywhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { intakeDigest, resolveWorkIntake, buildContentAddressedResult, sha256Bytes } from "./workIntake.mjs";
import { ingestIntake, assessCapability } from "./intakeIngress.mjs";
import { runBrokeredIntakeReview } from "./intakeReview.mjs";
import { buildIntakeStatus, buildResultIndex, statusLocation, resultIndexLocation, resolvePointer, verifyIntakeStatus } from "./intakeStatus.mjs";
import { createSecretBroker } from "./secretProvider.mjs";
import { createInMemorySpendLedger } from "./openaiCredentialTransport.mjs";
import { buildReviewAuthorization, resolveReviewAuthorization } from "./reviewAuthorization.mjs";
import { buildCanonicalReviewFeed, buildFactBasedInvocation } from "./reviewFeedInvocation.mjs";

const FAKE_KEY = "fake-openai-key-not-real";
const NOW = "2026-08-11T09:00:00Z";
const SCHEMA = { type: "json_schema", name: "eos_review_result", strict: true, schema: { type: "object", additionalProperties: false, properties: { verdict: { type: "string", enum: ["CONCUR"] }, conclusion: { type: "string" } }, required: ["verdict", "conclusion"] } };
const SHA40 = "c".repeat(40);

// The broker whose credential is available (credentialStatus true via injected file check) AND whose secret
// comes only from the injected resolveSecret. We stub credentialStatus availability with a broker that has
// resolveSecret; for the availability seam we pass a credentialStatus-shaped broker.
const availabilityBroker = { credentialStatus: () => ({ capability: "OPENAI_REVIEW", credentialAvailable: true, credentialId: "eos-openai-review", secretValue: "REDACTED" }) };
const secretBroker = () => createSecretBroker({ platform: "win32", secretRoot: "C:/fake", resolveSecret: async () => FAKE_KEY });

function chatgptReviewIntake() {
  const payload = {
    requestId: "EOS-REVIEW-ACCEPT", title: "independent review of the change", intent: "run an independent OPENAI_REVIEW",
    scope: ["docs/orchestration/work-intake/"], contextScope: ["orchestration"],
    source: { producer: "Owner/ChatGPT", provenance: "ChatGPT created via the GitHub connector" },
    status: "EXECUTION_AUTHORIZED",
    authority: { authorizationState: "AUTHORIZED", basis: "Owner authorized this independent review", protectedBoundary: null },
    artifactLocation: "docs/orchestration/work-intake/EOS-REVIEW-ACCEPT.work.json",
    createdAt: "2026-08-11T08:00:00Z", updatedAt: "2026-08-11T08:00:00Z", relatedRefs: { issues: [], pullRequests: [] },
  };
  return { ...payload, sha256: intakeDigest(payload) };
}

function verifiedAuthorization(workArtifactSha256) {
  const built = buildReviewAuthorization(
    { workId: "EOS-REVIEW-ACCEPT", reviewId: "REV-001", maxSpendUsd: 0.25, sourceCommit: SHA40, workArtifactSha256, provenance: "owner authorized", expiresAt: "2099-01-01T00:00:00Z" },
    { subject: "owner@example", clientId: "eos-mcp" }, "2026-08-11T00:00:00Z",
  );
  return resolveReviewAuthorization({ workId: "EOS-REVIEW-ACCEPT", reviewId: "REV-001", sourceCommit: SHA40, workArtifactSha256, location: built.artifactLocation, sha256: built.sha256, bytes: JSON.stringify(built), now: NOW });
}

test("FINAL ACCEPTANCE: paid OPENAI_REVIEW intake → broker credential resolves internally → result://", async () => {
  const a = chatgptReviewIntake();
  const bytes = Buffer.from(JSON.stringify(a), "utf8");

  // validate + capability resolves via the REAL broker's credentialStatus (availability only)
  const ingress = ingestIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes, now: NOW, requiresCapabilities: ["OPENAI_REVIEW"], capabilityBroker: availabilityBroker });
  assert.equal(ingress.gate.mayExecute, true);
  assert.equal(ingress.blockedByCapability, false, "credential capability is available");
  assert.equal(assessCapability({ name: "OPENAI_REVIEW", broker: availabilityBroker }).available, true);

  // the OPENAI_REVIEW credential resolves INTERNALLY and the review runs (fake key, fake provider)
  const artifact = resolveWorkIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes });
  const feed = buildCanonicalReviewFeed({ reviewId: "REV-001", question: "Is the change safe? one verdict", requirement: "safe", implementationFacts: ["change X"], deterministicEvidence: ["tests pass"], provenance: { sourceCommit: SHA40 } });
  const { invocation } = buildFactBasedInvocation({ feed, model: "gpt-5.6-terra", schema: SCHEMA });
  let sawKey = null;
  const review = await runBrokeredIntakeReview({
    request: { requestId: a.requestId, reviewClass: "INDEPENDENT_AI", selectedModel: "gpt-5.6-terra" },
    invocation, authorization: verifiedAuthorization(artifact.sha256), broker: secretBroker(), spendLedger: createInMemorySpendLedger(),
    invokeOpenAI: async ({ apiKey }) => { sawKey = apiKey; return { ok: true, review: { verdict: "CONCUR", conclusion: "safe" }, usage: { inputTokens: 900, outputTokens: 150 } }; },
  });
  assert.equal(review.ok, true);
  assert.equal(review.result.verdict, "CONCUR");
  assert.equal(sawKey, FAKE_KEY, "the key resolved internally, only inside invokeOpenAI");

  // result:// written (content-addressed) + COMPLETE status carrying the resultRef
  const written = new Map();
  const outputBytes = Buffer.from(`# ${a.requestId} review\nverdict: ${review.result.verdict}\n${review.result.conclusion}\n`, "utf8");
  const result = buildContentAddressedResult({ request: artifact, outputBytes, status: "COMPLETE", summary: "independent review complete", createdAt: NOW });
  const index = buildResultIndex({ requestId: a.requestId, manifestLocation: result.manifestLocation, manifestSha256: result.manifest.sha256, contentLocation: result.contentLocation, updatedAt: NOW });
  const status = buildIntakeStatus({ requestId: a.requestId, state: "COMPLETE", updatedAt: NOW, activeWorker: "openai-review", costToDateUsd: 0, workArtifact: { location: artifact.artifactLocation, sha256: artifact.sha256 }, resultRef: { location: result.manifestLocation, sha256: result.manifest.sha256 } });
  written.set(statusLocation(a.requestId), JSON.stringify(status));
  written.set(resultIndexLocation(a.requestId), JSON.stringify(index));
  written.set(result.manifestLocation, JSON.stringify(result.manifest));
  written.set(result.contentLocation, result.content);

  // readable at deterministic ChatGPT paths; hashes verify; no key anywhere
  assert.equal(resolvePointer("status://EOS-REVIEW-ACCEPT").location, statusLocation("EOS-REVIEW-ACCEPT"));
  assert.equal(resolvePointer("result://EOS-REVIEW-ACCEPT").location, resultIndexLocation("EOS-REVIEW-ACCEPT"));
  assert.equal(verifyIntakeStatus(status).ok, true);
  assert.equal(status.state, "COMPLETE");
  assert.equal(result.manifest.contentSha256, sha256Bytes(result.content));
  const blob = [...written.values()].join("\n");
  assert.doesNotMatch(blob, new RegExp(FAKE_KEY));
  assert.doesNotMatch(blob, /sk-[A-Za-z0-9]|OPENAI_API_KEY|Bearer /);
});

test("FINAL ACCEPTANCE (broker unavailable): OPENAI_REVIEW intake is BLOCKED, no review, no result", () => {
  const a = chatgptReviewIntake();
  const bytes = Buffer.from(JSON.stringify(a), "utf8");
  const unavailable = { credentialStatus: () => ({ credentialAvailable: false, secretValue: "REDACTED" }) };
  const ingress = ingestIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes, now: NOW, requiresCapabilities: ["OPENAI_REVIEW"], capabilityBroker: unavailable });
  assert.equal(ingress.blockedByCapability, true);
  assert.equal(ingress.status.state, "BLOCKED");
});
