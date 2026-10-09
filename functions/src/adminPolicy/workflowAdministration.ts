// Who may change a WORKFLOW -- the capability gate -- and the refusals workflow administration raises.
//
// ════════════════════ CAPABILITY, NEVER A ROLE NAME ════════════════════
//
// Every workflow mutation is authorized by ONE registered `workflowDefinition.*` capability,
// resolved from PostgreSQL exactly like security administration (administrationCapabilityGate:
// actor.capabilities, else the actor's qualifying Role keys -> role_capabilities UNION direct
// principal_capabilities). Holding a Role called `admin` authorizes nothing here; holding the
// capability through any Role or a direct grant authorizes exactly the operations mapped to it.
//
//   OPERATION                                                      CAPABILITY (registered, 1761350400000)
//   createWorkflowDraft, applyWorkflowSeed (new workflow)          workflowDefinition.create
//   createWorkflowVersion, applyWorkflowSeed (next version)        workflowDefinition.version
//   updateWorkflowDefinition                                       workflowDefinition.edit
//   setWorkflowRoleBinding                                         workflowDefinition.bindRole
//   publishWorkflowVersion, activateWorkflowVersion,               workflowDefinition.publish
//   retireWorkflowVersion, startWorkflowInstance,
//   adoptRecordsIntoWorkflowVersion, migrateWorkflowInstances
//   reads (Administration > Workflows)                             workflowDefinition.read
//
// Publish-class for the instance operations, deliberately: activating a version, adopting records
// into one and migrating instances between two are all the same decision -- WHICH published rules
// govern live records -- and splitting them would let a principal who may not publish still move
// records onto rules they could not have published.
//
// ════════════════════ HOW THE FIRST ADMINISTRATOR GETS WORKFLOW AUTHORITY ════════════════════
//
// NOT by a migration. migrationChainSafety holds every workflowDefinition.* grant except the ruled
// read (admin, owner) at zero in the migration chain, and this lane keeps it so. The path is:
//
//   1. bootstrapAdministrator (tenantBootstrap.ts) grants ADMINISTRATION_BOOTSTRAP_GRANTS with the
//      first Admin -- admin.securityPolicy.write among them.
//   2. That administrator grants the workflow capabilities through Administration, one audited
//      ADMIN_GRANTED decision per cell:
//        grantObjectActionToRole {objectKey: "workflowDefinition", actionKey: "publish", roleKey, reason}
//      (and create / edit / version / bindRole as the tenant decides).
//   3. Pass 8 separation of duties applies: no principal grants a capability to a Role it HOLDS, and
//      none assigns itself. So the grant goes to a Role the administrator does not hold (e.g. a
//      "Workflow Administrator" Role made with createRole) and that Role is assigned to ANOTHER
//      principal. A lone first administrator therefore cannot give THEMSELVES workflow authority --
//      a second principal is required (reported for an Owner decision).
//
// Lockout is recoverable by construction: the holder of admin.securityPolicy.write -- whom the
// anti-lockout guard keeps at >= 1 -- can always re-grant a workflow capability.
import { AdministrationDeniedError, decideWorkflowAdministration } from "./administrationAuthority";
import type { WorkflowAdministrationAction } from "./administrationAuthority";
import { actorCapabilities, type CapabilityBearingActor } from "./administrationCapabilityGate";
import { PolicyValidationError } from "./policyCommands";
import type { AdminActor } from "./policyCommands";
import type { PolicyReader } from "./policyRepository";
import type { WorkflowRecord, WorkflowVersionRecord } from "./types";
import type { WorkflowValidationIssue } from "./workflowValidation";

export const WORKFLOW_MUTATIONS = Object.freeze([
  "createWorkflowDraft",
  "applyWorkflowSeed",
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
export type WorkflowMutation = (typeof WORKFLOW_MUTATIONS)[number];

const ACTION_BY_MUTATION: Readonly<Record<WorkflowMutation, WorkflowAdministrationAction>> = Object.freeze({
  createWorkflowDraft: "create",
  applyWorkflowSeed: "create",
  createWorkflowVersion: "version",
  updateWorkflowDefinition: "edit",
  setWorkflowRoleBinding: "bindRole",
  publishWorkflowVersion: "publish",
  activateWorkflowVersion: "publish",
  retireWorkflowVersion: "publish",
  startWorkflowInstance: "publish",
  adoptRecordsIntoWorkflowVersion: "publish",
  migrateWorkflowInstances: "publish",
});

/** The capability each workflow mutation requires. Derived from the ONE registered map. */
export const WORKFLOW_MUTATION_CAPABILITY: Readonly<Record<WorkflowMutation, string>> = Object.freeze(
  Object.fromEntries(WORKFLOW_MUTATIONS.map((m) => [m, `workflowDefinition.${ACTION_BY_MUTATION[m]}`])) as
    Record<WorkflowMutation, string>,
);

/** Refusal of a workflow mutation for want of its capability. FORBIDDEN at the API. */
export class WorkflowAdministrationDeniedError extends AdministrationDeniedError {
  constructor(readonly operation: WorkflowMutation, readonly requiredCapability: string) {
    super("editWorkflowDefinition");
    this.message = `not authorized: "${requiredCapability}" is required`;
  }
}

/**
 * Refuse unless the actor's EFFECTIVE capability set holds the capability this mutation requires.
 * Authorization only: decided by administrationAuthority.decideWorkflowAdministration, the one
 * workflow-administration decision function, before anything else is read.
 */
/**
 * THE one decision for a workflow mutation, given the caller's effective capabilities. Both the enforcement below and
 * the read-only self answer (readMyWorkflowAdministration) call this, so what the UI is told can never differ from
 * what the server will do.
 */
export function decideWorkflowMutation(capabilities: ReadonlySet<string>, operation: WorkflowMutation): boolean {
  return decideWorkflowAdministration({
    capabilities, action: ACTION_BY_MUTATION[operation], wouldRemoveLastAdministrationPath: false,
  }).allowed;
}

export async function requireWorkflowAdministrationCapability(
  reader: PolicyReader,
  actor: CapabilityBearingActor,
  operation: WorkflowMutation,
): Promise<void> {
  const capabilities = await actorCapabilities(reader, actor);
  if (!decideWorkflowMutation(capabilities, operation)) {
    throw new WorkflowAdministrationDeniedError(operation, WORKFLOW_MUTATION_CAPABILITY[operation]);
  }
}

export type WorkflowRefusalCode =
  | "WORKFLOW_ACTION_NOT_FOUND"
  | "ROLE_NOT_FOR_ACTION"
  | "EMPLOYEE_VISIBILITY_UNAVAILABLE"
  | "WORKFLOW_ASSIGNMENT_CAPABILITY_REQUIRED"
  | "WORKFLOW_VALIDATION_FAILED"
  | "WORKFLOW_INVALID_LIFECYCLE"
  | "WORKFLOW_VERSION_ACTIVE"
  | "WORKFLOW_VERSION_PINNED"
  | "WORKFLOW_NO_ACTIVE_VERSION"
  | "WORKFLOW_INSTANCE_EXISTS"
  | "WORKFLOW_STEP_MAP_INCOMPLETE"
  | "WORKFLOW_STEP_MAP_INVALID"
  | "WORKFLOW_VERSION_MISMATCH"
  | "WORKFLOW_ACTION_REFUSED"
  | "WORKFLOW_NOT_FOUND"
  | "REASON_REQUIRED";

export type WorkflowRefusalCategory = "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN";

/**
 * A governed refusal with a stable code. The API maps `category` to its failure code and shows the
 * message verbatim; `issues` carries every validation finding when publication was refused.
 */
export class WorkflowRefusal extends PolicyValidationError {
  constructor(
    readonly code: WorkflowRefusalCode,
    readonly category: WorkflowRefusalCategory,
    message: string,
    readonly issues: readonly WorkflowValidationIssue[] = [],
  ) {
    super(`${code}: ${message}`);
  }
}

/** A reason with the request-id suffix removed must still say something. */
export function requireWorkflowReason(reason: string | null | undefined): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  const withoutRequest = text.replace(/\s*\[request [^\]]*\]\s*$/, "").trim();
  if (withoutRequest.length === 0) {
    throw new WorkflowRefusal("REASON_REQUIRED", "INVALID_INPUT", "a reason is required for this workflow change");
  }
  return text;
}

/** The version row behind a version id, with its workflow -- tenant-scoped, NOT_FOUND otherwise. */
export async function findWorkflowVersion(
  reader: PolicyReader,
  actor: Pick<AdminActor, "tenantId">,
  versionId: string,
): Promise<{ workflow: WorkflowRecord; version: WorkflowVersionRecord }> {
  for (const workflow of await reader.listWorkflows(actor.tenantId)) {
    for (const version of await reader.listWorkflowVersions(actor.tenantId, workflow.id)) {
      if (version.id === versionId) return { workflow, version };
    }
  }
  throw new WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", "workflow version not found");
}

/** The audit identity every workflow event carries: tenant is the row's, actor is actorUid. */
export const workflowAuditIdentity = (workflow: WorkflowRecord, version?: WorkflowVersionRecord | null) => ({
  workflowId: workflow.id,
  workflowKey: workflow.key,
  objectKey: workflow.objectKey,
  ...(version ? { versionId: version.id, version: version.version, status: version.status } : {}),
});
