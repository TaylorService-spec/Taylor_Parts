"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATALOG_DECLARATIONS_WITHOUT_SYSTEM_DEFAULT = exports.ADMINISTRATION_GRANT_ONLY_CAPABILITIES = exports.conditionIsEvaluableFor = exports.CONDITION_OPERATIONAL_SCOPE_TYPES = exports.CONDITIONABLE_GRANTS = exports.ADMINISTRATION_GOVERNING_CAPABILITIES = exports.PLATFORM_SAFETY_INVARIANTS = exports.FORBIDDEN_ROLE_CAPABILITY_PAIRS = exports.OWNER_EXCLUDED_CAPABILITIES = void 0;
exports.forbiddenPair = forbiddenPair;
exports.ownerPrincipalViolations = ownerPrincipalViolations;
exports.resolveCell = resolveCell;
exports.decisionIndex = decisionIndex;
exports.defaultWriterMayInsert = defaultWriterMayInsert;
exports.verifyTenantAuthority = verifyTenantAuthority;
// THE ADMINISTRATION CONTROL PLANE — invariants, precedence and tenant-authority verification for
// Role -> capability grants. Pure: no storage, no SQL (the DAL rule of this directory).
//
// ════════════════════ THREE KINDS OF FACT, KEPT APART ════════════════════
//
//   1. PLATFORM CATALOG      eos_policy.capabilities -- the vocabulary, born in migrations.
//   2. SYSTEM INVARIANTS     pairs that must NEVER be held, whoever asks (this file). A violation is
//                            refused on write and reported as drift on read -- always.
//   3. TENANT CONFIGURATION  what each Role holds. Two sources compose into it:
//        SYSTEM_DEFAULT      what the repository produces: migrations, the Role catalog reconcile,
//                            and an environment activation (roleCapabilityAuthorityBaseline.ts)
//        ADMIN decision      what an administrator decided through EOS Administration
//                            (eos_policy.role_capability_decisions, append-only, audited)
//
// ════════════════════ THE PRECEDENCE RULE (deterministic, one line) ════════════════════
//
//     SYSTEM_INVARIANT  >  current ADMIN decision (GRANTED or REVOKED)  >  SYSTEM_DEFAULT
//
// A forbidden pair is absent whatever an administrator or a default says. Otherwise the CURRENT
// administrator decision wins: ADMIN_REVOKED keeps a default out (a catalog reconcile, an activation
// tool or a seed may never re-insert it), ADMIN_GRANTED keeps a non-default in (no default writer
// may delete it). With no decision, the system default stands.
//
// This is NOT per-Role withholding. No Role key appears below except in the SYSTEM INVARIANTS,
// which are Owner rulings (ruling A's Owner exclusions and the withheld technician Purchase Order
// cells) -- engine facts, not configuration, and deliberately not administrable.
const governedBusinessRoles_1 = require("../access/governedBusinessRoles");
const cellKey = (roleKey, capabilityKey) => `${roleKey}\u0000${capabilityKey}`;
/** Capabilities the Owner Role -- and any PRINCIPAL holding it -- may never hold (Owner ruling A). */
exports.OWNER_EXCLUDED_CAPABILITIES = Object.freeze([
    ...governedBusinessRoles_1.OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES,
    "reorder.request.assign",
]);
/**
 * Pairs no tenant may hold. Derived from the constants that already carry the Owner rulings, never
 * re-typed, so a ruling edited in one place is enforced here without a second edit.
 */
exports.FORBIDDEN_ROLE_CAPABILITY_PAIRS = Object.freeze(exports.OWNER_EXCLUDED_CAPABILITIES.map((capabilityKey) => Object.freeze({
    roleKey: "owner", capabilityKey, invariantClass: "OWNER_GOVERNANCE",
    ruling: capabilityKey === "reorder.request.assign"
        ? "Owner ruling A (2026-09-24): work coordination, not oversight -- excluded from the Owner"
        : "Owner ruling A (2026-09-24): an administrator-only capability the Owner must never hold",
})));
/** The engine's own immutable rules, and where each is enforced. Read-only documentation of code. */
exports.PLATFORM_SAFETY_INVARIANTS = Object.freeze([
    { key: "ANTI_LOCKOUT", invariantClass: "PLATFORM_SAFETY",
        rule: "the last principal the gate would admit for admin.securityPolicy.write or admin.roleAssignment.write is never removed",
        enforcedBy: "policyCommands (inside the tenant governance lock) -- WOULD_REMOVE_LAST_ADMINISTRATION_PATH" },
    { key: "ADMIN_NOT_CONDITIONABLE", invariantClass: "PLATFORM_SAFETY",
        rule: "no condition on an admin.* capability; only CONDITIONABLE_GRANTS may carry one",
        enforcedBy: "setGrantCondition / grantObjectActionToRole -- CONDITION_NOT_SUPPORTED" },
    { key: "NEVER_WIDEN_ON_RETIRE", invariantClass: "PLATFORM_SAFETY",
        rule: "an ACTIVE condition is never retired or deleted while its grant is held; conditioned-only keys never reach a flat capability set",
        enforcedBy: "capability_grant_conditions_never_widen trigger + grant-cell lock; resolveOperationalContext withholding" },
    { key: "APPEND_ONLY_AUDIT", invariantClass: "PLATFORM_SAFETY",
        rule: "audit_events and role_capability_decisions are never updated (bar the one-time supersede stamp), deleted or truncated",
        enforcedBy: "append-only row triggers + statement TRUNCATE triggers (migration 1762646400000)" },
]);
const FORBIDDEN = new Map(exports.FORBIDDEN_ROLE_CAPABILITY_PAIRS.map((p) => [cellKey(p.roleKey, p.capabilityKey), p]));
/** The invariant a (Role, capability) pair violates, or null when it may be held. */
function forbiddenPair(roleKey, capabilityKey) {
    return FORBIDDEN.get(cellKey(roleKey, capabilityKey)) ?? null;
}
/**
 * PRINCIPAL-LEVEL Owner governance: a principal holding the owner Role may not hold an excluded
 * capability through ANY path -- another Role or a direct grant. Returns the offending keys.
 */
function ownerPrincipalViolations(heldRoleKeys, effectiveCapabilityKeys) {
    if (!heldRoleKeys.includes("owner"))
        return Object.freeze([]);
    const held = new Set(effectiveCapabilityKeys);
    return Object.freeze(exports.OWNER_EXCLUDED_CAPABILITIES.filter((k) => held.has(k)).sort());
}
/**
 * The Administration write capabilities. Their gate reads the FLAT capability set, so a condition on
 * one would be decorative -- conditioning them is refused -- and removing the last holder of one
 * would leave the tenant unadministrable, so that is refused too (the anti-lockout guard).
 */
exports.ADMINISTRATION_GOVERNING_CAPABILITIES = Object.freeze([
    "admin.securityPolicy.write",
    "admin.roleAssignment.write",
]);
/**
 * THE CONDITION ALLOW-LIST: capability x recordKind that may carry a grant condition. A capability is
 * listed ONLY when every server gate consuming it evaluates entitlements (the entitled seam); a key a
 * flat-set gate reads would treat a conditioned grant as unconditional. Everything else is refused
 * (CONDITION_NOT_SUPPORTED) -- including the withheld technician Purchase Order cells.
 *
 * workOrder.record.read: no flat-set gate reads it; the Work Order record read is decided per record
 * by authorizeOperationalAction (technician RECORD_ASSIGNMENT, Pass 7 case D).
 */
exports.CONDITIONABLE_GRANTS = Object.freeze([
    Object.freeze({ capabilityKey: "workOrder.record.read", recordKinds: Object.freeze(["workOrder"]),
        kinds: Object.freeze(["RECORD_ASSIGNMENT", "WORK_ELIGIBILITY", "OPERATIONAL_SCOPE"]) }),
]);
/**
 * The Operational Scope types a condition may name. Restated (not imported) because nothing outside
 * eosWorkforce may import it; administrationControlPlane.test.mjs proves it EQUALS
 * eosWorkforce/operationalScopeVocabulary OPERATIONAL_SCOPE_TYPES.
 */
exports.CONDITION_OPERATIONAL_SCOPE_TYPES = Object.freeze(["WAREHOUSE", "REORDER_QUEUE", "MOBILE"]);
/** May this capability carry a condition at all? */
const conditionIsEvaluableFor = (capabilityKey) => exports.CONDITIONABLE_GRANTS.some((g) => g.capabilityKey === capabilityKey);
exports.conditionIsEvaluableFor = conditionIsEvaluableFor;
// ════════════════════ 3. PRECEDENCE ════════════════════
/**
 * ADMINISTRATION-GRANT-ONLY capabilities: registered, with NO system default. The Reorder lifecycle authority (Controller
 * ruling "REORDER LIFECYCLE AUTHORITY -- GO", 2026-09-28; migration 1763337600000) is registered in the current
 * Administration model and must be granted THROUGH Administration -- "do not seed legacy role grants".
 *
 * The compiled Role catalog still declares several of these keys on legacy Roles (admin, dispatcher, technician,
 * purchasingManager, generalManager, owner). Without this fence, the moment the keys became registered every default
 * writer (the catalog reconcile, the activation tool, the Sample Company seed) would import those legacy holders as
 * grants. With it, a catalog declaration of one of these keys is NOT a system default: the only way a Role holds one is
 * a current ADMIN_GRANTED decision, and until then every command requiring it fails closed.
 */
exports.ADMINISTRATION_GRANT_ONLY_CAPABILITIES = new Set([
    "reorder.request.approve",
    "reorder.request.reject",
    "reorder.request.startPurchasing",
    "reorder.request.postPurchasingUpdate",
    "reorder.request.markReceived",
    "reorder.request.cancel",
    "reorder.request.recordPurchaseOrder",
    "reorder.purchaseOrder.void",
    // Controller ruling DQ-011 (2026-09-28; migration 1763856000000): workOrder.parts.plan is registered with NO
    // default grant. The legacy catalog declares it on the compatibility admin Role (which composes the whole
    // PERMISSION_CATALOG) and on workOrderPartsPlanner, so without the fence the catalog reconcile would import it.
    // (DQ-010's workOrder.lifecycle.ready / .schedule / .close are NOT in PERMISSION_CATALOG, so no catalog
    // declaration can propose them; they need no fence entry.)
    "workOrder.parts.plan",
    // Controller ruling DQ-036(b) (2026-09-28; migration 1764129600000): acquire-existing-unit. The compiled catalog declares
    // it on admin (whole-catalog composition) and on inventorySerializedAssetAcquirer; neither is a default. Its Taylor
    // holders (Parts Associate, Parts Manager, Warehouse Associate, Warehouse Manager) are Administration grants.
    "inventory.serializedAsset.acquire",
    // Controller TRUCK INVENTORY ACTIVATION OD-T6 (2026-10-01; migration 1764410000000): resolve a scanned identifier. The
    // compiled catalog declares it on admin (whole-catalog composition) and on the lookup Role; neither is a default. Its
    // holders are the inventoryLookupReader composition, granted through Administration.
    "inventory.catalog.alias.read",
]);
/** THE precedence rule. Every writer and every verifier asks this and nothing else. */
function resolveCell(input) {
    if (forbiddenPair(input.roleKey, input.capabilityKey)) {
        return Object.freeze({ shouldHold: false, source: "SYSTEM_INVARIANT" });
    }
    if (input.decision === "ADMIN_GRANTED")
        return Object.freeze({ shouldHold: true, source: "ADMIN_GRANTED" });
    if (input.decision === "ADMIN_REVOKED")
        return Object.freeze({ shouldHold: false, source: "ADMIN_REVOKED" });
    // No system default exists for an Administration-grant-only capability, whatever a catalog declares.
    if (exports.ADMINISTRATION_GRANT_ONLY_CAPABILITIES.has(input.capabilityKey))
        return Object.freeze({ shouldHold: false, source: "NONE" });
    if (exports.CATALOG_DECLARATIONS_WITHOUT_SYSTEM_DEFAULT.has(cellKey(input.roleKey, input.capabilityKey)))
        return Object.freeze({ shouldHold: false, source: "NONE" });
    return input.isSystemDefault
        ? Object.freeze({ shouldHold: true, source: "SYSTEM_DEFAULT" })
        : Object.freeze({ shouldHold: false, source: "NONE" });
}
/**
 * LEGACY CATALOG DECLARATIONS THAT ARE NOT SYSTEM DEFAULTS -- Controller DQ-023 / DQ-037 (2026-09-28): reconciliation is
 * REPORT-ONLY for anything no accepted ruling established; only Administration changes governed authority.
 *
 * The compiled Role catalog (admin composes the whole legacy permission catalog) declares these eight (Role, capability)
 * PAIRS, but no migration, ruling or measured baseline establishes them: none is in the governed authority baseline
 * (roleCapabilityAuthorityBaseline), so a verifier already reads them as "no system default". Without this fence every
 * default writer (catalog reconcile --apply, the Sample Company seed) still INSERTED them. With it, a default writer
 * reports them (status ADMINISTRATION_ONLY) and never applies them; a Role holds one only through a current
 * ADMIN_GRANTED decision.
 *
 * PAIR-LEVEL, deliberately -- not a capability-key fence. The same keys ARE governed defaults for other Roles
 * (partsManager / reorder.request.assign; the purchaseOrder.create / .read holders), and a key-level fence would strip
 * default status from grants the baseline establishes. Nothing is revoked: an existing row is untouched.
 */
exports.CATALOG_DECLARATIONS_WITHOUT_SYSTEM_DEFAULT = new Set([
    ["admin", "reorder.request.assign"], ["admin", "reorder.request.read.queue"],
    ["dispatcher", "reorder.request.assign"], ["dispatcher", "reorder.request.read.queue"],
    ["partsManager", "reorder.request.read.queue"], ["purchasingManager", "reorder.request.read.queue"],
    ["technician", "reorder.purchaseOrder.create"], ["technician", "reorder.purchaseOrder.read"],
].map(([roleKey, capabilityKey]) => cellKey(roleKey, capabilityKey)));
/** Index the CURRENT decisions by cell. Two current decisions for one cell is a store defect. */
function decisionIndex(decisions) {
    const map = new Map();
    for (const d of decisions) {
        const key = cellKey(d.roleKey, d.capabilityKey);
        if (map.has(key))
            throw new Error(`two current Administration decisions for ${d.roleKey}/${d.capabilityKey}`);
        map.set(key, d.decision);
    }
    return map;
}
/**
 * For a DEFAULT WRITER (catalog reconcile, activation tool, seed): may it insert this pair?
 * Only when the precedence rule says the pair should be held for a reason other than an admin grant
 * the writer is not making -- i.e. never over ADMIN_REVOKED and never a forbidden pair.
 */
function defaultWriterMayInsert(decisions, roleKey, capabilityKey) {
    const resolution = resolveCell({
        roleKey, capabilityKey, decision: decisions.get(cellKey(roleKey, capabilityKey)) ?? null, isSystemDefault: true,
    });
    return Object.freeze({ allowed: resolution.shouldHold, source: resolution.source });
}
/**
 * Explain every live grant and every absent default of one tenant.
 *
 * `systemDefault` is what the repository produces for this environment (e.g.
 * `nonprodAuthorityGrants()`); `live` is what the tenant holds; `decisions` are the CURRENT
 * Administration decisions. Forbidden-pair and structural checks are NOT weakened by a decision:
 * a forbidden pair that is present is drift whatever the decision table says.
 */
function verifyTenantAuthority(input) {
    const decisions = decisionIndex(input.decisions);
    const defaults = new Set(input.systemDefault.map((p) => cellKey(p.roleKey, p.capabilityKey)));
    const live = new Set(input.live.map((p) => cellKey(p.roleKey, p.capabilityKey)));
    const cells = new Map();
    for (const p of [...input.systemDefault, ...input.live, ...input.decisions]) {
        cells.set(cellKey(p.roleKey, p.capabilityKey), { roleKey: p.roleKey, capabilityKey: p.capabilityKey });
    }
    const out = {
        forbiddenPresent: [], explainedByAdminGrant: [],
        explainedByAdminRevoke: [], unexplainedExtra: [],
        missingDefault: [], adminGrantedMissing: [],
        adminRevokedPresent: [],
    };
    const sorted = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, cell] of sorted) {
        const held = live.has(key);
        const isDefault = defaults.has(key);
        const decision = decisions.get(key) ?? null;
        if (forbiddenPair(cell.roleKey, cell.capabilityKey)) {
            if (held)
                out.forbiddenPresent.push(cell);
            continue;
        }
        if (decision === "ADMIN_GRANTED") {
            if (!held)
                out.adminGrantedMissing.push(cell);
            else if (!isDefault)
                out.explainedByAdminGrant.push(cell);
            continue;
        }
        if (decision === "ADMIN_REVOKED") {
            if (held)
                out.adminRevokedPresent.push(cell);
            else if (isDefault)
                out.explainedByAdminRevoke.push(cell);
            continue;
        }
        if (held && !isDefault)
            out.unexplainedExtra.push(cell);
        if (!held && isDefault)
            out.missingDefault.push(cell);
    }
    const liveByRole = new Map();
    for (const p of input.live) {
        if (!liveByRole.has(p.roleKey))
            liveByRole.set(p.roleKey, new Set());
        liveByRole.get(p.roleKey).add(p.capabilityKey);
    }
    const forbiddenPrincipalHoldings = [];
    for (const principal of input.principals ?? []) {
        const effective = new Set(principal.directCapabilityKeys);
        for (const roleKey of principal.roleKeys)
            for (const k of liveByRole.get(roleKey) ?? [])
                effective.add(k);
        for (const capabilityKey of ownerPrincipalViolations(principal.roleKeys, effective)) {
            forbiddenPrincipalHoldings.push({ principalId: principal.principalId, capabilityKey });
        }
    }
    const drift = [
        ...forbiddenPrincipalHoldings.map((h) => ({ roleKey: `principal:${h.principalId}`, capabilityKey: h.capabilityKey, kind: "FORBIDDEN_PRINCIPAL_HOLDING" })),
        ...out.forbiddenPresent.map((c) => ({ ...c, kind: "FORBIDDEN_PRESENT" })),
        ...out.unexplainedExtra.map((c) => ({ ...c, kind: "UNEXPLAINED_EXTRA" })),
        ...out.missingDefault.map((c) => ({ ...c, kind: "MISSING_DEFAULT" })),
        ...out.adminGrantedMissing.map((c) => ({ ...c, kind: "ADMIN_GRANTED_MISSING" })),
        ...out.adminRevokedPresent.map((c) => ({ ...c, kind: "ADMIN_REVOKED_PRESENT" })),
    ];
    const freeze = (xs) => Object.freeze(xs.map((x) => Object.freeze(x)));
    return Object.freeze({
        forbiddenPresent: freeze(out.forbiddenPresent), explainedByAdminGrant: freeze(out.explainedByAdminGrant),
        explainedByAdminRevoke: freeze(out.explainedByAdminRevoke), unexplainedExtra: freeze(out.unexplainedExtra),
        missingDefault: freeze(out.missingDefault), adminGrantedMissing: freeze(out.adminGrantedMissing),
        adminRevokedPresent: freeze(out.adminRevokedPresent),
        forbiddenPrincipalHoldings: freeze(forbiddenPrincipalHoldings), drift: freeze(drift),
    });
}
//# sourceMappingURL=roleCapabilityAdministration.js.map