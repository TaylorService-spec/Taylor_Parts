"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_CONDITION_KINDS = void 0;
exports.decideConditionedCapability = decideConditionedCapability;
exports.conditionedCapabilityKeys = conditionedCapabilityKeys;
// Authorization v2 parity, part A: the CONDITIONED CAPABILITY decision.
//
// Pure: no database, no Firebase, no I/O. It answers one question the flat capability Set cannot:
//
//   the principal HOLDS this capability -- but is it conditioned on the Roles they hold, and is the condition
//   satisfied for THIS governed record?
//
// ════════════════════ WHY THE FLAT SET IS NOT ENOUGH ════════════════════
//
// `capabilityAuthority.resolveOperationalContext` returns capability KEYS held via qualifying Role assignments. It
// carries no conditions, so a capability the catalog conditions is indistinguishable from one it does not. For
// `reorder.purchaseOrder.void` that difference is the whole gate: `firestore.rules` requires
// `isAdminOrDispatcher() AND request.auth.uid == resource.data.assignedToUserId`, so even an Administrator must be
// the request's own recorded assignee. Migrating that grant on the strength of the flat Set alone would hand every
// Administrator and Dispatcher UNCONDITIONAL Void -- the widening the migration-only assignment census refuses.
//
// ════════════════════ ONLY isOwnAssignment IS IMPLEMENTED, DELIBERATELY ════════════════════
//
// The accepted ConditionKind dispositions rule that it is the ONLY Kind requiring PostgreSQL evaluator parity:
//
//   isOwnAssignment         STILL_REQUIRED              implemented here
//   operationalRoleActive   BUSINESS_ELIGIBILITY_SCOPE  answered by Work Eligibility + Operational Scope, never here
//   employmentActive        MOVED                       answered by the governed PostgreSQL employment status
//   statusEquals/statusIn   DEAD                        carried by nothing
//
// So this is NOT a condition language. Every other Kind -- including one added to the union later -- is UNSUPPORTED
// and refuses. Fail-closed is the only safe default: a Kind this evaluator does not understand is a gate it cannot
// prove, and an unprovable gate must never open.
//
// ════════════════════ NOTHING HERE IS CALLER-SUPPLIED ════════════════════
//
// The actor and the target's assignee are both GOVERNED ids the caller resolves server-side from the authoritative
// record. This module accepts no request body, no claims, no uid, no tenant selector and no precomputed condition
// verdict -- there is no input shaped like one. The comparison is EOS Principal id to EOS Principal id: a Firebase
// uid is not a Principal id and can never satisfy the predicate by resembling one.
const compatibilityRoles_1 = require("../access/compatibilityRoles");
const governedBusinessRoles_1 = require("../access/governedBusinessRoles");
/** The Kinds this evaluator can prove. Exactly one, by accepted ruling. */
exports.SUPPORTED_CONDITION_KINDS = Object.freeze(["isOwnAssignment"]);
const catalog = () => ({ ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES });
const exactId = (v) => typeof v === "string" && v !== "" && v.trim() === v;
/** Conditions the catalog attaches to this capability on this Role. Empty means the Role grants it unconditioned. */
function conditionsFor(role, capabilityKey) {
    if (!role)
        return [];
    if (!(role.permissions ?? []).includes(capabilityKey))
        return [];
    return role.conditionsByPermission?.[capabilityKey] ?? [];
}
/** Does this Role grant the capability at all? A Role that does not grant it can neither allow nor condition it. */
const grants = (role, capabilityKey) => Boolean(role) && (role.permissions ?? []).includes(capabilityKey);
function satisfies(condition, input) {
    // Unsupported by construction: see the header. A Kind this evaluator cannot prove never passes.
    if (condition?.kind !== "isOwnAssignment")
        return false;
    if (!input.target)
        return false;
    const assignee = input.target.assignedToPrincipalId;
    // Null assignee refuses: an unassigned record is not everybody's own.
    if (!exactId(assignee) || !exactId(input.actorPrincipalId))
        return false;
    return assignee === input.actorPrincipalId;
}
/**
 * Decide a capability that may be conditioned.
 *
 * ORDER MATTERS, and it is capability FIRST: the security capability remains the first boundary, so a principal who
 * does not hold the capability is refused without the target being consulted at all. A condition can only ever
 * narrow a capability the principal already holds; it can never supply one.
 *
 * MULTI-ROLE UNION, matching `resolveEffectivePermission`: a principal holding several Roles is allowed when AT
 * LEAST ONE held Role grants the capability with EVERY condition on that Role's grant satisfied. An unconditioned
 * grant on any held Role therefore allows -- which is correct and is why `reorder.purchaseOrder.void` carries the
 * Condition on every Role that holds it, admin, dispatcher and owner alike.
 */
function decideConditionedCapability(input, roles = catalog()) {
    const deny = (outcome, conditioned) => Object.freeze({ outcome, allowed: false, viaRoleKey: null, conditioned });
    if (!(input?.heldCapabilities instanceof Set) || !input.heldCapabilities.has(input.capabilityKey)) {
        return deny("CAPABILITY_REQUIRED", false);
    }
    const held = (input.heldRoleKeys ?? []).map((key) => [key, roles[key]]).filter(([, r]) => grants(r, input.capabilityKey));
    // The capability is held per PostgreSQL but no held CATALOG Role grants it: the two disagree, so nothing is proved.
    if (held.length === 0)
        return deny("CAPABILITY_REQUIRED", false);
    const conditioned = held.some(([, role]) => conditionsFor(role, input.capabilityKey).length > 0);
    let sawUnsupported = false;
    let sawOwnAssignment = false;
    for (const [roleKey, role] of held) {
        const conditions = conditionsFor(role, input.capabilityKey);
        if (conditions.length === 0)
            return Object.freeze({ outcome: "ALLOWED", allowed: true, viaRoleKey: roleKey, conditioned });
        for (const c of conditions) {
            if (c?.kind === "isOwnAssignment")
                sawOwnAssignment = true;
            else
                sawUnsupported = true;
        }
        if (conditions.every((c) => satisfies(c, input))) {
            return Object.freeze({ outcome: "ALLOWED", allowed: true, viaRoleKey: roleKey, conditioned });
        }
    }
    // Refused: name WHY as specifically as the evidence allows, without leaking the record.
    if (sawUnsupported)
        return deny("UNSUPPORTED_CONDITION", conditioned);
    if (sawOwnAssignment && !input.target)
        return deny("TARGET_REQUIRED", conditioned);
    return deny("NOT_OWN_ASSIGNMENT", conditioned);
}
/** Capability keys the catalog conditions on at least one Role -- what a migration must treat as not-yet-portable. */
function conditionedCapabilityKeys(roles = catalog()) {
    const keys = new Set();
    for (const role of Object.values(roles)) {
        for (const [capabilityKey, conditions] of Object.entries(role.conditionsByPermission ?? {})) {
            if ((conditions ?? []).length > 0)
                keys.add(capabilityKey);
        }
    }
    return [...keys].sort();
}
//# sourceMappingURL=conditionedCapability.js.map