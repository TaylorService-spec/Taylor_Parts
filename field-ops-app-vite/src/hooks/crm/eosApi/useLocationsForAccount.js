// EOS API (PostgreSQL CRM) implementation. Selected by src/hooks/useLocationsForAccount.js ONLY when CRM_VIA_EOS_API
// (domain/crmAuthorityRoute.js -- platform-sandbox builds); every other build uses the legacy Firestore implementation
// that stays in src/hooks/useLocationsForAccount.js. Imports no Firebase SDK and no Firestore helper; never falls back.
//
import { useCrmRead } from "./useCrmRead";
import { crmReadErrorMessage, locationRowFromCrm, readAllPages } from "../../../services/crmApiClient.js";

// The customer sites of one Account, from the governed PostgreSQL CRM authority (EOS API). CRM CUTOVER: no Firestore
// listener and no fallback. FAIL CLOSED: a failure shows no rows and a safe error, never a stale or partial list.
export function useLocationsForAccount(accountId) {
  const { value, loading, error, retry } = useCrmRead(accountId ?? "", async () => {
    if (!accountId) return { value: [] };
    const res = await readAllPages("listAccountLocations", { accountId }, locationRowFromCrm);
    return res.ok ? { value: res.rows } : { error: crmReadErrorMessage(res, "locations") };
  });
  return { data: value ?? [], loading: accountId ? loading : false, error, retry };
}
