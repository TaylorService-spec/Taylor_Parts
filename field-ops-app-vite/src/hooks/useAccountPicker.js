import { useCrmRead } from "./useCrmRead";
import { accountRowFromCrm, callCrmApi } from "../services/crmApiClient.js";
import { interpretPickerRead, PICKER_READ_CAP } from "../domain/pickerSource.js";

// BOUNDED Account read for pickers, from the governed PostgreSQL CRM authority (EOS API, listAccounts ordered by
// folded name). CRM CUTOVER: no Firestore query and no fallback. cap + 1 rows are requested so truncation is disclosed
// the same way as before; `docs` stays null on failure so a failed read is never mistaken for an empty list.
export function useAccountPicker({ cap = PICKER_READ_CAP } = {}) {
  const limit = Math.min(cap + 1, 200);
  const { value, loading, error } = useCrmRead(String(cap), async () => {
    const res = await callCrmApi("listAccounts", { limit });
    if (!res.ok) return { error: Object.assign(new Error(res.message), { code: res.code }) };
    const docs = res.result.items.map(accountRowFromCrm);
    // A page of 200 with more behind it is truncated even when cap >= 200.
    return { value: res.result.truncated && docs.length <= cap ? [...docs, { id: "__more__" }] : docs };
  });
  const picker = interpretPickerRead({ docs: value, loading, error, cap });
  return { ...picker, error, loading };
}
