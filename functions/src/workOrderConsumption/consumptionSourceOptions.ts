// Consumption source OPTIONS — the trusted, command-scoped projection. PURE: no I/O, no clock.
//
// Decision #168 made physical consumption require a governed source and left it inactive, because
// the ruling's fallback needs a technician to name a location and a technician can read neither
// `warehouses` (admin/dispatcher or warehouse-assigned) nor `mobile_locations` (admin/dispatcher).
// This is the narrow authority that closes that, and the shape of it is the whole point.
//
// ============================ WHY A PROJECTION AND NOT A READ ============================
//
// The obvious fix was to let technicians read the location collections. That would have granted
// warehouse browsing, location configuration visibility and a standing inventory surface, to solve
// "which of a handful of places did this part come from". The permission would outlive the question.
//
// So nothing is granted. A trusted command answers ONE question — *for this technician, this Work
// Order, this part, what may the source be?* — and returns identities, not inventory. Rules are
// untouched, and a test asserts that.
//
// ============================ WHAT IS DELIBERATELY ABSENT ============================
//
// No quantities. Not on-hand, not available, not reserved, not ATP. A picker does not need them, and
// including them would turn a source selector into the inventory-visibility surface this design
// exists to avoid. If someone later wants "show me what's on the truck", that is its own authority
// with its own decision, not a field quietly added here.

export const SOURCE_METHODS = Object.freeze(["PICK", "EXPLICIT", "SERIALIZED_CUSTODY"] as const);
export type SourceMethod = (typeof SOURCE_METHODS)[number];

export interface SourceOption {
  readonly locationId: string;
  readonly locationType: string;
  /** What a person should see. Never a raw document id. */
  readonly label: string;
  readonly method: SourceMethod;
}

export interface ConsumptionSourceOptions {
  /** Pre-selected when the pick evidence is unambiguous. Null when the technician must choose. */
  readonly autoSource: SourceOption | null;
  /** What the technician may choose instead, or for the first time. */
  readonly selectableSources: readonly SourceOption[];
  /** SERIAL only: custody decides, and no selection is offered. */
  readonly serializedSource: SourceOption | null;
  /** True when a positive usage cannot be recorded until the technician picks one. */
  readonly sourceRequired: boolean;
  /**
   * Why no automatic source was available, when that is the case. Surfaced so the screen can say
   * "picked from more than one place" rather than a bare "choose one".
   */
  readonly autoSourceUnavailableReason: string | null;
}

/** A governed warehouse, as the trusted caller read it. */
export interface WarehouseCandidate {
  readonly warehouseId: string;
  readonly name?: string | null;
  readonly status?: string | null;
}

/** The technician's OWN governed truck, resolved server-side from the driver assignment. */
export interface MobileCandidate {
  readonly locationId: string;
  readonly label?: string | null;
  readonly truckId?: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

/**
 * Build the option set.
 *
 * `warehouses` and `mobile` are what the TRUSTED caller already resolved under existing authority —
 * this function never widens them, and an empty set is a legitimate answer meaning "you have no
 * eligible source", not a reason to fall back to something.
 */
export function projectConsumptionSourceOptions(input: {
  readonly trackingMode: string;
  /** From #168's resolver, when it produced one. */
  readonly pickedSource: { readonly locationId: string; readonly locationType: string } | null;
  readonly pickUnavailableReason: string | null;
  readonly serializedCurrentLocation: { readonly locationId: string; readonly locationType: string } | null;
  readonly warehouses: readonly WarehouseCandidate[];
  readonly mobile: MobileCandidate | null;
}): ConsumptionSourceOptions {
  // ---------------------------------------------------------------- SERIAL
  //
  // Custody decides. Offering a picker here would invite a contradiction that #168 already refuses,
  // so the screen is given a value to DISPLAY and nothing to choose from.
  if (input.trackingMode === "SERIAL") {
    const custodyId = input.serializedCurrentLocation === null ? null : str(input.serializedCurrentLocation.locationId);
    const custodyType = input.serializedCurrentLocation === null ? null : str(input.serializedCurrentLocation.locationType);
    if (custodyId === null || custodyType === null) {
      return Object.freeze({
        autoSource: null,
        selectableSources: Object.freeze([]),
        serializedSource: null,
        // Not "choose one" — there is nothing to choose. #168 fails this closed, and the screen must
        // not offer an action that cannot succeed.
        sourceRequired: false,
        autoSourceUnavailableReason: "SERIAL_CUSTODY_UNKNOWN",
      });
    }
    const label = labelForLocation(custodyId, custodyType, input.warehouses, input.mobile);
    return Object.freeze({
      autoSource: null,
      selectableSources: Object.freeze([]),
      serializedSource: Object.freeze({ locationId: custodyId, locationType: custodyType, label, method: "SERIALIZED_CUSTODY" as const }),
      sourceRequired: false,
      autoSourceUnavailableReason: null,
    });
  }

  // ---------------------------------------------------------------- selectable set
  //
  // Warehouses the caller resolved as ACTIVE, plus the technician's OWN truck. Another technician's
  // truck is absent by construction: the caller resolves exactly one mobile candidate, from the
  // driver assignment, and there is no parameter through which a second could arrive.
  const selectable: SourceOption[] = [];
  for (const w of input.warehouses ?? []) {
    const id = str(w?.warehouseId);
    if (id === null) continue;
    selectable.push(Object.freeze({
      locationId: id,
      locationType: "WAREHOUSE",
      label: str(w?.name) ?? id,
      method: "EXPLICIT" as const,
    }));
  }
  if (input.mobile !== null) {
    const id = str(input.mobile.locationId);
    if (id !== null) {
      selectable.push(Object.freeze({
        locationId: id,
        locationType: "MOBILE",
        label: str(input.mobile.label) ?? str(input.mobile.truckId) ?? id,
        method: "EXPLICIT" as const,
      }));
    }
  }

  // ---------------------------------------------------------------- the pick default
  const pickedId = input.pickedSource === null ? null : str(input.pickedSource.locationId);
  const pickedType = input.pickedSource === null ? null : str(input.pickedSource.locationType);
  const autoSource = pickedId === null || pickedType === null
    ? null
    : Object.freeze({
        locationId: pickedId,
        locationType: pickedType,
        label: labelForLocation(pickedId, pickedType, input.warehouses, input.mobile),
        method: "PICK" as const,
      });

  return Object.freeze({
    autoSource,
    selectableSources: Object.freeze(selectable),
    serializedSource: null,
    // Required exactly when nothing is pre-selected. The technician can always OVERRIDE an
    // auto source (#168 ruling 4) — required means "cannot proceed without choosing", not
    // "cannot change".
    sourceRequired: autoSource === null,
    autoSourceUnavailableReason: autoSource === null ? input.pickUnavailableReason : null,
  });
}

/**
 * A human label for a location id.
 *
 * Falls back to the id ONLY when no governed name is available. That is a visible imperfection
 * rather than a hidden one: a technician seeing a raw id knows something is unnamed, whereas a blank
 * or a guessed name would hide it.
 */
function labelForLocation(
  locationId: string,
  locationType: string,
  warehouses: readonly WarehouseCandidate[],
  mobile: MobileCandidate | null,
): string {
  if (locationType === "MOBILE" && mobile !== null && mobile.locationId === locationId) {
    return str(mobile.label) ?? str(mobile.truckId) ?? locationId;
  }
  const match = (warehouses ?? []).find((w) => w?.warehouseId === locationId);
  return str(match?.name) ?? locationId;
}

/**
 * Is this submitted source one the technician was actually offered?
 *
 * The server calls this at SUBMIT, against a freshly resolved option set — a stale picker option is
 * not authority (ruling E/I). Re-deriving the permitted set is what makes a warehouse deactivated
 * between render and submit refuse rather than succeed.
 */
export function isOfferedSource(options: ConsumptionSourceOptions, locationId: unknown): boolean {
  const id = str(locationId);
  if (id === null) return false;
  if (options.serializedSource !== null) return options.serializedSource.locationId === id;
  if (options.autoSource !== null && options.autoSource.locationId === id) return true;
  return options.selectableSources.some((o) => o.locationId === id);
}
