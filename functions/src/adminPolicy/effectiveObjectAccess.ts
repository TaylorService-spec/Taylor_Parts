// The Object/Field CRED resolver — "what data may this principal access?"
//
// ════════════════════ THE FOUR RULES ════════════════════
//
//   1. MULTI-ROLE UNION IS ADDITIVE. A principal may hold several active Roles; effective access is
//      the union of the qualifying ones. There is no primary Role, no replacement, no mutual
//      exclusion. Owner ruling, kept unchanged.
//
//   2. A FIELD INHERITS ITS OBJECT unless the Role states otherwise. Overrides are stored; the
//      hundreds of agreeing values are computed. Storing the agreement is what drifts -- change the
//      Object's Read and a copied field value silently stops agreeing.
//
//   3. AN EXPLICIT FIELD OVERRIDE WINS over the inherited value, in both directions. A DENY on
//      Credit Limit narrows a Role that may read Customers; a GRANT is only meaningful inside an
//      object the Role may already reach, which is rule 4.
//
//   4. THE DOORWAY INVARIANT. A field grant NEVER opens an object the Role cannot read:
//
//          Customer.Read       = false
//          Customer.Name.Read  = true     ->  the Role still reads NO Customer records
//
//      Field permissions narrow within an already-granted object; they never widen into one. If a
//      governed minimal projection is ever wanted, it is an explicit separate mechanism -- never an
//      accident of inheritance. This is an engine invariant: no Admin configuration reaches it.
//
// ════════════════════ FAIL CLOSED ════════════════════
//
// Unknown object, unknown field, unknown Role, malformed record, disabled assignment, stale access
// version: every one of them DENIES. There is no path through this file where an unreadable input
// produces an allow, and the proofs assert that rather than assuming it.
//
// ════════════════════ WHAT THIS DOES NOT DECIDE ════════════════════
//
// Workflow authority. "What business action may I perform" is a different question, answered by
// workflowEngine.ts, and neither answer implies the other: holding `PurchaseOrder.Read` does not
// permit `Void Purchase Order`, and being allowed to `Start Purchasing` does not expose every
// Purchase Order field.
import { CRED_VERBS, EMPTY_CRED } from "./types";
import type {
  CredOverride,
  CredSet,
  CredVerb,
  ObjectFieldRecord,
  ObjectRecord,
  PolicyRoleAssignmentRecord,
  RoleFieldPermissionOverrideRecord,
  RoleObjectPermissionRecord,
  TenantId,
} from "./types";
import type { PolicyReader } from "./policyRepository";

/** Why a decision came out the way it did. Reported so a denial can be explained without guessing. */
export type AccessBasis =
  | "noQualifyingAssignment"
  | "unknownObject"
  | "unknownField"
  | "staleAccessVersion"
  | "objectGrant"
  | "objectDeny"
  | "fieldInherited"
  | "fieldOverride"
  | "doorwayClosed";

export interface ObjectAccessDecision {
  readonly cred: CredSet;
  readonly basis: AccessBasis;
}

export interface FieldAccessDecision {
  readonly cred: CredSet;
  readonly basis: AccessBasis;
}

/** Everything the resolver needs, loaded once. Assembled by `loadPrincipalPolicy`. */
export interface PrincipalPolicy {
  readonly tenantId: TenantId;
  readonly principalId: string;
  /** Ids of the assignments that QUALIFIED -- active, and not stale. */
  readonly qualifyingRoleIds: readonly string[];
  readonly objects: readonly ObjectRecord[];
  readonly objectPermissions: readonly RoleObjectPermissionRecord[];
  readonly fieldOverrides: readonly RoleFieldPermissionOverrideRecord[];
  /** True when an assignment was excluded because the principal's access version moved past it. */
  readonly hadStaleAssignment: boolean;
}

const ALL_DENY: CredSet = EMPTY_CRED;

/** Union of complete CRED sets. Additive: any Role granting a verb grants it. */
function unionCred(sets: readonly CredSet[]): CredSet {
  const out: Record<CredVerb, boolean> = { C: false, R: false, E: false, D: false };
  for (const set of sets) for (const v of CRED_VERBS) if (set[v] === true) out[v] = true;
  return Object.freeze(out);
}

/**
 * Is this a well-formed CRED set?
 *
 * A malformed stored value is NOT coerced into something usable. A row whose `cred` is null, a
 * string, or missing a verb is a row nobody can act on safely, and treating a missing verb as
 * `false` would quietly turn a storage fault into a policy statement.
 */
function isCredSet(value: unknown): value is CredSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return CRED_VERBS.every((verb) => typeof v[verb] === "boolean");
}

/** Is this a well-formed partial override? An unknown verb or non-boolean value invalidates it. */
function isCredOverride(value: unknown): value is CredOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(([k, v]) => (CRED_VERBS as readonly string[]).includes(k) && typeof v === "boolean");
}

/**
 * Load the policy that applies to one principal, once, tenant-scoped.
 *
 * ASSIGNMENT QUALIFICATION happens here and nowhere else, so every decision below is made over the
 * same set of Roles:
 *
 *   status must be "active"    -- a disabled assignment confers nothing
 *   accessVersionAtGrant <= the principal's current accessVersion
 *
 * THE DIRECTION OF THAT COMPARISON IS THE ESTABLISHED ONE, not a new rule. It is
 * `resolveEffectivePermission.ts`'s own recorded interpretation of the Specification: accessVersion
 * increases monotonically per principal on every access change, so a well-formed grant's snapshot
 * can never legitimately EXCEED the current value. An assignment from the future is impossible
 * under a correctly-operating writer and is excluded as malformed.
 *
 * A grant from the PAST is ordinary and qualifies. Excluding those would mean every new grant
 * silently invalidated every earlier one -- which would make multi-role union unreachable, since
 * holding two Roles requires two grants at two different versions.
 *
 * A principal whose access version cannot be read is treated as version 0. That excludes only
 * from-the-future grants, which is the correct fail-closed direction: inventing a newer version on
 * a read fault would disable everybody at once.
 */
export async function loadPrincipalPolicy(
  reader: PolicyReader,
  tenantId: TenantId,
  principalId: string,
): Promise<PrincipalPolicy> {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("a tenant is required to resolve access");
  }
  if (typeof principalId !== "string" || principalId.length === 0) {
    return emptyPolicy(tenantId, String(principalId));
  }

  const [assignments, versionRow, objects] = await Promise.all([
    reader.listAssignmentsForPrincipal(tenantId, principalId),
    reader.getAccessVersion(tenantId, principalId),
    reader.listObjects(tenantId),
  ]);

  const currentVersion = typeof versionRow?.accessVersion === "number" ? versionRow.accessVersion : 0;

  let hadStaleAssignment = false;
  const qualifying: PolicyRoleAssignmentRecord[] = [];
  for (const a of assignments) {
    if (!a || typeof a.roleId !== "string" || a.roleId.length === 0) continue;
    if (a.status !== "active") continue;
    if (typeof a.accessVersionAtGrant !== "number") continue;
    if (a.accessVersionAtGrant > currentVersion) {
      hadStaleAssignment = true;
      continue;
    }
    qualifying.push(a);
  }

  const roleIds = [...new Set(qualifying.map((a) => a.roleId))];
  const [objectPermissions, fieldOverrides] = await Promise.all([
    roleIds.length ? reader.listObjectPermissions(tenantId, roleIds) : Promise.resolve([]),
    roleIds.length ? reader.listFieldOverrides(tenantId, roleIds) : Promise.resolve([]),
  ]);

  return {
    tenantId,
    principalId,
    qualifyingRoleIds: roleIds,
    objects,
    objectPermissions,
    fieldOverrides,
    hadStaleAssignment,
  };
}

function emptyPolicy(tenantId: TenantId, principalId: string): PrincipalPolicy {
  return {
    tenantId,
    principalId,
    qualifyingRoleIds: [],
    objects: [],
    objectPermissions: [],
    fieldOverrides: [],
    hadStaleAssignment: false,
  };
}

/**
 * The principal's CRED over one Object, by object KEY.
 *
 * The key rather than the id, because every caller above this layer knows a business object by its
 * name and asking them to resolve an opaque id first would put policy identifiers into application
 * code -- exactly the coupling the DAL boundary exists to prevent.
 */
export function resolveObjectAccess(policy: PrincipalPolicy, objectKey: string): ObjectAccessDecision {
  const object = policy.objects.find((o) => o.key === objectKey);
  if (!object) return { cred: ALL_DENY, basis: "unknownObject" };
  if (policy.qualifyingRoleIds.length === 0) {
    return { cred: ALL_DENY, basis: policy.hadStaleAssignment ? "staleAccessVersion" : "noQualifyingAssignment" };
  }

  const sets = policy.objectPermissions
    .filter((p) => p.objectId === object.id && policy.qualifyingRoleIds.includes(p.roleId))
    // A malformed row is DROPPED, not repaired. It contributes nothing to the union, so a corrupt
    // row can only ever narrow the result -- never widen it.
    .filter((p) => isCredSet(p.cred))
    .map((p) => p.cred);

  if (sets.length === 0) return { cred: ALL_DENY, basis: "objectDeny" };

  const cred = unionCred(sets);
  // An object that does not support deletion cannot be granted D, whatever a row says. The store
  // refuses to write it; this refuses to honour one that got there another way.
  const guarded = object.supportsDelete ? cred : Object.freeze({ ...cred, D: false });
  return { cred: guarded, basis: CRED_VERBS.some((v) => guarded[v]) ? "objectGrant" : "objectDeny" };
}

/**
 * The principal's CRED over one Field.
 *
 * Inheritance, override, then the doorway. The order matters and the doorway is LAST, because it is
 * the rule that must survive every combination of the other two.
 */
export function resolveFieldAccess(
  policy: PrincipalPolicy,
  objectKey: string,
  field: ObjectFieldRecord | null | undefined,
): FieldAccessDecision {
  const objectDecision = resolveObjectAccess(policy, objectKey);
  if (!field || typeof field.id !== "string") return { cred: ALL_DENY, basis: "unknownField" };

  const object = policy.objects.find((o) => o.key === objectKey);
  // A field whose objectId does not match the object it was asked about is a malformed pairing, and
  // answering it from the object's permissions would attribute one object's policy to another's field.
  if (!object || field.objectId !== object.id) return { cred: ALL_DENY, basis: "unknownField" };

  const overrides = policy.fieldOverrides
    .filter((o) => o.fieldId === field.id && policy.qualifyingRoleIds.includes(o.roleId))
    .filter((o) => isCredOverride(o.override));

  // PER VERB, PER ROLE. Each qualifying Role contributes one complete opinion about this field: its
  // override where it has one, the inherited Object value where it does not. Those opinions are then
  // unioned, which is what keeps multi-role additive at the FIELD level too -- a Role that denies a
  // field cannot veto another Role that grants it, exactly as it cannot veto an Object grant.
  const perRole: CredSet[] = policy.qualifyingRoleIds.map((roleId) => {
    const inherited = roleObjectCred(policy, object.id, roleId);
    const override = overrides.find((o) => o.roleId === roleId)?.override;
    if (!override) return inherited;
    const merged: Record<CredVerb, boolean> = { ...inherited };
    for (const v of CRED_VERBS) if (typeof override[v] === "boolean") merged[v] = override[v] as boolean;
    return Object.freeze(merged);
  });

  const unioned = perRole.length ? unionCred(perRole) : ALL_DENY;

  // ════════ THE DOORWAY ════════
  //
  // A verb the principal does not hold on the OBJECT is not held on any of its fields, whatever an
  // override says. This is the single line that stops `Customer.Name.Read = true` from exposing
  // Customer records to a Role with `Customer.Read = false`.
  const gated: Record<CredVerb, boolean> = { C: false, R: false, E: false, D: false };
  let doorwayClosedSomething = false;
  for (const v of CRED_VERBS) {
    if (objectDecision.cred[v] !== true) {
      if (unioned[v] === true) doorwayClosedSomething = true;
      continue;
    }
    gated[v] = unioned[v] === true;
  }

  const cred = Object.freeze(gated);
  if (doorwayClosedSomething && !CRED_VERBS.some((v) => cred[v])) {
    return { cred, basis: "doorwayClosed" };
  }
  const hadOverride = overrides.length > 0;
  return { cred, basis: hadOverride ? "fieldOverride" : "fieldInherited" };
}

/** One Role's complete CRED over one object id, or all-deny when it states none. */
function roleObjectCred(policy: PrincipalPolicy, objectId: string, roleId: string): CredSet {
  const row = policy.objectPermissions.find((p) => p.objectId === objectId && p.roleId === roleId);
  return row && isCredSet(row.cred) ? row.cred : ALL_DENY;
}

/**
 * THE SERVER-SIDE READ PROJECTION.
 *
 * A denied field is OMITTED FROM THE PAYLOAD, not returned and hidden. Returning it and styling it
 * away makes field security a CSS property: the value is on the wire, in the browser's memory, and
 * in every developer tool. This function is how a read result stops carrying what the principal may
 * not see, and it runs on the server because that is the only side of the wire that can be trusted
 * to have run it.
 *
 * Fields the principal MAY read but that are absent from the record stay absent -- this projects,
 * it does not fabricate.
 */
export function projectReadableFields(
  policy: PrincipalPolicy,
  objectKey: string,
  fields: readonly ObjectFieldRecord[],
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!record || typeof record !== "object") return out;
  for (const field of fields) {
    if (resolveFieldAccess(policy, objectKey, field).cred.R !== true) continue;
    if (!Object.prototype.hasOwnProperty.call(record, field.key)) continue;
    out[field.key] = record[field.key];
  }
  return out;
}

/** Convenience: may this principal perform this verb on this object at all? */
export const canObject = (policy: PrincipalPolicy, objectKey: string, verb: CredVerb): boolean =>
  resolveObjectAccess(policy, objectKey).cred[verb] === true;
