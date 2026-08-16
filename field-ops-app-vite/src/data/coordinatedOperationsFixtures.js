// SYNTHETIC coordinated-operations scenario fixtures (clearly non-production; ids are SBX-*). This is the
// canonical C713×5 coordinated-visit scenario: ONE Sales Order → ONE commercial line qty 5 → FIVE
// equipment-accountable Work Orders sharing the same customer + location, executed as one coordinated visit /
// one coordinated field mission. It exists so the Service/Dispatch and Technician surfaces can render the
// already-built projections today, and to be the substrate for the sequential C713×5 journey rerun.
//
// The scenario deliberately encodes the HONEST truths the surfaces must show:
//   • partial completion — 3 of 5 done, 1 in progress, 1 CANCELLED → the visit is NOT complete;
//   • a material blocker on the blocked unit whose canonical replenishment/Purchasing truth is NOT connected
//     (replenishmentConnected:false) → the resolution stays UNKNOWN and is ROUTED, never fabricated;
//   • load verification present for the ready units, not-verified for the blocked unit, unknown where absent;
//   • operational context (scheduled window / technician / truck) shown WHERE KNOWN, UNKNOWN otherwise;
//   • a standalone Work Order with no salesOrderId (must be EXCLUDED from any coordinated visit).

// Work Orders — the execution/accountability records. Each carries the coordinating `salesOrderId` (Cycle 7
// demand lineage) so the pure projection can group them. `equipmentLabel` is an optional display passthrough.
export const COORDINATED_WORK_ORDERS = [
  { id: "SBX-WO-5101", woNumber: "WO-5101", status: "COMPLETED", customerId: "SBX-ACCT-Metro", locationId: "SBX-LOC-Metro-Central", salesOrderId: "SBX-SO-4001", salesOrderLineRefs: ["L1"], equipmentLabel: "Taylor C713 · unit 1" },
  { id: "SBX-WO-5102", woNumber: "WO-5102", status: "COMPLETED", customerId: "SBX-ACCT-Metro", locationId: "SBX-LOC-Metro-Central", salesOrderId: "SBX-SO-4001", salesOrderLineRefs: ["L1"], equipmentLabel: "Taylor C713 · unit 2" },
  { id: "SBX-WO-5103", woNumber: "WO-5103", status: "COMPLETED", customerId: "SBX-ACCT-Metro", locationId: "SBX-LOC-Metro-Central", salesOrderId: "SBX-SO-4001", salesOrderLineRefs: ["L1"], equipmentLabel: "Taylor C713 · unit 3" },
  { id: "SBX-WO-5104", woNumber: "WO-5104", status: "WORK_IN_PROGRESS", customerId: "SBX-ACCT-Metro", locationId: "SBX-LOC-Metro-Central", salesOrderId: "SBX-SO-4001", salesOrderLineRefs: ["L1"], equipmentLabel: "Taylor C713 · unit 4" },
  { id: "SBX-WO-5105", woNumber: "WO-5105", status: "CANCELLED", customerId: "SBX-ACCT-Metro", locationId: "SBX-LOC-Metro-Central", salesOrderId: "SBX-SO-4001", salesOrderLineRefs: ["L1"], equipmentLabel: "Taylor C713 · unit 5" },

  // A second, smaller coordinated visit — all complete (a clean READY visit alongside the ATTENTION one).
  { id: "SBX-WO-5201", woNumber: "WO-5201", status: "COMPLETED", customerId: "SBX-ACCT-Harbor", locationId: "SBX-LOC-Harbor-Main", salesOrderId: "SBX-SO-4002", salesOrderLineRefs: ["L1"], equipmentLabel: "Taylor C723 · unit 1" },
  { id: "SBX-WO-5202", woNumber: "WO-5202", status: "COMPLETED", customerId: "SBX-ACCT-Harbor", locationId: "SBX-LOC-Harbor-Main", salesOrderId: "SBX-SO-4002", salesOrderLineRefs: ["L1"], equipmentLabel: "Taylor C723 · unit 2" },

  // Standalone Work Order — NO salesOrderId. Must never appear in a coordinated visit (proves the grouping).
  { id: "SBX-WO-9001", woNumber: "WO-9001", status: "WORK_IN_PROGRESS", customerId: "SBX-ACCT-Elm", locationId: "SBX-LOC-Elm-1", equipmentLabel: "Sterilizer service" },
];

// Injected per-Work-Order field signals (from the governed WO parts-readiness projection + truck load
// verification). Absence is honestly UNKNOWN (not assumed ready). The blocked unit carries a material blocker
// whose replenishment substrate is NOT connected — so its resolution is UNKNOWN and routed.
export const COORDINATED_FIELD_SIGNALS = {
  "SBX-WO-5101": { partsReadiness: "READY", loadVerified: true },
  "SBX-WO-5102": { partsReadiness: "READY", loadVerified: true },
  "SBX-WO-5103": { partsReadiness: "READY", loadVerified: true },
  "SBX-WO-5104": { partsReadiness: "READY", loadVerified: true },
  "SBX-WO-5105": {
    partsReadiness: "ATTENTION",
    loadVerified: false,
    materialBlocker: { partRef: "PRT-C713-COMPRESSOR", shortBy: 1, replenishmentConnected: false },
  },
  "SBX-WO-5201": { partsReadiness: "READY", loadVerified: true },
  "SBX-WO-5202": { partsReadiness: "READY", loadVerified: true },
};

// Injected operational context (scheduling / assignment), shown WHERE KNOWN and honestly UNKNOWN otherwise.
// These come from governed Scheduling/Dispatch/assignment sources; the coordinated-visit projection itself
// does NOT own them, so they are never fabricated — a missing entry renders as "unscheduled / unassigned".
export const COORDINATED_OPERATIONAL_CONTEXT = {
  "SBX-WO-5104": { scheduledWindow: "Today 1:00–3:00 PM", technicianName: "Sam Rivera", truckName: "Truck 12" },
  // SBX-WO-5105 intentionally omitted — the blocked unit is not yet re-scheduled (tech/truck UNKNOWN).
};

export const COORDINATED_ACCOUNT_NAMES = {
  "SBX-ACCT-Metro": "Metro School District",
  "SBX-ACCT-Harbor": "Harbor Grill Downtown",
  "SBX-ACCT-Elm": "Elm Street Dental",
};

export const COORDINATED_LOCATION_NAMES = {
  "SBX-LOC-Metro-Central": "Metro Central Kitchen",
  "SBX-LOC-Harbor-Main": "Harbor Main Dining",
  "SBX-LOC-Elm-1": "Elm Street Office",
};

// Sales Order display labels (the coordination anchor). The projection keys by salesOrderId; this is display-
// only name resolution, never a second authority.
export const COORDINATED_SALES_ORDER_LABELS = {
  "SBX-SO-4001": "SO-4001 · Metro cafeteria refresh (5× C713)",
  "SBX-SO-4002": "SO-4002 · Harbor ice machines (2× C723)",
};
