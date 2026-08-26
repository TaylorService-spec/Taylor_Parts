// WORK ORDER MODEL INTERPRETATION — PURE, FAIL-CLOSED CONTRACT.
//
// The model is never an authority. EOS supplies immutable observed facts, evidence and any existing
// governed action that may be recommended. The model may only explain those inputs. It cannot add
// facts, evidence, actions, permissions, writes, identifiers or database lookups.

export type WorkOrderModelConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface WorkOrderInterpretationEvidence {
  readonly key: string;
  readonly kind: string;
  readonly summary: string;
}

export interface WorkOrderAllowedRecommendation {
  readonly actionId: string;
  readonly label: string;
  readonly authority: "ALLOWED" | "DENIED";
}

export interface WorkOrderInterpretationInput {
  readonly schemaVersion: 1;
  readonly subjectReference: string | null;
  readonly observedFact: string;
  readonly deterministicInterpretation: string | null;
  readonly deterministicBusinessConsequence: string | null;
  readonly evidence: readonly WorkOrderInterpretationEvidence[];
  readonly allowedRecommendation: WorkOrderAllowedRecommendation | null;
}

export interface WorkOrderModelCandidate {
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: WorkOrderModelConfidence;
  readonly confidenceBasis: string;
  readonly evidenceRefs: readonly string[];
  readonly recommendedActionId: string | null;
}

export type WorkOrderInterpretationRejectionReason =
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE"
  | "MODEL_OUTPUT_ACTION_NOT_ALLOWED"
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_UNGROUNDED";

export interface VerifiedWorkOrderInterpretation {
  readonly speak: true;
  readonly origin: "MODEL";
  readonly observedFact: string;
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: {
    readonly level: WorkOrderModelConfidence;
    readonly basis: string;
  };
  readonly recommendedAction: WorkOrderAllowedRecommendation | null;
  readonly evidence: readonly WorkOrderInterpretationEvidence[];
}

export interface RejectedWorkOrderInterpretation {
  readonly speak: false;
  readonly origin: "MODEL";
  readonly reason: WorkOrderInterpretationRejectionReason;
}

export type WorkOrderInterpretationVerification =
  | VerifiedWorkOrderInterpretation
  | RejectedWorkOrderInterpretation;

const CANDIDATE_KEYS = new Set([
  "interpretation",
  "businessConsequence",
  "confidence",
  "confidenceBasis",
  "evidenceRefs",
  "recommendedActionId",
]);

/**
 * Turn untrusted model JSON into a North Star interpretation only when every model-owned field is
 * grounded in EOS-owned inputs. Any ambiguity returns `speak:false`; there is no partial salvage.
 */
export function verifyWorkOrderModelInterpretation(
  input: WorkOrderInterpretationInput,
  candidate: unknown,
): WorkOrderInterpretationVerification {
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
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0 ||
      evidenceRefs.some((ref) => typeof ref !== "string" || ref.trim().length === 0)) {
    return reject("MODEL_OUTPUT_UNGROUNDED");
  }

  const evidenceByKey = new Map(input.evidence.map((item) => [item.key, item] as const));
  const uniqueRefs = [...new Set(evidenceRefs.map((ref) => ref.trim()))];
  if (uniqueRefs.some((ref) => !evidenceByKey.has(ref))) {
    return reject("MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
  }

  let recommendedAction: WorkOrderAllowedRecommendation | null = null;
  if (recommendedActionId != null) {
    if (typeof recommendedActionId !== "string" || recommendedActionId.trim().length === 0) {
      return reject("MODEL_OUTPUT_INVALID");
    }
    if (!input.allowedRecommendation ||
        input.allowedRecommendation.actionId !== recommendedActionId.trim()) {
      return reject("MODEL_OUTPUT_ACTION_NOT_ALLOWED");
    }
    recommendedAction = input.allowedRecommendation;
  }

  return {
    speak: true,
    origin: "MODEL",
    // Observed fact is copied from EOS input, never accepted from model output.
    observedFact: input.observedFact,
    interpretation,
    businessConsequence,
    confidence: { level: confidence, basis: confidenceBasis },
    recommendedAction,
    // Provenance is resolved by EOS from model-selected opaque evidence keys.
    evidence: uniqueRefs.map((ref) => evidenceByKey.get(ref)!),
  };
}

/**
 * Prompt payload deliberately excludes authority internals and all raw database identifiers. The
 * provider receives only the already-sanitized fact, evidence summaries, and at most one action EOS
 * has independently decided may be proposed.
 */
export function buildWorkOrderInterpretationPromptPayload(input: WorkOrderInterpretationInput) {
  return {
    schemaVersion: input.schemaVersion,
    subjectReference: input.subjectReference,
    observedFact: input.observedFact,
    deterministicInterpretation: input.deterministicInterpretation,
    deterministicBusinessConsequence: input.deterministicBusinessConsequence,
    evidence: input.evidence.map(({ key, kind, summary }) => ({ key, kind, summary })),
    allowedRecommendation: input.allowedRecommendation
      ? {
          actionId: input.allowedRecommendation.actionId,
          label: input.allowedRecommendation.label,
          authority: input.allowedRecommendation.authority,
        }
      : null,
  };
}

function reject(reason: WorkOrderInterpretationRejectionReason): RejectedWorkOrderInterpretation {
  return { speak: false, origin: "MODEL", reason };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
