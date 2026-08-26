// PARTS / INVENTORY MODEL INTERPRETATION — PURE, FAIL-CLOSED CONTRACT.
//
// The model may explain one EOS-established assigned-reorder fact and may repeat only the already-
// allowed startPurchasing action. It may not introduce quantities, money, dates, vendors, purchase
// orders, inventory positions, assignees, identifiers, evidence or any other procurement action.

export type PartsModelConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface PartsInterpretationEvidence {
  readonly key: string;
  readonly kind: "REORDER_ASSIGNED_TO_CALLER";
  readonly summary: string;
}

export interface PartsAllowedRecommendation {
  readonly actionId: "startPurchasing";
  readonly label: string;
  readonly authority: "ALLOWED";
}

export interface PartsInterpretationInput {
  readonly schemaVersion: 1;
  readonly observedFact: string;
  readonly deterministicInterpretation: string;
  readonly deterministicBusinessConsequence: string;
  readonly evidence: readonly PartsInterpretationEvidence[];
  readonly allowedRecommendation: PartsAllowedRecommendation;
}

export interface PartsModelCandidate {
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: PartsModelConfidence;
  readonly confidenceBasis: string;
  readonly evidenceRefs: readonly string[];
  readonly recommendedActionId: string | null;
}

export type PartsInterpretationRejectionReason =
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_UNGROUNDED"
  | "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE"
  | "MODEL_OUTPUT_ACTION_NOT_ALLOWED"
  | "MODEL_OUTPUT_PROCUREMENT_FABRICATION";

export interface VerifiedPartsInterpretation {
  readonly speak: true;
  readonly origin: "MODEL";
  readonly observedFact: string;
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: { readonly level: PartsModelConfidence; readonly basis: string };
  readonly recommendedAction: PartsAllowedRecommendation | null;
  readonly evidence: readonly PartsInterpretationEvidence[];
}

export interface RejectedPartsInterpretation {
  readonly speak: false;
  readonly origin: "MODEL";
  readonly reason: PartsInterpretationRejectionReason;
}

export type PartsInterpretationVerification = VerifiedPartsInterpretation | RejectedPartsInterpretation;

const CANDIDATE_KEYS = new Set([
  "interpretation",
  "businessConsequence",
  "confidence",
  "confidenceBasis",
  "evidenceRefs",
  "recommendedActionId",
]);

// The sanitized input intentionally carries none of these details. A digit/currency/vendor/PO claim
// in model prose therefore necessarily originated in the model and is refused.
const DIGIT = /\d/;
const PROCUREMENT_FACT = /[$£€¥]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|percent|percentage|vendor|supplier|purchase order|\bPO\b|stock|inventory balance|quantity|qty|ETA|expected date)\b/i;

export function verifyPartsModelInterpretation(
  input: PartsInterpretationInput,
  candidate: unknown,
): PartsInterpretationVerification {
  if (!isValidInput(input) || !isPlainObject(candidate)) return reject("MODEL_OUTPUT_INVALID");
  if (Object.keys(candidate).some((key) => !CANDIDATE_KEYS.has(key))) return reject("MODEL_OUTPUT_INVALID");

  const interpretation = nonEmptyString(candidate.interpretation);
  const businessConsequence = nonEmptyString(candidate.businessConsequence);
  const confidenceBasis = nonEmptyString(candidate.confidenceBasis);
  const confidence = candidate.confidence;
  const evidenceRefs = candidate.evidenceRefs;

  if (!interpretation || !businessConsequence || !confidenceBasis) return reject("MODEL_OUTPUT_EMPTY");
  if (confidence !== "HIGH" && confidence !== "MEDIUM" && confidence !== "LOW") {
    return reject("MODEL_OUTPUT_INVALID");
  }
  for (const prose of [interpretation, businessConsequence, confidenceBasis]) {
    if (DIGIT.test(prose) || PROCUREMENT_FACT.test(prose)) {
      return reject("MODEL_OUTPUT_PROCUREMENT_FABRICATION");
    }
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

  let recommendedAction: PartsAllowedRecommendation | null = null;
  if (candidate.recommendedActionId != null) {
    if (candidate.recommendedActionId !== input.allowedRecommendation.actionId) {
      return reject("MODEL_OUTPUT_ACTION_NOT_ALLOWED");
    }
    recommendedAction = input.allowedRecommendation;
  }

  return {
    speak: true,
    origin: "MODEL",
    observedFact: input.observedFact,
    interpretation,
    businessConsequence,
    confidence: { level: confidence, basis: confidenceBasis },
    recommendedAction,
    evidence: uniqueRefs.map((ref) => evidenceByKey.get(ref)!),
  };
}

function isValidInput(input: PartsInterpretationInput): boolean {
  if (!input || input.schemaVersion !== 1) return false;
  if (!nonEmptyString(input.observedFact) || !nonEmptyString(input.deterministicInterpretation) ||
      !nonEmptyString(input.deterministicBusinessConsequence)) return false;
  if (!Array.isArray(input.evidence) || input.evidence.length !== 1) return false;
  const evidence = input.evidence[0];
  if (!evidence || evidence.key !== "reorder-assigned-to-caller" ||
      evidence.kind !== "REORDER_ASSIGNED_TO_CALLER" || !nonEmptyString(evidence.summary)) return false;
  return input.allowedRecommendation?.actionId === "startPurchasing" &&
    input.allowedRecommendation.authority === "ALLOWED" &&
    !!nonEmptyString(input.allowedRecommendation.label);
}

function reject(reason: PartsInterpretationRejectionReason): RejectedPartsInterpretation {
  return { speak: false, origin: "MODEL", reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
