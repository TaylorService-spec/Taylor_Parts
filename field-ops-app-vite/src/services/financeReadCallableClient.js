// Finance AR -- transport over the trusted `listAccountInvoiceAr` callable
// (functions/src/finance/financeReadCallables.ts). Structure mirrors
// services/receivingCallableClient.js: firebase is imported LAZILY (no import-time
// initializeApp side effect), and this is the only place that invokes the callable.
//
// Unlike receivingCallableClient.js this is a READ with no client-side readiness flag --
// `finance.read` authorization and its per-environment activation are both enforced
// server-side (the callable throws permission-denied when unauthorized); there is nothing
// unsafe about attempting the call and mapping whatever comes back, exactly like every other
// governed-read client in this codebase (services/partMasterQueries.js,
// services/equipmentCompatibilitySource.js).
import { mapAccountArErrorToStatus } from "../domain/accountArView.js";

async function invoke(payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, "listAccountInvoiceAr")(payload);
  return res?.data;
}

// Fetch the AR read for one account. Returns { result } on success (the callable's own
// {status, invoices, summary} envelope, passed through verbatim for domain/accountArView.js
// to interpret) or { errorStatus } on failure ("denied" | "unavailable") -- never throws.
export async function fetchAccountInvoiceAr(accountId, limit = 100) {
  try {
    const result = await invoke({ accountId, limit });
    return { result };
  } catch (err) {
    return { errorStatus: mapAccountArErrorToStatus(err) };
  }
}
