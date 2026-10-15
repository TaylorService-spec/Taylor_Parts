"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.temporaryPlacementConflict = temporaryPlacementConflict;
exports.resolveEquipmentModelCandidates = resolveEquipmentModelCandidates;
exports.availabilitySignalConnected = availabilitySignalConnected;
exports.serializedAssetSubstrateConnected = serializedAssetSubstrateConnected;
exports.readEquipmentAvailability = readEquipmentAvailability;
const equipmentModelResolution_1 = require("./equipmentModelResolution");
// The #12 plug point. Until the Temporary Placement authority exists, this reports UNDETERMINED. When #12
// lands, replace the body with a real read; nothing else in the availability path changes.
function temporaryPlacementConflict() {
    return { available: false, conflictSerials: [] };
}
// GATE 1 — the ordered-model↔serial MAPPING. Resolved (Option A) as soon as a resolver + Part catalog are
// injected: we can turn a model ref into candidate serials. Returns the candidates, or null when the mapping
// cannot be resolved (no deps, unresolved ref, or no eligible whole-unit Parts). This is NOT an availability
// decision — only the mapping.
function resolveEquipmentModelCandidates(modelRef, deps = {}) {
    if (!Array.isArray(deps.parts))
        return null; // no catalog injected ⇒ mapping cannot be resolved here
    const resolution = (0, equipmentModelResolution_1.resolveOrderedModelRef)(modelRef, { resolveAlias: deps.resolveAlias });
    if (!resolution.resolved)
        return null;
    return (0, equipmentModelResolution_1.resolveWholeUnitSerialCandidates)(resolution.equipmentModelId, {
        parts: deps.parts,
        serialsByPartId: deps.serialsByPartId ?? {},
    });
}
// GATE 2 — the serialized-asset AVAILABILITY SIGNAL (P1a). Still not connected: without it we cannot assert a
// candidate serial is company-controlled AND operationally available at an eligible warehouse. Flip to true
// only when the canonical availability signal genuinely connects.
function availabilitySignalConnected() {
    return false;
}
// Overall substrate = the availability signal being live. Retained (name + false) for back-compat; the mapping
// gate is now separate (resolveEquipmentModelCandidates) and no longer the reason this is false.
function serializedAssetSubstrateConnected() {
    return availabilitySignalConnected();
}
// The equipment-availability determination for one ordered EQUIPMENT_MODEL ref. Returns a proper Availability
// so the allocation projection consumes it uniformly. With Option A the MAPPING resolves (candidates below),
// but availability is still fail-closed UNKNOWN: the availability signal is not connected, and even once it is,
// a no-temp-placement fact cannot be established until #12 exists. Backward-compatible — called with just a ref
// (allocateSalesOrder) it behaves exactly as before (UNKNOWN).
function readEquipmentAvailability(modelRef, deps = {}) {
    // Mapping (Gate 1): resolvable when deps are injected; drives the future read. Computed now to prove the
    // mapping is wired, but it does NOT by itself make anything available.
    const candidates = resolveEquipmentModelCandidates(modelRef, deps);
    void candidates; // candidates feed the availability read once Gate 2 connects; unused while fail-closed
    if (!availabilitySignalConnected())
        return { kind: "UNKNOWN" }; // Gate 2 not connected ⇒ honest UNKNOWN
    // Not reachable today. When the availability signal connects, this branch applies the available predicate +
    // eligible-warehouse location to `candidates`, nets other-SO selected serials, and — only if
    // temporaryPlacementConflict().available is true — subtracts its conflictSerials; otherwise it still returns
    // UNKNOWN because a no-placement fact cannot be established (#12).
    const tp = temporaryPlacementConflict();
    if (!tp.available)
        return { kind: "UNKNOWN" };
    return { kind: "UNKNOWN" }; // placeholder until the canonical availability read is wired (see assessment)
}
//# sourceMappingURL=equipmentAvailabilityContract.js.map