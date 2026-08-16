// Focused tests for the PATCH_PRODUCER live-provider activation seam (EOS-ISSUE-842).
//
// Repo-safe by construction: no test here ever calls a real network endpoint. These tests prove the
// seam (a) fails closed with no broker/secret touch when a concrete model is not configured, and
// (b) when configured, routes through the SAME credential transport/broker mechanism as OPENAI_REVIEW
// (a distinct authorization scope, not a distinct mechanism), never exposing the raw secret.

import test from "node:test";
import assert from "node:assert/strict";
import { createSecretBroker } from "./secretProvider.mjs";
import { createInMemorySpendLedger } from "./openaiCredentialTransport.mjs";
import { buildReviewAuthorization, resolveReviewAuthorization } from "./reviewAuthorization.mjs";
import {
  createCortexPatchProducerProviderRun,
  resolvePatchProducerModel,
  PATCH_PRODUCER_PLACEHOLDER_MODELS,
  PATCH_PRODUCER_CAPABILITY,
} from "./cortexPatchProducerActivation.mjs";

const SECRET = "sk-patch-producer-canary-8842";
const BOUND = { workId: "CX-PATCH-001", reviewId: "CX-PATCH-001-ACT", sourceCommit: "a".repeat(40), workArtifactSha256: "b".repeat(64) };
const grantArtifact = () => buildReviewAuthorization({ ...BOUND, capability: PATCH_PRODUCER_CAPABILITY, maxSpendUsd: 0.5, expiresAt: "2099-08-12T06:00:00.000Z", provenance: "test" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
const grant = () => { const a = grantArtifact(); return resolveReviewAuthorization({ workId: a.workId, reviewId: a.reviewId, location: a.artifactLocation, sha256: a.sha256, bytes: JSON.stringify(a), now: "2026-08-11T06:30:00.000Z" }); };

test("resolvePatchProducerModel fails closed on empty/placeholder configuration", () => {
  for (const bad of [undefined, "", "  ", ...PATCH_PRODUCER_PLACEHOLDER_MODELS]) {
    const out = resolvePatchProducerModel(bad);
    assert.equal(out.ok, false);
    assert.match(out.reason, /MODEL_NOT_CONFIGURED/);
  }
  assert.deepEqual(resolvePatchProducerModel("gpt-keystone-patch-1"), { ok: true, model: "gpt-keystone-patch-1" });
});

test("no model configured: seam refuses before touching the broker/secret", () => {
  let resolved = 0;
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => { resolved++; return SECRET; } });
  const built = createCortexPatchProducerProviderRun({ broker, authorizedInvocation: grant(), estimateSpendUsd: () => 0.1, invokeOpenAI: async () => ({}), spendLedger: createInMemorySpendLedger(), configuredModel: "" });
  assert.equal(built.ok, false);
  assert.match(built.reason, /MODEL_NOT_CONFIGURED/);
  assert.equal(resolved, 0);
});

test("configured seam invokes the SAME credential transport under the PATCH_PRODUCER capability scope, never exposing the secret", async () => {
  let sawCapability = null;
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET, logger: (event) => { if (event.event === "CREDENTIAL_USE_STARTED") sawCapability = event.capability; } });
  let providerSawKey = false;
  const built = createCortexPatchProducerProviderRun({
    broker, authorizedInvocation: grant(), estimateSpendUsd: () => 0.1,
    invokeOpenAI: async ({ apiKey }) => { providerSawKey = apiKey === SECRET; return { ok: true, patchProducerResult: { executionId: "exec-live-001", summary: "live-shaped result", findings: [], evidence: [], verdict: "PASS", metrics: {}, mutated: false, patch: { entries: [] } } }; },
    spendLedger: createInMemorySpendLedger(), configuredModel: "gpt-keystone-patch-1",
  });
  assert.equal(built.ok, true);
  assert.equal(built.model, "gpt-keystone-patch-1");
  const result = await built.providerRun({ request: { requestId: "CX-PATCH-001" }, allowedScope: ["control-center/adapter-notes.md"] });
  assert.equal(providerSawKey, true);
  assert.equal(sawCapability, PATCH_PRODUCER_CAPABILITY);
  assert.equal(result.executionId, "exec-live-001");
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("provider error status raises without ever having exposed the secret in the thrown error", async () => {
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET });
  const built = createCortexPatchProducerProviderRun({ broker, authorizedInvocation: grant(), estimateSpendUsd: () => 0.1, invokeOpenAI: async () => ({ ok: false }), spendLedger: createInMemorySpendLedger(), configuredModel: "gpt-keystone-patch-1" });
  await assert.rejects(() => built.providerRun({ request: { requestId: "CX-PATCH-001" }, allowedScope: [] }), /provider returned an error status/);
});
