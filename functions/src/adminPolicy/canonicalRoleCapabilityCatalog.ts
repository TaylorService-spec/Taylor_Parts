// CANONICAL EOS Role -> Capability DECLARATION SOURCE.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// There are TWO kinds of "permission" in this repo and they are not interchangeable:
//
//   1. LEGACY FIREBASE PERMISSION IDS. `access/permissionCatalog.ts` registers 151 of them.
//      A Role's own `permissions: string[]` array (access/compatibilityRoles.ts,
//      access/governedBusinessRoles.ts) holds ONLY these ids, and `resolveEffectivePermission`
//      looks each one up with `findPermission()`. An id that is not in the catalog resolves to
//      `undefined` and the resolver DENIES -- so a key that is not a registered Firebase
//      permission id cannot be put in that array without breaking the legacy resolver.
//
//   2. CANONICAL EOS CAPABILITY KEYS. `eos_policy.capabilities.key`, created by the migration
//      chain (`workOrder.lifecycle.*` arrives in migration 1757894400000). These are the keys the
//      PostgreSQL authorization engine resolves, through `eos_policy.role_capabilities`. They are
//      NOT registered in permissionCatalog.ts and must never be.
//
// The Role catalog could therefore express "who holds a Firebase permission id", and nothing in
// the repo could express "who holds an EOS capability key that has no Firebase equivalent". Every
// such grant that exists in `eos_policy.role_capabilities` today got there either from a one-shot
// SQL migration's own hand-written VALUES list or from an operator running the governed grant
// command -- in both cases with no durable, reviewable declaration left behind in code. That is
// the gap the Owner named: "the missing piece is a durable canonical EOS Role->Capability
// declaration source."
//
// This module is that source. It declares, for each EOS capability key that the legacy Firebase
// permission catalog CANNOT express, exactly which Security Roles hold it.
//
// ════════════════════ WHY IT IS A SEPARATE STRUCTURE, NOT A NEW ROLE PERMISSION ════════════════════
//
// The obvious "fix" -- adding `workOrder.lifecycle.dispatch` to `ADMIN_ROLE.permissions` -- is
// wrong twice over, and the Owner refused it explicitly:
//
//   (a) IT WOULD BREAK THE LEGACY RESOLVER. The id is not in permissionCatalog.ts, so
//       `findPermission()` returns undefined and `resolve()` DENIES. Registering it in
//       permissionCatalog.ts instead is worse: ADMIN_ROLE.permissions is derived as
//       ADMIN_CURATED_PERMISSIONS plus the ENTIRE catalog (compatibilityRoles.ts:236-238), so
//       merely cataloguing the key would grant it to admin.
//
//   (b) IT WOULD OVER-GRANT OWNER. `OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...reports]`
//       (governedBusinessRoles.ts:83, pinned by governedBusinessRoles.test.mjs:1132). Anything
//       declared on admin is declared on owner BY CONSTRUCTION. A five-row Owner ruling would
//       have produced seven rows.
//
// So this structure has NO inheritance of any kind. A Role holds a canonical EOS capability if and
// only if this file names it against that key. `owner` appears here only where `owner` is written
// out; it is never spread from `admin`. functions/test/canonicalRoleCapabilityCatalog.test.mjs
// proves both halves.
//
// ════════════════════ WHAT IT IS NOT ════════════════════
//
// Declaring a pair here GRANTS NOTHING. This is a pure, dependency-free data module, the same
// posture as compatibilityRoles.ts. Nothing here writes to PostgreSQL. The operator reconcile tool
// (eosOps/migration/inventoryCapabilityGrantMigration.ts) reads it, and that tool is DRY RUN by
// default. Every pair declared below already exists in `eos_policy.role_capabilities` in nonprod
// as of 2026-09-23 -- this file records what is already true, it does not propose anything new.
import { PERMISSION_CATALOG } from "../access/permissionCatalog";

export interface CanonicalCapabilityGrant {
  readonly roleKey: string;
  readonly capabilityKey: string;
}

/** capability key -> the Security Role keys that hold it. Order-insensitive; deduplicated. */
export type CanonicalCapabilityDeclarations = Readonly<Record<string, readonly string[]>>;

// ════════════════════ RULING-AUTHORIZED DECLARATIONS ════════════════════
//
// Owner ruling (Wave 7): "KEEP the exact authorized nonprod state: workOrder.lifecycle.dispatch ->
// admin, dispatcher; .cancel -> admin, dispatcher; .complete -> technician. Do NOT add these to
// legacy ADMIN_ROLE.permissions."
//
// FIVE rows, not seven. `owner` is deliberately ABSENT from all three keys: the ruling named three
// Roles and the database holds exactly those five pairs (measured 2026-09-23: granted_by
// `639c1970-dbdb-4bc0-af7c-118559151e2f`, an operator act through the governed grant command, with
// no code declaration behind it until this file).
//
// `workOrder.lifecycle.*` is checked by eosOps/workOrderAssignmentAuthority.ts and by the native
// Work Order lifecycle engine; the capability metadata (object `workOrder`, action `dispatch` /
// `cancel` / `complete`, kind BUSINESS_ACTION) is fixed by migration 1761350400000.
export const RULING_AUTHORIZED_CAPABILITY_GRANTS: CanonicalCapabilityDeclarations = Object.freeze({
  "workOrder.lifecycle.dispatch": Object.freeze(["admin", "dispatcher"]),
  "workOrder.lifecycle.cancel": Object.freeze(["admin", "dispatcher"]),
  "workOrder.lifecycle.complete": Object.freeze(["technician"]),
});

// ════════════════════ MIGRATION-ESTABLISHED DECLARATIONS ════════════════════
//
// These four keys are in exactly the same position as the three above -- EOS capability keys with
// no Firebase permission id -- and their holders were fixed by an APPLIED migration's own
// hand-written VALUES list. Transcribed here VERBATIM from those migrations, by migration id, so
// the declaration outlives the one-shot SQL that created it. Nothing below is a new decision and
// nothing below proposes a row: each pair was measured present in nonprod on 2026-09-23.
//
// Recording them here rather than leaving them undeclared is the whole point of a canonical
// source: a grant that no code declares is a grant the reconciler must report as unexplained.
export const MIGRATION_ESTABLISHED_CAPABILITY_GRANTS: CanonicalCapabilityDeclarations = Object.freeze({
  // migration 1761609600000_finance-administration-reorder-vocabulary.sql (14 Roles each)
  "finance.invoice.read": Object.freeze([
    "accountingManager", "admin", "controller", "fieldManager", "financeManager", "generalManager",
    "owner", "partsAssociate", "partsManager", "purchasingManager", "salesManager", "salesperson",
    "shopAssociate", "shopManager",
  ]),
  "finance.payment.read": Object.freeze([
    "accountingManager", "admin", "controller", "fieldManager", "financeManager", "generalManager",
    "owner", "partsAssociate", "partsManager", "purchasingManager", "salesManager", "salesperson",
    "shopAssociate", "shopManager",
  ]),
  // migration 1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql (7 Roles).
  // NOTE `reorder.request.read.queue` -- a DIFFERENT key from the same migration -- is a legacy
  // Firebase permission id and is therefore declared by the Role catalog, not here.
  "reorder.request.read": Object.freeze([
    "admin", "dispatcher", "operationsManager", "owner", "partsManager", "purchasingManager",
    "technician",
  ]),
  // migration 1761782400000_manufacturer-catalog-authority.sql (19 Roles)
  "inventory.manufacturer.read": Object.freeze([
    "accountingManager", "admin", "controller", "dispatcher", "fieldManager", "financeManager",
    "generalManager", "inventoryCatalogAdministrator", "inventoryStockRelocationOperator", "owner",
    "partsAssociate", "partsManager", "purchasingManager", "salesManager", "salesperson",
    "shopAssociate", "shopManager", "warehouseAssociate", "warehouseManager",
  ]),
});

/**
 * The whole canonical declaration. One key may appear in ONE section only -- a key declared twice
 * would make "who holds it" ambiguous, which is the exact failure this file exists to end.
 */
export const CANONICAL_EOS_CAPABILITY_GRANTS: CanonicalCapabilityDeclarations = Object.freeze({
  ...RULING_AUTHORIZED_CAPABILITY_GRANTS,
  ...MIGRATION_ESTABLISHED_CAPABILITY_GRANTS,
});

export class CanonicalCapabilityCatalogError extends Error {}

/** Every capability key this file declares, sorted. */
export function canonicalCapabilityKeys(): readonly string[] {
  return Object.freeze(Object.keys(CANONICAL_EOS_CAPABILITY_GRANTS).sort());
}

/** True when the key is a canonical EOS capability key this file declares holders for. */
export function isCanonicalCapabilityKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CANONICAL_EOS_CAPABILITY_GRANTS, key);
}

/**
 * Expand declarations into (Role key, capability key) pairs.
 *
 * NO INHERITANCE, BY CONSTRUCTION: this is a flat expansion of the literal lists above. There is
 * no branch that reads another Role's grant set, so declaring `admin` can never declare `owner`.
 * It is exported taking `declarations` explicitly so a test can prove that property against a
 * synthetic declaration rather than only against today's data.
 *
 * `capabilityKeys`, when supplied, restricts which declared keys are expanded; a requested key
 * this file does not declare simply contributes nothing (the caller may legitimately be mixing
 * legacy and canonical keys in one reconcile). `roleKeys`, when supplied, restricts which Roles
 * are considered -- the same scoping contract `deriveLegacyRoleGrants` offers.
 */
export function deriveGrantsFromDeclarations(
  declarations: CanonicalCapabilityDeclarations,
  capabilityKeys?: readonly string[],
  roleKeys?: readonly string[],
): readonly CanonicalCapabilityGrant[] {
  const wanted = capabilityKeys === undefined ? undefined : new Set(capabilityKeys);
  const allowedRoles = roleKeys === undefined ? undefined : new Set(roleKeys);
  const grants: CanonicalCapabilityGrant[] = [];
  for (const [capabilityKey, holders] of Object.entries(declarations)) {
    if (wanted !== undefined && !wanted.has(capabilityKey)) continue;
    for (const roleKey of new Set(holders)) {
      if (allowedRoles !== undefined && !allowedRoles.has(roleKey)) continue;
      grants.push({ roleKey, capabilityKey });
    }
  }
  grants.sort((a, b) =>
    a.roleKey === b.roleKey ? a.capabilityKey.localeCompare(b.capabilityKey) : a.roleKey.localeCompare(b.roleKey));
  return Object.freeze(grants);
}

/** `deriveGrantsFromDeclarations` over this file's own declaration. */
export function deriveCanonicalCapabilityGrants(
  capabilityKeys?: readonly string[],
  roleKeys?: readonly string[],
): readonly CanonicalCapabilityGrant[] {
  return deriveGrantsFromDeclarations(CANONICAL_EOS_CAPABILITY_GRANTS, capabilityKeys, roleKeys);
}

/**
 * FAIL CLOSED ON THE INHERITANCE ROUTE. Given whatever the LEGACY derivation produced, refuse if
 * any of it names a capability key this file declares.
 *
 * That can only happen one way: someone put an EOS capability key into a Role's legacy
 * `permissions` array. Because `ADMIN_ROLE.permissions` composes the whole permission catalog and
 * `OWNER_PERMISSIONS` spreads `ADMIN_ROLE.permissions`, a single such edit would manufacture an
 * `owner` grant that the canonical declaration never made -- turning a five-row ruling into seven
 * rows. Refusing here means the reconcile tool cannot propose, let alone write, such a row.
 */
export function assertNoCanonicalKeyInLegacyGrants(
  legacyGrants: readonly CanonicalCapabilityGrant[],
): void {
  const leaked = legacyGrants.filter((g) => isCanonicalCapabilityKey(g.capabilityKey));
  if (leaked.length > 0) {
    throw new CanonicalCapabilityCatalogError(
      "a canonical EOS capability key is declared inside a legacy Firebase permission array: " +
        leaked.map((g) => `${g.roleKey}/${g.capabilityKey}`).join(", ") +
        "; legacy Role permission inheritance must never manufacture a canonical EOS capability grant",
    );
  }
}

/**
 * FAIL CLOSED ON THE REGISTRATION ROUTE. A capability key must belong to exactly one world. If a
 * key declared here were also registered as a Firebase permission id, the Role catalog would start
 * declaring holders for it too -- through ADMIN_ROLE's whole-catalog composition and OWNER's spread
 * of admin -- and the two sources would silently disagree about who holds it.
 *
 * Called by the reconcile tool before it derives anything, so the collision can never reach a
 * write, and asserted statically by canonicalRoleCapabilityCatalog.test.mjs.
 */
export function assertCanonicalKeysAreNotLegacyPermissionIds(): void {
  const legacy = new Set(PERMISSION_CATALOG.map((p) => p.id));
  const collisions = canonicalCapabilityKeys().filter((key) => legacy.has(key));
  if (collisions.length > 0) {
    throw new CanonicalCapabilityCatalogError(
      `canonical EOS capability key(s) also registered as legacy Firebase permission ids: ${collisions.join(", ")}` +
        "; a key belongs to exactly one world -- remove it from permissionCatalog.ts, never from here",
    );
  }
}
