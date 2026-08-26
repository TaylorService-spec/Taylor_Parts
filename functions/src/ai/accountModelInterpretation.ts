// ACCOUNT / CUSTOMER MODEL INTERPRETATION — PURE, FAIL-CLOSED CONTRACT.
//
// EOS supplies the complete set of facts this first Account slice supports. The model may explain
// those facts and select their opaque evidence keys. It may not add evidence, identifiers, amounts,
// dates, quantities, actions or authority. There is intentionally NO allowed recommendation: the
// current EOS role/action model contains no governed collections or customer-follow-up command.

export type AccountModelConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface AccountInterpretationEvidence {
  readonly key: string;
  readonly kind: "AR_OVERDUE" | "WORK_ORDER_PAST_DUE";
  readonly summary: string;
}

export interface AccountInterpretationInput {
  readonly schemaVersion: 1;
  readonly observedFact: string;
  readonly evidence: readonly AccountInterpretationEvidence[];
  readonly allowedRecommendation: null;
}

export interface AccountModelCandidate {
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: AccountModelConfidence;
  readonly confidenceBasis: string;
  readonly evidenceRefs: readonly string[];
  readonly recommendedActionId: null;
}

export type AccountInterpretationRejectionReason =
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_UNGROUNDED"
  | "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE"
  | "MODEL_OUTPUT_ACTION_NOT_ALLOWED"
  | "MODEL_OUTPUT_FACT_FABRICATION";

export interface VerifiedAccountInterpretation {
  readonly speak: true;
  readonly origin: "MODEL";
  readonly observedFact: string;
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: { readonly level: AccountModelConfidence; readonly basis: string };
  readonly recommendedAction: null;
  readonly evidence: readonly AccountInterpretationEvidence[];
}

export interface RejectedAccountInterpretation {
  readonly speak: false;
  readonly origin: "MODEL";
  readonly reason: AccountInterpretationRejectionReason;
}

export type AccountInterpretationVerification = VerifiedAccountInterpretation | RejectedAccountInterpretation;

const CANDIDATE_KEYS = new Set([
  "interpretation",
  "businessConsequence",
  "confidence",
  "confidenceBasis",
  "evidenceRefs",
  "recommendedActionId",
]);

// Model prose may explain the relationship between EOS facts, but figures/dates would be new Account
// facts because none are present in the sanitized input. Keep them out until EOS deliberately adds a
// governed semantic field for them.
const DIGIT = /\d/;
const MONEY_OR_PERCENT = /[$£€¥]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|percent|percentage)\b/i;

export function verifyAccountModelInterpretation(
  input: AccountInterpretationInput,
  candidate: unknown,
): AccountInterpretationVerification {
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

  // No Account action is authorized in this slice. Even a syntactically reasonable action name is
  // an authority invention and therefore cannot be salvaged.
  if (candidate.recommendedActionId !== null) return reject("MODEL_OUTPUT_ACTION_NOT_ALLOWED");

  for (const prose of [interpretation, businessConsequence, confidenceBasis]) {
    if (DIGIT.test(prose) || MONEY_OR_PERCENT.test(prose)) return reject("MODEL_OUTPUT_FACT_FABRICATION");
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

function isValidInput(input: AccountInterpretationInput): boolean {
  if (!input || input.schemaVersion !== 1 || input.allowedRecommendation !== null) return false;
  if (!nonEmptyString(input.observedFact) || !Array.isArray(input.evidence) || input.evidence.length === 0) return false;
  const keys = new Set<string>();
  for (const item of input.evidence) {
    if (!item || !nonEmptyString(item.key) || !nonEmptyString(item.summary)) return false;
    if (item.kind !== "AR_OVERDUE" && item.kind !== "WORK_ORDER_PAST_DUE") return false;
    if (keys.has(item.key)) return false;
    keys.add(item.key);
  }
  return true;
}

function reject(reason: AccountInterpretationRejectionReason): RejectedAccountInterpretation {
  return { speak: false, origin: "MODEL", reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
