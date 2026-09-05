// Imported Service History -- the client SEAM.
//
// Thin, like every other callable seam here: `firebase` stays out of the view model and out of
// the unit tests, and this resolves rather than rejects so a section renders an honest state
// instead of throwing inside a customer page.
//
// `imported_service_history` is deny-all in firestore.rules, so there is no client query to
// write even if somebody wanted one. The trusted read is the only path, and it decides what
// leaves the server.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const CALLABLE = "listImportedServiceHistory";

/**
 * Read one customer's imported historical service.
 *
 * Resolves `{ ok, rows, truncated }` or `{ ok: false, code }`. `denied` is kept DISTINCT from
 * a general failure: "you may not see this" and "this could not be read" are different facts
 * about the same empty space, and a section that showed one for the other would be lying about
 * which one to go and fix.
 */
export async function fetchImportedServiceHistory(accountId, limit) {
  try {
    const res = await httpsCallable(functions, CALLABLE)({ accountId, limit });
    const data = res?.data ?? {};
    return {
      ok: true,
      rows: Array.isArray(data.rows) ? data.rows : [],
      truncated: data.truncated === true,
    };
  } catch (err) {
    const code = err?.code === "permission-denied" ? "denied" : "error";
    return { ok: false, code, rows: [], truncated: false };
  }
}
