// FIXTURE CATALOG SNAPSHOTS for the catalog cutover suites. Shaped exactly like what
// scripts/exportCatalogSnapshot.js writes: Firestore documents verbatim, Timestamps tagged as $timestamp. The part
// documents carry the legacy non-master fields the live estate carries (sku, unitOfMeasure, partTrackingMode) so
// the census has something real to report and the copy has something real to leave behind.

export const SANDBOX_PROJECT = "eos-platform-sandbox";

export const ts = (seconds, nanoseconds = 0) => ({ $timestamp: { seconds, nanoseconds } });

export function modelDoc(id, overrides = {}) {
  const [manufacturerId, modelNumber] = id.split("--");
  return {
    id,
    data: {
      equipmentModelId: id, manufacturerId, manufacturerName: `Manufacturer ${manufacturerId}`, modelNumber,
      displayName: `Model ${modelNumber}`, family: "FREEZER", subtype: null, revision: null, status: "ACTIVE",
      sourceAuthority: "MANUFACTURER_CATALOG", version: 3,
      createdAt: ts(1757000000, 123456000), createdBy: "legacy-uid-a", updatedAt: ts(1757000500, 654321000), updatedBy: "legacy-uid-b",
      ...overrides,
    },
  };
}

export function partDoc(id, overrides = {}) {
  return {
    id,
    data: {
      partId: id, sku: id, internalPartNumber: id, name: `Part ${id}`, category: "COMPRESSOR", status: "ACTIVE",
      stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
      flags: { expiryTracked: false, consumable: true, returnableCore: false },
      unitOfMeasure: "EA", partTrackingMode: "QUANTITY",
      version: 2, createdAt: ts(1757100000, 111111000), createdBy: "legacy-uid-a", updatedAt: ts(1757200000, 222222000), updatedBy: "legacy-uid-c",
      ...overrides,
    },
  };
}

export function wholeUnitPartDoc(id, equipmentModelId, overrides = {}) {
  return partDoc(id, {
    name: `Unit ${id}`, controlType: "SERIALIZED", wholeUnit: true, equipmentModelId,
    flags: { expiryTracked: false, consumable: false, returnableCore: false },
    primaryManufacturerId: "ACME", primaryManufacturerPartNumber: "acme-pn-1", oemStatus: "OEM", description: "a whole unit",
    ...overrides,
  });
}

export function snapshotOf({ parts = [], equipmentModels = [], projectId = SANDBOX_PROJECT } = {}) {
  return { format: "EOS_CATALOG_SNAPSHOT", version: 1, source: { firebaseProjectId: projectId, exportedAt: "2026-09-14T00:00:00.000Z" }, parts, equipmentModels };
}

/** A small, clean, copy-ready catalog: 3 models (one DRAFT, one RETIRED), 4 parts (one whole unit, one DRAFT). */
export function cleanSnapshot(projectId = SANDBOX_PROJECT) {
  return snapshotOf({
    projectId,
    equipmentModels: [
      modelDoc("ACME--CW-100"),
      modelDoc("ACME--CW-200", { status: "DRAFT", family: null }),
      modelDoc("KOLD--KX-9", { status: "RETIRED", revision: "B" }),
    ],
    parts: [
      partDoc("TST-1001"),
      partDoc("TST-1002", { status: "DRAFT", description: "" }),
      partDoc("TST-1003", { stockingClass: "NON_STOCK", flags: { expiryTracked: false, consumable: false, returnableCore: false } }),
      wholeUnitPartDoc("UNIT-CW-100", "ACME--CW-100"),
    ],
  });
}
