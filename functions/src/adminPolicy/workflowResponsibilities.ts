// An Employee's WORKFLOW RESPONSIBILITIES -- derived, never a second permission system.
//
//   responsibility = an action of an ACTIVE workflow version
//                    WHERE a Security Role the Principal holds is bound to it   (WORKFLOW_BINDING)
//                    AND the runtime evaluator allows its capability            (EFFECTIVE_AUTHORITY)
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
}

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
  /** ALLOWED, CONDITIONAL (decided per record, e.g. RECORD_ASSIGNMENT) or DENIED. */
  readonly authority: string;
  readonly reasonCode: string;
  readonly source: "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY";
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
}

/** Pure: bindings matching the Principal's Roles, intersected with effective authority. */
export function deriveWorkflowResponsibilities(
  principalId: string,
  active: readonly ActiveWorkflowDefinition[],
  explained: ExplainedAuthority,
): PrincipalWorkflowResponsibilities {
  const held = new Set(explained.securityRoleKeys);
  const authorityByCapability = new Map(explained.actions.map((a) => [a.capabilityKey, a]));
  const responsibilities: WorkflowResponsibility[] = [];
  const boundWithoutAuthority: WorkflowResponsibility[] = [];
  for (const { workflow, version, definition, roleKeyById } of active) {
    for (const action of definition.actions) {
      const viaRoles = definition.bindings
        .filter((b) => b.actionKey === action.key && (b.bindingKind ?? "SECURITY_ROLE") === "SECURITY_ROLE")
        .map((b) => roleKeyById.get(b.roleId))
        .filter((k): k is string => typeof k === "string" && held.has(k))
        .sort();
      if (viaRoles.length === 0) continue;
      const capabilityKey = action.capabilityKey ?? null;
      const explainedAction = capabilityKey ? authorityByCapability.get(capabilityKey) : undefined;
      const authority = explainedAction?.result ?? "DENIED";
      const entry: WorkflowResponsibility = Object.freeze({
        workflowId: workflow.id, workflowKey: workflow.key, workflowName: workflow.name, objectKey: workflow.objectKey,
        versionId: version.id, version: version.version,
        actionKey: action.key, actionLabel: action.label, from: action.fromStepKey, to: action.toStepKey,
        capabilityKey, guardKind: action.guardKind ?? (action.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
        viaRoles: Object.freeze(viaRoles),
        authority,
        reasonCode: capabilityKey ? (explainedAction?.reasonCode ?? "CAPABILITY_MISSING") : "ACTION_WITHOUT_CAPABILITY",
        source: "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY" as const,
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
  const roles = await reader.listRoles(tenantId);
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const out: ActiveWorkflowDefinition[] = [];
  for (const workflow of await reader.listWorkflows(tenantId)) {
    if (!workflow.activeVersionId) continue;
    const version = (await reader.listWorkflowVersions(tenantId, workflow.id)).find((v) => v.id === workflow.activeVersionId);
    if (!version || version.status !== "PUBLISHED") continue;
    out.push({ workflow, version, definition: await loadWorkflowVersionDefinition(reader, tenantId, version.id), roleKeyById });
  }
  return out;
}
