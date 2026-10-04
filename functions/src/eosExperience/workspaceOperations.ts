// THE EMPLOYEE WORKSPACE TABLE (Final EOS Application Assembly, DECISIONS #209) -- served on /operations/workspace, resolved like
// the other Operations routes. READ-ONLY and grants nothing: readMyWork composes the caller's own governed reads; searchEos
// searches only what the caller's existing reads (and scopes) already allow.
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";
import { readMyWork, searchEos } from "./myWork";

export const WORKSPACE_ROUTE = "/operations/workspace";
type Op = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;
export const EOS_WORKSPACE_OPERATIONS: Readonly<Record<string, Op>> = Object.freeze({ readMyWork, searchEos });
export const WORKSPACE_OPERATIONS = Object.freeze(Object.keys(EOS_WORKSPACE_OPERATIONS));
export const isWorkspaceOperation = (name: unknown): name is string => typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_WORKSPACE_OPERATIONS, name);
