import { useCrmRead } from "./useCrmRead";
import { callCrmApi, crmReadErrorMessage, locationRowFromCrm } from "../services/crmApiClient.js";

// One customer site, from the governed PostgreSQL CRM authority (EOS API). `null` means "not a customer site of this
// tenant", never "try the inventory namespace". CRM CUTOVER: no Firestore listener, no fallback.
export function useLocation(locationId) {
  const { value, loading, error, retry } = useCrmRead(locationId ?? "", async () => {
    if (!locationId) return { value: null };
    const res = await callCrmApi("getAccountLocation", { accountLocationId: locationId });
    if (res.ok) return { value: locationRowFromCrm(res.result) };
    if (res.code === "ACCOUNT_LOCATION_NOT_FOUND" || res.code === "RECORD_ID_REQUIRED") return { value: null };
    return { error: crmReadErrorMessage(res, "locations") };
  });
  return { location: value, loading: locationId ? loading : false, error, retry };
}
