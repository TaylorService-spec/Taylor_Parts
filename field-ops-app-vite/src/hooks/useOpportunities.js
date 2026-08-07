import { useMemo } from "react";
import { DEFAULT_OPPORTUNITY_SOURCE } from "../access/opportunitySource.js";

// React adapter over the Opportunity SOURCE seam (access/opportunitySource.js). The workspace consumes THIS
// hook and never touches the source directly, so swapping the synthetic source for a governed Firestore/
// callable read model is a one-line change in access/opportunitySource.js — no component edit, no signature
// change here. `source` is injectable purely so tests (and a future governed source) can substitute a
// snapshot; production passes nothing and gets the module default.
//
// The synthetic source resolves synchronously, so there is no real async loading today; the { loading,
// error } shape is kept so a later live source (onSnapshot/awaited callable) slots in without changing the
// consumer contract, matching the loading/error convention every other read hook in this app uses.
export function useOpportunities(source = DEFAULT_OPPORTUNITY_SOURCE) {
  return useMemo(() => {
    const snap = source();
    return {
      opportunities: snap.opportunities ?? [],
      accountNameById: snap.accountNameById ?? {},
      status: snap.status ?? "unavailable",
      loading: false,
      error: snap.error ?? null,
    };
  }, [source]);
}
