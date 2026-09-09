// Editing a workflow DEFINITION — draft creation, revision, Role binding, publication.
//
// ════════════════════ WHY THESE ARE NOT IN policyCommands.ts ════════════════════
//
// policyCommands.ts owns DATA authority: Objects, Fields, Roles, CRED, assignment. These own
// WORKFLOW authority: which business actions exist and who may perform them. Owner ruling D-5 made
// that separation load-bearing rather than cosmetic — a workflow action is never a CRED checkbox
// and a CRED grant never buys a transition — and two files is the cheapest way to keep a later edit
// from quietly blurring it back together.
//
// ════════════════════ A DRAFT IS EDITABLE. A PUBLISHED VERSION IS NOT. ════════════════════
//
// Editing works by REPLACING a draft's definition, not by patching individual steps: a workflow is
// a graph, and a per-edge edit API makes it trivially easy to leave one that is unreachable,
// two-initial, or leaving a terminal state. The whole definition is validated as a unit and stored
// as a unit.
//
// A PUBLISHED version is refused by the store as well as here, so a writer that skipped this layer
// still cannot rewrite history under a running process.
//
// ════════════════════ EDITING IS NOT ROUTING ════════════════════
//
// Nothing in this file changes how a record moves. The Parts/Purchasing, Work Order and Sales
// machines that run today run from the code they always did; these definitions are DRAFTS measured
// from that code. Publishing one does not reroute execution either — that is a later, separately
// authorized step, and until it is taken a published version is a statement about intent rather
// than a live process.
import { requireAdministrationAuthority } from "./administrationAuthority";
import { PolicyValidationError } from "./policyCommands";
import { loadWorkflowVersionDefinition, validateWorkflowVersion } from "./workflowEngine";
import type { AdminActor } from "./policyCommands";
import type { PolicyRepository } from "./policyRepository";
import type {
  WorkflowRecord,
  WorkflowRoleBindingRecord,
  WorkflowVersionRecord,
} from "./types";

const nonEmpty = (v: unknown, what: string): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new PolicyValidationError(`${what} is required`);
  return v.trim();
};

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;
const validKey = (v: unknown, what: string): string => {
  const s = nonEmpty(v, what);
  if (!KEY_PATTERN.test(s)) throw new PolicyValidationError(`${what} must be a simple identifier`);
  return s;
};

const auditBase = (actor: AdminActor, action: string, targetId: string, reason: string | null) => ({
  action,
  actorUid: actor.uid,
  targetKind: "workflowVersion",
  targetId,
  occurredAt: new Date().toISOString(),
  reason,
});

/** One state a record may sit in. */
export interface WorkflowStepInput {
  readonly key: string;
  readonly label: string;
  readonly initial?: boolean;
  readonly terminal?: boolean;
}

/** One action, and the Roles permitted to perform it. */
export interface WorkflowActionInput {
  readonly key: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly requiresOwnAssignment?: boolean;
  /** Role KEYS. Resolved to ids here; a key this tenant does not have is REPORTED, never invented. */
  readonly roleKeys?: readonly string[];
  /** The capability this action is measured to require. Recorded, never turned into a CRED cell. */
  readonly capabilityId?: string | null;
}

export interface WorkflowDefinitionInput {
  readonly steps: readonly WorkflowStepInput[];
  readonly actions: readonly WorkflowActionInput[];
}

export interface WorkflowDraftResult {
  readonly workflow: WorkflowRecord;
  readonly version: WorkflowVersionRecord;
  readonly stepCount: number;
  readonly actionCount: number;
  readonly bindingCount: number;
  /** Role keys the definition binds that this tenant does not have. Named, never created. */
  readonly missingRoleKeys: readonly string[];
}

export interface CreateWorkflowDraftInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  /** The Object whose records this workflow governs. D-5: the record owns its transitions. */
  readonly objectKey: string;
  readonly definition: WorkflowDefinitionInput;
  readonly reason?: string | null;
}

/**
 * Create a NEW workflow and its first DRAFT version.
 *
 * Refuses a key the tenant already has: two workflows answering to one key is the ambiguity that
 * makes "which definition governs this record" unanswerable.
 */
export async function createWorkflowDraft(
  repo: PolicyRepository,
  actor: AdminActor,
  input: CreateWorkflowDraftInput,
): Promise<WorkflowDraftResult> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editWorkflowDefinition");
  const key = validKey(input.key, "workflow key");
  const name = nonEmpty(input.name, "name");
  const objectKey = nonEmpty(input.objectKey, "objectKey");

  const existing = (await repo.listWorkflows(actor.tenantId)).find((w) => w.key === key);
  if (existing) throw new PolicyValidationError(`workflow "${key}" already exists`);

  // The Object must exist. A workflow governing a record type the tenant does not have is a
  // definition nothing can ever run against.
  const object = await repo.getObjectByKey(actor.tenantId, objectKey);
  if (!object) throw new PolicyValidationError(`no object "${objectKey}"`);

  const definition = validateDefinitionShape(input.definition);
  const { roleIdByKey, missingRoleKeys } = await resolveRoles(repo, actor, definition);

  const result = await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const workflow = await tx.createWorkflow({
      key,
      name,
      description: input.description ?? null,
      objectKey,
      origin: "CUSTOM",
    });
    const version = await tx.createWorkflowVersion({
      workflowId: workflow.id,
      version: 1,
      status: "DRAFT",
      publishedAt: null,
      publishedBy: null,
    });
    const counts = await writeDefinition(tx, version.id, definition, roleIdByKey);
    await tx.appendAudit({
      ...auditBase(actor, "createWorkflowDraft", version.id, input.reason ?? null),
      before: null,
      after: { workflowKey: key, version: 1, objectKey, ...counts, missingRoleKeys },
    });
    return { workflow, version, ...counts, missingRoleKeys };
  });

  await requireRunnable(repo, actor, result.version.id, "draft");
  return result;
}

export interface CreateWorkflowVersionInput {
  readonly workflowId: string;
  /** Start from an existing version's definition rather than from nothing. */
  readonly copyFromVersionId?: string | null;
  readonly definition?: WorkflowDefinitionInput;
  readonly reason?: string | null;
}

/**
 * Add a new DRAFT version to an existing workflow.
 *
 * A published version is never edited; this is how it changes. The new version's number is one past
 * the highest that exists, so version numbers are dense and monotonic even after a retirement.
 */
export async function createWorkflowVersion(
  repo: PolicyRepository,
  actor: AdminActor,
  input: CreateWorkflowVersionInput,
): Promise<WorkflowDraftResult> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editWorkflowDefinition");
  const workflowId = nonEmpty(input.workflowId, "workflowId");

  const workflow = (await repo.listWorkflows(actor.tenantId)).find((w) => w.id === workflowId);
  if (!workflow) throw new PolicyValidationError("workflow not found");

  const versions = await repo.listWorkflowVersions(actor.tenantId, workflowId);
  const nextVersion = versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;

  let definition: WorkflowDefinitionInput;
  if (input.definition) {
    definition = validateDefinitionShape(input.definition);
  } else {
    const sourceId = nonEmpty(input.copyFromVersionId ?? "", "copyFromVersionId or definition");
    definition = await readDefinition(repo, actor, sourceId);
  }

  const { roleIdByKey, missingRoleKeys } = await resolveRoles(repo, actor, definition);

  const result = await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const version = await tx.createWorkflowVersion({
      workflowId,
      version: nextVersion,
      status: "DRAFT",
      publishedAt: null,
      publishedBy: null,
    });
    const counts = await writeDefinition(tx, version.id, definition, roleIdByKey);
    await tx.appendAudit({
      ...auditBase(actor, "createWorkflowVersion", version.id, input.reason ?? null),
      before: null,
      after: { workflowKey: workflow.key, version: nextVersion, ...counts, missingRoleKeys },
    });
    return { workflow, version, ...counts, missingRoleKeys };
  });

  await requireRunnable(repo, actor, result.version.id, "draft");
  return result;
}

export interface UpdateWorkflowDefinitionInput {
  readonly versionId: string;
  readonly definition: WorkflowDefinitionInput;
  readonly reason?: string | null;
}

/**
 * Replace a DRAFT version's definition.
 *
 * WHOLE-DEFINITION, not per-edge. A graph edited one edge at a time passes through states nobody
 * validated, and the tempting fix -- validating after every edge -- makes ordinary edits impossible
 * because an intermediate state is legitimately invalid. So the caller sends the definition it
 * wants, and it is validated once, as a whole.
 *
 * The store refuses this on a PUBLISHED version independently of the check here.
 */
export async function updateWorkflowDefinition(
  repo: PolicyRepository,
  actor: AdminActor,
  input: UpdateWorkflowDefinitionInput,
): Promise<WorkflowDraftResult> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editWorkflowDefinition");
  const versionId = nonEmpty(input.versionId, "versionId");
  const definition = validateDefinitionShape(input.definition);

  const found = await findVersion(repo, actor, versionId);
  if (found.version.status !== "DRAFT") {
    throw new PolicyValidationError(
      `workflow version ${found.version.version} is ${found.version.status} and cannot be edited -- create a new version`,
    );
  }
  const workflow = found.workflow;
  const before = await loadWorkflowVersionDefinition(repo, actor.tenantId, versionId);

  const { roleIdByKey, missingRoleKeys } = await resolveRoles(repo, actor, definition);

  // A new version rather than a destructive rewrite of the same rows: the store has no delete for
  // steps or actions, deliberately, so "replace the definition" is expressed as the next draft and
  // the superseded one stays readable. An administrator who wants the old shape back has it.
  const result = await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const versions = await repo.listWorkflowVersions(actor.tenantId, workflow.id);
    const nextVersion = versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
    const version = await tx.createWorkflowVersion({
      workflowId: workflow.id,
      version: nextVersion,
      status: "DRAFT",
      publishedAt: null,
      publishedBy: null,
    });
    const counts = await writeDefinition(tx, version.id, definition, roleIdByKey);
    await tx.appendAudit({
      ...auditBase(actor, "updateWorkflowDefinition", version.id, input.reason ?? null),
      before: {
        supersededVersionId: versionId,
        steps: before.steps.map((s) => s.key),
        actions: before.actions.map((a) => a.key),
      },
      after: { workflowKey: workflow.key, version: nextVersion, ...counts, missingRoleKeys },
    });
    return { workflow, version, ...counts, missingRoleKeys };
  });

  await requireRunnable(repo, actor, result.version.id, "draft");
  return result;
}

export interface SetWorkflowRoleBindingInput {
  readonly versionId: string;
  readonly actionKey: string;
  readonly roleId: string;
  readonly reason?: string | null;
}

/**
 * Bind one Role to one action on a DRAFT version.
 *
 * THIS IS WORKFLOW AUTHORITY, NOT DATA AUTHORITY (D-5). Binding a Role here lets it perform the
 * action; it grants no read of the record's fields, and no CRED grant anywhere buys the action.
 */
export async function setWorkflowRoleBinding(
  repo: PolicyRepository,
  actor: AdminActor,
  input: SetWorkflowRoleBindingInput,
): Promise<WorkflowRoleBindingRecord> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editWorkflowDefinition");
  const versionId = nonEmpty(input.versionId, "versionId");
  const actionKey = nonEmpty(input.actionKey, "actionKey");
  const roleId = nonEmpty(input.roleId, "roleId");

  const found = await findVersion(repo, actor, versionId);
  if (found.version.status !== "DRAFT") {
    throw new PolicyValidationError("a published workflow version's bindings cannot be changed");
  }
  const definition = await loadWorkflowVersionDefinition(repo, actor.tenantId, versionId);
  if (!definition.actions.some((a) => a.key === actionKey)) {
    throw new PolicyValidationError(`no action "${actionKey}" on this version`);
  }
  const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
  if (!role) throw new PolicyValidationError("role not found");
  const already = definition.bindings.find((b) => b.actionKey === actionKey && b.roleId === roleId);
  if (already) return already;

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const binding = await tx.createWorkflowRoleBinding({ workflowVersionId: versionId, actionKey, roleId });
    await tx.appendAudit({
      ...auditBase(actor, "setWorkflowRoleBinding", versionId, input.reason ?? null),
      before: null,
      after: { actionKey, roleKey: role.key, roleId },
    });
    return binding;
  });
}

// ════════════════════ helpers ════════════════════

/**
 * The version ROW behind a version id, with its workflow.
 *
 * `loadWorkflowVersionDefinition` returns a version's steps, actions and bindings but not the
 * version record itself, and status is what decides whether an edit is allowed. The port lists
 * versions per workflow rather than fetching one by id, so this walks -- correct and bounded at
 * administration scale, where a tenant has five workflows and not five thousand.
 */
async function findVersion(
  repo: PolicyRepository,
  actor: AdminActor,
  versionId: string,
): Promise<{ workflow: WorkflowRecord; version: WorkflowVersionRecord }> {
  for (const workflow of await repo.listWorkflows(actor.tenantId)) {
    for (const version of await repo.listWorkflowVersions(actor.tenantId, workflow.id)) {
      if (version.id === versionId) return { workflow, version };
    }
  }
  throw new PolicyValidationError("workflow version not found");
}

function validateDefinitionShape(definition: WorkflowDefinitionInput | undefined): WorkflowDefinitionInput {
  if (!definition || typeof definition !== "object") throw new PolicyValidationError("a definition is required");
  const steps = Array.isArray(definition.steps) ? definition.steps : null;
  const actions = Array.isArray(definition.actions) ? definition.actions : null;
  if (!steps || steps.length === 0) throw new PolicyValidationError("a definition needs at least one state");
  if (!actions) throw new PolicyValidationError("a definition needs an actions list, even an empty one");

  const stepKeys = new Set<string>();
  for (const s of steps) {
    const key = validKey(s?.key, "step key");
    if (stepKeys.has(key)) throw new PolicyValidationError(`duplicate state "${key}"`);
    stepKeys.add(key);
    nonEmpty(s?.label, `label for state "${key}"`);
  }

  const actionKeys = new Set<string>();
  for (const a of actions) {
    const key = validKey(a?.key, "action key");
    if (actionKeys.has(key)) throw new PolicyValidationError(`duplicate action "${key}"`);
    actionKeys.add(key);
    nonEmpty(a?.label, `label for action "${key}"`);
    nonEmpty(a?.from, `"from" for action "${key}"`);
    nonEmpty(a?.to, `"to" for action "${key}"`);
  }

  return { steps, actions };
}

async function resolveRoles(
  repo: PolicyRepository,
  actor: AdminActor,
  definition: WorkflowDefinitionInput,
): Promise<{ roleIdByKey: Map<string, string>; missingRoleKeys: readonly string[] }> {
  const roles = await repo.listRoles(actor.tenantId);
  const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));
  const missingRoleKeys = [
    ...new Set(
      definition.actions.flatMap((a) => a.roleKeys ?? []).filter((k) => !roleIdByKey.has(k)),
    ),
  ];
  return { roleIdByKey, missingRoleKeys };
}

type Tx = Parameters<Parameters<PolicyRepository["transact"]>[1]>[0];

async function writeDefinition(
  tx: Tx,
  versionId: string,
  definition: WorkflowDefinitionInput,
  roleIdByKey: ReadonlyMap<string, string>,
): Promise<{ stepCount: number; actionCount: number; bindingCount: number }> {
  for (const s of definition.steps) {
    await tx.createWorkflowStep({
      workflowVersionId: versionId,
      key: s.key,
      label: s.label,
      initial: s.initial === true,
      terminal: s.terminal === true,
    });
  }
  let bindingCount = 0;
  for (const a of definition.actions) {
    await tx.createWorkflowAction({
      workflowVersionId: versionId,
      key: a.key,
      label: a.label,
      fromStepKey: a.from,
      toStepKey: a.to,
      requiresOwnAssignment: a.requiresOwnAssignment === true,
    });
    for (const key of a.roleKeys ?? []) {
      const roleId = roleIdByKey.get(key);
      if (!roleId) continue; // reported as missing, never invented
      await tx.createWorkflowRoleBinding({ workflowVersionId: versionId, actionKey: a.key, roleId });
      bindingCount += 1;
    }
  }
  return { stepCount: definition.steps.length, actionCount: definition.actions.length, bindingCount };
}

async function readDefinition(
  repo: PolicyRepository,
  actor: AdminActor,
  versionId: string,
): Promise<WorkflowDefinitionInput> {
  const loaded = await loadWorkflowVersionDefinition(repo, actor.tenantId, versionId);
  const roles = await repo.listRoles(actor.tenantId);
  const keyById = new Map(roles.map((r) => [r.id, r.key]));
  return {
    steps: loaded.steps.map((s) => ({ key: s.key, label: s.label, initial: s.initial, terminal: s.terminal })),
    actions: loaded.actions.map((a) => ({
      key: a.key,
      label: a.label,
      from: a.fromStepKey,
      to: a.toStepKey,
      requiresOwnAssignment: a.requiresOwnAssignment,
      roleKeys: loaded.bindings
        .filter((b) => b.actionKey === a.key)
        .map((b) => keyById.get(b.roleId))
        .filter((k): k is string => typeof k === "string"),
    })),
  };
}

/**
 * A draft is KEPT even when it is structurally wrong, and is not publishable while it is.
 *
 * Validated after writing for the reason applyWorkflowSeed gives: an administrator can fix an
 * incomplete draft, and refusing to store it would mean losing the work. But a definition that
 * cannot describe a runnable process is raised loudly here rather than discovered by the first
 * record that gets stuck in it.
 */
async function requireRunnable(
  repo: PolicyRepository,
  actor: AdminActor,
  versionId: string,
  what: string,
): Promise<void> {
  const definition = await loadWorkflowVersionDefinition(repo, actor.tenantId, versionId);
  const problems = validateWorkflowVersion(definition);
  if (problems.length > 0) {
    throw new PolicyValidationError(`this ${what} is not a runnable definition: ${problems.join("; ")}`);
  }
}
