// THE EMPLOYEE WORKSPACE TABLE (Final EOS Application Assembly, DECISIONS #209) -- served on /operations/workspace, resolved like
// the other Operations routes. READ-ONLY and grants nothing: readMyWork composes the caller's own governed reads; searchEos
// searches only what the caller's existing reads (and scopes) already allow; resolvePrincipalDisplayNames names the actors on
// records the caller already reads, resolveEmployeeDisplayNames names their owners, and searchAccountOwnerCandidates offers the
// owners an Account write would accept (display names only, see principalDisplayNames.ts).
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";
import { readMyWork, searchEos } from "./myWork";
import { previewMyWorkAs } from "./previewAsUser";
import { resolveEmployeeDisplayNames, resolvePrincipalDisplayNames, searchAccountOwnerCandidates } from "./principalDisplayNames";
import { MyWorkError } from "./myWork";
import { readMyCompanyAuthority as readCompanyAuthorityOf } from "../eosOps/companyAuthority";

export const WORKSPACE_ROUTE = "/operations/workspace";
type Op = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;
/** D6: the caller's OWN authorized operating companies (EOS Core company authority), for company pickers. Describes the caller; reads no record. */
const readMyCompanyAuthority: Op = async (deps, caller, input) => {
  const extra = Object.keys(input ?? {});
  if (extra.length) throw new MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  return readCompanyAuthorityOf(deps.pool, caller.actor.tenantId, caller.actor.principalId);
};
export const EOS_WORKSPACE_OPERATIONS: Readonly<Record<string, Op>> = Object.freeze({ readMyWork, searchEos, previewMyWorkAs, resolvePrincipalDisplayNames, resolveEmployeeDisplayNames, searchAccountOwnerCandidates, readMyCompanyAuthority });
export const WORKSPACE_OPERATIONS = Object.freeze(Object.keys(EOS_WORKSPACE_OPERATIONS));
export const isWorkspaceOperation = (name: unknown): name is string => typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_WORKSPACE_OPERATIONS, name);
