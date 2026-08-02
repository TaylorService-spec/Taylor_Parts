// EI-P1e-1 -- pure, deterministic MOBILE-location inventory projection / composer.
//
// Composes the location-scoped inventory READ-MODEL for a single MOBILE inventory location
// (a truck's mobile_locations/{locationId}) from INDEPENDENT, injected authoritative sources --
// one per inventory authority: parts stock, serialized assets, reservations / transfer manifests,
// reconciliation observations, and ledger activity. No Firebase, no persistence, no reads, NO stock
// math, and NO writes. It authors NO stock authority: every quantity / label is a governed
// pass-through display value from its source, or null.
//
// WHY PER-SECTION SOURCES. In Enterprise Inventory each fact lives in a distinct governed
// collection / service (stock_locations, serialized assets, transfer_orders, inventory ledger,
// reconciliation) -- and NONE of them is MOBILE-location / truck-indexed today. So this composer
// models each section as its OWN injectable source with its OWN state, and TODAY every section
// source is UNAVAILABLE and every section content is null (honest, never fabricated). When a real
// MOBILE-location-keyed source ships (each a separately authorized Tier-2 gate) it is injected into
// its section slot with no change to this composer's contract or to the consuming UI.
//
// GOVERNANCE INVARIANTS enforced structurally here:
//   * NO QUANTITY FABRICATION -- numbers pass through verbatim; an absent value is null, never 0,
//     and `available` is NEVER computed from onHand/reserved.
//   * CYCLE COUNT / RECONCILIATION IS AN OBSERVATION ONLY -- the reconciliation section records
//     expected / scanned / discrepancy display values and NEVER mutates or emits stock. This
//     composer has no write path; reconciliation content cannot alter the parts section.
//   * FAIL CLOSED -- a missing / malformed / denied / errored / stale source yields state != READY
//     and null content; a READY source whose payload is malformed is downgraded to ERROR.
//   * ACCESS-VERSION BOUNDARY -- a READY source whose accessVersion != boundaryKey is stale and
//     becomes LOADING (its content disappears until a current-version source arrives).
//   * DETERMINISTIC -- pure function of its inputs; no clock, no randomness.

// Section source states mirror src/access/truckInventorySource.js TRUCK_INVENTORY_SOURCE_STATUS.
// Defined locally so this domain module carries no dependency on the access layer.
export const MOBILE_INVENTORY_SECTION_STATE = Object.freeze({
  UNAVAILABLE: "unavailable", // no governed source connected for this section (the honest default today)
  LOADING: "loading", // a governed read is in flight / being re-scoped for a new access version
  DENIED: "denied", // access denied
  ERROR: "error", // the governed read failed, or a READY payload was malformed (sanitized, message-less)
  READY: "ready", // connected with a governed payload
});

// The inventory authorities this projection composes, in a stable order.
export const MOBILE_INVENTORY_SECTIONS = Object.freeze([
  "parts",
  "serializedAssets",
  "reservations",
  "reconciliation",
  "activity",
]);

const KNOWN_STATES = Object.freeze(Object.values(MOBILE_INVENTORY_SECTION_STATE));

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
// Governed display STRING passed through verbatim, else null. Never derived.
function str(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
// Governed display NUMBER passed through verbatim, else null. NEVER computed / summed / derived.
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
// A governed value gated against its injected pick-list: kept only if it is a governed option,
// else null (rendered "Unavailable"; never a fabricated/selectable value).
function gated(v, optionSet) {
  return typeof v === "string" && optionSet.includes(v) ? v : null;
}
function validateOptionSet(v) {
  const seen = new Set();
  const out = [];
  for (const x of arr(v)) {
    if (typeof x === "string" && x.trim() !== "" && !seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}

// Governed pick-lists (Status / Condition) for the serialized-asset section. Entirely
// source-injected; no enum is invented here.
export function buildMobileInventoryOptions(input) {
  const o = isPlainObject(input) ? input : {};
  return {
    equipmentStatus: validateOptionSet(o.equipmentStatus),
    equipmentCondition: validateOptionSet(o.equipmentCondition),
  };
}

// The truckId -> locationId mapping (mirrors trucks/{truckId}.locationId == mobile_locations/
// {locationId}). Both must be governed identifiers or the location is UNRESOLVED (null).
export function resolveMobileLocationIdentity(identity) {
  if (!isPlainObject(identity)) return null;
  const truckId = str(identity.truckId);
  const locationId = str(identity.locationId);
  if (!truckId || !locationId) return null;
  return { truckId, locationId };
}

// --- per-row normalizers: strict pass-through, drop malformed rows, NEVER compute ---
function normalizePartRow(p) {
  if (!isPlainObject(p) || !str(p.internalSku)) return null;
  return {
    internalSku: p.internalSku,
    description: str(p.description),
    bin: str(p.bin),
    onHand: num(p.onHand), // absent -> null, NEVER 0
    reserved: num(p.reserved), // absent -> null, NEVER 0
    available: num(p.available), // absent -> null, NEVER onHand - reserved
    reorderStatus: str(p.reorderStatus),
  };
}
function normalizeSerializedRow(e, options) {
  if (!isPlainObject(e)) return null;
  const row = {
    assetId: str(e.assetId),
    internalSku: str(e.internalSku),
    manufacturer: str(e.manufacturer),
    model: str(e.model),
    serial: str(e.serial),
    condition: gated(e.condition, options.equipmentCondition),
    status: gated(e.status, options.equipmentStatus),
    currentLocation: str(e.currentLocation),
  };
  if (Object.values(row).every((v) => v === null)) return null;
  return row;
}
function normalizeReservationRow(r) {
  if (!isPlainObject(r)) return null;
  const row = {
    order: str(r.order),
    kind: str(r.kind),
    internalSku: str(r.internalSku),
    serial: str(r.serial),
    quantity: num(r.quantity),
    state: str(r.state),
  };
  if (Object.values(row).every((v) => v === null)) return null;
  return row;
}
function normalizeReconItem(r) {
  if (!isPlainObject(r)) return null;
  return {
    assetId: str(r.assetId), internalSku: str(r.internalSku), label: str(r.label),
    serial: str(r.serial), lastSeen: str(r.lastSeen), expected: str(r.expected),
    actual: str(r.actual), note: str(r.note),
  };
}
// Reconciliation / cycle-count OBSERVATION only. Records expected / scanned counts and the
// missing / unexpected discrepancy lists as governed display values. NEVER a stock mutation.
function normalizeReconciliationObservation(o) {
  if (!isPlainObject(o)) return null;
  return {
    expectedSerialized: num(o.expectedSerialized),
    scannedSerialized: num(o.scannedSerialized),
    expectedParts: num(o.expectedParts),
    scannedParts: num(o.scannedParts),
    missing: arr(o.missing).map(normalizeReconItem).filter(Boolean),
    unexpected: arr(o.unexpected).map(normalizeReconItem).filter(Boolean),
  };
}
function normalizeActivityRow(a) {
  if (!isPlainObject(a)) return null;
  const row = { time: str(a.time), type: str(a.type), message: str(a.message) };
  if (Object.values(row).every((v) => v === null)) return null;
  return row;
}

// Resolve one injected section source to a state, applying the access-version boundary and
// sanitizing ERROR. Never returns a raw error.
function readSectionState(source, boundaryKey) {
  if (!isPlainObject(source)) return MOBILE_INVENTORY_SECTION_STATE.UNAVAILABLE;
  const status = KNOWN_STATES.includes(source.status) ? source.status : MOBILE_INVENTORY_SECTION_STATE.UNAVAILABLE;
  if (status === MOBILE_INVENTORY_SECTION_STATE.READY) {
    if (boundaryKey !== undefined && source.accessVersion !== boundaryKey) {
      return MOBILE_INVENTORY_SECTION_STATE.LOADING; // stale prior-access-version READY -> loading
    }
    return MOBILE_INVENTORY_SECTION_STATE.READY;
  }
  if (status === MOBILE_INVENTORY_SECTION_STATE.ERROR) return MOBILE_INVENTORY_SECTION_STATE.ERROR;
  return status; // loading / denied / unavailable
}

// Build one ARRAY section ({ state, items }). `items` is null unless the section is READY with a
// well-formed array payload; a READY-but-malformed payload fails closed to ERROR.
function buildArraySection(source, boundaryKey, resolved, normalizeRow) {
  if (!resolved) return { state: MOBILE_INVENTORY_SECTION_STATE.UNAVAILABLE, items: null };
  const state = readSectionState(source, boundaryKey);
  if (state !== MOBILE_INVENTORY_SECTION_STATE.READY) return { state, items: null };
  if (!Array.isArray(source.items)) return { state: MOBILE_INVENTORY_SECTION_STATE.ERROR, items: null };
  return { state, items: source.items.map(normalizeRow).filter(Boolean) };
}

// Build the reconciliation OBSERVATION section ({ state, observation }). `observation` is null
// unless READY with a well-formed object payload; malformed READY fails closed to ERROR.
function buildReconciliationSection(source, boundaryKey, resolved) {
  if (!resolved) return { state: MOBILE_INVENTORY_SECTION_STATE.UNAVAILABLE, observation: null };
  const state = readSectionState(source, boundaryKey);
  if (state !== MOBILE_INVENTORY_SECTION_STATE.READY) return { state, observation: null };
  const observation = normalizeReconciliationObservation(source.observation);
  if (observation === null) return { state: MOBILE_INVENTORY_SECTION_STATE.ERROR, observation: null };
  return { state, observation };
}

// Compose the MOBILE-location inventory read-model.
//   input.identity   = { truckId, locationId }        (the registry-resolved mapping)
//   input.sources    = { parts, serializedAssets, reservations, reconciliation, activity }
//                      -- each an injected source-result { status, accessVersion, items|observation }
//   input.boundaryKey= the current access version (per-section accessVersion must match)
//   input.options    = { equipmentStatus, equipmentCondition }   governed pick-lists
//
// Returns { identity, resolved, sections }. When the identity is UNRESOLVED, every section is
// UNAVAILABLE with null content (inventory can never attach to an unknown MOBILE location).
export function composeMobileLocationInventory(input = {}) {
  const in_ = isPlainObject(input) ? input : {};
  const identity = resolveMobileLocationIdentity(in_.identity);
  const resolved = identity !== null;
  const boundaryKey = in_.boundaryKey;
  const options = buildMobileInventoryOptions(in_.options);
  const sources = isPlainObject(in_.sources) ? in_.sources : {};

  return {
    identity,
    resolved,
    sections: {
      parts: buildArraySection(sources.parts, boundaryKey, resolved, normalizePartRow),
      serializedAssets: buildArraySection(sources.serializedAssets, boundaryKey, resolved, (e) => normalizeSerializedRow(e, options)),
      reservations: buildArraySection(sources.reservations, boundaryKey, resolved, normalizeReservationRow),
      reconciliation: buildReconciliationSection(sources.reconciliation, boundaryKey, resolved),
      activity: buildArraySection(sources.activity, boundaryKey, resolved, normalizeActivityRow),
    },
  };
}
