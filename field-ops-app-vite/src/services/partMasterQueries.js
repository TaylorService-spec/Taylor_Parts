// INV-1 Phase 1, PR 1.9 -- read-only Part Master client service. One-shot
// authorized read of `parts` (Rules: admin/dispatcher read-only; ALL
// client writes denied). Imports ONLY read APIs; performs no writes; reads
// no inventory quantities (stock truth stays the ledger); never invokes
// the PR 1.6 resolver, PR 1.7 snapshot module, or PR 1.8 tooling.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { toPartListView } from "../domain/partMasterView";

const PARTS_COLLECTION = "parts";

/** Fetch the governed Part Master list view. Deterministic errors:
 * resolves { ok:true, parts, invalid } or { ok:false, code } where code is
 * "permission-denied" (access denied by Rules) or "unavailable". */
export async function fetchPartMasterList() {
  try {
    const snap = await getDocs(collection(db, PARTS_COLLECTION));
    const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    return { ok: true, ...toPartListView(docs) };
  } catch (err) {
    const code = err && err.code === "permission-denied" ? "permission-denied" : "unavailable";
    return { ok: false, code };
  }
}
