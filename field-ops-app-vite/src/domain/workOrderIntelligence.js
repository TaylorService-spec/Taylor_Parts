import { workOrderPartsPlan } from "./workOrderNorthStar.js";

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
 * The projection authority already exists in `workOrderPartsReadiness.js`. This function does not
 * recompute it. It explains one of four truthful states:
 *
 * - no projection supplied -> readiness cannot be confirmed;
 * - UNKNOWN -> readiness still cannot be confirmed and degraded sources are named;
 * - ATTENTION -> the canonical projection proves at least one line needs attention;
 * - READY -> stay silent. A clean band is the North Star's clean signal.
 *
 * The full structured object is future-model-ready, while `attentionItem` is the deterministic
 * rendering today's Work Order page can consume. It is NOT AI and must never be labelled as AI.
 */
export function deriveWorkOrderIntelligence(
  workOrder,
  { partsPlan = null, partsReadiness = null } = {},
) {
  const context = buildWorkOrderIntelligenceContext(workOrder, { partsPlan, partsReadiness });
  if (!context) return noInsight(NO_INSIGHT_REASON.NO_ACTIONABLE_SIGNAL, null);

  if (isClosed(context.subject.status)) {
    return noInsight(NO_INSIGHT_REASON.RECORD_CLOSED, context);
  }

  if (context.parts.plannedLineCount === 0) {
    // Existing North Star attention owns "No parts planned". Do not restate it as intelligence.
    return noInsight(NO_INSIGHT_REASON.NO_GOVERNED_PARTS_PLAN, context);
  }

  const projection = context.parts.readiness;
  if (!projection) return readinessUnknownSignal(context, null);

  if (projection.jobReadiness === "READY") {
    return noInsight(NO_INSIGHT_REASON.PARTS_READY, context);
  }

  if (projection.jobReadiness === "UNKNOWN") {
    return readinessUnknownSignal(context, projection);
  }

  if (projection.jobReadiness === "ATTENTION") {
    return readinessAttentionSignal(context, projection);
  }

  // NO_PLAN should already be impossible when the governed plan has lines. Any future/unknown value
  // stays silent rather than being interpreted optimistically.
  return noInsight(NO_INSIGHT_REASON.NO_ACTIONABLE_SIGNAL, context);
}

function readinessUnknownSignal(context, projection) {
  const quantityText = plannedQuantityText(context.parts);
  const degraded = projection?.degraded?.length ? projection.degraded.join(", ") : null;

  return {
    speak: true,
    origin: INTELLIGENCE_ORIGIN.DETERMINISTIC,
    key: "parts-readiness-unverified",
    context,
    observedFact: `${quantityText} are recorded on this work order.`,
    interpretation: degraded
      ? `The canonical readiness projection cannot confirm coverage because these sources are unavailable or incomplete: ${degraded}.`
      : "A canonical parts-readiness projection has not been assembled for this work order yet.",
    businessConsequence: "Parts readiness cannot be confirmed before dispatch from the evidence currently assembled for this work order.",
    confidence: {
      level: CONFIDENCE.HIGH,
      basis: "The statement is limited to the governed parts plan and the readiness projection's explicit UNKNOWN or unavailable state.",
    },
    recommendedAction: null,
    authority: {
      state: AUTHORITY_STATE.NOT_APPLICABLE,
      action: null,
      reason: "No governed readiness action is proposed until the evidence identifies a specific actionable condition.",
    },
    evidence: evidenceFor(context, projection),
    outcome: null,
    attentionItem: {
      key: "parts-readiness-unverified",
      severity: "ATTENTION",
      fact: `Parts readiness cannot be confirmed — ${quantityText}${degraded ? `; incomplete sources: ${degraded}` : "; no canonical readiness projection is assembled yet"}.`,
    },
  };
}

function readinessAttentionSignal(context, projection) {
  const attentionCount = projection.counts?.ATTENTION ?? 0;
  const unknownCount = projection.counts?.UNKNOWN ?? 0;
  const readyCount = projection.counts?.READY ?? 0;
  const detail = [
    `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`,
    readyCount > 0 ? `${readyCount} ready` : null,
    unknownCount > 0 ? `${unknownCount} still unknown` : null,
  ].filter(Boolean).join("; ");

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
    recommendedAction: null,
    authority: {
      state: AUTHORITY_STATE.NOT_APPLICABLE,
      action: null,
      reason: "A specific governed action is not proposed until the readiness reason is mapped to an existing EOS command and actor authority is checked.",
    },
    evidence: evidenceFor(context, projection),
    outcome: null,
    attentionItem: {
      key: "parts-readiness-attention",
      severity: "ATTENTION",
      fact: `Parts readiness needs attention — ${detail}.`,
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

function evidenceFor(context, projection) {
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
  ];

  if (projection) {
    evidence.push({
      kind: "WORK_ORDER_PARTS_READINESS",
      subjectReference: context.subject.reference,
      source: "workOrderPartsReadiness",
      facts: {
        jobReadiness: projection.jobReadiness,
        counts: projection.counts,
        degraded: projection.degraded,
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
    evidence: [],
    outcome: null,
    attentionItem: null,
  };
}

function plannedQuantityText(parts) {
  const lineWord = parts.plannedLineCount === 1 ? "part" : "parts";
  return parts.plannedQuantity > 0
    ? `${parts.plannedQuantity} planned unit${parts.plannedQuantity === 1 ? "" : "s"} across ${parts.plannedLineCount} ${lineWord}`
    : `${parts.plannedLineCount} planned ${lineWord}`;
}

function isClosed(status) {
  return status === "COMPLETED" || status === "CLOSED" || status === "CANCELLED";
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}
