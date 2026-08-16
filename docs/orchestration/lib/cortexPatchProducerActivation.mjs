// Live-provider activation seam for Cortex PATCH_PRODUCER company work (EOS-ISSUE-842).
//
// Repo-safe and inert by default: nothing here calls OpenAI unless a concrete
// OPENAI_PATCH_PRODUCER_MODEL is configured (fail-closed, same pattern as
// openaiReviewProvider.resolveConcreteModel) AND the caller injects a real `invokeOpenAI` at the
// activation boundary — this module never invokes a provider on its own. It reuses the EXISTING
// credential transport (openaiCredentialTransport.mjs) and secret broker (secretProvider.mjs,
// capability "OPENAI_PATCH_PRODUCER") — no second credential mechanism is introduced.
//
// The function built here produces a `providerRun` compatible with runCortexPatchProducer's contract
// (cortexProviderAdapter.mjs). It never applies/merges/deploys/routes/authorizes anything — it only
// turns one governed transport call's response into the raw provider-result shape
// runCortexPatchProducer already validates end-to-end (executionId/summary/findings/evidence/verdict/
// metrics/mutated:false/patch.entries).

import { createOpenAICredentialTransport } from "./openaiCredentialTransport.mjs";

export const PATCH_PRODUCER_CAPABILITY = "OPENAI_PATCH_PRODUCER";
export const PATCH_PRODUCER_PLACEHOLDER_MODELS = Object.freeze(["", "gpt-mid-tier", "gpt-tier", "placeholder", "unknown"]);

/** Fail-closed model resolution — mirrors openaiReviewProvider.resolveConcreteModel exactly. */
export function resolvePatchProducerModel(configured) {
  const m = (configured || "").trim();
  if (!m || PATCH_PRODUCER_PLACEHOLDER_MODELS.includes(m)) {
    return { ok: false, reason: `MODEL_NOT_CONFIGURED — no valid concrete OPENAI_PATCH_PRODUCER_MODEL (got ${m ? `placeholder "${m}"` : "empty"})` };
  }
  return { ok: true, model: m };
}

/**
 * Build a providerRun function for runCortexPatchProducer, bound to the SAME credential transport
 * plumbing as OPENAI_REVIEW (a distinct authorization scope, not a distinct mechanism). Returns
 * `{ ok:false, reason }` WITHOUT constructing a transport (no broker/secret touched) when the model is
 * not concretely configured — never a silent placeholder call.
 *
 * @param {object} p
 * @param {object} p.broker                 secretProvider broker ({ withCredential })
 * @param {object} p.authorizedInvocation   the governed grant (same shape consumed by openaiCredentialTransport)
 * @param {(inv)=>number} p.estimateSpendUsd
 * @param {(args:{apiKey,invocation})=>Promise<object>} p.invokeOpenAI  the ONLY thing that touches a live key
 * @param {object} p.spendLedger
 * @param {string} p.configuredModel        e.g. process.env.OPENAI_PATCH_PRODUCER_MODEL — never a literal default
 * @returns {{ ok:boolean, reason?:string, model?:string, providerRun?:Function }}
 */
export function createCortexPatchProducerProviderRun({ broker, authorizedInvocation, estimateSpendUsd, invokeOpenAI, spendLedger, configuredModel }) {
  const resolved = resolvePatchProducerModel(configuredModel);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const transport = createOpenAICredentialTransport({ broker, authorizedInvocation, estimateSpendUsd, invokeOpenAI, spendLedger, capability: PATCH_PRODUCER_CAPABILITY });

  // Adapts runCortexPatchProducer's `providerRun(invocation)` calling convention to the governed
  // transport's `transport(invocation)` calling convention — no prompt/response shaping happens here;
  // `invokeOpenAI` (injected at the activation boundary) is responsible for producing the raw
  // provider-result shape runCortexPatchProducer validates.
  const providerRun = async (invocation) => {
    const response = await transport({
      workId: authorizedInvocation.workId,
      reviewId: authorizedInvocation.reviewId,
      sourceCommit: authorizedInvocation.sourceCommit,
      workArtifactSha256: authorizedInvocation.workArtifactSha256,
      invocationId: invocation.request.requestId,
      model: resolved.model,
      scope: invocation.allowedScope,
    });
    if (!response || typeof response !== "object" || response.ok === false) throw new Error("PATCH_PRODUCER provider returned an error status");
    return response.patchProducerResult;
  };
  return { ok: true, model: resolved.model, providerRun };
}
