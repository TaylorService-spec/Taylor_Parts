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

import { structureReviewResult, REVIEW_VERDICTS } from "./reviewTrigger.mjs";

// The ONLY fields a GPT reviewer authors (semantic). Everything else in the durable envelope is
// SYSTEM-OWNED (EOS) and is never taken from the model — so the model cannot fabricate provenance,
// timestamps, ids, model, or trigger metadata.
export const SEMANTIC_REVIEW_FIELDS = Object.freeze(["verdict", "conclusion", "corrections", "evidenceRefs", "ownerDecisionRequired"]);
export const SYSTEM_OWNED_FIELDS = Object.freeze(["exchangeId", "requestId", "reviewerRole", "provider", "selectedModel", "triggerKind", "contextPackageRef", "provenance", "sourceFreshness", "requestedAt", "triggeredAt", "completedAt", "consumedAt", "disposition"]);

// Pilot budget ceilings (Owner-set). No automatic recharge — a ceiling REFUSES, it never tops up.
export const PILOT_BUDGET = Object.freeze({
  totalCeilingUsd: 10.0,
  perReviewCeilingUsd: 0.25,
  autoRecharge: false,
});

// Default pricing is an ESTIMATE for the pilot model (gpt-5.6-terra ≈ $2/$12 per 1M), injected so it is
// never silently wrong. Verify at openai.com/api/pricing before any live call.
export const DEFAULT_PRICING_ESTIMATE = Object.freeze({ model: "gpt-5.6-terra", inputPerM: 2.0, outputPerM: 12.0, source: "ESTIMATE — verify at openai.com/api/pricing" });

// Non-real placeholders that must NEVER be sent to a live provider. A live invocation refuses if the
// configured model is empty or a placeholder — it never silently picks another model.
export const PLACEHOLDER_MODELS = Object.freeze(["", "gpt-mid-tier", "gpt-tier", "placeholder", "unknown"]);

/** Resolve the concrete model from config. Fail-closed: empty/placeholder → not a valid live model. */
export function resolveConcreteModel(configured) {
  const m = (configured || "").trim();
  if (!m || PLACEHOLDER_MODELS.includes(m)) return { ok: false, reason: `MODEL_NOT_CONFIGURED — no valid concrete OPENAI_REVIEW_MODEL (got ${m ? `placeholder "${m}"` : "empty"})` };
  return { ok: true, model: m };
}

const MAX_OUTPUT_TOKENS = 1500;            // structured verdict/corrections/evidence — bounded
const estTokens = (s) => Math.ceil((s || "").length / 4); // ≈ 4 bytes/token, labeled estimate
export { estTokens };

/**
 * Build the reviewer invocation from MINIMUM C-7 context — the governing authority + required refs the
 * package already selected, plus the diff under review and the result-schema instruction. It does NOT
 * inline the whole repo. INDEPENDENT_AI only.
 * @returns {{ ok:boolean, failureKind?, invocation? }}
 */
export function buildReviewInvocation({ request = {}, contextPackage = {}, diff = "", model = null, contextText = "" } = {}) {
  if (request.reviewClass !== "INDEPENDENT_AI") return { ok: false, failureKind: "TRIGGER_FAILED", reason: `adapter serves INDEPENDENT_AI only, not ${request.reviewClass}` };
  if ((contextPackage.sufficiency || "EVIDENCE_REQUIRED") !== "SUFFICIENT") return { ok: false, failureKind: "CONTEXT_INSUFFICIENT", reason: "C-7 package not SUFFICIENT — retrieve-don't-guess" };
  // Fail-closed model: a live invocation must use a concrete configured model, never a placeholder.
  const resolved = resolveConcreteModel(model);
  if (!resolved.ok) return { ok: false, failureKind: "TRIGGER_FAILED", reason: resolved.reason };

  const refs = [...(contextPackage.required || [])].map((r) => `- ${r.id} (${r.authority || "authority"}): ${r.retrievalPath}`);
  const system = "You are an INDEPENDENT architecture/check-and-balance reviewer for EOS. Reason only about correctness, independence, and governance. You do NOT authorize anything; a protected action is never yours to approve. Return ONLY the structured result fields requested.";
  // A stateless API reviewer cannot open files, so the MINIMUM context is INLINED here (governing
  // authority text + diff), not sent as bare pointers. `contextText` is that inlined content; the
  // token estimate below therefore reflects the COMPLETE transmitted payload.
  const user = [
    `Governing authority: ${contextPackage.governingAuthority || "unknown"}`,
    `Governing authority content (inlined minimum context):\n${contextText || "(none inlined)"}`,
    `Other context refs (names only):\n${refs.join("\n")}`,
    `Review subject: ${request.subject || request.requestId || "review"}`,
    `Diff under review:\n${diff}`,
    "Return fields: verdict (CONCUR|CONCUR_WITH_CORRECTION|NONCONCUR_ESCALATE|EVIDENCE_REQUIRED|NEEDS_OWNER), conclusion, corrections[], evidenceRefs[], ownerDecisionRequired(bool).",
  ].join("\n\n");

  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  // Estimate over the ENTIRE message content actually transmitted (system + user, which now includes
  // the inlined context + diff). Proven complete by test: it equals estTokens(concatenated messages).
  const inputTokensEstimate = messages.reduce((sum, m) => sum + estTokens(m.content), 0);
  return {
    ok: true,
    invocation: {
      model: resolved.model,                 // concrete, validated — no silent fallback
      messages,
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

/**
 * Extract ONLY the semantic review fields the model is allowed to author. Any other key the model
 * returns (a system field, a fabricated timestamp, an id) is DROPPED here — it can never reach the
 * durable envelope. Fail-closed on an unknown/missing verdict.
 */
export function extractSemanticFields(body = {}) {
  if (!body || typeof body !== "object") return { ok: false, failureKind: "MALFORMED_RESULT", reason: "no model body" };
  if (!REVIEW_VERDICTS.includes(body.verdict)) return { ok: false, failureKind: "MALFORMED_RESULT", reason: `unknown verdict ${body.verdict}` };
  return {
    ok: true,
    semantic: {
      verdict: body.verdict,
      conclusion: typeof body.conclusion === "string" ? body.conclusion : null,
      corrections: Array.isArray(body.corrections) ? [...body.corrections] : [],
      evidenceRefs: Array.isArray(body.evidenceRefs) ? [...body.evidenceRefs] : [],
      ownerDecisionRequired: body.ownerDecisionRequired === true,
    },
  };
}

/**
 * Assemble the durable result envelope. EOS OWNS every system field (ids, model, trigger, context
 * package identity, provenance, timestamps); the model supplies ONLY `semantic`. The model can never
 * overwrite a system-owned field because those values come from these arguments, not from the model.
 */
export function assembleReviewEnvelope({ request = {}, invocation = {}, semantic = {}, sourceFreshness = "CURRENT", contextPackageRef = null, provenance = null, triggerKind = null, timestamps = {}, clock = null } = {}) {
  const completedAt = timestamps.completedAt ?? (typeof clock === "function" ? clock() : null);
  const raw = {
    // ── SYSTEM-OWNED (EOS runtime) ──
    exchangeId: `rev:${request.requestId}`,
    requestId: request.requestId,
    reviewerRole: request.reviewerRole || "independent-architecture-review",
    provider: "OPENAI",
    selectedModel: invocation.model || request.selectedModel || null,   // the model ACTUALLY transmitted
    triggerKind: triggerKind ?? request.triggerKind ?? null,
    contextPackageRef,
    provenance,
    sourceFreshness,
    requestedAt: timestamps.requestedAt ?? null,
    triggeredAt: timestamps.triggeredAt ?? null,
    completedAt,
    routedBackTo: request.routedBackTo ?? null,
    // ── SEMANTIC (model-authored, validated) ──
    verdict: semantic.verdict,
    conclusion: semantic.conclusion ?? null,
    corrections: semantic.corrections ?? [],
    evidenceRefs: semantic.evidenceRefs ?? [],
    ownerDecisionRequired: semantic.ownerDecisionRequired === true,
  };
  return structureReviewResult(raw); // final shape validation; disposition/consumedAt default here
}

/** Parse a provider response into the durable envelope: semantic from the model, metadata from EOS. */
export function parseOpenAIResult({ response = null, request = {}, invocation = {}, sourceFreshness = "CURRENT", contextPackageRef = null, provenance = null, triggerKind = null, timestamps = {}, clock = null } = {}) {
  if (!response || typeof response !== "object") return { ok: false, failureKind: "MALFORMED_RESULT", reason: "empty provider response" };
  const body = response.review || response.output || response;
  const sem = extractSemanticFields(body);
  if (!sem.ok) return sem;
  return assembleReviewEnvelope({ request, invocation, semantic: sem.semantic, sourceFreshness, contextPackageRef, provenance, triggerKind, timestamps, clock });
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
export async function runOpenAIReview({ request = {}, contextPackage = {}, diff = "", contextText = "", invocation = null, transport, pricing = DEFAULT_PRICING_ESTIMATE, spentSoFarUsd = 0, sourceFreshness = "CURRENT", contextPackageRef = null, provenance = null, triggerKind = null, timestamps = {}, clock = null } = {}) {
  // ONE canonical payload. If the caller already built it (the CLI does, and hands the SAME object to
  // both the dry-run estimate and here), transmit THAT EXACT object — guaranteeing dry/live parity. If
  // not supplied, build it from the same inputs via the single canonical builder.
  let inv = invocation;
  if (!inv) {
    const built = buildReviewInvocation({ request, contextPackage, diff, model: request.selectedModel, contextText });
    if (!built.ok) return { ok: false, failureKind: built.failureKind, reason: built.reason };
    inv = built.invocation;
  }
  // Model fail-closed — covers the prebuilt-invocation path too (never transmit a placeholder model).
  const mc = resolveConcreteModel(inv.model);
  if (!mc.ok) return { ok: false, failureKind: "TRIGGER_FAILED", reason: mc.reason };

  const estCostUsd = estimateCost({ inputTokens: inv.inputTokensEstimate, outputTokens: inv.maxOutputTokens, pricing });
  const gate = guardBudget({ estCostUsd, spentSoFarUsd });
  if (!gate.ok) return { ok: false, failureKind: gate.failureKind, reason: gate.reason, usage: { estCostUsd, projectedTotalUsd: gate.projectedTotalUsd, invoked: false } };

  if (typeof transport !== "function") return { ok: false, failureKind: "TRIGGER_FAILED", reason: "no transport injected — not configured (activation boundary)" };

  let response;
  try {
    response = await transport(inv); // transmit the CANONICAL invocation; transport injects auth
  } catch (e) {
    return { ok: false, failureKind: "PROVIDER_FAILED", reason: `provider error: ${e && e.message ? e.message : "unknown"}`, usage: { estCostUsd, invoked: true } };
  }
  if (!response || response.ok === false || response.error) {
    return { ok: false, failureKind: "PROVIDER_FAILED", reason: `provider returned an error status`, usage: { estCostUsd, invoked: true } };
  }

  // EOS assembles the envelope: model supplies ONLY semantic fields; all metadata is system-owned.
  const parsed = parseOpenAIResult({ response, request, invocation: inv, sourceFreshness, contextPackageRef, provenance, triggerKind, timestamps, clock });
  if (!parsed.ok) return { ok: false, failureKind: parsed.failureKind, reason: parsed.reason, usage: { estCostUsd, invoked: true } };

  const actualInput = (response.usage && response.usage.inputTokens) || inv.inputTokensEstimate;
  const actualOutput = (response.usage && response.usage.outputTokens) || inv.maxOutputTokens;
  const actualCostUsd = estimateCost({ inputTokens: actualInput, outputTokens: actualOutput, pricing });
  return { ok: true, result: parsed.result, usage: { estCostUsd, actualCostUsd, inputTokens: actualInput, outputTokens: actualOutput, invoked: true, pricingSource: pricing.source || null } };
}
