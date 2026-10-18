import { useEmployeeDirectory } from "./useEmployeeDirectory.js";
import { useGovernedEmployeeDirectory } from "./useGovernedEmployeeDirectory.js";
import { EOS_SESSION_SOURCE } from "../access/eosSessionSource.js";

// D-247-2 (DECISIONS #247, closed by Firebase exit B1, DECISIONS #B1): the names on the Financials screens that still read the
// Firebase-backed facts (Invoice detail, Accounts Receivable, Employee Performance). Where an EOS API is declared the Firestore
// `employees` listener is DISABLED and the governed name read answers (ONLY the Employee ids the screen passes -- the people on rows it
// was allowed to read -- display names only, shared per principal and bounded); everywhere else the Firestore directory is the sole
// source, exactly as before. The choice is the build-time flag, so exactly one of the two hooks reads, and the other is idle.
//
// Same result shape as both hooks: { byEmployeeId, loading, error }.
export function useFinancialsEmployeeDirectory(employeeIds = []) {
  const legacy = useEmployeeDirectory({ enabled: !EOS_SESSION_SOURCE });
  const governed = useGovernedEmployeeDirectory({ enabled: EOS_SESSION_SOURCE, employeeIds });
  return EOS_SESSION_SOURCE ? governed : legacy;
}
