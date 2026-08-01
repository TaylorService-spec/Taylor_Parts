// EI-P1d-1 -- pure, node-testable view-model composer for the Truck Inventory workspace.
// No Firebase, no persistence, no reads. It shapes the GOVERNED, already-read Truck
// Inventory source into render-ready fleet and per-truck view-models, and derives the
// honest fail-closed states.
//
// STRICT NON-COMPUTATION (authorized EI-P1d-1 boundary): this module NEVER computes
// inventory value, on-hand, reserved, available, reorder status, or discrepancy counts.
// Those appear ONLY when a future governed source injects them as display values; here they
// are passed through verbatim (or defaulted to null / empty). There is no stock math here.

export const TRUCK_FLEET_STATE = Object.freeze({
  UNAVAILABLE: "unavailable", // governed view not connected (honest default)
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

// One fleet-row summary. `metrics` are all governed display values (never computed).
function normalizeSummary(t) {
  if (!isPlainObject(t) || !str(t.id)) return null;
  const m = isPlainObject(t.metrics) ? t.metrics : {};
  return {
    id: t.id,
    technician: str(t.technician),
    location: str(t.location),
    homeWarehouse: str(t.homeWarehouse),
    status: str(t.status),
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

function normalizeEquipment(e) {
  if (!isPlainObject(e)) return null;
  return {
    assetId: str(e.assetId),
    internalSku: str(e.internalSku),
    manufacturer: str(e.manufacturer),
    model: str(e.model),
    serial: str(e.serial),
    condition: str(e.condition),
    status: str(e.status),
    destination: str(e.destination),
    currentLocation: str(e.currentLocation),
  };
}

function normalizePart(p) {
  if (!isPlainObject(p)) return null;
  return {
    internalSku: str(p.internalSku),
    description: str(p.description),
    bin: str(p.bin),
    // on-hand / reserved / available / reorder are GOVERNED display values -- passed through,
    // NEVER computed (available is not derived from on-hand minus reserved here).
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
  if (sourceStatus !== "ready") return TRUCK_FLEET_STATE.UNAVAILABLE;
  return truckCount > 0 ? TRUCK_FLEET_STATE.READY : TRUCK_FLEET_STATE.EMPTY;
}

// Fleet view-model from the read result { status, trucks }. Trucks appear only when READY.
export function buildTruckFleetView(readResult) {
  const source = isPlainObject(readResult) ? readResult : {};
  const normalized = arr(source.trucks).map(normalizeSummary).filter(Boolean);
  const state = deriveTruckFleetState(source.status, normalized.length);
  return { state, trucks: state === TRUCK_FLEET_STATE.READY ? normalized : [] };
}

// Per-truck detail view-model. Returns { state, truck }. `truck` is null unless the source
// is READY and the id is found. Every tab is a governed pass-through (never computed).
export function buildTruckDetailView(readResult, truckId) {
  const source = isPlainObject(readResult) ? readResult : {};
  const state = deriveTruckFleetState(source.status, arr(source.trucks).length);
  if (state !== TRUCK_FLEET_STATE.READY || !str(truckId)) return { state, truck: null };
  const raw = arr(source.trucks).find((t) => isPlainObject(t) && t.id === truckId);
  if (!raw) return { state, truck: null };
  const summary = normalizeSummary(raw);
  if (!summary) return { state, truck: null };
  return {
    state,
    truck: {
      ...summary,
      serializedEquipment: arr(raw.serializedEquipment).map(normalizeEquipment).filter(Boolean),
      parts: arr(raw.parts).map(normalizePart).filter(Boolean),
      manifest: normalizeManifest(raw.manifest),
      reconciliation: normalizeReconciliation(raw.reconciliation),
      activity: arr(raw.activity).map(normalizeActivity).filter(Boolean),
    },
  };
}
