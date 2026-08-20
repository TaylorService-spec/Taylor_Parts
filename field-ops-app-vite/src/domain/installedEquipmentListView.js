// INV-EQ-P1b -- pure, node-testable view-model for the cross-customer installed
// Equipment list (the Customer Equipment tab). PURE: no firebase, no persistence.
// It validates loaded page docs, composes display rows with resolved account/
// location names, applies the LOADED-ONLY optional filters, and derives the coarse
// render state. Firebase paging + bounded name reads live in the injectable hook
// (hooks/useInstalledEquipmentPage.js); this module never reads or writes anything.
import { normalizeEquipmentStatus, equipmentDisplayName, searchEquipment } from "./equipment.js";

// Filters here narrow only what has been LOADED so far -- they are not a global
// search over the whole collection. The UI must state this plainly.
export const LOADED_ONLY_FILTER_NOTE =
  "Filters apply to the Equipment loaded so far, not a global search. Use Load more to fetch more.";

export const LIST_STATE = Object.freeze({
  LOADING: "loading", // first page in flight, nothing shown yet
  DENIED: "denied", // read not permitted (fail closed)
  UNAVAILABLE: "unavailable", // load failed before any rows (fail closed)
  EMPTY: "empty", // loaded, but nothing to show (no rows, or filters exclude all)
  PARTIAL: "partial", // rows shown, but a later page failed (keep rows + retry)
  READY: "ready",
});

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

// A loaded page doc is usable only with a real id + owning accountId. Everything
// else is optional/normalized; a malformed doc is SKIPPED, never rendered.
export function isValidEquipmentDoc(doc) {
  return (
    doc !== null &&
    typeof doc === "object" &&
    !Array.isArray(doc) &&
    isNonEmptyString(doc.id) &&
    isNonEmptyString(doc.accountId)
  );
}

export function validEquipmentDocs(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.filter(isValidEquipmentDoc);
}

// The DISTINCT account / location ids present in the loaded docs, for the hook to
// resolve names via BOUNDED batched reads (no unbounded map, no per-row query).
export function collectAccountIds(docs) {
  return distinct(validEquipmentDocs(docs).map((d) => d.accountId));
}
export function collectLocationIds(docs) {
  return distinct(validEquipmentDocs(docs).map((d) => d.locationId).filter(isNonEmptyString));
}
function distinct(values) {
  return Array.from(new Set(values));
}

// Resolve a name map that may be a Map or a plain object. An unresolved name returns null,
// NOT the id.
//
// This used to fall back to the id, justified in its own comment as "never a blank cell, so
// an unresolved name degrades gracefully". That is the escape clause DECISIONS #106 refuses,
// and it is the fourth place in this codebase found doing it (after the Opportunity pipeline,
// warehousesView and suppliersView). A document id is not a degraded name -- it is a
// different kind of thing, and showing one tells the reader something false about the record.
// Null lets the caller render an honest placeholder or its own "Unresolved reference" state.
function resolveName(nameMap, id) {
  if (!isNonEmptyString(id)) return null;
  if (nameMap instanceof Map) return nameMap.get(id) ?? null;
  if (nameMap && typeof nameMap === "object" && isNonEmptyString(nameMap[id])) return nameMap[id];
  return null;
}

// LOADED-ONLY optional filters. accountId is an equality filter this module owns;
// term/locationId/status are delegated to the shared searchEquipment (which also
// orders the result). Only well-formed options are passed through; an omitted/empty
// filter means "no filter". Fail-closed: a malformed status yields no rows (matching
// searchEquipment's deliberate asymmetry), never a broadened answer.
export function applyLoadedFilters(docs, { accountId = null, locationId = null, status = null, term = "" } = {}) {
  let rows = validEquipmentDocs(docs);
  if (isNonEmptyString(accountId)) rows = rows.filter((d) => d.accountId === accountId);
  const options = {};
  if (typeof term === "string" && term.trim() !== "") options.term = term;
  if (isNonEmptyString(locationId)) options.locationId = locationId;
  if (isNonEmptyString(status)) options.status = status;
  return searchEquipment(rows, options);
}

// Compose render-ready rows (safe display fields + resolved names). Never exposes a
// raw doc; an unresolved name falls back to the id.
export function composeEquipmentRows(docs, { accountNames = null, locationNames = null } = {}) {
  return validEquipmentDocs(docs).map((d) => ({
    id: d.id,
    displayName: equipmentDisplayName(d),
    accountId: d.accountId,
    accountName: resolveName(accountNames, d.accountId),
    locationId: isNonEmptyString(d.locationId) ? d.locationId : null,
    locationName: isNonEmptyString(d.locationId) ? resolveName(locationNames, d.locationId) : null,
    status: normalizeEquipmentStatus(d.status),
    serialNumber: isNonEmptyString(d.serialNumber) ? d.serialNumber : null,
  }));
}

// The single, ordered composition the tab renders: filter loaded docs, then compose
// rows with names. Returns { rows }.
export function buildInstalledEquipmentRows(docs, { filters = {}, accountNames = null, locationNames = null } = {}) {
  const filtered = applyLoadedFilters(docs, filters);
  return { rows: composeEquipmentRows(filtered, { accountNames, locationNames }) };
}

// Coarse render state (fail-closed order). `docsCount` is loaded valid docs;
// `filteredCount` is what survives the loaded-only filters.
export function deriveListState({ loading = false, denied = false, error = false, docsCount = 0, filteredCount = 0, partialError = false } = {}) {
  if (denied) return LIST_STATE.DENIED;
  if (loading && docsCount === 0) return LIST_STATE.LOADING;
  if (error && docsCount === 0) return LIST_STATE.UNAVAILABLE;
  if (docsCount === 0) return LIST_STATE.EMPTY;
  if (filteredCount === 0) return LIST_STATE.EMPTY;
  if (partialError) return LIST_STATE.PARTIAL;
  return LIST_STATE.READY;
}
