import test from "node:test";
import assert from "node:assert/strict";
import { createSecretBroker } from "./secretProvider.mjs";
import { createOpenAICredentialTransport } from "./openaiCredentialTransport.mjs";
import { buildReviewAuthorization, resolveReviewAuthorization } from "./reviewAuthorization.mjs";

const SECRET = "sk-transport-canary-2481";
const artifact = buildReviewAuthorization({ workId: "WORK-1", reviewId: "REVIEW-1", maxSpendUsd: 0.25, sourceCommit: "b".repeat(40), provenance: "test" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
const GRANT = resolveReviewAuthorization({ workId: artifact.workId, reviewId: artifact.reviewId, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(artifact) });

test("OpenAI transport resolves the credential only inside authorized EOS execution", async () => {
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET });
  let providerSawCredential = false;
  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: GRANT, estimateSpendUsd: () => 0.1, invokeOpenAI: async ({ apiKey, invocation }) => { providerSawCredential = apiKey === SECRET; return { ok: true, review: { verdict: "CONCUR" }, echoedModel: invocation.model }; } });
  const result = await transport({ model: "test-model" });
  assert.equal(providerSawCredential, true);
  assert.equal(result.echoedModel, "test-model");
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("unauthorized transport never invokes provider", async () => {
  let calls = 0;
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET });
  const deniedArtifact = buildReviewAuthorization({ workId: "WORK-1", reviewId: "REVIEW-DENIED", maxSpendUsd: 0.25, sourceCommit: "b".repeat(40), provenance: "test", budgetAuthorizationState: "UNAUTHORIZED" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
  const denied = resolveReviewAuthorization({ workId: deniedArtifact.workId, reviewId: deniedArtifact.reviewId, location: deniedArtifact.artifactLocation, sha256: deniedArtifact.sha256, bytes: JSON.stringify(deniedArtifact) });
  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: denied, estimateSpendUsd: () => 0.1, invokeOpenAI: async () => { calls++; } });
  await assert.rejects(() => transport({ model: "test-model" }), { code: "BUDGET_NOT_AUTHORIZED" });
  assert.equal(calls, 0);
});

test("per-invocation estimate above the authorized ceiling never resolves a credential", async () => {
  let resolved = 0; let calls = 0;
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => { resolved++; return SECRET; } });
  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: GRANT, estimateSpendUsd: () => GRANT.maxSpendUsd + 0.01, invokeOpenAI: async () => { calls++; } });
  await assert.rejects(() => transport({ model: "test-model" }), { code: "BUDGET_NOT_AUTHORIZED" });
  assert.equal(resolved, 0);
  assert.equal(calls, 0);
});
