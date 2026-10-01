// THE SALES MANAGER ACTIVATION PACKET -- two Controller-ruled Administration decisions about ONE Security Role, stated as
// DATA so the nonprod execution is a reviewed list, never an improvised grant.
//
// 1. ROLE SEPARATION (Controller DQ-2, 2026-09-30). The Sales Manager Security Role carried `audit.event.read`, an
//    Administration read every gate decides TENANT-WIDE. Administration therefore refused it any salesChannel scope
//    (SCOPE_AMBIGUOUS_ADMINISTRATION) -- correctly: the defect is the Role's composition, not the refusal. Sales management
//    and tenant-wide audit visibility are separate responsibilities, so the Role sheds the audit read
//    (revokeObjectActionFromRole, recorded ADMIN_REVOKED). Nothing is made channel-scoped artificially and nothing widens:
//    the Role keeps only Commercial / customer / catalog / finance-read authority, and becomes assignable as
//    `salesManager @ salesChannel:RETAIL` or `@ salesChannel:NATIONAL_ACCOUNTS` (or globally, for a manager over both).
//    A Sales Manager who also needs tenant-wide audit visibility receives it from a separately appropriate GLOBAL Role;
//    none is needed today (the Role has zero holders and no Commercial read consults audit.event.read), so no supporting
//    Role is created.
//
//    WHY AN ADMINISTRATION DECISION, NOT A CATALOG / MIGRATION EDIT. A tenant's authority is verified as SYSTEM DEFAULT
//    (the canonical catalog + measured baseline) PLUS its current Administration decisions (roleCapabilityAdministration
//    verifyTenantAuthority). An ADMIN_REVOKED decision is durable -- no default writer (catalog reconcile, activation,
//    seed) may re-insert over it -- and the verifier explains the absent default instead of reporting drift. Editing the
//    canonical default instead would need a canonical-authority migration and a re-measured baseline: a one-off migration
//    the Administration-control-plane rule forbids. So the separation is made exactly like DQ-021, through Administration.
//
// 2. DQ-021 PARITY (Controller DQ-021, 2026-09-28; re-approved DQ-1, 2026-09-30): grant salesAgreement.accept +
//    opportunity.createSalesOrder to `salesManager` through CURRENT Administration (grantObjectActionToRole). Both are
//    salesChannel-evaluable, so a scoped manager accepts and converts ONLY in their channel. The Owner stays on the
//    governed Owner model (ownerCapabilityContract: neither key); no migration grants. `salesManager` is a valid Security
//    Role with zero holders (Owner 2026-09-26) -- a GOVERNED_AUTHORITY_PARITY_GAP, not a role to retire.
//
// IT DECIDES NO ORG SHAPE BY ITSELF: which channel(s) a Sales Manager covers is the ASSIGNMENT's scope. No Retail /
// National logic exists anywhere; the channel-scope runtime decides every write and read against the record's channel.
//
// It is NOT read by any command; nothing changes until Administration applies it. Proven by
// test/nationalAccountsSalesPostgres.test.mjs through executeAdminOperation on a baseline-equal tenant.

export const SALES_MANAGER_ROLE_SEPARATION_RULING = "Controller DQ-2 (2026-09-30): Sales Manager role separated from tenant-wide audit visibility";

export interface SalesManagerRoleSeparation {
  readonly roleKey: "salesManager";
  readonly objectKey: "auditLog";
  readonly actionKey: "read";
  readonly capabilityKey: "audit.event.read";
  readonly reason: string;
}

export const SALES_MANAGER_ROLE_SEPARATION: SalesManagerRoleSeparation = Object.freeze({
  roleKey: "salesManager" as const, objectKey: "auditLog" as const, actionKey: "read" as const, capabilityKey: "audit.event.read" as const,
  reason: `${SALES_MANAGER_ROLE_SEPARATION_RULING}: tenant-wide audit visibility is not sales management; the Role becomes salesChannel-assignable`,
});

/** The role-separation revoke, exactly as a nonprod execution window issues it. */
export function salesManagerRoleSeparationOperations(): readonly { readonly operation: "revokeObjectActionFromRole"; readonly input: Record<string, unknown> }[] {
  const r = SALES_MANAGER_ROLE_SEPARATION;
  return Object.freeze([Object.freeze({
    operation: "revokeObjectActionFromRole" as const,
    input: Object.freeze({ roleKey: r.roleKey, objectKey: r.objectKey, actionKey: r.actionKey, reason: r.reason }),
  })]);
}

export const DQ021_RULING = "Controller DQ-021 (2026-09-28): Sales Manager accept + create Sales Order";

export interface SalesManagerGrantDecision {
  readonly roleKey: "salesManager";
  readonly objectKey: string;
  readonly actionKey: string;
  readonly capabilityKey: string;
  readonly reason: string;
}

export const SALES_MANAGER_PARITY_GRANTS: readonly SalesManagerGrantDecision[] = Object.freeze([
  Object.freeze({ roleKey: "salesManager" as const, objectKey: "salesAgreement", actionKey: "accept", capabilityKey: "salesAgreement.accept",
    reason: `${DQ021_RULING}: the Sales Manager accepts a Sales Agreement` }),
  Object.freeze({ roleKey: "salesManager" as const, objectKey: "opportunity", actionKey: "createSalesOrder", capabilityKey: "opportunity.createSalesOrder",
    reason: `${DQ021_RULING}: the Sales Manager closes an Opportunity as WON into its Sales Order` }),
]);

/** The Administration operations, exactly as a nonprod execution window issues them. */
export function salesManagerParityOperations(): readonly { readonly operation: "grantObjectActionToRole"; readonly input: Record<string, unknown> }[] {
  return Object.freeze(SALES_MANAGER_PARITY_GRANTS.map((g) => Object.freeze({
    operation: "grantObjectActionToRole" as const,
    input: Object.freeze({ roleKey: g.roleKey, objectKey: g.objectKey, actionKey: g.actionKey, reason: g.reason }),
  })));
}

/** The whole Sales Manager window, in order: separate the Role first, then the DQ-021 parity grants. Net grants: -1 +2. */
export function salesManagerActivationOperations(): readonly { readonly operation: string; readonly input: Record<string, unknown> }[] {
  return Object.freeze([...salesManagerRoleSeparationOperations(), ...salesManagerParityOperations()]);
}
