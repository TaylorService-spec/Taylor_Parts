// INV-1 Phase 1, PR 1.9 -- read-only Part Master client service. One-shot
// authorized read of `parts` (Rules: admin/dispatcher read-only; ALL
// client writes denied). Imports ONLY read APIs; performs no writes; reads
// no inventory quantities (stock truth stays the ledger); never invokes
// the PR 1.6 resolver, PR 1.7 snapshot module, or PR 1.8 tooling.
//
// ============================ PAGING IS OPT-IN, AS OF THE PARTS MIGRATION ============================
//
// This module now exposes TWO reads, and which one a caller gets is a decision it makes by name.
//
//   fetchPartMasterList   the whole collection. Unchanged, and deliberately so -- see its own note.
//   fetchPartMasterPage   ordered, LIMITED and cursored, with the filters the metadata declares
//                         server-executable applied AS QUERY CONSTRAINTS rather than as a pass over
//                         everything that came back.
//
// Mounting a filter UI over an unbounded fetch would have shipped the fetch-all anti-pattern with a
// nicer front end. Making the SHARED reader bounded so the list got paging for free would have been
// worse: it silently truncates six catalogue consumers that need every part.
import { collection, getDocs, limit, orderBy, query, startAfter, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { toPartListView } from "../domain/partMasterView";
import { OPERATOR } from "../domain/fieldMetadata";

const PARTS_COLLECTION = "parts";

/**
 * How many Parts one page holds.
 *
 * Bounded on purpose and deliberately modest: a page is what somebody reads before deciding, not a
 * download of the catalogue. Paging is cheap; a 20,000-document read is not.
 */
export const PARTS_PAGE_SIZE = 50;

/** The user-facing operators, translated to Firestore's. The UI never sees these symbols. */
const FIRESTORE_OP = Object.freeze({
  [OPERATOR.IS]: "==",
  [OPERATOR.IS_NOT]: "!=",
  [OPERATOR.IN]: "in",
  [OPERATOR.GREATER_THAN]: ">",
  [OPERATOR.LESS_THAN]: "<",
  [OPERATOR.STARTS_WITH]: ">=", // handled as a range pair below
});

/**
 * Build the constraint list from a query plan.
 *
 * Only plan entries the metadata marked SERVER-executable arrive here — `toQueryPlan` has already
 * separated out anything unsupported, so this function never has to decide what is queryable. It
 * translates, and nothing else.
 */
function constraintsFor(plan) {
  const constraints = [];
  for (const entry of plan?.server ?? []) {
    const { filter, field } = entry;
    if (filter.value === null || filter.value === undefined || filter.value === "") continue;

    if (filter.operator === OPERATOR.STARTS_WITH) {
      // A prefix range, which Firestore CAN do: >= "ABC" and < "ABD". Not a substring search, and
      // this deliberately does not pretend to be one.
      const prefix = String(filter.value);
      const upper = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
      constraints.push(where(field.id, ">=", prefix));
      constraints.push(where(field.id, "<", upper));
      continue;
    }
    const op = FIRESTORE_OP[filter.operator];
    if (!op) continue; // an operator with no translation is dropped rather than guessed at
    constraints.push(where(field.id, op, filter.value));
  }
  return constraints;
}

/**
 * Fetch the WHOLE governed Part Master list view. Unchanged.
 *
 * ============================ WHY THIS STAYED UNBOUNDED ============================
 *
 * The obvious move was to make this bounded and let every caller inherit paging. That is wrong here,
 * and finding out why was the useful part of this migration: this function is not a list reader, it is
 * the platform's CATALOGUE reader. Six surfaces depend on getting ALL of it --
 *
 *   - hooks/useCanonicalPartNames   resolves any partId a screen happens to mention
 *   - modules/scan/LookupScan       scans a number that could be any part in the catalogue
 *   - receiving/ReceiveAgainstPurchaseOrder + workOrders/WorkOrderPartsPlanEditor   part pickers
 *   - inventoryRole/WarehouseManagerHome   catalogue view
 *   - modules/inventory/PartDetail   composes one part's view through the shared composer
 *
 * -- and for every one of them a silent first page is worse than a slow read. A scanner that cannot
 * find part 51 reports the part does not exist. A name resolver missing a page renders a raw id. Those
 * are wrong ANSWERS, not slow ones, and nothing on screen would say so.
 *
 * So paging is opted INTO by name (fetchPartMasterPage) and never inherited. The remaining
 * whole-collection reads are a REAL and recorded gap -- PART_CATALOGUE_WHOLE_COLLECTION_READ -- and the
 * fix for each is a targeted read of its own (lookup by part number, a searched picker), not a page
 * size quietly imposed on a question that needs the whole catalogue.
 *
 * Resolves `{ ok:true, parts, invalid }` or `{ ok:false, code }` where code is "permission-denied"
 * (denied by Rules) or "unavailable".
 */
export async function fetchPartMasterList() {
  try {
    const snap = await getDocs(query(collection(db, PARTS_COLLECTION)));
    return { ok: true, ...toPartListView(snap.docs.map((d) => ({ id: d.id, data: d.data() }))) };
  } catch (err) {
    return { ok: false, code: err && err.code === "permission-denied" ? "permission-denied" : "unavailable" };
  }
}

/**
 * The surfaces still reading the whole `parts` collection, named rather than left implicit.
 *
 * Recorded so the count can only go down deliberately. Each entry wants a targeted read, and until it
 * has one this is what "Parts at scale" actually costs.
 */
export const PART_CATALOGUE_WHOLE_COLLECTION_READ = Object.freeze([
  "hooks/useCanonicalPartNames",
  "modules/scan/LookupScan",
  "modules/receiving/ReceiveAgainstPurchaseOrder",
  "modules/workOrders/WorkOrderPartsPlanEditor",
  "modules/inventoryRole/WarehouseManagerHome",
  "modules/inventory/PartsList",
  "modules/inventory/PartDetail",
]);

/**
 * Fetch ONE PAGE of the governed Part Master list view, for the structured Part list.
 *
 * @param plan    from domain/listQueryState.toQueryPlan. Absent means the default first page.
 * @param cursor  the `nextCursor` from a previous call.
 *
 * ORDER IS PRESERVED, NOT CHOSEN: `internalPartNumber` then `partId`, which is exactly what
 * `toPartListView` sorted by. The tie-break matters -- without it two parts sharing a number swap
 * places between reads, and a list that reorders itself is a list nobody trusts.
 *
 * Resolves `{ ok:true, parts, invalid, hasMore, nextCursor }` or `{ ok:false, code }`.
 */
export async function fetchPartMasterPage({ plan = null, cursor = null } = {}) {
  try {
    const pageSize = plan?.pageSize ?? PARTS_PAGE_SIZE;
    const sortField = plan?.sort?.field?.id ?? "internalPartNumber";
    const direction = plan?.sort?.direction ?? "asc";

    const constraints = [
      ...constraintsFor(plan),
      orderBy(sortField, direction),
      ...(sortField === "partId" ? [] : [orderBy("partId", "asc")]),
      // One document MORE than is shown, so "is there another page" is answered by the read rather
      // than guessed at from whether the page came back full.
      limit(pageSize + 1),
    ];
    if (cursor) constraints.push(startAfter(...cursor));

    const snap = await getDocs(query(collection(db, PARTS_COLLECTION), ...constraints));
    const all = snap.docs;
    const hasMore = all.length > pageSize;
    const page = hasMore ? all.slice(0, pageSize) : all;

    const view = toPartListView(page.map((d) => ({ id: d.id, data: d.data() })));
    const last = page[page.length - 1];
    return {
      ok: true,
      ...view,
      hasMore,
      // The cursor is the ordered field values of the last row, which is what startAfter consumes.
      nextCursor: hasMore && last
        ? (sortField === "partId" ? [last.get("partId")] : [last.get(sortField), last.get("partId")])
        : null,
    };
  } catch (err) {
    return { ok: false, code: err && err.code === "permission-denied" ? "permission-denied" : "unavailable" };
  }
}
