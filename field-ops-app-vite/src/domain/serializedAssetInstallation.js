// INV-EQ-P1a -- pure, inert domain layer for the Serialized Asset <-> installed
// Equipment INSTALLATION LINK and the Available/Customer read composition, per the
// Rev 6 Specification (docs/specifications/serialized-asset-equipment-installation.md)
// under ADR-010 + DECISIONS #59.
//
// SCOPE (deliberate, fail-closed): this module is PURE and DETERMINISTIC. It has NO
// firebase import, performs NO persistence, and authors NO stock/quantity/movement/
// ledger/Location/custody authority. It only models -- over INJECTED, contract-shaped
// inputs -- the cross-authority installation LINK (its validators, invariants, and
// proposed transitions) plus the read-only Available-vs-Customer selectors and the
// unified-timeline composition. Serialized Asset persistence, the inventory ledger,
// Locations, and Equipment writes remain their own authorities (Enterprise Inventory +
// ADR-006); this module consumes them as external contracts and never reimplements them.
//
// It therefore requires NONE of the unbuilt Enterprise Inventory phases to exist: it
// operates on the shapes those authorities will supply. Node-importable and unit-tested
// directly (test/serializedAssetInstallation.test.mjs), matching the codebase's
// "pure logic lives in domain/" convention (equipment.js, adminPasswordReset.js).

// ---------------------------------------------------------------------------
// Small, fail-closed primitives
// ---------------------------------------------------------------------------

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// currentEquipmentId is NULLABLE: null/undefined (not installed) OR a non-empty
// string (the ACTIVE installation). Anything else (number, "", object) is invalid.
export function isNullableEquipmentRef(value) {
  return value === null || value === undefined || isNonEmptyString(value);
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// ---------------------------------------------------------------------------
// Rejection reasons (bounded, explicit; a foreign reason cannot be produced)
// ---------------------------------------------------------------------------

export const LINK_REJECT = Object.freeze({
  INVALID_INPUT: "invalid-input",
  ALREADY_INSTALLED: "already-installed", // concurrent-link attempt
  NOT_INSTALLED: "not-installed",
  LINK_MISMATCH: "link-mismatch", // non-reciprocal serial<->equipment
  NO_PRIOR_INSTALL: "no-prior-install", // redeploy requires a prior sequential install
  SAME_EQUIPMENT: "same-equipment", // a serial may never (re)attach to a prior Equipment record
  SAME_SERIAL: "same-serial", // replacement must be a DIFFERENT serial from the retiring one
  HISTORY_OPEN: "history-open", // redeploy requires the prior history to end uninstalled
  INSTALLED_AND_AVAILABLE: "installed-and-available", // invariant violation
});

export const LINK_ACTION = Object.freeze({
  INSTALL: "install",
  UNINSTALL: "uninstall",
  REDEPLOY: "redeploy",
  REPLACE: "replace",
});
const LINK_ACTIONS = Object.freeze(Object.values(LINK_ACTION));

// ---------------------------------------------------------------------------
// Shape validation (fail-closed) -- injected contract shapes, NOT persisted docs
// ---------------------------------------------------------------------------

// A Serialized Asset summary as this domain consumes it. `availableForAssignment`
// is an EI-UPSTREAM-derived boolean (this module never computes stock availability);
// `currentEquipmentId` is the single-valued nullable active link.
export function validateSerializedAsset(asset) {
  const errors = [];
  if (!isPlainObject(asset)) return { ok: false, errors: ["asset must be a plain object"] };
  if (!isNonEmptyString(asset.serialNo)) errors.push("serialNo");
  if (!isNonEmptyString(asset.partId)) errors.push("partId");
  if (!isNullableEquipmentRef(asset.currentEquipmentId)) errors.push("currentEquipmentId");
  if (!("availableForAssignment" in asset) || typeof asset.availableForAssignment !== "boolean") {
    errors.push("availableForAssignment");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// An installed-Equipment record (ADR-006) as consumed here: it carries the immutable
// back-reference `serializedAssetId` (the linked serial) once installed.
export function validateEquipmentRecord(equipment) {
  const errors = [];
  if (!isPlainObject(equipment)) return { ok: false, errors: ["equipment must be a plain object"] };
  if (!isNonEmptyString(equipment.id)) errors.push("id");
  // serializedAssetId is nullable (an equipment not linked to a serial is possible for
  // legacy records that stay unlinked), but when present must be a non-empty string.
  if (!(equipment.serializedAssetId === null || equipment.serializedAssetId === undefined || isNonEmptyString(equipment.serializedAssetId))) {
    errors.push("serializedAssetId");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Predicates + invariants (fail-closed)
// ---------------------------------------------------------------------------

// Installed iff currentEquipmentId is an explicit non-empty string. A malformed asset
// is NOT treated as installed (fail closed).
export function isInstalled(asset) {
  return isPlainObject(asset) && isNonEmptyString(asset.currentEquipmentId);
}

// Available-for-assignment iff NOT installed AND the EI-derived flag is explicitly true.
// This module never infers availability from stock; it only combines the injected flag
// with the link state. A malformed asset is never available.
export function isAvailableSerial(asset) {
  return validateSerializedAsset(asset).ok && !isInstalled(asset) && asset.availableForAssignment === true;
}

// INVARIANT: a serial may never be simultaneously installed AND available stock.
// Returns true when the forbidden combination is present.
export function violatesInstalledAndAvailable(asset) {
  return isInstalled(asset) && asset && asset.availableForAssignment === true;
}

// A well-formed asset never violates the installed-and-available invariant.
export function assetInvariantHolds(asset) {
  return validateSerializedAsset(asset).ok && !violatesInstalledAndAvailable(asset);
}

// One Equipment <-> one serial: the link is RECIPROCAL. equipment.serializedAssetId
// points to asset.serialNo AND asset.currentEquipmentId points to equipment.id.
export function isReciprocalLink(asset, equipment) {
  if (!validateSerializedAsset(asset).ok || !validateEquipmentRecord(equipment).ok) return false;
  return (
    isInstalled(asset) &&
    asset.currentEquipmentId === equipment.id &&
    equipment.serializedAssetId === asset.serialNo
  );
}

// ---------------------------------------------------------------------------
// Transition validation (PURE) -- validates a PROPOSED link transition and returns
// the resulting link intent. It NEVER persists, NEVER writes a ledger entry, and
// NEVER mutates the input. The trusted Function (a later, separately authorized gate)
// is the only thing that may enact a validated transition atomically.
// ---------------------------------------------------------------------------

function reject(reason) {
  return { ok: false, reason };
}

// INSTALL: a not-yet-installed serial -> a NEW Equipment. Sequential-not-concurrent:
// if the serial already has a current link, this fails closed (ALREADY_INSTALLED).
export function validateInstall(asset, { equipmentId } = {}) {
  if (!validateSerializedAsset(asset).ok) return reject(LINK_REJECT.INVALID_INPUT);
  if (!isNonEmptyString(equipmentId)) return reject(LINK_REJECT.INVALID_INPUT);
  if (isInstalled(asset)) return reject(LINK_REJECT.ALREADY_INSTALLED); // concurrent link forbidden
  return { ok: true, action: LINK_ACTION.INSTALL, resultingCurrentEquipmentId: equipmentId };
}

// UNINSTALL: an installed serial -> link cleared (currentEquipmentId = null).
export function validateUninstall(asset) {
  if (!validateSerializedAsset(asset).ok) return reject(LINK_REJECT.INVALID_INPUT);
  if (!isInstalled(asset)) return reject(LINK_REJECT.NOT_INSTALLED);
  return { ok: true, action: LINK_ACTION.UNINSTALL, resultingCurrentEquipmentId: null };
}

// REDEPLOY: a returned/repaired serial (currently NOT installed) that has at least one
// PRIOR install in its immutable history is installed again into a NEW Equipment record.
// Sequential over time; still never concurrent.
export function validateRedeploy(asset, { equipmentId, linkHistory = [] } = {}) {
  if (!validateSerializedAsset(asset).ok) return reject(LINK_REJECT.INVALID_INPUT);
  if (!isNonEmptyString(equipmentId)) return reject(LINK_REJECT.INVALID_INPUT);
  if (isInstalled(asset)) return reject(LINK_REJECT.ALREADY_INSTALLED);
  if (!Array.isArray(linkHistory)) return reject(LINK_REJECT.INVALID_INPUT);
  // The history must be a VALID sequential (single-serial, non-concurrent) record...
  if (!isSequentialHistory(linkHistory)) return reject(LINK_REJECT.INVALID_INPUT);
  // ...for THIS serial...
  if (linkHistory.length > 0 && linkHistory[0].serialNo !== asset.serialNo) return reject(LINK_REJECT.LINK_MISMATCH);
  // ...with at least one prior install...
  if (countInstalls(linkHistory) < 1) return reject(LINK_REJECT.NO_PRIOR_INSTALL);
  // ...that ENDS uninstalled (no still-open link)...
  if (deriveCurrentEquipmentId(linkHistory) !== null) return reject(LINK_REJECT.HISTORY_OPEN);
  // ...and the redeployment target must be a genuinely NEW Equipment, never a prior one.
  if (priorEquipmentIds(linkHistory).includes(equipmentId)) return reject(LINK_REJECT.SAME_EQUIPMENT);
  return { ok: true, action: LINK_ACTION.REDEPLOY, resultingCurrentEquipmentId: equipmentId };
}

// REPLACEMENT: the OLD Equipment is retired/uninstalled and a NEW Equipment record is
// created for a REPLACEMENT serial. A new serial is NEVER attached to the existing
// Equipment record: newEquipmentId must differ from the old Equipment id. Records the
// REPLACES / REPLACED_BY relationship between the two Equipment records.
export function validateReplacement({ oldAsset, oldEquipment, newAsset, newEquipmentId } = {}) {
  if (!validateSerializedAsset(newAsset).ok || !isNonEmptyString(newEquipmentId)) {
    return reject(LINK_REJECT.INVALID_INPUT);
  }
  if (!validateEquipmentRecord(oldEquipment).ok) return reject(LINK_REJECT.INVALID_INPUT);
  // The old side must be a genuine reciprocal installation being replaced.
  if (!isReciprocalLink(oldAsset, oldEquipment)) return reject(LINK_REJECT.LINK_MISMATCH);
  // The replacement must be a genuinely DIFFERENT serial from the one being retired.
  if (newAsset.serialNo === oldAsset.serialNo) return reject(LINK_REJECT.SAME_SERIAL);
  // A new serial may never re-use the existing Equipment record.
  if (newEquipmentId === oldEquipment.id) return reject(LINK_REJECT.SAME_EQUIPMENT);
  if (isInstalled(newAsset)) return reject(LINK_REJECT.ALREADY_INSTALLED);
  return {
    ok: true,
    action: LINK_ACTION.REPLACE,
    retireEquipmentId: oldEquipment.id,
    install: { serialNo: newAsset.serialNo, equipmentId: newEquipmentId },
    relationship: Object.freeze({ REPLACES: oldEquipment.id, REPLACED_BY: newEquipmentId }),
  };
}

// ---------------------------------------------------------------------------
// Immutable installation-link history (PURE modelling; append-only by contract)
// ---------------------------------------------------------------------------

// Fail-closed, ACTION-SPECIFIC entry validity: install/redeploy/replace MUST carry a
// valid equipmentId; uninstall MUST NOT carry one (null/absent). serialNo and a
// non-negative integer seq are always required. Cross-entry serial consistency is
// enforced at the history level (isSequentialHistory).
function isLinkEntry(entry) {
  if (!isPlainObject(entry)) return false;
  if (!LINK_ACTIONS.includes(entry.action)) return false;
  if (!isNonEmptyString(entry.serialNo)) return false;
  if (!(Number.isInteger(entry.seq) && entry.seq >= 0)) return false;
  if (entry.action === LINK_ACTION.UNINSTALL) {
    return entry.equipmentId === null || entry.equipmentId === undefined;
  }
  return isNonEmptyString(entry.equipmentId);
}

// The equipmentIds a serial has EVER been linked to (install/redeploy/replace),
// in order. Malformed entries are skipped (they already fail isSequentialHistory).
export function priorEquipmentIds(linkHistory) {
  if (!Array.isArray(linkHistory)) return [];
  const ids = [];
  for (const e of linkHistory) {
    if (isLinkEntry(e) && e.action !== LINK_ACTION.UNINSTALL) ids.push(e.equipmentId);
  }
  return ids;
}

// Count every INSTALLING action -- install, redeploy, AND replace (all open a link;
// only uninstall closes one). Counting the same non-uninstall set as priorEquipmentIds
// keeps the two consistent: a replacement-installed serial has a genuine prior install.
export function countInstalls(linkHistory) {
  if (!Array.isArray(linkHistory)) return 0;
  return linkHistory.filter((e) => isLinkEntry(e) && e.action !== LINK_ACTION.UNINSTALL).length;
}

// The next monotonic sequence number for an append. Fail-closed to 0 on a malformed history.
export function nextLinkSeq(linkHistory) {
  if (!Array.isArray(linkHistory) || linkHistory.length === 0) return 0;
  let max = -1;
  for (const e of linkHistory) {
    if (!isLinkEntry(e)) return NaN; // malformed history -> caller must fail closed
    if (e.seq > max) max = e.seq;
  }
  return max + 1;
}

// Sequential-not-concurrent AND single-serial: seq strictly increasing with no gaps;
// at most ONE open installation at any point (every install/redeploy/replace is closed
// by an uninstall before the next opens); and EVERY entry shares one consistent serialNo.
// Fail-closed on any malformed entry, mixed serial, gap, or concurrent link.
export function isSequentialHistory(linkHistory) {
  if (!Array.isArray(linkHistory)) return false;
  let expected = 0;
  let open = false; // is there a currently-open installation?
  let serial = null; // the one serial this history may reference
  for (const e of linkHistory) {
    if (!isLinkEntry(e) || e.seq !== expected) return false;
    if (serial === null) serial = e.serialNo;
    else if (e.serialNo !== serial) return false; // mixed serial across the history
    if (e.action === LINK_ACTION.INSTALL || e.action === LINK_ACTION.REDEPLOY || e.action === LINK_ACTION.REPLACE) {
      if (open) return false; // concurrent link
      open = true;
    } else if (e.action === LINK_ACTION.UNINSTALL) {
      if (!open) return false; // uninstall without an open link
      open = false;
    }
    expected += 1;
  }
  return true;
}

// Derive the current active Equipment link from an ordered history: the equipmentId of
// the last install/redeploy/replace not yet followed by an uninstall, else null.
// Returns undefined (fail-closed) on a non-sequential/malformed history.
export function deriveCurrentEquipmentId(linkHistory) {
  if (!isSequentialHistory(linkHistory)) return undefined;
  let current = null;
  for (const e of linkHistory) {
    if (e.action === LINK_ACTION.UNINSTALL) current = null;
    else current = isNonEmptyString(e.equipmentId) ? e.equipmentId : null;
  }
  return current;
}

// Build an immutable link-history entry to append (the caller persists it elsewhere).
export function buildLinkEntry({ action, serialNo, equipmentId = null, seq, at = null, reason = null, context = null } = {}) {
  if (!LINK_ACTIONS.includes(action) || !isNonEmptyString(serialNo) || !Number.isInteger(seq) || seq < 0) {
    return { ok: false, reason: LINK_REJECT.INVALID_INPUT };
  }
  // Action-specific equipmentId rule, matching isLinkEntry: uninstall carries none;
  // install/redeploy/replace REQUIRE a valid equipmentId (fail closed, never silently null).
  const resolvedEquipmentId = action === LINK_ACTION.UNINSTALL ? null : equipmentId;
  if (action !== LINK_ACTION.UNINSTALL && !isNonEmptyString(resolvedEquipmentId)) {
    return { ok: false, reason: LINK_REJECT.INVALID_INPUT };
  }
  const entry = Object.freeze({ action, serialNo, equipmentId: resolvedEquipmentId, seq, at, reason, context });
  return { ok: true, entry };
}

// ---------------------------------------------------------------------------
// Read-composition selectors (PURE; read-only) -- Available reads Serialized Assets,
// Customer reads installed Equipment. Malformed records are skipped (fail closed).
// ---------------------------------------------------------------------------

export function selectAvailableSerializedAssets(assets) {
  if (!Array.isArray(assets)) return [];
  return assets.filter((a) => isAvailableSerial(a));
}

export function selectCustomerEquipment(equipmentRecords, { accountId, locationId } = {}) {
  if (!Array.isArray(equipmentRecords) || !isNonEmptyString(accountId)) return [];
  return equipmentRecords.filter((e) => {
    if (!validateEquipmentRecord(e).ok) return false;
    if (e.accountId !== accountId) return false;
    if (isNonEmptyString(locationId) && e.locationId !== locationId) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Unified timeline composition (PURE, read-only) -- interleaves INVENTORY-authority
// events with SERVICE-authority events into one chronology WITHOUT copying fields
// across authorities or producing a merged record. Every composed row keeps its
// `source` authority tag; the two authorities are never blended.
// ---------------------------------------------------------------------------

export const TIMELINE_SOURCE = Object.freeze({ INVENTORY: "inventory", SERVICE: "service" });

function toTimelineRow(source, event) {
  if (!isPlainObject(event)) return null;
  const at = typeof event.at === "number" ? event.at : null;
  if (at === null) return null; // an undated event cannot be placed on a timeline (fail closed)
  return Object.freeze({ source, at, kind: isNonEmptyString(event.kind) ? event.kind : null, ref: event });
}

export function composeUnifiedTimeline({ inventoryEvents = [], serviceEvents = [] } = {}) {
  const rows = [];
  if (Array.isArray(inventoryEvents)) {
    for (const e of inventoryEvents) {
      const row = toTimelineRow(TIMELINE_SOURCE.INVENTORY, e);
      if (row) rows.push(row);
    }
  }
  if (Array.isArray(serviceEvents)) {
    for (const e of serviceEvents) {
      const row = toTimelineRow(TIMELINE_SOURCE.SERVICE, e);
      if (row) rows.push(row);
    }
  }
  // Stable chronological order; ties keep insertion order (inventory before service).
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.at - b.row.at) || (a.i - b.i))
    .map(({ row }) => row);
}
