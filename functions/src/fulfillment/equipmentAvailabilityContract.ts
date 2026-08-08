// Fulfillment — Equipment-availability CONTRACT + the #12 temporary-placement conflict seam. This is the
// single place that decides serialized-equipment availability for Sales Order allocation. Today it returns
// UNKNOWN / fail-closed for the reasons established in the canonical-read assessment
// (docs/assessments/equipment-availability-contract-assessment.md): the serialized-asset `availability`
// signal is injected/not-yet-connected (P1a), the ordered-model↔serial mapping is unresolved, and the
// Temporary Placement authority (#12) does not exist so a no-placement fact cannot be established.
//
// IMPORTANT (Owner: "do not turn a future no-op adapter into fake authority"): the temp-placement source
// reports `available:false` (UNDETERMINED), NOT an empty conflict list meaning "no conflicts". An empty list
// with available:false means "cannot establish", and callers MUST fail closed on it.
//
// UPDATE (Owner Decision — Option A ratified): the ordered-model↔serial MAPPING is now resolved (a governed
// Part.equipmentModelId FK + alias-aware resolution, functions/src/fulfillment/equipmentModelResolution.ts).
// So the mapping is NO LONGER a blocker — when a resolver + Part catalog + serials are injected, this contract
// resolves the candidate serials for a model. Availability still fails closed to UNKNOWN because the OTHER two
// blockers remain: the serialized-asset AVAILABILITY SIGNAL is not connected (P1a), and #12 Temporary Placement
// does not exist. The gates are split below so each flips independently.
import type { Availability } from "./allocationProjection";
import {
  resolveOrderedModelRef,
  resolveWholeUnitSerialCandidates,
  type WholeUnitPartLike,
} from "./equipmentModelResolution";

// Injected substrate for a real read. All optional: absent ⇒ the mapping cannot be resolved from here and the
// contract fails closed exactly as before. `resolveAlias` is the governed equipment-model alias resolver;
// `parts` is the whole-unit Part catalog (partId/status/wholeUnit/equipmentModelId); `serialsByPartId` maps an
// eligible partId to its serialized-asset serials.
export interface EquipmentAvailabilityDeps {
  resolveAlias?: (rawRef: string) => string | null;
  parts?: WholeUnitPartLike[];
  serialsByPartId?: Record<string, string[]>;
}

export interface TempPlacementConflictResult {
  // false ⇒ the Temporary Placement authority (#12) does not exist, so conflicts are UNDETERMINED and callers
  // must fail closed. true ⇒ a real source answered and `conflictSerials` is authoritative.
  available: boolean;
  conflictSerials: string[];
}

// The #12 plug point. Until the Temporary Placement authority exists, this reports UNDETERMINED. When #12
// lands, replace the body with a real read; nothing else in the availability path changes.
export function temporaryPlacementConflict(): TempPlacementConflictResult {
  return { available: false, conflictSerials: [] };
}

// GATE 1 — the ordered-model↔serial MAPPING. Resolved (Option A) as soon as a resolver + Part catalog are
// injected: we can turn a model ref into candidate serials. Returns the candidates, or null when the mapping
// cannot be resolved (no deps, unresolved ref, or no eligible whole-unit Parts). This is NOT an availability
// decision — only the mapping.
export function resolveEquipmentModelCandidates(modelRef: string, deps: EquipmentAvailabilityDeps = {}): string[] | null {
  if (!Array.isArray(deps.parts)) return null; // no catalog injected ⇒ mapping cannot be resolved here
  const resolution = resolveOrderedModelRef(modelRef, { resolveAlias: deps.resolveAlias });
  if (!resolution.resolved) return null;
  return resolveWholeUnitSerialCandidates(resolution.equipmentModelId, {
    parts: deps.parts,
    serialsByPartId: deps.serialsByPartId ?? {},
  });
}

// GATE 2 — the serialized-asset AVAILABILITY SIGNAL (P1a). Still not connected: without it we cannot assert a
// candidate serial is company-controlled AND operationally available at an eligible warehouse. Flip to true
// only when the canonical availability signal genuinely connects.
export function availabilitySignalConnected(): boolean {
  return false;
}

// Overall substrate = the availability signal being live. Retained (name + false) for back-compat; the mapping
// gate is now separate (resolveEquipmentModelCandidates) and no longer the reason this is false.
export function serializedAssetSubstrateConnected(): boolean {
  return availabilitySignalConnected();
}

// The equipment-availability determination for one ordered EQUIPMENT_MODEL ref. Returns a proper Availability
// so the allocation projection consumes it uniformly. With Option A the MAPPING resolves (candidates below),
// but availability is still fail-closed UNKNOWN: the availability signal is not connected, and even once it is,
// a no-temp-placement fact cannot be established until #12 exists. Backward-compatible — called with just a ref
// (allocateSalesOrder) it behaves exactly as before (UNKNOWN).
export function readEquipmentAvailability(modelRef: string, deps: EquipmentAvailabilityDeps = {}): Availability {
  // Mapping (Gate 1): resolvable when deps are injected; drives the future read. Computed now to prove the
  // mapping is wired, but it does NOT by itself make anything available.
  const candidates = resolveEquipmentModelCandidates(modelRef, deps);
  void candidates; // candidates feed the availability read once Gate 2 connects; unused while fail-closed

  if (!availabilitySignalConnected()) return { kind: "UNKNOWN" }; // Gate 2 not connected ⇒ honest UNKNOWN
  // Not reachable today. When the availability signal connects, this branch applies the available predicate +
  // eligible-warehouse location to `candidates`, nets other-SO selected serials, and — only if
  // temporaryPlacementConflict().available is true — subtracts its conflictSerials; otherwise it still returns
  // UNKNOWN because a no-placement fact cannot be established (#12).
  const tp = temporaryPlacementConflict();
  if (!tp.available) return { kind: "UNKNOWN" };
  return { kind: "UNKNOWN" }; // placeholder until the canonical availability read is wired (see assessment)
}
