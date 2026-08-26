// SALES ORDER MODEL INTERPRETATION — PURE, FAIL-CLOSED CONTRACT.
//
// The same verifier discipline as ai/workOrderModelInterpretation.ts, applied to the Sales Order.
// The model is never an authority. EOS supplies immutable observed facts, evidence and any existing
// governed action that may be recommended. The model may only explain those inputs. It cannot add
// facts, evidence, actions, permissions, writes, identifiers or database lookups.
//
// ════════════ WHAT A SALES ORDER MAKES IT EASY TO GET WRONG ════════════
//
// A Work Order is operational; a Sales Order is COMMERCIAL. The failure modes are worse and quieter:
// an invented price, quantity, currency, conversion rate or customer term reads as a fact about
// money the business is owed. So beyond the Work Order verifier's rules, this one refuses model
// prose that introduces a number or a currency at all — every quantity and amount the reader needs
// is already in the deterministic fields EOS wrote, and the model's job is to explain, not to
// restate figures it might transcribe wrongly.

export type SalesOrderModelConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface SalesOrderInterpretationEvidence {
  readonly key: string;
  readonly kind: string;
  readonly summary: string;
}

export interface SalesOrderAllowedRecommendation {
  readonly actionId: string;
  readonly label: string;
  readonly authority: "ALLOWED" | "DENIED";
}

export interface SalesOrderInterpretationInput {
  readonly schemaVersion: 1;
  readonly subjectReference: string | null;
  readonly observedFact: string;
  readonly deterministicInterpretation: string | null;
  readonly deterministicBusinessConsequence: string | null;
  readonly evidence: readonly SalesOrderInterpretationEvidence[];
  readonly allowedRecommendation: SalesOrderAllowedRecommendation | null;
}

export interface SalesOrderModelCandidate {
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: SalesOrderModelConfidence;
  readonly confidenceBasis: string;
  readonly evidenceRefs: readonly string[];
  readonly recommendedActionId: string | null;
}

export type SalesOrderInterpretationRejectionReason =
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE"
  | "MODEL_OUTPUT_ACTION_NOT_ALLOWED"
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_UNGROUNDED"
  | "MODEL_OUTPUT_COMMERCIAL_FABRICATION";

export interface VerifiedSalesOrderInterpretation {
  readonly speak: true;
  readonly origin: "MODEL";
  readonly subjectReference: string | null;
  readonly observedFact: string;
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: { readonly level: SalesOrderModelConfidence; readonly basis: string };
  readonly recommendedAction: SalesOrderAllowedRecommendation | null;
  readonly evidence: readonly SalesOrderInterpretationEvidence[];
}

export interface RejectedSalesOrderInterpretation {
  readonly speak: false;
  readonly origin: "MODEL";
  readonly reason: SalesOrderInterpretationRejectionReason;
}

export type SalesOrderInterpretationVerification =
  | VerifiedSalesOrderInterpretation
  | RejectedSalesOrderInterpretation;

const CANDIDATE_KEYS = new Set([
  "interpretation",
  "businessConsequence",
  "confidence",
  "confidenceBasis",
  "evidenceRefs",
  "recommendedActionId",
]);

// A DIGIT IN MODEL PROSE IS A COMMERCIAL CLAIM. Quantities, prices, percentages and money are all
// numbers, and none of them may originate in model output on a commercial record. EOS already
// stated every figure the reader needs. Currency words and symbols are refused for the same reason:
// "USD" asserted by a model is a term of the sale nobody agreed to.
const NUMERIC = /\d/;
const CURRENCY = /[$£€¥]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|percent)\b/i;

/**
 * Turn untrusted model JSON into a North Star interpretation only when every model-owned field is
 * grounded in EOS-owned inputs. Any ambiguity returns `speak:false`; there is no partial salvage.
 */
export function verifySalesOrderModelInterpretation(
  input: SalesOrderInterpretationInput,
  candidate: unknown,
): SalesOrderInterpretationVerification {
  if (!isPlainObject(candidate)) return reject("MODEL_OUTPUT_INVALID");
  if (Object.keys(candidate).some((key) => !CANDIDATE_KEYS.has(key))) {
    return reject("MODEL_OUTPUT_INVALID");
  }

  const interpretation = nonEmptyString(candidate.interpretation);
  const businessConsequence = nonEmptyString(candidate.businessConsequence);
  const confidenceBasis = nonEmptyString(candidate.confidenceBasis);
  const confidence = candidate.confidence;
  const evidenceRefs = candidate.evidenceRefs;
  const recommendedActionId = candidate.recommendedActionId;

  if (!interpretation || !businessConsequence || !confidenceBasis) {
    return reject("MODEL_OUTPUT_EMPTY");
  }
  if (confidence !== "HIGH" && confidence !== "MEDIUM" && confidence !== "LOW") {
    return reject("MODEL_OUTPUT_INVALID");
  }
  for (const prose of [interpretation, businessConsequence, confidenceBasis]) {
    if (NUMERIC.test(prose) || CURRENCY.test(prose)) {
      return reject("MODEL_OUTPUT_COMMERCIAL_FABRICATION");
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

  let recommendedAction: SalesOrderAllowedRecommendation | null = null;
  if (recommendedActionId != null) {
    if (typeof recommendedActionId !== "string" || recommendedActionId.trim().length === 0) {
      return reject("MODEL_OUTPUT_INVALID");
    }
    // A DENIED recommendation is not a weaker ALLOWED one: it may not be echoed at all.
    if (!input.allowedRecommendation ||
        input.allowedRecommendation.authority !== "ALLOWED" ||
        input.allowedRecommendation.actionId !== recommendedActionId.trim()) {
      return reject("MODEL_OUTPUT_ACTION_NOT_ALLOWED");
    }
    recommendedAction = input.allowedRecommendation;
  }

  return {
    speak: true,
    origin: "MODEL",
    // Subject and observed fact are COPIED from EOS input, never accepted from model output.
    subjectReference: input.subjectReference,
    observedFact: input.observedFact,
    interpretation,
    businessConsequence,
    confidence: { level: confidence, basis: confidenceBasis },
    recommendedAction,
    // Provenance is resolved by EOS from model-selected opaque evidence keys.
    evidence: uniqueRefs.map((ref) => evidenceByKey.get(ref)!),
  };
}

function reject(reason: SalesOrderInterpretationRejectionReason): RejectedSalesOrderInterpretation {
  return { speak: false, origin: "MODEL", reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
