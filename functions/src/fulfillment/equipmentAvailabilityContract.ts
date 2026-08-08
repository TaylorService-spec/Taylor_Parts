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
import type { Availability } from "./allocationProjection";

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

// Whether the canonical serialized-asset availability substrate is connected (P1a availability signal live)
// AND the ordered-model↔serial mapping is resolved. Both false today (assessment). Split out so the wiring
// point is explicit and testable; flip to true only when the substrate genuinely connects.
export function serializedAssetSubstrateConnected(): boolean {
  return false;
}

// The equipment-availability determination for one ordered EQUIPMENT_MODEL ref. Returns a proper Availability
// so the allocation projection consumes it uniformly. Fail-closed UNKNOWN whenever any required fact is
// undetermined — which is the case today for every equipment line.
export function readEquipmentAvailability(_modelRef: string): Availability {
  if (!serializedAssetSubstrateConnected()) return { kind: "UNKNOWN" };
  // Not reachable today. When the substrate connects, this branch reads the canonical serialized assets for
  // the model, applies the available predicate + eligible-warehouse location, nets other-SO selected serials,
  // and — only if temporaryPlacementConflict().available is true — subtracts its conflictSerials; otherwise
  // it still returns UNKNOWN because a no-placement fact cannot be established.
  const tp = temporaryPlacementConflict();
  if (!tp.available) return { kind: "UNKNOWN" };
  return { kind: "UNKNOWN" }; // placeholder until the canonical read is wired (see assessment)
}
