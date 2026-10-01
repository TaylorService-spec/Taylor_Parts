// The Supplier list over the governed EOS read (listSuppliers -> eos_ops.suppliers), in the metadata list's page contract
// ({ rows, hasMore, nextCursorDoc }) -- the Supplier master is PostgreSQL's, so the list never reads Firestore `suppliers`.
// The read is tenant-wide and bounded (1000); status filters and sorts are applied over that bounded set.
import { fetchSupplierList } from "../services/partsOperationsReads.js";
import { sortRows } from "./workOrderListSource.js";

export async function fetchPage(descriptor, { cursorDoc = null } = {}, list = fetchSupplierList) {
  let items;
  try {
    items = await list();
  } catch (err) {
    throw Object.assign(new Error(err?.message ?? "the Supplier list could not be read"), { code: err?.code === "FORBIDDEN" ? "permission-denied" : "unavailable" });
  }
  let rows = items;
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
