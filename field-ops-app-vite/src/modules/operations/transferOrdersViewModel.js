// Enterprise Inventory -- EI-P1c-2 pure Operations Transfer-Orders view-model builder.
//
// PURE and DETERMINISTIC: no Firebase import, no reads, no writes. It maps the raw
// transfer_orders records the Operations dashboard already loaded into location-aware
// display rows, applying the merged EI-P1c-1 adapter (toTransferRef) so invalid or
// contradictory records NEVER become rows -- they are counted, not rendered. Node-
// importable and unit-tested directly (test/transferOrdersViewModel.test.mjs).
//
// AUTHORITATIVE DOC ID: each record's `id` is the real Firestore document id
// (operationsQueries.listCollection guarantees the doc id always wins over any stored
// `id`), and it is passed as the SEPARATE docId argument to toTransferRef -- a stored
// data.id can never override it.
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

// Build the location-aware Transfer Orders view. Returns { rows, hiddenInvalidCount };
// rows are sorted deterministically by transferOrderId and carry ONLY display fields
// (no quantity, timestamps, tracking mode, or serial membership).
export function buildTransferOrdersView(transferOrders, warehouses) {
  const nameMap = warehouseNameMap(warehouses);
  const list = Array.isArray(transferOrders) ? transferOrders : [];
  const rows = [];
  let hiddenInvalidCount = 0;

  for (const record of list) {
    if (record === null || typeof record !== "object") {
      hiddenInvalidCount += 1;
      continue;
    }
    // `record.id` is the authoritative Firestore document id (see module header).
    const result = toTransferRef(record.id, record);
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
