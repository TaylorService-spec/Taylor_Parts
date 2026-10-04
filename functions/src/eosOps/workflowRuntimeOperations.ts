// THE WORKFLOW RUNTIME ROUTE (Administration control plane, DECISIONS #210) -- POST /operations/workflow.
//
// The governed workflow engine (adminPolicy/workflowEngine + workflowInstances) already decides every transition: the PINNED
// version, the current step, the action's from-state, a Security Role binding the caller actually holds (Functional Role
// bindings narrow further), and then the action's CAPABILITY through the same entitled evaluator every other route uses -- with
// the RECORD_ASSIGNMENT guard decided Employee-against-Employee. What it lacked was a runtime caller, so a change made in
// Administration -> Workflows (a role binding, an active version) changed nothing anybody could observe. This route is that
// caller -- nothing more:
//
//   listWorkflowWork            the in-flight instances of each ACTIVE workflow version, each with the actions available from
//                               its current step and, per action, the engine's own decision for THIS caller (allowed, or the
//                               refusal). A dry run of authorizeWorkflowAction: it writes nothing.
//   transitionWorkflowInstance  transitionWorkflowInstance -- one transaction, one append-only instance event.
//
// A workflow binding enables PARTICIPATION only: the action's capability, its condition, scope, record relation and the domain
// invariants still decide, so no binding can bypass object authority. No Firebase.
import type { WorkOrderCaller, WorkOrderOperationDeps } from "./workOrderOperationTypes";
import { PostgresPolicyRepository } from "../adminPolicy/postgresPolicyRepository";
import { authorizeWorkflowAction, loadWorkflowVersionDefinition } from "../adminPolicy/workflowEngine";
import { transitionWorkflowInstance as engineTransition } from "../adminPolicy/workflowInstances";
import { WorkflowRefusal } from "../adminPolicy/workflowAdministration";
import { operationalWorkflowAuthority } from "../adminPolicy/workflowAuthority";
import { resolveOperationalContextForPrincipal } from "./capabilityAuthority";
import { postgresGrantConditionProvider } from "./entitledActionAuthority";
import { postgresContextualReader } from "./contextualAuthorization";
import { postgresWorkflowFunctionalRoleFacts } from "./functionalRoleFacts";

export const WORKFLOW_RUNTIME_ROUTE = "/operations/workflow";
const WORK_LIMIT = 200;

export class WorkflowRuntimeError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.name = "WorkflowRuntimeError";
  }
}

const accept = (input: Record<string, unknown>, allowed: readonly string[]) => {
  const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length) throw new WorkflowRuntimeError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
};
const text = (v: unknown, field: string): string => {
  if (typeof v !== "string" || v.trim().length === 0 || v.length > 200) throw new WorkflowRuntimeError("INPUT_INVALID", "INVALID_INPUT", `${field} is required`);
  return v.trim();
};

/** The caller's runtime facts for the engine, resolved by the SAME resolver as every request -- never from the body. */
async function runtimeFor(deps: WorkOrderOperationDeps, caller: WorkOrderCaller) {
  if (!deps.policyReader) throw new WorkflowRuntimeError("RUNTIME_UNAVAILABLE", "FORBIDDEN", "the governed resolver is not composed on this server");
  const { tenantId, principalId } = caller.actor;
  const ctx = await resolveOperationalContextForPrincipal(deps.policyReader, deps.pool, principalId, tenantId, postgresGrantConditionProvider(deps.pool));
  const repo = new PostgresPolicyRepository(deps.pool);
  const roles = await repo.listRoles(tenantId);
  const held = new Set(ctx.principalContext.heldRoleKeys);
  return {
    repo, ctx,
    actor: { tenantId, principalId, heldRoleKeys: ctx.principalContext.heldRoleKeys,
      scopedRoles: ctx.scopedHeld.map((h) => ({ roleKey: h.sourceRole, scopeType: h.scopeType, scopeValue: h.scopeValue })) },
    roleIds: roles.filter((r) => held.has(r.key)).map((r) => r.id),
    operational: { tenantId, principalId, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld,
      scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements },
    facts: postgresWorkflowFunctionalRoleFacts(deps.pool, tenantId, principalId),
  };
}

export async function listWorkflowWork(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  accept(input, ["objectKey"]);
  const objectKey = input.objectKey === undefined ? null : text(input.objectKey, "objectKey");
  const rt = await runtimeFor(deps, caller);
  const reader = postgresContextualReader(deps.pool);
  const workflows = (await rt.repo.listWorkflows(caller.actor.tenantId))
    .filter((w) => w.activeVersionId && (!objectKey || w.objectKey === objectKey));
  const items: unknown[] = [];
  let total = 0;
  for (const w of workflows) {
    const definition = await loadWorkflowVersionDefinition(rt.repo, caller.actor.tenantId, w.activeVersionId!);
    const instances = await rt.repo.listWorkflowInstances(caller.actor.tenantId, w.activeVersionId!);
    const authority = operationalWorkflowAuthority(reader, rt.operational, w.objectKey);
    for (const instance of instances) {
      const step = definition.steps.find((s) => s.key === instance.currentStepKey);
      if (step?.terminal) continue;
      total += 1;
      if (items.length >= WORK_LIMIT) continue;
      const actions = [];
      for (const a of definition.actions.filter((x) => x.fromStepKey === instance.currentStepKey)) {
        const d = await authorizeWorkflowAction(definition, instance, a.key, {
          tenantId: caller.actor.tenantId, principalId: caller.actor.principalId, roleIds: rt.roleIds, recordId: instance.recordId,
          authority, functionalRoles: rt.facts,
        });
        actions.push({ actionKey: a.key, label: a.label ?? a.key, toStepKey: a.toStepKey, capabilityKey: a.capabilityKey ?? null,
          allowed: d.allowed, refusal: d.allowed ? null : `${d.refusal}${d.outcome ? ` (${d.outcome})` : ""}` });
      }
      items.push({ workflowKey: w.key, workflowName: w.name, objectKey: instance.objectKey, recordId: instance.recordId,
        currentStepKey: instance.currentStepKey, currentStepLabel: step?.label ?? instance.currentStepKey, actions });
    }
  }
  return Object.freeze({ items, total, truncated: total > items.length });
}

export async function transitionWorkflowInstance(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  accept(input, ["objectKey", "recordId", "actionKey", "reason"]);
  const objectKey = text(input.objectKey, "objectKey");
  const recordId = text(input.recordId, "recordId");
  const actionKey = text(input.actionKey, "actionKey");
  const reason = input.reason === undefined || input.reason === null ? null : text(input.reason, "reason");
  const rt = await runtimeFor(deps, caller);
  const workflow = (await rt.repo.listWorkflows(caller.actor.tenantId)).find((w) => w.objectKey === objectKey);
  const authority = operationalWorkflowAuthority(postgresContextualReader(deps.pool), rt.operational, workflow?.objectKey ?? objectKey);
  try {
    const out = await engineTransition(rt.repo, rt.actor, { objectKey, recordId, actionKey, reason }, authority, rt.facts);
    return Object.freeze({ objectKey, recordId, actionKey, currentStepKey: out.instance.currentStepKey });
  } catch (err) {
    if (err instanceof WorkflowRefusal) {
      const category = err.category === "NOT_FOUND" ? "NOT_FOUND" : err.category === "CONFLICT" ? "CONFLICT" : "FORBIDDEN";
      throw new WorkflowRuntimeError(err.code, category, err.message);
    }
    throw err;
  }
}

type Op = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;
export const EOS_WORKFLOW_RUNTIME_OPERATIONS: Readonly<Record<string, Op>> = Object.freeze({ listWorkflowWork, transitionWorkflowInstance });
export const isWorkflowRuntimeOperation = (name: unknown): name is string =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_WORKFLOW_RUNTIME_OPERATIONS, name);
