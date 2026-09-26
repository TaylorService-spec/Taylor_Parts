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
  PrincipalCapabilityRecord,
  RoleCapabilityRecord,
  ObjectRecord,
  PolicyRoleAssignmentRecord,
  PolicyRoleRecord,
  PrincipalRecord,
  RoleObjectPermissionRecord,
  TenantId,
  WorkflowVersionRecord,
} from "./types";
import type { PolicyRepository, PolicyTransaction } from "./policyRepository";
import { actorCapabilities, capabilityKeysFor, requireSecurityAdministrationCapability } from "./administrationCapabilityGate";
import {
  ADMINISTRATION_GOVERNING_CAPABILITIES,
  CONDITIONABLE_GRANTS,
  CONDITION_OPERATIONAL_SCOPE_TYPES,
  OWNER_EXCLUDED_CAPABILITIES,
  forbiddenPair,
  ownerPrincipalViolations,
} from "./roleCapabilityAdministration";
import { loadPrincipalPolicy } from "./effectiveObjectAccess";
import { PolicyStoreError } from "./policyRepository";
import { GOVERNED_QUALIFICATION_CODES } from "../eosOps/contextualAuthorization";
import {
  assertNoWithheldGrantConditions,
  grantConditionCatalogFromRows,
} from "../eosOps/conditionalEntitlement";
import type { GrantConditionRecord, RoleCapabilityDecisionRecord } from "./types";
import { loadWorkflowVersionDefinition, validateWorkflowVersion } from "./workflowEngine";
import { resolveObjectAction } from "./objectSecurityAuthority";

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
  /**
   * The actor's EFFECTIVE capability keys, when the trusted API has already resolved them for this
   * request. Server-derived like the fields above, never from a request body. When absent, the
   * capability-governed commands resolve them from the store (administrationCapabilityGate.ts).
   */
  readonly capabilities?: ReadonlySet<string>;
}

/**
 * A refusal an administrator can act on: a SYSTEM INVARIANT, a fail-closed condition rule, or the
 * anti-lockout guard. `code` is stable and machine-readable; the message says why in words.
 */
export class AdministrationRefusal extends PolicyValidationError {
  constructor(readonly code:
    | "SYSTEM_INVARIANT"
    | "REASON_REQUIRED"
    | "CONDITION_REQUIRED"
    | "CONDITION_INVALID"
    | "CONDITION_NOT_SUPPORTED"
    | "CONDITION_RETIREMENT_WOULD_WIDEN"
    | "SELF_ADMINISTRATION"
    | "PRIVILEGE_ESCALATION"
    | "WOULD_REMOVE_LAST_ADMINISTRATION_PATH", message: string) {
    super(`${code}: ${message}`);
  }
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

// ════════════════════ A CHANGE THAT CHANGES NOTHING IS NOT A MUTATION ════════════════════
//
// Every command below used to open a transaction, write, bump access versions and append an audit
// event whether or not anything had changed. Measured against the deployed non-production API: an
// identical `updateRole`, `updateObjectMetadata`, `updateCustomFieldMetadata`, `setObjectPermission`
// and `setFieldPermissionOverride` EACH wrote an audit event whose only difference was `updatedAt`.
// The two permission commands also bumped the access version of every holder of the Role, forcing
// each of them to re-resolve authority that had not moved.
//
// An audit trail that records edits nobody made cannot be trusted about the ones they did, and the
// rule was already decided: Ruling C made an identical role assignment idempotent, and acceptance
// requires that an identical no-op write no mutation event. `assignRole` was the only command that
// honoured it. Now they all do -- by returning the current record BEFORE any transaction opens, so
// there is nothing to roll back and nothing to audit.

/** Do two CRED shapes -- complete sets or partial overrides -- say the same thing about every verb? */
const sameVerbs = (a: CredOverride | CredSet | null | undefined, b: CredOverride | CredSet): boolean =>
  CRED_VERBS.every(
    (verb) => (a as Partial<Record<CredVerb, boolean>> | null | undefined)?.[verb] === (b as Partial<Record<CredVerb, boolean>>)[verb],
  );

/** Would applying this patch leave every named value exactly as it is? Patches here are flat scalars. */
const patchChangesNothing = (current: object, patch: object): boolean =>
  Object.entries(patch).every(([key, value]) => (current as Record<string, unknown>)[key] === value);

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
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");

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
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
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
  // ════════════════════ A SYSTEM FIELD DEFINITION IS PROTECTED, FULL STOP ════════════════════
  //
  // This used to protect only `lifecycle`, which left a SYSTEM field's label, description,
  // required, searchable, sortable, reportable and sensitivity all editable. That is not the ruling:
  // system Field DEFINITIONS are protected and custom Fields are Admin-editable.
  //
  // The distinction that makes this safe rather than restrictive: a SYSTEM field's DEFINITION is
  // fixed, and its POLICY is not. An administrator still governs who may Create/Read/Edit/Delete it
  // through Role Field CRED, which is the thing they actually need. What they may not do is rename
  // or reclassify a field that application code reads by name -- `sensitivity` in particular is
  // read by the field-projection path, so "just a label change" is not.
  //
  // Enforced HERE, next to the transaction, rather than by hiding a button: a caller that reaches
  // the command directly gets the same refusal the UI would have prevented.
  if (current.origin === "SYSTEM") {
    throw new PolicyValidationError(
      "a SYSTEM field's definition is protected -- its policy is configurable through Role field permissions, its definition is not",
    );
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
  // A request that names only what this command cannot express -- `key`, `dataType` -- used to reach
  // the transaction with an empty patch, answer 200, and audit an "update" whose only change was
  // `updatedAt`. The caller was told their key change succeeded. `updateRole` and
  // `updateObjectMetadata` already refused this; now all three say the same thing.
  if (Object.keys(patch).length === 0) throw new PolicyValidationError("nothing to update");
  if (patchChangesNothing(current, patch)) return current;

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

export interface UpdateObjectMetadataInput {
  readonly objectKey: string;
  readonly label?: string;
  readonly labelPlural?: string | null;
  readonly description?: string | null;
  readonly reason?: string | null;
}

/**
 * Change an Object's DISPLAY metadata.
 *
 * ════════════════════ WHY THIS EXISTS, AND WHY IT IS THIS SMALL ════════════════════
 *
 * Nothing could edit an Object at all -- no command, no port method -- while the Administration
 * contract said Object definition editing is Admin-only. That gap made "Objects are editable" false
 * in a screen that claimed it.
 *
 * What a tenant legitimately changes is what the Object is CALLED. This platform's own canonical
 * object is keyed `account` and labelled "Accounts" while the business says Customer; that is
 * exactly the case, and it is display metadata rather than a schema change.
 *
 * WHAT IS DELIBERATELY NOT EDITABLE, and would each be a different kind of change:
 *
 *   key              identity. Every stored permission, override and workflow references it.
 *   origin           whether the platform owns this object, not a preference.
 *   lifecycle        what the engine will enforce.
 *   supportsDelete   MEASURED from whether a capability governs Delete. Making it editable would
 *                    let an administrator promise a Delete grant the engine can never honour.
 *
 * There is no generic object patch, and adding one would make authorization a property of the
 * arguments rather than of the operation.
 */
export async function updateObjectMetadata(
  repo: PolicyRepository,
  actor: AdminActor,
  input: UpdateObjectMetadataInput,
): Promise<ObjectRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const objectKey = nonEmpty(input.objectKey, "objectKey");

  const object = await repo.getObjectByKey(actor.tenantId, objectKey);
  if (!object) throw new PolicyValidationError(`no object "${objectKey}"`);

  const patch: { label?: string; labelPlural?: string | null; description?: string | null } = {};
  if (input.label !== undefined) patch.label = nonEmpty(input.label, "label");
  if (input.labelPlural !== undefined) patch.labelPlural = input.labelPlural;
  if (input.description !== undefined) patch.description = input.description;
  if (Object.keys(patch).length === 0) throw new PolicyValidationError("nothing to update");
  if (patchChangesNothing(object, patch)) return object;

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const updated = await tx.updateObject(object.id, patch);
    await tx.appendAudit({
      ...auditBase(actor, "updateObjectMetadata", "object", object.id, input.reason ?? null),
      before: { label: object.label, labelPlural: object.labelPlural, description: object.description },
      after: { label: updated.label, labelPlural: updated.labelPlural, description: updated.description },
    });
    return updated;
  });
}

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
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
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
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
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
  // Only an EXISTING row can be re-stated. An absent row and an explicit all-false row resolve alike
  // today but are different stored facts, so writing the first time is a real change.
  if (before && sameVerbs(before.cred, cred)) return before;
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
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const roleId = nonEmpty(input.roleId, "roleId");
  const fieldId = nonEmpty(input.fieldId, "fieldId");
  const override = validCredOverride(input.override);

  const before = (await repo.listFieldOverrides(actor.tenantId, [roleId])).find((o) => o.fieldId === fieldId) ?? null;
  // Removing a row that is not there, or re-stating the one that is, changes nothing.
  const removing = Object.keys(override).length === 0;
  if (removing ? before === null : before !== null && sameVerbs(before.override, override)) return;
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

// ════════════════════ PRINCIPAL IDENTITY BINDING — OWNER, GENERAL MANAGER OR ADMIN ════════════════════

export interface RebindPrincipalIdentityInput {
  readonly principalId: string;
  readonly identityProvider: string;
  readonly externalSubject: string;
  readonly displayName?: string | null;
  readonly reason?: string | null;
}

/**
 * Change WHICH EXTERNAL IDENTITY authenticates as an existing Principal. Nothing else.
 *
 * ════════════════════ WHY THIS COMMAND HAS TO EXIST ════════════════════
 *
 * The identity model is ONE external identity per Principal: `eos_policy.principals` carries
 * `(identity_provider, external_subject)` under a UNIQUE constraint and there is no separate
 * identity-binding table. A Principal provisioned against a provider no verifier recognizes is
 * therefore a Principal that can never authenticate, and there is no way to ADD a second binding to
 * it -- so the only governed route from "authority fixture" to "account" is to move the binding it
 * already has.
 *
 * Before this command the only route was an UPDATE typed into a database client. That is the act the
 * governance rules forbid, and forbidding it while providing no alternative is what left the
 * substitution happening by hand. This is the alternative: the same two columns, reached through the
 * authority gate, the transaction, the version bump and the audit event that every other policy
 * mutation goes through.
 *
 * ════════════════════ WHAT IT CANNOT DO ════════════════════
 *
 *   NOT AN AUTHORITY CHANGE   The Principal id does not move, and the id is what every assignment,
 *                             membership, employee link, direct grant and audit row references. The
 *                             set of Roles and capabilities before and after is the SAME SET, by
 *                             construction rather than by a check.
 *   NOT A CREATE              A Principal that does not exist, or is not an ACTIVE member of the
 *                             actor's tenant, is refused. This never mints a Principal, so it can
 *                             never be used to introduce an authority holder.
 *   NOT A MERGE               If another Principal already holds the target identity, the store
 *                             refuses. Two Principals for one subject would split one human's Roles;
 *                             silently folding them together would be worse.
 *   NOT A STATUS CHANGE       There is no status parameter. A disabled Principal stays disabled.
 *
 * ════════════════════ THE VERSION BUMP ════════════════════
 *
 * The capability set is unchanged, so the bump is not required for correctness -- it is the
 * conservative direction. Any access context cached against this Principal was resolved for a
 * different login, and the resolver's qualification rule only ever EXCLUDES grants stamped ABOVE the
 * current version, so raising the current version can invalidate a cache but can never invalidate an
 * existing grant.
 *
 * NO-OP IS SILENT. Re-stating the binding a Principal already has writes no row and NO AUDIT EVENT:
 * an audit trail in which half the entries record that nothing happened is an audit trail nobody
 * reads.
 */
export async function rebindPrincipalIdentity(
  repo: PolicyRepository,
  actor: AdminActor,
  input: RebindPrincipalIdentityInput,
): Promise<PrincipalRecord> {
  // Naming who a Principal IS is assignment-shaped authority -- the same gate that admits a
  // Principal to the tenant in the first place. It is deliberately not a weaker one.
  await requireSecurityAdministrationCapability(repo, actor, "assignRole");
  const principalId = nonEmpty(input.principalId, "principalId");
  const identityProvider = nonEmpty(input.identityProvider, "identityProvider");
  const externalSubject = nonEmpty(input.externalSubject, "externalSubject");

  const principal = await repo.getPrincipal(principalId);
  if (!principal) throw new PolicyValidationError("principal not found");

  const membership = await repo.getMembership(actor.tenantId, principalId);
  if (!membership || membership.status !== "active") {
    throw new PolicyValidationError("that principal is not an active member of this tenant");
  }

  const displayName = input.displayName === undefined ? principal.displayName : input.displayName;
  if (
    principal.identityProvider === identityProvider
    && principal.externalSubject === externalSubject
    && principal.displayName === displayName
  ) {
    return principal;
  }

  const clash = await repo.getPrincipalBySubject(identityProvider, externalSubject);
  if (clash && clash.id !== principalId) {
    throw new PolicyValidationError("another principal already holds that identity");
  }

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const updated = await tx.setPrincipalIdentity(principalId, {
      identityProvider,
      externalSubject,
      displayName,
    });
    await tx.bumpAccessVersion(principalId);
    await tx.appendAudit({
      ...auditBase(actor, "rebindPrincipalIdentity", "principal", principalId, input.reason ?? null),
      // BOTH BINDINGS, named. "who could log in as this authority before, and who can now" is the
      // only question this event will ever be asked, and an event recording only the new value
      // cannot answer it.
      before: {
        identityProvider: principal.identityProvider,
        externalSubject: principal.externalSubject,
        displayName: principal.displayName,
      },
      after: {
        identityProvider: updated.identityProvider,
        externalSubject: updated.externalSubject,
        displayName: updated.displayName,
      },
    });
    return updated;
  });
}

// ════════════════════ ROLE ASSIGNMENT — OWNER, GENERAL MANAGER OR ADMIN ════════════════════

export interface AssignRoleInput {
  readonly principalId: string;
  readonly roleId: string;
  readonly scopeType?: string;
  readonly scopeValue?: string | null;
  readonly reason?: string | null;
}

/** Two assignments are the SAME EFFECTIVE ASSIGNMENT when these four agree. */
const sameEffectiveAssignment = (
  a: Pick<PolicyRoleAssignmentRecord, "roleId" | "scopeType" | "scopeValue">,
  roleId: string,
  scopeType: string,
  scopeValue: string | null,
): boolean =>
  a.roleId === roleId &&
  a.scopeType === scopeType &&
  // NULL and "" are the same absence of a scope value. Treating them as different is how a
  // "global" assignment gets two spellings and the uniqueness rule stops meaning anything.
  (a.scopeValue ?? "") === (scopeValue ?? "");

/**
 * Assign a Role to a principal.
 *
 * ANY ROLE, INCLUDING ADMIN, per the Owner ruling -- role ASSIGNMENT and role DEFINITION are
 * different authorities, and this is the first. The old two-person privileged route is superseded.
 *
 * ════════════════════ MEMBERSHIP IS REQUIRED ════════════════════
 *
 * A Role granted to somebody who is not a member of this tenant confers nothing -- they resolve to
 * no context -- so it is not a grant, it is a row that looks like one. Refused here, and made
 * UNREPRESENTABLE by the composite foreign key in migration 003. Both layers, because an API check
 * defends the path that goes through the API and a migration or a repair script does not.
 *
 * ════════════════════ IDENTICAL ACTIVE ASSIGNMENTS ARE IDEMPOTENT ════════════════════
 *
 * Multi-role union stays ADDITIVE: a different Role, or the same Role at a different governed
 * scope, is a second assignment and confers more. What is NOT a second assignment is the same
 * principal holding the same Role at the same scope twice -- two active rows saying that confer no
 * more authority than one, and leave an administrator with two things to revoke before the first
 * stops applying.
 *
 * So this returns the EXISTING canonical row rather than creating a duplicate, writes no audit
 * event for a change that did not happen, and does not bump the access version -- nothing about
 * what the principal may do has moved. A revoked assignment does not block a later re-grant: that
 * one is a real change and gets its own row and its own event.
 */
export async function assignRole(
  repo: PolicyRepository,
  actor: AdminActor,
  input: AssignRoleInput,
): Promise<PolicyRoleAssignmentRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "assignRole");
  const principalId = nonEmpty(input.principalId, "principalId");
  const roleId = nonEmpty(input.roleId, "roleId");
  const scopeType = input.scopeType ?? "global";
  const scopeValue = input.scopeValue ?? null;

  const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
  if (!role) throw new PolicyValidationError("role not found");

  const membership = await repo.getMembership(actor.tenantId, principalId);
  if (!membership || membership.status !== "active") {
    throw new PolicyValidationError("that principal is not an active member of this tenant");
  }

  // (a) NOBODY STAFFS THEMSELVES. A Role assignment to the actor's own Principal is refused whatever
  // the Role, so the assignment authority can never be turned into a self-escalation path.
  if (principalId === actor.uid) {
    throw new AdministrationRefusal("SELF_ADMINISTRATION", "a principal may not assign a Role to itself");
  }
  // (b) ASSIGNING SECURITY-POLICY AUTHORITY NEEDS SECURITY-POLICY AUTHORITY. A Role carrying
  // admin.securityPolicy.write may be assigned only by an actor who holds it -- otherwise the
  // assignment capability mints the definition capability (Pass 8 D5).
  const roleCapabilities = await capabilityKeysFor(repo, actor.tenantId, [role.key], null);
  if (roleCapabilities.has(SECURITY_POLICY_WRITE)
      && !(await actorCapabilities(repo, actor)).has(SECURITY_POLICY_WRITE)) {
    throw new AdministrationRefusal("PRIVILEGE_ESCALATION",
      `assigning ${role.key} confers ${SECURITY_POLICY_WRITE}, which the assigning principal does not hold`);
  }
  // (c) OWNER GOVERNANCE AT THE PRINCIPAL: an owner holder may not reach an excluded capability by
  // any Role (ruling A).
  if (scopeType === "global") await refuseOwnerPrincipalViolation(repo, actor.tenantId, principalId, [role.key], []);

  const held = await repo.listAssignmentsForPrincipal(actor.tenantId, principalId);
  const already = held.find(
    (a) => a.status === "active" && sameEffectiveAssignment(a, roleId, scopeType, scopeValue),
  );
  if (already) return already;

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    // Re-check the idempotence under the governance lock: a concurrent identical assignment that
    // committed first is returned, never duplicated.
    const now = (await repo.listAssignmentsForPrincipal(actor.tenantId, principalId))
      .find((a) => a.status === "active" && sameEffectiveAssignment(a, roleId, scopeType, scopeValue));
    if (now) return now;
    // BUMP FIRST, then stamp the grant with the NEW version. A grant carrying the old version would
    // be stale the instant it was written -- excluded by the resolver's own staleness rule, which is
    // a grant that silently does nothing.
    const accessVersion = await tx.bumpAccessVersion(principalId);
    const assignment = await tx.createAssignment({
      principalId,
      roleId,
      scopeType,
      scopeValue,
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
 * REFUSES to remove the LAST administering assignment in the tenant, and the last path the gate
 * would admit to a governing Administration capability. Both counts are taken INSIDE the
 * transaction, under the tenant governance lock (Pass 8 D2): two administrators revoking each other
 * concurrently serialize, and the second sees the first's revoke.
 */
export async function revokeRole(
  repo: PolicyRepository,
  actor: AdminActor,
  input: RevokeRoleInput,
): Promise<PolicyRoleAssignmentRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "assignRole");
  const assignmentId = nonEmpty(input.assignmentId, "assignmentId");

  const target = await findAssignment(repo, actor.tenantId, assignmentId);
  if (!target) throw new PolicyValidationError("assignment not found");

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    const current = await tx.readAssignment(assignmentId);
    if (!current) throw new PolicyValidationError("assignment not found");
    if (current.status === "active") {
      const roles = await repo.listRoles(actor.tenantId);
      if (roles.some((r) => r.protected && r.id === current.roleId)
          && (await tx.protectedRoleAssignmentCount(assignmentId)) === 0) {
        throw new PolicyValidationError(
          "this is the last active administering assignment -- revoking it would leave the tenant unadministrable",
        );
      }
      await refuseIfLastAdministrationPath(tx, { assignmentId });
    }
    const updated = await tx.setAssignmentStatus(assignmentId, "disabled");
    await tx.bumpAccessVersion(current.principalId);
    await tx.appendAudit({
      ...auditBase(actor, "revokeRole", "roleAssignment", assignmentId, input.reason ?? null),
      before: current,
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
 * Every principal who could hold a Role in this tenant.
 *
 * MEMBERSHIP FIRST, and that is a correctness fix rather than a tidy-up. This used to be derived
 * ONLY by walking audit events for an `after.principalId`, which is true of an assignment written
 * by `assignRole` and NOT true of one written by the tenant bootstrap -- so the initial
 * administrator was invisible here, and the "you may not revoke the last administering assignment"
 * guard would have counted zero and let it go.
 *
 * The audit-derived set is still unioned in, deliberately: a principal may hold an assignment
 * without a membership row in the foundation's own resolver proofs, which construct assignments
 * directly to test staleness and union arithmetic. A superset is the safe direction here -- this
 * feeds a guard that REFUSES, so including a principal who does not exist costs nothing and
 * excluding one who does costs the recovery invariant.
 */
async function allPrincipals(repo: PolicyRepository, tenantId: TenantId): Promise<string[]> {
  const uids = new Set<string>(await repo.listTenantPrincipalIds(tenantId));
  const events = await repo.listAuditEvents(tenantId, 10_000);
  for (const e of events) {
    const after = e.after as { principalId?: unknown } | null;
    if (after && typeof after.principalId === "string") uids.add(after.principalId);
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

// ════════════════════ OBJECT-OWNED SECURITY GRANTS ════════════════════
//
// The administrative contract is (objectKey, actionKey, grantee) -- NEVER a raw capability key.
// An administrator grants "Work Order -> Dispatch"; the server resolves that to
// `workOrder.lifecycle.dispatch` through the canonical metadata. Exposing the key as the primary
// contract would put an implementation identifier in the administrative interface and would let a
// caller name a capability governing something other than the Object they were looking at.
//
// AUTHORITY. Both grantee kinds require the ADMIN-ONLY authority, not the wider role-ASSIGNMENT
// authority. Owner ruling: "what a Role may do" is admin-only while "who holds a Role" is not, and
// a direct Principal grant MINTS authority for a person rather than staffing them into an existing
// bundle -- so it belongs on the definition side of that line, not the staffing side.
//
// ACCESS VERSION IS NOT BUMPED. `principal_access_versions` exists to stale ROLE ASSIGNMENTS; a
// capability grant does not invalidate an assignment, and bumping here would silently exclude every
// assignment the principal holds. Capability grants are read live.

export interface ObjectActionRoleGrantInput {
  readonly objectKey: string;
  readonly actionKey: string;
  readonly roleKey: string;
  /** REQUIRED for Role grants and revokes: a decision nobody explained is not a governed decision. */
  readonly reason?: string | null;
  /**
   * Optional: establish the grant's condition IN THE SAME TRANSACTION, so a conditioned grant never
   * exists unconditioned, not even for one statement. Shape: `{ paths, recordKind? }`, validated by
   * the evaluator's own catalog builder and the CONDITIONABLE_GRANTS allow-list.
   */
  readonly condition?: unknown;
  /**
   * Mark the grant as valid ONLY with an ACTIVE condition. Refused when no condition is supplied and
   * none is already active on the cell; the database refuses a default writer that would hold it
   * without one.
   */
  readonly requiresCondition?: boolean;
}

export interface ObjectActionPrincipalGrantInput {
  readonly objectKey: string;
  readonly actionKey: string;
  readonly principalId: string;
  /** REQUIRED: a direct grant is a governed exception and is stored with its reason. */
  readonly reason?: string | null;
  /** Optional ISO instant the exception lapses. Must be in the future. */
  readonly expiresAt?: string | null;
}

const SECURITY_POLICY_WRITE = "admin.securityPolicy.write";

/** Resolve (objectKey, actionKey) against the canonical catalog, and prove the Object is governed. */
async function resolveGrantTarget(repo: PolicyRepository, tenantId: string, objectKey: string, actionKey: string) {
  const capabilities = await repo.listCapabilities();
  let capability;
  try {
    capability = resolveObjectAction(capabilities, objectKey, actionKey);
  } catch (err) {
    throw new PolicyValidationError((err as Error).message);
  }
  // THE OBJECT MUST EXIST IN THIS TENANT'S CATALOG, not only in the capability metadata.
  const object = await repo.getObjectByKey(tenantId, capability.objectKey);
  if (!object) throw new PolicyValidationError(`this tenant has no governed Object "${capability.objectKey}"`);
  return capability;
}

const requireReason = (reason: string | null | undefined, what: string): string => {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new AdministrationRefusal("REASON_REQUIRED", `${what} requires a reason`);
  }
  return reason.trim();
};

/**
 * Validate one condition exactly as the RUNTIME will read it -- the evaluator's catalog builder and
 * withheld-cell guard -- and against the CONDITIONABLE_GRANTS allow-list: only a capability whose every
 * consuming gate evaluates entitlements, only its listed record kinds, only governed parameters.
 */
function validateRoleCondition(roleKey: string, capabilityKey: string, condition: unknown): void {
  const allowed = CONDITIONABLE_GRANTS.find((g) => g.capabilityKey === capabilityKey);
  if (!allowed) {
    throw new AdministrationRefusal("CONDITION_NOT_SUPPORTED",
      `${capabilityKey} may not carry a condition: a gate that reads it cannot evaluate one (see listSupportedConditionKinds)`);
  }
  let catalog;
  try {
    catalog = grantConditionCatalogFromRows([{ grantScope: "ROLE", grantorKey: roleKey, capabilityKey, condition }]);
    assertNoWithheldGrantConditions(catalog);
  } catch (err) {
    throw new AdministrationRefusal("CONDITION_INVALID", (err as Error).message);
  }
  const parsed = [...catalog.values()][0];
  if (parsed.recordKind !== undefined && !allowed.recordKinds.includes(parsed.recordKind)) {
    throw new AdministrationRefusal("CONDITION_NOT_SUPPORTED", `${capabilityKey} does not support recordKind ${parsed.recordKind}`);
  }
  for (const path of parsed.paths) {
    for (const predicate of path) {
      if (!(allowed.kinds as readonly string[]).includes(predicate.kind)) {
        throw new AdministrationRefusal("CONDITION_NOT_SUPPORTED", `${capabilityKey} does not support ${predicate.kind}`);
      }
      if (predicate.kind === "WORK_ELIGIBILITY" && !GOVERNED_QUALIFICATION_CODES.has(predicate.qualificationCode)) {
        throw new AdministrationRefusal("CONDITION_INVALID", `"${predicate.qualificationCode}" is not a governed qualification code`);
      }
      if (predicate.kind === "OPERATIONAL_SCOPE"
          && !CONDITION_OPERATIONAL_SCOPE_TYPES.includes(predicate.scopeType)) {
        throw new AdministrationRefusal("CONDITION_INVALID", `"${predicate.scopeType}" is not an Operational Scope type`);
      }
    }
  }
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The GLOBAL Role keys a principal qualifies for now (shared rule with the runtime resolver). */
async function qualifyingRoleKeys(repo: PolicyRepository, tenantId: string, principalId: string): Promise<string[]> {
  const policy = await loadPrincipalPolicy(repo, tenantId, principalId);
  const roles = await repo.listRoles(tenantId);
  const keyById = new Map(roles.map((r) => [r.id, r.key]));
  return [...new Set(policy.qualifyingRoleIds.map((id) => keyById.get(id)).filter((k): k is string => Boolean(k)))];
}

/**
 * OWNER GOVERNANCE AT THE PRINCIPAL (ruling A): refuse if, after adding `extraRoleKeys` / `extraDirect`,
 * a principal holding the owner Role would reach an excluded capability by ANY path.
 */
async function refuseOwnerPrincipalViolation(
  repo: PolicyRepository, tenantId: string, principalId: string,
  extraRoleKeys: readonly string[], extraDirect: readonly string[],
): Promise<void> {
  const roleKeys = [...new Set([...(await qualifyingRoleKeys(repo, tenantId, principalId)), ...extraRoleKeys])];
  if (!roleKeys.includes("owner")) return;
  const effective = new Set([...(await capabilityKeysFor(repo, tenantId, roleKeys, principalId)), ...extraDirect]);
  const violations = ownerPrincipalViolations(roleKeys, effective);
  if (violations.length > 0) {
    throw new AdministrationRefusal("SYSTEM_INVARIANT",
      `a principal holding the owner Role may never hold ${violations.join(", ")} (Owner ruling A), by any Role or direct grant`);
  }
}

/** Principals holding this Role through an ACTIVE assignment. */
async function principalsHoldingRole(repo: PolicyRepository, tenantId: string, roleId: string): Promise<string[]> {
  const out: string[] = [];
  for (const principalId of await repo.listTenantPrincipalIds(tenantId)) {
    const assignments = await repo.listAssignmentsForPrincipal(tenantId, principalId);
    if (assignments.some((a) => a.status === "active" && a.roleId === roleId)) out.push(principalId);
  }
  return out;
}

/**
 * ANTI-LOCKOUT (PLATFORM_SAFETY), inside the transaction and under the governance lock: refuse a
 * change after which NO principal the gate would admit holds a governing Administration capability.
 */
async function refuseIfLastAdministrationPath(
  tx: PolicyTransaction,
  exclude: { readonly assignmentId?: string; readonly roleId?: string; readonly principalId?: string },
  onlyCapability?: string,
): Promise<void> {
  for (const key of ADMINISTRATION_GOVERNING_CAPABILITIES) {
    if (onlyCapability !== undefined && onlyCapability !== key) continue;
    const before = await tx.administrationHolderCount(key, {});
    if (before === 0) continue; // nothing to lose; the tenant was not administered this way
    const after = await tx.administrationHolderCount(key, exclude);
    if (after === 0) {
      throw new AdministrationRefusal("WOULD_REMOVE_LAST_ADMINISTRATION_PATH",
        `no principal the gate would admit would still hold ${key}; the tenant would become unadministrable`);
    }
  }
}

/**
 * Grant an Object action to a Security Role, THROUGH ADMINISTRATION.
 *
 * ONE transaction, under the tenant governance lock and the grant-cell lock: the optional condition,
 * the effective row, ONE audit event and ONE ADMIN_GRANTED decision. Every state-dependent check --
 * the no-op test, the condition still being ACTIVE, requiresCondition -- is made INSIDE it (Pass 8
 * D3/D6/D11), so a concurrent retire, revoke or identical grant cannot slip between check and act.
 */
export async function grantObjectActionToRole(
  repo: PolicyRepository, actor: AdminActor, input: ObjectActionRoleGrantInput,
): Promise<RoleCapabilityRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const reason = requireReason(input.reason, "a Role grant");
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  const role = await repo.getRoleByKey(actor.tenantId, nonEmpty(input.roleKey, "roleKey"));
  if (!role) throw new PolicyValidationError("role not found");

  const invariant = forbiddenPair(role.key, capability.key);
  if (invariant) {
    throw new AdministrationRefusal("SYSTEM_INVARIANT", `${role.key} may never hold ${capability.key} (${invariant.ruling})`);
  }
  // NOBODY WIDENS A ROLE THEY HOLD (self-grant, Pass 8 D5a).
  if ((Array.isArray(actor.heldRoleKeys) ? actor.heldRoleKeys : []).includes(role.key)) {
    throw new AdministrationRefusal("SELF_ADMINISTRATION", `a principal may not grant a capability to a Role it holds (${role.key})`);
  }
  // OWNER GOVERNANCE AT THE PRINCIPAL: no holder of this Role who also holds owner may gain an excluded key.
  if (OWNER_EXCLUDED_CAPABILITIES.includes(capability.key)) {
    for (const principalId of await principalsHoldingRole(repo, actor.tenantId, role.id)) {
      await refuseOwnerPrincipalViolation(repo, actor.tenantId, principalId, [], [capability.key]);
    }
  }
  const condition = input.condition === undefined || input.condition === null ? null : input.condition;
  if (condition !== null) validateRoleCondition(role.key, capability.key, condition);
  const requiresCondition = input.requiresCondition === true;

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    await tx.lockGrantCell(role.key, capability.key);
    const cell = await tx.readGrantCell(role.key, capability.key);
    if (requiresCondition && condition === null && !cell.condition) {
      throw new AdministrationRefusal("CONDITION_REQUIRED",
        `${role.key}/${capability.key} is marked as requiring a condition and none is supplied or active`);
    }
    const conditionChanges = condition !== null && !sameJson(cell.condition?.condition, condition);
    // NO-OP, decided under the locks: held, not administratively revoked, no condition change, and no
    // new requirement. A concurrent identical grant therefore returns the committed row, cleanly.
    if (cell.grant && cell.decision?.decision !== "ADMIN_REVOKED" && !conditionChanges
        && (!requiresCondition || cell.decision?.requiresCondition === true)) {
      return cell.grant;
    }
    // Condition FIRST, then the grant: the grant is never visible unconditioned.
    const storedCondition = conditionChanges
      ? await tx.upsertGrantCondition({ grantScope: "ROLE", grantorKey: role.key, capabilityKey: capability.key, condition })
      : cell.condition;
    const grant = await tx.grantRoleCapability({
      roleId: role.id,
      capabilityId: capability.id,
      grantedBy: actor.uid,
      grantedAt: new Date().toISOString(),
    });
    const auditEventId = await tx.appendAudit({
      ...auditBase(actor, "grantObjectActionToRole", "roleCapability", grant.id, reason),
      before: {
        objectKey: capability.objectKey, actionKey: capability.actionKey, capabilityKey: capability.key,
        granteeType: "ROLE", granteeKey: role.key, held: Boolean(cell.grant),
        decision: cell.decision?.decision ?? null, condition: cell.condition?.condition ?? null,
      },
      after: {
        objectKey: capability.objectKey, actionKey: capability.actionKey,
        capabilityKey: capability.key, granteeType: "ROLE", granteeKey: role.key, grant, held: true,
        decision: "ADMIN_GRANTED", requiresCondition, condition: storedCondition?.condition ?? null,
      },
    });
    await tx.recordRoleCapabilityDecision({
      roleKey: role.key, capabilityKey: capability.key, decision: "ADMIN_GRANTED", requiresCondition,
      reason, actorPrincipalId: actor.uid, auditEventId,
    });
    return grant;
  });
}

/**
 * Revoke an Object action from a Security Role, THROUGH ADMINISTRATION.
 *
 * ONE transaction under the governance and cell locks: the effective row removed, ONE audit event, ONE
 * ADMIN_REVOKED decision. The decision keeps the revoke -- no default writer re-inserts it (the
 * reconcile skips it; the database refuses a raw insert). Anti-lockout is checked inside the lock.
 * Revoking something not held is a no-op.
 */
export async function revokeObjectActionFromRole(
  repo: PolicyRepository, actor: AdminActor, input: ObjectActionRoleGrantInput,
): Promise<RoleCapabilityRecord | null> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const reason = requireReason(input.reason, "a Role revoke");
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  const role = await repo.getRoleByKey(actor.tenantId, nonEmpty(input.roleKey, "roleKey"));
  if (!role) throw new PolicyValidationError("role not found");

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    await tx.lockGrantCell(role.key, capability.key);
    const cell = await tx.readGrantCell(role.key, capability.key);
    if (!cell.grant) return null; // nothing was granted; nothing happened; nothing to audit
    if (ADMINISTRATION_GOVERNING_CAPABILITIES.includes(capability.key)) {
      await refuseIfLastAdministrationPath(tx, { roleId: role.id }, capability.key);
    }
    const removed = await tx.revokeRoleCapability(role.id, capability.id);
    if (!removed) return null;
    const auditEventId = await tx.appendAudit({
      ...auditBase(actor, "revokeObjectActionFromRole", "roleCapability", removed.id, reason),
      before: {
        objectKey: capability.objectKey, actionKey: capability.actionKey,
        capabilityKey: capability.key, granteeType: "ROLE", granteeKey: role.key, grant: removed, held: true,
        decision: cell.decision?.decision ?? null, condition: cell.condition?.condition ?? null,
      },
      after: {
        objectKey: capability.objectKey, actionKey: capability.actionKey, capabilityKey: capability.key,
        granteeType: "ROLE", granteeKey: role.key, held: false, decision: "ADMIN_REVOKED",
        condition: cell.condition?.condition ?? null,
      },
    });
    await tx.recordRoleCapabilityDecision({
      roleKey: role.key, capabilityKey: capability.key, decision: "ADMIN_REVOKED", requiresCondition: false,
      reason, actorPrincipalId: actor.uid, auditEventId,
    });
    return removed;
  });
}

// ════════════════════ GRANT CONDITIONS — capability_grant_conditions ════════════════════
//
// A condition NARROWS one grant cell (Role, capability); it never creates access. Only the
// CONDITIONABLE_GRANTS allow-list may carry one (listSupportedConditionKinds). Supported predicate
// kinds are the evaluator's: RECORD_ASSIGNMENT (ASSIGNED_EMPLOYEE, a listed recordKind),
// WORK_ELIGIBILITY (a governed qualification code), OPERATIONAL_SCOPE (a governed scope type).

export interface GrantConditionCommandInput {
  readonly objectKey: string;
  readonly actionKey: string;
  readonly roleKey: string;
  readonly condition?: unknown;
  readonly reason?: string | null;
}

/**
 * Establish or replace the condition on one Role grant cell. Setting a condition on a HELD grant
 * narrows it (safe); on an un-held cell it is inert until the grant exists, and then it binds.
 */
export async function setGrantCondition(
  repo: PolicyRepository, actor: AdminActor, input: GrantConditionCommandInput,
): Promise<GrantConditionRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const reason = requireReason(input.reason, "a grant condition");
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  const role = await repo.getRoleByKey(actor.tenantId, nonEmpty(input.roleKey, "roleKey"));
  if (!role) throw new PolicyValidationError("role not found");
  if (input.condition === undefined || input.condition === null) {
    throw new AdministrationRefusal("CONDITION_INVALID", "a condition is required; retire a condition with retireGrantCondition");
  }
  validateRoleCondition(role.key, capability.key, input.condition);

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    await tx.lockGrantCell(role.key, capability.key);
    const existing = (await tx.readGrantCell(role.key, capability.key)).condition;
    if (existing && sameJson(existing.condition, input.condition)) return existing;
    const stored = await tx.upsertGrantCondition({
      grantScope: "ROLE", grantorKey: role.key, capabilityKey: capability.key, condition: input.condition,
    });
    await tx.appendAudit({
      ...auditBase(actor, "setGrantCondition", "grantCondition", stored.id, reason),
      before: existing ? { grantScope: "ROLE", granteeKey: role.key, capabilityKey: capability.key,
        objectKey: capability.objectKey, actionKey: capability.actionKey, condition: existing.condition, status: "ACTIVE" } : null,
      after: { grantScope: "ROLE", granteeKey: role.key, capabilityKey: capability.key,
        objectKey: capability.objectKey, actionKey: capability.actionKey, condition: stored.condition, status: stored.status },
    });
    return stored;
  });
}

/**
 * Retire the condition on one Role grant cell. REFUSED while the grant is held -- lifting it would
 * widen the grant to every record -- decided INSIDE the cell lock the grant path also takes, and
 * re-enforced by the database trigger. Revoke first, then retire, then re-grant if an unconditional
 * grant is truly intended: three audited decisions, never an accident.
 */
export async function retireGrantCondition(
  repo: PolicyRepository, actor: AdminActor, input: GrantConditionCommandInput,
): Promise<GrantConditionRecord | null> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const reason = requireReason(input.reason, "retiring a grant condition");
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  const role = await repo.getRoleByKey(actor.tenantId, nonEmpty(input.roleKey, "roleKey"));
  if (!role) throw new PolicyValidationError("role not found");
  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    await tx.lockGrantCell(role.key, capability.key);
    const cell = await tx.readGrantCell(role.key, capability.key);
    if (!cell.condition) return null;
    if (cell.grant) {
      throw new AdministrationRefusal("CONDITION_RETIREMENT_WOULD_WIDEN",
        `${role.key} still holds ${capability.key}; retiring its condition would widen it to every record -- revoke the grant first`);
    }
    const retired = await tx.retireGrantCondition("ROLE", role.key, capability.key);
    if (!retired) return null;
    await tx.appendAudit({
      ...auditBase(actor, "retireGrantCondition", "grantCondition", retired.id, reason),
      before: { grantScope: "ROLE", granteeKey: role.key, capabilityKey: capability.key,
        objectKey: capability.objectKey, actionKey: capability.actionKey, condition: cell.condition.condition, status: "ACTIVE" },
      after: { grantScope: "ROLE", granteeKey: role.key, capabilityKey: capability.key,
        objectKey: capability.objectKey, actionKey: capability.actionKey, condition: retired.condition, status: retired.status },
    });
    return retired;
  });
}

// ════════════════════ DIRECT PRINCIPAL GRANTS (governed exceptions) ════════════════════

export async function grantObjectActionToPrincipal(
  repo: PolicyRepository, actor: AdminActor, input: ObjectActionPrincipalGrantInput,
): Promise<PrincipalCapabilityRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const reason = requireReason(input.reason, "a direct Principal grant (a governed exception)");
  let expiresAt: string | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    const at = Date.parse(String(input.expiresAt));
    if (!Number.isFinite(at)) throw new PolicyValidationError("expiresAt must be an ISO timestamp");
    if (at <= Date.now()) throw new PolicyValidationError("expiresAt must be in the future");
    expiresAt = new Date(at).toISOString();
  }
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  const principalId = nonEmpty(input.principalId, "principalId");

  // A PRINCIPAL, NEVER AN EMPLOYEE, and a MEMBER of this tenant (tenant consistency).
  const membership = await repo.getMembership(actor.tenantId, principalId);
  if (!membership || membership.status !== "active") {
    throw new PolicyValidationError("that principal is not an active member of this tenant");
  }
  if (principalId === actor.uid) {
    throw new AdministrationRefusal("SELF_ADMINISTRATION", "a principal may not grant a capability to itself");
  }
  await refuseOwnerPrincipalViolation(repo, actor.tenantId, principalId, [], [capability.key]);

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    // Unexpired -> an idempotent no-op. Expired -> REFRESHED (new reason and expiry), and audited as
    // such; never "granted" while it stays expired (Pass 8 D9).
    const all = await repo.listPrincipalCapabilities(actor.tenantId, principalId);
    const existing = all.find((g) => g.capabilityId === capability.id);
    if (existing) return existing;
    const grant = await tx.grantPrincipalCapability({
      principalId,
      capabilityId: capability.id,
      grantedBy: actor.uid,
      grantedAt: new Date().toISOString(),
      exceptionReason: reason,
      expiresAt,
    });
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) {
      throw new PolicyStoreError("the direct grant could not be refreshed");
    }
    await tx.appendAudit({
      ...auditBase(actor, "grantObjectActionToPrincipal", "principalCapability", grant.id, reason),
      before: null,
      after: {
        objectKey: capability.objectKey, actionKey: capability.actionKey,
        capabilityKey: capability.key, granteeType: "PRINCIPAL", granteeKey: principalId, grant,
        source: "DIRECT_EXCEPTION", exceptionReason: reason, expiresAt,
      },
    });
    return grant;
  });
}

export async function revokeObjectActionFromPrincipal(
  repo: PolicyRepository, actor: AdminActor, input: ObjectActionPrincipalGrantInput,
): Promise<PrincipalCapabilityRecord | null> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const reason = requireReason(input.reason, "revoking a direct Principal grant");
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  const principalId = nonEmpty(input.principalId, "principalId");

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    if (ADMINISTRATION_GOVERNING_CAPABILITIES.includes(capability.key)) {
      await refuseIfLastAdministrationPath(tx, { principalId }, capability.key);
    }
    const removed = await tx.revokePrincipalCapability(principalId, capability.id);
    if (!removed) return null;
    await tx.appendAudit({
      ...auditBase(actor, "revokeObjectActionFromPrincipal", "principalCapability", removed.id, reason),
      before: {
        objectKey: capability.objectKey, actionKey: capability.actionKey,
        capabilityKey: capability.key, granteeType: "PRINCIPAL", granteeKey: principalId, grant: removed,
      },
      after: null,
    });
    return removed;
  });
}
