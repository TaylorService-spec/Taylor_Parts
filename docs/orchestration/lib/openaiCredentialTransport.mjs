// Trusted EOS transport seam. The existing OpenAI reviewer receives this transport, never an API key.
// `invokeOpenAI` is injected so repository tests cannot make a live provider call.

import { SecretBrokerError, SECRET_FAILURE } from "./secretProvider.mjs";

export function createOpenAICredentialTransport({ broker, authorizedInvocation, estimateSpendUsd, invokeOpenAI }) {
  if (!broker?.withCredential || typeof estimateSpendUsd !== "function" || typeof invokeOpenAI !== "function") throw new Error("OPENAI_REVIEW transport is not configured");
  return async function openAIReviewTransport(invocation) {
    const estimatedSpendUsd = estimateSpendUsd(invocation);
    if (!Number.isFinite(estimatedSpendUsd) || estimatedSpendUsd < 0 || estimatedSpendUsd > authorizedInvocation.maxSpendUsd) throw new SecretBrokerError(SECRET_FAILURE.BUDGET_UNAUTHORIZED);
    return broker.withCredential("OPENAI_REVIEW", authorizedInvocation, async (apiKey) => invokeOpenAI({ apiKey, invocation }));
  };
}
