// Serialized Asset Registry — foundation slice 1 of N. The serial-identity
// PROJECTION/MIGRATION contract between the future governed registry
// (`domain/serializedAssetIdentity.js`'s `serialNo`, keyed by a `serializedAssetId`
// once the `serialized_assets` collection exists) and Equipment's existing free-text
// `serialNumber` field.
//
// Corrected per Owner/ChatGPT review of the initial architecture pass: DO NOT simply
// replace Equipment.serialNumber with a `serializedAssetId` FK. There are two source
// states an Equipment record can be in, and both must render honestly, never silently
// upgraded or downgraded into looking like the other:
//   • LINKED   — Equipment carries a real `serializedAssetId` pointing at a registry
//     record. The registry's `serialNo` is authoritative; it is what displays.
//   • LEGACY   — Equipment carries only the free-text `serialNumber` it always has
//     (no registry exists yet, or this specific unit predates it / was never linked).
//     That value is preserved AS-IS and rendered with an explicit "not verified
//     against the serial registry" disclosure — never silently presented as if it
//     were a governed registry serial.
// Search/filter callers can treat the projected `displaySerial` as one plain string
// either way; only a record's own detail view needs the `verified` distinction.
//
// PURE: no Firebase, no persistence, no I/O. Node-importable and unit-tested.

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export const EQUIPMENT_SERIAL_SOURCE = Object.freeze({
  REGISTRY: "registry",
  LEGACY: "legacy",
  NONE: "none",
});

// `equipment` supplies { serializedAssetId, serialNumber } (the two fields Equipment
// itself owns today plus the future FK). `registryAsset` is the OPTIONAL, injected,
// already-validated serialized asset identity (domain/serializedAssetIdentity.js's
// `value` shape) for that serializedAssetId — the caller is responsible for the
// actual lookup; this module never reaches into Firestore or any read model itself.
//
// Fails closed to LEGACY (not REGISTRY) whenever the link is claimed but the injected
// registry record doesn't actually back it up (missing, or a mismatched serialNo) —
// a broken/stale link must never silently present as a verified registry serial.
export function projectEquipmentSerial({ equipment, registryAsset } = {}) {
  const equipmentSerialNumber = isNonEmptyString(equipment?.serialNumber) ? equipment.serialNumber : null;
  const serializedAssetId = isNonEmptyString(equipment?.serializedAssetId) ? equipment.serializedAssetId : null;

  if (serializedAssetId && registryAsset && isNonEmptyString(registryAsset.serialNo)) {
    return {
      displaySerial: registryAsset.serialNo,
      source: EQUIPMENT_SERIAL_SOURCE.REGISTRY,
      verified: true,
      serializedAssetId,
    };
  }

  if (equipmentSerialNumber) {
    return {
      displaySerial: equipmentSerialNumber,
      source: EQUIPMENT_SERIAL_SOURCE.LEGACY,
      verified: false,
      serializedAssetId: null,
    };
  }

  return {
    displaySerial: null,
    source: EQUIPMENT_SERIAL_SOURCE.NONE,
    verified: false,
    serializedAssetId: null,
  };
}
