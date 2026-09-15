import { useCrmRead } from "./useCrmRead";
import { contactRowFromCrm, crmReadErrorMessage, readAllPages } from "../services/crmApiClient.js";

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
