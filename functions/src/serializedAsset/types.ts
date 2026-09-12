// Serialized Asset registry -- persistence CONTRACT + pure validator (Spec phase M.1: "Serialized Asset
// identity + Available Equipment read"; docs/specifications/serialized-asset-equipment-installation.md §D,
// ADR-010 + DECISIONS #59). This module defines the exact governed shape of one `serialized_assets/{id}`
// document and validates it. It performs NO persistence and is imported by both the trusted read service
// (serializedAssetReadService.ts) and its offline tests.
//
// FIELD-BY-FIELD RECONCILIATION WITH THE EXISTING PURE CLIENT CONTRACT (deliberate, not invented):
//   * `SERIALIZED_ASSET_STATES` is the EXACT 8-value lifecycle set already governed by
//     field-ops-app-vite/src/domain/serializedAssetIdentity.js (RECEIVED, AVAILABLE, RESERVED, STAGED,
//     LOADED, IN_TRANSIT, DELIVERED, INSTALLED). Reused verbatim -- no new/renamed/removed state.
//   * `serialNo`, `partId`, `currentEquipmentId` reuse that same module's field names and fail-closed
//     nullability rule for `currentEquipmentId` (null/undefined = not installed; otherwise a non-empty
//     string = the ACTIVE, single-valued installation link -- never an array, never concurrent).
//   * `currentLocationId`: the Specification's exact §D field NAME for the ledger-derived location. NOTE
//     (flagged, not silently resolved): the existing pure client module's Available-Equipment composition
//     (serializedAssetIdentity.js's `composeAvailableEquipment`) instead consumes a `currentLocation`
//     REFERENCE OBJECT `{ type, locationId }` (field-ops-app-vite/src/domain/inventoryLocation.js's
//     `validateLocationRef` shape), not a flat id string. The Specification's §D bracket literally names
//     the persisted field `currentLocationId` (a scalar id), so THIS document contract uses that scalar --
//     matching the governing Specification text exactly. The projection carries the SAME scalar and does
//     NOT resolve a `{ type, locationId }` reference: doing so would require reading a Location authority
//     that this slice does not read, and fabricating a `type` would be exactly the invented fact this
//     contract refuses to produce. CONSEQUENCE, stated plainly: `composeAvailableEquipment` cannot consume
//     this projection as-is -- a caller must adapt the shapes, and no such caller exists yet (this slice
//     ships no UI). Reconciling the two (rename one side, or add a governed Location read) is a spec-author
//     decision, deliberately left open rather than pre-empted here.
//     This is a real, pre-existing naming inconsistency between the Specification and the already-merged
//     pure module; this contract does not invent a resolution. See the report for the
//     full callout.
//   * `ownership`: the Specification's §D "ownership attribute (company / vendor-consignment §4.13)".
//     §4.13 (vendor consignment) is REFERENCED, not itself implemented here; the two-value enum below names
//     only what §D's own parenthetical enumerates. No other ownership category is invented.
//   * Serial identity persisting via "serialNo + assetTag + QR" (§D prose) is NOT modeled as additional
//     identity fields here, matching field-ops-app-vite/src/domain/serializedAssetIdentity.js's
//     IDENTITY_FIELDS, which likewise omits assetTag/QR from the governed identity contract. Those remain a
//     future, separately-scoped addition (Spec phase M.5, "Scan-event reuse").
//
// SUPERSEDED (per the Specification's header) and deliberately NOT reintroduced here: `equipment_movements`,
// `equipment_fulfillment_events`, a `vehicles/{id}` custody authority, pre-install `fulfillmentState` on
// Equipment, COMPANY-owned pre-install `equipment/{id}` records. This module creates no second ledger, no
// second movement/custody authority, and no second Equipment record.

// Rev 6 Specification lifecycle STATE (docs/specifications/serialized-asset-equipment-installation.md §D),
// reused VERBATIM from field-ops-app-vite/src/domain/serializedAssetIdentity.js's SERIALIZED_ASSET_STATES --
// mirrored (not shared; no monorepo tooling), so if either changes, change both.
export const SERIALIZED_ASSET_STATES = [
  "RECEIVED",
  "AVAILABLE",
  "RESERVED",
  "STAGED",
  "LOADED",
  "IN_TRANSIT",
  "DELIVERED",
  "INSTALLED",
] as const;
export type SerializedAssetState = (typeof SERIALIZED_ASSET_STATES)[number];

// §D "ownership attribute (company / vendor-consignment §4.13)" -- the two values §D's own parenthetical
// names. §4.13 (vendor consignment) is a referenced, not-yet-built authority; this enum names the
// attribute's governed values only, invents nothing beyond them.
export const SERIALIZED_ASSET_OWNERSHIP_TYPES = ["COMPANY", "VENDOR_CONSIGNMENT"] as const;
export type SerializedAssetOwnership = (typeof SERIALIZED_ASSET_OWNERSHIP_TYPES)[number];

// ════════════════════ THE TYPED LOCATION PAIR ════════════════════
//
// `currentLocationId` alone is NOT a location. The ruling this registry is held to is that location
// identity is the typed pair `(type, id)` -- a bare id is never enough, and an unrecoverable type is
// rejected rather than guessed. The header note above recorded that this backend contract flattened
// the pair to a scalar while the already-merged pure client contract
// (field-ops-app-vite/src/domain/serializedAssetIdentity.js:51,129) has always required the REFERENCE
// object `{ type, locationId }` via `validateLocationRef`. The type half is restored here, under the
// Specification's own field naming (`currentLocationType` beside `currentLocationId`), because the
// consequence of leaving it out was not cosmetic: NOTHING wrote the field, one reader
// (workOrderConsumption/consumptionSourceService.ts) defaulted it to "WAREHOUSE", and a serialized
// unit relocated into a BIN (inventoryLocation/stockRelocationCommand.ts writes the bin id into
// `currentLocationId`) was therefore reported to Work-Order consumption as a WAREHOUSE whose id is a
// bin id.
//
// WHY THESE THREE VALUES, AND NOT THE SIX IN inventoryLedger/operationalMovementTypes.ts.
// This is the PHYSICAL INVENTORY CUSTODY vocabulary -- the places a company-held serialized unit can
// actually be, and exactly the set the writers of `currentLocationId` can produce: receiving admits
// WAREHOUSE only (inventoryReceiving/receivingCallables.ts), relocation WAREHOUSE|BIN
// (RELOCATION_ENDPOINT_TYPES), transfer WAREHOUSE|BIN|MOBILE (TRANSFER_ENDPOINT_TYPES). The ledger's
// VENDOR/CUSTOMER/VIRTUAL are movement counterparties, not custody of a unit we hold, and no writer
// can put one here -- admitting them would widen this field beyond anything that can occur.
//
// EQUIPMENT IS DELIBERATELY ABSENT. An installed unit's custody is the customer's Equipment, and that
// fact is carried by `currentEquipmentId` -- the single-valued install link this contract already
// governs -- not by a location type. Migration 007 draws the same line in SQL: it adds EQUIPMENT to
// the CUSTODY enum (`ops_custody_location_type`) and pointedly NOT to the physical movement enum
// (`ops_location_type`), because a movement row pointing at an Equipment id would enter
// customer-owned machines into a balance that sums company stock. `currentLocationType` is the
// physical half of that split, so it stops at MOBILE.
export const SERIALIZED_CUSTODY_LOCATION_TYPES = ["WAREHOUSE", "BIN", "MOBILE"] as const;
export type SerializedCustodyLocationType = (typeof SERIALIZED_CUSTODY_LOCATION_TYPES)[number];

export function isSerializedCustodyLocationType(value: unknown): value is SerializedCustodyLocationType {
  return typeof value === "string" && (SERIALIZED_CUSTODY_LOCATION_TYPES as readonly string[]).includes(value);
}

// Narrow an arbitrary location-type string (e.g. a ledger `LocationRef.type`, which carries six
// values) to a custody type. Returns null rather than throwing or substituting: the caller decides
// whether "not a custody location" is a refusal or an absence, and neither is decided by inventing a
// value here.
export function toSerializedCustodyLocationType(value: unknown): SerializedCustodyLocationType | null {
  return isSerializedCustodyLocationType(value) ? value : null;
}

export const SERIALIZED_ASSET_SCHEMA_VERSION = 1;

// The exact governed fields a `serialized_assets/{id}` document carries per §D, plus the provenance/audit
// fields this repo's other governed documents carry (see functions/src/inventoryReceiving/receivingTypes.ts's
// DeserializedReceivingOrder: createdAt/updatedAt/createdBy/updatedBy + a schemaVersion discriminator).
export interface SerializedAssetValue {
  readonly serialNo: string;
  readonly partId: string;
  readonly currentLocationId: string; // ledger-derived; §D's exact field name (scalar id, see header note)
  // The type half of the location pair. NULLABLE, and null means exactly one thing: NO WRITER STATED
  // IT. It is never a guess and never a default -- the same fail-closed nullability rule this contract
  // already applies to `currentEquipmentId`. Every writer of `currentLocationId` now stamps this
  // beside it, so null occurs only on documents written before the field existed; a reader that needs
  // the type must refuse those (see `readSerializedCustodyPair`) rather than assume one.
  readonly currentLocationType: SerializedCustodyLocationType | null;
  readonly inventoryState: SerializedAssetState;
  readonly currentEquipmentId: string | null; // NULLABLE, single-valued active install link
  readonly ownership: SerializedAssetOwnership;
}

export interface DeserializedSerializedAsset extends SerializedAssetValue {
  readonly id: string; // stored doc id
  readonly schemaVersion: number;
  readonly createdAtMillis: number;
  readonly createdByUid: string;
  readonly updatedAtMillis: number;
  readonly updatedByUid: string;
}

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T; readonly reason: null }
  | { readonly valid: false; readonly value: null; readonly reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
export function isSerializedAssetState(value: unknown): value is SerializedAssetState {
  return typeof value === "string" && (SERIALIZED_ASSET_STATES as readonly string[]).includes(value);
}
export function isSerializedAssetOwnership(value: unknown): value is SerializedAssetOwnership {
  return typeof value === "string" && (SERIALIZED_ASSET_OWNERSHIP_TYPES as readonly string[]).includes(value);
}
function isNullableEquipmentRef(value: unknown): value is string | null {
  return value === null || value === undefined || isNonEmptyString(value);
}

const VALUE_FIELDS = new Set(["serialNo", "partId", "currentLocationId", "currentLocationType", "inventoryState", "currentEquipmentId", "ownership"]);

// Validates the governed VALUE fields (§D identity) of a serialized asset -- fail closed. Unknown fields,
// wrong types, an unrecognized state/ownership, or a contradictory state<->link pairing are all rejected
// rather than normalized. Mirrors the INSTALLED<->link coupling rule already enforced by
// field-ops-app-vite/src/domain/serializedAssetIdentity.js's validateSerializedAssetIdentity: INSTALLED iff
// currentEquipmentId is set; any other state must carry currentEquipmentId === null. This is invariant #L
// ("no state is both INSTALLED and AVAILABLE" / never-concurrent) enforced at the document level.
export function validateSerializedAssetValue(input: unknown): ValidationResult<SerializedAssetValue> {
  if (!isPlainObject(input)) return { valid: false, value: null, reason: "not_object" };
  if (Object.keys(input).some((k) => !VALUE_FIELDS.has(k))) {
    return { valid: false, value: null, reason: "unknown_field" };
  }
  if (!isNonEmptyString(input.serialNo)) return { valid: false, value: null, reason: "serial_no_invalid" };
  if (!isNonEmptyString(input.partId)) return { valid: false, value: null, reason: "part_id_invalid" };
  if (!isNonEmptyString(input.currentLocationId)) return { valid: false, value: null, reason: "current_location_id_invalid" };
  // Absent/null is ACCEPTED and normalized to null (a pre-field document, honestly unknown). A present
  // value must be a real custody type -- an unrecognized one is a defect in a writer, not a document to
  // be repaired by substitution, so it is rejected outright.
  if (input.currentLocationType !== undefined && input.currentLocationType !== null
      && !isSerializedCustodyLocationType(input.currentLocationType)) {
    return { valid: false, value: null, reason: "current_location_type_invalid" };
  }
  if (!isSerializedAssetState(input.inventoryState)) return { valid: false, value: null, reason: "inventory_state_invalid" };
  if (!isNullableEquipmentRef(input.currentEquipmentId)) {
    return { valid: false, value: null, reason: "current_equipment_id_invalid" };
  }
  if (!isSerializedAssetOwnership(input.ownership)) return { valid: false, value: null, reason: "ownership_invalid" };

  const currentEquipmentId = isNonEmptyString(input.currentEquipmentId) ? input.currentEquipmentId : null;
  // Invariant (§D/§L): INSTALLED iff an active link exists. No successful state may leave a serial both
  // INSTALLED and AVAILABLE, and the link is never concurrent (single-valued, sequential-not-concurrent).
  if (input.inventoryState === "INSTALLED" && currentEquipmentId === null) {
    return { valid: false, value: null, reason: "installed_requires_link" };
  }
  if (input.inventoryState !== "INSTALLED" && currentEquipmentId !== null) {
    return { valid: false, value: null, reason: "link_requires_installed" };
  }

  return {
    valid: true,
    value: {
      serialNo: input.serialNo,
      partId: input.partId,
      currentLocationId: input.currentLocationId,
      currentLocationType: toSerializedCustodyLocationType(input.currentLocationType),
      inventoryState: input.inventoryState,
      currentEquipmentId,
      ownership: input.ownership,
    },
    reason: null,
  };
}

export function isSerializedAssetValue(input: unknown): input is SerializedAssetValue {
  return validateSerializedAssetValue(input).valid;
}

export interface SerializedCustodyPair {
  readonly type: SerializedCustodyLocationType;
  readonly locationId: string;
}

// THE TYPED PAIR, OR NOTHING. The single place this repository turns a stored serialized-asset
// document into a usable location. It is the rule "a bare id is never a location" made executable:
// both halves must be present and well-formed, or the answer is null and the caller fails closed.
//
// It deliberately does NOT resolve a missing type by looking the id up in the warehouse/bin/mobile
// registries. That lookup is a second canonicalization of location identity, it needs reads this
// contract does not perform, and the only governed id->type resolver in the repo
// (inventoryLocation/locationDisplayReadService.ts) is registered inactive. Inferring a type here
// would also re-create the exact defect this field was added to remove: a reader deciding, on its
// own, what kind of place an id names.
export function readSerializedCustodyPair(data: unknown): SerializedCustodyPair | null {
  if (!isPlainObject(data)) return null;
  const locationId = isNonEmptyString(data.currentLocationId) ? data.currentLocationId.trim() : null;
  if (locationId === null) return null;
  const type = toSerializedCustodyLocationType(data.currentLocationType);
  if (type === null) return null;
  return { type, locationId };
}

// AVAILABLE-for-Available-Equipment selector (§I): "in-stock serial units ... `currentEquipmentId` null".
// A well-formed asset is available for the Available Equipment read iff its state is AVAILABLE (the
// lifecycle state, not a general "not installed" test) AND currentEquipmentId is null. The value-level
// invariant above already guarantees these two facts never disagree for a valid document; this predicate
// re-asserts both defensively rather than trusting either alone.
// Typed on the two fields it actually reads, not on the whole value: the Available Equipment
// projection carries availability, not custody, and the predicate must not start demanding a
// location type it does not consult.
export function isAvailableForEquipmentRead(
  value: Pick<SerializedAssetValue, "inventoryState" | "currentEquipmentId">,
): boolean {
  return value.inventoryState === "AVAILABLE" && value.currentEquipmentId === null;
}
