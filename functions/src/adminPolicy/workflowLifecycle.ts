// A workflow version's LIFECYCLE: DRAFT -> PUBLISHED (ACTIVE) -> RETIRED.
//
//   publish     DRAFT -> PUBLISHED, only when validation finds no ERROR (fail closed), and the
//               workflow's active pointer moves to it in the SAME transaction. The previously
//               active version stays PUBLISHED: instances pinned to it keep running on it.
//   activate    point the workflow at another PUBLISHED version (a rollback). New instances start
//               there; existing instances are untouched.
//   retire      DRAFT|PUBLISHED -> RETIRED. REFUSED while the version is active or any instance
//               still pins it -- move them first with migrateWorkflowInstances.
//
// Each is ONE transaction with ONE audit event (actor, tenant, workflow, version, previous/new,
// reason). The store and the database triggers (migration 1762732800000) refuse the same illegal
// moves independently, so a writer that skipped this layer still cannot make them.
import { loadWorkflowVersionDefinition } from "./workflowEngine";
import {
  findWorkflowVersion,
  requireWorkflowAdministrationCapability,
  requireWorkflowReason,
  workflowAuditIdentity,
  WorkflowRefusal,
} from "./workflowAdministration";
import {
  loadWorkflowValidationContext,
  storedDefinitionView,
  validateWorkflowDefinition,
  type WorkflowValidationResult,
} from "./workflowValidation";
import { PolicyValidationError, type AdminActor } from "./policyCommands";
import type { PolicyReader, PolicyRepository } from "./policyRepository";
import type { WorkflowRecord, WorkflowVersionRecord } from "./types";

const audit = (actor: AdminActor, action: string, targetId: string, reason: string | null) => ({
  action,
  actorUid: actor.uid,
  targetKind: "workflowVersion",
  targetId,
  occurredAt: new Date().toISOString(),
  reason,
});

/** Validate one stored version against the tenant's current Objects, catalog, Roles and grants. */
export async function validateStoredWorkflowVersion(
  reader: PolicyReader,
  actor: Pick<AdminActor, "tenantId">,
  versionId: string,
): Promise<WorkflowValidationResult & { readonly workflow: WorkflowRecord; readonly version: WorkflowVersionRecord }> {
  const { workflow, version } = await findWorkflowVersion(reader, actor, versionId);
  const definition = await loadWorkflowVersionDefinition(reader, actor.tenantId, versionId);
  const [view, context] = await Promise.all([
    storedDefinitionView(reader, actor.tenantId, workflow.objectKey, definition),
    loadWorkflowValidationContext(reader, actor.tenantId),
  ]);
  return { ...validateWorkflowDefinition(view, context), workflow, version };
}

export interface PublishWorkflowVersionInput {
  readonly versionId: string;
  readonly reason?: string | null;
}

/**
 * Publish a DRAFT and make it the ACTIVE version.
 *
 * FAIL CLOSED: any validation ERROR refuses with WORKFLOW_VALIDATION_FAILED and every finding in
 * `issues` -- including BINDING_WITHOUT_CAPABILITY, which is how a stale binding (a Role bound to
 * an action whose capability it does not hold) is stopped before it could ever look like authority.
 */
export async function publishWorkflowVersion(
  repo: PolicyRepository,
  actor: AdminActor,
  input: PublishWorkflowVersionInput,
): Promise<WorkflowVersionRecord> {
  await requireWorkflowAdministrationCapability(repo, actor, "publishWorkflowVersion");
  const versionId = requireId(input.versionId, "versionId");
  const result = await validateStoredWorkflowVersion(repo, actor, versionId);
  const { workflow, version } = result;
  if (version.status !== "DRAFT") {
    throw new WorkflowRefusal("WORKFLOW_INVALID_LIFECYCLE", "CONFLICT",
      `workflow version ${version.version} is ${version.status}; only a DRAFT can be published -- create a new version`);
  }
  if (!result.valid) {
    throw new WorkflowRefusal("WORKFLOW_VALIDATION_FAILED", "INVALID_INPUT",
      `workflow version cannot be published: ${result.errors.map((e) => `${e.code} ${e.message}`).join("; ")}`,
      result.errors);
  }

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const published = await tx.publishWorkflowVersion(versionId);
    const activated = await tx.setWorkflowActiveVersion(workflow.id, published.id);
    await tx.appendAudit({
      ...audit(actor, "publishWorkflowVersion", versionId, input.reason ?? null),
      before: { ...workflowAuditIdentity(workflow, version), activeVersionId: workflow.activeVersionId ?? null },
      after: {
        ...workflowAuditIdentity(activated, published),
        activeVersionId: activated.activeVersionId ?? null,
        publishedAt: published.publishedAt,
        publishedBy: published.publishedBy,
        warnings: result.warnings.map((w) => w.code),
      },
    });
    return published;
  });
}

export interface ActivateWorkflowVersionInput {
  readonly versionId: string;
  readonly reason?: string | null;
}

/** Point the workflow at another PUBLISHED version. Existing instances are untouched. */
export async function activateWorkflowVersion(
  repo: PolicyRepository,
  actor: AdminActor,
  input: ActivateWorkflowVersionInput,
): Promise<WorkflowRecord> {
  await requireWorkflowAdministrationCapability(repo, actor, "activateWorkflowVersion");
  const versionId = requireId(input.versionId, "versionId");
  const reason = requireWorkflowReason(input.reason);
  const { workflow, version } = await findWorkflowVersion(repo, actor, versionId);
  if (version.status !== "PUBLISHED") {
    throw new WorkflowRefusal("WORKFLOW_INVALID_LIFECYCLE", "CONFLICT",
      `workflow version ${version.version} is ${version.status}; only a PUBLISHED version can be active`);
  }
  // A no-op writes nothing -- and no audit event.
  if (workflow.activeVersionId === versionId) return workflow;

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const updated = await tx.setWorkflowActiveVersion(workflow.id, versionId);
    await tx.appendAudit({
      ...audit(actor, "activateWorkflowVersion", versionId, reason),
      before: { ...workflowAuditIdentity(workflow, version), activeVersionId: workflow.activeVersionId ?? null },
      after: { ...workflowAuditIdentity(updated, version), activeVersionId: updated.activeVersionId ?? null },
    });
    return updated;
  });
}

export interface RetireWorkflowVersionInput {
  readonly versionId: string;
  readonly reason?: string | null;
}

/** Retire a version nothing runs on. Refused while it is active or pinned by an instance. */
export async function retireWorkflowVersion(
  repo: PolicyRepository,
  actor: AdminActor,
  input: RetireWorkflowVersionInput,
): Promise<WorkflowVersionRecord> {
  await requireWorkflowAdministrationCapability(repo, actor, "retireWorkflowVersion");
  const versionId = requireId(input.versionId, "versionId");
  const reason = requireWorkflowReason(input.reason);
  const { workflow, version } = await findWorkflowVersion(repo, actor, versionId);
  if (version.status === "RETIRED") return version;
  if (workflow.activeVersionId === versionId) {
    throw new WorkflowRefusal("WORKFLOW_VERSION_ACTIVE", "CONFLICT",
      `workflow version ${version.version} is the ACTIVE version; activate another version before retiring it`);
  }
  const pinned = await repo.listWorkflowInstances(actor.tenantId, versionId);
  if (pinned.length > 0) {
    throw new WorkflowRefusal("WORKFLOW_VERSION_PINNED", "CONFLICT",
      `${pinned.length} live instance(s) are pinned to workflow version ${version.version}; migrate them first`);
  }

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const retired = await tx.retireWorkflowVersion(versionId);
    await tx.appendAudit({
      ...audit(actor, "retireWorkflowVersion", versionId, reason),
      before: { ...workflowAuditIdentity(workflow, version) },
      after: { ...workflowAuditIdentity(workflow, retired) },
    });
    return retired;
  });
}

function requireId(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new PolicyValidationError(`${what} is required`);
  return value.trim();
}
