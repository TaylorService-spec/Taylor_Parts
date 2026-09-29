// ONE PAGE OF THE PART MASTER, through the GOVERNED RENDER CATALOG API.
//
//   PartMasterList -> THIS -> partMasterQueries.searchPartsInServerOrder / countParts -> catalogApiClient
//                  -> POST /operations/catalog -> PostgreSQL
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md §8, §18.
//
// ============================ THE DEFECT THIS CLOSES ============================
//
// Until the Catalog activation candidate, this module handed the metadata descriptor to
// `metadata/firestoreListSource.fetchPage` -- i.e. the routed Part Master administration screen READ
// FIRESTORE, while its creates and edits already went to PostgreSQL. After activation (Firestore
// catalogue frozen) a Part created on this screen would never have appeared in this screen's own
// list. The runtime census had it as DEAD, because the file names `parts` only as a label; the read
// was two hops away.
//
// ============================ NO FALLBACK, IN ANY FORM ============================
//
// A refused or failed Catalog call is returned as a value and the screen renders it. There is no
// "try Render, then Firestore", and this module imports nothing from Firebase or from the Firestore
// list source. A fallback would work in every test and, in production, quietly keep the retired
// authority answering for exactly the requests that failed.
//
// ============================ WHAT IS TRANSLATED, AND WHAT IS NOT ============================
//
// The descriptor still comes from the canonical runtime (`metadata/listRuntime.buildQueryDescriptor`),
// which decides which filters are legal, bounds the page and makes the order total. This module
// translates that descriptor into the SERVER's governed query vocabulary and nothing more:
//
//   filters  status / stockingClass, EQUALS -> `status` / `stockingClass`, IN -> `statuses` / `stockingClasses`
//   sort     the first non-tiebreaker clause -> `sort: { field, direction }`; the server appends the
//            id tiebreaker in the same direction, exactly as the runtime's `__name__` did
//   bound    `pageSize` -> `limit`; `hasMore` is the server's own answer (a next cursor exists)
//
// A descriptor this module cannot translate is REFUSED as `INVALID_INPUT` rather than executed
// without the part it could not express -- a broader list labelled as the narrower one is the worst
// available outcome.
//
// `toPartListView` still SEPARATES malformed records from valid ones (inside `searchPartsInServerOrder`), which is
// why this read exists beside the generic list source: a catalogue-administration surface has to be
// able to say "9 records need review".
import { searchPartsInServerOrder, countParts, isCatalogReadRefused } from "./partMasterQueries.js";

/** The descriptor fields the server can filter by, and the wire keys for EQUALS and IN. */
const FILTER_KEYS = Object.freeze({
  status: Object.freeze({ EQUALS: "status", IN: "statuses" }),
  stockingClass: Object.freeze({ EQUALS: "stockingClass", IN: "stockingClasses" }),
});

/** The metadata tiebreaker names the document id; on the server that is the Part id. */
const TIEBREAKERS = new Set(["__name__", "partId", "id"]);

/** Descriptor sort fields the server can order by (see postgresCatalogReads PART_SEARCH_SORT_FIELDS). */
const SORT_FIELDS = new Set(["internalPartNumber", "status", "name", "stockingClass", "createdAt", "updatedAt"]);

const untranslatable = (message) => ({ ok: false, code: "INVALID_INPUT", message });

/**
 * The descriptor's FILTERS, in the server's vocabulary. `{ ok:true, filters }` or a refusal.
 * Exported for the count and for tests.
 */
export function partSearchFiltersFromDescriptor(descriptor) {
  const filters = {};
  for (const f of descriptor?.filters ?? []) {
    const key = FILTER_KEYS[f.fieldId]?.[f.operator];
    if (!key) return untranslatable(`the Catalog cannot filter "${f.fieldId}" by ${f.operator}`);
    if (filters[FILTER_KEYS[f.fieldId].EQUALS] !== undefined || filters[FILTER_KEYS[f.fieldId].IN] !== undefined) {
      // Two clauses on one field would be an intersection the server does not take. Refused, not
      // silently reduced to one of them.
      return untranslatable(`more than one filter on "${f.fieldId}"`);
    }
    if (f.operator === "IN" && !Array.isArray(f.value)) return untranslatable(`"${f.fieldId}" IN needs a list`);
    filters[key] = f.operator === "IN" ? [...f.value] : f.value;
  }
  return { ok: true, filters };
}

/** The descriptor's SORT, in the server's vocabulary: `{ ok:true, sort }` or a refusal. */
export function partSearchSortFromDescriptor(descriptor) {
  const clauses = descriptor?.sort ?? [];
  const primary = clauses.filter((s) => !TIEBREAKERS.has(s.fieldId));
  if (primary.length > 1) return untranslatable("the Catalog orders by one field and the Part id");
  if (primary.length === 0) {
    // Only the tiebreaker: an id order, in its stated direction.
    const tie = clauses.find((s) => TIEBREAKERS.has(s.fieldId));
    return { ok: true, sort: { field: "id", direction: tie?.direction === "DESC" ? "DESC" : "ASC" } };
  }
  const [s] = primary;
  if (!SORT_FIELDS.has(s.fieldId)) return untranslatable(`the Catalog cannot sort by "${s.fieldId}"`);
  return { ok: true, sort: { field: s.fieldId, direction: s.direction === "DESC" ? "DESC" : "ASC" } };
}

/**
 * Fetch one page described by a bounded query descriptor.
 *
 * @param descriptor from metadata/listRuntime.buildQueryDescriptor
 * @param cursor     the `nextCursor` from a previous call under the SAME descriptor (an opaque
 *                   server keyset token; the server refuses it under any other sort)
 * @param deps       `{ client }` -- the Catalog client seam, for tests
 *
 * Resolves `{ ok:true, parts, invalid, hasMore, nextCursor }` or `{ ok:false, code, message? }`,
 * where `code` is the Catalog client's category (FORBIDDEN, NOT_SIGNED_IN, UNAVAILABLE, UNREACHABLE,
 * NOT_CONFIGURED, INVALID_INPUT, ...). `isPartMasterReadDenied(code)` says which of those is a denial.
 */
export async function fetchPartMasterPage({ descriptor = null, cursor = null } = {}, deps = {}) {
  if (!descriptor) return { ok: false, code: "UNAVAILABLE" };
  const f = partSearchFiltersFromDescriptor(descriptor);
  if (!f.ok) return f;
  const s = partSearchSortFromDescriptor(descriptor);
  if (!s.ok) return s;
  // IN THE SERVER'S ORDER: the page was asked for a sort, and re-sorting it here would undo it.
  const res = await searchPartsInServerOrder({
    ...f.filters,
    sort: s.sort,
    limit: descriptor.pageSize,
    ...(cursor ? { cursor } : {}),
  }, deps);
  if (!res.ok) return { ok: false, code: res.code ?? "UNAVAILABLE", ...(res.message ? { message: res.message } : {}) };
  return {
    ok: true,
    parts: res.parts,
    invalid: res.invalid,
    // "There is more" is the server's answer -- it read one row beyond the page -- never a guess
    // from how many rows came back.
    hasMore: res.nextCursor !== null && res.nextCursor !== undefined,
    nextCursor: res.nextCursor ?? null,
  };
}

/**
 * The Part Master TOTAL over the same filters the page executes -- the count `useListViewChrome`
 * is given for this screen. A number, or null on ANY failure: never 0 for a read that did not answer.
 *
 * Module-level and stable on purpose: the hook keys its effect on this function's identity.
 */
export async function countPartMaster(descriptor, deps = {}) {
  const f = partSearchFiltersFromDescriptor(descriptor);
  if (!f.ok) return null;
  const res = await countParts(deps, f.filters);
  return res.ok && Number.isSafeInteger(res.total) ? res.total : null;
}

/** A refusal (as opposed to an outage) of the Part Master read -- the screen's "denied" state. */
export const isPartMasterReadDenied = (code) => isCatalogReadRefused(code);
