export type DispatchModelConfidence = "HIGH" | "MEDIUM" | "LOW";
export type DispatchEvidenceKind = "READY_TO_SCHEDULE" | "PAST_DUE_WORK" | "SCHEDULING_CONFLICT" | "PARTS_BLOCKED" | "PROCUREMENT_PENDING";

export interface DispatchInterpretationEvidence {
  readonly key: string;
  readonly kind: DispatchEvidenceKind;
  readonly summary: string;
}

export interface DispatchInterpretationInput {
  readonly schemaVersion: 1;
  readonly observedFact: string;
  readonly evidence: readonly DispatchInterpretationEvidence[];
  readonly allowedRecommendation: null;
}

export type DispatchInterpretationRejectionReason =
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_UNGROUNDED"
  | "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE"
  | "MODEL_OUTPUT_ACTION_NOT_ALLOWED"
  | "MODEL_OUTPUT_SCHEDULING_FABRICATION";

const CANDIDATE_KEYS = new Set(["interpretation", "businessConsequence", "confidence", "confidenceBasis", "evidenceRefs", "recommendedActionId"]);
const DIGIT = /\d/;
const SCHEDULING_FACT = /\b(?:technician|tech|employee|crew|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|hour|minute|reschedule to|assign to)\b/i;
const ALLOWED_KINDS = new Set<DispatchEvidenceKind>(["READY_TO_SCHEDULE", "PAST_DUE_WORK", "SCHEDULING_CONFLICT", "PARTS_BLOCKED", "PROCUREMENT_PENDING"]);

export function verifyDispatchModelInterpretation(input: DispatchInterpretationInput, candidate: unknown) {
  if (!validInput(input) || !isPlainObject(candidate)) return reject("MODEL_OUTPUT_INVALID");
  if (Object.keys(candidate).some((key) => !CANDIDATE_KEYS.has(key))) return reject("MODEL_OUTPUT_INVALID");
  const interpretation = text(candidate.interpretation);
  const businessConsequence = text(candidate.businessConsequence);
  const confidenceBasis = text(candidate.confidenceBasis);
  const confidence = candidate.confidence;
  if (!interpretation || !businessConsequence || !confidenceBasis) return reject("MODEL_OUTPUT_EMPTY");
  if (confidence !== "HIGH" && confidence !== "MEDIUM" && confidence !== "LOW") return reject("MODEL_OUTPUT_INVALID");
  if (candidate.recommendedActionId !== null) return reject("MODEL_OUTPUT_ACTION_NOT_ALLOWED");
  for (const prose of [interpretation, businessConsequence, confidenceBasis]) {
    if (DIGIT.test(prose) || SCHEDULING_FACT.test(prose)) return reject("MODEL_OUTPUT_SCHEDULING_FABRICATION");
  }
  const refs = candidate.evidenceRefs;
  if (!Array.isArray(refs) || refs.length === 0 || refs.some((ref) => typeof ref !== "string" || ref.trim().length === 0)) return reject("MODEL_OUTPUT_UNGROUNDED");
  const evidenceByKey = new Map(input.evidence.map((item) => [item.key, item] as const));
  const uniqueRefs = [...new Set(refs.map((ref) => ref.trim()))];
  if (uniqueRefs.some((ref) => !evidenceByKey.has(ref))) return reject("MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
  return {
    speak: true as const,
    origin: "MODEL" as const,
    observedFact: input.observedFact,
    interpretation,
    businessConsequence,
    confidence: { level: confidence, basis: confidenceBasis },
    recommendedAction: null,
    evidence: uniqueRefs.map((ref) => evidenceByKey.get(ref)!),
  };
}

function validInput(input: DispatchInterpretationInput) {
  if (!input || input.schemaVersion !== 1 || input.allowedRecommendation !== null || !text(input.observedFact) || !Array.isArray(input.evidence) || input.evidence.length === 0) return false;
  const keys = new Set<string>();
  for (const item of input.evidence) {
    if (!item || !text(item.key) || !text(item.summary) || !ALLOWED_KINDS.has(item.kind) || keys.has(item.key)) return false;
    keys.add(item.key);
  }
  return true;
}
function reject(reason: DispatchInterpretationRejectionReason) { return { speak: false as const, origin: "MODEL" as const, reason }; }
function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown) { return typeof value === "string" && value.trim().length > 0 ? value.trim() : null; }
