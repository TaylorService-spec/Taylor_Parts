// The WORKFLOW half of the Administration API: reads and mutations, dispatched from adminPolicyApi.
//
// adminPolicyApi owns the transport concerns -- the closed operation list, principal resolution,
// the read gate (workflow reads -> workflowDefinition.read via the "workflows" surface; the
// responsibilities read -> admin.principalAccess.read via "users") and failure classification.
// This file owns what each workflow operation MEANS. Every mutation re-checks its own capability
// next to its transaction (workflowAdministration.requireWorkflowAdministrationCapability), so a
// caller that reached a command directly is gated exactly as one that came through here.
import { PolicyValidationError, type AdminActor } from "./policyCommands";
import type { PolicyRepository } from "./policyRepository";
import type { WorkflowRecord, WorkflowVersionRecord } from "./types";
import {
  createWorkflowDraft,
  createWorkflowVersion,
  setWorkflowRoleBinding,
  updateWorkflowDefinition,
  actionCapabilityKey,
  actionGuardKind,
  type WorkflowDefinitionInput,
} from "./workflowCommands";
import { decideWorkflowMutation, findWorkflowVersion, WORKFLOW_MUTATION_CAPABILITY, WorkflowRefusal } from "./workflowAdministration";
import { actorCapabilities } from "./administrationCapabilityGate";
import { loadWorkflowVersionDefinition } from "./workflowEngine";
import {
  activateWorkflowVersion,
  publishWorkflowVersion,
  retireWorkflowVersion,
  validateStoredWorkflowVersion,
} from "./workflowLifecycle";
import {
  adoptRecordsIntoWorkflowVersion,
  migrateWorkflowInstances,
  startWorkflowInstance,
} from "./workflowInstances";
import {
  deriveWorkflowResponsibilities,
  loadActiveWorkflowDefinitions,
  type ExplainedAuthority,
} from "./workflowResponsibilities";
import { loadWorkflowValidationContext, validateWorkflowDefinition } from "./workflowValidation";

export const WORKFLOW_READ_OPERATIONS = Object.freeze([
  "listWorkflows",
  "readWorkflowVersion",
  "validateWorkflowVersion",
  "listWorkflowInstances",
  "readWorkflowHistory",
  "listPrincipalWorkflowResponsibilities",
  "readMyWorkflowAdministration",
] as const);

export const WORKFLOW_MUTATION_OPERATIONS = Object.freeze([
  "createWorkflowDraft",
  "createWorkflowVersion",
  "updateWorkflowDefinition",
  "setWorkflowRoleBinding",
  "publishWorkflowVersion",
  "activateWorkflowVersion",
  "retireWorkflowVersion",
  "startWorkflowInstance",
  "adoptRecordsIntoWorkflowVersion",
  "migrateWorkflowInstances",
] as const);

export type WorkflowReadOperation = (typeof WORKFLOW_READ_OPERATIONS)[number];
export type WorkflowMutationOperation = (typeof WORKFLOW_MUTATION_OPERATIONS)[number];
export type WorkflowOperation = WorkflowReadOperation | WorkflowMutationOperation;

export interface WorkflowApiDeps {
  readonly repo: PolicyRepository;
  /** The runtime evaluator (eosOps/effectiveAccessExplanation), composed by the server. */
  readonly explainEffectiveAccess?: (tenantId: string, principalId: string) => Promise<unknown>;
}

export interface WorkflowVersionView {
  /** Display names for every Security Role bound to, or eligible for, an action in this version (key -> name). */
  readonly roleNames: Readonly<Record<string, string>>;
  readonly workflow: WorkflowRecord;
  readonly version: WorkflowVersionRecord;
  readonly active: boolean;
  readonly steps: readonly { key: string; label: string; initial: boolean; terminal: boolean }[];
  readonly actions: readonly {
    key: string;
    label: string;
    from: string;
    to: string;
    requiresOwnAssignment: boolean;
    capabilityKey: string | null;
    /**
     * The Security Roles that HOLD this action's capability -- exactly the bindings validation accepts
     * (BINDING_WITHOUT_CAPABILITY uses the same role_capabilities map). null when the action names no capability, or one
     * the catalog does not have: there is then nothing a binding could be checked against.
     */
    eligibleRoles: readonly { key: string; name: string }[] | null;
    guardKind: string | null;
    roleKeys: readonly string[];
    /** FUNCTIONAL_ROLE bindings, by Functional Role key. They narrow the action; they never grant it. */
    functionalRoleKeys: readonly string[];
    bindings: readonly { roleKey: string | null; functionalRoleKey: string | null; bindingKind: string }[];
  }[];
}

/** Run one workflow operation. The caller has already resolved the actor and applied the read gate. */
export async function dispatchWorkflowOperation(
  deps: WorkflowApiDeps,
  actor: AdminActor,
  operation: WorkflowOperation,
  input: Record<string, unknown>,
  reason: string | null,
): Promise<unknown> {
  const { repo } = deps;
  switch (operation) {
    // ──────────── reads ────────────
    case "listWorkflows": {
      const out = [];
      for (const workflow of await repo.listWorkflows(actor.tenantId)) {
        out.push({ workflow, versions: await repo.listWorkflowVersions(actor.tenantId, workflow.id) });
      }
      return out;
    }
    case "readWorkflowVersion":
      return readWorkflowVersionView(repo, actor, requireString(input.versionId, "versionId"));
    case "readMyWorkflowAdministration":
      return readMyWorkflowAdministration(repo, actor, input);
    case "validateWorkflowVersion": {
      // A stored version, or an unsaved definition the editor is about to save.
      if (typeof input.versionId === "string" && input.versionId.trim().length > 0) {
        const { workflow, version, ...result } = await validateStoredWorkflowVersion(repo, actor, input.versionId.trim());
        return { versionId: version.id, version: version.version, status: version.status, workflowKey: workflow.key, ...result };
      }
      return validateUnsavedDefinition(repo, actor, input);
    }
    case "listWorkflowInstances": {
      const versionId = requireString(input.versionId, "versionId");
      await findWorkflowVersion(repo, actor, versionId);
      return repo.listWorkflowInstances(actor.tenantId, versionId);
    }
    case "readWorkflowHistory":
      return workflowHistory(repo, actor, requireString(input.workflowId, "workflowId"), clampLimit(input.limit));
    case "listPrincipalWorkflowResponsibilities": {
      const principalId = requireString(input.principalId, "principalId");
      const membership = await repo.getMembership(actor.tenantId, principalId);
      if (!membership) throw new WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", "principal not found in this tenant");
      if (typeof deps.explainEffectiveAccess !== "function") {
        throw new Error("listPrincipalWorkflowResponsibilities needs the runtime evaluator, which is not composed on this server");
      }
      const explained = await deps.explainEffectiveAccess(actor.tenantId, principalId) as ExplainedAuthority;
      // PROVENANCE ONLY: the ids of the Principal's ACTIVE GLOBAL assignments of the Roles the evaluator already counted
      // (explained.securityRoleKeys), so each entry can link to the assignment that produced it. Decides nothing.
      const [roles, assignments] = await Promise.all([repo.listRoles(actor.tenantId), repo.listAssignmentsForPrincipal(actor.tenantId, principalId)]);
      const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
      const counted = new Set(explained.securityRoleKeys);
      const globalAssignments = assignments
        .filter((a) => a.status === "active" && a.scopeType === "global" && counted.has(roleKeyById.get(a.roleId) ?? ""))
        .map((a) => ({ assignmentId: a.id, roleKey: roleKeyById.get(a.roleId) as string }));
      return deriveWorkflowResponsibilities(principalId, await loadActiveWorkflowDefinitions(repo, actor.tenantId), explained, { globalAssignments });
    }

    // ──────────── mutations ────────────
    case "createWorkflowDraft":
      return createWorkflowDraft(repo, actor, {
        key: requireString(input.key, "key"),
        name: requireString(input.name, "name"),
        description: optionalString(input.description),
        objectKey: requireString(input.objectKey, "objectKey"),
        definition: input.definition as WorkflowDefinitionInput,
        reason,
      });
    case "createWorkflowVersion":
      return createWorkflowVersion(repo, actor, {
        workflowId: requireString(input.workflowId, "workflowId"),
        copyFromVersionId: optionalString(input.copyFromVersionId),
        definition: input.definition as WorkflowDefinitionInput | undefined,
        reason,
      });
    case "updateWorkflowDefinition":
      return updateWorkflowDefinition(repo, actor, {
        versionId: requireString(input.versionId, "versionId"),
        definition: input.definition as WorkflowDefinitionInput,
        reason,
      });
    case "setWorkflowRoleBinding":
      return setWorkflowRoleBinding(repo, actor, {
        versionId: requireString(input.versionId, "versionId"),
        actionKey: requireString(input.actionKey, "actionKey"),
        roleId: requireString(input.roleId, "roleId"),
        reason,
      });
    case "publishWorkflowVersion":
      return publishWorkflowVersion(repo, actor, { versionId: requireString(input.versionId, "versionId"), reason });
    case "activateWorkflowVersion":
      return activateWorkflowVersion(repo, actor, { versionId: requireString(input.versionId, "versionId"), reason });
    case "retireWorkflowVersion":
      return retireWorkflowVersion(repo, actor, { versionId: requireString(input.versionId, "versionId"), reason });
    case "startWorkflowInstance":
      return startWorkflowInstance(repo, actor, {
        workflowKey: requireString(input.workflowKey, "workflowKey"),
        recordId: requireString(input.recordId, "recordId"),
        reason,
      });
    case "adoptRecordsIntoWorkflowVersion":
      return adoptRecordsIntoWorkflowVersion(repo, actor, {
        versionId: requireString(input.versionId, "versionId"),
        records: Array.isArray(input.records) ? input.records as never : [],
        reason,
      });
    case "migrateWorkflowInstances":
      return migrateWorkflowInstances(repo, actor, {
        fromVersionId: requireString(input.fromVersionId, "fromVersionId"),
        toVersionId: requireString(input.toVersionId, "toVersionId"),
        stepMap: (input.stepMap ?? null) as never,
        instanceIds: Array.isArray(input.instanceIds) ? input.instanceIds as string[] : null,
        reason,
      });
    default: {
      const never: never = operation;
      throw new Error(`unhandled workflow operation ${String(never)}`);
    }
  }
}

/** One version with its definition, resolved to Role KEYS, with capability, guard and binding kind. */
export async function readWorkflowVersionView(
  repo: PolicyRepository,
  actor: AdminActor,
  versionId: string,
): Promise<WorkflowVersionView> {
  const { workflow, version } = await findWorkflowVersion(repo, actor, versionId);
  const definition = await loadWorkflowVersionDefinition(repo, actor.tenantId, versionId);
  const [roles, functionalRoles, validation] = await Promise.all([
    repo.listRoles(actor.tenantId), repo.listFunctionalRoles(actor.tenantId), loadWorkflowValidationContext(repo, actor.tenantId),
  ]);
  const keyById = new Map(roles.map((r) => [r.id, r.key]));
  const nameByKey = new Map(roles.map((r) => [r.key, r.name]));
  const functionalKeyById = new Map(functionalRoles.map((f) => [f.id, f.key]));
  // W01 D3: eligibility comes from the SAME authority as validation (loadWorkflowValidationContext.roleCapabilities).
  const eligibleFor = (capabilityKey: string | null) => (capabilityKey && validation.capabilities.has(capabilityKey)
    ? roles.filter((r) => validation.roleCapabilities.get(r.key)?.has(capabilityKey)).map((r) => ({ key: r.key, name: r.name }))
      .sort((x, y) => x.name.localeCompare(y.name))
    : null);
  const roleNames: Record<string, string> = {};
  for (const b of definition.bindings) {
    const k = keyById.get(b.roleId ?? "");
    if (k) roleNames[k] = nameByKey.get(k) ?? k;
  }
  for (const a of definition.actions) for (const r of eligibleFor(a.capabilityKey ?? null) ?? []) roleNames[r.key] = r.name;
  return {
    roleNames,
    workflow,
    version,
    active: workflow.activeVersionId === version.id,
    steps: definition.steps.map((s) => ({ key: s.key, label: s.label, initial: s.initial, terminal: s.terminal })),
    actions: definition.actions.map((a) => {
      const bindings = definition.bindings
        .filter((b) => b.actionKey === a.key)
        .map((b) => (b.bindingKind ?? "SECURITY_ROLE") === "FUNCTIONAL_ROLE"
          ? { roleKey: null, functionalRoleKey: functionalKeyById.get(b.functionalRoleId ?? "") ?? b.functionalRoleId ?? null, bindingKind: "FUNCTIONAL_ROLE" }
          : { roleKey: keyById.get(b.roleId ?? "") ?? b.roleId, functionalRoleKey: null, bindingKind: b.bindingKind ?? "SECURITY_ROLE" })
        .sort((x, y) => `${x.bindingKind}|${x.roleKey ?? x.functionalRoleKey ?? ""}`.localeCompare(`${y.bindingKind}|${y.roleKey ?? y.functionalRoleKey ?? ""}`));
      return {
        key: a.key,
        label: a.label,
        from: a.fromStepKey,
        to: a.toStepKey,
        requiresOwnAssignment: a.requiresOwnAssignment,
        capabilityKey: a.capabilityKey ?? null,
        eligibleRoles: eligibleFor(a.capabilityKey ?? null),
        guardKind: a.guardKind ?? (a.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
        roleKeys: bindings.filter((b) => b.bindingKind === "SECURITY_ROLE").map((b) => b.roleKey as string),
        functionalRoleKeys: bindings.filter((b) => b.bindingKind === "FUNCTIONAL_ROLE").map((b) => b.functionalRoleKey as string),
        bindings,
      };
    }),
  };
}

async function validateUnsavedDefinition(repo: PolicyRepository, actor: AdminActor, input: Record<string, unknown>) {
  const objectKey = optionalString(input.objectKey);
  const definition = input.definition as WorkflowDefinitionInput | undefined;
  if (!definition || !Array.isArray(definition.steps) || !Array.isArray(definition.actions)) {
    throw new PolicyValidationError("versionId, or objectKey and a definition { steps, actions }, is required");
  }
  const context = await loadWorkflowValidationContext(repo, actor.tenantId);
  return validateWorkflowDefinition({
    objectKey,
    steps: definition.steps.map((s) => ({ key: String(s?.key ?? ""), initial: s?.initial === true, terminal: s?.terminal === true })),
    actions: definition.actions.map((a) => ({
      key: String(a?.key ?? ""), from: String(a?.from ?? ""), to: String(a?.to ?? ""),
      capabilityKey: actionCapabilityKey(a), guardKind: actionGuardKind(a),
    })),
    bindings: definition.actions.flatMap((a) => [
      ...(a?.roleKeys ?? []).map((roleKey: string) => ({
        actionKey: String(a?.key ?? ""),
        roleKey: context.roleKeys.has(roleKey) ? roleKey : null,
        roleRef: roleKey,
        bindingKind: "SECURITY_ROLE",
      })),
      ...(Array.isArray(a?.functionalRoleKeys) ? a.functionalRoleKeys : []).map((functionalRoleKey: string) => ({
        actionKey: String(a?.key ?? ""),
        roleKey: null,
        roleRef: String(functionalRoleKey),
        bindingKind: "FUNCTIONAL_ROLE",
        functionalRoleKey: context.functionalRoles?.has(functionalRoleKey) ? functionalRoleKey : null,
      })),
    ]),
  }, context);
}

/**
 * The audit history of ONE workflow: every workflow-kind event whose target is one of its versions
 * or instances, or whose payload names it. Newest last, bounded.
 */
async function workflowHistory(repo: PolicyRepository, actor: AdminActor, workflowId: string, limit: number) {
  const workflow = (await repo.listWorkflows(actor.tenantId)).find((w) => w.id === workflowId);
  if (!workflow) throw new WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", "workflow not found");
  const versionIds = new Set((await repo.listWorkflowVersions(actor.tenantId, workflowId)).map((v) => v.id));
  const names = (payload: unknown) => {
    const p = payload as { workflowId?: unknown; workflowKey?: unknown } | null | undefined;
    return p?.workflowId === workflowId || p?.workflowKey === workflow.key;
  };
  const events = await repo.listAuditEvents(actor.tenantId, 500);
  return events
    .filter((e) => typeof e.targetKind === "string" && e.targetKind.startsWith("workflow"))
    .filter((e) => versionIds.has(e.targetId) || names(e.before) || names(e.after))
    .slice(-limit);
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new PolicyValidationError(`${what} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new PolicyValidationError("expected a string");
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function clampLimit(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 100;
  return Math.min(Math.max(n, 1), 500);
}

/**
 * W01 D2 -- the CALLER'S OWN workflow-administration decisions, read-only. No principal input: nobody can ask about
 * anyone else. Each answer is decideWorkflowMutation over the caller's effective capabilities -- the very function the
 * mutations enforce with -- so a control the UI offers is one the server will accept, and every mutation still re-checks.
 * Grants nothing.
 */
async function readMyWorkflowAdministration(repo: PolicyRepository, actor: AdminActor, input: Record<string, unknown>) {
  const extra = Object.keys(input ?? {});
  if (extra.length > 0) throw new PolicyValidationError(`readMyWorkflowAdministration takes no input; not accepted: ${extra.sort().join(", ")}`);
  const [capabilities, catalog] = await Promise.all([actorCapabilities(repo, actor), repo.listCapabilities()]);
  const labelByKey = new Map(catalog.map((c) => [c.key, c.displayLabel]));
  const operations: Record<string, { allowed: boolean; requiredCapability: string; requiredLabel: string }> = {};
  // Exactly the mutations this API serves (not the internal seed path).
  for (const operation of WORKFLOW_MUTATION_OPERATIONS) {
    const requiredCapability = WORKFLOW_MUTATION_CAPABILITY[operation];
    operations[operation] = {
      allowed: decideWorkflowMutation(capabilities, operation),
      requiredCapability,
      requiredLabel: labelByKey.get(requiredCapability) ?? requiredCapability,
    };
  }
  return { operations };
}
