// EI-P1d-1 -- pure, node-testable view-model composer for the Truck Inventory workspace.
// No Firebase, no persistence, no reads. It shapes the GOVERNED, already-read Truck
// Inventory source into render-ready fleet and per-truck view-models, derives the honest
// fail-closed states, and validates the GOVERNED pick-lists (fleet status / equipment
// status / equipment condition).
//
// STRICT NON-COMPUTATION (authorized EI-P1d-1 boundary): this module NEVER computes
// inventory value, on-hand, reserved, available, reorder status, or discrepancy counts.
// Those appear ONLY when a future governed source injects them as display values; here they
// are passed through verbatim (or defaulted to null). There is no stock math here.
//
// GOVERNED PICK-LISTS: fleet status, equipment status, and equipment condition are gated
// against injected option sets -- a row value outside its governed set becomes null (the UI
// renders "Unavailable") and never seeds a selectable filter option. No condition enum is
// invented here; the options are entirely source-injected.

export const TRUCK_FLEET_STATE = Object.freeze({
  UNAVAILABLE: "unavailable", // governed view not connected (honest default)
  LOADING: "loading", // a governed read is in flight / re-scoping for a new access version
  ERROR: "error", // the governed read failed (sanitized, message-less)
  DENIED: "denied", // access denied
  EMPTY: "empty", // connected, but no trucks recorded
  READY: "ready", // connected with trucks
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
// Governed display STRING passed through verbatim, else null. Never derived.
function str(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
// Governed display NUMBER passed through verbatim, else null. Never computed/summed.
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
// A governed value gated against its injected option set: kept only if it is a governed
// option, else null (rendered "Unavailable"; never a selectable filter option).
function gated(v, optionSet) {
  return typeof v === "string" && optionSet.includes(v) ? v : null;
}
// Validate one injected pick-list into a deduped array of non-empty strings.
function validateOptionSet(v) {
  const seen = new Set();
  const out = [];
  for (const x of arr(v)) {
    if (typeof x === "string" && x.trim() !== "" && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

// The governed, validated pick-lists from the read source. Always returns the three sets
// (empty when not supplied). These drive the controlled Status/Condition filters.
export function buildTruckInventoryOptions(readResult) {
  const o = isPlainObject(readResult) && isPlainObject(readResult.options) ? readResult.options : {};
  return {
    fleetStatus: validateOptionSet(o.fleetStatus),
    equipmentStatus: validateOptionSet(o.equipmentStatus),
    equipmentCondition: validateOptionSet(o.equipmentCondition),
  };
}

// One fleet-row summary. `status` is gated to governed fleetStatus options; `metrics` are
// all governed display values (never computed).
function normalizeSummary(t, options) {
  if (!isPlainObject(t) || !str(t.id)) return null;
  const m = isPlainObject(t.metrics) ? t.metrics : {};
  return {
    id: t.id,
    technician: str(t.technician),
    location: str(t.location),
    homeWarehouse: str(t.homeWarehouse),
    status: gated(t.status, options.fleetStatus),
    metrics: {
      // inventoryValue is a PRE-FORMATTED governed label (e.g. "$48,250"), never summed here.
      inventoryValue: str(m.inventoryValue),
      serializedCount: num(m.serializedCount),
      partsCount: num(m.partsCount),
      discrepancies: num(m.discrepancies),
      lastReconciliation: str(m.lastReconciliation),
    },
  };
}

// One serialized-equipment row. status/condition are gated to governed options. An all-null
// row (no meaningful governed data) is dropped rather than rendered as dashes.
function normalizeEquipment(e, options) {
  if (!isPlainObject(e)) return null;
  const row = {
    assetId: str(e.assetId),
    internalSku: str(e.internalSku),
    manufacturer: str(e.manufacturer),
    model: str(e.model),
    serial: str(e.serial),
    condition: gated(e.condition, options.equipmentCondition),
    status: gated(e.status, options.equipmentStatus),
    destination: str(e.destination),
    currentLocation: str(e.currentLocation),
  };
  if (Object.values(row).every((v) => v === null)) return null;
  return row;
}

// One stocked-part row. A part without an internal SKU is dropped. on-hand/reserved/
// available/reorder are governed display values -- passed through, NEVER computed.
function normalizePart(p) {
  if (!isPlainObject(p) || !str(p.internalSku)) return null;
  return {
    internalSku: p.internalSku,
    description: str(p.description),
    bin: str(p.bin),
    onHand: num(p.onHand),
    reserved: num(p.reserved),
    available: num(p.available),
    reorderStatus: str(p.reorderStatus),
  };
}

function normalizeManifest(m) {
  if (!isPlainObject(m)) return null;
  return {
    order: str(m.order),
    fromWarehouse: str(m.fromWarehouse),
    status: str(m.status),
    lines: arr(m.lines)
      .map((l) => (isPlainObject(l) ? { label: str(l.label), kind: str(l.kind), internalSku: str(l.internalSku), serial: str(l.serial), state: str(l.state) } : null))
      .filter(Boolean),
  };
}

function normalizeReconItem(r) {
  if (!isPlainObject(r)) return null;
  return { assetId: str(r.assetId), internalSku: str(r.internalSku), label: str(r.label), serial: str(r.serial), lastSeen: str(r.lastSeen), expected: str(r.expected), actual: str(r.actual), note: str(r.note) };
}
function normalizeReconciliation(r) {
  if (!isPlainObject(r)) return null;
  return {
    expectedSerialized: num(r.expectedSerialized),
    scannedSerialized: num(r.scannedSerialized),
    expectedParts: num(r.expectedParts),
    scannedParts: num(r.scannedParts),
    missing: arr(r.missing).map(normalizeReconItem).filter(Boolean),
    unexpected: arr(r.unexpected).map(normalizeReconItem).filter(Boolean),
  };
}
function normalizeActivity(a) {
  if (!isPlainObject(a)) return null;
  return { time: str(a.time), type: str(a.type), message: str(a.message) };
}

// Map the (already-read) source status + truck count to the honest fleet state.
export function deriveTruckFleetState(sourceStatus, truckCount) {
  if (sourceStatus === "denied") return TRUCK_FLEET_STATE.DENIED;
  if (sourceStatus === "error") return TRUCK_FLEET_STATE.ERROR;
  if (sourceStatus === "loading") return TRUCK_FLEET_STATE.LOADING;
  if (sourceStatus !== "ready") return TRUCK_FLEET_STATE.UNAVAILABLE;
  return truckCount > 0 ? TRUCK_FLEET_STATE.READY : TRUCK_FLEET_STATE.EMPTY;
}

// Fleet view-model from the read result { status, trucks, options }. Trucks appear only
// when READY; each summary's status is gated to governed fleetStatus options.
export function buildTruckFleetView(readResult) {
  const source = isPlainObject(readResult) ? readResult : {};
  const options = buildTruckInventoryOptions(source);
  const normalized = arr(source.trucks).map((t) => normalizeSummary(t, options)).filter(Boolean);
  const state = deriveTruckFleetState(source.status, normalized.length);
  return { state, trucks: state === TRUCK_FLEET_STATE.READY ? normalized : [] };
}

// Per-truck detail view-model. Returns { state, truck }. `truck` is null unless the source
// is READY and the id is found. Every tab is a governed pass-through (never computed);
// equipment status/condition are gated to governed options and meaningless rows are dropped.
export function buildTruckDetailView(readResult, truckId) {
  const source = isPlainObject(readResult) ? readResult : {};
  const options = buildTruckInventoryOptions(source);
  const state = deriveTruckFleetState(source.status, arr(source.trucks).length);
  if (state !== TRUCK_FLEET_STATE.READY || !str(truckId)) return { state, truck: null };
  const raw = arr(source.trucks).find((t) => isPlainObject(t) && t.id === truckId);
  if (!raw) return { state, truck: null };
  const summary = normalizeSummary(raw, options);
  if (!summary) return { state, truck: null };
  return {
    state,
    truck: {
      ...summary,
      serializedEquipment: arr(raw.serializedEquipment).map((e) => normalizeEquipment(e, options)).filter(Boolean),
      parts: arr(raw.parts).map(normalizePart).filter(Boolean),
      manifest: normalizeManifest(raw.manifest),
      reconciliation: normalizeReconciliation(raw.reconciliation),
      activity: arr(raw.activity).map(normalizeActivity).filter(Boolean),
    },
  };
}
