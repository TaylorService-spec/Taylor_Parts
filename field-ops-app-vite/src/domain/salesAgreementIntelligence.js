// NORTH STAR SALES AGREEMENT INTELLIGENCE — first bounded slice.
//
// EOS owns every commercial fact on the Agreement. This module consumes only the existing
// acceptance-eligibility derivation and does not create pricing, discount, legal, signature,
// customer-assent or lifecycle authority.
//
// First slice is explanation-only. A DRAFT may need lines or pricing before acceptance, but AI may
// not choose a product, price a line, edit terms, or accept the Agreement. Those remain human
// decisions through existing governed commands.

import {
  SALES_AGREEMENT_VIEW_STATE,
  agreementAcceptability,
} from "./salesAgreementView.js";

export const SALES_AGREEMENT_INTELLIGENCE_REASON = Object.freeze({
  READY: "READY",
  NO_ATTENTION: "NO_ATTENTION",
  INPUT_INVALID: "INPUT_INVALID",
  TERMINAL: "TERMINAL",
});

const EVIDENCE = Object.freeze({
  NO_LINES: Object.freeze({
    key: "sales-agreement-no-lines",
    kind: "NO_LINES",
    summary: "EOS requires at least one line before this draft can be accepted.",
  }),
  UNPRICED_LINES: Object.freeze({
    key: "sales-agreement-unpriced-lines",
    kind: "UNPRICED_LINES",
    summary: "EOS requires every Agreement line to have a recorded price before acceptance.",
  }),
});

export function deriveSalesAgreementIntelligence(view) {
  if (!view || view.kind !== SALES_AGREEMENT_VIEW_STATE.READY) {
    return silent(SALES_AGREEMENT_INTELLIGENCE_REASON.INPUT_INVALID);
  }

  if (view.state === "ACCEPTED" || view.state === "DECLINED") {
    return silent(SALES_AGREEMENT_INTELLIGENCE_REASON.TERMINAL);
  }

  if (view.state !== "DRAFT") {
    return silent(SALES_AGREEMENT_INTELLIGENCE_REASON.INPUT_INVALID);
  }

  const acceptability = agreementAcceptability(view);
  if (acceptability.canAccept) {
    return silent(SALES_AGREEMENT_INTELLIGENCE_REASON.NO_ATTENTION);
  }

  let evidence = null;
  if (!Array.isArray(view.lines) || view.lines.length === 0) {
    evidence = EVIDENCE.NO_LINES;
  } else if (view.lines.some((line) => line?.unitPriceMinor === null)) {
    evidence = EVIDENCE.UNPRICED_LINES;
  } else {
    // The shared acceptance derivation knows a blocker this contract has not reviewed.
    return silent(SALES_AGREEMENT_INTELLIGENCE_REASON.INPUT_INVALID);
  }

  return Object.freeze({
    speak: true,
    origin: "DETERMINISTIC",
    reason: SALES_AGREEMENT_INTELLIGENCE_REASON.READY,
    observedFact: evidence.summary,
    evidence: Object.freeze([evidence]),
    allowedRecommendation: null,
  });
}

// Only semantic, non-commercial detail crosses to model interpretation. No references, line ids,
// quantities, prices, totals, currency, customer PO, terms, actor ids, timestamps or lineage ids.
export function toSalesAgreementModelInput(intelligence) {
  if (!intelligence?.speak || intelligence.reason !== SALES_AGREEMENT_INTELLIGENCE_REASON.READY) {
    return null;
  }
  if (intelligence.allowedRecommendation !== null) return null;
  if (!Array.isArray(intelligence.evidence) || intelligence.evidence.length !== 1) return null;

  const evidence = intelligence.evidence[0];
  return Object.freeze({
    schemaVersion: 1,
    observedFact: intelligence.observedFact,
    evidence: Object.freeze([
      Object.freeze({ key: evidence.key, kind: evidence.kind, summary: evidence.summary }),
    ]),
    allowedRecommendation: null,
  });
}

function silent(reason) {
  return Object.freeze({
    speak: false,
    origin: "DETERMINISTIC",
    reason,
    observedFact: null,
    evidence: Object.freeze([]),
    allowedRecommendation: null,
  });
}
