import { workOrderPartsPlan } from "./workOrderNorthStar.js";
import { deriveGovernedWorkOrderPartsRecommendation } from "./workOrderGovernedRecommendation.js";

// NORTH STAR WORK ORDER INTELLIGENCE CONTRACT
//
// This is the seam between governed EOS facts and future model interpretation.
// It is deliberately PURE: no Firestore, no model, no clock, no write path.
//
// IMPORTANT: readiness is NOT derived here. `workOrderPartsReadiness.js` already owns that authority.
// This layer consumes its projection and turns governed facts into the structured North Star
// intelligence contract. A second readiness engine here would create two truths.

export const INTELLIGENCE_ORIGIN = Object.freeze({
  DETERMINISTIC: "DETERMINISTIC",
  MODEL: "MODEL",
});

export const CONFIDENCE = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

export const AUTHORITY_STATE = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  ALLOWED: "ALLOWED",
  DENIED: "DENIED",
  UNKNOWN: "UNKNOWN",
});

export const NO_INSIGHT_REASON = Object.freeze({
  NO_ACTIONABLE_SIGNAL: "NO_ACTIONABLE_SIGNAL",
  RECORD_CLOSED: "RECORD_CLOSED",
  NO_GOVERNED_PARTS_PLAN: "NO_GOVERNED_PARTS_PLAN",
  READINESS_NOT_ASSEMBLED: "READINESS_NOT_ASSEMBLED",
  READINESS_UNKNOWN: "READINESS_UNKNOWN",
  PARTS_READY: "PARTS_READY",
});

/**
 * Build the model-safe Work Order context from facts already derived by EOS.
 *
 * `partsReadiness` must be the canonical `buildWorkOrderPartsReadiness(...)` result, assembled from
 * capability-authorized source data by a trusted caller. This function never accepts a database
 * handle and never fetches or expands authority on its own.
 */
export function buildWorkOrderIntelligenceContext(
  workOrder,
  { partsPlan = null, partsReadiness = null } = {},
) {
  if (!workOrder) return null;

  const plan = partsPlan ?? workOrderPartsPlan(workOrder);
  const reference = typeof workOrder.woNumber === "string" && workOrder.woNumber.trim()
    ? workOrder.woNumber.trim()
    : null;
  const readiness = sanitizeReadinessProjection(partsReadiness);

  return {
    schemaVersion: 1,
    subject: {
      type: "WORK_ORDER",
      reference,
      status: workOrder.status ?? null,
      typeLabel: workOrder.type ?? null,
      priority: workOrder.priority ?? null,
    },
    parts: {
      plannedLineCount: plan.length,
      plannedQuantity: plan.reduce((sum, line) => sum + finiteOrZero(line.qtyPlanned), 0),
      lines: plan.map((line) => ({
        name: line.name ?? null,
        sku: line.sku ?? null,
        qtyPlanned: Number.isFinite(line.qtyPlanned) ? line.qtyPlanned : null,
      })),
      readinessProjectionAvailable: readiness != null,
      readiness,
    },
  };
}

/**
 * First North Star intelligence proof: parts readiness.
 *
 * Unknown is NOT attention. The Work Order already has an honest readiness state in its parts table;
 * repeating "we do not know" in the attention band would violate one-fact-one-rendering and turn a
 * missing capability into noise. The intelligence layer speaks only when the canonical projection
 * proves an actionable ATTENTION condition. READY and UNKNOWN are deliberately quiet.
 *
 * This remains deterministic and must never be labelled as AI in the UI. A model may later interpret
 * this contract, but it can only repeat the already-selected governed recommendation after the server
 * verifier accepts it.
 */
export function deriveWorkOrderIntelligence(
  workOrder,
  { partsPlan = null, partsReadiness = null } = {},
) {
  const context = buildWorkOrderIntelligenceContext(workOrder, { partsPlan, partsReadiness });
  if (!context) return noInsight(NO_INSIGHT_REASON.NO_ACTIONABLE_SIGNAL, null);
  if (isClosed(context.subject.status)) return noInsight(NO_INSIGHT_REASON.RECORD_CLOSED, context);

  if (context.parts.plannedLineCount === 0) {
    // Existing North Star attention owns "No parts planned". Do not restate it as intelligence.
    return noInsight(NO_INSIGHT_REASON.NO_GOVERNED_PARTS_PLAN, context);
  }

  const projection = context.parts.readiness;
  if (!projection) return noInsight(NO_INSIGHT_REASON.READINESS_NOT_ASSEMBLED, context);
  if (projection.jobReadiness === "READY") return noInsight(NO_INSIGHT_REASON.PARTS_READY, context);
  if (projection.jobReadiness === "UNKNOWN") return noInsight(NO_INSIGHT_REASON.READINESS_UNKNOWN, context);
  if (projection.jobReadiness === "ATTENTION") {
    // Recommendation selection reads the UNSANITIZED canonical projection only to retain the EOS-only
    // execution ids. The model-visible recommendation descriptor itself contains no ids or quantity.
    const governedRecommendation = deriveGovernedWorkOrderPartsRecommendation(partsReadiness);
    return readinessAttentionSignal(context, projection, governedRecommendation);
  }

  // NO_PLAN should already be impossible when the governed plan has lines. Any future/unknown value
  // stays silent rather than being interpreted optimistically.
  return noInsight(NO_INSIGHT_REASON.NO_ACTIONABLE_SIGNAL, context);
}

/**
 * Attach intelligence to the already-approved North Star attention channel.
 *
 * This does not create a second band. Existing deterministic Work Order attention remains first and
 * authoritative for the facts it owns. A speaking intelligence signal contributes exactly one
 * AttentionBand-shaped item; a quiet signal contributes nothing. Keys are de-duplicated so the same
 * fact can never render twice if a future deterministic rule takes ownership of it.
 */
export function mergeWorkOrderAttention(existingItems = [], intelligence = null) {
  const items = Array.isArray(existingItems) ? existingItems.filter(Boolean) : [];
  if (!intelligence?.speak || !intelligence.attentionItem) return items;

  const candidate = intelligence.attentionItem;
  if (candidate.key && items.some((item) => item?.key === candidate.key)) return items;
  return [...items, candidate];
}

function readinessAttentionSignal(context, projection, governedRecommendation) {
  const attentionCount = projection.counts?.ATTENTION ?? 0;
  const unknownCount = projection.counts?.UNKNOWN ?? 0;
  const readyCount = projection.counts?.READY ?? 0;
  const detail = [
    `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`,
    readyCount > 0 ? `${readyCount} ready` : null,
    unknownCount > 0 ? `${unknownCount} still unknown` : null,
  ].filter(Boolean).join("; ");

  const recommendedAction = governedRecommendation?.speak
    ? governedRecommendation.recommendation
    : null;
  const authority = recommendedAction
    ? {
        state: AUTHORITY_STATE.ALLOWED,
        action: recommendedAction.actionId,
        reason: "EOS mapped a confirmed SHORT condition to the existing reorder action. The eventual Firestore write rechecks current authority independently.",
      }
    : governedRecommendation?.authority === "DENIED"
      ? {
          state: AUTHORITY_STATE.DENIED,
          action: null,
          reason: "The existing READY reorder-create path is not eligible for this caller; no recommendation is exposed to the model.",
        }
      : {
          state: AUTHORITY_STATE.NOT_APPLICABLE,
          action: null,
          reason: "No single confirmed shortage maps to an eligible existing governed action.",
        };

  return {
    speak: true,
    origin: INTELLIGENCE_ORIGIN.DETERMINISTIC,
    key: "parts-readiness-attention",
    context,
    observedFact: `The governed parts-readiness projection reports ${detail}.`,
    interpretation: "At least one planned part has a readiness condition that EOS can substantiate as needing attention.",
    businessConsequence: "This work order should not be treated as fully parts-ready until the identified readiness conditions are resolved.",
    confidence: {
      level: CONFIDENCE.HIGH,
      basis: "The signal is a direct explanation of the canonical readiness projection; it does not infer availability independently.",
    },
    recommendedAction,
    authority,
    // Execution identity is EOS-only. It is kept OUTSIDE context and OUTSIDE the model-visible
    // recommendation descriptor, so callers building a Keystone payload can pass recommendedAction
    // without leaking Firestore ids or an AI-authored quantity.
    recommendationExecution: governedRecommendation?.speak ? governedRecommendation.execution : null,
    evidence: evidenceFor(context, projection, governedRecommendation),
    outcome: null,
    attentionItem: {
      key: "parts-readiness-attention",
      severity: "ATTENTION",
      fact: recommendedAction
        ? `Parts readiness needs attention — ${detail}. Recommended next step: ${recommendedAction.label}.`
        : `Parts readiness needs attention — ${detail}.`,
    },
  };
}

function sanitizeReadinessProjection(projection) {
  if (!projection || typeof projection !== "object") return null;
  const counts = projection.counts && typeof projection.counts === "object"
    ? {
        READY: finiteOrZero(projection.counts.READY),
        ATTENTION: finiteOrZero(projection.counts.ATTENTION),
        UNKNOWN: finiteOrZero(projection.counts.UNKNOWN),
      }
    : { READY: 0, ATTENTION: 0, UNKNOWN: 0 };

  return {
    jobReadiness: typeof projection.jobReadiness === "string" ? projection.jobReadiness : "UNKNOWN",
    counts,
    degraded: Array.isArray(projection.degraded)
      ? projection.degraded.filter((v) => typeof v === "string")
      : [],
    rows: Array.isArray(projection.rows)
      ? projection.rows.map((row) => ({
          name: typeof row?.name === "string" ? row.name : null,
          qtyPlanned: Number.isFinite(row?.qtyPlanned) ? row.qtyPlanned : null,
          readiness: typeof row?.readiness === "string" ? row.readiness : "UNKNOWN",
          reason: typeof row?.reason === "string" ? row.reason : null,
          knownShortfall: Number.isFinite(row?.knownShortfall) ? row.knownShortfall : null,
        }))
      : [],
  };
}

function evidenceFor(context, projection, governedRecommendation) {
  const evidence = [
    {
      kind: "WORK_ORDER_PARTS_PLAN",
      subjectReference: context.subject.reference,
      source: "workOrder.inventorySnapshot",
      facts: {
        plannedLineCount: context.parts.plannedLineCount,
        plannedQuantity: context.parts.plannedQuantity,
      },
    },
    {
      kind: "WORK_ORDER_PARTS_READINESS",
      subjectReference: context.subject.reference,
      source: "workOrderPartsReadiness",
      facts: {
        jobReadiness: projection.jobReadiness,
        counts: projection.counts,
        degraded: projection.degraded,
      },
    },
  ];
  if (governedRecommendation?.speak) {
    evidence.push({
      kind: "WORK_ORDER_CONFIRMED_PART_SHORTAGE",
      subjectReference: context.subject.reference,
      source: "workOrderPartsReadiness",
      facts: {
        readiness: governedRecommendation.evidence.readiness,
        reason: governedRecommendation.evidence.reason,
        knownShortfall: governedRecommendation.evidence.knownShortfall,
      },
    });
  }
  return evidence;
}

function noInsight(reason, context) {
  return {
    speak: false,
    origin: INTELLIGENCE_ORIGIN.DETERMINISTIC,
    reason,
    context,
    observedFact: null,
    interpretation: null,
    businessConsequence: null,
    confidence: null,
    recommendedAction: null,
    authority: { state: AUTHORITY_STATE.NOT_APPLICABLE, action: null, reason: null },
    recommendationExecution: null,
    evidence: [],
    outcome: null,
    attentionItem: null,
  };
}

function isClosed(status) {
  return status === "COMPLETED" || status === "CLOSED" || status === "CANCELLED";
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}
