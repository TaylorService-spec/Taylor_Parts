"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.INBOUND_RECOVERY_GRANTS = exports.TECHNICIAN_NEVER = exports.SERVICE_ACTIVATION_CONDITIONS = exports.INBOUND_WORK_GRANTS = exports.LABOR_CORRECTION_GRANTS = exports.SERVICE_ACTIVATION_GRANTS = exports.TECHNICIAN_ROLE_KEY = exports.SERVICE_OFFICE_ROLE_KEYS = exports.SERVICE_ACTIVATION_RULING = void 0;
exports.serviceActivationOperations = serviceActivationOperations;
exports.serviceExperienceOperations = serviceExperienceOperations;
exports.SERVICE_ACTIVATION_RULING = "Owner WORK ORDER CUTOVER COMPLETION PASS 2026-09-30";
const OFFICE_ACTIONS = Object.freeze([
    { objectKey: "workOrder", actionKey: "markReady", capabilityKey: "workOrder.lifecycle.ready" },
    { objectKey: "workOrder", actionKey: "schedule", capabilityKey: "workOrder.lifecycle.schedule" },
    { objectKey: "workOrder", actionKey: "close", capabilityKey: "workOrder.lifecycle.close" },
    { objectKey: "workOrder", actionKey: "planParts", capabilityKey: "workOrder.parts.plan" },
]);
exports.SERVICE_OFFICE_ROLE_KEYS = Object.freeze(["dispatcher", "fieldManager"]);
exports.TECHNICIAN_ROLE_KEY = "technician";
/** DECISION 1: exactly nine grants. */
exports.SERVICE_ACTIVATION_GRANTS = Object.freeze([
    ...exports.SERVICE_OFFICE_ROLE_KEYS.flatMap((roleKey) => OFFICE_ACTIONS.map((a) => Object.freeze({
        roleKey, ...a,
        reason: `${exports.SERVICE_ACTIVATION_RULING}, DECISION 1: the Service Office controls planning and dispatch (${a.capabilityKey})`,
    }))),
    Object.freeze({
        roleKey: exports.TECHNICIAN_ROLE_KEY, objectKey: "workOrder", actionKey: "recordExecution", capabilityKey: "workOrder.execution.record",
        reason: `${exports.SERVICE_ACTIVATION_RULING}, DECISION 1: the Technician records execution facts on their own assigned Work Order`,
    }),
]);
const ACTIVATION_RULING = "Controller PR #2005 MERGE + SERVICE ACTIVATION AUTHORIZATION 2026-09-30";
/** DECISION D (activation ruling): labor correction is the Service Manager's (fieldManager) authority ONLY. */
exports.LABOR_CORRECTION_GRANTS = Object.freeze([
    Object.freeze({ roleKey: "fieldManager", objectKey: "workOrder", actionKey: "correctLabor", capabilityKey: "workOrder.labor.correctEntry",
        reason: `${ACTIVATION_RULING}, D: labor correction is the Service Manager's authority only (append-only correction)` }),
]);
/**
 * DECISION E (activation ruling): Inbound Work by least authority. Service Manager (fieldManager): full review and
 * control, including intake configuration. Dispatcher: operational review and normal disposition. Office Manager:
 * read only. Technician, Sales and Parts: none.
 */
exports.INBOUND_WORK_GRANTS = Object.freeze([
    ...["read", "accept", "decline", "attach"].map((a) => Object.freeze({ roleKey: "fieldManager", objectKey: "inboundWorkRequest", actionKey: a,
        capabilityKey: `inboundWork.request.${a}`, reason: `${ACTIVATION_RULING}, E: Service Manager full Inbound Work review/control (${a})` })),
    Object.freeze({ roleKey: "fieldManager", objectKey: "inboundMailbox", actionKey: "manage", capabilityKey: "inboundWork.intake.manage",
        reason: `${ACTIVATION_RULING}, E: Service Manager full Inbound Work control includes intake configuration` }),
    ...["read", "accept", "attach", "decline"].map((a) => Object.freeze({ roleKey: "dispatcher", objectKey: "inboundWorkRequest", actionKey: a,
        capabilityKey: `inboundWork.request.${a}`, reason: `${ACTIVATION_RULING}, E: Dispatcher operational review and normal disposition (${a})` })),
    Object.freeze({ roleKey: "officeManager", objectKey: "inboundWorkRequest", actionKey: "read", capabilityKey: "inboundWork.request.read",
        reason: `${ACTIVATION_RULING}, E: Office Manager read/review visibility only` }),
]);
/** DECISION 2 (DQ-016): exactly one condition. */
exports.SERVICE_ACTIVATION_CONDITIONS = Object.freeze([
    Object.freeze({
        roleKey: exports.TECHNICIAN_ROLE_KEY, objectKey: "workOrder", actionKey: "read", capabilityKey: "workOrder.record.read",
        condition: Object.freeze({ paths: Object.freeze([Object.freeze([Object.freeze({ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" })])]), recordKind: "workOrder" }),
        reason: `${exports.SERVICE_ACTIVATION_RULING}, DECISION 2 (DQ-016): Technician Work Order read = Employee identity + RECORD_ASSIGNMENT`,
    }),
]);
/** What the Technician must never receive through this packet (a test pins it). */
exports.TECHNICIAN_NEVER = Object.freeze([
    "workOrder.parts.plan", "workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch", "workOrder.lifecycle.ready",
    "workOrder.lifecycle.close", "workOrder.lifecycle.cancel", "workOrder.create",
]);
/** The Administration API operations, in order, exactly as the activation window issues them. */
function serviceActivationOperations() {
    return Object.freeze([
        // The condition FIRST: a condition on an already-held grant narrows it, so the technician never holds the read
        // unconditioned for a moment longer than today, and the grants that follow add nothing tenant-wide.
        ...exports.SERVICE_ACTIVATION_CONDITIONS.map((c) => Object.freeze({
            operation: "setGrantCondition",
            input: Object.freeze({ objectKey: c.objectKey, actionKey: c.actionKey, roleKey: c.roleKey, condition: c.condition, reason: c.reason }),
        })),
        ...[...exports.SERVICE_ACTIVATION_GRANTS, ...exports.LABOR_CORRECTION_GRANTS, ...exports.INBOUND_WORK_GRANTS].map((g) => Object.freeze({
            operation: "grantObjectActionToRole",
            input: Object.freeze({ objectKey: g.objectKey, actionKey: g.actionKey, roleKey: g.roleKey, reason: g.reason }),
        })),
    ]);
}
// ════════════════════ SERVICE EXPERIENCE COMPLETION (Controller, 2026-09-30) ════════════════════
const SERVICE_EXPERIENCE_RULING = "Controller SERVICE EXPERIENCE COMPLETION 2026-09-30";
/**
 * B -- INBOUND WORK RECOVERY: the canonical Service Manager (fieldManager) may RELEASE and REASSIGN an accepted-but-
 * unfinished Service Inbound Work item. The Dispatcher is NOT granted recovery (normal processing stays as governed);
 * Office Manager, Technician and Sales hold none. A Parts-mailbox recovery authority is a separate, unruled boundary.
 */
exports.INBOUND_RECOVERY_GRANTS = Object.freeze([
    Object.freeze({ roleKey: "fieldManager", objectKey: "inboundWorkRequest", actionKey: "recover", capabilityKey: "inboundWork.request.recover",
        reason: `${SERVICE_EXPERIENCE_RULING}, B: the Service Manager releases or reassigns an unfinished Service Inbound Work claim` }),
]);
/**
 * The Administration API operations the NEXT activation window issues for this package (after merge, with the Owner's
 * authorization). Self-scheduling capability holders (workOrder.selfScheduling.issue / .configure) are NOT here: they were an
 * open decision at the time, later RULED by the Controller (#2007 merge confirmation, "A") and are recorded as data in
 * recordedActivationDecisionsDelta.ts (SELF_SCHEDULING_ACTIVATION_GRANTS) -- still nothing granted by assumption.
 */
function serviceExperienceOperations() {
    return Object.freeze(exports.INBOUND_RECOVERY_GRANTS.map((g) => Object.freeze({
        operation: "grantObjectActionToRole",
        input: Object.freeze({ objectKey: g.objectKey, actionKey: g.actionKey, roleKey: g.roleKey, reason: g.reason }),
    })));
}
//# sourceMappingURL=serviceActivationAuthorityDelta.js.map