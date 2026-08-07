// WO Parts Planning — Phase 1: the UNIFIED PARTS READINESS PROJECTION (pure; no Firebase/I/O; unit-tested).
//
// This composes ALREADY-READ data from EXISTING canonical authorities into the answer to the Owner's
// core product question: "Is this job ready to execute?" — per planned part and rolled up for the job.
// It is a PROJECTION: it DERIVES readiness, it never invents authority. Every fact it reports traces to a
// canonical source (see docs/design/wo-parts-readiness-projection.md); anything it cannot confirm is
// reported honestly as UNKNOWN, and a capability that isn't enabled degrades to UNAVAILABLE — never a
// fabricated quantity, a guessed availability, or a silent zero.
//
// Authority map (NONE of these is re-modelled here — the caller reads them; this only derives):
//   PLANNED           WorkOrder.inventorySnapshot[].qtyPlanned         (keyed on partId)
//   USED              WorkOrder.inventorySnapshot[].qtyUsed            (execution capture)
//   RESERVED          inventory_transactions RESERVED by workOrderId   (fires at DISPATCHED)
//   WAREHOUSE_AVAIL   stock_locations - reserved (INTERIM baseline)    (physical on-hand deferred)
//   ON_TRUCK          MOBILE-location stock                            (NOT persisted yet -> UNAVAILABLE)
//   PROCUREMENT       linked reorder_requests state                    (needs the additive workOrderId link)
//   REQUIRED          equipment/job context                            (deferred -> NOT_DERIVED in v1)
//   RETURNED          operational-movement RETURNED                    (deferred -> NOT_DERIVED in v1)
//
// The projection takes each planned part with its dimensions ALREADY resolved by the caller (so this stays
// a pure transform), plus the tenant's enabled-capability flags for honest modular degradation.

import { READINESS, rollUpReadiness } from "./readinessLanguage.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// A dimension source result is { status, ...value }. status ∈ KNOWN | UNKNOWN | UNAVAILABLE.
// UNAVAILABLE = the source/capability isn't enabled (honest degradation). UNKNOWN = enabled but this datum
// couldn't be determined. Missing/garbage normalizes to UNKNOWN (never a fabricated zero).
function normDimension(raw, { moduleEnabled = true } = {}) {
  if (!moduleEnabled) return { status: "UNAVAILABLE" };
  if (!raw || typeof raw !== "object") return { status: "UNKNOWN" };
  if (raw.status === "UNAVAILABLE" || raw.status === "UNKNOWN" || raw.status === "KNOWN") return raw;
  return { status: "UNKNOWN" };
}

const PROCUREMENT_ACTIVE = new Set(["PENDING", "ORDERED"]);

// Derive one planned part's readiness. Pure. Returns the readiness state + a reason code + the raw
// dimensions so the experience layer can render operational meaning (e.g. "Warehouse Main — available for
// pickup", "Procurement pending", "Truck quantity unavailable") WITHOUT re-deriving anything.
export function deriveItemReadiness(item, capabilities = {}) {
  const caps = {
    warehouse: capabilities.warehouse !== false,
    truckInventory: capabilities.truckInventory === true, // default OFF today (no MOBILE stock persistence)
    purchasing: capabilities.purchasing !== false,
  };

  const planned = num(item.qtyPlanned);
  const used = num(item.qtyUsed);
  const reserved = num(item.reservedForJob);

  const warehouse = normDimension(item.warehouse, { moduleEnabled: caps.warehouse });
  const truck = normDimension(item.truck, { moduleEnabled: caps.truckInventory });
  const procurement = caps.purchasing
    ? normProcurement(item.procurement)
    : { status: "MODULE_UNAVAILABLE" };
  const required = { status: "NOT_DERIVED" }; // deferred in v1 — never fabricated
  const returned = { status: "NOT_DERIVED" };

  const dims = { planned, used, reserved, warehouse, truck, procurement, required, returned };

  // Coverage from KNOWN sources only (never count an UNKNOWN/UNAVAILABLE source as availability).
  const knownWarehouse = warehouse.status === "KNOWN" ? num(warehouse.available) : 0;
  const knownTruck = truck.status === "KNOWN" ? num(truck.onTruck) : 0;
  const knownAvailableToJob = reserved + knownWarehouse + knownTruck;
  const knownShortfall = Math.max(0, planned - knownAvailableToJob);

  let state;
  let reason;

  if (knownShortfall === 0) {
    state = READINESS.READY;
    reason = reserved >= planned ? "RESERVED" : knownTruck > 0 ? "ON_TRUCK" : "WAREHOUSE_AVAILABLE";
  } else if (PROCUREMENT_ACTIVE.has(procurement.status)) {
    // A known shortage that is already being handled by the existing procurement chain.
    state = READINESS.ATTENTION;
    reason = "PROCUREMENT_PENDING";
  } else if (truck.status !== "KNOWN" || warehouse.status !== "KNOWN") {
    // We cannot CONFIRM a shortage because a real potential source is unavailable/unknown. Honest UNKNOWN,
    // not a fabricated "short". Today the truck is the unavailable source for every non-warehouse-covered
    // part; when MOBILE stock becomes authoritative these resolve to READY or a confirmed shortage.
    state = READINESS.UNKNOWN;
    reason = truck.status !== "KNOWN" ? "TRUCK_UNAVAILABLE" : "WAREHOUSE_UNAVAILABLE";
  } else {
    // All sources KNOWN and genuinely short, no active procurement.
    state = READINESS.ATTENTION;
    reason = caps.purchasing ? "SHORT" : "SHORT_PROCUREMENT_UNAVAILABLE";
  }

  return {
    partId: item.partId ?? item.sku ?? null,
    name: item.name ?? null,
    qtyPlanned: planned,
    qtyUsed: used,
    readiness: state.key,
    reason,
    knownShortfall,
    dimensions: dims,
  };
}

function normProcurement(raw) {
  if (!raw || typeof raw !== "object") return { status: "NONE" };
  const s = raw.status;
  if (s === "PENDING" || s === "ORDERED" || s === "RECEIVED" || s === "NONE") return raw;
  return { status: "NONE" };
}

// Build the whole-job parts readiness view. `plannedParts` are the WO's inventorySnapshot rows with
// qtyPlanned > 0, each carrying its resolved dimensions (see deriveItemReadiness). Returns per-part rows,
// counts by readiness, and a single rolled-up job readiness — plus an honest "no parts planned" distinction
// (which reads differently from "all ready") and a degradation summary of any disabled capabilities.
export function buildWorkOrderPartsReadiness({ workOrder = {}, plannedParts = [], capabilities = {} } = {}) {
  const planned = plannedParts.filter((p) => num(p.qtyPlanned) > 0);
  const rows = planned.map((p) => deriveItemReadiness(p, capabilities));

  const counts = { READY: 0, ATTENTION: 0, UNKNOWN: 0 };
  for (const r of rows) counts[r.readiness] = (counts[r.readiness] ?? 0) + 1;

  const hasPlan = rows.length > 0;
  const jobReadiness = hasPlan ? rollUpReadiness(rows.map((r) => r.readiness)).key : "NO_PLAN";

  // Honest modular degradation summary (Owner principle L): report which connected capabilities are OFF so
  // the experience can say e.g. "Procurement capability unavailable" instead of a broken control.
  const degraded = [];
  if (capabilities.purchasing === false) degraded.push("purchasing");
  if (capabilities.truckInventory !== true) degraded.push("truckInventory"); // OFF by default today
  if (capabilities.warehouse === false) degraded.push("warehouse");

  return {
    workOrderId: workOrder.id ?? null,
    plannedCount: rows.length,
    jobReadiness, // READY | ATTENTION | UNKNOWN | NO_PLAN
    counts,
    rows,
    degraded,
  };
}
