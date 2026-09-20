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
 * A bounded, searchable page of the catalogue.
 *
 * `filters` are GOVERNED query vocabulary the SERVER understands -- `status`, `controlType`,
 * `wholeUnit`. They are passed through and applied in PostgreSQL. Filtering in the browser would
 * mean fetching everything first, which is the behaviour this module exists to stop.
 */
export async function searchParts({ query = "", status, controlType, wholeUnit, limit, cursor } = {}, deps = {}) {
  const client = deps.client ?? catalogApiClient;
  const res = await client.call("searchParts", {
    query,
    ...(status === undefined ? {} : { status }),
    ...(controlType === undefined ? {} : { controlType }),
    ...(wholeUnit === undefined ? {} : { wholeUnit }),
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined || cursor === null ? {} : { cursor }),
  });
  if (!res.ok) return res;
  const page = res.result ?? { parts: [], nextCursor: null };
  // The SAME pure view mapping the Firestore reader used, so the screens are unchanged by the move.
  return { ok: true, ...toPartListView((page.parts ?? []).map((p) => ({ id: p.id, data: p }))), nextCursor: page.nextCursor ?? null };
}

/** How many Parts this tenant holds, for a screen that shows a total without listing it. */
export async function countParts(deps = {}) {
  const client = deps.client ?? catalogApiClient;
  const res = await client.call("countParts", {});
  return res.ok ? { ok: true, total: res.result ?? 0 } : res;
}

/**
 * The surfaces that USED to read the whole `parts` collection, and what each asks now.
 *
 * Kept as a record rather than deleted: it is the list this cutover had to answer, and naming the
 * replacement for each is what makes "nothing still fetches everything" checkable.
 */
export const PART_CATALOGUE_WHOLE_COLLECTION_READ_RETIRED = Object.freeze({
  "hooks/useCanonicalPartNames": "readPartsByIds(exact ids)",
  "modules/receiving/ReceiveAgainstPurchaseOrder": "searchParts (bounded picker)",
  "modules/workOrders/WorkOrderPartsPlanEditor": "searchParts (bounded picker)",
  "modules/inventoryRole/WarehouseManagerHome": "searchParts (bounded)",
  "modules/inventory/PartsList": "searchParts + countParts",
  "modules/inventory/PartDetail": "readPart(partId)",
});
