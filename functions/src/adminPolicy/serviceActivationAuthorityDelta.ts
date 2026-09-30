// THE SERVICE ACTIVATION AUTHORITY DELTA -- the Owner-ruled Administration decisions the Work Order activation
// window applies, stated as DATA (WORK ORDER CUTOVER COMPLETION PASS, 2026-09-30, DECISIONS 1 and 2).
//
// ════════════════════ WHAT THIS IS, AND WHAT IT IS NOT ════════════════════
//
// It is the reviewed, exact list of Administration commands -- grantObjectActionToRole and setGrantCondition,
// each by (Object, action) on a CANONICAL Security Role -- that the activation window issues through the governed
// Administration API, after merge, as the administrator persona. It is NOT a migration, NOT a seed, and NOT read
// by any Work Order command: the Work Order implementation asks only for capabilities, and holding them stays an
// Administration decision ("Do not hardcode grants in the Work Order implementation"). A test applies exactly this
// packet through executeAdminOperation to a baseline-equal tenant and proves the ruled outcome end to end.
//
// ════════════════════ THE ROLES ARE THE CANONICAL ONES ════════════════════
//
// Service Office = `dispatcher` and `fieldManager` (the canonical Service Manager: the persona manifest's
// service-manager holds exactly fieldManager, and the baseline has no serviceManager Security Role -- none is
// invented). Technician = `technician`. The Technician receives recordExecution ONLY: no parts planning, no
// scheduling, no dispatch, no office queue control, no administrative correction.
//
// ════════════════════ DQ-016 ════════════════════
//
// Technician Work Order access = Employee identity + RECORD_ASSIGNMENT. The technician's existing
// workOrder.record.read grant is NARROWED by a grant condition on the (technician, workOrder/read) cell -- the
// Administration model's own mechanism, evaluated per record by the entitled decision, never a tenant-wide read
// that downstream code filters. RECORD_ASSIGNMENT resolves the caller to an EMPLOYEE through an ACTIVE
// employee_principal_link and compares Employee to Employee: no Firebase uid, no Principal-as-Employee, no tenant
// fallback. A conditioned holder is withheld from every flat gate (the office queue, the analytics aggregates).

export const SERVICE_ACTIVATION_RULING =
  "Owner WORK ORDER CUTOVER COMPLETION PASS 2026-09-30";

export interface ServiceGrantDecision {
  readonly roleKey: string;
  readonly objectKey: string;
  readonly actionKey: string;
  /** The capability the (Object, action) resolves to -- stated for review; the command resolves it itself. */
  readonly capabilityKey: string;
  readonly reason: string;
}

export interface ServiceConditionDecision {
  readonly roleKey: string;
  readonly objectKey: string;
  readonly actionKey: string;
  readonly capabilityKey: string;
  readonly condition: { readonly paths: readonly (readonly { readonly kind: "RECORD_ASSIGNMENT"; readonly relation: "ASSIGNED_EMPLOYEE" }[])[]; readonly recordKind: "workOrder" };
  readonly reason: string;
}

const OFFICE_ACTIONS = Object.freeze([
  { objectKey: "workOrder", actionKey: "markReady", capabilityKey: "workOrder.lifecycle.ready" },
  { objectKey: "workOrder", actionKey: "schedule", capabilityKey: "workOrder.lifecycle.schedule" },
  { objectKey: "workOrder", actionKey: "close", capabilityKey: "workOrder.lifecycle.close" },
  { objectKey: "workOrder", actionKey: "planParts", capabilityKey: "workOrder.parts.plan" },
]);

export const SERVICE_OFFICE_ROLE_KEYS = Object.freeze(["dispatcher", "fieldManager"]);
export const TECHNICIAN_ROLE_KEY = "technician";

/** DECISION 1: exactly nine grants. */
export const SERVICE_ACTIVATION_GRANTS: readonly ServiceGrantDecision[] = Object.freeze([
  ...SERVICE_OFFICE_ROLE_KEYS.flatMap((roleKey) => OFFICE_ACTIONS.map((a) => Object.freeze({
    roleKey, ...a,
    reason: `${SERVICE_ACTIVATION_RULING}, DECISION 1: the Service Office controls planning and dispatch (${a.capabilityKey})`,
  }))),
  Object.freeze({
    roleKey: TECHNICIAN_ROLE_KEY, objectKey: "workOrder", actionKey: "recordExecution", capabilityKey: "workOrder.execution.record",
    reason: `${SERVICE_ACTIVATION_RULING}, DECISION 1: the Technician records execution facts on their own assigned Work Order`,
  }),
]);

/** DECISION 2 (DQ-016): exactly one condition. */
export const SERVICE_ACTIVATION_CONDITIONS: readonly ServiceConditionDecision[] = Object.freeze([
  Object.freeze({
    roleKey: TECHNICIAN_ROLE_KEY, objectKey: "workOrder", actionKey: "read", capabilityKey: "workOrder.record.read",
    condition: Object.freeze({ paths: Object.freeze([Object.freeze([Object.freeze({ kind: "RECORD_ASSIGNMENT" as const, relation: "ASSIGNED_EMPLOYEE" as const })])]), recordKind: "workOrder" as const }),
    reason: `${SERVICE_ACTIVATION_RULING}, DECISION 2 (DQ-016): Technician Work Order read = Employee identity + RECORD_ASSIGNMENT`,
  }),
]);

/** What the Technician must never receive through this packet (a test pins it). */
export const TECHNICIAN_NEVER = Object.freeze([
  "workOrder.parts.plan", "workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch", "workOrder.lifecycle.ready",
  "workOrder.lifecycle.close", "workOrder.lifecycle.cancel", "workOrder.create",
]);

/** The Administration API operations, in order, exactly as the activation window issues them. */
export function serviceActivationOperations(): readonly { readonly operation: "grantObjectActionToRole" | "setGrantCondition"; readonly input: Record<string, unknown> }[] {
  return Object.freeze([
    // The condition FIRST: a condition on an already-held grant narrows it, so the technician never holds the read
    // unconditioned for a moment longer than today, and the grants that follow add nothing tenant-wide.
    ...SERVICE_ACTIVATION_CONDITIONS.map((c) => Object.freeze({
      operation: "setGrantCondition" as const,
      input: Object.freeze({ objectKey: c.objectKey, actionKey: c.actionKey, roleKey: c.roleKey, condition: c.condition, reason: c.reason }),
    })),
    ...SERVICE_ACTIVATION_GRANTS.map((g) => Object.freeze({
      operation: "grantObjectActionToRole" as const,
      input: Object.freeze({ objectKey: g.objectKey, actionKey: g.actionKey, roleKey: g.roleKey, reason: g.reason }),
    })),
  ]);
}
