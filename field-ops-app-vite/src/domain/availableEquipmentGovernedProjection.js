// Available Equipment -- pure mapper from the TRUSTED `getAvailableEquipment` callable's raw
// envelope (functions/src/serializedAsset/serializedAssetReadService.ts's AvailableEquipmentReadResult:
// { status: "ready", availableEquipment: SerializedAssetProjection[], excludedCount }) into the flat
// asset-row shape domain/availableEquipmentCatalogView.js's composeAvailableRows already consumes
// (serialNo, partId, currentEquipmentId, availableForAssignment, plus optional display fields).
// PURE: no firebase, no persistence, no network. Node-importable and unit-tested directly
// (test/availableEquipmentGovernedProjection.test.mjs).
//
// LOCATION-SHAPE DISCREPANCY (documented, deliberately NOT resolved here -- see
// functions/src/serializedAsset/types.ts's header and the Part 3 report for the full callout):
// the trusted read returns only the ledger-derived SCALAR `currentLocationId` -- the Specification's
// exact §D field name -- never a `{ type, locationId }` reference and never a resolved display label
// (Location descriptive authority, including `type`, is a separate authority this read service does
// not read). The existing pure client identity module's `composeAvailableEquipment()`
// (domain/serializedAssetIdentity.js) instead REQUIRES a `{ type, locationId }` currentLocation
// reference matched against a Location display record carrying `type` + `label` -- a shape this
// trusted projection cannot satisfy without FABRICATING `type`, which this mapper refuses to do.
// Consequence, stated plainly: this mapper does NOT call composeAvailableEquipment and does NOT
// invent a location type or a friendly label. It surfaces the raw, authoritative `currentLocationId`
// scalar as the row's `location` field -- real, governed data, just not a resolved display name. If a
// governed Location-display read is added later, resolving the friendly label is a follow-up, not a
// blocker to shipping this projection.
//
// PART DESCRIPTIVE FIELDS (internalPartNumber/category/manufacturer/model) are Part Master's own
// authority (functions/src/partMaster/*) and are intentionally NOT joined here -- the trusted read
// returns none of them (see serializedAssetReadService.ts's header: "no Part descriptive join"),
// matching composeAvailableEquipment's own design of requiring them injected separately. Rows render
// with `partId` as their internal-identifier fallback (availableEquipmentCatalogView.js's
// composeAvailableRow already does this for any asset missing internalPartNumber) rather than a
// fabricated description.
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// currentEquipmentId is NULLABLE: null/undefined (not installed) OR a non-empty string. Anything else
// is malformed and the row is dropped -- fail closed, never guessed.
function normalizeEquipmentId(value) {
  if (value === null || value === undefined) return null;
  return isNonEmptyString(value) ? value : undefined; // undefined signals "malformed"
}

// Re-derives availableForAssignment from the projection's own governed fields rather than trusting
// the server's query filter alone -- the same "never trust the query filter alone" discipline
// serializedAssetReadService.ts itself already applies before including a row in its response.
function deriveAvailableForAssignment(inventoryState, currentEquipmentId) {
  return inventoryState === "AVAILABLE" && currentEquipmentId === null;
}

// Maps one raw projection row (the callable's SerializedAssetProjection shape) into the flat asset
// shape domain/serializedAssetInstallation.js's validateSerializedAsset / isAvailableSerial and
// domain/availableEquipmentCatalogView.js's composeAvailableRow already understand. Returns null for
// any malformed row -- fail closed, never fabricated into a row.
export function mapProjectionRowToAsset(row) {
  if (!isPlainObject(row)) return null;
  if (!isNonEmptyString(row.serialNo) || !isNonEmptyString(row.partId)) return null;
  const currentEquipmentId = normalizeEquipmentId(row.currentEquipmentId);
  if (currentEquipmentId === undefined) return null; // malformed currentEquipmentId
  return {
    serialNo: row.serialNo,
    partId: row.partId,
    currentEquipmentId,
    availableForAssignment: deriveAvailableForAssignment(row.inventoryState, currentEquipmentId),
    status: typeof row.inventoryState === "string" && row.inventoryState.trim() !== "" ? row.inventoryState : null,
    // Raw, authoritative location id -- see this file's header for why no friendly label/type exists.
    location: isNonEmptyString(row.currentLocationId) ? row.currentLocationId : null,
  };
}

// Maps the full callable envelope into the flat assets[] array the Available Equipment domain/view
// layer consumes. A non-"ready" status, a missing/malformed envelope, or a non-array
// availableEquipment field yields an empty array (fail closed) -- this function never throws and
// never returns a placeholder row.
export function mapAvailableEquipmentProjectionToAssets(rawResult) {
  if (!isPlainObject(rawResult)) return [];
  if (rawResult.status !== "ready" || !Array.isArray(rawResult.availableEquipment)) return [];
  const assets = [];
  for (const row of rawResult.availableEquipment) {
    const asset = mapProjectionRowToAsset(row);
    if (asset) assets.push(asset);
  }
  return assets;
}
