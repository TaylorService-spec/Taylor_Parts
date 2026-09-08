// The Admin policy mutation services.
//
// ════════════════════ WHAT EVERY COMMAND IN THIS FILE DOES ════════════════════
//
//   1. AUTHORIZE   against the administration authority, server-side, before anything is read
//   2. VALIDATE    the change itself -- shape, references, and the invariants it could break
//   3. TRANSACT    atomically, so a policy change and its consequences land together or not at all
//   4. VERSION     bump the access version of every principal whose authority could have moved
//   5. AUDIT       append one event; not optional, not configurable
//   6. RETURN      the canonical stored result, never the caller's input echoed back
//
// The UI is not the security boundary and never was. These commands are.
//
// ════════════════════ TENANCY ════════════════════
//
// Every command takes an `AdminActor` whose `tenantId` was derived server-side from the
// authenticated principal. No command accepts a tenant in its input, so a caller cannot name one --
// cross-tenant mutation is not expressible rather than merely refused.
import {
  AdministrationDeniedError,
  PROTECTED_ROLE_KEYS,
  requireAdministrationAuthority,
} from "./administrationAuthority";
import { CRED_VERBS, FIELD_DATA_TYPES, FIELD_SENSITIVITIES } from "./types";
import type {
  CredOverride,
  CredSet,
  CredVerb,
  DefinitionLifecycle,
  FieldDataType,
  FieldSensitivity,
  ObjectFieldRecord,
  PolicyRoleAssignmentRecord,
  PolicyRoleRecord,
  RoleObjectPermissionRecord,
  TenantId,
  WorkflowVersionRecord,
} from "./types";
import type { PolicyRepository, PolicyTransaction } from "./policyRepository";
import { loadWorkflowVersionDefinition, validateWorkflowVersion } from "./workflowEngine";

export class PolicyValidationError extends Error {}

/**
 * The authenticated actor, as the server knows them.
 *
 * `tenantId` and `uid` come from the verified identity token. `heldRoleKeys` comes from the access
 * resolver's qualifying assignments. NONE of the three is ever read from a request body -- a client
 * that could state its own tenant, uid or Roles would be authorizing itself.
 */
export interface AdminActor {
  readonly tenantId: TenantId;
  readonly uid: string;
  readonly heldRoleKeys: readonly string[];
}

const nonEmpty = (v: unknown, what: string): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new PolicyValidationError(`${what} is required`);
  return v.trim();
};

/** A machine key: stable, storage-facing, and deliberately narrow so it can never need escaping. */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,62}$/;
const validKey = (v: unknown, what: string): string => {
  const s = nonEmpty(v, what);
  if (!KEY_PATTERN.test(s)) {
    throw new PolicyValidationError(`${what} must start with a lower-case letter and contain only letters, digits or underscore`);
  }
  return s;
};

function validCredSet(value: unknown): CredSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PolicyValidationError("a complete CRED set is required");
  }
  const v = value as Record<string, unknown>;
  const out: Record<CredVerb, boolean> = { C: false, R: false, E: false, D: false };
  for (const verb of CRED_VERBS) {
    if (typeof v[verb] !== "boolean") throw new PolicyValidationError(`CRED verb "${verb}" must be true or false`);
    out[verb] = v[verb] as boolean;
  }
  for (const k of Object.keys(v)) {
    if (!(CRED_VERBS as readonly string[]).includes(k)) throw new PolicyValidationError(`"${k}" is not a CRED verb`);
  }
  return Object.freeze(out);
}

function validCredOverride(value: unknown): CredOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PolicyValidationError("an override must be an object");
  }
  const out: Partial<Record<CredVerb, boolean>> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!(CRED_VERBS as readonly string[]).includes(k)) throw new PolicyValidationError(`"${k}" is not a CRED verb`);
    if (typeof v !== "boolean") throw new PolicyValidationError(`override for "${k}" must be true or false`);
    out[k as CredVerb] = v;
  }
  return Object.freeze(out);
}

const auditBase = (actor: AdminActor, action: string, targetKind: string, targetId: string, reason: string | null) => ({
  action,
  actorUid: actor.uid,
  targetKind,
  targetId,
  occurredAt: new Date().toISOString(),
  reason,
});

// ════════════════════ OBJECTS AND FIELDS — ADMIN ONLY ════════════════════

export interface CreateCustomFieldInput {
  readonly objectKey: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string | null;
  readonly dataType: FieldDataType;
  readonly required?: boolean;
  readonly allowedValues?: readonly string[];
  readonly defaultValue?: string | number | boolean | null;
  readonly searchable?: boolean;
  readonly sortable?: boolean;
  readonly reportable?: boolean;
  readonly sensitivity?: FieldSensitivity;
  readonly referenceTo?: string | null;
  readonly reason?: string | null;
}

/**
 * Create a CUSTOM field on an Object.
 *
 * Always CUSTOM and always DRAFT: an administrator cannot mint a SYSTEM field, because SYSTEM means
 * "shipped with the platform and read by name in application code", and a field nothing reads is
 * not that however it is labelled.
 */
export async function createCustomField(
  repo: PolicyRepository,
  actor: AdminActor,
  input: CreateCustomFieldInput,
): Promise<ObjectFieldRecord> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editObjectDefinition");

  const objectKey = nonEmpty(input.objectKey, "objectKey");
  const key = validKey(input.key, "field key");
  const label = nonEmpty(input.label, "label");

  if (!(FIELD_DATA_TYPES as readonly string[]).includes(input.dataType)) {
    throw new PolicyValidationError(`"${String(input.dataType)}" is not a field data type`);
  }
  const sensitivity: FieldSensitivity = input.sensitivity ?? "NORMAL";
  if (!(FIELD_SENSITIVITIES as readonly string[]).includes(sensitivity)) {
    throw new PolicyValidationError(`"${String(sensitivity)}" is not a sensitivity`);
  }
  const allowedValues = Object.freeze([...(input.allowedValues ?? [])]);
  const isEnum = input.dataType === "ENUM" || input.dataType === "ENUM_SET";
  if (isEnum && allowedValues.length === 0) {
    throw new PolicyValidationError("an ENUM field needs allowed values -- an enum of nothing can hold nothing");
  }
  if (!isEnum && allowedValues.length > 0) {
    throw new PolicyValidationError("allowed values apply to ENUM and ENUM_SET only");
  }
  if (input.dataType === "REFERENCE" && !input.referenceTo) {
    throw new PolicyValidationError("a REFERENCE field must say which object it points at");
  }

  const object = await repo.getObjectByKey(actor.tenantId, objectKey);
  if (!object) throw new PolicyValidationError(`no object "${objectKey}"`);

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const field = await tx.createField({
      objectId: object.id,
      key,
      label,
      description: input.description ?? null,
      dataType: input.dataType,
      required: input.required === true,
      allowedValues,
      defaultValue: input.defaultValue ?? null,
      searchable: input.searchable === true,
      sortable: input.sortable === true,
      reportable: input.reportable !== false,
      sensitivity,
      referenceTo: input.referenceTo ?? null,
      origin: "CUSTOM",
      lifecycle: "DRAFT",
    });
    await tx.appendAudit({
      ...auditBase(actor, "createCustomField", "objectField", field.id, input.reason ?? null),
      before: null,
      after: field,
    });
    return field;
  });
}

export interface UpdateFieldInput {
  readonly fieldId: string;
  readonly label?: string;
  readonly description?: string | null;
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly sortable?: boolean;
  readonly reportable?: boolean;
  readonly sensitivity?: FieldSensitivity;
  readonly lifecycle?: DefinitionLifecycle;
  readonly reason?: string | null;
}

/**
 * Update the EDITABLE metadata of a field.
 *
 * WHAT MAY NEVER CHANGE, on any field: its `key` and its `dataType`. A re-key silently orphans every
 * stored value, and a retype makes the stored values mean something they were not written to mean.
 * Neither is offered here -- not guarded behind a flag, not accepted with a warning. There is no
 * parameter for either, so the request cannot be made.
 *
 * A SYSTEM field additionally refuses `lifecycle` changes: retiring a shipped field breaks
 * application code that reads it by name, and that is a code change rather than a configuration one.
 */
export async function updateFieldDefinition(
  repo: PolicyRepository,
  actor: AdminActor,
  input: UpdateFieldInput,
): Promise<ObjectFieldRecord> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editObjectDefinition");
  const fieldId = nonEmpty(input.fieldId, "fieldId");

  const objects = await repo.listObjects(actor.tenantId);
  let current: ObjectFieldRecord | null = null;
  for (const o of objects) {
    const found = (await repo.listFields(actor.tenantId, o.id)).find((f) => f.id === fieldId);
    if (found) { current = found; break; }
  }
  if (!current) throw new PolicyValidationError("field not found");

  if (input.sensitivity && !(FIELD_SENSITIVITIES as readonly string[]).includes(input.sensitivity)) {
    throw new PolicyValidationError(`"${String(input.sensitivity)}" is not a sensitivity`);
  }
  if (input.lifecycle && current.origin === "SYSTEM") {
    throw new PolicyValidationError("a SYSTEM field's lifecycle is protected -- application code reads it by name");
  }

  // A MUTABLE builder over the record's EDITABLE fields only. `ObjectFieldRecord` is deeply readonly
  // by design -- a stored policy record nobody can reassign in place -- so the patch names the
  // writable subset rather than stripping that guarantee off the record type. `key` and `dataType`
  // are absent from this list on purpose: see the doc comment above.
  const patch: {
    label?: string;
    description?: string | null;
    required?: boolean;
    searchable?: boolean;
    sortable?: boolean;
    reportable?: boolean;
    sensitivity?: FieldSensitivity;
    lifecycle?: DefinitionLifecycle;
  } = {};
  if (input.label !== undefined) patch.label = nonEmpty(input.label, "label");
  if (input.description !== undefined) patch.description = input.description;
  if (input.required !== undefined) patch.required = input.required === true;
  if (input.searchable !== undefined) patch.searchable = input.searchable === true;
  if (input.sortable !== undefined) patch.sortable = input.sortable === true;
  if (input.reportable !== undefined) patch.reportable = input.reportable === true;
  if (input.sensitivity !== undefined) patch.sensitivity = input.sensitivity;
  if (input.lifecycle !== undefined) patch.lifecycle = input.lifecycle;

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const updated = await tx.updateField(fieldId, patch);
    await tx.appendAudit({
      ...auditBase(actor, "updateFieldDefinition", "objectField", fieldId, input.reason ?? null),
      before: current,
      after: updated,
    });
    return updated;
  });
}

// ════════════════════ ROLES AND PERMISSIONS — ADMIN ONLY ════════════════════

export interface CreateRoleInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly reason?: string | null;
}

export async function createRole(
  repo: PolicyRepository,
  actor: AdminActor,
  input: CreateRoleInput,
): Promise<PolicyRoleRecord> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editRoleDefinition");
  const key = validKey(input.key, "role key");
  const name = nonEmpty(input.name, "name");
  // A tenant-created Role may not claim a protected key: it would be a second Role wearing the
  // recovery Role's name, and every later "is this the admin Role" question would have two answers.
  if (PROTECTED_ROLE_KEYS.includes(key)) {
    throw new PolicyValidationError(`"${key}" is a protected system role key`);
  }

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const role = await tx.createRole({
      key, name, description: input.description ?? null, origin: "CUSTOM", protected: false,
    });
    await tx.appendAudit({
      ...auditBase(actor, "createRole", "role", role.id, input.reason ?? null),
      before: null,
      after: role,
    });
    return role;
  });
}

export interface SetObjectPermissionInput {
  readonly roleId: string;
  readonly objectKey: string;
  readonly cred: CredSet;
  readonly reason?: string | null;
}

/**
 * Set one Role's CRED over one Object.
 *
 * EVERY PRINCIPAL HOLDING THE ROLE HAS THEIR ACCESS VERSION BUMPED, in the same transaction. A
 * permission change that landed without the bump would leave every cached authorization decision
 * valid -- which is not a consistency inconvenience, it is the change silently not taking effect.
 */
export async function setObjectPermission(
  repo: PolicyRepository,
  actor: AdminActor,
  input: SetObjectPermissionInput,
): Promise<RoleObjectPermissionRecord> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editRoleDefinition");
  const roleId = nonEmpty(input.roleId, "roleId");
  const objectKey = nonEmpty(input.objectKey, "objectKey");
  const cred = validCredSet(input.cred);

  const object = await repo.getObjectByKey(actor.tenantId, objectKey);
  if (!object) throw new PolicyValidationError(`no object "${objectKey}"`);
  if (cred.D && !object.supportsDelete) {
    // A grant with no enforcement point is refused rather than stored as a no-op an administrator
    // would go on believing they had made.
    throw new PolicyValidationError(`"${objectKey}" does not support Delete`);
  }

  const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
  if (!role) throw new PolicyValidationError("role not found");

  const before = (await repo.listObjectPermissions(actor.tenantId, [roleId]))
    .find((p) => p.objectId === object.id) ?? null;
  const holders = await principalsHolding(repo, actor.tenantId, roleId);

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const row = await tx.setObjectPermission(roleId, object.id, cred);
    for (const uid of holders) await tx.bumpAccessVersion(uid);
    await tx.appendAudit({
      ...auditBase(actor, "setObjectPermission", "roleObjectPermission", row.id, input.reason ?? null),
      before,
      after: row,
    });
    return row;
  });
}

export interface SetFieldOverrideInput {
  readonly roleId: string;
  readonly fieldId: string;
  /** An EMPTY override REMOVES the override and restores inheritance. */
  readonly override: CredOverride;
  readonly reason?: string | null;
}

export async function setFieldPermissionOverride(
  repo: PolicyRepository,
  actor: AdminActor,
  input: SetFieldOverrideInput,
): Promise<void> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editRoleDefinition");
  const roleId = nonEmpty(input.roleId, "roleId");
  const fieldId = nonEmpty(input.fieldId, "fieldId");
  const override = validCredOverride(input.override);

  const before = (await repo.listFieldOverrides(actor.tenantId, [roleId])).find((o) => o.fieldId === fieldId) ?? null;
  const holders = await principalsHolding(repo, actor.tenantId, roleId);

  await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.setFieldOverride(roleId, fieldId, override);
    for (const uid of holders) await tx.bumpAccessVersion(uid);
    await tx.appendAudit({
      ...auditBase(actor, "setFieldPermissionOverride", "roleFieldOverride", fieldId, input.reason ?? null),
      before,
      after: Object.keys(override).length === 0 ? null : { roleId, fieldId, override },
    });
  });
}

// ════════════════════ ROLE ASSIGNMENT — OWNER, GENERAL MANAGER OR ADMIN ════════════════════

export interface AssignRoleInput {
  readonly principalUid: string;
  readonly roleId: string;
  readonly scopeType?: string;
  readonly scopeValue?: string | null;
  readonly reason?: string | null;
}

/**
 * Assign a Role to a principal.
 *
 * ANY ROLE, INCLUDING ADMIN, per the Owner ruling -- role ASSIGNMENT and role DEFINITION are
 * different authorities, and this is the first. The old two-person privileged route is superseded.
 */
export async function assignRole(
  repo: PolicyRepository,
  actor: AdminActor,
  input: AssignRoleInput,
): Promise<PolicyRoleAssignmentRecord> {
  requireAdministrationAuthority(actor.heldRoleKeys, "assignRole");
  const principalUid = nonEmpty(input.principalUid, "principalUid");
  const roleId = nonEmpty(input.roleId, "roleId");

  const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
  if (!role) throw new PolicyValidationError("role not found");

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    // BUMP FIRST, then stamp the grant with the NEW version. A grant carrying the old version would
    // be stale the instant it was written -- excluded by the resolver's own staleness rule, which is
    // a grant that silently does nothing.
    const accessVersion = await tx.bumpAccessVersion(principalUid);
    const assignment = await tx.createAssignment({
      principalUid,
      roleId,
      scopeType: input.scopeType ?? "global",
      scopeValue: input.scopeValue ?? null,
      status: "active",
      grantedBy: actor.uid,
      grantedAt: new Date().toISOString(),
      accessVersionAtGrant: accessVersion,
    });
    await tx.appendAudit({
      ...auditBase(actor, "assignRole", "roleAssignment", assignment.id, input.reason ?? null),
      before: null,
      after: assignment,
    });
    return assignment;
  });
}

export interface RevokeRoleInput {
  readonly assignmentId: string;
  readonly reason?: string | null;
}

/**
 * Revoke ONE EXACT assignment.
 *
 * By assignment id, never by (principal, role): a principal may legitimately hold the same Role at
 * two scopes, and revoking "their salesperson role" would silently remove both. The caller names
 * the one they mean.
 *
 * REFUSES to remove the LAST administering assignment in the tenant. That is the recovery
 * invariant: ordinary configuration must not be able to leave the platform unadministrable, and the
 * cheapest place to stop it is the transaction that would do it.
 */
export async function revokeRole(
  repo: PolicyRepository,
  actor: AdminActor,
  input: RevokeRoleInput,
): Promise<PolicyRoleAssignmentRecord> {
  requireAdministrationAuthority(actor.heldRoleKeys, "assignRole");
  const assignmentId = nonEmpty(input.assignmentId, "assignmentId");

  const roles = await repo.listRoles(actor.tenantId);
  const adminRoleIds = new Set(roles.filter((r) => r.protected).map((r) => r.id));

  const target = await findAssignment(repo, actor.tenantId, assignmentId);
  if (!target) throw new PolicyValidationError("assignment not found");

  if (adminRoleIds.has(target.roleId) && target.status === "active") {
    const remaining = await countActiveAdministeringAssignments(repo, actor.tenantId, adminRoleIds);
    if (remaining <= 1) {
      throw new PolicyValidationError(
        "this is the last active administering assignment -- revoking it would leave the tenant unadministrable",
      );
    }
  }

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const updated = await tx.setAssignmentStatus(assignmentId, "disabled");
    await tx.bumpAccessVersion(target.principalUid);
    await tx.appendAudit({
      ...auditBase(actor, "revokeRole", "roleAssignment", assignmentId, input.reason ?? null),
      before: target,
      after: updated,
    });
    return updated;
  });
}

// ════════════════════ WORKFLOWS — ADMIN ONLY ════════════════════

export interface PublishWorkflowVersionInput {
  readonly versionId: string;
  readonly reason?: string | null;
}

/**
 * Publish a workflow version.
 *
 * VALIDATED STRUCTURALLY FIRST. A definition that cannot describe a runnable process -- no initial
 * step, two initial steps, an action from a step that does not exist, an action leaving a terminal
 * step -- is refused here rather than discovered by the first record that gets stuck in it.
 *
 * After publication the version is IMMUTABLE, enforced by the store as well as here.
 */
export async function publishWorkflowVersion(
  repo: PolicyRepository,
  actor: AdminActor,
  input: PublishWorkflowVersionInput,
): Promise<WorkflowVersionRecord> {
  requireAdministrationAuthority(actor.heldRoleKeys, "editWorkflowDefinition");
  const versionId = nonEmpty(input.versionId, "versionId");

  const definition = await loadWorkflowVersionDefinition(repo, actor.tenantId, versionId);
  const problems = validateWorkflowVersion(definition);
  if (problems.length > 0) {
    throw new PolicyValidationError(`workflow version cannot be published: ${problems.join("; ")}`);
  }

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const published = await tx.publishWorkflowVersion(versionId);
    await tx.appendAudit({
      ...auditBase(actor, "publishWorkflowVersion", "workflowVersion", versionId, input.reason ?? null),
      before: { status: "DRAFT" },
      after: published,
    });
    return published;
  });
}

// ════════════════════ helpers ════════════════════

/** Every principal currently holding a Role, so a permission change can invalidate their caches. */
async function principalsHolding(repo: PolicyRepository, tenantId: TenantId, roleId: string): Promise<string[]> {
  const uids = new Set<string>();
  for (const uid of await allPrincipals(repo, tenantId)) {
    const assignments = await repo.listAssignmentsForPrincipal(tenantId, uid);
    if (assignments.some((a) => a.roleId === roleId && a.status === "active")) uids.add(uid);
  }
  return [...uids];
}

/**
 * Every principal with any assignment in this tenant.
 *
 * ponytail: derived by walking audit events, because the port has no "list all principals" read and
 * adding one for this alone would widen the interface for a bookkeeping need. Correct and bounded
 * for the sizes this runs at; if it ever stops being either, the port grows a proper query rather
 * than this growing a cache.
 */
async function allPrincipals(repo: PolicyRepository, tenantId: TenantId): Promise<string[]> {
  const events = await repo.listAuditEvents(tenantId, 10_000);
  const uids = new Set<string>();
  for (const e of events) {
    const after = e.after as { principalUid?: unknown } | null;
    if (after && typeof after.principalUid === "string") uids.add(after.principalUid);
  }
  return [...uids];
}

async function findAssignment(
  repo: PolicyRepository,
  tenantId: TenantId,
  assignmentId: string,
): Promise<PolicyRoleAssignmentRecord | null> {
  for (const uid of await allPrincipals(repo, tenantId)) {
    const found = (await repo.listAssignmentsForPrincipal(tenantId, uid)).find((a) => a.id === assignmentId);
    if (found) return found;
  }
  return null;
}

async function countActiveAdministeringAssignments(
  repo: PolicyRepository,
  tenantId: TenantId,
  adminRoleIds: ReadonlySet<string>,
): Promise<number> {
  let count = 0;
  for (const uid of await allPrincipals(repo, tenantId)) {
    for (const a of await repo.listAssignmentsForPrincipal(tenantId, uid)) {
      if (a.status === "active" && adminRoleIds.has(a.roleId)) count += 1;
    }
  }
  return count;
}

export { AdministrationDeniedError };
export type { PolicyTransaction };
