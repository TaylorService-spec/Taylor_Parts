// OPPORTUNITY MODEL INTERPRETATION — PURE, FAIL-CLOSED CONTRACT.
//
// EOS supplies every fact and every evidence key. The model may explain those inputs only.
// Opportunity is a commercial record, so the verifier refuses model-authored numbers, currency,
// probabilities, percentages, dates and any action recommendation in this first slice.

export type OpportunityModelConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface OpportunityInterpretationEvidence {
  readonly key: string;
  readonly kind: string;
  readonly summary: string;
}

export interface OpportunityInterpretationInput {
  readonly schemaVersion: 1;
  readonly observedFact: string;
  readonly evidence: readonly OpportunityInterpretationEvidence[];
  readonly allowedRecommendation: null;
}

export interface OpportunityModelCandidate {
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: OpportunityModelConfidence;
  readonly confidenceBasis: string;
  readonly evidenceRefs: readonly string[];
  readonly recommendedActionId: null;
}

export type OpportunityInterpretationRejectionReason =
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE"
  | "MODEL_OUTPUT_ACTION_NOT_ALLOWED"
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_UNGROUNDED"
  | "MODEL_OUTPUT_COMMERCIAL_FABRICATION";

export interface VerifiedOpportunityInterpretation {
  readonly speak: true;
  readonly origin: "MODEL";
  readonly observedFact: string;
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: { readonly level: OpportunityModelConfidence; readonly basis: string };
  readonly recommendedAction: null;
  readonly evidence: readonly OpportunityInterpretationEvidence[];
}

export interface RejectedOpportunityInterpretation {
  readonly speak: false;
  readonly origin: "MODEL";
  readonly reason: OpportunityInterpretationRejectionReason;
}

export type OpportunityInterpretationVerification =
  | VerifiedOpportunityInterpretation
  | RejectedOpportunityInterpretation;

const CANDIDATE_KEYS = new Set([
  "interpretation",
  "businessConsequence",
  "confidence",
  "confidenceBasis",
  "evidenceRefs",
  "recommendedActionId",
]);

// Numbers on an Opportunity are commercially loaded: value, probability, stage ordinal, timing,
// days-to-close and forecast claims. None may originate in model prose. Currency/percentage words
// are refused even without digits. Month names and ISO-like date fragments are refused as well.
const NUMERIC = /\d/;
const COMMERCIAL_TOKEN = /[$£€¥]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|percent|percentage|probability|forecast)\b/i;
const DATE_TOKEN = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i;

export function verifyOpportunityModelInterpretation(
  input: OpportunityInterpretationInput,
  candidate: unknown,
): OpportunityInterpretationVerification {
  if (!isPlainObject(candidate)) return reject("MODEL_OUTPUT_INVALID");
  if (Object.keys(candidate).some((key) => !CANDIDATE_KEYS.has(key))) {
    return reject("MODEL_OUTPUT_INVALID");
  }

  const interpretation = nonEmptyString(candidate.interpretation);
  const businessConsequence = nonEmptyString(candidate.businessConsequence);
  const confidenceBasis = nonEmptyString(candidate.confidenceBasis);
  const confidence = candidate.confidence;
  const evidenceRefs = candidate.evidenceRefs;

  if (!interpretation || !businessConsequence || !confidenceBasis) {
    return reject("MODEL_OUTPUT_EMPTY");
  }
  if (confidence !== "HIGH" && confidence !== "MEDIUM" && confidence !== "LOW") {
    return reject("MODEL_OUTPUT_INVALID");
  }

  for (const prose of [interpretation, businessConsequence, confidenceBasis]) {
    if (NUMERIC.test(prose) || COMMERCIAL_TOKEN.test(prose) || DATE_TOKEN.test(prose)) {
      return reject("MODEL_OUTPUT_COMMERCIAL_FABRICATION");
    }
  }

  if (candidate.recommendedActionId !== null) {
    return reject("MODEL_OUTPUT_ACTION_NOT_ALLOWED");
  }

  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0 ||
      evidenceRefs.some((ref) => typeof ref !== "string" || ref.trim().length === 0)) {
    return reject("MODEL_OUTPUT_UNGROUNDED");
  }

  const evidenceByKey = new Map(input.evidence.map((item) => [item.key, item] as const));
  const uniqueRefs = [...new Set(evidenceRefs.map((ref) => ref.trim()))];
  if (uniqueRefs.some((ref) => !evidenceByKey.has(ref))) {
    return reject("MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
  }

  return {
    speak: true,
    origin: "MODEL",
    observedFact: input.observedFact,
    interpretation,
    businessConsequence,
    confidence: { level: confidence, basis: confidenceBasis },
    recommendedAction: null,
    evidence: uniqueRefs.map((ref) => evidenceByKey.get(ref)!),
  };
}

function reject(reason: OpportunityInterpretationRejectionReason): RejectedOpportunityInterpretation {
  return { speak: false, origin: "MODEL", reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
