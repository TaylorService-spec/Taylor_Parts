// Brokered intake review — reuses the REAL #790 broker + trusted transport + spend ledger + verified
// authorization, with an injected fake `resolveSecret` and fake `invokeOpenAI` (no live OpenAI call, $0).
// Proves the credential resolves internally, the key never leaks, and authorization/budget/replay hold.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runBrokeredIntakeReview } from "./intakeReview.mjs";
import { createSecretBroker } from "./secretProvider.mjs";
import { createInMemorySpendLedger } from "./openaiCredentialTransport.mjs";
import { buildReviewAuthorization, resolveReviewAuthorization } from "./reviewAuthorization.mjs";
import { buildCanonicalReviewFeed, buildFactBasedInvocation } from "./reviewFeedInvocation.mjs";

const FAKE_KEY = "fake-openai-key-not-real";
const SCHEMA = { type: "json_schema", name: "eos_review_result", strict: true, schema: { type: "object", additionalProperties: false, properties: { verdict: { type: "string", enum: ["CONCUR", "NONCONCUR_ESCALATE"] }, conclusion: { type: "string" } }, required: ["verdict", "conclusion"] } };
const SHA40 = "a".repeat(40);
const SHA64 = "b".repeat(64);

// A broker whose ONLY secret source is the injected resolveSecret (no DPAPI file needed).
const fakeBroker = () => createSecretBroker({ platform: "win32", secretRoot: "C:/fake", resolveSecret: async () => FAKE_KEY });

// A genuinely VERIFIED authorization (built then resolved → placed in the module's verified WeakSet).
function verifiedAuthorization({ maxSpendUsd = 0.25 } = {}) {
  const built = buildReviewAuthorization(
    { workId: "EOS-REVIEW-1", reviewId: "REV-001", maxSpendUsd, sourceCommit: SHA40, workArtifactSha256: SHA64, provenance: "test", expiresAt: "2099-01-01T00:00:00Z" },
    { subject: "owner@example", clientId: "eos-mcp" },
    "2026-08-11T00:00:00Z",
  );
  return resolveReviewAuthorization({ workId: "EOS-REVIEW-1", reviewId: "REV-001", sourceCommit: SHA40, workArtifactSha256: SHA64, location: built.artifactLocation, sha256: built.sha256, bytes: JSON.stringify(built), now: "2026-08-11T01:00:00Z" });
}

function invocation() {
  const feed = buildCanonicalReviewFeed({ reviewId: "REV-001", question: "Is it safe? one verdict", requirement: "must be safe", implementationFacts: ["changed X"], deterministicEvidence: ["tests pass"], provenance: { sourceCommit: SHA40 } });
  return buildFactBasedInvocation({ feed, model: "gpt-5.6-terra", schema: SCHEMA }).invocation;
}

const request = { requestId: "EOS-REVIEW-1", reviewClass: "INDEPENDENT_AI", reviewerRole: "independent-review", selectedModel: "gpt-5.6-terra" };

test("credential resolves internally; review completes; the key is used but never leaks", async () => {
  let sawKey = null;
  const invokeOpenAI = async ({ apiKey, invocation: inv }) => {
    sawKey = apiKey;
    assert.equal(inv.feedMode, "FACT_BASED");
    return { ok: true, review: { verdict: "CONCUR", conclusion: "looks safe" }, usage: { inputTokens: 900, outputTokens: 200 } };
  };
  const r = await runBrokeredIntakeReview({ request, invocation: invocation(), authorization: verifiedAuthorization(), broker: fakeBroker(), spendLedger: createInMemorySpendLedger(), invokeOpenAI });
  assert.equal(r.ok, true);
  assert.equal(r.result.verdict, "CONCUR");
  assert.equal(sawKey, FAKE_KEY, "the broker handed the key ONLY to invokeOpenAI");
  assert.doesNotMatch(JSON.stringify(r), new RegExp(FAKE_KEY), "the key never appears in the review result");
});

test("replay: a second identical invocation is refused by the spend ledger (no duplicate paid call)", async () => {
  const ledger = createInMemorySpendLedger();
  const auth = verifiedAuthorization();
  const invokeOpenAI = async () => ({ ok: true, review: { verdict: "CONCUR", conclusion: "ok" }, usage: {} });
  const first = await runBrokeredIntakeReview({ request, invocation: invocation(), authorization: auth, broker: fakeBroker(), spendLedger: ledger, invokeOpenAI });
  assert.equal(first.ok, true);
  const replay = await runBrokeredIntakeReview({ request, invocation: invocation(), authorization: auth, broker: fakeBroker(), spendLedger: ledger, invokeOpenAI });
  assert.equal(replay.ok, false, "duplicate invocationId + authorization is refused fail-closed");
});

test("budget: an estimate over maxSpendUsd refuses BEFORE the credential resolves", async () => {
  let invoked = false;
  const invokeOpenAI = async () => { invoked = true; return { ok: true, review: { verdict: "CONCUR", conclusion: "ok" }, usage: {} }; };
  const r = await runBrokeredIntakeReview({ request, invocation: invocation(), authorization: verifiedAuthorization({ maxSpendUsd: 0.0000001 }), broker: fakeBroker(), spendLedger: createInMemorySpendLedger(), invokeOpenAI, estimateSpendUsd: () => 5 });
  assert.equal(r.ok, false);
  assert.equal(invoked, false, "the provider (and the credential) is never reached over budget");
});

test("an UNVERIFIED authorization (never resolved) is refused — the broker gate holds", async () => {
  const built = buildReviewAuthorization({ workId: "EOS-REVIEW-1", reviewId: "REV-001", maxSpendUsd: 0.25, sourceCommit: SHA40, workArtifactSha256: SHA64, provenance: "test", expiresAt: "2099-01-01T00:00:00Z" }, { subject: "s", clientId: "c" }, "2026-08-11T00:00:00Z");
  // `built` is NOT passed through resolveReviewAuthorization → not in the verified WeakSet.
  const r = await runBrokeredIntakeReview({ request, invocation: invocation(), authorization: built, broker: fakeBroker(), spendLedger: createInMemorySpendLedger(), invokeOpenAI: async () => ({ ok: true, review: { verdict: "CONCUR", conclusion: "ok" }, usage: {} }) });
  assert.equal(r.ok, false, "only a resolved+verified authorization releases the credential");
});
