// Work Order physical consumption — SOURCE RESOLUTION. PURE: no Firestore, no clock, no I/O.
//
// The Owner ruling this implements: a Work Order part cannot become physically consumed without
// identifying the governed physical location it came from. No source means REFUSED — EOS will not
// knowingly record SOURCE UNKNOWN for new usage, because doing so preserves overstated inventory
// and re-offers units that are already fitted to a machine.
//
// ============================ WHY A RESOLVER AND NOT A FIELD ============================
//
// The source could have been one required input. It is not, because two of the three cases already
// know the answer and asking again would be noise the technician learns to click through:
//
//   SERIAL    the serialized asset's own custody IS the answer, and a contradicting selection is a
//             defect rather than a preference.
//   PICKED    a governed bin_placement already records which warehouse was picked FOR THIS WORK
//             ORDER. That is evidence, not a guess.
//   OTHERWISE the technician is the only party who knows, so they are asked.
//
// ============================ EXPLICIT BEATS EVIDENCE ============================
//
// An explicit selection OVERRIDES a pick suggestion, deliberately. Parts get picked from a warehouse
// and then an equivalent unit already on the truck gets used instead; the pick is what someone
// intended, the explicit answer is what happened, and physical truth beats historical intent.
//
// The placement is NOT rewritten when that happens. It stays as the record of what was picked.

export const CONSUMPTION_SOURCE_BASIS = Object.freeze([
  "SERIALIZED_CUSTODY",
  "PICKED_PLACEMENT",
  "EXPLICIT_SELECTION",
] as const);
export type ConsumptionSourceBasis = (typeof CONSUMPTION_SOURCE_BASIS)[number];

export type ConsumptionSourceFailure =
  | "SOURCE_REQUIRED"
  | "SOURCE_AMBIGUOUS"
  | "SOURCE_NOT_GOVERNED"
  | "SERIAL_CUSTODY_UNKNOWN"
  | "SERIAL_SOURCE_CONTRADICTED";

export interface ResolvedConsumptionSource {
  readonly locationType: string;
  readonly locationId: string;
  readonly basis: ConsumptionSourceBasis;
}

export type ConsumptionSourceResult =
  | { readonly resolved: true; readonly source: ResolvedConsumptionSource; readonly reason: null }
  | { readonly resolved: false; readonly source: null; readonly reason: ConsumptionSourceFailure };

/** A governed location the caller is permitted to consume from, as resolved by the caller's authority. */
export interface GovernedLocation {
  readonly type: string;
  readonly locationId: string;
}

/** One server-written bin placement, as `bin_placements` already stores it. */
export interface PickedPlacement {
  readonly warehouseId: string;
  readonly partId: string;
  readonly quantity: number;
  readonly pickedForWorkOrderId: string;
}

const ok = (source: ResolvedConsumptionSource): ConsumptionSourceResult =>
  ({ resolved: true, source: Object.freeze(source), reason: null });
const fail = (reason: ConsumptionSourceFailure): ConsumptionSourceResult =>
  ({ resolved: false, source: null, reason });

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

/**
 * Resolve where a consumed quantity physically came from.
 *
 * `governedLocations` is the set the CALLER's authority already permits — this function never widens
 * it, and never invents a location that is not in it. That is what keeps "governed physical inventory
 * location" a real constraint rather than a comment.
 */
export function resolveConsumptionSource(input: {
  readonly workOrderId: unknown;
  readonly partId: unknown;
  readonly requestedQuantity: number;
  readonly trackingMode: string;
  /** SERIAL only: the asset's own governed custody. Null when absent or unresolvable. */
  readonly serializedCurrentLocation?: GovernedLocation | null;
  readonly explicitSourceLocationId?: unknown;
  readonly governedLocations: readonly GovernedLocation[];
  readonly placements: readonly PickedPlacement[];
}): ConsumptionSourceResult {
  const workOrderId = str(input.workOrderId);
  const partId = str(input.partId);
  if (workOrderId === null || partId === null) return fail("SOURCE_REQUIRED");
  const explicit = str(input.explicitSourceLocationId);
  const governed = input.governedLocations ?? [];
  const findGoverned = (id: string) => governed.find((l) => l.locationId === id) ?? null;

  // ---------------------------------------------------------------- SERIAL
  //
  // The serialized asset's custody is the authority, full stop. A serialized unit is not a quantity,
  // so there is nothing to allocate and no choice to offer.
  if (input.trackingMode === "SERIAL") {
    const custody = input.serializedCurrentLocation ?? null;
    const custodyId = custody === null ? null : str(custody.locationId);
    const custodyType = custody === null ? null : str(custody.type);
    // Fail closed rather than falling through to a selection. An asset whose custody is unknown is
    // exactly the case where letting someone assert a location would fabricate history.
    if (custodyId === null || custodyType === null) return fail("SERIAL_CUSTODY_UNKNOWN");
    // A contradicting explicit selection is a DEFECT, not a preference — the override in this ruling
    // is for fungible quantity, where the technician genuinely knows better than the pick record.
    // For a serialized unit the registry knows where the unit is, and disagreeing with it means one
    // of the two is wrong.
    if (explicit !== null && explicit !== custodyId) return fail("SERIAL_SOURCE_CONTRADICTED");
    return ok({ locationType: custodyType, locationId: custodyId, basis: "SERIALIZED_CUSTODY" });
  }

  // ---------------------------------------------------------------- 1. EXPLICIT
  //
  // Checked BEFORE the pick evidence, because it outranks it.
  if (explicit !== null) {
    const location = findGoverned(explicit);
    if (location === null) return fail("SOURCE_NOT_GOVERNED");
    return ok({ locationType: location.type, locationId: location.locationId, basis: "EXPLICIT_SELECTION" });
  }

  // ---------------------------------------------------------------- 2. PICKED PLACEMENT
  const applicable = (input.placements ?? []).filter(
    (p) => p?.pickedForWorkOrderId === workOrderId && p?.partId === partId && str(p?.warehouseId) !== null,
  );
  if (applicable.length > 0) {
    const warehouses = [...new Set(applicable.map((p) => p.warehouseId))];
    // MORE THAN ONE WAREHOUSE COULD HAVE SUPPLIED IT ⇒ ASK, never pick the first.
    //
    // Choosing one would be a guess wearing the authority of a record. Two warehouses each picked
    // for this job is precisely the case where only the technician knows which units were fitted.
    if (warehouses.length > 1) return fail("SOURCE_AMBIGUOUS");
    const only = warehouses[0];
    // The picked quantity must be able to account for what is being consumed. If the job was picked
    // 2 and 3 are being used, the third unit came from somewhere this record cannot name — so the
    // whole consumption needs an explicit answer rather than a partially-true one.
    const picked = applicable.reduce((n, p) => n + (typeof p.quantity === "number" && p.quantity > 0 ? p.quantity : 0), 0);
    if (!(picked >= input.requestedQuantity)) return fail("SOURCE_AMBIGUOUS");
    const location = findGoverned(only);
    // A placement naming a warehouse the caller may not consume from is not a licence to use it.
    if (location === null) return fail("SOURCE_NOT_GOVERNED");
    return ok({ locationType: location.type, locationId: location.locationId, basis: "PICKED_PLACEMENT" });
  }

  // ---------------------------------------------------------------- 3. REFUSE
  return fail("SOURCE_REQUIRED");
}

/** The user-facing wording for each refusal. Concrete: it says what to DO, never a code. */
export const CONSUMPTION_SOURCE_MESSAGE: Readonly<Record<ConsumptionSourceFailure, string>> = Object.freeze({
  SOURCE_REQUIRED: "Select where this part came from before recording usage.",
  SOURCE_AMBIGUOUS: "This part was picked from more than one place. Select where the parts you used came from.",
  SOURCE_NOT_GOVERNED: "That inventory location is not available for this job. Select one of the locations offered.",
  SERIAL_CUSTODY_UNKNOWN: "EOS does not know where this serialized unit currently is, so its usage cannot be recorded yet.",
  SERIAL_SOURCE_CONTRADICTED: "This serialized unit is recorded at a different location. Its usage must be recorded from where it actually is.",
});
