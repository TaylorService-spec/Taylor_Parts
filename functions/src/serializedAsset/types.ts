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
//     matching the governing Specification text exactly -- while the projection below additionally exposes
//     a `currentLocation` reference (`{ type, locationId }`, itself resolved via a second trusted read of
//     the Location authority) so composeAvailableEquipment's existing shape is NOT broken by this change.
//     This is a real, pre-existing naming inconsistency between the Specification and the already-merged
//     pure module; this contract does not invent a resolution beyond exposing both. See the report for the
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

export const SERIALIZED_ASSET_SCHEMA_VERSION = 1;

// The exact governed fields a `serialized_assets/{id}` document carries per §D, plus the provenance/audit
// fields this repo's other governed documents carry (see functions/src/inventoryReceiving/receivingTypes.ts's
// DeserializedReceivingOrder: createdAt/updatedAt/createdBy/updatedBy + a schemaVersion discriminator).
export interface SerializedAssetValue {
  readonly serialNo: string;
  readonly partId: string;
  readonly currentLocationId: string; // ledger-derived; §D's exact field name (scalar id, see header note)
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

const VALUE_FIELDS = new Set(["serialNo", "partId", "currentLocationId", "inventoryState", "currentEquipmentId", "ownership"]);

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

// AVAILABLE-for-Available-Equipment selector (§I): "in-stock serial units ... `currentEquipmentId` null".
// A well-formed asset is available for the Available Equipment read iff its state is AVAILABLE (the
// lifecycle state, not a general "not installed" test) AND currentEquipmentId is null. The value-level
// invariant above already guarantees these two facts never disagree for a valid document; this predicate
// re-asserts both defensively rather than trusting either alone.
export function isAvailableForEquipmentRead(value: SerializedAssetValue): boolean {
  return value.inventoryState === "AVAILABLE" && value.currentEquipmentId === null;
}
