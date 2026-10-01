// The Equipment list over the governed EOS register (listEquipment -> eos_ops.equipment), in the metadata list's page
// contract ({ rows, hasMore, nextCursorDoc }) -- Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01. Never a
// Firestore `equipment` read. The SERVER decides the caller's reach (the operational register, or a seller's channel);
// the filters the register query understands (status, customer, site) are sent to it, the rest of the descriptor (sort,
// an IN status) is applied over that bounded, already-authorized result.
import { callEquipmentApi, EQUIPMENT_LIST_MAX, toEquipmentView } from "../services/equipmentApiClient.js";

/** Order rows by the descriptor's sort keys -- nulls last, text compared case-insensitively, ties by id. */
export function sortRows(rows, sort) {
  const keys = Array.isArray(sort) ? sort : [];
  const cmp = (a, b) => {
    for (const { fieldId, direction } of keys) {
      const x = a[fieldId] ?? null; const y = b[fieldId] ?? null;
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const d = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, undefined, { sensitivity: "base" }) : (x < y ? -1 : 1);
      if (d !== 0) return direction === "DESC" ? -d : d;
    }
    return String(a.id).localeCompare(String(b.id));
  };
  return [...rows].sort(cmp);
}

/** The bound one list read walks (EQUIPMENT_LIST_MAX per server page). Beyond it the list says it has more. */
export const EQUIPMENT_LIST_PAGES = 5;

export async function fetchPage(descriptor, { cursorDoc = null } = {}, call = callEquipmentApi) {
  const input = { limit: EQUIPMENT_LIST_MAX };
  const local = [];
  for (const f of descriptor?.filters ?? []) {
    if (f.operator === "EQUALS" && f.fieldId === "status") input.status = f.value;
    else if (f.operator === "EQUALS" && f.fieldId === "accountId") input.accountId = f.value;
    else if (f.operator === "EQUALS" && f.fieldId === "locationId") input.customerLocationId = f.value;
    else local.push(f);
  }
  const rows = [];
  let cursor;
  let more = false;
  for (let i = 0; i < EQUIPMENT_LIST_PAGES; i += 1) {
    const res = await call("listEquipment", cursor ? { ...input, cursor } : input);
    if (!res.ok) {
      throw Object.assign(new Error(res.message ?? "the Equipment register could not be read"), {
        code: res.code === "FORBIDDEN" ? "permission-denied" : res.code === "NOT_ACTIVATED" ? "unavailable" : "unavailable",
      });
    }
    rows.push(...(res.result?.equipment ?? []).map(toEquipmentView));
    cursor = res.result?.nextCursor ?? null;
    if (!cursor) break;
    more = i === EQUIPMENT_LIST_PAGES - 1;
  }
  let filtered = rows;
  for (const f of local) {
    if (f.operator === "IN") filtered = filtered.filter((r) => f.value.includes(r[f.fieldId]));
    else if (f.operator === "EQUALS") filtered = filtered.filter((r) => r[f.fieldId] === f.value);
  }
  const sorted = sortRows(filtered, descriptor?.sort?.length ? descriptor.sort : [{ fieldId: "name", direction: "ASC" }]);
  const pageSize = Number.isInteger(descriptor?.pageSize) ? descriptor.pageSize : 50;
  const offset = cursorDoc && Number.isInteger(cursorDoc.offset) ? cursorDoc.offset : 0;
  const page = sorted.slice(offset, offset + pageSize);
  const next = offset + page.length;
  const hasMore = next < sorted.length || more;
  return { rows: Object.freeze(page), hasMore, nextCursorDoc: next < sorted.length ? { offset: next } : null };
}
