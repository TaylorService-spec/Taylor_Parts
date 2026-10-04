// THE ANALYSIS OPERATIONS TABLE (Package C, DECISIONS #208) -- served on /operations/analysis by the Operations transport,
// resolved like the Work Order / Equipment / Finance / Rental routes (verified token -> Principal -> tenant -> capabilities).
// READ-ONLY: no operation here writes anything, and none grants anything. Each measure is decided on its own EXISTING read
// capability (and, for Sales, the caller's salesChannel-scoped holdings); actions are offered, never performed, here.
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";
import { readAnalysisCatalog, readAnalysisWorkspace, readMeasureAnalysis, type AnalysisActor } from "./analysis";

export const ANALYSIS_ROUTE = "/operations/analysis";

type Op = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;
const actorOf = (caller: WorkOrderCaller): AnalysisActor => ({ tenantId: caller.actor.tenantId, principalId: caller.actor.principalId,
  capabilities: caller.actor.capabilities, scopedHeld: caller.operational?.scopedHeld });

export const EOS_ANALYSIS_OPERATIONS: Readonly<Record<string, Op>> = Object.freeze({
  readAnalysisCatalog: async (_deps, caller) => readAnalysisCatalog(actorOf(caller)),
  readAnalysisWorkspace: async (deps, caller, input) => readAnalysisWorkspace(deps.pool, actorOf(caller), input, deps.now),
  readMeasureAnalysis: async (deps, caller, input) => readMeasureAnalysis(deps.pool, actorOf(caller), input, deps.now),
});
export const ANALYSIS_OPERATIONS = Object.freeze(Object.keys(EOS_ANALYSIS_OPERATIONS));
export const isAnalysisOperation = (name: unknown): name is string => typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_ANALYSIS_OPERATIONS, name);
