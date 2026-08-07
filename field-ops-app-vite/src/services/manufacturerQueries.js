// Manufacturer -- read-only client service. One-shot authorized read of `manufacturers`. NOTE: the
// `manufacturers` collection is currently Rules-closed (read,write: if false). The governed read-authority
// decision is DEFERRED to the Owner (the minimum answer is isAdminOrDispatcher() like `suppliers`, but
// adding it grows the R-1 legacy-surface convergence baseline -- a separately-governed decision). Until it
// is resolved + deployed, this read FAILS CLOSED to permission-denied and the workspace shows a
// read-disabled (denied) state. Imports ONLY read APIs; performs no writes.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { toManufacturerListView } from "../domain/manufacturersView";

const MANUFACTURERS_COLLECTION = "manufacturers";

/** Resolves { ok:true, manufacturers, invalid } or { ok:false, code } where code is "permission-denied"
 * (Rules-closed / access denied) or "unavailable". */
export async function fetchManufacturerList() {
  try {
    const snap = await getDocs(collection(db, MANUFACTURERS_COLLECTION));
    const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    return { ok: true, ...toManufacturerListView(docs) };
  } catch (err) {
    const code = err && err.code === "permission-denied" ? "permission-denied" : "unavailable";
    return { ok: false, code };
  }
}
