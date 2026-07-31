// INV-EQ-P2 -- pure, node-testable view-model for the Equipment Detail Activity
// Timeline. It maps the already-loaded Work Orders into SERVICE events, composes them
// with an injected (today inert) INVENTORY-history event set through the merged
// composeUnifiedTimeline, orders the result newest-first (stable), and derives the
// honest render state. PURE: no firebase, no persistence, and it NEVER fabricates an
// inventory event -- inventory events come only from the injected source (empty by
// default until the Enterprise Inventory sources exist).
import { equipmentServiceHistory } from "./equipment.js";
import { composeUnifiedTimeline, TIMELINE_SOURCE } from "./serializedAssetInstallation.js";

export { TIMELINE_SOURCE };

export const TIMELINE_STATE = Object.freeze({
  LOADING: "loading",
  UNAVAILABLE: "unavailable", // the service read failed and nothing else is available
  EMPTY: "empty", // sources known, no events to show
  PARTIAL: "partial", // events shown, but a source (today: inventory) is not connected
  READY: "ready", // every source available and contributing
});

// Map the derived Work-Order service history into SERVICE events for composition.
// Reuses equipmentServiceHistory (no extra query). Undated entries are kept here but
// dropped by composeUnifiedTimeline (fail-closed) so no mis-dated row is rendered.
export function mapServiceEvents(workOrders, equipmentId) {
  return equipmentServiceHistory(workOrders, equipmentId).map((e) => ({
    at: e.at,
    kind: e.type || e.status || "Service",
    workOrderId: e.workOrderId,
    woNumber: e.woNumber ?? null,
    status: e.status ?? null,
    type: e.type ?? null,
  }));
}

// Drop any event without a FINITE `at` BEFORE composition. composeUnifiedTimeline
// accepts any `typeof number` (so NaN/Infinity would pass and later crash a Date
// render); here we reject non-finite/malformed timestamps from BOTH the service and
// the injected (untrusted) inventory events, fail-closed, so an invalid event is
// silently dropped rather than rendered or thrown on.
function finiteEvents(events) {
  return Array.isArray(events)
    ? events.filter((e) => e && typeof e === "object" && Number.isFinite(e.at))
    : [];
}

// Compose service + injected inventory events, then order NEWEST-FIRST while
// preserving composeUnifiedTimeline's stable ordering for equal timestamps (its
// ascending stable order is re-sorted descending with a stable secondary index).
export function buildEquipmentTimeline({ serviceEvents = [], inventoryEvents = [] } = {}) {
  const ascending = composeUnifiedTimeline({
    inventoryEvents: finiteEvents(inventoryEvents),
    serviceEvents: finiteEvents(serviceEvents),
  });
  const rows = ascending
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (b.row.at - a.row.at) || (a.i - b.i))
    .map(({ row }) => row);
  return { rows };
}

// Coarse render state (fail-closed). `inventoryStatus` is the injected source status
// ("ready" | "denied" | "unavailable"); a non-"ready" status means the inventory side
// is not connected. A sanitized service-read failure is treated as UNAVAILABLE -- never
// inferred as denial (the Work Order hook exposes only a message, not a trustworthy
// denied classification).
export function deriveTimelineState({ serviceLoading = false, serviceError = false, inventoryStatus = "unavailable", rowCount = 0 } = {}) {
  if (serviceLoading) return TIMELINE_STATE.LOADING;
  const serviceAvailable = !serviceError;
  const inventoryAvailable = inventoryStatus === "ready";
  if (rowCount === 0) {
    return (!serviceAvailable && !inventoryAvailable) ? TIMELINE_STATE.UNAVAILABLE : TIMELINE_STATE.EMPTY;
  }
  return (serviceAvailable && inventoryAvailable) ? TIMELINE_STATE.READY : TIMELINE_STATE.PARTIAL;
}

export function isInventoryConnected(inventoryStatus) {
  return inventoryStatus === "ready";
}
