// Deterministic conformance test (EOS-ISSUE-842): one synthetic, project-keystone-scoped
// PATCH_PRODUCER company-work request, executed through the FULL governed lifecycle —
//
//   EOS company AgentRequest -> Cortex/Codex/OpenAI PATCH_PRODUCER execution -> governed AgentResult
//   -> independent Verifier PASS -> durable EOS result/patch artifact
//
// — using the SAME production functions the runtime uses (runCortexPatchProducer /
// persistPatchProducerResult from cortexProviderAdapter.mjs, createCortexPatchProducerProviderRun from
// the live-activation seam, createVerificationRequest/deriveVerdict from verifierAgent.mjs). Nothing
// here is a live network call: `invokeOpenAI` is injected exactly as it would be at the activation
// boundary — this proves the WIRING is correct end-to-end, independent of whether OpenAI is live.
//
// Every identity binding EOS-ISSUE-842 requires is asserted explicitly: requestId, project, repo,
// provider/model eligibility, allowed surfaces, execution profile, budget/capacity envelope, patch
// hash, and verification identity.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAgentRequest } from "./agentRequest.mjs";
import { createAgentResult } from "./agentResult.mjs";
import { createVerificationRequest, deriveVerdict } from "./verifierAgent.mjs";
import {
  runCortexPatchProducer,
  persistPatchProducerResult,
  CORTEX_PATCH_PRODUCER_MODE,
  KEYSTONE_PROJECT,
  KEYSTONE_REPO,
  CONTROL_CENTER_PATH_PREFIX,
} from "./cortexProviderAdapter.mjs";
import { createCortexPatchProducerProviderRun } from "./cortexPatchProducerActivation.mjs";
import { createSecretBroker } from "./secretProvider.mjs";
import { createInMemorySpendLedger } from "./openaiCredentialTransport.mjs";
import { buildReviewAuthorization, resolveReviewAuthorization } from "./reviewAuthorization.mjs";

const sha256Hex = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const clock = () => "2026-08-12T21:00:00Z";
const SECRET = "sk-keystone-patch-conformance-9142";

test("synthetic project-keystone PATCH_PRODUCER request executes through the full adapter -> Verifier -> durable-artifact lifecycle", async () => {
  // --- 1. The AgentRequest: a company-work request explicitly scoped to Control Center paths ------
  const requestId = "CX-KEYSTONE-CONFORMANCE-001";
  const patchPath = `${CONTROL_CENTER_PATH_PREFIX}conformance-scaffold.md`;
  const request = createAgentRequest({
    requestId,
    requestedByWorkstream: "EOS_INTAKE",
    purpose: "Propose a governed Control Center scaffold note (deterministic conformance run)",
    allowedSurfaces: [patchPath],
    outputContract: "deterministic hash-bound patch entries plus evidence/receipt metadata",
    mutating: true,
  });

  // --- 2. The governed binding + envelope: project/repo, provider/model eligibility, budget/capacity,
  //        and the GOVERNED (never self-selected) execution profile grant. ------------------------
  const binding = { mode: CORTEX_PATCH_PRODUCER_MODE, project: KEYSTONE_PROJECT, repo: KEYSTONE_REPO, allowedSurfaces: [patchPath], eligibleProviders: ["OPENAI"], eligibleModels: ["gpt-keystone-patch-1"], maxCostUsd: 0.5 };
  const executionProfileGrant = { requestedProfile: "PATCH_PRODUCER", authorizedProfile: "PATCH_PRODUCER" };
  const envelope = { requestId, project: binding.project, repo: binding.repo, provider: "OPENAI", model: "gpt-keystone-patch-1", budget: { maxCostUsd: 0.2 }, capacity: { available: true, maxConcurrent: 1 }, executionProfileGrant };

  // --- 3. The live-provider activation seam, wired to a mock invokeOpenAI (the activation boundary).
  //        The credential grant + broker + spend ledger are the SAME plumbing OPENAI_REVIEW uses. ---
  const patchContent = "# Control Center Conformance Scaffold\n\nProduced by the EOS-ISSUE-842 lifecycle conformance test.\n";
  const patchContentSha256 = sha256Hex(patchContent);
  const authArtifact = buildReviewAuthorization({ workId: requestId, reviewId: `${requestId}-ACT`, capability: "OPENAI_PATCH_PRODUCER", sourceCommit: "c".repeat(40), workArtifactSha256: "d".repeat(64), maxSpendUsd: 0.5, expiresAt: "2099-01-01T00:00:00.000Z", provenance: "conformance-test" }, { subject: "owner", clientId: "eos-conformance" }, "2026-08-12T20:00:00.000Z");
  const authorizedInvocation = resolveReviewAuthorization({ workId: authArtifact.workId, reviewId: authArtifact.reviewId, location: authArtifact.artifactLocation, sha256: authArtifact.sha256, bytes: JSON.stringify(authArtifact), now: "2026-08-12T20:30:00.000Z" });
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET });

  let providerSawKey = false;
  const built = createCortexPatchProducerProviderRun({
    broker, authorizedInvocation, estimateSpendUsd: () => 0.1, spendLedger: createInMemorySpendLedger(), configuredModel: "gpt-keystone-patch-1",
    invokeOpenAI: async ({ apiKey }) => {
      providerSawKey = apiKey === SECRET;
      return {
        ok: true,
        patchProducerResult: {
          executionId: "exec-keystone-conformance-001",
          summary: "Proposed the conformance scaffold note.",
          findings: ["Control Center scaffold note drafted."],
          evidence: [{ path: patchPath }],
          verdict: "PASS",
          metrics: { tokens: 96 },
          mutated: false,
          patch: { entries: [{ path: patchPath, changeType: "ADD", encoding: "utf8", content: patchContent, sha256: patchContentSha256 }] },
        },
      };
    },
  });
  assert.equal(built.ok, true, built.reason);

  // --- 4. Cortex PATCH_PRODUCER execution (the SAME adapter function the runtime calls) -----------
  const run = await runCortexPatchProducer({ request, binding, envelope, providerRun: built.providerRun, clock });
  assert.equal(run.ok, true, run.reason);
  assert.equal(providerSawKey, true, "the live-activation seam must reach the credential transport");

  // Bind every identity field EOS-ISSUE-842 requires, exactly as recorded on the execution receipt.
  assert.equal(run.receipt.requestId, requestId);
  assert.equal(run.receipt.project, KEYSTONE_PROJECT);
  assert.equal(run.receipt.repo, KEYSTONE_REPO);
  assert.equal(run.receipt.provider, "OPENAI");
  assert.equal(run.receipt.model, "gpt-keystone-patch-1");
  assert.deepEqual(run.receipt.allowedScope, [patchPath]);
  assert.equal(run.receipt.executionProfile, "PATCH_PRODUCER");
  assert.equal(run.receipt.budget.maxCostUsd, 0.2);
  assert.equal(run.receipt.capacity.available, true);
  assert.equal(run.receipt.patchSha256, run.result.patch.sha256);
  assert.equal(run.receipt.applied, false);
  assert.equal(run.result.patch.entries[0].sha256, patchContentSha256);

  // --- 5. Independent Verifier PASS, bound to the exact request/result identity -------------------
  const verificationRequest = createVerificationRequest({ requestId: `${requestId}-VERIFY`, workerRequest: request, workerResult: run.result });
  const verifierResult = createAgentResult({ resultId: `${requestId}-VR`, requestId: verificationRequest.requestId, routedBackTo: request.requestedByWorkstream, verdict: "PASS", findings: [] });
  assert.equal(deriveVerdict(verifierResult), "PASS");
  // Verification identity binding: the verification request's scope is the union of the worker's
  // authorized surfaces and everything the worker's own result claims to have touched.
  assert.ok(verificationRequest.allowedSurfaces.includes(patchPath));
  assert.equal(verificationRequest.requestedByWorkstream, request.requestedByWorkstream);

  // --- 6. Durable EOS artifact persistence — only NOW, only with a matching Verifier PASS ----------
  const store = new Map();
  const persisted = persistPatchProducerResult({ request, result: run.result, durable: run.durable, verificationRequest, verifierResult, store: { write: (path, bytes) => store.set(path, bytes) } });
  assert.equal(store.size, 2);
  assert.equal(persisted.patchApplied, false);
  assert.equal(persisted.sha256, run.durable.manifest.sha256);
  for (const path of store.keys()) {
    assert.match(path, /^docs\/orchestration\/work-intake\/results\//);
    assert.notEqual(path, patchPath, "the durable store must never receive the proposed source path itself — no auto-apply");
  }

  // The proposed patch content is durably recoverable from the persisted artifact (governed
  // integration remains a separate step; this proves the artifact exists and is intact). The content
  // artifact (durable.contentLocation) carries the full stableJson(result); the manifest at
  // durable.manifestLocation is a separate, smaller pointer/hash record.
  const persistedResult = JSON.parse(store.get(run.durable.contentLocation).toString("utf8"));
  assert.equal(persistedResult.patch.entries[0].content, patchContent);
  assert.equal(persistedResult.patch.applied, false);
});
