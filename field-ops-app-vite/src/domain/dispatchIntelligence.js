export const DISPATCH_INTELLIGENCE_REASON = Object.freeze({ READY: "READY", NO_ATTENTION: "NO_ATTENTION", INPUT_INCOMPLETE: "INPUT_INCOMPLETE", INPUT_INVALID: "INPUT_INVALID" });

const EVIDENCE_BY_REASON = Object.freeze({
  READY_TO_DISPATCH: Object.freeze({ key: "READY_TO_SCHEDULE", kind: "READY_TO_SCHEDULE", summary: "Governed work is ready to schedule." }),
  PAST_DUE: Object.freeze({ key: "PAST_DUE_WORK", kind: "PAST_DUE_WORK", summary: "Scheduled work is past due." }),
  OVERLAP: Object.freeze({ key: "SCHEDULING_CONFLICT", kind: "SCHEDULING_CONFLICT", summary: "The governed schedule contains a conflict." }),
  SHORT: Object.freeze({ key: "PARTS_BLOCKED", kind: "PARTS_BLOCKED", summary: "Governed work has a confirmed parts shortfall." }),
  PROCUREMENT_PENDING: Object.freeze({ key: "PROCUREMENT_PENDING", kind: "PROCUREMENT_PENDING", summary: "A parts shortfall is already in the procurement workflow." }),
});

export function deriveDispatchIntelligence(attentionItems, { projectionComplete = false } = {}) {
  if (projectionComplete !== true) return silent(DISPATCH_INTELLIGENCE_REASON.INPUT_INCOMPLETE);
  if (!Array.isArray(attentionItems)) return silent(DISPATCH_INTELLIGENCE_REASON.INPUT_INVALID);
  const found = new Map();
  for (const item of attentionItems) {
    if (!item || typeof item !== "object" || item.domain !== "workOrder") return silent(DISPATCH_INTELLIGENCE_REASON.INPUT_INVALID);
    const evidence = EVIDENCE_BY_REASON[item.reason];
    if (evidence) found.set(evidence.key, evidence);
  }
  const evidence = [...found.values()];
  if (evidence.length === 0) return silent(DISPATCH_INTELLIGENCE_REASON.NO_ATTENTION);
  return Object.freeze({
    speak: true,
    origin: "DETERMINISTIC",
    reason: DISPATCH_INTELLIGENCE_REASON.READY,
    observedFact: "Dispatch has governed attention conditions that need human review.",
    evidence: Object.freeze(evidence.map((item) => Object.freeze({ ...item }))),
    allowedRecommendation: null,
  });
}

export function buildDispatchInterpretationInput(intelligence) {
  if (!intelligence?.speak || intelligence.reason !== DISPATCH_INTELLIGENCE_REASON.READY || intelligence.allowedRecommendation !== null || !Array.isArray(intelligence.evidence) || intelligence.evidence.length === 0) return null;
  return Object.freeze({
    schemaVersion: 1,
    observedFact: intelligence.observedFact,
    evidence: Object.freeze(intelligence.evidence.map(({ key, kind, summary }) => Object.freeze({ key, kind, summary }))),
    allowedRecommendation: null,
  });
}

function silent(reason) {
  return Object.freeze({ speak: false, origin: "DETERMINISTIC", reason, observedFact: null, evidence: Object.freeze([]), allowedRecommendation: null });
}
