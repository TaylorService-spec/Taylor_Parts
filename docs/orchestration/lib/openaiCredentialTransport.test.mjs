import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretBroker } from "./secretProvider.mjs";
import { createFileSpendLedger, createInMemorySpendLedger, createOpenAICredentialTransport } from "./openaiCredentialTransport.mjs";
import { buildReviewAuthorization, resolveReviewAuthorization } from "./reviewAuthorization.mjs";

const SECRET = "sk-transport-canary-2481";
const BOUND = { workId: "WORK-1", reviewId: "REVIEW-1", sourceCommit: "b".repeat(40), workArtifactSha256: "c".repeat(64) };
const artifact = buildReviewAuthorization({ ...BOUND, maxSpendUsd: 0.25, expiresAt: "2026-08-12T06:00:00.000Z", provenance: "test" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
const GRANT = resolveReviewAuthorization({ ...BOUND, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(artifact), now: "2026-08-11T06:30:00.000Z" });
const invocation = (id = "INV-1", changes = {}) => ({ ...BOUND, invocationId: id, model: "test-model", ...changes });

test("OpenAI transport resolves the credential only inside authorized EOS execution", async () => {
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET });
  let providerSawCredential = false;
  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: GRANT, spendLedger: createInMemorySpendLedger(), estimateSpendUsd: () => 0.1, invokeOpenAI: async ({ apiKey, invocation }) => { providerSawCredential = apiKey === SECRET; return { ok: true, review: { verdict: "CONCUR" }, echoedModel: invocation.model }; } });
  const result = await transport(invocation());
  assert.equal(providerSawCredential, true);
  assert.equal(result.echoedModel, "test-model");
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("unauthorized transport never invokes provider", async () => {
  let calls = 0;
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET });
  const deniedArtifact = buildReviewAuthorization({ ...BOUND, reviewId: "REVIEW-DENIED", maxSpendUsd: 0.25, expiresAt: "2026-08-12T06:00:00.000Z", provenance: "test", budgetAuthorizationState: "UNAUTHORIZED" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
  const denied = resolveReviewAuthorization({ workId: deniedArtifact.workId, reviewId: deniedArtifact.reviewId, location: deniedArtifact.artifactLocation, sha256: deniedArtifact.sha256, bytes: JSON.stringify(deniedArtifact), now: "2026-08-11T06:30:00.000Z" });
  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: denied, spendLedger: createInMemorySpendLedger(), estimateSpendUsd: () => 0.1, invokeOpenAI: async () => { calls++; } });
  await assert.rejects(() => transport(invocation("INV-DENIED", { reviewId: "REVIEW-DENIED" })), { code: "BUDGET_NOT_AUTHORIZED" });
  assert.equal(calls, 0);
});

test("per-invocation estimate above the authorized ceiling never resolves a credential", async () => {
  let resolved = 0; let calls = 0;
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => { resolved++; return SECRET; } });
  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: GRANT, spendLedger: createInMemorySpendLedger(), estimateSpendUsd: () => GRANT.maxSpendUsd + 0.01, invokeOpenAI: async () => { calls++; } });
  await assert.rejects(() => transport(invocation()), { code: "BUDGET_NOT_AUTHORIZED" });
  assert.equal(resolved, 0);
  assert.equal(calls, 0);
});

test("binding mismatch and duplicate invocation refuse before credential/provider", async () => {
  let resolved = 0; let calls = 0;
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => { resolved++; return SECRET; } });
  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: GRANT, spendLedger: createInMemorySpendLedger(), estimateSpendUsd: () => 0.05, invokeOpenAI: async () => { calls++; return { ok: true }; } });
  for (const changed of [{ workId: "WORK-2" }, { reviewId: "REVIEW-2" }, { sourceCommit: "d".repeat(40) }, { workArtifactSha256: "e".repeat(64) }]) await assert.rejects(() => transport(invocation(`BAD-${Object.keys(changed)[0]}`, changed)), { code: "WORK_NOT_AUTHORIZED" });
  await transport(invocation("ONCE"));
  await assert.rejects(() => transport(invocation("ONCE")), { code: "WORK_NOT_AUTHORIZED" });
  assert.equal(resolved, 1); assert.equal(calls, 1);
});

test("durable ledger preserves cumulative spend and at-most-once ids across transport restart", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "eos-spend-")), "ledger.json"); let calls = 0;
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET });
  const make = () => createOpenAICredentialTransport({ broker, authorizedInvocation: GRANT, spendLedger: createFileSpendLedger({ path, fs }), estimateSpendUsd: () => 0.1, invokeOpenAI: async () => { calls++; return { ok: true }; } });
  await make()(invocation("PERSIST-1")); await make()(invocation("PERSIST-2"));
  await assert.rejects(() => make()(invocation("PERSIST-1")), { code: "WORK_NOT_AUTHORIZED" });
  await assert.rejects(() => make()(invocation("PERSIST-3")), { code: "BUDGET_NOT_AUTHORIZED" });
  assert.equal(calls, 2); assert.equal(createFileSpendLedger({ path, fs }).snapshot(GRANT.sha256).cumulativeReservedUsd, 0.2);
});

test("cumulative ceiling survives calls/retries and refuses before provider", async () => {
  let calls = 0; const ledger = createInMemorySpendLedger();
  const broker = createSecretBroker({ platform: "win32", secretRoot: ".", resolveSecret: () => SECRET });
  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: GRANT, spendLedger: ledger, estimateSpendUsd: () => 0.1, invokeOpenAI: async () => { calls++; return { ok: true }; } });
  assert.equal((await transport(invocation("CALL-1"))).budget.spentAfterUsd, 0.1);
  assert.equal((await transport(invocation("CALL-2"))).budget.spentAfterUsd, 0.2);
  await assert.rejects(() => transport(invocation("CALL-3")), { code: "BUDGET_NOT_AUTHORIZED" });
  await assert.rejects(() => transport(invocation("CALL-1")), { code: "WORK_NOT_AUTHORIZED" });
  assert.equal(calls, 2); assert.equal(ledger.snapshot(GRANT.sha256).cumulativeReservedUsd, 0.2);
});
