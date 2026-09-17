// EOS API (PostgreSQL CRM) implementation. Selected by src/hooks/useContactsForAccount.js ONLY when CRM_VIA_EOS_API
// (domain/crmAuthorityRoute.js -- platform-sandbox builds); every other build uses the legacy Firestore implementation
// that stays in src/hooks/useContactsForAccount.js. Imports no Firebase SDK and no Firestore helper; never falls back.
//
import { useCrmRead } from "./useCrmRead";
import { contactRowFromCrm, crmReadErrorMessage, readAllPages } from "../../../services/crmApiClient.js";

// The Contacts of one Account, from the governed PostgreSQL CRM authority (EOS API). CRM CUTOVER: no Firestore listener
// and no fallback; a failed read surfaces a safe error and no rows.
export function useContactsForAccount(accountId) {
  const { value, loading, error, retry } = useCrmRead(accountId ?? "", async () => {
    if (!accountId) return { value: [] };
    const res = await readAllPages("listAccountContacts", { accountId }, contactRowFromCrm);
    return res.ok ? { value: res.rows } : { error: crmReadErrorMessage(res, "contacts") };
  });
  return { data: value ?? [], loading: accountId ? loading : false, error, retry };
}
