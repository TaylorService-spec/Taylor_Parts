// An Employee's WORKFLOW RESPONSIBILITIES -- derived, never a second permission system.
//
//   responsibility = an action of an ACTIVE workflow version
//                    WHERE a Security Role the Principal holds is bound to it   (WORKFLOW_BINDING)
//                    AND the runtime evaluator allows its capability            (EFFECTIVE_AUTHORITY)
//                    AND, if the action has FUNCTIONAL_ROLE bindings, the linked Employee currently holds one
//                    (FUNCTIONAL_ROLE -- read from explainEffectiveAccess's employeeFacts; it narrows, never grants)
//
// `source` names which rule produced the entry. A Functional Role the Employee holds that is bound to an action the
// Principal is NOT bound to through a Security Role (or lacks the capability for) is listed under
// `boundWithoutAuthority` with its reason -- the proof, on screen, that a Functional Role confers nothing by itself.
//
// The effective-authority half is the explainEffectiveAccess answer -- the SAME evaluator the runtime
// uses (capabilitiesForRoleKeys -> authorizeOperationalAction, conditions from PostgreSQL). Nothing
// here resolves a capability itself. A binding whose capability the Principal does not effectively
// hold is listed under `boundWithoutAuthority` with the evaluator's reason, so an administrator sees
// that the binding confers nothing rather than assuming it does.
import type { PolicyReader } from "./policyRepository";
import type { TenantId, WorkflowRecord, WorkflowVersionRecord } from "./types";
import { loadWorkflowVersionDefinition, type WorkflowVersionDefinition } from "./workflowEngine";

/** The slice of the explainEffectiveAccess output this derivation reads. */
export interface ExplainedAuthority {
  readonly securityRoleKeys: readonly string[];
  readonly actions: readonly { readonly capabilityKey: string; readonly result: string; readonly reasonCode: string }[];
  /** Employee FACTS (never a permission source). Absent = no linked Employee / no Functional Role. */
  readonly employeeFacts?: {
    readonly functionalRoles: readonly { readonly functionalRoleId: string; readonly key: string }[];
  };
}

export type WorkflowResponsibilitySource =
  | "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY"
  | "WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY"
  /** Only a Functional Role binding matches: no Security Role binding, so it confers nothing. */
  | "FUNCTIONAL_ROLE_BINDING_ONLY";

export interface WorkflowResponsibility {
  readonly workflowId: string;
  readonly workflowKey: string;
  readonly workflowName: string;
  readonly objectKey: string | null;
  readonly versionId: string;
  readonly version: number;
  readonly actionKey: string;
  readonly actionLabel: string;
  readonly from: string;
  readonly to: string;
  readonly capabilityKey: string | null;
  readonly guardKind: string | null;
  /** The Principal's Security Roles bound to this action. */
  readonly viaRoles: readonly string[];
  /** Functional Role keys bound to this action (the action requires one of them); empty = no FUNCTIONAL_ROLE binding. */
  readonly requiredFunctionalRoles: readonly string[];
  /** The bound Functional Roles the linked Employee currently holds. */
  readonly viaFunctionalRoles: readonly string[];
  /** ALLOWED, CONDITIONAL (decided per record, e.g. RECORD_ASSIGNMENT) or DENIED. */
  readonly authority: string;
  readonly reasonCode: string;
  readonly source: WorkflowResponsibilitySource;
}

export interface PrincipalWorkflowResponsibilities {
  readonly principalId: string;
  readonly securityRoleKeys: readonly string[];
  readonly responsibilities: readonly WorkflowResponsibility[];
  /** Bound through a held Role, but the evaluator does not allow the capability. Confers nothing. */
  readonly boundWithoutAuthority: readonly WorkflowResponsibility[];
}

export interface ActiveWorkflowDefinition {
  readonly workflow: WorkflowRecord;
  readonly version: WorkflowVersionRecord;
  readonly definition: WorkflowVersionDefinition;
  /** role id -> role key, for this tenant. */
  readonly roleKeyById: ReadonlyMap<string, string>;
  /** Functional Role id -> key, for this tenant. */
  readonly functionalRoleKeyById?: ReadonlyMap<string, string>;
}

/** Pure: bindings matching the Principal's Roles, intersected with effective authority. */
export function deriveWorkflowResponsibilities(
  principalId: string,
  active: readonly ActiveWorkflowDefinition[],
  explained: ExplainedAuthority,
): PrincipalWorkflowResponsibilities {
  const held = new Set(explained.securityRoleKeys);
  const heldFunctional = new Set((explained.employeeFacts?.functionalRoles ?? []).map((f) => f.functionalRoleId));
  const authorityByCapability = new Map(explained.actions.map((a) => [a.capabilityKey, a]));
  const responsibilities: WorkflowResponsibility[] = [];
  const boundWithoutAuthority: WorkflowResponsibility[] = [];
  for (const { workflow, version, definition, roleKeyById, functionalRoleKeyById } of active) {
    for (const action of definition.actions) {
      const bindings = definition.bindings.filter((b) => b.actionKey === action.key);
      const viaRoles = bindings
        .filter((b) => (b.bindingKind ?? "SECURITY_ROLE") === "SECURITY_ROLE")
        .map((b) => roleKeyById.get(b.roleId ?? ""))
        .filter((k): k is string => typeof k === "string" && held.has(k))
        .sort();
      const functionalBindings = bindings.filter((b) => b.bindingKind === "FUNCTIONAL_ROLE" && b.functionalRoleId);
      const keyOf = (id: string) => functionalRoleKeyById?.get(id) ?? id;
      const requiredFunctionalRoles = functionalBindings.map((b) => keyOf(b.functionalRoleId as string)).sort();
      const viaFunctionalRoles = functionalBindings
        .filter((b) => heldFunctional.has(b.functionalRoleId as string))
        .map((b) => keyOf(b.functionalRoleId as string)).sort();
      if (viaRoles.length === 0 && viaFunctionalRoles.length === 0) continue;
      const capabilityKey = action.capabilityKey ?? null;
      const explainedAction = capabilityKey ? authorityByCapability.get(capabilityKey) : undefined;
      let authority = explainedAction?.result ?? "DENIED";
      let reasonCode = capabilityKey ? (explainedAction?.reasonCode ?? "CAPABILITY_MISSING") : "ACTION_WITHOUT_CAPABILITY";
      let source: WorkflowResponsibilitySource = requiredFunctionalRoles.length > 0
        ? "WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY" : "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY";
      if (viaRoles.length === 0) {
        // Holds a bound Functional Role but no bound Security Role: the Functional Role confers NOTHING.
        authority = "DENIED"; reasonCode = "SECURITY_ROLE_BINDING_REQUIRED"; source = "FUNCTIONAL_ROLE_BINDING_ONLY";
      } else if (requiredFunctionalRoles.length > 0 && viaFunctionalRoles.length === 0 && (authority === "ALLOWED" || authority === "CONDITIONAL")) {
        authority = "DENIED"; reasonCode = "FUNCTIONAL_ROLE_REQUIRED";
      }
      const entry: WorkflowResponsibility = Object.freeze({
        workflowId: workflow.id, workflowKey: workflow.key, workflowName: workflow.name, objectKey: workflow.objectKey,
        versionId: version.id, version: version.version,
        actionKey: action.key, actionLabel: action.label, from: action.fromStepKey, to: action.toStepKey,
        capabilityKey, guardKind: action.guardKind ?? (action.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
        viaRoles: Object.freeze(viaRoles),
        requiredFunctionalRoles: Object.freeze(requiredFunctionalRoles),
        viaFunctionalRoles: Object.freeze(viaFunctionalRoles),
        authority,
        reasonCode,
        source,
      });
      if (authority === "ALLOWED" || authority === "CONDITIONAL") responsibilities.push(entry);
      else boundWithoutAuthority.push(entry);
    }
  }
  return Object.freeze({
    principalId,
    securityRoleKeys: Object.freeze([...explained.securityRoleKeys]),
    responsibilities: Object.freeze(responsibilities),
    boundWithoutAuthority: Object.freeze(boundWithoutAuthority),
  });
}

/** Every workflow's ACTIVE version, loaded once. A workflow with no active version runs nothing. */
export async function loadActiveWorkflowDefinitions(
  reader: PolicyReader,
  tenantId: TenantId,
): Promise<readonly ActiveWorkflowDefinition[]> {
  const [roles, functionalRoles] = await Promise.all([reader.listRoles(tenantId), reader.listFunctionalRoles(tenantId)]);
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const functionalRoleKeyById = new Map(functionalRoles.map((f) => [f.id, f.key]));
  const out: ActiveWorkflowDefinition[] = [];
  for (const workflow of await reader.listWorkflows(tenantId)) {
    if (!workflow.activeVersionId) continue;
    const version = (await reader.listWorkflowVersions(tenantId, workflow.id)).find((v) => v.id === workflow.activeVersionId);
    if (!version || version.status !== "PUBLISHED") continue;
    out.push({ workflow, version, definition: await loadWorkflowVersionDefinition(reader, tenantId, version.id), roleKeyById, functionalRoleKeyById });
  }
  return out;
}
