// SALES AGREEMENT MODEL INTERPRETATION — PURE, FAIL-CLOSED CONTRACT.
//
// EOS supplies every fact and evidence key. The model may explain only those facts. It may not
// author money, terms, legal conclusions, customer assent/signature evidence, dates, identities or
// actions. This first slice has no executable recommendation.

export type SalesAgreementModelConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface SalesAgreementInterpretationEvidence {
  readonly key: string;
  readonly kind: string;
  readonly summary: string;
}

export interface SalesAgreementInterpretationInput {
  readonly schemaVersion: 1;
  readonly observedFact: string;
  readonly evidence: readonly SalesAgreementInterpretationEvidence[];
  readonly allowedRecommendation: null;
}

export interface SalesAgreementModelCandidate {
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: SalesAgreementModelConfidence;
  readonly confidenceBasis: string;
  readonly evidenceRefs: readonly string[];
  readonly recommendedActionId: null;
}

export type SalesAgreementInterpretationRejectionReason =
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE"
  | "MODEL_OUTPUT_ACTION_NOT_ALLOWED"
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_UNGROUNDED"
  | "MODEL_OUTPUT_COMMERCIAL_FABRICATION"
  | "MODEL_OUTPUT_ACCEPTANCE_FABRICATION";

export interface VerifiedSalesAgreementInterpretation {
  readonly speak: true;
  readonly origin: "MODEL";
  readonly observedFact: string;
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: { readonly level: SalesAgreementModelConfidence; readonly basis: string };
  readonly recommendedAction: null;
  readonly evidence: readonly SalesAgreementInterpretationEvidence[];
}

export interface RejectedSalesAgreementInterpretation {
  readonly speak: false;
  readonly origin: "MODEL";
  readonly reason: SalesAgreementInterpretationRejectionReason;
}

export type SalesAgreementInterpretationVerification =
  | VerifiedSalesAgreementInterpretation
  | RejectedSalesAgreementInterpretation;

const CANDIDATE_KEYS = new Set([
  "interpretation",
  "businessConsequence",
  "confidence",
  "confidenceBasis",
  "evidenceRefs",
  "recommendedActionId",
]);

const NUMERIC = /\d/;
const MONEY_OR_COMMERCIAL = /[$£€¥]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|price|priced at|discount|margin|tax|total|deposit|down payment|trade-in)\b/i;
// EOS records no customer-signature/assent fact. Include possessive wording explicitly; a boundary
// that rejects "customer commitment" but accepts "customer's commitment" is a spelling filter, not
// an evidence control.
const ACCEPTANCE_OR_LEGAL = /\b(?:binding|bound|legally|enforceable|signed|signature|electronically|customer accepted|customer approved|customer agreed|customer consent|customer(?:'s)? commitment)\b/i;
const DATE_TOKEN = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i;

export function verifySalesAgreementModelInterpretation(
  input: SalesAgreementInterpretationInput,
  candidate: unknown,
): SalesAgreementInterpretationVerification {
  if (!isPlainObject(candidate)) return reject("MODEL_OUTPUT_INVALID");
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
    if (ACCEPTANCE_OR_LEGAL.test(prose)) return reject("MODEL_OUTPUT_ACCEPTANCE_FABRICATION");
    if (NUMERIC.test(prose) || MONEY_OR_COMMERCIAL.test(prose) || DATE_TOKEN.test(prose)) {
      return reject("MODEL_OUTPUT_COMMERCIAL_FABRICATION");
    }
  }

  if (candidate.recommendedActionId !== null) return reject("MODEL_OUTPUT_ACTION_NOT_ALLOWED");

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

function reject(reason: SalesAgreementInterpretationRejectionReason): RejectedSalesAgreementInterpretation {
  return { speak: false, origin: "MODEL", reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
