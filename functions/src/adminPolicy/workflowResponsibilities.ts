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
// PROVENANCE (lane WR, 2026-09-26). Every entry names the governed rows that produced it, so the Employee page can send an
// administrator to the ONE place that changes it -- never to a per-Employee workflow grant (there is none):
//
//   Employee -> Security Role assignment (global, or scoped: scopeType/scopeValue)   securityRoleSources
//            -> Functional Role assignment (narrows only)                             functionalRoleSources
//            -> workflow binding in the ACTIVE version (step/transition)               bindingId on each source
//            -> Role x capability grant (+ its condition)                              capabilityGrants
//   adminLocations = [{ kind: SECURITY_ROLE_ASSIGNMENT | FUNCTIONAL_ROLE_ASSIGNMENT | WORKFLOW_BINDING |
//                       ROLE_CAPABILITY_GRANT, id, ... }]
//
// A SCOPED Security Role assignment satisfies a binding only where the record's business context admits it (Pass 9 S5,
// transitionWorkflowInstance): such an entry is authority SCOPED (reasonCode SCOPE_CONTEXT_REQUIRED), decided per record.
//
// The effective-authority half is the explainEffectiveAccess answer -- the SAME evaluator the runtime
// uses (capabilitiesForRoleKeys -> authorizeOperationalAction, conditions from PostgreSQL). Nothing
// here resolves a capability itself. A binding whose capability the Principal does not effectively
// hold is listed under `boundWithoutAuthority` with the evaluator's reason, so an administrator sees
// that the binding confers nothing rather than assuming it does.
import type { PolicyReader } from "./policyRepository";
import type { TenantId, WorkflowRecord, WorkflowVersionRecord } from "./types";
import { loadWorkflowVersionDefinition, type WorkflowVersionDefinition } from "./workflowEngine";
import { scopeEvaluableCapabilities } from "./assignmentScopeRuntime";

/** The slice of the explainEffectiveAccess output this derivation reads. */
export interface ExplainedAuthority {
  readonly securityRoleKeys: readonly string[];
  readonly actions: readonly {
    readonly capabilityKey: string; readonly result: string; readonly reasonCode: string;
    readonly objectKey?: string;
    /** Held Security Roles granting it GLOBALLY, each with its grant condition (null = unconditional). */
    readonly sourceRoles?: readonly { readonly roleKey: string; readonly condition: unknown }[];
    /** Scoped assignments conferring it, each with its scope and condition. */
    readonly scopedSources?: readonly { readonly roleKey: string; readonly scopeType: string; readonly scopeValue: string;
      readonly condition: unknown }[];
  }[];
  /** Supported SCOPED Security Role assignments (explainEffectiveAccess.assignments.scoped). */
  readonly assignments?: {
    readonly scoped?: readonly { readonly assignmentId: string | null; readonly roleKey: string; readonly scopeType: string;
      readonly scopeValue: string }[];
  };
  readonly employeeId?: string | null;
  /** Employee FACTS (never a permission source). Absent = no linked Employee / no Functional Role. */
  readonly employeeFacts?: {
    readonly functionalRoles: readonly { readonly functionalRoleId: string; readonly key: string; readonly assignmentId?: string }[];
  };
}

/** The Principal's ACTIVE, GLOBAL Security Role assignments -- read by the transport, for provenance only. */
export interface GlobalRoleAssignment {
  readonly assignmentId: string;
  readonly roleKey: string;
}

/** Where an administrator changes the fact that produced (or blocks) a responsibility. Navigation, never authority. */
export type WorkflowResponsibilityAdminLocation =
  | { readonly kind: "SECURITY_ROLE_ASSIGNMENT"; readonly id: string | null; readonly roleKey: string;
    readonly scopeType: string; readonly scopeValue: string | null; readonly principalId: string }
  | { readonly kind: "FUNCTIONAL_ROLE_ASSIGNMENT"; readonly id: string | null; readonly functionalRoleKey: string;
    readonly functionalRoleId: string; readonly employeeId: string | null; readonly held: boolean }
  | { readonly kind: "WORKFLOW_BINDING"; readonly id: string; readonly workflowId: string; readonly workflowKey: string;
    readonly versionId: string; readonly version: number; readonly actionKey: string; readonly bindingKind: string;
    readonly boundKey: string }
  | { readonly kind: "ROLE_CAPABILITY_GRANT"; readonly id: string; readonly roleKey: string; readonly capabilityKey: string;
    readonly objectKey: string | null; readonly conditioned: boolean };

export interface WorkflowResponsibilitySecurityRoleSource {
  readonly roleKey: string;
  readonly roleId: string;
  readonly bindingId: string;
  readonly assignmentId: string | null;
  /** "global", or the assignment scope type (operatingCompany, ...). */
  readonly scopeType: string;
  readonly scopeValue: string | null;
}

export interface WorkflowResponsibilityFunctionalRoleSource {
  readonly functionalRoleKey: string;
  readonly functionalRoleId: string;
  readonly bindingId: string;
  readonly held: boolean;
  readonly assignmentId: string | null;
}

export interface WorkflowResponsibilityCapabilityGrant {
  readonly roleKey: string;
  readonly scopeType: string;
  readonly scopeValue: string | null;
  readonly condition: unknown;
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
  /** ALLOWED, CONDITIONAL (decided per record, e.g. RECORD_ASSIGNMENT), SCOPED (per record's business context) or DENIED. */
  readonly authority: string;
  readonly reasonCode: string;
  readonly source: WorkflowResponsibilitySource;
  /** The held Security Role assignments that satisfy the binding, with the binding row each matched. */
  readonly securityRoleSources: readonly WorkflowResponsibilitySecurityRoleSource[];
  /** Every FUNCTIONAL_ROLE binding on the action, and whether the linked Employee holds it now. */
  readonly functionalRoleSources: readonly WorkflowResponsibilityFunctionalRoleSource[];
  /** The Principal's Role grants of the action's capability (global and scoped), each with its condition. */
  readonly capabilityGrants: readonly WorkflowResponsibilityCapabilityGrant[];
  /** Distinct grant conditions on those grants (the per-record guard is `guardKind`). */
  readonly grantConditions: readonly unknown[];
  /** Where to change it: Security Role assignment, Functional Role assignment, workflow binding, Role grant. */
  readonly adminLocations: readonly WorkflowResponsibilityAdminLocation[];
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
  provenance: { readonly globalAssignments?: readonly GlobalRoleAssignment[] } = {},
): PrincipalWorkflowResponsibilities {
  const held = new Set(explained.securityRoleKeys);
  const functionalFacts = explained.employeeFacts?.functionalRoles ?? [];
  const heldFunctional = new Set(functionalFacts.map((f) => f.functionalRoleId));
  const functionalAssignmentOf = new Map(functionalFacts.map((f) => [f.functionalRoleId, f.assignmentId ?? null]));
  const authorityByCapability = new Map(explained.actions.map((a) => [a.capabilityKey, a]));
  const globalAssignmentsOf = (roleKey: string) => (provenance.globalAssignments ?? []).filter((a) => a.roleKey === roleKey);
  const scopedAssignments = explained.assignments?.scoped ?? [];
  const employeeId = explained.employeeId ?? null;
  const responsibilities: WorkflowResponsibility[] = [];
  const boundWithoutAuthority: WorkflowResponsibility[] = [];
  for (const { workflow, version, definition, roleKeyById, functionalRoleKeyById } of active) {
    for (const action of definition.actions) {
      const capabilityKey = action.capabilityKey ?? null;
      const bindings = definition.bindings.filter((b) => b.actionKey === action.key);
      const securityBindings = bindings.filter((b) => (b.bindingKind ?? "SECURITY_ROLE") === "SECURITY_ROLE" && b.roleId);
      // GLOBAL holders of a bound Role.
      const securityRoleSources: WorkflowResponsibilitySecurityRoleSource[] = [];
      for (const b of securityBindings) {
        const roleKey = roleKeyById.get(b.roleId as string);
        if (!roleKey) continue;
        if (held.has(roleKey)) {
          const assignments = globalAssignmentsOf(roleKey);
          for (const a of assignments.length > 0 ? assignments : [{ assignmentId: null, roleKey }]) {
            securityRoleSources.push(Object.freeze({ roleKey, roleId: b.roleId as string, bindingId: b.id,
              assignmentId: a.assignmentId, scopeType: "global", scopeValue: null }));
          }
        }
        // SCOPED holders: the binding counts only for a capability evaluable at that scope (holdingAdmits' rule).
        for (const a of scopedAssignments) {
          if (a.roleKey !== roleKey || !capabilityKey || !scopeEvaluableCapabilities(a.scopeType).has(capabilityKey)) continue;
          securityRoleSources.push(Object.freeze({ roleKey, roleId: b.roleId as string, bindingId: b.id,
            assignmentId: a.assignmentId, scopeType: a.scopeType, scopeValue: a.scopeValue }));
        }
      }
      const viaRoles = [...new Set(securityRoleSources.map((x) => x.roleKey))].sort();
      const globallyBound = securityRoleSources.some((x) => x.scopeType === "global");
      const functionalBindings = bindings.filter((b) => b.bindingKind === "FUNCTIONAL_ROLE" && b.functionalRoleId);
      const keyOf = (id: string) => functionalRoleKeyById?.get(id) ?? id;
      const functionalRoleSources: WorkflowResponsibilityFunctionalRoleSource[] = functionalBindings
        .map((b) => Object.freeze({ functionalRoleKey: keyOf(b.functionalRoleId as string), functionalRoleId: b.functionalRoleId as string,
          bindingId: b.id, held: heldFunctional.has(b.functionalRoleId as string),
          assignmentId: functionalAssignmentOf.get(b.functionalRoleId as string) ?? null }))
        .sort((x, y) => x.functionalRoleKey.localeCompare(y.functionalRoleKey));
      const requiredFunctionalRoles = functionalRoleSources.map((f) => f.functionalRoleKey);
      const viaFunctionalRoles = functionalRoleSources.filter((f) => f.held).map((f) => f.functionalRoleKey);
      if (viaRoles.length === 0 && viaFunctionalRoles.length === 0) continue;
      const explainedAction = capabilityKey ? authorityByCapability.get(capabilityKey) : undefined;
      let authority = explainedAction?.result ?? "DENIED";
      let reasonCode = capabilityKey ? (explainedAction?.reasonCode ?? "CAPABILITY_MISSING") : "ACTION_WITHOUT_CAPABILITY";
      let source: WorkflowResponsibilitySource = requiredFunctionalRoles.length > 0
        ? "WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY" : "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY";
      const allowing = (a: string) => a === "ALLOWED" || a === "CONDITIONAL" || a === "SCOPED";
      if (viaRoles.length === 0) {
        // Holds a bound Functional Role but no bound Security Role: the Functional Role confers NOTHING.
        authority = "DENIED"; reasonCode = "SECURITY_ROLE_BINDING_REQUIRED"; source = "FUNCTIONAL_ROLE_BINDING_ONLY";
      } else if (requiredFunctionalRoles.length > 0 && viaFunctionalRoles.length === 0 && allowing(authority)) {
        authority = "DENIED"; reasonCode = "FUNCTIONAL_ROLE_REQUIRED";
      } else if (!globallyBound && allowing(authority)) {
        // Bound ONLY through a scoped assignment: the binding itself is admitted per record's business context.
        authority = "SCOPED"; reasonCode = "SCOPE_CONTEXT_REQUIRED";
      }
      const capabilityGrants: WorkflowResponsibilityCapabilityGrant[] = [
        ...(explainedAction?.sourceRoles ?? []).map((r) => Object.freeze({ roleKey: r.roleKey, scopeType: "global", scopeValue: null, condition: r.condition ?? null })),
        ...(explainedAction?.scopedSources ?? []).map((r) => Object.freeze({ roleKey: r.roleKey, scopeType: r.scopeType, scopeValue: r.scopeValue, condition: r.condition ?? null })),
      ];
      const grantConditions = [...new Map(capabilityGrants.filter((g) => g.condition !== null)
        .map((g) => [JSON.stringify(g.condition), g.condition])).values()];
      const adminLocations: WorkflowResponsibilityAdminLocation[] = [
        ...securityRoleSources.map((x) => Object.freeze({ kind: "SECURITY_ROLE_ASSIGNMENT" as const, id: x.assignmentId,
          roleKey: x.roleKey, scopeType: x.scopeType, scopeValue: x.scopeValue, principalId })),
        ...functionalRoleSources.map((f) => Object.freeze({ kind: "FUNCTIONAL_ROLE_ASSIGNMENT" as const, id: f.assignmentId,
          functionalRoleKey: f.functionalRoleKey, functionalRoleId: f.functionalRoleId, employeeId, held: f.held })),
        ...[...securityBindings.filter((b) => viaRoles.includes(roleKeyById.get(b.roleId as string) ?? "")), ...functionalBindings]
          .map((b) => Object.freeze({ kind: "WORKFLOW_BINDING" as const, id: b.id, workflowId: workflow.id, workflowKey: workflow.key,
            versionId: version.id, version: version.version, actionKey: action.key, bindingKind: b.bindingKind ?? "SECURITY_ROLE",
            boundKey: b.bindingKind === "FUNCTIONAL_ROLE" ? keyOf(b.functionalRoleId as string) : (roleKeyById.get(b.roleId as string) ?? String(b.roleId)) })),
        ...(capabilityKey
          ? (capabilityGrants.length > 0 ? [...new Set(capabilityGrants.map((g) => g.roleKey))] : viaRoles).map((roleKey) => Object.freeze({
            kind: "ROLE_CAPABILITY_GRANT" as const, id: `${roleKey}:${capabilityKey}`, roleKey, capabilityKey,
            objectKey: explainedAction?.objectKey ?? workflow.objectKey ?? null,
            conditioned: capabilityGrants.some((g) => g.roleKey === roleKey && g.condition !== null) }))
          : []),
      ];
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
        securityRoleSources: Object.freeze(securityRoleSources),
        functionalRoleSources: Object.freeze(functionalRoleSources),
        capabilityGrants: Object.freeze(capabilityGrants),
        grantConditions: Object.freeze(grantConditions),
        adminLocations: Object.freeze(adminLocations),
      });
      if (allowing(authority)) responsibilities.push(entry);
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
