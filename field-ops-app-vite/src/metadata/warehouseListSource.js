// The Warehouse list over the governed EOS read (listInventoryWarehouses -> eos_ops.warehouses), in the metadata list's
// page contract ({ rows, hasMore, nextCursorDoc }) -- Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01:
// "the employee-visible real Taylor warehouse must come from eos_ops.warehouses; do not merge Firestore and PostgreSQL
// warehouse lists". The read is the caller's WAREHOUSE-scoped governed warehouses (fixtures excluded by the server);
// status filters and sorts are applied over that bounded set. Never a Firestore `warehouses` read.
import { listInventoryWarehouses } from "../services/inventoryLocationClient.js";
import { sortRows } from "./workOrderListSource.js";

/** One governed warehouse as the row the Warehouse definition describes (name, location = site label, status). */
export const toWarehouseRow = (w) => Object.freeze({
  id: w.warehouseId, warehouseId: w.warehouseId, name: w.name ?? null, location: w.siteLabel ?? null, status: w.status ?? null,
});

export async function fetchPage(descriptor, { cursorDoc = null } = {}, list = listInventoryWarehouses) {
  let items;
  try {
    items = await list();
  } catch (err) {
    throw Object.assign(new Error(err?.message ?? "the Warehouse list could not be read"), {
      code: err?.code === "permission-denied" || err?.code === "FORBIDDEN" ? "permission-denied" : "unavailable",
    });
  }
  let rows = items.map(toWarehouseRow);
  for (const f of descriptor?.filters ?? []) {
    if (f.fieldId === "status" && f.operator === "EQUALS") rows = rows.filter((r) => r.status === f.value);
    else if (f.fieldId === "status" && f.operator === "IN") rows = rows.filter((r) => f.value.includes(r.status));
  }
  const sorted = sortRows(rows, descriptor?.sort?.length ? descriptor.sort : [{ fieldId: "name", direction: "ASC" }]);
  const pageSize = Number.isInteger(descriptor?.pageSize) ? descriptor.pageSize : 50;
  const offset = cursorDoc && Number.isInteger(cursorDoc.offset) ? cursorDoc.offset : 0;
  const page = sorted.slice(offset, offset + pageSize);
  const next = offset + page.length;
  const hasMore = next < sorted.length;
  return { rows: Object.freeze(page), hasMore, nextCursorDoc: hasMore ? { offset: next } : null };
}
