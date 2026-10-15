// ════════════════════════════ OWNER APPROVAL REQUIRED -- PROPOSED, NOT APPLIED ════════════════════════════
// THE FINANCE EXECUTION / ADMINISTRATION SEPARATION DELTA (Owner ruling D-2, read-only examination 2026-10-15).
// Stated as DATA so an authorized window issues a reviewed list through Administration -- never an improvised revoke,
// never a migration, never a job-role bypass in code (DECISIONS #205: later authority changes go through Roles & Permissions).
//
//   S1  admin x finance.adjustment.record and admin x finance.refund.record are REVOKED. Origin: migration 1761609600000
//       (L114 / L162) granted them, copying the Firebase-era ADMIN_CURATED_PERMISSIONS (compatibilityRoles.ts:171-172).
//       DECISIONS #206 ("Not admin. Administering EOS confers no Finance transaction authority") names owner,
//       generalManager, controller, accountingManager and financeManager as the holders of the Finance execution
//       authority (payment.apply / refund / adjustment) and omits admin; #223 O1/O3 ("existing grants retained") is the
//       conflicting ruling this delta asks the Owner to resolve in #206's favour for these two keys.
//   S2  partsManager x finance.adjustment.record is REVOKED -- the same correction as purchasingFinanceClosureDelta R3
//       (DECISIONS #194 section 3), repeated here so this list is complete on its own. A revoke of a pair that is not
//       held is a no-op (policyCommands.revokeObjectActionFromRole returns null, writes no audit and no decision), so it
//       is harmless where the closure delta has already been applied.
//
// KEPT, unchanged: owner, generalManager, controller, accountingManager, financeManager hold both keys through their
// migration grant rows (owner: owner-capability-contract.md:83,87 OWNER_REQUIRED). The capabilities stay registered.
// Each revoke writes an ADMIN_REVOKED decision, which the control-plane trigger (1762646400000:248-287) uses to refuse a
// later default/seed re-insertion. ROLLBACK is the same Administration API: grantObjectActionToRole for each row below,
// with a reason naming the rollback (that supersedes the ADMIN_REVOKED decision).
//
// Not read by any command; nothing changes until Administration applies it.

export const FINANCE_EXECUTION_ADMIN_SEPARATION_RULING = "Owner D-2 Finance execution separation (PROPOSED 2026-10-15 -- OWNER APPROVAL REQUIRED)";

export interface FinanceSeparationDecision {
  readonly operation: "revokeObjectActionFromRole";
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly reason: string;
}

/** capability key -> (objectKey, actionKey), as registered in eos_policy.capabilities (migration 1761609600000 L57-65). */
export const FINANCE_SEPARATION_CAPABILITY_OBJECT_ACTION: Readonly<Record<string, { readonly objectKey: string; readonly actionKey: string }>> = Object.freeze({
  "finance.adjustment.record": Object.freeze({ objectKey: "invoice", actionKey: "recordAdjustment" }),
  "finance.refund.record": Object.freeze({ objectKey: "payment", actionKey: "recordRefund" }),
});

/** The Roles that KEEP both keys. Pinned so a change to this list is a reviewed change. */
export const FINANCE_EXECUTION_HOLDER_ROLE_KEYS = Object.freeze(["owner", "generalManager", "controller", "accountingManager", "financeManager"] as const);

export const FINANCE_EXECUTION_ADMIN_SEPARATION_DECISIONS: readonly FinanceSeparationDecision[] = Object.freeze([
  ...(["finance.adjustment.record", "finance.refund.record"] as const).map((capabilityKey) => ({
    operation: "revokeObjectActionFromRole" as const, roleKey: "admin", capabilityKey,
    reason: `${FINANCE_EXECUTION_ADMIN_SEPARATION_RULING} S1: administering EOS confers no Finance transaction authority (DECISIONS #206)`,
  })),
  {
    operation: "revokeObjectActionFromRole" as const, roleKey: "partsManager", capabilityKey: "finance.adjustment.record",
    reason: `${FINANCE_EXECUTION_ADMIN_SEPARATION_RULING} S2: AUTHORITY DEFECT -- no accepted Decision authorizes Parts Manager finance execution (DECISIONS #194 section 3)`,
  },
].map((d) => Object.freeze(d)));

/** The Administration operations, exactly as an authorized execution window issues them. */
export function financeExecutionAdminSeparationOperations(): readonly { readonly operation: FinanceSeparationDecision["operation"]; readonly input: Record<string, unknown> }[] {
  return Object.freeze(FINANCE_EXECUTION_ADMIN_SEPARATION_DECISIONS.map((d) => Object.freeze({
    operation: d.operation,
    input: Object.freeze({ roleKey: d.roleKey, ...FINANCE_SEPARATION_CAPABILITY_OBJECT_ACTION[d.capabilityKey], reason: d.reason }),
  })));
}

/**
 * ROLLBACK: the inverse Administration operations (re-grant), for an authorized rollback window only. Deliberately NOT named
 * `*Operations`: test/support/removalMatrix.mjs loads every exported `*Operations` of a *Delta module as a RECORDED delta.
 */
export function financeExecutionAdminSeparationRollbackPlan():readonly { readonly operation: "grantObjectActionToRole"; readonly input: Record<string, unknown> }[] {
  return Object.freeze(FINANCE_EXECUTION_ADMIN_SEPARATION_DECISIONS.map((d) => Object.freeze({
    operation: "grantObjectActionToRole" as const,
    input: Object.freeze({ roleKey: d.roleKey, ...FINANCE_SEPARATION_CAPABILITY_OBJECT_ACTION[d.capabilityKey],
      reason: `ROLLBACK of ${FINANCE_EXECUTION_ADMIN_SEPARATION_RULING}: ${d.roleKey} x ${d.capabilityKey} restored` }),
  })));
}
