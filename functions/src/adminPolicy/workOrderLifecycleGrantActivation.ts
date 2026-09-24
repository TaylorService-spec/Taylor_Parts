// THE WORK ORDER LIFECYCLE ACTIVATION SET -- Owner ruling B, NONPROD, 2026-09-23.
//
// ════════════════════ WHAT THIS MODULE IS ════════════════════
//
// The ruling, transcribed once, as data:
//
//     workOrder.lifecycle.dispatch  ->  admin, dispatcher
//     workOrder.lifecycle.cancel    ->  admin, dispatcher
//     workOrder.lifecycle.complete  ->  technician
//
// FIVE ROWS. Not four, not seven. "Do not grant lifecycle capabilities to any additional Roles" is
// the operative sentence, and the only way to keep it true a month from now is to make the set
// enumerable and pin it -- so the list below IS the authorization record, and a sixth entry is a
// reviewed diff rather than an afternoon's convenience.
//
// ════════════════════ WHY NOT THE ROLE-CATALOG RECONCILER ════════════════════
//
// The obvious route was `eosOps/migration/inventoryCapabilityGrantMigration.ts`, which derives grants
// from the in-repo Role catalog's own `permissions` arrays. It is the wrong instrument HERE, for two
// independent reasons, and both were measured rather than assumed:
//
//  1. OWNER WOULD INHERIT. `OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...reports]`
//     (access/governedBusinessRoles.ts). Anything added to admin's list is owner's list too, by
//     construction and by a pinned test ("Owner holds every ADMIN_ROLE permission"). Declaring
//     dispatch/cancel on admin would therefore declare them on owner -- SEVEN rows from a five-row
//     ruling, and a Role the Owner explicitly excluded.
//
//  2. THE CATALOG'S `permissions` ARE FIRESTORE PERMISSION IDS. All 151 ids held by any canonical Role
//     today exist in access/permissionCatalog.ts; `workOrder.lifecycle.*` do not -- they are
//     eos_policy capability keys, catalogued by migration 1757894400000, which the Work Order
//     lifecycle module's own header is at pains to say are NOT interchangeable with Firestore
//     permission ids. Putting one in a Role's `permissions` array would put an id in the legacy
//     resolver that the legacy resolver cannot resolve.
//
// So the grants are made through the CANONICAL administrative contract instead --
// `grantObjectActionToRole` (policyCommands.ts): (objectKey, actionKey, roleKey), admin-only
// authority, one audited mutation event per row, idempotent. That command's own header uses
// "Work Order -> Dispatch" as its worked example. It is the governed mechanism for exactly this.
//
// ════════════════════ WHAT THIS MODULE DOES NOT DO ════════════════════
//
// NO PRINCIPAL GRANTS. `grantObjectActionToPrincipal` is not imported here and must not be: a direct
// Principal grant MINTS authority for one person outside any Role, and the ruling authorizes Roles.
// NO RAW SQL -- this file holds no query and cannot; adminPolicy's DAL port permits exactly two files
// to touch the driver and this is not one of them.
// NO SCOPE ON THE GRANT. Completion's RECORD_ASSIGNMENT requirement is policy about the ACTION and
// lives in eosOps/workOrderLifecycle.ts (LIFECYCLE_CONTEXT_PREDICATES), never as a column here.
// DRY RUN BY DEFAULT: `apply: true` is the only path that writes, matching every other operator tool
// in this repository.
import { requireAdministrationAuthority } from "./administrationAuthority";
import { grantObjectActionToRole, type AdminActor } from "./policyCommands";
import type { PolicyRepository } from "./policyRepository";
import type { RoleCapabilityRecord } from "./types";

export const WORK_ORDER_OBJECT_KEY = "workOrder";

/** The three lifecycle actions, as the canonical Object/action metadata spells them. */
export const LIFECYCLE_ACTION_KEYS: readonly string[] = Object.freeze(["dispatch", "cancel", "complete"]);

export interface LifecycleActivationGrant {
  readonly objectKey: string;
  readonly actionKey: string;
  readonly roleKey: string;
}

/**
 * THE AUTHORIZED SET. Exactly five, ordered for readability, frozen so nothing widens it at runtime.
 *
 * `complete` is technician ONLY -- deliberately NOT admin and NOT dispatcher. Completion asserts that
 * the work was done, and the ruling binds that assertion to the assigned Employee; an administrator
 * who could complete anybody's job would be a second, unbound way to make the same assertion.
 */
export const WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS: readonly LifecycleActivationGrant[] = Object.freeze([
  Object.freeze({ objectKey: WORK_ORDER_OBJECT_KEY, actionKey: "dispatch", roleKey: "admin" }),
  Object.freeze({ objectKey: WORK_ORDER_OBJECT_KEY, actionKey: "dispatch", roleKey: "dispatcher" }),
  Object.freeze({ objectKey: WORK_ORDER_OBJECT_KEY, actionKey: "cancel", roleKey: "admin" }),
  Object.freeze({ objectKey: WORK_ORDER_OBJECT_KEY, actionKey: "cancel", roleKey: "dispatcher" }),
  Object.freeze({ objectKey: WORK_ORDER_OBJECT_KEY, actionKey: "complete", roleKey: "technician" }),
]);

export type ActivationRowStatus = "PROPOSED" | "APPLIED" | "ALREADY_GRANTED";

export interface ActivationRow extends LifecycleActivationGrant {
  readonly capabilityKey: string;
  readonly status: ActivationRowStatus;
  readonly roleCapabilityId: string | null;
}

export interface ActivationReport {
  readonly tenantId: string;
  readonly apply: boolean;
  readonly generatedAt: string;
  /** role_capabilities rows in this tenant, counted before and (on an apply run) after. */
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly proposedAdditions: number;
  readonly appliedAdditions: number;
  readonly rows: readonly ActivationRow[];
}

export interface ActivationOptions {
  /** DEFAULT false. Only `true` writes. */
  readonly apply?: boolean;
  /** Recorded on every audit event this run appends. */
  readonly reason: string;
}

/**
 * Apply (or, by default, merely report) the five authorized grants.
 *
 * IDEMPOTENT. `grantObjectActionToRole` returns the existing row for a re-grant and writes no
 * mutation event, so a second apply run reports five ALREADY_GRANTED and changes nothing.
 *
 * FAILS CLOSED AND LOUD. An unresolvable Object, action or Role throws out of the whole run rather
 * than being skipped: a grant the operator asked for and did not get is not a warning.
 */
export async function activateWorkOrderLifecycleGrants(
  repo: PolicyRepository,
  actor: AdminActor,
  options: ActivationOptions,
): Promise<ActivationReport> {
  // AUTHORITY FIRST, AND FOR THE DRY RUN TOO. `grantObjectActionToRole` re-checks this on every write,
  // but a run where all five are ALREADY_GRANTED writes nothing and would therefore check nothing --
  // and a report of who holds which lifecycle capability is itself a description of the tenant's
  // access configuration. An unauthorized caller gets the refusal, not the reading.
  requireAdministrationAuthority(actor.heldRoleKeys, "editRoleDefinition");

  const apply = options.apply === true;

  const capabilities = await repo.listCapabilities();
  const capabilityKeyByObjectAction = new Map(
    capabilities.map((c) => [`${c.objectKey ?? ""}|${c.actionKey ?? ""}`, c.key]),
  );

  const before = await repo.listRoleCapabilities(actor.tenantId);
  const beforeCount = before.length;

  const rows: ActivationRow[] = [];
  let proposedAdditions = 0;
  let appliedAdditions = 0;

  for (const grant of WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS) {
    const capabilityKey = capabilityKeyByObjectAction.get(`${grant.objectKey}|${grant.actionKey}`);
    if (!capabilityKey) {
      throw new Error(`no capability is catalogued for ${grant.objectKey} -> ${grant.actionKey}`);
    }
    const role = await repo.getRoleByKey(actor.tenantId, grant.roleKey);
    if (!role) throw new Error(`this tenant has no Role "${grant.roleKey}"`);

    const capability = capabilities.find((c) => c.key === capabilityKey);
    const existing = before.find((g) => g.roleId === role.id && g.capabilityId === capability?.id);
    if (existing) {
      rows.push({ ...grant, capabilityKey, status: "ALREADY_GRANTED", roleCapabilityId: existing.id });
      continue;
    }

    proposedAdditions += 1;
    if (!apply) {
      rows.push({ ...grant, capabilityKey, status: "PROPOSED", roleCapabilityId: null });
      continue;
    }

    // THE GOVERNED COMMAND, not a repository write: it re-checks the admin-only authority, re-resolves
    // (objectKey, actionKey) against the canonical metadata, proves the Object is registered in THIS
    // tenant, and appends the audit event inside the same transaction as the grant.
    const written: RoleCapabilityRecord = await grantObjectActionToRole(repo, actor, {
      objectKey: grant.objectKey,
      actionKey: grant.actionKey,
      roleKey: grant.roleKey,
      reason: options.reason,
    });
    appliedAdditions += 1;
    rows.push({ ...grant, capabilityKey, status: "APPLIED", roleCapabilityId: written.id });
  }

  const afterCount = apply ? (await repo.listRoleCapabilities(actor.tenantId)).length : beforeCount;

  return Object.freeze({
    tenantId: actor.tenantId,
    apply,
    generatedAt: new Date().toISOString(),
    beforeCount,
    afterCount,
    proposedAdditions,
    appliedAdditions,
    rows: Object.freeze(rows),
  });
}

/** A short human summary, for an operator running this by hand. */
export function describeActivationReport(report: ActivationReport): string {
  return [
    `tenant ${report.tenantId} @ ${report.generatedAt} -- ${report.apply ? "APPLY" : "DRY RUN"}`,
    `  role_capabilities before  ${report.beforeCount}`,
    `  role_capabilities after   ${report.afterCount}`,
    `  proposed additions        ${report.proposedAdditions}`,
    `  applied additions         ${report.appliedAdditions}`,
    ...report.rows.map((r) => `    ${r.status.padEnd(15)} ${r.roleKey} -> ${r.capabilityKey}`),
  ].join("\n");
}
