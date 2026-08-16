// Fulfillment — PURE coordinated field-mission projection (Cycle 9; framework-independent, unit-tested). The
// technician-facing view of a coordinated visit: ONE customer/location mission context, with per-equipment
// (per-Work-Order) execution + readiness, and honest overall progress. Built on the coordinated-visit
// projection (coordinatedVisit.ts) — the Sales Order coordinates; the Work Orders keep independent execution
// authority (no merged Work Order authority merely for presentation). No Firestore imports.
//
// F1/F2 principles: authority-derived + honest readiness (missing evidence ⇒ UNKNOWN, never a fake READY),
// per-unit completion/blocker preserved, no demo-inventory path. Field signals (parts readiness, load
// verification) are INJECTED from the governed sources; this projection never fabricates them.

import type { CoordinatedVisit } from "./coordinatedVisit";
import type { SalesOrderLineRef } from "../types/workOrder";

export type UnitReadiness = "READY" | "ATTENTION" | "UNKNOWN";
export type MissionReadiness = "READY" | "ATTENTION" | "PARTIAL" | "UNKNOWN";

// Per-Work-Order field signals supplied by governed sources (WO parts readiness projection, load
// verification). All optional — absence is honestly UNKNOWN, not assumed ready.
export interface WorkOrderFieldSignal {
  partsReadiness?: "READY" | "ATTENTION" | "UNKNOWN"; // from the WO parts readiness projection
  loadVerified?: boolean; // truck load verification (F2)
}

export interface MissionUnit {
  workOrderId: string;
  woNumber: string | null;
  status: string | null;
  lineRefs: SalesOrderLineRef[];
  partsReadiness: "READY" | "ATTENTION" | "UNKNOWN";
  loadVerified: boolean | null; // null = not yet determined (UNKNOWN), distinct from false (verified-missing)
  unitReadiness: UnitReadiness;
}

export interface CoordinatedFieldMission {
  salesOrderId: string;
  customerId: string | null;
  locationId: string | null;
  contextConsistent: boolean;
  units: MissionUnit[];
  progress: { total: number; completed: number; blocked: number };
  loadReadiness: MissionReadiness; // is the coordinated load ready across all units?
  missionReadiness: MissionReadiness; // overall, worst-known
}

// Exported so tests can assert every status this projection references is a member of the canonical
// WorkOrderStatus set -- see coordinatedFieldMission.test.mjs.
export const DONE = new Set(["COMPLETED", "CLOSED"]);
// ONLY canonical WorkOrderStatus values (types/workOrder.ts) belong here -- see coordinatedVisit.ts for the
// PR #1030 audit finding this mirrors ("BLOCKED"/"ON_HOLD" are not real lifecycle statuses).
export const BLOCKED = new Set(["CANCELLED"]);

// Per-unit readiness: a done unit is READY; a blocked status is ATTENTION; unknown parts evidence is UNKNOWN
// (never assume ready); parts ATTENTION or an unverified/missing load is ATTENTION; otherwise READY.
function unitReadinessOf(status: string | null, partsReadiness: MissionUnit["partsReadiness"], loadVerified: boolean | null): UnitReadiness {
  if (status && DONE.has(status)) return "READY";
  if (status && BLOCKED.has(status)) return "ATTENTION";
  if (partsReadiness === "UNKNOWN" || loadVerified === null) return "UNKNOWN";
  if (partsReadiness === "ATTENTION" || loadVerified === false) return "ATTENTION";
  return "READY";
}

// Roll a set of unit readinesses into a mission-level readiness. Worst-known wins: any ATTENTION ⇒ ATTENTION;
// else any UNKNOWN ⇒ UNKNOWN; else READY. `PARTIAL` is used only for the completion progress rollup (below).
function rollup(readinesses: UnitReadiness[]): MissionReadiness {
  if (readinesses.some((r) => r === "ATTENTION")) return "ATTENTION";
  if (readinesses.some((r) => r === "UNKNOWN")) return "UNKNOWN";
  return "READY";
}

// Build the coordinated field mission from a coordinated visit + injected per-WO field signals.
export function buildCoordinatedFieldMission(
  visit: CoordinatedVisit,
  signalsByWorkOrderId: Record<string, WorkOrderFieldSignal> = {}
): CoordinatedFieldMission {
  const units: MissionUnit[] = (visit?.workOrders ?? []).map((w) => {
    const sig = signalsByWorkOrderId[w.id] ?? {};
    const partsReadiness = sig.partsReadiness === "READY" || sig.partsReadiness === "ATTENTION" ? sig.partsReadiness : "UNKNOWN";
    const loadVerified = typeof sig.loadVerified === "boolean" ? sig.loadVerified : null;
    return {
      workOrderId: w.id,
      woNumber: w.woNumber,
      status: w.status,
      lineRefs: w.lineRefs,
      partsReadiness,
      loadVerified,
      unitReadiness: unitReadinessOf(w.status, partsReadiness, loadVerified),
    };
  });

  const total = units.length;
  const completed = units.filter((u) => u.status && DONE.has(u.status)).length;
  const blocked = units.filter((u) => u.status && BLOCKED.has(u.status)).length;

  // Load readiness rolls up only the load dimension (verified / unverified / undetermined).
  const loadReadiness: MissionReadiness = total === 0
    ? "UNKNOWN"
    : units.some((u) => u.loadVerified === false) ? "ATTENTION"
    : units.some((u) => u.loadVerified === null) ? "UNKNOWN"
    : "READY";

  let missionReadiness: MissionReadiness;
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
    progress: { total, completed, blocked },
    loadReadiness,
    missionReadiness,
  };
}
