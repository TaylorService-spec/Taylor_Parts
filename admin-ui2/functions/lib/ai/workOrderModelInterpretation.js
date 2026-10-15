"use strict";
// WORK ORDER MODEL INTERPRETATION — PURE, FAIL-CLOSED CONTRACT.
//
// The model is never an authority. EOS supplies immutable observed facts, evidence and any existing
// governed action that may be recommended. The model may only explain those inputs. It cannot add
// facts, evidence, actions, permissions, writes, identifiers or database lookups.
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyWorkOrderModelInterpretation = verifyWorkOrderModelInterpretation;
exports.buildWorkOrderInterpretationPromptPayload = buildWorkOrderInterpretationPromptPayload;
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
function verifyWorkOrderModelInterpretation(input, candidate) {
    if (!isPlainObject(candidate))
        return reject("MODEL_OUTPUT_INVALID");
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
    const evidenceByKey = new Map(input.evidence.map((item) => [item.key, item]));
    const uniqueRefs = [...new Set(evidenceRefs.map((ref) => ref.trim()))];
    if (uniqueRefs.some((ref) => !evidenceByKey.has(ref))) {
        return reject("MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
    }
    let recommendedAction = null;
    if (recommendedActionId != null) {
        if (typeof recommendedActionId !== "string" || recommendedActionId.trim().length === 0) {
            return reject("MODEL_OUTPUT_INVALID");
        }
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
        // Observed fact is copied from EOS input, never accepted from model output.
        observedFact: input.observedFact,
        interpretation,
        businessConsequence,
        confidence: { level: confidence, basis: confidenceBasis },
        recommendedAction,
        // Provenance is resolved by EOS from model-selected opaque evidence keys.
        evidence: uniqueRefs.map((ref) => evidenceByKey.get(ref)),
    };
}
/**
 * Prompt payload deliberately excludes authority internals and all raw database identifiers. The
 * provider receives only the already-sanitized fact, evidence summaries, and at most one action EOS
 * has independently decided may be proposed. A DENIED action is converted to null before it can
 * reach the provider; the model never needs to know an action it cannot recommend.
 */
function buildWorkOrderInterpretationPromptPayload(input) {
    const allowedRecommendation = input.allowedRecommendation?.authority === "ALLOWED"
        ? input.allowedRecommendation
        : null;
    return {
        schemaVersion: input.schemaVersion,
        subjectReference: input.subjectReference,
        observedFact: input.observedFact,
        deterministicInterpretation: input.deterministicInterpretation,
        deterministicBusinessConsequence: input.deterministicBusinessConsequence,
        evidence: input.evidence.map(({ key, kind, summary }) => ({ key, kind, summary })),
        allowedRecommendation: allowedRecommendation
            ? {
                actionId: allowedRecommendation.actionId,
                label: allowedRecommendation.label,
                authority: allowedRecommendation.authority,
            }
            : null,
    };
}
function reject(reason) {
    return { speak: false, origin: "MODEL", reason };
}
function nonEmptyString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=workOrderModelInterpretation.js.map