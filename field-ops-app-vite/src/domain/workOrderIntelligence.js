import { READINESS, workOrderPartsPlan } from "./workOrderNorthStar.js";

// NORTH STAR WORK ORDER INTELLIGENCE CONTRACT
//
// This is the seam between governed EOS facts and future model interpretation.
// It is deliberately PURE: no Firestore, no model, no clock, no write path.
//
// The UI must never infer business meaning from raw records independently. EOS derives facts here,
// then a future Keystone-backed interpreter may explain those facts. Deterministic signals are
// labelled DETERMINISTIC and must never be presented as AI.

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
});

/**
 * Build the model-safe Work Order context from facts already derived by EOS.
 *
 * This function intentionally excludes document ids and does not fetch anything. A future trusted
 * server-side context assembler may add capability-authorized facts, but the model boundary remains
 * this explicit shape rather than an unrestricted record/database handle.
 */
export function buildWorkOrderIntelligenceContext(workOrder, { partsPlan = null } = {}) {
  if (!workOrder) return null;

  const plan = partsPlan ?? workOrderPartsPlan(workOrder);
  const reference = typeof workOrder.woNumber === "string" && workOrder.woNumber.trim()
    ? workOrder.woNumber.trim()
    : null;

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
      readinessAuthorityAvailable: plan.length > 0 && plan.every((line) => line.readiness !== READINESS.UNKNOWN),
      lines: plan.map((line) => ({
        name: line.name ?? null,
        sku: line.sku ?? null,
        qtyPlanned: Number.isFinite(line.qtyPlanned) ? line.qtyPlanned : null,
        readiness: line.readiness,
      })),
    },
  };
}

/**
 * First North Star intelligence proof: parts readiness honesty.
 *
 * EOS knows the governed plan. EOS does NOT yet know truck/staged/missing availability. That gap is
 * operationally relevant, so the system may say readiness cannot be confirmed. It may NOT say a
 * part is unavailable, late, on a truck, staged, or likely to cause a delay because no authority
 * currently proves those claims.
 *
 * The full structured object is future-model-ready, while `attentionItem` is the truthful
 * deterministic rendering used by today's North Star page. This is not AI and must not be labelled
 * as AI in the UI.
 */
export function deriveWorkOrderIntelligence(workOrder, { partsPlan = null } = {}) {
  const context = buildWorkOrderIntelligenceContext(workOrder, { partsPlan });
  if (!context) return noInsight(NO_INSIGHT_REASON.NO_ACTIONABLE_SIGNAL, null);

  if (isClosed(context.subject.status)) {
    return noInsight(NO_INSIGHT_REASON.RECORD_CLOSED, context);
  }

  if (context.parts.plannedLineCount === 0) {
    // The existing North Star attention derivation already owns "No parts planned". Repeating it
    // here would violate one-fact-one-rendering and would train the intelligence layer to fill space.
    return noInsight(NO_INSIGHT_REASON.NO_GOVERNED_PARTS_PLAN, context);
  }

  if (!context.parts.readinessAuthorityAvailable) {
    const lineWord = context.parts.plannedLineCount === 1 ? "part" : "parts";
    const quantityText = context.parts.plannedQuantity > 0
      ? `${context.parts.plannedQuantity} planned unit${context.parts.plannedQuantity === 1 ? "" : "s"} across ${context.parts.plannedLineCount} ${lineWord}`
      : `${context.parts.plannedLineCount} planned ${lineWord}`;

    return {
      speak: true,
      origin: INTELLIGENCE_ORIGIN.DETERMINISTIC,
      key: "parts-readiness-unverified",
      context,
      observedFact: `${quantityText} are recorded on this work order.`,
      interpretation: "EOS has a governed parts plan, but no governed truck or staging availability signal for these lines.",
      businessConsequence: "Parts readiness cannot be confirmed before dispatch from the evidence EOS currently holds.",
      confidence: {
        level: CONFIDENCE.HIGH,
        basis: "The conclusion is limited to the presence of a governed parts plan and the explicit absence of a readiness authority.",
      },
      recommendedAction: null,
      authority: {
        state: AUTHORITY_STATE.NOT_APPLICABLE,
        action: null,
        reason: "No governed readiness action is proposed until availability evidence exists.",
      },
      evidence: [
        {
          kind: "WORK_ORDER_PARTS_PLAN",
          subjectReference: context.subject.reference,
          source: "workOrder.inventorySnapshot",
          facts: {
            plannedLineCount: context.parts.plannedLineCount,
            plannedQuantity: context.parts.plannedQuantity,
          },
        },
      ],
      outcome: null,
      attentionItem: {
        key: "parts-readiness-unverified",
        severity: "ATTENTION",
        fact: `Parts readiness cannot be confirmed — ${quantityText} have no governed truck or staging availability signal yet.`,
      },
    };
  }

  // A future governed readiness projection will enter here. Until it exists, the contract chooses
  // silence rather than fabricating a recommendation from incomplete evidence.
  return noInsight(NO_INSIGHT_REASON.NO_ACTIONABLE_SIGNAL, context);
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

function isClosed(status) {
  return status === "COMPLETED" || status === "CLOSED" || status === "CANCELLED";
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}
