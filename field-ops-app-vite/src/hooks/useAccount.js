import { useCrmRead } from "./useCrmRead";
import { accountRowFromCrm, callCrmApi, crmReadErrorMessage } from "../services/crmApiClient.js";

// One Account, read from the governed PostgreSQL CRM authority through the EOS API. CRM CUTOVER: no Firestore
// listener and no fallback. A failed read is distinct from a confirmed absence (account null, error null) and from
// loading; `checkedAt` stamps when the read last answered, and `retry` re-reads (callers retry after a save).
export function useAccount(accountId) {
  const { value, loading, error, checkedAt, retry } = useCrmRead(accountId ?? "", async () => {
    if (!accountId) return { value: null };
    const res = await callCrmApi("getAccount", { accountId });
    if (res.ok) return { value: accountRowFromCrm(res.result) };
    if (res.code === "ACCOUNT_NOT_FOUND" || res.code === "RECORD_ID_REQUIRED") return { value: null };
    return { error: crmReadErrorMessage(res, "customers") };
  });
  return { account: value, loading: accountId ? loading : false, error, retry, checkedAt };
}
