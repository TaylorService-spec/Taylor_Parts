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
  ADMINISTRATOR_STAFFING_CAPABILITY,
  AdministrationDeniedError,
  isDesignatedAdministratorRole,
  isProtectedOwnerRole,
  PROTECTED_ROLE_KEYS,
  requireAdministrationAuthority,
} from "./administrationAuthority";
import { actorAuthorityOf, hasProtectedAdministratorStanding, isImpliedForProtectedAdministrator, PROTECTED_ADMINISTRATOR_AUTHORITY } from "./protectedAdministrator";
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
  PrincipalIdentityBindingRecord,
  RoleObjectPermissionRecord,
  TenantId,
} from "./types";
import { EOS_IDENTITY_PROVIDER, resolvePrincipalByVerifiedIdentity } from "./principalContext";
import type { PolicyRepository, PolicyTransaction } from "./policyRepository";
import { actorCapabilities, capabilityKeysFor, requireSecurityAdministrationCapability } from "./administrationCapabilityGate";
import {
  ADMINISTRATION_GOVERNING_CAPABILITIES,
  CONDITIONABLE_GRANTS,
  CONDITION_OPERATIONAL_SCOPE_TYPES,
  OWNER_EXCLUDED_CAPABILITIES,
  forbiddenPair,
  ownerPrincipalViolations,
  RESERVED_CAPABILITY_HOLDERS,
} from "./roleCapabilityAdministration";
import { loadPrincipalPolicy } from "./effectiveObjectAccess";
import { PolicyStoreError } from "./policyRepository";
import { GOVERNED_QUALIFICATION_CODES } from "../eosOps/contextualAuthorization";
import {
  assertNoWithheldGrantConditions,
  grantConditionCatalogFromRows,
} from "../eosOps/conditionalEntitlement";
import type { GrantConditionRecord, RoleCapabilityDecisionRecord } from "./types";
import { actionsForObject, resolveObjectAction } from "./objectSecurityAuthority";
import {
  ASSIGNMENT_SCOPE_DIMENSIONS,
  ASSIGNMENT_SCOPE_RUNTIME_TYPES,
  isAdministrationCapability,
  isAssignmentScopeRuntimeType,
  isRuntimeSupportedScopeType,
  scopeEvaluableCapabilities,
  SCOPE_EVALUABLE_GRANTS,
  UNSUPPORTED_SCOPE_REASONS,
} from "./assignmentScopeRuntime";
import { SALES_CHANNELS } from "../opportunity/opportunityLifecycle";
import type { PolicyReader, AssignmentScopeValue } from "./policyRepository";

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
   * PROTECTED ADMINISTRATOR standing (DECISIONS #223), server-derived by the trusted API from the same qualifying Roles.
   * Provenance only: it is recorded on the actor's audit events and decides nothing (the capability gates resolve
   * standing themselves).
   */
  readonly protectedAdministrator?: boolean;
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
    // Owner and Administrator are distinct authority types (DECISIONS #223): never held by one principal.
    | "PROTECTED_ROLE_CONFLICT"
    | "WOULD_REMOVE_LAST_ADMINISTRATION_PATH"
    // Assignment scope (lane SC): Administration never stores a scope the runtime would ignore.
    | "SCOPE_TYPE_UNSUPPORTED"
    | "SCOPE_VALUE_INVALID"
    | "SCOPE_NOT_EVALUABLE_FOR_ROLE"
    | "SCOPE_AMBIGUOUS_ADMINISTRATION"
    // Tenant sales channels (lane GA): a channel is never deactivated under an assignment still scoped to it.
    | "SALES_CHANNEL_INVALID"
    | "SALES_CHANNEL_HAS_SCOPED_ASSIGNMENTS"
    | "SALES_CHANNEL_STORE_UNAVAILABLE"
    // Direct exceptions (lane DX): principal_capabilities has no scope model.
    | "DIRECT_GRANT_SCOPE_UNSUPPORTED"
    // Protected Owner (Controller ruling 2026-09-27): ordinary role administration never appoints or removes
    // the protected Owner, and never leaves a tenant with zero active protected Owners.
    | "PROTECTED_OWNER_MEMBERSHIP"
    | "LAST_PROTECTED_OWNER", message: string) {
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
  ...actorAuthorityOf(actor),
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
  // Nor a RESERVED capability's holder key (Owner G7, #226): a CUSTOM Role keyed `generalManager` in a tenant without one
  // would otherwise satisfy the reservation by its key alone (security review, PR-4a).
  for (const [capabilityKey, reserved] of RESERVED_CAPABILITY_HOLDERS) {
    if (reserved.roleKeys.includes(key)) {
      throw new PolicyValidationError(`"${key}" is a reserved holder of ${capabilityKey} and cannot be created as a custom role`);
    }
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
 * `(identity_provider, external_subject)` under a UNIQUE constraint, and (until migration 1764200000000,
 * which added an ADDITIONAL binding for EOS-issued identities only -- bindPrincipalEosIdentity) there was no
 * separate identity-binding table. A Principal provisioned against a provider no verifier recognizes is
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
  // An EOS subject may also be held through an ADDITIONAL binding (principal_identities). Re-pointing a
  // primary onto a subject another Principal holds that way would make one subject name two Principals.
  if (identityProvider === EOS_IDENTITY_PROVIDER) {
    const bound = await repo.getPrincipalByIdentityBinding(identityProvider, externalSubject);
    if (bound) throw new PolicyValidationError("that EOS identity is already bound to a principal");
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

// ════════════════════ EOS IDENTITY BINDING — OWNER, GENERAL MANAGER OR ADMIN ════════════════════
//
// docs/architecture/eos-identity-session-foundation.md, section 3(c). ADDITIVE: the Principal keeps its
// primary (Firebase) binding; this adds an EOS-issued identity that resolves to the SAME Principal, so no
// Role, grant, scope, assignment, Employee link or audit reference moves.

/** An EOS identity subject. Mirrors the principal_identities CHECK and the token verifier. */
const EOS_SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

export interface BindPrincipalEosIdentityInput {
  readonly principalId: string;
  readonly externalSubject: string;
  readonly reason: string;
}

/**
 * Bind an EOS identity subject to an EXISTING Principal. Identity only -- never an authority change.
 *
 *   GATE        the same assignment-shaped authority as rebindPrincipalIdentity (naming who a Principal IS).
 *   NOT A CREATE a Principal that does not exist, or is not an ACTIVE member of the actor's tenant, is refused.
 *   NOT SELF     the actor may not bind an identity to itself: that is a login it could hand to anyone.
 *   NO SPLIT     a subject already bound (even revoked) or already some Principal's primary is refused, and a
 *                Principal holds at most ONE active EOS binding.
 *   NO-OP        re-stating the identical ACTIVE binding writes nothing and appends no audit event.
 *   AUDITED      one audit_events row, actor = the administering Principal, target = the Principal, with the
 *                binding in `after`. The access version is bumped (conservative: caches keyed on the old
 *                login set are invalidated; no grant is affected).
 */
export async function bindPrincipalEosIdentity(
  repo: PolicyRepository,
  actor: AdminActor,
  input: BindPrincipalEosIdentityInput,
): Promise<PrincipalIdentityBindingRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "assignRole");
  const principalId = nonEmpty(input.principalId, "principalId");
  const externalSubject = nonEmpty(input.externalSubject, "externalSubject");
  const reason = nonEmpty(input.reason, "reason");
  if (!EOS_SUBJECT.test(externalSubject)) throw new PolicyValidationError("externalSubject is not a valid EOS subject");
  if (reason.length > 500) throw new PolicyValidationError("reason is too long");
  if (principalId === actor.uid) {
    throw new PolicyValidationError("an administrator may not bind an identity to their own principal");
  }

  const principal = await repo.getPrincipal(principalId);
  if (!principal) throw new PolicyValidationError("principal not found");
  const membership = await repo.getMembership(actor.tenantId, principalId);
  if (!membership || membership.status !== "active") {
    throw new PolicyValidationError("that principal is not an active member of this tenant");
  }

  const existing = await repo.getActiveIdentityBinding(principalId, EOS_IDENTITY_PROVIDER);
  if (existing) {
    if (existing.externalSubject === externalSubject) return existing; // silent no-op
    throw new PolicyValidationError("that principal already has an active EOS identity; revoke it first");
  }
  const holder = await resolvePrincipalByVerifiedIdentity(repo, EOS_IDENTITY_PROVIDER, externalSubject);
  if (holder) throw new PolicyValidationError("another principal already holds that identity");

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const created = await tx.createPrincipalIdentityBinding({
      principalId, identityProvider: EOS_IDENTITY_PROVIDER, externalSubject, createdBy: actor.uid, reason,
    });
    await tx.bumpAccessVersion(principalId);
    await tx.appendAudit({
      ...auditBase(actor, "bindPrincipalEosIdentity", "principal", principalId, reason),
      before: null,
      after: { bindingId: created.id, identityProvider: created.identityProvider, externalSubject: created.externalSubject, status: created.status },
    });
    return created;
  });
}

export interface RevokePrincipalEosIdentityInput {
  readonly principalId: string;
  readonly reason: string;
}

/** Revoke a Principal's ACTIVE EOS identity. Final: the subject is never re-issued. Same gate, audited. */
export async function revokePrincipalEosIdentity(
  repo: PolicyRepository,
  actor: AdminActor,
  input: RevokePrincipalEosIdentityInput,
): Promise<PrincipalIdentityBindingRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "assignRole");
  const principalId = nonEmpty(input.principalId, "principalId");
  const reason = nonEmpty(input.reason, "reason");
  if (reason.length > 500) throw new PolicyValidationError("reason is too long");
  const membership = await repo.getMembership(actor.tenantId, principalId);
  if (!membership) throw new PolicyValidationError("that principal is not a member of this tenant");
  const existing = await repo.getActiveIdentityBinding(principalId, EOS_IDENTITY_PROVIDER);
  if (!existing) throw new PolicyValidationError("that principal has no active EOS identity");
  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    const revoked = await tx.revokePrincipalIdentityBinding(principalId, EOS_IDENTITY_PROVIDER, actor.uid, reason);
    await tx.bumpAccessVersion(principalId);
    await tx.appendAudit({
      ...auditBase(actor, "revokePrincipalEosIdentity", "principal", principalId, reason),
      before: { bindingId: existing.id, identityProvider: existing.identityProvider, externalSubject: existing.externalSubject, status: existing.status },
      after: { bindingId: revoked.id, identityProvider: revoked.identityProvider, externalSubject: revoked.externalSubject, status: revoked.status },
    });
    return revoked;
  });
}

// ════════════════════ ROLE ASSIGNMENT — OWNER, GENERAL MANAGER OR ADMIN ════════════════════

export interface AssignRoleInput {
  readonly principalId: string;
  readonly roleId: string;
  readonly scopeType?: string;
  readonly scopeValue?: string | null;
  readonly reason?: string | null;
  /**
   * HUMAN ADMINISTRATION CONTRACT (Pass 10 ruling, 2026-09-27): the Administration API sets this so a human
   * assignment must carry a STATED reason (REASON_REQUIRED otherwise), decided right after the capability gate
   * exactly as every policy-editing command decides its reason. Operator scripts and bootstrap call this command
   * directly and pass their own explicit reasons; the command's reason stays optional for them.
   */
  readonly requireStatedReason?: boolean;
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
  if (input.requireStatedReason === true) requireReason(input.reason, "assigning a Security Role");
  const principalId = nonEmpty(input.principalId, "principalId");
  const roleId = nonEmpty(input.roleId, "roleId");
  const scopeType = input.scopeType ?? "global";
  const scopeValue = input.scopeValue ?? null;

  const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
  if (!role) throw new PolicyValidationError("role not found");
  // PROTECTED OWNER (Controller ruling 2026-09-27): never appointed through ordinary role administration --
  // not by admin.roleAssignment.write, admin.securityPolicy.write or R1, whoever the target. Decided before
  // anything else about the request, so no caller can learn more than the refusal.
  refuseProtectedOwnerMembership(role, "assign");

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
  // assignment capability mints the definition capability (Pass 8 D5) -- with ONE exception, Owner
  // ruling R1: the designated Administrator Role, for another Principal, globally, by a holder of
  // admin.administratorRole.assign. Decided here and again UNDER THE GOVERNANCE LOCK below.
  await authorizeSecurityPolicyStaffing(repo, actor, role, principalId, scopeType, "assign");
  // (b2) OWNER AND ADMINISTRATOR ARE DISTINCT AUTHORITY TYPES (DECISIONS #223): the designated Administrator Role is
  // never given to a principal that holds the protected Owner Role. (The Owner itself is never appointed through
  // ordinary role administration -- refused above.) Historical memberships are not altered here.
  if (isDesignatedAdministratorRole(role)) await refuseProtectedRoleConflict(repo, actor.tenantId, principalId);
  // (c) OWNER GOVERNANCE AT THE PRINCIPAL: an owner holder may not reach an excluded capability by
  // any Role (ruling A).
  // Checked for a scoped assignment too (lane SC): stricter, never wider.
  await refuseOwnerPrincipalViolation(repo, actor.tenantId, principalId, [role.key], []);

  const held = await repo.listAssignmentsForPrincipal(actor.tenantId, principalId);
  const already = held.find(
    (a) => a.status === "active" && sameEffectiveAssignment(a, roleId, scopeType, scopeValue),
  );
  if (already) return already;

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    // NO CONFIGURATION THE RUNTIME IGNORES (lane SC), decided UNDER THE GOVERNANCE LOCK (Pass 9 S2): a scoped
    // assignment is stored only when the runtime decides it -- a consumed scope type, a governed value in THIS tenant,
    // a Role carrying at least one capability evaluable at that scope, and no Administration capability. Every
    // grant takes the same lock, so an Administration grant cannot commit between this check and the insert.
    await refuseUnsupportedAssignmentScope(repo, actor.tenantId, role, scopeType, scopeValue);
    // D5(b) / R1 re-decided under the lock, against the STORE (a concurrent revoke of the actor's staffing
    // capability, or a grant of admin.securityPolicy.write to this Role, has committed or waits for us).
    const staffing = await authorizeSecurityPolicyStaffing(repo, actor, role, principalId, scopeType, "assign", { fresh: true });
    // Owner and Administrator stay distinct, re-decided under the lock (a concurrent Owner appointment has committed or waits).
    if (isDesignatedAdministratorRole(role)) await refuseProtectedRoleConflict(repo, actor.tenantId, principalId);
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
      after: staffingAudit(staffing, assignment),
    });
    return assignment;
  });
}

// ════════════════════ SECURITY ROLE ASSIGNMENT SCOPE (lane SC) ════════════════════

/**
 * The governed values this scope type may take in this tenant, or null when there is no governed source.
 *
 * Only a TENANT-SCOPED governed source counts (lane GA): operatingCompany -> ACTIVE tenant_operating_companies;
 * location -> ACTIVE eos_ops.warehouses; salesChannel -> ACTIVE tenant_sales_channels. businessUnit has none (FIN-002
 * BUSINESS_UNITS is a platform constant, not this tenant's Administration data), so it is null -- never a hard-coded
 * list offered as though it were governed.
 */
export async function governedAssignmentScopeValues(
  repo: PolicyReader, tenantId: string, scopeType: string,
): Promise<readonly AssignmentScopeValue[] | null> {
  if (scopeType === "businessUnit") return null;
  if (typeof repo.listAssignmentScopeValues !== "function") return null;
  return repo.listAssignmentScopeValues(tenantId, scopeType);
}

/** Every capability a Role's grants reach, conditioned ones included (a scoped holding carries its condition). */
async function roleGrantCapabilityKeys(repo: PolicyReader, tenantId: string, roleId: string): Promise<ReadonlySet<string>> {
  const [catalog, grants] = await Promise.all([repo.listCapabilities(), repo.listRoleCapabilities(tenantId, [roleId])]);
  const keyById = new Map(catalog.map((c) => [c.id, c.key]));
  return new Set(grants.filter((g) => g.roleId === roleId).map((g) => keyById.get(g.capabilityId)).filter((k): k is string => !!k));
}

/**
 * Refuse any scope the runtime would ignore. `global` must carry no value. A non-global scope must be a scope type
 * with a runtime consumer, name a governed value of THIS tenant, and target a Role that carries at least one
 * capability evaluable at that scope (R-32 "some-binding" rule) and no `admin.*` capability.
 */
export async function refuseUnsupportedAssignmentScope(
  repo: PolicyReader, tenantId: string, role: Pick<PolicyRoleRecord, "id" | "key" | "protected">,
  scopeType: string, scopeValue: string | null,
): Promise<void> {
  if (scopeType === "global") {
    if (scopeValue !== null && scopeValue !== "") {
      throw new AdministrationRefusal("SCOPE_VALUE_INVALID", "a global assignment carries no scope value");
    }
    return;
  }
  if (!isRuntimeSupportedScopeType(scopeType)) {
    throw new AdministrationRefusal("SCOPE_TYPE_UNSUPPORTED",
      `scope type '${scopeType}' is not decided by the runtime: ${UNSUPPORTED_SCOPE_REASONS[scopeType] ?? "unknown scope type"}`);
  }
  if (typeof scopeValue !== "string" || scopeValue === "" || scopeValue.trim() !== scopeValue) {
    throw new AdministrationRefusal("SCOPE_VALUE_INVALID", `a ${scopeType} assignment names exactly one governed value`);
  }
  const values = await governedAssignmentScopeValues(repo, tenantId, scopeType);
  if (!values || !values.some((v) => v.value === scopeValue)) {
    throw new AdministrationRefusal("SCOPE_VALUE_INVALID",
      `'${scopeValue}' is not a governed ${ASSIGNMENT_SCOPE_DIMENSIONS[scopeType].label} of this tenant (${ASSIGNMENT_SCOPE_DIMENSIONS[scopeType].valueSource})`);
  }
  const carried = await roleGrantCapabilityKeys(repo, tenantId, role.id);
  const admin = [...carried].filter(isAdministrationCapability).sort();
  if (role.protected || admin.length > 0) {
    throw new AdministrationRefusal("SCOPE_AMBIGUOUS_ADMINISTRATION",
      `${role.key} carries Administration authority${admin.length ? ` (${admin.join(", ")})` : ""}, which every gate decides tenant-wide; it may only be assigned globally`);
  }
  const evaluable = [...carried].filter((k) => scopeEvaluableCapabilities(scopeType).has(k)).sort();
  if (evaluable.length === 0) {
    throw new AdministrationRefusal("SCOPE_NOT_EVALUABLE_FOR_ROLE",
      `${role.key} carries no capability the runtime decides at ${scopeType} scope `
      + `(evaluable: ${[...scopeEvaluableCapabilities(scopeType)].sort().join(", ")}); the assignment would grant nothing`);
  }
}

export interface SupportedAssignmentScopes {
  readonly scopeTypes: readonly {
    readonly scopeType: string;
    readonly label: string;
    readonly supported: boolean;
    readonly reason: string | null;
    readonly contextKey: string | null;
    readonly valueSource: string | null;
    readonly values: readonly AssignmentScopeValue[];
    readonly capabilities: readonly { readonly capabilityKey: string; readonly consumers: readonly string[] }[];
  }[];
  /** Per Role (all, or the one asked for): the scope types it may be assigned at and what each would confer. */
  readonly roles: readonly {
    readonly roleKey: string;
    readonly roleId: string;
    readonly assignableScopes: readonly {
      readonly scopeType: string;
      readonly assignable: boolean;
      readonly refusal: string | null;
      /** Capabilities the scoped assignment would confer (scope-qualified). */
      readonly scopedCapabilities: readonly string[];
      /** The Role's other capabilities: INERT at this scope, never granted by it. */
      readonly inertCapabilities: readonly string[];
    }[];
  }[];
}

/**
 * THE SCOPE VOCABULARY THE RUNTIME ENFORCES, served so the Security Roles picker offers nothing else. Every scope
 * type is listed -- unsupported ones with their reason, never silently absent -- and each Role says which scopes it
 * may be assigned at, what that would confer, and what would stay inert. Values are this tenant's governed values.
 */
export async function listSupportedAssignmentScopes(
  repo: PolicyReader, tenantId: string, input: { readonly roleKey?: string | null } = {},
): Promise<SupportedAssignmentScopes> {
  const types = ["global", ...ASSIGNMENT_SCOPE_RUNTIME_TYPES, "domain", "tenant", "ownAssignment"];
  const scopeTypes = [];
  for (const scopeType of types) {
    const supported = scopeType === "global" || isRuntimeSupportedScopeType(scopeType);
    const dim = isAssignmentScopeRuntimeType(scopeType) ? ASSIGNMENT_SCOPE_DIMENSIONS[scopeType] : null;
    scopeTypes.push(Object.freeze({
      scopeType,
      label: scopeType === "global" ? "All (global)" : dim?.label ?? scopeType,
      supported,
      reason: supported ? null : UNSUPPORTED_SCOPE_REASONS[scopeType] ?? "unknown scope type",
      contextKey: dim?.contextKey ?? null,
      valueSource: dim?.valueSource ?? null,
      values: supported && scopeType !== "global" ? (await governedAssignmentScopeValues(repo, tenantId, scopeType)) ?? [] : [],
      capabilities: SCOPE_EVALUABLE_GRANTS.filter((g) => g.scopeType === scopeType)
        .map((g) => Object.freeze({ capabilityKey: g.capabilityKey, consumers: g.consumers })),
    }));
  }
  const wanted = typeof input.roleKey === "string" && input.roleKey !== "" ? input.roleKey : null;
  const roles = (await repo.listRoles(tenantId)).filter((r) => !wanted || r.key === wanted);
  if (wanted && roles.length === 0) throw new PolicyValidationError("role not found");
  const out = [];
  for (const role of [...roles].sort((a, b) => a.key.localeCompare(b.key))) {
    const carried = [...(await roleGrantCapabilityKeys(repo, tenantId, role.id))].sort();
    const assignableScopes = [];
    for (const scopeType of ASSIGNMENT_SCOPE_RUNTIME_TYPES.filter((t) => isRuntimeSupportedScopeType(t))) {
      const evaluable = scopeEvaluableCapabilities(scopeType);
      const admin = carried.filter(isAdministrationCapability);
      const scopedCapabilities = carried.filter((k) => evaluable.has(k));
      const refusal = role.protected || admin.length > 0 ? "SCOPE_AMBIGUOUS_ADMINISTRATION"
        : scopedCapabilities.length === 0 ? "SCOPE_NOT_EVALUABLE_FOR_ROLE" : null;
      assignableScopes.push(Object.freeze({
        scopeType, assignable: refusal === null, refusal,
        scopedCapabilities: Object.freeze(refusal ? [] : scopedCapabilities),
        inertCapabilities: Object.freeze(carried.filter((k) => !evaluable.has(k))),
      }));
    }
    out.push(Object.freeze({ roleKey: role.key, roleId: role.id, assignableScopes: Object.freeze(assignableScopes) }));
  }
  return Object.freeze({ scopeTypes: Object.freeze(scopeTypes), roles: Object.freeze(out) });
}

// ════════════════════ TENANT SALES CHANNELS (lane GA, migration 1762905600000) ════════════════════

export interface SetTenantSalesChannelStatusInput {
  readonly salesChannel: string;
  readonly status: string;
  readonly reason: string | null;
}

export interface TenantSalesChannelChange {
  readonly outcome: "ACTIVATED" | "DEACTIVATED" | "NO_CHANGE";
  readonly salesChannel: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

/**
 * Activate or deactivate ONE sales channel for this tenant -- the governed value source of the salesChannel
 * assignment scope. Gate: admin.securityPolicy.write (it defines which scope values exist; it assigns nothing).
 *
 * Under the tenant governance lock, so it serializes with assignRole's scope-value check: a channel cannot be
 * deactivated between that check and the assignment's insert. Deactivation FAILS CLOSED while any ACTIVE assignment
 * is scoped to the channel -- nothing is revoked implicitly. Exactly one audit event per change; NO_CHANGE writes none.
 * The vocabulary is the Commercial record enum (SALES_CHANNELS = eos_commercial.commercial_sales_channel).
 */
export async function setTenantSalesChannelStatus(
  repo: PolicyRepository, actor: AdminActor, input: SetTenantSalesChannelStatusInput,
): Promise<TenantSalesChannelChange> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const salesChannel = nonEmpty(input.salesChannel, "salesChannel");
  if (!(SALES_CHANNELS as readonly string[]).includes(salesChannel)) {
    throw new AdministrationRefusal("SALES_CHANNEL_INVALID", `salesChannel must be one of ${SALES_CHANNELS.join(", ")}`);
  }
  const status = input.status;
  if (status !== "ACTIVE" && status !== "INACTIVE") {
    throw new AdministrationRefusal("SALES_CHANNEL_INVALID", "status must be ACTIVE or INACTIVE");
  }
  if (!input.reason) throw new AdministrationRefusal("REASON_REQUIRED", "a stated reason is required to change a tenant sales channel");
  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    if (typeof tx.readTenantSalesChannel !== "function" || typeof tx.writeTenantSalesChannel !== "function"
        || typeof tx.activeScopedAssignmentCount !== "function") {
      throw new AdministrationRefusal("SALES_CHANNEL_STORE_UNAVAILABLE", "this policy store has no tenant sales channel authority");
    }
    const before = await tx.readTenantSalesChannel(salesChannel);
    const current = before?.status ?? "INACTIVE";
    if (current === status) return Object.freeze({ outcome: "NO_CHANGE" as const, salesChannel, status });
    if (status === "INACTIVE") {
      const held = await tx.activeScopedAssignmentCount("salesChannel", salesChannel);
      if (held > 0) {
        throw new AdministrationRefusal("SALES_CHANNEL_HAS_SCOPED_ASSIGNMENTS",
          `${held} active Security Role assignment(s) are scoped to ${salesChannel}; revoke them first -- deactivation never revokes implicitly`);
      }
    }
    const after = await tx.writeTenantSalesChannel(salesChannel, status, "administration");
    await tx.appendAudit({
      ...auditBase(actor, "setTenantSalesChannelStatus", "tenantSalesChannel", salesChannel, input.reason),
      before: before ?? null,
      after,
    });
    return Object.freeze({ outcome: status === "ACTIVE" ? "ACTIVATED" as const : "DEACTIVATED" as const, salesChannel, status });
  });
}

// ════════════════════ D5(b) AND THE R1 ADMINISTRATOR STAFFING EXCEPTION ════════════════════

/** Which authority admitted a change to a Role carrying admin.securityPolicy.write. */
type SecurityPolicyStaffingAuthority = "NOT_REQUIRED" | "SECURITY_POLICY_WRITE" | "ADMINISTRATOR_STAFFING" | "PROTECTED_ADMINISTRATOR";

/** Recorded on the ONE audit event of a change the R1 staffing capability authorized. */
const ADMINISTRATOR_STAFFING_AUDIT = Object.freeze({
  authorizedBy: Object.freeze({ capabilityKey: ADMINISTRATOR_STAFFING_CAPABILITY, ownerRuling: "R1 (2026-09-26)" }),
});

/** The staffing authority recorded on an Administrator appointment / removal: R1 (Owner) or protected Administrator. */
function staffingAudit<T extends object>(staffing: SecurityPolicyStaffingAuthority, record: T): T | (T & { authorizedBy: unknown }) {
  if (staffing === "ADMINISTRATOR_STAFFING") return { ...record, ...ADMINISTRATOR_STAFFING_AUDIT };
  if (staffing === "PROTECTED_ADMINISTRATOR") return { ...record, authorizedBy: PROTECTED_ADMINISTRATOR_AUTHORITY };
  return record;
}

/**
 * Refuse the designated Administrator Role for a principal holding the protected Owner Role (DECISIONS #223), at ANY
 * scope and in any status the resolver would count (active).
 */
async function refuseProtectedRoleConflict(repo: PolicyRepository, tenantId: string, principalId: string): Promise<void> {
  const roles = await repo.listRoles(tenantId);
  const ownerIds = new Set(roles.filter((r) => isProtectedOwnerRole(r)).map((r) => r.id));
  if ((await repo.listAssignmentsForPrincipal(tenantId, principalId)).some((a) => a.status === "active" && ownerIds.has(a.roleId))) {
    throw new AdministrationRefusal("PROTECTED_ROLE_CONFLICT",
      "the protected Owner and the protected Administrator are distinct authority types; a principal holding the Owner Role may not be appointed Administrator");
  }
}

/**
 * Pass 8 D5(b), both directions, with the Owner ruling R1 exception.
 *
 * A Role that carries admin.securityPolicy.write (by any grant, conditioned included -- stricter, never wider) may be
 * assigned or removed only by an actor holding admin.securityPolicy.write. The ONE exception (R1): the DESIGNATED
 * Administrator Role (protected, key ADMIN_ROLE_KEY), GLOBAL, for a Principal OTHER than the actor, by an actor that
 * holds admin.administratorRole.assign -- global, unconditioned, unexpired (the flat set). Nothing else widens: a
 * custom Role carrying admin.securityPolicy.write, a scoped Administrator, a self-assignment or self-removal, a direct
 * grant and every definition edit still require admin.securityPolicy.write.
 *
 * `fresh`: resolve the actor's capabilities from the STORE (qualifying global Roles + unexpired direct grants), not
 * from the request-resolved set -- used under the governance lock so a concurrent revoke of the staffing capability
 * is honoured. The admin.securityPolicy.write path keeps the request-resolved set (unchanged behaviour); the R1 path
 * must hold in BOTH.
 */
async function authorizeSecurityPolicyStaffing(
  repo: PolicyRepository,
  actor: AdminActor,
  role: Pick<PolicyRoleRecord, "id" | "key" | "protected">,
  targetPrincipalId: string,
  scopeType: string,
  verb: "assign" | "revoke",
  options: { readonly fresh?: boolean } = {},
): Promise<SecurityPolicyStaffingAuthority> {
  const carried = await capabilityKeysFor(repo, actor.tenantId, [role.key], null, { includeConditioned: true });
  if (!carried.has(SECURITY_POLICY_WRITE)) return "NOT_REQUIRED";
  // NOBODY APPOINTS OR REMOVES THEMSELF AS ADMINISTRATOR, BY ANY AUTHORITY (DECISIONS #223): self-removal stays governed
  // -- another Administrator or the Owner acts -- whichever path below would otherwise admit it.
  if (isDesignatedAdministratorRole(role) && targetPrincipalId === actor.uid) {
    throw new AdministrationRefusal("SELF_ADMINISTRATION",
      `a principal may not ${verb === "assign" ? "assign the Administrator Role to" : "remove the Administrator Role from"} itself`);
  }
  // PROTECTED ADMINISTRATOR DELEGATION (DECISIONS #223): an Administrator with standing appoints and removes OTHER
  // Administrators -- the designated Role, globally, for another principal -- with the same protections as R1:
  // never itself, never at a scope, standing re-verified against the STORE under the governance lock.
  // Standing is an ADDITIONAL authority, never a new requirement: when it cannot be confirmed (here, or against the
  // store under the lock) the decision continues exactly as before. A SCOPED Administrator is never standing -- it
  // falls through to the existing scope refusals.
  if (isDesignatedAdministratorRole(role) && scopeType === "global") {
    const roles = await repo.listRoles(actor.tenantId);
    const standing = hasProtectedAdministratorStanding(roles, Array.isArray(actor.heldRoleKeys) ? actor.heldRoleKeys : [])
      && (options.fresh !== true || hasProtectedAdministratorStanding(roles, await qualifyingRoleKeys(repo, actor.tenantId, actor.uid)));
    if (standing) return "PROTECTED_ADMINISTRATOR";
  }
  const held = await actorCapabilities(repo, actor);
  if (held.has(SECURITY_POLICY_WRITE)) return "SECURITY_POLICY_WRITE";
  const act = verb === "assign" ? "assigning" : "removing";
  const refuse = (): never => {
    throw new AdministrationRefusal("PRIVILEGE_ESCALATION",
      `${act} ${role.key} concerns ${SECURITY_POLICY_WRITE}, which the acting principal does not hold`
      + (isDesignatedAdministratorRole(role)
        ? ` (${ADMINISTRATOR_STAFFING_CAPABILITY} admits only the designated Administrator Role, globally, for another principal)`
        : ""));
  };
  if (!isDesignatedAdministratorRole(role) || !held.has(ADMINISTRATOR_STAFFING_CAPABILITY)) refuse();
  if (targetPrincipalId === actor.uid) {
    throw new AdministrationRefusal("SELF_ADMINISTRATION",
      `a principal may not ${verb === "assign" ? "assign the Administrator Role to" : "remove the Administrator Role from"} itself`);
  }
  if (scopeType !== "global") refuse();
  if (options.fresh === true) {
    const stored = await capabilityKeysFor(repo, actor.tenantId,
      await qualifyingRoleKeys(repo, actor.tenantId, actor.uid), actor.uid);
    if (!stored.has(ADMINISTRATOR_STAFFING_CAPABILITY)) refuse();
  }
  return "ADMINISTRATOR_STAFFING";
}

export interface RevokeRoleInput {
  readonly assignmentId: string;
  readonly reason?: string | null;
  /** HUMAN ADMINISTRATION CONTRACT: see AssignRoleInput.requireStatedReason. */
  readonly requireStatedReason?: boolean;
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
  if (input.requireStatedReason === true) requireReason(input.reason, "removing a Security Role");
  const assignmentId = nonEmpty(input.assignmentId, "assignmentId");

  const target = await findAssignment(repo, actor.tenantId, assignmentId);
  if (!target) throw new PolicyValidationError("assignment not found");

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    const current = await tx.readAssignment(assignmentId);
    if (!current) throw new PolicyValidationError("assignment not found");
    let staffing: SecurityPolicyStaffingAuthority = "NOT_REQUIRED";
    const assignmentRoles = await repo.listRoles(actor.tenantId);
    const currentRole = assignmentRoles.find((r) => r.id === current.roleId);
    if (isProtectedOwnerRole(currentRole)) {
      // PROTECTED OWNER (Controller ruling 2026-09-27), under the governance lock. The per-role last-Owner
      // invariant first (its own code, so the reason is exact), then the membership rule, which refuses every
      // ordinary removal of a protected Owner -- the Owner's own included -- whatever authority the actor holds.
      if (current.status === "active") await refuseIfLastProtectedOwner(tx, current.roleId, assignmentId);
      refuseProtectedOwnerMembership(currentRole, "revoke");
    }
    if (current.status === "active") {
      const roles = assignmentRoles;
      // D5(b) for REMOVAL (Owner ruling R1): removing a Role that carries admin.securityPolicy.write needs that
      // capability, or -- for the designated Administrator Role only, from another Principal -- the R1 staffing
      // capability. Decided under the governance lock, against the store.
      const assignedRole = roles.find((r) => r.id === current.roleId);
      if (assignedRole) {
        staffing = await authorizeSecurityPolicyStaffing(repo, actor, assignedRole, current.principalId,
          current.scopeType ?? "global", "revoke", { fresh: true });
      }
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
      after: staffingAudit(staffing, updated),
    });
    return updated;
  });
}

// ════════════════════ WORKFLOWS ════════════════════
//
// publishWorkflowVersion moved to workflowLifecycle.ts (2026-09-26, workflow control plane): it is
// now capability-gated (workflowDefinition.publish), validated fail-closed with stable codes, and
// moves the workflow's ACTIVE version pointer in the same transaction. It is not re-exported from
// here because workflowLifecycle imports this module (PolicyValidationError).

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
  /**
   * Optional (grant only): the direct exception's condition, written IN THE SAME TRANSACTION as the grant so a
   * conditioned exception never exists unconditioned. Same allow-list and validation as a Role grant's condition.
   */
  readonly condition?: unknown;
  /** REFUSED when present: a direct exception has no scope model (principal_capabilities has no scope column). */
  readonly scopeType?: unknown;
  readonly scopeValue?: unknown;
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
  validateGrantCondition("ROLE", roleKey, capabilityKey, condition);
}

/**
 * NO CONFIGURATION THE RUNTIME IGNORES (DECISIONS #223): a capability protected-Administrator standing implies is held
 * UNCONDITIONED by the designated Role and by every principal with standing -- so a condition on that cell would be stored
 * and never applied. Refused, for the Role cell and for a direct exception of a principal that currently has standing.
 */
async function refuseConditionOnStanding(
  repo: PolicyRepository, tenantId: string,
  grantor: { readonly role?: { readonly key: string; readonly protected?: boolean | null }; readonly principalId?: string },
  capability: { readonly key: string; readonly objectKey: string; readonly actionKind: string },
): Promise<void> {
  if (!isImpliedForProtectedAdministrator(capability)) return;
  const standing = grantor.role
    ? isDesignatedAdministratorRole(grantor.role)
    : hasProtectedAdministratorStanding(await repo.listRoles(tenantId), await qualifyingRoleKeys(repo, tenantId, grantor.principalId as string));
  if (standing) {
    throw new AdministrationRefusal("CONDITION_NOT_SUPPORTED",
      `${capability.key} is held unconditioned by protected-Administrator standing (DECISIONS #223); a condition there would never apply`);
  }
}

/** The same validation for either grant scope: a direct exception's condition obeys exactly the Role rules. */
function validateGrantCondition(grantScope: "ROLE" | "PRINCIPAL", grantorKey: string, capabilityKey: string, condition: unknown): void {
  const allowed = CONDITIONABLE_GRANTS.find((g) => g.capabilityKey === capabilityKey);
  if (!allowed) {
    throw new AdministrationRefusal("CONDITION_NOT_SUPPORTED",
      `${capabilityKey} may not carry a condition: a gate that reads it cannot evaluate one (see listSupportedConditionKinds)`);
  }
  let catalog;
  try {
    catalog = grantConditionCatalogFromRows([{ grantScope, grantorKey, capabilityKey, condition }]);
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
  // BY ANY PATH: a conditioned grant (Role or direct) still HOLDS the key, so it counts here -- unlike a gate, which
  // must withhold it because it cannot evaluate the condition.
  const effective = new Set([
    ...(await capabilityKeysFor(repo, tenantId, roleKeys, principalId, { includeConditioned: true })), ...extraDirect]);
  const violations = ownerPrincipalViolations(roleKeys, effective);
  if (violations.length > 0) {
    throw new AdministrationRefusal("SYSTEM_INVARIANT",
      `a principal holding the owner Role may never hold ${violations.join(", ")} (Owner ruling A), by any Role or direct grant`);
  }
}

/** Principals holding this Role through an ACTIVE assignment. */
/** ACTIVE non-global assignments of this Role, across the tenant's principals. */
async function scopedHoldersOfRole(repo: PolicyRepository, tenantId: string, roleId: string): Promise<number> {
  let n = 0;
  for (const principalId of await repo.listTenantPrincipalIds(tenantId)) {
    for (const a of await repo.listAssignmentsForPrincipal(tenantId, principalId)) {
      if (a.status === "active" && a.roleId === roleId && typeof a.scopeType === "string" && a.scopeType !== "" && a.scopeType !== "global") n += 1;
    }
  }
  return n;
}

async function principalsHoldingRole(repo: PolicyRepository, tenantId: string, roleId: string): Promise<string[]> {
  const out: string[] = [];
  for (const principalId of await repo.listTenantPrincipalIds(tenantId)) {
    const assignments = await repo.listAssignmentsForPrincipal(tenantId, principalId);
    if (assignments.some((a) => a.status === "active" && a.roleId === roleId)) out.push(principalId);
  }
  return out;
}

/**
 * THE ANTI-LOCKOUT SET: the governing Administration capabilities PLUS the R1 staffing capability
 * (Controller ruling 2026-09-27). R1 governs no policy, so it stays out of ADMINISTRATION_GOVERNING_CAPABILITIES,
 * but losing its last holder strands the tenant's governed way to recover Administrator staffing -- so no
 * mutation may remove it.
 */
export const ANTI_LOCKOUT_CAPABILITIES: readonly string[] = Object.freeze([
  ...ADMINISTRATION_GOVERNING_CAPABILITIES,
  ADMINISTRATOR_STAFFING_CAPABILITY,
]);

/**
 * PROTECTED OWNER MEMBERSHIP (Controller ruling 2026-09-27): the protected Owner is not an ordinary Security Role
 * assignment. Ordinary role administration may neither appoint nor remove it. Owner succession / transfer is a
 * separate governed lifecycle operation that does not exist yet -- this refuses; it does not route anywhere.
 */
function refuseProtectedOwnerMembership(role: { readonly key: string; readonly protected?: boolean | null } | undefined, verb: "assign" | "revoke"): void {
  if (!isProtectedOwnerRole(role)) return;
  throw new AdministrationRefusal("PROTECTED_OWNER_MEMBERSHIP",
    `the protected Owner is not ${verb === "assign" ? "appointed" : "removed"} through ordinary role administration `
    + "(admin.roleAssignment.write, admin.securityPolicy.write and admin.administratorRole.assign are all insufficient); "
    + "Owner succession is a separate governed lifecycle operation");
}

/**
 * THE LAST-OWNER INVARIANT (per role), inside the transaction and under the governance lock: refuse a change
 * after which the tenant has ZERO active global assignments of the protected Owner Role. Assignments of any
 * other protected Role -- the Administrator included -- never substitute for an Owner.
 */
async function refuseIfLastProtectedOwner(tx: PolicyTransaction, ownerRoleId: string, excludeAssignmentId: string): Promise<void> {
  if ((await tx.activeGlobalAssignmentCountForRole(ownerRoleId, excludeAssignmentId)) === 0) {
    throw new AdministrationRefusal("LAST_PROTECTED_OWNER",
      "this is the tenant's last active protected Owner assignment; no ordinary role-assignment command may leave a tenant without an Owner");
  }
}

/**
 * ANTI-LOCKOUT (PLATFORM_SAFETY), inside the transaction and under the governance lock: refuse a
 * change after which NO principal the gate would admit holds a capability of ANTI_LOCKOUT_CAPABILITIES.
 */
async function refuseIfLastAdministrationPath(
  tx: PolicyTransaction,
  exclude: { readonly assignmentId?: string; readonly roleId?: string; readonly principalId?: string },
  onlyCapability?: string,
): Promise<void> {
  for (const key of ANTI_LOCKOUT_CAPABILITIES) {
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
  // NOBODY WIDENS A ROLE THEY HOLD (self-grant, Pass 8 D5a) -- globally OR through a scoped assignment (Pass 9 S2:
  // heldRoleKeys is global-only, so a scoped holder would otherwise widen its own Role).
  if ((Array.isArray(actor.heldRoleKeys) ? actor.heldRoleKeys : []).includes(role.key)
      || (await repo.listAssignmentsForPrincipal(actor.tenantId, actor.uid)).some((a) => a.status === "active" && a.roleId === role.id)) {
    throw new AdministrationRefusal("SELF_ADMINISTRATION", `a principal may not grant a capability to a Role it holds (${role.key})`);
  }
  // OWNER GOVERNANCE AT THE PRINCIPAL: no holder of this Role who also holds owner may gain an excluded key.
  if (OWNER_EXCLUDED_CAPABILITIES.includes(capability.key)) {
    for (const principalId of await principalsHoldingRole(repo, actor.tenantId, role.id)) {
      await refuseOwnerPrincipalViolation(repo, actor.tenantId, principalId, [], [capability.key]);
    }
  }
  const condition = input.condition === undefined || input.condition === null ? null : input.condition;
  if (condition !== null) {
    validateRoleCondition(role.key, capability.key, condition);
    await refuseConditionOnStanding(repo, actor.tenantId, { role }, capability);
  }
  const requiresCondition = input.requiresCondition === true;

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    await tx.lockGrantCell(role.key, capability.key);
    // NO ADMINISTRATION AUTHORITY FOR A SCOPED ROLE (Pass 9 S2), under the governance lock: every Administration
    // gate is tenant-wide, so granting one of its keys to a Role that has an ACTIVE scoped holder would silently
    // turn "Role @ Company X" into tenant-wide Administration. Refused; assignRole refuses the reverse order.
    if (isAdministrationCapability(capability.key)) {
      const scopedHolders = await scopedHoldersOfRole(repo, actor.tenantId, role.id);
      if (scopedHolders > 0) {
        throw new AdministrationRefusal("SCOPE_AMBIGUOUS_ADMINISTRATION",
          `${role.key} has ${scopedHolders} scoped assignment(s); ${capability.key} is Administration authority, decided tenant-wide, and may not be granted to a scoped Role`);
      }
    }
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
    if (ANTI_LOCKOUT_CAPABILITIES.includes(capability.key)) {
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
  /** A Role grant cell. Exactly one of `roleKey` / `principalId` is named. */
  readonly roleKey?: string;
  /** A DIRECT-EXCEPTION cell (lane DX): the Principal holding the direct grant. */
  readonly principalId?: string;
  readonly condition?: unknown;
  readonly reason?: string | null;
}

/** Which cell a condition command names. Exactly one grantee, or the command is refused. */
function conditionCell(input: GrantConditionCommandInput): { readonly scope: "ROLE"; readonly roleKey: string } | { readonly scope: "PRINCIPAL"; readonly principalId: string } {
  const hasRole = typeof input.roleKey === "string" && input.roleKey.trim() !== "";
  const hasPrincipal = typeof input.principalId === "string" && input.principalId.trim() !== "";
  if (hasRole === hasPrincipal) {
    throw new PolicyValidationError("name exactly one grantee: roleKey (a Role grant) or principalId (a direct exception)");
  }
  return hasRole ? { scope: "ROLE", roleKey: nonEmpty(input.roleKey, "roleKey") }
    : { scope: "PRINCIPAL", principalId: nonEmpty(input.principalId, "principalId") };
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
  const cellRef = conditionCell(input);
  if (cellRef.scope === "PRINCIPAL") return setDirectExceptionCondition(repo, actor, input, cellRef.principalId, reason);
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  const role = await repo.getRoleByKey(actor.tenantId, nonEmpty(input.roleKey, "roleKey"));
  if (!role) throw new PolicyValidationError("role not found");
  if (input.condition === undefined || input.condition === null) {
    throw new AdministrationRefusal("CONDITION_INVALID", "a condition is required; retire a condition with retireGrantCondition");
  }
  validateRoleCondition(role.key, capability.key, input.condition);
  await refuseConditionOnStanding(repo, actor.tenantId, { role }, capability);

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
  const cellRef = conditionCell(input);
  if (cellRef.scope === "PRINCIPAL") return retireDirectExceptionCondition(repo, actor, input, cellRef.principalId, reason);
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
//
// COMPLETE SUPPORT (lane DX). A direct grant is a capability SOURCE of the one runtime resolution
// (capabilityAuthority.resolveOperationalCapabilities), with a Role grant's semantics on every gate: unconditioned it
// is flat; with an ACTIVE PRINCIPAL-cell condition it is conditionallyHeld, decided per record, never flat; it has NO
// scope (a scope is refused by name); an EXPIRED one confers nothing and is not read. The commands below mirror the
// Role commands: one transaction under the tenant governance lock AND the (PRINCIPAL, principal, capability) cell
// lock the condition-retire trigger also takes; every state-dependent check inside it; exactly ONE audit event per
// effective change and none for a no-op; a reason always.
//
// Pass 8/9 invariants, at the Principal:
//   no self-grant                    a principal may not grant, condition or retire a condition on ITSELF
//   Owner ruling A                   a holder of the owner Role may not reach an excluded key directly, conditioned
//                                    or not (checked inside the lock)
//   admin.* not conditionable        the CONDITIONABLE_GRANTS allow-list (no admin.* key is on it)
//   anti-lockout                     a revoke is refused if it would leave no UNEXPIRED, UNCONDITIONED, global holder
//   never widen on retire            retiring a direct exception's condition is refused while the grant is held
//   no scope                         scopeType / scopeValue refused (DIRECT_GRANT_SCOPE_UNSUPPORTED)

const refuseDirectScope = (input: { readonly scopeType?: unknown; readonly scopeValue?: unknown }): void => {
  const named = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && (v.trim() === "" || v.trim() === "global"));
  if (named(input.scopeType) || named(input.scopeValue)) {
    throw new AdministrationRefusal("DIRECT_GRANT_SCOPE_UNSUPPORTED",
      "a direct exception carries no scope: principal_capabilities has no scope model, so a scoped direct grant would be read tenant-wide. Grant a scoped Security Role assignment instead");
  }
};

/** The direct-exception grantee must be an ACTIVE member of this tenant and never the actor itself. */
async function requireDirectGrantee(repo: PolicyRepository, actor: AdminActor, principalId: string, what: string): Promise<void> {
  // A PRINCIPAL, NEVER AN EMPLOYEE, and a MEMBER of this tenant (tenant consistency).
  const membership = await repo.getMembership(actor.tenantId, principalId);
  if (!membership || membership.status !== "active") {
    throw new PolicyValidationError("that principal is not an active member of this tenant");
  }
  if (principalId === actor.uid) {
    throw new AdministrationRefusal("SELF_ADMINISTRATION", `a principal may not ${what} itself`);
  }
}

const directAuditState = (capability: { key: string; objectKey: string; actionKey: string }, principalId: string,
  grant: PrincipalCapabilityRecord | null, held: boolean, condition: unknown) => ({
  objectKey: capability.objectKey, actionKey: capability.actionKey, capabilityKey: capability.key,
  granteeType: "PRINCIPAL", granteeKey: principalId, source: "DIRECT_EXCEPTION", held,
  ...(grant ? { grant, exceptionReason: grant.exceptionReason ?? null, expiresAt: grant.expiresAt ?? null } : {}),
  condition: condition ?? null,
});

export async function grantObjectActionToPrincipal(
  repo: PolicyRepository, actor: AdminActor, input: ObjectActionPrincipalGrantInput,
): Promise<PrincipalCapabilityRecord> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const reason = requireReason(input.reason, "a direct Principal grant (a governed exception)");
  refuseDirectScope(input);
  let expiresAt: string | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    const at = Date.parse(String(input.expiresAt));
    if (!Number.isFinite(at)) throw new PolicyValidationError("expiresAt must be an ISO timestamp");
    if (at <= Date.now()) throw new PolicyValidationError("expiresAt must be in the future");
    expiresAt = new Date(at).toISOString();
  }
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  const principalId = nonEmpty(input.principalId, "principalId");
  // A RESERVED capability (Owner G7) is held only through its reserved Roles -- never as a direct exception.
  const reserved = RESERVED_CAPABILITY_HOLDERS.get(capability.key);
  if (reserved) throw new AdministrationRefusal("SYSTEM_INVARIANT", `${capability.key} is never a direct grant (${reserved.ruling})`);
  await requireDirectGrantee(repo, actor, principalId, "grant a capability to");
  const condition = input.condition === undefined || input.condition === null ? null : input.condition;
  if (condition !== null) {
    validateGrantCondition("PRINCIPAL", principalId, capability.key, condition);
    await refuseConditionOnStanding(repo, actor.tenantId, { principalId }, capability);
  }

  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    await tx.lockGrantCell(principalId, capability.key, "PRINCIPAL");
    // OWNER GOVERNANCE AT THE PRINCIPAL, under the governance lock (no assignment can slip in between).
    await refuseOwnerPrincipalViolation(repo, actor.tenantId, principalId, [], [capability.key]);
    const cell = await tx.readPrincipalGrantCell(principalId, capability.key);
    const conditionChanges = condition !== null && !sameJson(cell.condition?.condition, condition);
    // Unexpired and no condition change -> an idempotent no-op, decided under the locks. Expired -> REFRESHED (new
    // reason and expiry), audited as such; never "granted" while it stays expired (Pass 8 D9).
    if (cell.grant && !cell.expired && !conditionChanges) return cell.grant;
    // Condition FIRST, then the grant: the exception is never visible unconditioned.
    const storedCondition = conditionChanges
      ? await tx.upsertGrantCondition({ grantScope: "PRINCIPAL", grantorKey: principalId, capabilityKey: capability.key, condition })
      : cell.condition;
    const grant = cell.grant && !cell.expired ? cell.grant : await tx.grantPrincipalCapability({
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
      before: cell.grant ? directAuditState(capability, principalId, cell.grant, !cell.expired, cell.condition?.condition) : null,
      after: { ...directAuditState(capability, principalId, grant, true, storedCondition?.condition), exceptionReason: grant.exceptionReason ?? reason,
        expiresAt: grant.expiresAt ?? null },
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
    await tx.lockGrantCell(principalId, capability.key, "PRINCIPAL");
    const cell = await tx.readPrincipalGrantCell(principalId, capability.key);
    if (!cell.grant) return null; // nothing was granted; nothing happened; nothing to audit
    if (ANTI_LOCKOUT_CAPABILITIES.includes(capability.key)) {
      await refuseIfLastAdministrationPath(tx, { principalId }, capability.key);
    }
    const removed = await tx.revokePrincipalCapability(principalId, capability.id);
    if (!removed) return null;
    // The condition row stays ACTIVE and inert (as for a Role revoke), so a re-grant is conditioned again.
    await tx.appendAudit({
      ...auditBase(actor, "revokeObjectActionFromPrincipal", "principalCapability", removed.id, reason),
      before: directAuditState(capability, principalId, removed, !cell.expired, cell.condition?.condition),
      after: { ...directAuditState(capability, principalId, null, false, cell.condition?.condition) },
    });
    return removed;
  });
}

/** Establish or replace the condition on one DIRECT-EXCEPTION cell (setGrantCondition with `principalId`). */
async function setDirectExceptionCondition(
  repo: PolicyRepository, actor: AdminActor, input: GrantConditionCommandInput, principalId: string, reason: string,
): Promise<GrantConditionRecord> {
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  await requireDirectGrantee(repo, actor, principalId, "change the condition on a direct exception held by");
  if (input.condition === undefined || input.condition === null) {
    throw new AdministrationRefusal("CONDITION_INVALID", "a condition is required; retire a condition with retireGrantCondition");
  }
  validateGrantCondition("PRINCIPAL", principalId, capability.key, input.condition);
  await refuseConditionOnStanding(repo, actor.tenantId, { principalId }, capability);
  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    await tx.lockGrantCell(principalId, capability.key, "PRINCIPAL");
    const existing = (await tx.readPrincipalGrantCell(principalId, capability.key)).condition;
    if (existing && sameJson(existing.condition, input.condition)) return existing;
    const stored = await tx.upsertGrantCondition({
      grantScope: "PRINCIPAL", grantorKey: principalId, capabilityKey: capability.key, condition: input.condition,
    });
    await tx.appendAudit({
      ...auditBase(actor, "setGrantCondition", "grantCondition", stored.id, reason),
      before: existing ? { grantScope: "PRINCIPAL", granteeType: "PRINCIPAL", granteeKey: principalId, capabilityKey: capability.key,
        objectKey: capability.objectKey, actionKey: capability.actionKey, condition: existing.condition, status: "ACTIVE" } : null,
      after: { grantScope: "PRINCIPAL", granteeType: "PRINCIPAL", granteeKey: principalId, capabilityKey: capability.key,
        objectKey: capability.objectKey, actionKey: capability.actionKey, condition: stored.condition, status: stored.status },
    });
    return stored;
  });
}

/** Retire the condition on one DIRECT-EXCEPTION cell. REFUSED while the direct grant is held (it would widen). */
async function retireDirectExceptionCondition(
  repo: PolicyRepository, actor: AdminActor, input: GrantConditionCommandInput, principalId: string, reason: string,
): Promise<GrantConditionRecord | null> {
  const capability = await resolveGrantTarget(repo, actor.tenantId, input.objectKey, input.actionKey);
  await requireDirectGrantee(repo, actor, principalId, "retire the condition on a direct exception held by");
  return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
    await tx.beginAdministrationCommand();
    await tx.lockGrantCell(principalId, capability.key, "PRINCIPAL");
    const cell = await tx.readPrincipalGrantCell(principalId, capability.key);
    if (!cell.condition) return null;
    // Held means the ROW exists (an expired row too: a refresh would re-activate it unconditioned) -- the same rule
    // the capability_grant_conditions_never_widen trigger enforces.
    if (cell.grant) {
      throw new AdministrationRefusal("CONDITION_RETIREMENT_WOULD_WIDEN",
        `${principalId} still holds the direct exception ${capability.key}; retiring its condition would widen it to every record -- revoke the direct grant first`);
    }
    const retired = await tx.retireGrantCondition("PRINCIPAL", principalId, capability.key);
    if (!retired) return null;
    await tx.appendAudit({
      ...auditBase(actor, "retireGrantCondition", "grantCondition", retired.id, reason),
      before: { grantScope: "PRINCIPAL", granteeType: "PRINCIPAL", granteeKey: principalId, capabilityKey: capability.key,
        objectKey: capability.objectKey, actionKey: capability.actionKey, condition: cell.condition.condition, status: "ACTIVE" },
      after: { grantScope: "PRINCIPAL", granteeType: "PRINCIPAL", granteeKey: principalId, capabilityKey: capability.key,
        objectKey: capability.objectKey, actionKey: capability.actionKey, condition: retired.condition, status: retired.status },
    });
    return retired;
  });
}

// ════════════════════ object-wide authority (Administration control plane, DECISIONS #210) ════════════════════

export type ObjectWideOutcome = "GRANTED" | "ALREADY_HELD" | "REVOKED" | "NOT_HELD" | "REFUSED";
export interface ObjectWideResult {
  readonly objectKey: string;
  readonly roleKey: string;
  readonly mode: "GRANT" | "REVOKE";
  readonly actions: readonly { readonly actionKey: string; readonly actionKind: string; readonly capabilityKey: string;
    readonly outcome: ObjectWideOutcome; readonly refusal: string | null }[];
}

/**
 * WHOLE-OBJECT AUTHORITY, expanded deterministically into the governed capability model -- never a wildcard.
 *
 * "Grant Work Order to Service Manager" is exactly the set of the Object's registered actions (optionally only some action
 * kinds), each granted through `grantObjectActionToRole` -- the same command a single-action grant uses, with its SAME
 * checks (system invariants, self-administration, Owner exclusions, scoped-role Administration), its own transaction, its own
 * audit event and its own ADMIN_GRANTED decision. Nothing new is stored: the runtime resolver reads the resulting per-capability
 * rows as it always has, so there is no object-level grant for it to expand and none that could drift. A refused action is
 * reported with its refusal and the others proceed; the result says exactly what changed.
 */
export async function applyObjectWideRoleAuthority(
  repo: PolicyRepository, actor: AdminActor,
  input: { readonly objectKey: string; readonly roleKey: string; readonly mode: "GRANT" | "REVOKE";
    readonly actionKinds?: readonly string[] | null; readonly reason?: string | null },
): Promise<ObjectWideResult> {
  await requireSecurityAdministrationCapability(repo, actor, "editSecurityPolicy");
  const reason = requireReason(input.reason, input.mode === "GRANT" ? "an object-wide grant" : "an object-wide revoke");
  const objectKey = nonEmpty(input.objectKey, "objectKey");
  const roleKey = nonEmpty(input.roleKey, "roleKey");
  const role = await repo.getRoleByKey(actor.tenantId, roleKey);
  if (!role) throw new PolicyValidationError("role not found");
  const kinds = input.actionKinds && input.actionKinds.length > 0 ? new Set(input.actionKinds) : null;
  const actions = actionsForObject(await repo.listCapabilities(), objectKey).filter((c) => !kinds || kinds.has(c.actionKind));
  if (actions.length === 0) throw new PolicyValidationError(`${objectKey} has no registered action${kinds ? " of those kinds" : ""}`);
  const heldIds = new Set((await repo.listRoleCapabilities(actor.tenantId, [role.id])).map((g) => g.capabilityId));
  const results: ObjectWideResult["actions"][number][] = [];
  for (const c of actions) {
    const base = { actionKey: c.actionKey, actionKind: c.actionKind, capabilityKey: c.key };
    const held = heldIds.has(c.id);
    try {
      if (input.mode === "GRANT") {
        if (held) { results.push({ ...base, outcome: "ALREADY_HELD", refusal: null }); continue; }
        await grantObjectActionToRole(repo, actor, { objectKey, actionKey: c.actionKey, roleKey, reason });
        results.push({ ...base, outcome: "GRANTED", refusal: null });
      } else {
        if (!held) { results.push({ ...base, outcome: "NOT_HELD", refusal: null }); continue; }
        const removed = await revokeObjectActionFromRole(repo, actor, { objectKey, actionKey: c.actionKey, roleKey, reason });
        results.push({ ...base, outcome: removed ? "REVOKED" : "NOT_HELD", refusal: null });
      }
    } catch (err) {
      const e = err as Error & { code?: string };
      // Authorization failures are the caller's, not the action's: stop rather than report N identical refusals.
      if (err instanceof AdministrationDeniedError) throw err;
      results.push({ ...base, outcome: "REFUSED", refusal: `${e.code ?? e.name}: ${e.message}` });
    }
  }
  return Object.freeze({ objectKey, roleKey, mode: input.mode, actions: Object.freeze(results) });
}
