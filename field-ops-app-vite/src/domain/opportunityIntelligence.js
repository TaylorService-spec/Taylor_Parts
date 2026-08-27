// NORTH STAR OPPORTUNITY INTELLIGENCE — first bounded slice.
//
// EOS owns Opportunity truth. This module consumes ONLY the existing Opportunity North Star
// attention derivation; it does not create another sales judgement, probability, forecast, stage,
// close date, price, currency, agreement state or action authority.
//
// There is deliberately NO recommendation in this first slice. Opportunity lifecycle commands move
// a commercial record. The presence of a legal transition is not enough evidence that AI should
// recommend taking it. A future recommendation must be tied to an independently established EOS
// condition, not to model preference.
//
// Model-visible input contains only EOS-established attention kinds and bounded business wording.
// It excludes record ids, owner ids, customer ids, expected value, close dates, stage dates,
// nextAction text, agreement/order ids and all money/currency claims.

import { opportunityAttentionStrip } from "./opportunityNorthStar.js";

export const OPPORTUNITY_INTELLIGENCE_ORIGIN = Object.freeze({
  DETERMINISTIC: "DETERMINISTIC",
  MODEL: "MODEL",
});

export const OPPORTUNITY_INTELLIGENCE_REASON = Object.freeze({
  READY: "READY",
  NO_ATTENTION: "NO_ATTENTION",
  INPUT_INVALID: "INPUT_INVALID",
  CLOSED: "CLOSED",
});

const SUPPORTED = Object.freeze({
  DECISION_PENDING: Object.freeze({
    key: "opportunity-decision-pending",
    kind: "DECISION_PENDING",
    summary: "The opportunity is awaiting a customer decision.",
  }),
  NO_NEXT_ACTION: Object.freeze({
    key: "opportunity-no-next-action",
    kind: "NO_NEXT_ACTION",
    summary: "No next action is recorded for the opportunity.",
  }),
  CLOSE_OVERDUE: Object.freeze({
    key: "opportunity-close-overdue",
    kind: "CLOSE_OVERDUE",
    summary: "The expected close condition is overdue.",
  }),
  CLOSE_SOON: Object.freeze({
    key: "opportunity-close-soon",
    kind: "CLOSE_SOON",
    summary: "The expected close condition is approaching.",
  }),
});

/**
 * Derive bounded contextual intelligence from the exact attention reasons the Opportunity page
 * already consumes. `nowMillis` is injected for parity with opportunityAttentionStrip; this module
 * never computes its own timing threshold.
 */
export function deriveOpportunityIntelligence(opportunity, nowMillis) {
  if (!opportunity || typeof opportunity !== "object") {
    return silent(OPPORTUNITY_INTELLIGENCE_REASON.INPUT_INVALID);
  }

  if (opportunity.outcome === "WON" || opportunity.outcome === "LOST") {
    return silent(OPPORTUNITY_INTELLIGENCE_REASON.CLOSED);
  }

  const strip = opportunityAttentionStrip(opportunity, nowMillis);
  if (!strip || !Array.isArray(strip.reasons)) {
    return silent(OPPORTUNITY_INTELLIGENCE_REASON.INPUT_INVALID);
  }

  const evidence = [];
  for (const reason of strip.reasons) {
    const item = reason && SUPPORTED[reason.kind];
    if (!item) {
      // Fail closed when the upstream domain adds a reason this contract has not been reviewed for.
      return silent(OPPORTUNITY_INTELLIGENCE_REASON.INPUT_INVALID);
    }
    evidence.push(item);
  }

  if (evidence.length === 0) return silent(OPPORTUNITY_INTELLIGENCE_REASON.NO_ATTENTION);

  const observedFact = evidence.length === 1
    ? evidence[0].summary
    : "EOS has established multiple attention conditions on this opportunity.";

  return Object.freeze({
    speak: true,
    origin: OPPORTUNITY_INTELLIGENCE_ORIGIN.DETERMINISTIC,
    reason: OPPORTUNITY_INTELLIGENCE_REASON.READY,
    observedFact,
    evidence: Object.freeze(evidence.map((item) => Object.freeze({ ...item }))),
    allowedRecommendation: null,
  });
}

/** Only this raw-id-free, money-free shape may leave EOS for Opportunity model interpretation. */
export function toOpportunityModelInput(intelligence) {
  if (!intelligence?.speak || intelligence.reason !== OPPORTUNITY_INTELLIGENCE_REASON.READY) return null;
  if (intelligence.allowedRecommendation !== null) return null;
  if (!Array.isArray(intelligence.evidence) || intelligence.evidence.length === 0) return null;

  return Object.freeze({
    schemaVersion: 1,
    observedFact: intelligence.observedFact,
    evidence: Object.freeze(intelligence.evidence.map(({ key, kind, summary }) =>
      Object.freeze({ key, kind, summary }))),
    allowedRecommendation: null,
  });
}

function silent(reason) {
  return Object.freeze({
    speak: false,
    origin: OPPORTUNITY_INTELLIGENCE_ORIGIN.DETERMINISTIC,
    reason,
    observedFact: null,
    evidence: Object.freeze([]),
    allowedRecommendation: null,
  });
}
