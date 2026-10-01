// THE DQ-021 SALES MANAGER PARITY PACKET -- the Controller-ruled Administration decision (DQ-021, 2026-09-28), stated as
// DATA so the nonprod execution is a reviewed list, never an improvised grant.
//
// DQ-021: grant salesAgreement.accept + opportunity.createSalesOrder to the Sales Manager (canonical Security Role
// `salesManager`) through CURRENT Administration (grantObjectActionToRole); the Owner stays on the governed Owner model
// (ownerCapabilityContract: neither key); no migration grants. Per the Owner's 2026-09-26 clarification, `salesManager` is
// a valid Security Role with zero holders today -- this is a GOVERNED_AUTHORITY_PARITY_GAP (the workflow seeds already
// bind salesManager to Win / Accept; only the capability projection lacks the two keys), not a role to retire.
//
// IT DECIDES NO ORG SHAPE. Which channel(s) a Sales Manager covers is the ASSIGNMENT's scope (global = Option A, one
// manager above Retail and National Accounts; salesChannel-scoped = Option B, a manager per channel) -- an open Employee
// Operating Model question this packet neither answers nor needs (the channel-scope runtime enforces either).
//
// It is NOT read by any command; nothing is granted until Administration applies it. Proven by
// test/nationalAccountsSalesPostgres.test.mjs through executeAdminOperation on a baseline-equal tenant.

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
