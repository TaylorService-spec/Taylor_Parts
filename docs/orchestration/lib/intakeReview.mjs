// Brokered intake review — runs an OPENAI_REVIEW-requiring intake through the MERGED #790 Secret Broker,
// reusing its trusted transport, spend ledger, and hash-verified authorization. It COMPOSES existing
// pieces and adds NO new credential handling:
//
//   createOpenAICredentialTransport (#790: binds workId/reviewId/sourceCommit/workArtifactSha256 +
//     unique invocationId, checks estimate ≤ maxSpendUsd, reserves at-most-once in the spend ledger,
//     then calls broker.withCredential — the ONLY secret-bearing boundary) → runOpenAIReview (#788:
//     transmits the fact-based invocation, assembles the EOS-owned envelope).
//
// The API key is resolved inside broker.withCredential and handed ONLY to `invokeOpenAI({ apiKey, invocation })`;
// it never appears here, in the result, in the status, or in a log. Authorization + budget + replay are the
// broker/transport's, not reimplemented. Fail-closed: an unverified/expired authorization, an over-budget
// estimate, or a duplicate invocationId refuses BEFORE the credential resolves.

import { createOpenAICredentialTransport } from "./openaiCredentialTransport.mjs";
import { runOpenAIReview, estimateCost, DEFAULT_PRICING_ESTIMATE } from "./openaiReviewProvider.mjs";

/** Default spend estimate over the ACTUAL transmitted fact-based payload (messages + schema). */
export function defaultEstimateSpendUsd(invocation, pricing = DEFAULT_PRICING_ESTIMATE) {
  const inputTokens = (invocation.inputTokensEstimate || 0) + (invocation.schemaTokens || 0);
  return estimateCost({ inputTokens, outputTokens: invocation.maxOutputTokens || 1500, pricing });
}

/**
 * Run one brokered OPENAI_REVIEW for an intake. `authorization` MUST be a verified authorization artifact
 * (the object returned by reviewAuthorization.resolveReviewAuthorization — only those pass the broker's
 * isVerifiedReviewAuthorization gate). `invocation` is a fact-based invocation (reviewFeedInvocation).
 * `invokeOpenAI({ apiKey, invocation }) -> { ok, review, usage }` is injected (a fake in tests; the real
 * DPAPI-backed HTTP call in the runtime) — it is the only function that ever sees the key.
 * @returns the runOpenAIReview envelope ({ ok, result, usage } or a fail-closed failure).
 */
export async function runBrokeredIntakeReview({
  request, invocation, authorization, broker, spendLedger, invokeOpenAI,
  estimateSpendUsd = defaultEstimateSpendUsd, sourceFreshness = "CURRENT", clock = () => new Date().toISOString(),
} = {}) {
  if (!authorization || typeof authorization !== "object") throw new Error("runBrokeredIntakeReview: a verified authorization is required");
  if (!broker || typeof broker.withCredential !== "function") throw new Error("runBrokeredIntakeReview: the Secret Broker is required");
  if (!spendLedger || typeof spendLedger.reserve !== "function") throw new Error("runBrokeredIntakeReview: a spend ledger is required");

  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation: authorization, estimateSpendUsd, invokeOpenAI, spendLedger });

  // Bind the invocation to the exact authorization identifiers + a unique invocationId; the transport
  // refuses (WORK_UNAUTHORIZED) if any binding does not match, and the ledger refuses a duplicate id.
  const bound = Object.freeze({
    ...invocation,
    workId: authorization.workId,
    reviewId: authorization.reviewId,
    sourceCommit: authorization.sourceCommit,
    workArtifactSha256: authorization.workArtifactSha256,
    invocationId: `${authorization.workId}:${authorization.reviewId}:${String(authorization.sourceCommit).slice(0, 12)}`,
  });

  return runOpenAIReview({
    request, invocation: bound, transport,
    sourceFreshness, contextPackageRef: null,
    provenance: { workId: authorization.workId, reviewId: authorization.reviewId, sourceCommit: authorization.sourceCommit, feedMode: bound.feedMode || null },
    triggerKind: "AUTOMATIC_INTAKE_EXECUTION",
    timestamps: { requestedAt: clock(), triggeredAt: clock() }, clock,
  });
}
