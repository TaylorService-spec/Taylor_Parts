"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowAuditIdentity = exports.WorkflowRefusal = exports.WorkflowAdministrationDeniedError = exports.WORKFLOW_MUTATION_CAPABILITY = exports.WORKFLOW_MUTATIONS = void 0;
exports.requireWorkflowAdministrationCapability = requireWorkflowAdministrationCapability;
exports.requireWorkflowReason = requireWorkflowReason;
exports.findWorkflowVersion = findWorkflowVersion;
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
const administrationAuthority_1 = require("./administrationAuthority");
const administrationCapabilityGate_1 = require("./administrationCapabilityGate");
const policyCommands_1 = require("./policyCommands");
exports.WORKFLOW_MUTATIONS = Object.freeze([
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
]);
const ACTION_BY_MUTATION = Object.freeze({
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
exports.WORKFLOW_MUTATION_CAPABILITY = Object.freeze(Object.fromEntries(exports.WORKFLOW_MUTATIONS.map((m) => [m, `workflowDefinition.${ACTION_BY_MUTATION[m]}`])));
/** Refusal of a workflow mutation for want of its capability. FORBIDDEN at the API. */
class WorkflowAdministrationDeniedError extends administrationAuthority_1.AdministrationDeniedError {
    operation;
    requiredCapability;
    constructor(operation, requiredCapability) {
        super("editWorkflowDefinition");
        this.operation = operation;
        this.requiredCapability = requiredCapability;
        this.message = `not authorized: "${requiredCapability}" is required`;
    }
}
exports.WorkflowAdministrationDeniedError = WorkflowAdministrationDeniedError;
/**
 * Refuse unless the actor's EFFECTIVE capability set holds the capability this mutation requires.
 * Authorization only: decided by administrationAuthority.decideWorkflowAdministration, the one
 * workflow-administration decision function, before anything else is read.
 */
async function requireWorkflowAdministrationCapability(reader, actor, operation) {
    const capabilities = await (0, administrationCapabilityGate_1.actorCapabilities)(reader, actor);
    const decision = (0, administrationAuthority_1.decideWorkflowAdministration)({
        capabilities, action: ACTION_BY_MUTATION[operation], wouldRemoveLastAdministrationPath: false,
    });
    if (!decision.allowed)
        throw new WorkflowAdministrationDeniedError(operation, exports.WORKFLOW_MUTATION_CAPABILITY[operation]);
}
/**
 * A governed refusal with a stable code. The API maps `category` to its failure code and shows the
 * message verbatim; `issues` carries every validation finding when publication was refused.
 */
class WorkflowRefusal extends policyCommands_1.PolicyValidationError {
    code;
    category;
    issues;
    constructor(code, category, message, issues = []) {
        super(`${code}: ${message}`);
        this.code = code;
        this.category = category;
        this.issues = issues;
    }
}
exports.WorkflowRefusal = WorkflowRefusal;
/** A reason with the request-id suffix removed must still say something. */
function requireWorkflowReason(reason) {
    const text = typeof reason === "string" ? reason.trim() : "";
    const withoutRequest = text.replace(/\s*\[request [^\]]*\]\s*$/, "").trim();
    if (withoutRequest.length === 0) {
        throw new WorkflowRefusal("REASON_REQUIRED", "INVALID_INPUT", "a reason is required for this workflow change");
    }
    return text;
}
/** The version row behind a version id, with its workflow -- tenant-scoped, NOT_FOUND otherwise. */
async function findWorkflowVersion(reader, actor, versionId) {
    for (const workflow of await reader.listWorkflows(actor.tenantId)) {
        for (const version of await reader.listWorkflowVersions(actor.tenantId, workflow.id)) {
            if (version.id === versionId)
                return { workflow, version };
        }
    }
    throw new WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", "workflow version not found");
}
/** The audit identity every workflow event carries: tenant is the row's, actor is actorUid. */
const workflowAuditIdentity = (workflow, version) => ({
    workflowId: workflow.id,
    workflowKey: workflow.key,
    objectKey: workflow.objectKey,
    ...(version ? { versionId: version.id, version: version.version, status: version.status } : {}),
});
exports.workflowAuditIdentity = workflowAuditIdentity;
//# sourceMappingURL=workflowAdministration.js.map