// #764 OpenAI provider adapter — the INDEPENDENT_AI reviewer WORKER behind the reciprocal-review
// contract. Pure of secrets and pure of network at module scope: the API call goes through an
// INJECTED `transport` (a mock in tests; a thin real caller at the activation boundary). This module
// NEVER reads, stores, prints, logs, or serializes an API key — the transport injects Authorization
// and is never handed a key by this code.
//
// It reuses the existing contracts (no second queue/ledger/context mechanism): the C-7 minimum-context
// package (build-package), the structured result shape + failure taxonomy (reviewTrigger), and the
// model policy. It serves INDEPENDENT_AI only. It is fail-closed: insufficient context, budget ceiling,
// provider error, or malformed output all yield a non-actionable failure — never an approval, never an
// authorization of a protected action (that gate stays in consumeReviewResult).

import { structureReviewResult } from "./reviewTrigger.mjs";

// Pilot budget ceilings (Owner-set). No automatic recharge — a ceiling REFUSES, it never tops up.
export const PILOT_BUDGET = Object.freeze({
  totalCeilingUsd: 10.0,
  perReviewCeilingUsd: 0.25,
  autoRecharge: false,
});

// Default pricing is an ESTIMATE (mid-tier reasoning tier), injected so it is never silently wrong.
// Verify at openai.com/api/pricing before any live call. Per 1,000,000 tokens.
export const DEFAULT_PRICING_ESTIMATE = Object.freeze({ model: "gpt-mid-tier", inputPerM: 2.5, outputPerM: 15.0, source: "ESTIMATE — verify at openai.com/api/pricing" });

const MAX_OUTPUT_TOKENS = 1500;            // structured verdict/corrections/evidence — bounded
const estTokens = (s) => Math.ceil((s || "").length / 4); // ≈ 4 bytes/token, labeled estimate

/**
 * Build the reviewer invocation from MINIMUM C-7 context — the governing authority + required refs the
 * package already selected, plus the diff under review and the result-schema instruction. It does NOT
 * inline the whole repo. INDEPENDENT_AI only.
 * @returns {{ ok:boolean, failureKind?, invocation? }}
 */
export function buildReviewInvocation({ request = {}, contextPackage = {}, diff = "", model = null } = {}) {
  if (request.reviewClass !== "INDEPENDENT_AI") return { ok: false, failureKind: "TRIGGER_FAILED", reason: `adapter serves INDEPENDENT_AI only, not ${request.reviewClass}` };
  if ((contextPackage.sufficiency || "EVIDENCE_REQUIRED") !== "SUFFICIENT") return { ok: false, failureKind: "CONTEXT_INSUFFICIENT", reason: "C-7 package not SUFFICIENT — retrieve-don't-guess" };

  const refs = [...(contextPackage.required || [])].map((r) => `- ${r.id} (${r.authority || "authority"}): ${r.retrievalPath}`);
  const system = "You are an INDEPENDENT architecture/check-and-balance reviewer for EOS. Reason only about correctness, independence, and governance. You do NOT authorize anything; a protected action is never yours to approve. Return ONLY the structured result fields requested.";
  const user = [
    `Governing authority: ${contextPackage.governingAuthority || "unknown"}`,
    `Required context refs (retrieve as needed):\n${refs.join("\n")}`,
    `Review subject: ${request.subject || request.requestId || "review"}`,
    `Diff under review:\n${diff}`,
    "Return fields: verdict (CONCUR|CONCUR_WITH_CORRECTION|NONCONCUR_ESCALATE|EVIDENCE_REQUIRED|NEEDS_OWNER), conclusion, corrections[], evidenceRefs[], ownerDecisionRequired(bool).",
  ].join("\n\n");

  const inputTokensEstimate = estTokens(system) + estTokens(user);
  return {
    ok: true,
    invocation: {
      // provider-neutral request body fields; the real transport maps these to the API shape.
      model: model || "gpt-mid-tier",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseFormat: "structured_review_result",
      inputTokensEstimate,
    },
  };
}

/** Estimate USD cost from token counts + injected pricing. Never fabricated — pricing is an input. */
export function estimateCost({ inputTokens = 0, outputTokens = MAX_OUTPUT_TOKENS, pricing = DEFAULT_PRICING_ESTIMATE } = {}) {
  const usd = (inputTokens / 1e6) * pricing.inputPerM + (outputTokens / 1e6) * pricing.outputPerM;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Budget guard. Refuses (does NOT top up) when a projected review would exceed the per-review ceiling,
 * or when cumulative pilot spend + this review would exceed the total ceiling.
 * @returns {{ ok:boolean, failureKind?, reason?, estCostUsd, projectedTotalUsd }}
 */
export function guardBudget({ estCostUsd = 0, spentSoFarUsd = 0, budget = PILOT_BUDGET } = {}) {
  const projectedTotalUsd = Math.round((spentSoFarUsd + estCostUsd) * 1e6) / 1e6;
  if (estCostUsd > budget.perReviewCeilingUsd) return { ok: false, failureKind: "TRIGGER_FAILED", reason: `per-review ceiling $${budget.perReviewCeilingUsd} exceeded (est $${estCostUsd})`, estCostUsd, projectedTotalUsd };
  if (projectedTotalUsd > budget.totalCeilingUsd) return { ok: false, failureKind: "TRIGGER_FAILED", reason: `pilot ceiling $${budget.totalCeilingUsd} would be exceeded (projected $${projectedTotalUsd})`, estCostUsd, projectedTotalUsd };
  return { ok: true, estCostUsd, projectedTotalUsd };
}

/** Parse a provider response into the structured result. Fail-closed on malformed. */
export function parseOpenAIResult({ response = null, request = {}, sourceFreshness = "CURRENT" } = {}) {
  if (!response || typeof response !== "object") return { ok: false, failureKind: "MALFORMED_RESULT", reason: "empty provider response" };
  const body = response.review || response.output || response;
  const raw = {
    exchangeId: `rev:${request.requestId}`,
    requestId: request.requestId,
    reviewerRole: request.reviewerRole || "independent-architecture-review",
    provider: "OPENAI",
    selectedModel: request.selectedModel || null,
    triggerKind: request.triggerKind || null,
    verdict: body.verdict,
    conclusion: body.conclusion ?? null,
    corrections: body.corrections ?? [],
    evidenceRefs: body.evidenceRefs ?? [],
    ownerDecisionRequired: body.ownerDecisionRequired === true,
    sourceFreshness,
    routedBackTo: request.routedBackTo ?? null,
  };
  return structureReviewResult(raw); // reuses the contract's validation; malformed → MALFORMED_RESULT
}

/**
 * Run one INDEPENDENT_AI review via the INJECTED transport. No key is handled here — the transport
 * injects Authorization and is the ONLY thing that touches a secret (a mock in tests; a thin real
 * caller at the activation boundary). Fail-closed at every step; NOTHING here logs the request/key.
 *
 * @param {object} p
 * @param {object} p.request           reviewTrigger AI_REVIEW request (reviewClass must be INDEPENDENT_AI)
 * @param {object} p.contextPackage    C-7 minimum-context package (must be SUFFICIENT)
 * @param {string} p.diff              the change under review
 * @param {(inv)=>Promise<object>} p.transport  async caller; receives the invocation, returns raw response
 * @param {object} [p.pricing]         injected pricing (else DEFAULT_PRICING_ESTIMATE)
 * @param {number} [p.spentSoFarUsd]   cumulative pilot spend
 * @param {string} [p.sourceFreshness] provenance of the reviewed source (must be CURRENT to be authoritative)
 * @returns {Promise<{ ok, failureKind?, reason?, result?, usage? }>}
 */
export async function runOpenAIReview({ request = {}, contextPackage = {}, diff = "", transport, pricing = DEFAULT_PRICING_ESTIMATE, spentSoFarUsd = 0, sourceFreshness = "CURRENT" } = {}) {
  const built = buildReviewInvocation({ request, contextPackage, diff, model: request.selectedModel });
  if (!built.ok) return { ok: false, failureKind: built.failureKind, reason: built.reason };

  const estCostUsd = estimateCost({ inputTokens: built.invocation.inputTokensEstimate, outputTokens: built.invocation.maxOutputTokens, pricing });
  const gate = guardBudget({ estCostUsd, spentSoFarUsd });
  if (!gate.ok) return { ok: false, failureKind: gate.failureKind, reason: gate.reason, usage: { estCostUsd, projectedTotalUsd: gate.projectedTotalUsd, invoked: false } };

  if (typeof transport !== "function") return { ok: false, failureKind: "TRIGGER_FAILED", reason: "no transport injected — not configured (activation boundary)" };

  let response;
  try {
    response = await transport(built.invocation); // transport injects auth; adapter never sees the key
  } catch (e) {
    return { ok: false, failureKind: "PROVIDER_FAILED", reason: `provider error: ${e && e.message ? e.message : "unknown"}`, usage: { estCostUsd, invoked: true } };
  }
  if (!response || response.ok === false || response.error) {
    return { ok: false, failureKind: "PROVIDER_FAILED", reason: `provider returned an error status`, usage: { estCostUsd, invoked: true } };
  }

  const parsed = parseOpenAIResult({ response, request, sourceFreshness });
  if (!parsed.ok) return { ok: false, failureKind: parsed.failureKind, reason: parsed.reason, usage: { estCostUsd, invoked: true } };

  const actualInput = (response.usage && response.usage.inputTokens) || built.invocation.inputTokensEstimate;
  const actualOutput = (response.usage && response.usage.outputTokens) || built.invocation.maxOutputTokens;
  const actualCostUsd = estimateCost({ inputTokens: actualInput, outputTokens: actualOutput, pricing });
  return { ok: true, result: parsed.result, usage: { estCostUsd, actualCostUsd, inputTokens: actualInput, outputTokens: actualOutput, invoked: true, pricingSource: pricing.source || null } };
}
