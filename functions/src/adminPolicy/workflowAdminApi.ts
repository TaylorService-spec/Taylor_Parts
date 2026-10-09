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
import { isAssignmentScopeRuntimeType, scopeEvaluableCapabilities } from "./assignmentScopeRuntime";
import { employeeAccessIneligibility } from "./employmentAccessEligibility";
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
  "listWorkflowActionRoleHolders",
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
  /**
   * W01 holder lookup: which of the given Employees this caller may see, by the EXISTING Employee visibility
   * (eosAdministration/workflowHolderVisibility.ts, composed by the server). Absent or failing, the lookup refuses.
   */
  readonly workflowHolderVisibility?: (tenantId: string, callerPrincipalId: string, employeeIds: readonly string[]) =>
    Promise<{ readonly employeeReadHeld: boolean; readonly visible: ReadonlyMap<string, { readonly displayName: string | null }> }>;
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
    case "listWorkflowActionRoleHolders":
      return listWorkflowActionRoleHolders(deps, actor, input);
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

export const WORKFLOW_ROLE_HOLDER_LIMIT = 200;

/**
 * W01 holder lookup -- the Employees holding ONE Security Role that is eligible for, or already bound to, ONE workflow
 * action. For the people who can change assignments (the gate below), and narrower than the Security Role detail:
 *   - workflowDefinition.read (the surface gate) AND the save an assignment makes (edit or version, decided by
 *     decideWorkflowMutation like readMyWorkflowAdministration) -- otherwise FORBIDDEN;
 *   - the caller's tenant only (findWorkflowVersion: another tenant's version is NOT_FOUND);
 *   - only a Role eligible for (holds the action's capability) or bound to that action -- otherwise ROLE_NOT_FOR_ACTION;
 *   - only ACTIVE, NON-STALE assignments (the runtime's rule: accessVersionAtGrant <= the principal's access version);
 *   - Employee names AND COUNTS only where the EXISTING Employee visibility admits them (workflowHolderVisibility);
 *     anyone else is neither named nor counted (Owner decision #221); if that visibility cannot be established the
 *     lookup REFUSES.
 * No principal ids, sign-in identities, other Roles or capabilities. Read-only; grants nothing.
 */
async function listWorkflowActionRoleHolders(deps: WorkflowApiDeps, actor: AdminActor, input: Record<string, unknown>) {
  const { repo } = deps;
  const extra = Object.keys(input ?? {}).filter((k) => !["versionId", "actionKey", "roleKey"].includes(k));
  if (extra.length > 0) throw new PolicyValidationError(`listWorkflowActionRoleHolders accepts versionId, actionKey and roleKey only; not accepted: ${extra.sort().join(", ")}`);
  const versionId = requireString(input.versionId, "versionId");
  const actionKey = requireString(input.actionKey, "actionKey");
  const roleKey = requireString(input.roleKey, "roleKey");
  const capabilities = await actorCapabilities(repo, actor);
  if (!decideWorkflowMutation(capabilities, "updateWorkflowDefinition") && !decideWorkflowMutation(capabilities, "createWorkflowVersion")) {
    throw new WorkflowRefusal("WORKFLOW_ASSIGNMENT_CAPABILITY_REQUIRED", "FORBIDDEN",
      `not authorized: "${WORKFLOW_MUTATION_CAPABILITY.updateWorkflowDefinition}" or "${WORKFLOW_MUTATION_CAPABILITY.createWorkflowVersion}" is required`);
  }
  await findWorkflowVersion(repo, actor, versionId); // tenant-scoped; NOT_FOUND otherwise
  const definition = await loadWorkflowVersionDefinition(repo, actor.tenantId, versionId);
  const action = definition.actions.find((a) => a.key === actionKey);
  if (!action) throw new WorkflowRefusal("WORKFLOW_ACTION_NOT_FOUND", "NOT_FOUND", `this workflow version has no action "${actionKey}"`);
  const [roles, validation] = await Promise.all([repo.listRoles(actor.tenantId), loadWorkflowValidationContext(repo, actor.tenantId)]);
  const role = roles.find((r) => r.key === roleKey);
  const capabilityKey = action.capabilityKey ?? null;
  const roleEligible = Boolean(role && capabilityKey && validation.capabilities.has(capabilityKey) && validation.roleCapabilities.get(roleKey)?.has(capabilityKey));
  const roleBound = Boolean(role && definition.bindings.some((b) => b.actionKey === actionKey && (b.bindingKind ?? "SECURITY_ROLE") === "SECURITY_ROLE" && b.roleId === role.id));
  if (!role || (!roleEligible && !roleBound)) {
    throw new WorkflowRefusal("ROLE_NOT_FOR_ACTION", "INVALID_INPUT", `"${roleKey}" is neither eligible for nor bound to "${actionKey}"`);
  }
  // A grant narrowed by an ACTIVE condition is not the flat authority (fail closed: such a holder is not counted as able).
  const conditioned = capabilityKey !== null && (await repo.listGrantConditions(actor.tenantId, { activeOnly: true }))
    .some((c) => c.grantScope === "ROLE" && c.grantorKey === roleKey && c.capabilityKey === capabilityKey);
  // ONE ENTRY PER PERSON, and only people the runtime would let act at all: an ACTIVE principal with an ACTIVE membership in
  // this tenant whose linked Employee (if any) is access-eligible -- the qualification principalContext applies before it
  // reads a single Role (PRINCIPAL_DISABLED / NO_TENANT_MEMBERSHIP / EMPLOYEE_NOT_ACCESS_ELIGIBLE) -- holding the Role
  // through an ACTIVE, NON-STALE assignment. Several qualifying assignments of the Role are one holder: the action applies
  // if ANY of them carries it, and the scope shown is that assignment's (global first).
  type Reason = "ROLE_NOT_ELIGIBLE" | "CONDITIONED_GRANT" | "SCOPE_DOES_NOT_DECIDE";
  const holders: { employeeId: string | null; scopeType: string; scopeValue: string | null; appliesToAction: boolean; reason: Reason | null }[] = [];
  for (const principalId of await repo.listTenantPrincipalIds(actor.tenantId)) {
    const [principal, membership, assignments, versionRow, linked] = await Promise.all([
      repo.getPrincipal(principalId), repo.getMembership(actor.tenantId, principalId),
      repo.listAssignmentsForPrincipal(actor.tenantId, principalId), repo.getAccessVersion(actor.tenantId, principalId),
      repo.getLinkedEmployeeAccessFact(actor.tenantId, principalId)]);
    if (principal?.status !== "active" || membership?.status !== "active" || employeeAccessIneligibility(linked) !== null) continue;
    const current = typeof versionRow?.accessVersion === "number" ? versionRow.accessVersion : 0;
    const qualifying = assignments
      .filter((a) => a.roleId === role.id && a.status === "active" && typeof a.accessVersionAtGrant === "number" && a.accessVersionAtGrant <= current)
      .map((a) => {
        const scopeType = typeof a.scopeType === "string" && a.scopeType !== "" ? a.scopeType : "global";
        const scopeApplies = scopeType === "global"
          || (isAssignmentScopeRuntimeType(scopeType) && typeof a.scopeValue === "string" && a.scopeValue !== ""
            && capabilityKey !== null && scopeEvaluableCapabilities(scopeType).has(capabilityKey));
        const reason: Reason | null = !roleEligible ? "ROLE_NOT_ELIGIBLE" : conditioned ? "CONDITIONED_GRANT" : scopeApplies ? null : "SCOPE_DOES_NOT_DECIDE";
        return { scopeType, scopeValue: scopeType === "global" ? null : a.scopeValue ?? null, appliesToAction: reason === null, reason };
      })
      .sort((x, y) => Number(y.appliesToAction) - Number(x.appliesToAction) || Number(y.scopeType === "global") - Number(x.scopeType === "global"));
    if (qualifying.length === 0) continue;
    // An ambiguous link was excluded above (employeeAccessIneligibility), so a linked fact here is unambiguous.
    holders.push({ employeeId: linked ? linked.employeeId : null, ...qualifying[0] });
  }
  // EMPLOYEE VISIBILITY -- the existing rule, or nothing. No resolver, or a failing one: refuse.
  if (typeof deps.workflowHolderVisibility !== "function") {
    throw new WorkflowRefusal("EMPLOYEE_VISIBILITY_UNAVAILABLE", "FORBIDDEN", "Employee visibility could not be established; no holder is shown");
  }
  let visibility: Awaited<ReturnType<NonNullable<WorkflowApiDeps["workflowHolderVisibility"]>>>;
  try {
    visibility = await deps.workflowHolderVisibility(actor.tenantId, actor.uid,
      holders.map((h) => h.employeeId).filter((id): id is string => typeof id === "string"));
  } catch {
    throw new WorkflowRefusal("EMPLOYEE_VISIBILITY_UNAVAILABLE", "FORBIDDEN", "Employee visibility could not be established; no holder is shown");
  }
  const shown = holders
    .filter((h) => h.employeeId !== null && visibility.visible.has(h.employeeId))
    .map((h) => ({
      displayName: visibility.visible.get(h.employeeId as string)?.displayName ?? null,
      employeeId: h.employeeId as string,
      scope: { type: h.scopeType, value: h.scopeValue },
      appliesToAction: h.appliesToAction,
      /** Why the action does not apply to this holder (null when it does): ROLE_NOT_ELIGIBLE, CONDITIONED_GRANT, SCOPE_DOES_NOT_DECIDE. */
      notApplicableReason: h.reason,
    }))
    .sort((x, y) => String(x.displayName ?? "").localeCompare(String(y.displayName ?? "")) || x.employeeId.localeCompare(y.employeeId));
  // OWNER DECISION #221: every count is taken over the people this caller may VIEW as Employees -- the same set the names
  // come from. Nobody outside that visibility is named, counted or implied: no withheld count, and `truncated` is of the
  // visible list. A caller with no Employee visibility learns nothing about the Role's holders.
  return {
    roleKey: role.key,
    roleName: role.name,
    actionKey,
    roleEligible,
    roleBound,
    /** The holders this caller may view (people who could act at all -- see above). */
    totalHolders: shown.length,
    /** Of those, the holders for whom this action actually applies (eligible Role, scope that decides it, no condition). */
    holdersForAction: shown.filter((h) => h.appliesToAction).length,
    /** Whether the caller may view Employees at all -- about the CALLER only; it says nothing about the holders. */
    employeeVisibility: visibility.employeeReadHeld ? "EMPLOYEE_READ" : "NONE",
    truncated: shown.length > WORKFLOW_ROLE_HOLDER_LIMIT,
    holders: shown.slice(0, WORKFLOW_ROLE_HOLDER_LIMIT),
  };
}
