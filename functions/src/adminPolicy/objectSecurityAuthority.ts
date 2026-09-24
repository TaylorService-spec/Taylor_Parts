// THE ONE SECURITY AUTHORITY, projected three ways.
//
// ════════════════════ WHAT THIS REPLACES ════════════════════
//
// Administration used to answer "who may do this" from a static frontend map
// (field-ops-app-vite/src/access/objectPermissionMap.js) while Render answered it from
// eos_policy.role_capabilities. Those two disagreed about 47 of ~70 capability keys. There is no
// way to reconcile two catalogs; there is only one authority, read three ways:
//
//     OBJECT view      Work Order  -> Dispatch -> which Roles, which Principals
//     ROLE view        Dispatcher  -> Work Order -> Create, Transition
//     PRINCIPAL view   this person -> roles + direct grants -> effective capabilities
//
// Every one of those is a GROUP BY over the same two grant tables, joined to `capabilities` for the
// Object and action each key governs. Nothing here consults permissionCatalog.ts, objectPermission-
// Map.js, Firestore, or a Role KEY used as authority.
//
// ════════════════════ WHAT THIS DELIBERATELY DOES NOT DECIDE ════════════════════
//
// Field-level CRED         effectiveObjectAccess.ts -- narrows WITHIN an Object, never widens into one
// Work Eligibility         eos_workforce -- what kind of work an EMPLOYEE may be given
// Operational Scope        eos_workforce -- where they may do it
// Record authority         "may they act on THIS record" (assignment, ownership, operating company)
//
// Those are subordinate constraints on a capability the principal already holds. Folding any of
// them in here would make a business fact decide a permission, or a permission decide a business
// fact. A caller that needs both asks both.
import type {
  CapabilityRecord,
  PrincipalCapabilityRecord,
  RoleCapabilityRecord,
  TenantId,
} from "./types";

export class ObjectSecurityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ObjectSecurityError";
  }
}
const refuse = (code: string, message: string): never => {
  throw new ObjectSecurityError(code, message);
};

/**
 * Resolve (objectKey, actionKey) to the ONE capability that governs it.
 *
 * This is the whole reason Administration's write contract is an Object and an action rather than a
 * raw capability key: an administrator grants "Work Order -> Dispatch", and the server decides that
 * this means `workOrder.lifecycle.dispatch`. Exposing the key as the primary contract would let a
 * caller name a capability that governs something else entirely, and would make the key -- an
 * implementation identifier -- part of the administrative interface.
 *
 * Refuses an unknown Object and an unknown action SEPARATELY, because "Work Order has no Frobnicate"
 * and "there is no such Object" are different mistakes and an administrator can act on the first.
 */
export function resolveObjectAction(
  capabilities: readonly CapabilityRecord[],
  objectKey: string,
  actionKey: string,
): CapabilityRecord {
  const key = typeof objectKey === "string" ? objectKey.trim() : "";
  const action = typeof actionKey === "string" ? actionKey.trim() : "";
  if (!key) refuse("OBJECT_KEY_REQUIRED", "an objectKey is required");
  if (!action) refuse("ACTION_KEY_REQUIRED", "an actionKey is required");

  const onObject = capabilities.filter((c) => c.objectKey === key);
  if (onObject.length === 0) {
    refuse("UNKNOWN_OBJECT", `no governed Object "${key}" declares any action`);
  }
  const match = onObject.filter((c) => c.actionKey === action);
  if (match.length === 0) {
    refuse("UNKNOWN_ACTION", `Object "${key}" has no governed action "${action}"`);
  }
  // The database holds a UNIQUE index on (object_key, action_key). If two rows ever arrive here the
  // index is gone, and picking one would silently grant an action nobody asked for.
  if (match.length > 1) {
    refuse("AMBIGUOUS_ACTION", `Object "${key}" declares "${action}" more than once`);
  }
  return match[0];
}

/** Every action one Object governs, in a stable order: CRUD first, then business, then admin. */
const KIND_ORDER: Record<string, number> = {
  CREATE: 0, READ: 1, EDIT: 2, DELETE: 3, BUSINESS_ACTION: 4, ADMIN_ACTION: 5,
};
export function actionsForObject(
  capabilities: readonly CapabilityRecord[],
  objectKey: string,
): readonly CapabilityRecord[] {
  return [...capabilities.filter((c) => c.objectKey === objectKey)].sort(
    (a, b) => (KIND_ORDER[a.actionKind] ?? 9) - (KIND_ORDER[b.actionKind] ?? 9)
      || a.actionKey.localeCompare(b.actionKey),
  );
}

// ════════════════════ EFFECTIVE ACCESS ════════════════════

export interface EffectiveAccessInput {
  readonly tenantId: TenantId;
  readonly principalId: string;
  /** Capability ids reaching this principal through their Security Role assignments. */
  readonly roleDerivedCapabilityIds: readonly string[];
  /** Capability ids granted to this principal directly. */
  readonly directCapabilityIds: readonly string[];
  readonly capabilities: readonly CapabilityRecord[];
}

export interface EffectiveCapability {
  readonly capabilityKey: string;
  readonly objectKey: string;
  readonly actionKey: string;
  readonly actionKind: string;
  readonly displayLabel: string;
  /** How it was reached. A capability held BOTH ways reports "ROLE_AND_DIRECT", never twice. */
  readonly source: "ROLE" | "DIRECT" | "ROLE_AND_DIRECT";
}

/**
 * The union of role-derived and direct capabilities, de-duplicated, with provenance kept.
 *
 * A PLAIN UNION, because this platform has no object-level deny to be consistent with: the CRED
 * resolver's ALL_DENY is a fail-closed default, not a stored denial, and object CRED already unions
 * additively across a principal's Roles. Inventing precedence would give direct grants semantics
 * nothing else in the schema has.
 *
 * Provenance is kept rather than collapsed because revoking a Role and revoking a direct grant are
 * different acts, and an administrator looking at "why does this person have Dispatch" needs to be
 * told which one to remove -- or that removing either still leaves the other.
 */
export function effectiveCapabilities(input: EffectiveAccessInput): readonly EffectiveCapability[] {
  const byId = new Map(input.capabilities.map((c) => [c.id, c]));
  const fromRole = new Set(input.roleDerivedCapabilityIds);
  const direct = new Set(input.directCapabilityIds);
  const out: EffectiveCapability[] = [];
  for (const id of new Set([...fromRole, ...direct])) {
    const cap = byId.get(id);
    // A grant naming a capability the catalog does not define is dropped, never guessed at. The
    // foreign key makes this unreachable through the database; it is reachable through a stale
    // in-memory catalog, and inventing a key here would be worse than showing nothing.
    if (!cap) continue;
    out.push(Object.freeze({
      capabilityKey: cap.key,
      objectKey: cap.objectKey,
      actionKey: cap.actionKey,
      actionKind: cap.actionKind,
      displayLabel: cap.displayLabel,
      source: fromRole.has(id) && direct.has(id) ? "ROLE_AND_DIRECT" : direct.has(id) ? "DIRECT" : "ROLE",
    }));
  }
  out.sort((a, b) => a.objectKey.localeCompare(b.objectKey) || a.actionKey.localeCompare(b.actionKey));
  return Object.freeze(out);
}

/** Principal -> Object -> the actions they may perform. The Administration Users page's answer. */
export function objectActionsForPrincipal(
  effective: readonly EffectiveCapability[],
): Readonly<Record<string, readonly string[]>> {
  const byObject = new Map<string, string[]>();
  for (const c of effective) {
    if (!byObject.has(c.objectKey)) byObject.set(c.objectKey, []);
    byObject.get(c.objectKey)!.push(c.actionKey);
  }
  return Object.freeze(Object.fromEntries(
    [...byObject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Object.freeze(v.sort())]),
  ));
}

// ════════════════════ THE THREE PROJECTIONS ════════════════════

export interface ObjectSecurityCell {
  readonly actionKey: string;
  readonly capabilityKey: string;
  readonly actionKind: string;
  readonly displayLabel: string;
  readonly roleKeys: readonly string[];
  readonly principalIds: readonly string[];
}

/**
 * OBJECT VIEW. One Object, every action it governs, and who holds each -- Roles AND Principals.
 *
 * An action with no grantee renders as an empty row rather than being omitted: "nobody holds
 * Dispatch" and "Dispatch does not exist" are different facts, and the first is the one an
 * administrator has to be able to see in order to fix it. The three Work Order lifecycle actions
 * are exactly this case today.
 */
export function objectSecurityMatrix(
  capabilities: readonly CapabilityRecord[],
  objectKey: string,
  roleGrants: readonly { capabilityId: string; roleKey: string }[],
  principalGrants: readonly { capabilityId: string; principalId: string }[],
): readonly ObjectSecurityCell[] {
  return actionsForObject(capabilities, objectKey).map((cap) => Object.freeze({
    actionKey: cap.actionKey,
    capabilityKey: cap.key,
    actionKind: cap.actionKind,
    displayLabel: cap.displayLabel,
    roleKeys: Object.freeze(roleGrants.filter((g) => g.capabilityId === cap.id).map((g) => g.roleKey).sort()),
    principalIds: Object.freeze(principalGrants.filter((g) => g.capabilityId === cap.id).map((g) => g.principalId).sort()),
  }));
}

/** ROLE VIEW. The same rows, grouped the other way: one Role -> Objects -> actions. */
export function roleSecurityView(
  capabilities: readonly CapabilityRecord[],
  grantedCapabilityIds: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const byId = new Map(capabilities.map((c) => [c.id, c]));
  const byObject = new Map<string, string[]>();
  for (const id of new Set(grantedCapabilityIds)) {
    const cap = byId.get(id);
    if (!cap) continue;
    if (!byObject.has(cap.objectKey)) byObject.set(cap.objectKey, []);
    byObject.get(cap.objectKey)!.push(cap.actionKey);
  }
  return Object.freeze(Object.fromEntries(
    [...byObject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Object.freeze(v.sort())]),
  ));
}
