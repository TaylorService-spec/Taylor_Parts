// THE PURCHASING -> FINANCE CLOSURE ADMINISTRATION DELTA -- the Owner-ruled authority changes, stated as DATA so an
// authorized activation window issues a reviewed list through Administration: never an improvised grant, never a migration
// grant, never a job-role bypass in code (Controller PURCHASING -> FINANCE FINAL CLOSURE, 2026-10-02; DECISIONS #193).
//
//   R1  inventory.receipt.correct (registered by migration 1764430000000, granted to nobody there) -> the Warehouse Manager
//       and Parts Manager Security Roles. Still narrowed at run time by WAREHOUSE operational scope over the receipt location.
//       NOT granted to Warehouse Associate, Parts Associate, Technician, Dispatcher or ordinary receiving users
//       (inventoryReceivingClerk): receipt correction stays a capability distinct from receipt.
//   R3  AUTHORITY DEFECT, corrected: partsManager held finance.invoice.issue and finance.adjustment.record. Origin: migration
//       1761609600000 copied them from the Firebase-era Role catalog (governedBusinessRoles.ts PARTS_MANAGER_ROLE), which
//       took them in #1399 (27a6307b, 2026-08-21) from the workbook row "Parts Manager / Invoices / AR / CRE" whose Design
//       Status is "Proposed". No accepted Decision authorizes them (DECISIONS #151 only CLASSIFIED them OTHER_TARGET_TYPE;
//       personaBusinessAccessRegression carried them as a SECURITY_ROLE_DEFECT candidate awaiting the Owner). Both grants are
//       REVOKED; the capabilities themselves stay registered and every finance Role keeps them. Parts Manager keeps the
//       finance READS (finance.invoice.read / finance.payment.read) it shares with the other operational Roles.
//
// Every row is an ordinary Administration act: a future Administrator changes any of it without source, Firebase or a
// migration. Not read by any command; nothing changes until Administration applies it.

export const PURCHASING_FINANCE_CLOSURE_RULING = "Controller PURCHASING -> FINANCE FINAL CLOSURE (2026-10-02)";

export interface ClosureAuthorityDecision {
  readonly operation: "grantObjectActionToRole" | "revokeObjectActionFromRole";
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly reason: string;
}

/** capability key -> (objectKey, actionKey), as registered in eos_policy.capabilities. */
export const CLOSURE_CAPABILITY_OBJECT_ACTION: Readonly<Record<string, { readonly objectKey: string; readonly actionKey: string }>> = Object.freeze({
  "inventory.receipt.correct": Object.freeze({ objectKey: "receivingOrder", actionKey: "correct" }),
  "finance.invoice.issue": Object.freeze({ objectKey: "invoice", actionKey: "issue" }),
  "finance.adjustment.record": Object.freeze({ objectKey: "invoice", actionKey: "recordAdjustment" }),
});

export const RECEIPT_CORRECTION_HOLDER_ROLE_KEYS = Object.freeze(["warehouseManager", "partsManager"] as const);
export const RECEIPT_CORRECTION_EXCLUDED_ROLE_KEYS = Object.freeze(
  ["warehouseAssociate", "partsAssociate", "technician", "dispatcher", "inventoryReceivingClerk"] as const);

export const PURCHASING_FINANCE_CLOSURE_DECISIONS: readonly ClosureAuthorityDecision[] = Object.freeze([
  ...RECEIPT_CORRECTION_HOLDER_ROLE_KEYS.map((roleKey) => ({
    operation: "grantObjectActionToRole" as const, roleKey, capabilityKey: "inventory.receipt.correct",
    reason: `${PURCHASING_FINANCE_CLOSURE_RULING} R1: ${roleKey} corrects an erroneously recorded receipt within its WAREHOUSE scope`,
  })),
  ...(["finance.invoice.issue", "finance.adjustment.record"] as const).map((capabilityKey) => ({
    operation: "revokeObjectActionFromRole" as const, roleKey: "partsManager", capabilityKey,
    reason: `${PURCHASING_FINANCE_CLOSURE_RULING} R3: AUTHORITY DEFECT -- no accepted Decision authorizes Parts Manager finance execution`,
  })),
].map((d) => Object.freeze(d)));

/** The Administration operations, exactly as an authorized execution window issues them. */
export function purchasingFinanceClosureOperations(): readonly { readonly operation: ClosureAuthorityDecision["operation"]; readonly input: Record<string, unknown> }[] {
  return Object.freeze(PURCHASING_FINANCE_CLOSURE_DECISIONS.map((d) => Object.freeze({
    operation: d.operation,
    input: Object.freeze({ roleKey: d.roleKey, ...CLOSURE_CAPABILITY_OBJECT_ACTION[d.capabilityKey], reason: d.reason }),
  })));
}
