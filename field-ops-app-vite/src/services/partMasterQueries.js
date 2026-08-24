// INV-1 Phase 1, PR 1.9 -- read-only Part Master client service. One-shot
// authorized read of `parts` (Rules: admin/dispatcher read-only; ALL
// client writes denied). Imports ONLY read APIs; performs no writes; reads
// no inventory quantities (stock truth stays the ledger); never invokes
// the PR 1.6 resolver, PR 1.7 snapshot module, or PR 1.8 tooling.
//
// ============================ PAGING IS OPT-IN, AND LIVES ELSEWHERE ============================
//
// This module owns exactly one read: the WHOLE `parts` collection. That is deliberate, and the
// reasoning is in `fetchPartMasterList`'s own note — seven surfaces need every part, and for each of
// them a silent first page produces a wrong ANSWER rather than a slow one.
//
// The bounded, cursored, index-verified page read is `services/partMasterPageQuery.js`, which takes a
// query descriptor from `metadata/listRuntime`. Paging is opted into BY NAME, never inherited.
//
// Mounting a filter UI over an unbounded fetch would ship the fetch-all anti-pattern with a nicer
// front end. Making this shared reader bounded so a list got paging for free would be worse.
import { collection, getDocs, query } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { toPartListView } from "../domain/partMasterView";

const PARTS_COLLECTION = "parts";

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
