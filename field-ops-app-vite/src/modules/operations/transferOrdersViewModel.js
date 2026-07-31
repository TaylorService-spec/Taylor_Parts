// Enterprise Inventory -- EI-P1c-2 pure Operations Transfer-Orders view-model builder.
//
// PURE and DETERMINISTIC: no Firebase import, no reads, no writes. It maps the raw
// transfer_orders records the Operations dashboard already loaded into location-aware
// display rows, applying the merged EI-P1c-1 adapter (toTransferRef) so invalid or
// contradictory records NEVER become rows -- they are counted, not rendered. Node-
// importable and unit-tested directly (test/transferOrdersViewModel.test.mjs).
//
// AUTHORITATIVE DOC ID: input is a list of { docId, data } pairs (from
// operationsQueries.fetchTransferOrderDocs), where docId is the real Firestore document id
// kept SEPARATE from the stored data. toTransferRef(docId, data) therefore still sees a
// conflicting stored data.id and fails closed (stored_id_conflict) -- that record is
// counted, never rendered.
//
// LABELS (no N+1, never fabricated): WAREHOUSE endpoints resolve from the already-loaded
// warehouse list (one map, zero extra reads); a missing warehouse falls back to the raw
// id. BIN/MOBILE/VENDOR/CUSTOMER have no governed label authority yet, so they carry the
// raw locationId (the panel shows a type badge). No static/fabricated names.
import { toTransferRef } from "../../domain/transferOrderView.js";

function warehouseNameMap(warehouses) {
  const map = new Map();
  if (Array.isArray(warehouses)) {
    for (const w of warehouses) {
      if (w && typeof w === "object" && typeof w.id === "string" && typeof w.name === "string") {
        map.set(w.id, w.name);
      }
    }
  }
  return map;
}

// One endpoint's display view: { type, locationId, label }. WAREHOUSE resolves its name
// from the map (raw-id fallback); every other type carries the raw locationId only.
function endpointView(ref, nameMap) {
  const label = ref.type === "WAREHOUSE" ? nameMap.get(ref.locationId) ?? ref.locationId : ref.locationId;
  return { type: ref.type, locationId: ref.locationId, label };
}

// Build the location-aware Transfer Orders view from { docId, data } pairs. Returns
// { rows, hiddenInvalidCount }; rows are sorted deterministically by transferOrderId and
// carry ONLY display fields (no quantity, timestamps, tracking mode, or serial membership).
export function buildTransferOrdersView(transferOrderDocs, warehouses) {
  const nameMap = warehouseNameMap(warehouses);
  const list = Array.isArray(transferOrderDocs) ? transferOrderDocs : [];
  const rows = [];
  let hiddenInvalidCount = 0;

  for (const entry of list) {
    if (entry === null || typeof entry !== "object") {
      hiddenInvalidCount += 1;
      continue;
    }
    // docId is the authoritative Firestore document id, kept separate from data so a
    // conflicting stored data.id fails closed inside the adapter.
    const result = toTransferRef(entry.docId, entry.data);
    if (!result.valid) {
      hiddenInvalidCount += 1;
      continue;
    }
    const ref = result.value;
    rows.push({
      transferOrderId: ref.transferOrderId,
      partId: ref.partId,
      status: ref.status,
      origin: endpointView(ref.origin, nameMap),
      destination: endpointView(ref.destination, nameMap),
    });
  }

  rows.sort((a, b) => (a.transferOrderId < b.transferOrderId ? -1 : a.transferOrderId > b.transferOrderId ? 1 : 0));
  return { rows, hiddenInvalidCount };
}
