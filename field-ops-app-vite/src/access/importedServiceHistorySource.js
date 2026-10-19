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
import { EOS_SESSION_SOURCE } from "./eosSessionSource.js";
import { createImportedHistoryClient } from "../services/eosRecordsClients.js";

// FIREBASE EXIT B4 (DECISIONS #B4; F7f-1): WHICH SOURCE ANSWERS is decided once at BUILD time by the F1 flag. Where an EOS API is declared the section reads
// eos_ops.imported_service_history through the Operations transport (listImportedServiceHistory: customer.record.read + the caller's operating companies) and the
// Firebase callable below is never invoked -- not as a fallback, not on failure, not on an empty answer. Everywhere else the callable is the sole source, exactly as
// before. The two answers have ONE shape, so the section is one component.
const CALLABLE = "listImportedServiceHistory";

/**
 * Read one customer's imported historical service.
 *
 * Resolves `{ ok, rows, truncated }` or `{ ok: false, code }`. `denied` is kept DISTINCT from
 * a general failure: "you may not see this" and "this could not be read" are different facts
 * about the same empty space, and a section that showed one for the other would be lying about
 * which one to go and fix.
 */
async function firebaseFetchImportedServiceHistory(accountId, limit) {
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

export const fetchImportedServiceHistory = EOS_SESSION_SOURCE ? createImportedHistoryClient() : firebaseFetchImportedServiceHistory;
