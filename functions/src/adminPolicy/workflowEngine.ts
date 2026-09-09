// The workflow engine — "what business ACTION may this principal perform?"
//
// ════════════════════ THE SEPARATION THIS FILE DEFENDS ════════════════════
//
//   OBJECT/FIELD AUTHORITY   what data may I access or change?   effectiveObjectAccess.ts
//   WORKFLOW AUTHORITY       what business action may I perform?  this file
//
// NEITHER IMPLIES THE OTHER, and that is not a stylistic separation:
//
//   being allowed to `Start Purchasing` does NOT mean reading every Purchase Order field
//   holding `PurchaseOrder.Read` does NOT mean being allowed to `Void Purchase Order`
//
// So this file never consults Object/Field CRED, and the CRED resolver never consults a workflow
// binding. A caller that needs both asks both, and a caller that needs only one gets only one.
//
// ════════════════════ WHAT DECIDES A TRANSITION ════════════════════
//
//   1. the instance's CURRENT STEP, read from the store -- never from the request
//   2. the action must exist in the version the instance is PINNED TO
//   3. that action's `from` must be the current step
//   4. a Role the principal actually holds must be bound to that action
//   5. `requiresOwnAssignment` must be satisfied by a server-derived assignee
//
// All five, in that order. A caller supplying `currentStatus` is not consulted at all: the request
// is a proposal, and the stored state is the fact.
//
// ════════════════════ VERSION PINNING ════════════════════
//
// An instance stays on the version it began under. Editing v2 must not retroactively reinterpret an
// in-flight v1 instance -- its history was produced under rules that said something specific, and
// rewriting those rules afterwards makes the history unreadable. The store additionally refuses to
// edit a PUBLISHED version at all.
import type { PolicyReader } from "./policyRepository";
import type {
  TenantId,
  WorkflowActionRecord,
  WorkflowInstanceRecord,
  WorkflowRoleBindingRecord,
  WorkflowStepRecord,
} from "./types";

export type WorkflowRefusal =
  | "unknownInstance"
  | "unknownAction"
  | "invalidFromState"
  | "notBoundToRole"
  | "notOwnAssignment"
  | "terminalState";

export type WorkflowDecision =
  | { readonly allowed: true; readonly action: WorkflowActionRecord; readonly toStepKey: string }
  | { readonly allowed: false; readonly refusal: WorkflowRefusal };

/**
 * Facts the SERVER derived about this attempt. Nothing here comes from the request body.
 *
 * `assigneeUid` is the assignee recorded on the business record, read server-side. A caller cannot
 * supply it, which is what makes `requiresOwnAssignment` an authorization check rather than a
 * self-attested claim.
 */
export interface WorkflowAttempt {
  readonly tenantId: TenantId;
  readonly actorUid: string;
  /** Role ids the principal actually holds, already qualified by the access resolver. */
  readonly roleIds: readonly string[];
  readonly assigneeUid: string | null;
}

/** One version's definition, loaded once so a decision is made over a consistent snapshot. */
export interface WorkflowVersionDefinition {
  readonly versionId: string;
  readonly steps: readonly WorkflowStepRecord[];
  readonly actions: readonly WorkflowActionRecord[];
  readonly bindings: readonly WorkflowRoleBindingRecord[];
}

export async function loadWorkflowVersionDefinition(
  reader: PolicyReader,
  tenantId: TenantId,
  versionId: string,
): Promise<WorkflowVersionDefinition> {
  const [steps, actions, bindings] = await Promise.all([
    reader.listWorkflowSteps(tenantId, versionId),
    reader.listWorkflowActions(tenantId, versionId),
    reader.listWorkflowRoleBindings(tenantId, versionId),
  ]);
  return { versionId, steps, actions, bindings };
}

/**
 * May this principal perform this action on this instance, right now?
 *
 * The instance carries its own version, so the definition passed in MUST be that version's. A
 * caller that loaded a different one is asking a question about a workflow this record is not
 * running, and `unknownAction` is the honest answer rather than a coincidental match.
 */
export function decideWorkflowAction(
  definition: WorkflowVersionDefinition,
  instance: WorkflowInstanceRecord | null | undefined,
  actionKey: string,
  attempt: WorkflowAttempt,
): WorkflowDecision {
  if (!instance || instance.workflowVersionId !== definition.versionId) {
    return { allowed: false, refusal: "unknownInstance" };
  }

  // THE STORED STATE, and only the stored state.
  const currentStepKey = instance.currentStepKey;
  const currentStep = definition.steps.find((s) => s.key === currentStepKey);
  if (currentStep?.terminal === true) return { allowed: false, refusal: "terminalState" };

  const action = definition.actions.find((a) => a.key === actionKey);
  if (!action) return { allowed: false, refusal: "unknownAction" };

  // AUTHORITY BEFORE VALIDITY WOULD LEAK. Checked in this order deliberately: an unauthorized
  // principal learns "you may not do this", not "you may, but not from here", which would tell them
  // the record's current state. State is business data and this is an authorization answer.
  if (action.fromStepKey !== currentStepKey) return { allowed: false, refusal: "invalidFromState" };

  const bound = definition.bindings.some(
    (b) => b.actionKey === actionKey && attempt.roleIds.includes(b.roleId),
  );
  if (!bound) return { allowed: false, refusal: "notBoundToRole" };

  if (action.requiresOwnAssignment) {
    // A missing assignee is a REFUSAL, not a pass. "Nobody is assigned" cannot satisfy "must be the
    // assignee" -- treating an absent value as a match is how an own-assignment gate becomes a
    // no-op on exactly the records that never got assigned.
    if (!attempt.assigneeUid || attempt.assigneeUid !== attempt.actorUid) {
      return { allowed: false, refusal: "notOwnAssignment" };
    }
  }

  return { allowed: true, action, toStepKey: action.toStepKey };
}

/**
 * Every action this principal could perform on this instance now.
 *
 * The same decision function, asked once per action -- not a second, parallel implementation of the
 * rules. A surface that renders buttons and a command that authorizes one must never be able to
 * disagree, and the cheapest way to guarantee that is to make them the same code.
 */
export function allowedWorkflowActions(
  definition: WorkflowVersionDefinition,
  instance: WorkflowInstanceRecord | null | undefined,
  attempt: WorkflowAttempt,
): readonly string[] {
  return definition.actions
    .filter((a) => decideWorkflowAction(definition, instance, a.key, attempt).allowed)
    .map((a) => a.key);
}

/**
 * Structural validation of a version before it may be published.
 *
 * A definition that cannot describe a runnable process is refused at publication rather than
 * discovered by the first record that gets stuck in it.
 */
export function validateWorkflowVersion(definition: WorkflowVersionDefinition): readonly string[] {
  const problems: string[] = [];
  const stepKeys = new Set(definition.steps.map((s) => s.key));

  if (definition.steps.length === 0) problems.push("a workflow version needs at least one step");

  const initial = definition.steps.filter((s) => s.initial);
  if (initial.length === 0) problems.push("no initial step: an instance would have nowhere to start");
  if (initial.length > 1) problems.push(`${initial.length} initial steps: an instance's start would be ambiguous`);

  for (const s of definition.steps) {
    if (s.initial && s.terminal) problems.push(`step "${s.key}" is both initial and terminal`);
  }

  for (const a of definition.actions) {
    if (!stepKeys.has(a.fromStepKey)) problems.push(`action "${a.key}" comes from unknown step "${a.fromStepKey}"`);
    if (!stepKeys.has(a.toStepKey)) problems.push(`action "${a.key}" goes to unknown step "${a.toStepKey}"`);
    const from = definition.steps.find((s) => s.key === a.fromStepKey);
    if (from?.terminal) problems.push(`action "${a.key}" leaves terminal step "${a.fromStepKey}"`);
  }

  const actionKeys = new Set(definition.actions.map((a) => a.key));
  for (const b of definition.bindings) {
    if (!actionKeys.has(b.actionKey)) problems.push(`binding references unknown action "${b.actionKey}"`);
  }

  // An action nobody may perform is not an error -- a definition may be published before its Roles
  // exist, and refusing that would force Roles to be invented to satisfy a validator. Recorded as a
  // WARNING nowhere: it is simply not a problem, and saying so here stops it being "fixed" later.

  return problems;
}
