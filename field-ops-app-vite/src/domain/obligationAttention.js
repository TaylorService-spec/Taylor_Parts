// Committed Customer Obligation ATTENTION — PURE projection over EXISTING governed facts. No new authority,
// no new collection: it derives an honest operational-attention signal for a committed customer obligation
// from facts the platform already owns — the coordinatedVisit projection (Work Orders sharing a Sales Order's
// salesOrderId) and, optionally, the coordinatedFieldMission signals (per-unit parts readiness / material
// blocker). It is the OPERATIONAL counterpart to Sales' PRE-COMMITMENT Opportunity attention
// (domain/opportunityLifecycle.js deriveAttention): Sales flags attention before commitment; this flags
// attention AFTER commitment, during fulfillment/execution.
//
// HONEST BY CONSTRUCTION. The reason vocabulary is EXACTLY the level of truth the facts support — nothing more:
//   BLOCKED             a Work Order is in a blocked status (execution stopped, non-material)
//   WAITING_ON_MATERIAL a unit is short/att. on parts, or a blocked unit's blocker is a material blocker
//   PARTIAL             some units complete, some outstanding, none blocked (progressing)
//   REMAINING_WORK      work outstanding, none complete yet, none blocked (progressing)
//   UNKNOWN             evidence is missing/inconsistent — we cannot assert the state
// It does NOT invent SLA, risk score, customer promise, severity, or ETA. A committed obligation with a
// coordinated visit implies a Sales Order in fulfillment (the visit's Work Orders carry its salesOrderId) —
// so `commitmentExists` / `executionBegun` are read from that fact, not manufactured.

export const OBLIGATION_ATTENTION_REASONS = ["BLOCKED", "WAITING_ON_MATERIAL", "PARTIAL", "REMAINING_WORK", "UNKNOWN"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Does the mission carry material-specific evidence (a material blocker on any unit, or a unit that is
// parts-short)? Used to specialize a blocked/incomplete obligation as WAITING_ON_MATERIAL rather than a
// generic BLOCKED — a distinction the facts genuinely support.
function hasMaterialWait(mission) {
  const units = mission?.units;
  if (!Array.isArray(units)) return false;
  return units.some((u) => u && (u.materialBlocker != null || u.partsReadiness === "ATTENTION"));
}

// Derive obligation attention for ONE committed obligation from its coordinated visit (+ optional mission).
// Returns honest, fact-derived flags + the reason set (primary reason first). No severity, no ranking beyond
// "does this need intervention / a review".
export function deriveObligationAttention(visit, mission = null) {
  if (!visit || typeof visit !== "object" || num(visit.total) === 0) {
    // No coordinated visit / no units ⇒ we cannot assert a committed obligation's state from here.
    return {
      commitmentExists: false, executionBegun: false, incomplete: false, satisfied: false,
      reasons: ["UNKNOWN"], primaryReason: "UNKNOWN",
      needsIntervention: false, needsReview: true, watch: false, tone: "unknown",
    };
  }

  const total = num(visit.total);
  const completed = num(visit.completed);
  const blocked = num(visit.blocked);
  const remaining = typeof visit.remaining === "number" ? visit.remaining : Math.max(0, total - completed);
  const incomplete = completed < total;
  const materialWait = hasMaterialWait(mission);
  const evidenceUnknown = visit.contextConsistent === false || mission?.missionReadiness === "UNKNOWN";

  const reasons = [];
  if (blocked > 0) {
    // A blocked obligation: if the blocker is material (or a unit is parts-short), name it WAITING_ON_MATERIAL;
    // otherwise a non-material BLOCKED. Both mean intervention may be required.
    reasons.push(materialWait ? "WAITING_ON_MATERIAL" : "BLOCKED");
  } else if (materialWait) {
    reasons.push("WAITING_ON_MATERIAL");
  } else if (incomplete) {
    reasons.push(completed > 0 ? "PARTIAL" : "REMAINING_WORK");
  }
  if (evidenceUnknown) reasons.push("UNKNOWN");

  const satisfied = !incomplete && blocked === 0 && !materialWait && !evidenceUnknown;
  const needsIntervention = reasons.includes("BLOCKED") || reasons.includes("WAITING_ON_MATERIAL");
  const needsReview = reasons.includes("UNKNOWN");
  const watch = !needsIntervention && (reasons.includes("PARTIAL") || reasons.includes("REMAINING_WORK"));
  const primaryReason = reasons[0] ?? null;

  // Tone (Wave-0 vocabulary) — derived from the reasons, never a fabricated severity: intervention ⇒ attention,
  // progress ⇒ info, evidence gap ⇒ unknown, satisfied ⇒ positive.
  const tone = needsIntervention ? "attention" : needsReview && !watch ? "unknown" : watch ? "info" : "positive";

  return {
    commitmentExists: true, // a coordinated visit exists ⇒ a committed Sales Order is in fulfillment
    executionBegun: true, // its Work Orders exist (createServiceForSalesOrder ran ⇒ IN_FULFILLMENT)
    incomplete, satisfied, remaining,
    reasons, primaryReason,
    needsIntervention, needsReview, watch, tone,
  };
}

const REASON_LABEL = {
  BLOCKED: "Blocked",
  WAITING_ON_MATERIAL: "Waiting on material",
  PARTIAL: "Partially complete",
  REMAINING_WORK: "Work remaining",
  UNKNOWN: "State unknown",
};
export const obligationReasonLabel = (r) => REASON_LABEL[r] ?? "Unknown";

// Summarize obligation attention across MANY committed obligations (e.g. the coordinated-visit queue) into
// honest counts — no ranking/severity, just how many need intervention / review / are progressing / satisfied.
export function summarizeObligationAttention(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    total: list.length,
    needsIntervention: list.filter((a) => a?.needsIntervention).length,
    watch: list.filter((a) => a?.watch).length,
    needsReview: list.filter((a) => a?.needsReview).length,
    satisfied: list.filter((a) => a?.satisfied).length,
  };
}
