// Part Master client reads, through the GOVERNED RENDER CATALOG API.
//
//   browser -> services/catalogApiClient.js -> POST /operations/catalog -> PostgreSQL
//
// and never browser -> Firestore. There is no fallback here of any kind: a refused or failed read is
// returned as a value the caller renders.
//
// ════════════════════ WHAT CHANGED, AND WHY IT IS NOT A PORT ════════════════════
//
// This module used to own exactly one read: the WHOLE `parts` collection, because seven surfaces
// each needed "every part" and a silent first page would have produced a wrong ANSWER rather than a
// slow one. That reasoning was correct about Firestore and is the wrong shape to carry across.
//
// Re-exposing a fetch-all over HTTP would have moved the cost one hop further away and added a
// server paying for it too. So each caller was mapped to the question it actually asks, and the
// answers are three BOUNDED operations:
//
//   readPart(partId)          one Part -- Part Detail
//   readPartsByIds(ids)       the ids a page already holds -- canonical name resolution
//   searchParts(...)          a bounded, searchable, keyset-paged page -- lists and pickers
//
// `fetchPartMasterList` is deliberately GONE rather than reimplemented. A function with that name
// backed by a paged API would either lie about completeness or loop until it had everything, and
// both are worse than making each caller say what it needs.
import { catalogApiClient } from "./catalogApiClient.js";
import { toPartListView } from "../domain/partMasterView";

/**
 * A canonical Catalog record as the `{ id, data }` document `toPartListView` validates.
 *
 * THE CANONICAL RECORD CARRIES ITS IDENTITY AS `id`; the view's validity gate reads `partId` and
 * requires it to equal the document id (the Firestore rule that a stored partId must match its
 * document). Handing the canonical record over as-is therefore failed that gate for EVERY Part the
 * Render Catalog API returned, and every one of them was reported "malformed". In PostgreSQL the Part
 * id is one column, so `partId` IS `id` by construction; a record that states a DIFFERENT partId is
 * still passed through unchanged and is still refused by the gate.
 */
const viewDocOf = (p) => ({ id: p?.id, data: p && p.partId === undefined ? { ...p, partId: p.id } : p });
const toView = (parts) => toPartListView((parts ?? []).map(viewDocOf));

/** `{ ok:true, part }` or `{ ok:false, code, message }`. A missing Part is `ok:true, part:null`. */
export async function fetchPart(partId, deps = {}) {
  const client = deps.client ?? catalogApiClient;
  const res = await client.call("readPart", { partId });
  return res.ok ? { ok: true, part: res.result ?? null } : res;
}

/**
 * Resolve the canonical names of ids a caller ALREADY holds.
 *
 * The bounded replacement for "load the catalogue and look them up": the resolver knows exactly
 * which ids it needs, and asking for those is the whole difference.
 */
export async function fetchPartsByIds(partIds, deps = {}) {
  const ids = [...new Set((partIds ?? []).filter((id) => typeof id === "string" && id.trim() !== ""))];
  if (ids.length === 0) return { ok: true, parts: [] };
  const client = deps.client ?? catalogApiClient;
  const res = await client.call("readPartsByIds", { partIds: ids });
  return res.ok ? { ok: true, parts: res.result ?? [] } : res;
}

/**
 * The EXACT Parts a caller names, in the SAME view shape `searchParts` returns (`{ ok, parts, invalid }`).
 *
 * For a surface that makes an EXISTENCE claim about a specific Part -- a detail page, a receipt resolving
 * the Part it is receiving. Such a surface must never answer "not found" from a page of the catalogue: a
 * Part outside the first page would read as missing. Asking for the ids is the whole difference.
 */
export async function readPartsForView(partIds, deps = {}) {
  const res = await fetchPartsByIds(partIds, deps);
  if (!res.ok) return res;
  return { ok: true, ...toView(res.parts) };
}

/** A refusal (as opposed to an outage) from the Catalog client. The client never returns Firestore's "permission-denied". */
export const isCatalogReadRefused = (code) => code === "FORBIDDEN" || code === "NOT_SIGNED_IN";

/**
 * The governed filter keys the SERVER understands. Only these are forwarded, and only when stated:
 * an absent key is absent on the wire, so a caller that never named a filter asks exactly the
 * question it asked before these existed.
 */
const SEARCH_FILTER_KEYS = Object.freeze([
  "status", "statuses", "stockingClass", "stockingClasses", "controlType", "wholeUnit",
]);
const statedFilters = (input) => Object.fromEntries(
  SEARCH_FILTER_KEYS.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]),
);

/**
 * A bounded, searchable page of the catalogue.
 *
 * `filters` are GOVERNED query vocabulary the SERVER understands -- `status` / `statuses`,
 * `stockingClass` / `stockingClasses`, `controlType`, `wholeUnit` -- passed through and applied (and
 * validated) in PostgreSQL. Filtering in the browser would mean fetching everything first, which is
 * the behaviour this module exists to stop.
 *
 * `sort` ({ field, direction }) is optional. Absent, the page is id-ordered exactly as every picker has
 * always had it; given, `nextCursor` is an opaque keyset token valid only under that same sort.
 */
export async function searchParts(input = {}, deps = {}) {
  const res = await callSearchParts(input, deps);
  if (!res.ok) return res;
  // The SAME pure view mapping the Firestore reader used, so the screens are unchanged by the move.
  return { ok: true, ...toView(res.page.parts), nextCursor: res.page.nextCursor ?? null };
}

/**
 * `searchParts`, with the valid Parts kept in the SERVER's order.
 *
 * `toPartListView` sorts by part number, which is right for the pickers (they asked for no order)
 * and wrong for a screen that asked the server for one: a "part number, descending" or "by status"
 * page would be re-sorted ascending by part number inside every page. The Part Master list uses this.
 */
export async function searchPartsInServerOrder(input = {}, deps = {}) {
  const res = await callSearchParts(input, deps);
  if (!res.ok) return res;
  const rank = new Map((res.page.parts ?? []).map((p, i) => [p?.id, i]));
  const view = toView(res.page.parts);
  const parts = [...view.parts].sort((a, b) => rank.get(a.partId) - rank.get(b.partId));
  return { ok: true, parts, invalid: view.invalid, nextCursor: res.page.nextCursor ?? null };
}

async function callSearchParts({ query = "", limit, cursor, sort, ...filters } = {}, deps = {}) {
  const client = deps.client ?? catalogApiClient;
  const res = await client.call("searchParts", {
    query,
    ...statedFilters(filters),
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined || cursor === null ? {} : { cursor }),
    ...(sort === undefined || sort === null ? {} : { sort }),
  });
  if (!res.ok) return res;
  return { ok: true, page: res.result ?? { parts: [], nextCursor: null } };
}

/**
 * How many Parts this tenant holds, for a screen that shows a total without listing it.
 *
 * `filters` takes the same governed keys `searchParts` does, so a total can be stated over exactly
 * the set a filtered list is showing. No filters: the whole tenant catalogue, as before.
 */
export async function countParts(deps = {}, filters = {}) {
  const client = deps.client ?? catalogApiClient;
  const res = await client.call("countParts", statedFilters(filters ?? {}));
  return res.ok ? { ok: true, total: res.result ?? 0 } : res;
}

/**
 * The surfaces that USED to read the whole `parts` collection, and what each asks now.
 *
 * Kept as a record rather than deleted: it is the list this cutover had to answer, and naming the
 * replacement for each is what makes "nothing still fetches everything" checkable.
 */
export const PART_CATALOGUE_WHOLE_COLLECTION_READ_RETIRED = Object.freeze({
  // EXISTENCE-PROVING: each says "not found" about one specific Part, so each reads that Part by id.
  "modules/receiving/ReceiveAgainstPurchaseOrder": "readPartsForView(the received Part's id)",
  "modules/inventory/PartDetail": "readPartsForView([partId])",
  // BOUNDED PAGE -- CARRIED LIMITATION (2026-09-28): these read the first page (searchParts, limit 100) and never
  // follow nextCursor. None of them claims a Part does not exist: the name resolver degrades to the raw partId, and
  // the lists/picker show what they fetched. A tenant with more than 100 Parts sees only the first 100 here until
  // each gains paging or search. Nonprod's catalogue after COPY is below that bound.
  "hooks/useCanonicalPartNames": "searchParts (bounded page)",
  "modules/workOrders/WorkOrderPartsPlanEditor": "searchParts (bounded page)",
  "modules/inventoryRole/WarehouseManagerHome": "searchParts (bounded page)",
  "modules/inventory/PartsList": "searchParts (bounded page)",
});
