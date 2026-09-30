// The list source for the Work Orders index, served by the GOVERNED EOS Work Order route
// (services/workOrderService.ts -> listWorkOrders). WORK ORDER CUTOVER: no Firestore query and no fallback.
//
// WHAT THE GOVERNED READ CAN AND CANNOT DO -- and how each is honoured rather than approximated:
//   - Filters: status EQUALS / IN and customerId EQUALS map onto listWorkOrders { statuses, customerId }.
//     Anything else REFUSES (throws), and the list renders its unavailable state.
//   - Bound: one read returns at most 200 rows plus an explicit `truncated` flag. There is NO cursor.
//   - Order: the server orders by scheduledStart (nulls last), priority, createdAt DESC. There is NO sort
//     parameter. So a requested sort is applied CLIENT-SIDE over the bounded read -- which is exact only
//     when the read was NOT truncated. A truncated read under a client-side sort would present a partial
//     set as if it were the first page of the whole order, so it REFUSES instead (narrow with a status or
//     customer filter). A scheduledStart ASC sort IS the server's own primary order and is served even
//     when truncated, with the end of the bound reported as "more exist" and never passed off as the end.
// Pages are cut client-side from the one bounded read; the cursor is an offset into it.
import { listWorkOrders } from "../services/workOrderService";

export const WORK_ORDER_LIST_READ_BOUND = 200;

export class WorkOrderListUnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkOrderListUnsupportedError";
    this.code = "unsupported";
  }
}

/** The governed listWorkOrders input for a metadata descriptor. Pure; throws on anything not served. */
export function toListWorkOrdersInput(descriptor) {
  const input = { limit: WORK_ORDER_LIST_READ_BOUND };
  for (const f of descriptor?.filters ?? []) {
    if (f.fieldId === "status" && f.operator === "IN") input.statuses = [...f.value];
    else if (f.fieldId === "status" && f.operator === "EQUALS") input.statuses = [f.value];
    else if (f.fieldId === "customerId" && f.operator === "EQUALS") input.customerId = f.value;
    else throw new WorkOrderListUnsupportedError(`filter ${f.fieldId} ${f.operator} is not served by the governed Work Order list`);
  }
  return input;
}

const sortValue = (row, fieldId) => {
  if (fieldId === "__name__" || fieldId === "id") return row.id;
  const v = row[fieldId];
  if (v && typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
  return v ?? null;
};

/** Is this sort the server's own primary order (so a truncated read is still the true head of it)? */
const isServerOrder = (sort) => (sort ?? []).length > 0 && sort[0].fieldId === "scheduledStart" && sort[0].direction !== "DESC";

export function sortRows(rows, sort) {
  const clauses = (sort ?? []).filter((s) => s && s.fieldId);
  return [...rows].sort((a, b) => {
    for (const { fieldId, direction } of clauses) {
      const av = sortValue(a, fieldId);
      const bv = sortValue(b, fieldId);
      if (av === bv) continue;
      // Missing values sort last in either direction -- as the server orders a missing scheduledStart.
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = av < bv ? -1 : 1;
      return direction === "DESC" ? -cmp : cmp;
    }
    return 0;
  });
}

/** Same page contract as firestoreListSource.fetchPage: { rows, hasMore, nextCursorDoc }. */
export async function fetchPage(descriptor, { cursorDoc = null } = {}, list = listWorkOrders) {
  const input = toListWorkOrdersInput(descriptor);
  let res;
  try {
    res = await list(input);
  } catch (err) {
    const code = err?.code;
    throw Object.assign(new Error(err?.message ?? "the Work Order list could not be read"), {
      code: code === "FORBIDDEN" || code === "UNAUTHENTICATED" || code === "NOT_SIGNED_IN" ? "permission-denied" : "unavailable",
      reason: code ?? null,
    });
  }
  const serverOrder = isServerOrder(descriptor?.sort);
  if (res.truncated && !serverOrder) {
    throw new WorkOrderListUnsupportedError(
      `more than ${WORK_ORDER_LIST_READ_BOUND} Work Orders match; the governed list cannot order them by this sort. Narrow with a status or customer filter.`,
    );
  }
  const sorted = serverOrder ? res.items : sortRows(res.items, descriptor?.sort);
  const pageSize = Number.isInteger(descriptor?.pageSize) ? descriptor.pageSize : 50;
  const offset = cursorDoc && Number.isInteger(cursorDoc.offset) ? cursorDoc.offset : 0;
  if (offset >= sorted.length && res.truncated) {
    throw new WorkOrderListUnsupportedError(`the governed Work Order list ends at ${WORK_ORDER_LIST_READ_BOUND} rows; narrow the filter to see more`);
  }
  const rows = sorted.slice(offset, offset + pageSize);
  const next = offset + rows.length;
  const hasMore = next < sorted.length || res.truncated;
  return { rows: Object.freeze(rows), hasMore, nextCursorDoc: hasMore ? { offset: next } : null };
}
