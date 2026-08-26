// NORTH STAR PARTS / INVENTORY INTELLIGENCE — first governed slice.
//
// EOS supplies one already-normalized Parts Attention item plus the signed-in user's identity.
// This contract does not inspect quantities, vendors, prices, PO state, inventory balances or dates.
// Its only conclusion is that an already-assigned reorder request is ready for the EXISTING
// startPurchasing action to be offered to that same assignee.

import {
  deriveGovernedPartsStartPurchasingRecommendation,
  PARTS_RECOMMENDATION_REASON,
} from "./partsGovernedRecommendation.js";

export const PARTS_INTELLIGENCE_ORIGIN = Object.freeze({
  DETERMINISTIC: "DETERMINISTIC",
  MODEL: "MODEL",
});

export const PARTS_INTELLIGENCE_REASON = Object.freeze({
  READY: "READY",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  AUTHORITY_DENIED: "AUTHORITY_DENIED",
});

export function derivePartsIntelligence(attentionItem, { currentUserId = null } = {}) {
  const governed = deriveGovernedPartsStartPurchasingRecommendation(attentionItem, { currentUserId });

  if (!governed.speak) {
    return Object.freeze({
      speak: false,
      origin: PARTS_INTELLIGENCE_ORIGIN.DETERMINISTIC,
      reason: governed.reason === PARTS_RECOMMENDATION_REASON.CALLER_NOT_ASSIGNEE
        ? PARTS_INTELLIGENCE_REASON.AUTHORITY_DENIED
        : PARTS_INTELLIGENCE_REASON.NOT_APPLICABLE,
      observedFact: null,
      interpretation: null,
      businessConsequence: null,
      evidence: Object.freeze([]),
      recommendation: null,
      execution: null,
    });
  }

  return Object.freeze({
    speak: true,
    origin: PARTS_INTELLIGENCE_ORIGIN.DETERMINISTIC,
    reason: PARTS_INTELLIGENCE_REASON.READY,
    observedFact: "A reorder request assigned to you is ready for purchasing to start.",
    interpretation: "The request has reached the existing assigned-purchaser work step.",
    businessConsequence: "Purchasing has not yet been marked as started for this assigned request.",
    evidence: Object.freeze([
      Object.freeze({
        key: "reorder-assigned-to-caller",
        kind: "REORDER_ASSIGNED_TO_CALLER",
        summary: "The governed reorder workflow assigns this request to the current user.",
      }),
    ]),
    recommendation: governed.recommendation,
    // EOS-only, retained for human acceptance and excluded from model input below.
    execution: governed.execution,
  });
}

/** Raw-id-free, quantity-free, vendor-free input permitted to leave EOS for model interpretation. */
export function buildPartsInterpretationInput(intelligence) {
  if (!intelligence?.speak || intelligence.reason !== PARTS_INTELLIGENCE_REASON.READY) return null;
  if (intelligence.recommendation?.authority !== "ALLOWED") return null;

  return Object.freeze({
    schemaVersion: 1,
    observedFact: intelligence.observedFact,
    deterministicInterpretation: intelligence.interpretation,
    deterministicBusinessConsequence: intelligence.businessConsequence,
    evidence: Object.freeze(intelligence.evidence.map(({ key, kind, summary }) =>
      Object.freeze({ key, kind, summary }))),
    allowedRecommendation: Object.freeze({
      actionId: intelligence.recommendation.actionId,
      label: intelligence.recommendation.label,
      authority: "ALLOWED",
    }),
  });
}
