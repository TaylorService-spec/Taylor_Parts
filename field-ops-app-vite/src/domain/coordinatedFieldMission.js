// Coordinated FIELD MISSION — PURE read-side mirror of functions/src/fulfillment/coordinatedFieldMission.ts
// (kept in sync with the backend authority; no I/O, unit-tested). The TECHNICIAN-facing view of a coordinated
// visit: ONE customer/location mission context with per-equipment (per-Work-Order) execution + readiness, and
// honest overall progress. Built ON the coordinated-visit projection — the Sales Order coordinates; the Work
// Orders keep independent execution authority (no merged Work Order record merely for presentation).
//
// F1/F2 principles: authority-derived + HONEST readiness — missing evidence ⇒ UNKNOWN, never a fake READY.
// Field signals (parts readiness, load verification) are INJECTED from governed sources; this never fabricates
// them. A material blocker is surfaced where the substrate supports it; where canonical replenishment/
// Purchasing truth is not connected, the resolution is left UNKNOWN and ROUTED, not invented.

// Exported so tests can assert every status this projection references is a member of the canonical
// WorkOrderStatus set -- see test/coordinatedFieldMission.test.mjs.
export const DONE = new Set(["COMPLETED", "CLOSED"]);
// ONLY canonical WorkOrderStatus values belong here -- see domain/coordinatedVisit.js for the PR #1030 audit
// finding this mirrors ("BLOCKED"/"ON_HOLD" are not real lifecycle statuses).
export const BLOCKED = new Set(["CANCELLED"]);

// Per-unit readiness: a done unit is READY; a blocked status is ATTENTION; unknown parts evidence OR an
// undetermined load is UNKNOWN (never assume ready); parts ATTENTION or a verified-missing load is ATTENTION;
// otherwise READY.
function unitReadinessOf(status, partsReadiness, loadVerified) {
  if (status && DONE.has(status)) return "READY";
  if (status && BLOCKED.has(status)) return "ATTENTION";
  if (partsReadiness === "UNKNOWN" || loadVerified === null) return "UNKNOWN";
  if (partsReadiness === "ATTENTION" || loadVerified === false) return "ATTENTION";
  return "READY";
}

// Roll unit readinesses into a mission readiness. Worst-known wins: any ATTENTION ⇒ ATTENTION; else any
// UNKNOWN ⇒ UNKNOWN; else READY. (PARTIAL is used only for the completion-progress rollup below.)
function rollup(readinesses) {
  if (readinesses.some((r) => r === "ATTENTION")) return "ATTENTION";
  if (readinesses.some((r) => r === "UNKNOWN")) return "UNKNOWN";
  return "READY";
}

// Build the coordinated field mission from a coordinated visit + injected per-WO field signals.
// signalsByWorkOrderId[woId] = { partsReadiness?: "READY"|"ATTENTION"|"UNKNOWN", loadVerified?: boolean,
//   materialBlocker?: { partRef, shortBy?, replenishmentConnected?: boolean } }.
export function buildCoordinatedFieldMission(visit, signalsByWorkOrderId = {}) {
  const units = (visit?.workOrders ?? []).map((w) => {
    const sig = signalsByWorkOrderId[w.id] ?? {};
    const partsReadiness = sig.partsReadiness === "READY" || sig.partsReadiness === "ATTENTION" ? sig.partsReadiness : "UNKNOWN";
    const loadVerified = typeof sig.loadVerified === "boolean" ? sig.loadVerified : null;
    return {
      workOrderId: w.id,
      woNumber: w.woNumber,
      status: w.status,
      lineRefs: w.lineRefs,
      equipmentLabel: w.equipmentLabel ?? null,
      partsReadiness,
      loadVerified,
      materialBlocker: normalizeMaterialBlocker(sig.materialBlocker),
      unitReadiness: unitReadinessOf(w.status, partsReadiness, loadVerified),
    };
  });

  const total = units.length;
  const completed = units.filter((u) => u.status && DONE.has(u.status)).length;
  const blocked = units.filter((u) => u.status && BLOCKED.has(u.status)).length;

  const loadReadiness = total === 0
    ? "UNKNOWN"
    : units.some((u) => u.loadVerified === false) ? "ATTENTION"
      : units.some((u) => u.loadVerified === null) ? "UNKNOWN"
        : "READY";

  let missionReadiness;
  if (total === 0) missionReadiness = "UNKNOWN";
  else if (completed === total) missionReadiness = "READY";
  else if (completed > 0 && rollup(units.map((u) => u.unitReadiness)) === "READY") missionReadiness = "PARTIAL";
  else missionReadiness = rollup(units.map((u) => u.unitReadiness));

  return {
    salesOrderId: visit?.salesOrderId ?? "",
    customerId: visit?.customerId ?? null,
    locationId: visit?.locationId ?? null,
    contextConsistent: visit?.contextConsistent ?? true,
    units,
    progress: { total, completed, blocked, remaining: total - completed },
    loadReadiness,
    missionReadiness,
  };
}

// Normalize an injected material-blocker signal, PRESERVING the honesty of the connection: if the canonical
// replenishment/Purchasing substrate is not connected, `replenishmentConnected` is false and the resolution
// is UNKNOWN (routed to Inventory/Purchasing), never a fabricated ETA/availability.
export function normalizeMaterialBlocker(mb) {
  if (!mb || typeof mb !== "object") return null;
  const partRef = typeof mb.partRef === "string" && mb.partRef.trim() ? mb.partRef : null;
  if (!partRef) return null;
  const connected = mb.replenishmentConnected === true;
  return {
    partRef,
    shortBy: typeof mb.shortBy === "number" && Number.isFinite(mb.shortBy) ? mb.shortBy : null,
    replenishmentConnected: connected,
    // Honest resolution state: only "connected" substrate could carry a real status; otherwise UNKNOWN + route.
    resolution: connected ? (typeof mb.resolution === "string" ? mb.resolution : "UNKNOWN") : "UNKNOWN",
  };
}

const MISSION_READINESS_TONE = { READY: "positive", PARTIAL: "info", ATTENTION: "attention", UNKNOWN: "unknown" };
const MISSION_READINESS_LABEL = { READY: "Ready", PARTIAL: "Partial", ATTENTION: "Needs attention", UNKNOWN: "Unknown" };
export const missionReadinessTone = (r) => MISSION_READINESS_TONE[r] ?? "unknown";
export const missionReadinessLabel = (r) => MISSION_READINESS_LABEL[r] ?? "Unknown";

const UNIT_READINESS_TONE = { READY: "positive", ATTENTION: "attention", UNKNOWN: "unknown" };
const UNIT_READINESS_LABEL = { READY: "Ready", ATTENTION: "Needs attention", UNKNOWN: "Unknown" };
export const unitReadinessTone = (r) => UNIT_READINESS_TONE[r] ?? "unknown";
export const unitReadinessLabel = (r) => UNIT_READINESS_LABEL[r] ?? "Unknown";

// Honest label for the parts/material readiness of a unit (distinct from the unit's overall readiness).
const PARTS_LABEL = { READY: "Parts ready", ATTENTION: "Parts short", UNKNOWN: "Parts unknown" };
export const partsReadinessLabel = (r) => PARTS_LABEL[r] ?? "Parts unknown";
export const partsReadinessTone = (r) => UNIT_READINESS_TONE[r] ?? "unknown";

// Honest label for the load-verification tri-state (true / false / null=undetermined).
export function loadVerifiedLabel(loadVerified) {
  if (loadVerified === true) return "Load verified";
  if (loadVerified === false) return "Load not verified";
  return "Load unknown";
}
export function loadVerifiedTone(loadVerified) {
  if (loadVerified === true) return "positive";
  if (loadVerified === false) return "attention";
  return "unknown";
}
