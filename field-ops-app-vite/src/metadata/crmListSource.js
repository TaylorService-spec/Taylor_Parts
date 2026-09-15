// The list source for the Customers (Account) index, served by the governed PostgreSQL CRM authority through the EOS API
// (listAccounts). CRM CUTOVER: no Firestore query and no fallback.
//
// listAccounts orders by folded name (then id) and filters by status only. This source serves EXACTLY that and REFUSES
// anything else rather than silently returning a differently-ordered or wider page: a sort other than name, or a filter
// other than status EQUALS / IN, throws, and the list renders its unavailable state.
import { accountRowFromCrm, callCrmApi } from "../services/crmApiClient.js";

export class CrmListUnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = "CrmListUnsupportedError";
    this.code = "unsupported";
  }
}

export function toListAccountsInput(descriptor, cursor = null) {
  const input = { limit: Math.min(descriptor.pageSize, 200) };
  for (const f of descriptor.filters ?? []) {
    if (f.fieldId === "status" && (f.operator === "EQUALS" || f.operator === "IN")) input.status = f.value;
    else throw new CrmListUnsupportedError(`filter ${f.fieldId} ${f.operator} is not served by the CRM list`);
  }
  for (const s of descriptor.sort ?? []) {
    const nameOrder = (s.fieldId === "name" || s.fieldId === "__name__") && s.direction !== "DESC";
    if (!nameOrder) throw new CrmListUnsupportedError(`sort ${s.fieldId} ${s.direction} is not served by the CRM list`);
  }
  if (cursor) input.cursor = cursor;
  return input;
}

/** Same page contract as firestoreListSource.fetchPage: { rows, hasMore, nextCursorDoc }. */
export async function fetchPage(descriptor, { cursorDoc = null } = {}, call = callCrmApi) {
  const res = await call("listAccounts", toListAccountsInput(descriptor, cursorDoc));
  if (!res.ok) throw Object.assign(new Error(res.message), { code: res.code === "CAPABILITY_REQUIRED" || res.code === "FORBIDDEN" ? "permission-denied" : "unavailable" });
  return { rows: Object.freeze(res.result.items.map(accountRowFromCrm)), hasMore: res.result.truncated, nextCursorDoc: res.result.nextCursor };
}
