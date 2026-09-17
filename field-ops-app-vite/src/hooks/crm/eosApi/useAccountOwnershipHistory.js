// EOS API (PostgreSQL CRM) read of one Account's append-only ownership history (listAccountOwnershipHistory,
// customer.record.read), newest first. Platform-sandbox builds only: reached through
// modules/accounts/crm/eosApi/AccountOwnershipHistorySection.jsx, which AccountDetail selects by CRM_VIA_EOS_API.
// There is no Firestore equivalent and no fallback.
import { useCrmRead } from "./useCrmRead";
import { callCrmApi, crmReadErrorMessage } from "../../../services/crmApiClient.js";

/** The newest events shown on the record page; more is disclosed as truncated, never silently dropped. */
export const OWNERSHIP_HISTORY_PAGE = 10;

/** `refreshKey` changes after a save so the history is re-read with the Account. */
export function useAccountOwnershipHistory(accountId, refreshKey = 0) {
  const { value, loading, error, retry } = useCrmRead(`${accountId ?? ""}:${refreshKey}`, async () => {
    if (!accountId) return { value: { items: [], truncated: false } };
    const res = await callCrmApi("listAccountOwnershipHistory", { accountId, limit: OWNERSHIP_HISTORY_PAGE });
    if (!res.ok) return { error: crmReadErrorMessage(res, "ownership records") };
    return { value: { items: res.result.items ?? [], truncated: res.result.truncated === true } };
  });
  return { items: value?.items ?? [], truncated: value?.truncated ?? false, loading: accountId ? loading : false, error, retry };
}
