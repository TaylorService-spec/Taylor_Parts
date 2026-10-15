"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONDITIONAL_ENTITLEMENT_MODEL = exports.ACTION_CONTEXT_POLICIES = exports.isWithheldConditionedCell = exports.WITHHELD_CONDITIONED_CELLS = void 0;
exports.requiresContext = requiresContext;
exports.authorizeContextualAction = authorizeContextualAction;
exports.authorizeResolvedAction = authorizeResolvedAction;
exports.actionContextRegistry = actionContextRegistry;
const contextualAuthorization_1 = require("./contextualAuthorization");
// The withheld-cell ruling and the outcome vocabulary are CANONICAL in grantConditionPolicy.ts and
// re-exported here, so this module's public surface is unchanged while the GRANT-level model
// (conditionalEntitlement.ts) no longer has to import this 271-line ACTION-level design to reach
// them. See that file's header for the lane this import cost.
const grantConditionPolicy_1 = require("./grantConditionPolicy");
var grantConditionPolicy_2 = require("./grantConditionPolicy");
Object.defineProperty(exports, "WITHHELD_CONDITIONED_CELLS", { enumerable: true, get: function () { return grantConditionPolicy_2.WITHHELD_CONDITIONED_CELLS; } });
Object.defineProperty(exports, "isWithheldConditionedCell", { enumerable: true, get: function () { return grantConditionPolicy_2.isWithheldConditionedCell; } });
/**
 * THE RUNTIME ACTIVATION BOUNDARY. Empty, deliberately.
 *
 * Every deployed composition resolves this registry, finds no policy for any capability any command
 * requires, and therefore behaves exactly as it did before this file existed. Wiring the seam is a
 * code change; conditioning an action is a policy change, and they are kept apart so the first can
 * be reviewed without arguing about the second.
 */
exports.ACTION_CONTEXT_POLICIES = Object.freeze(new Map());
// `WITHHELD_CONDITIONED_CELLS` is declared in grantConditionPolicy.ts and re-exported above. It is
// the Owner's ruling, not this module's: an action-level predicate on either Purchase Order cell
// would impose the technician's condition on all eleven read holders and all five create holders.
// `actionContextRegistry` below enforces it for EVERY registry, test registries included.
/**
 * WHY A ROLE-SELECTIVE CONDITION COULD NOT BE EXPRESSED, AND WHAT CLOSED IT.
 *
 * Recorded in code because the reason was structural and a future reader would otherwise rediscover
 * it by trying. The three inputs a grant-level condition needs, and where each one now is:
 *
 *   the condition itself        WAS: only in the TypeScript catalog, as Role.conditionsByPermission.
 *                               NOW: eos_policy.capability_grant_conditions, created by migration
 *                               1762214400000 and LIVE in nonprod. `role_capabilities` is still
 *                               (tenant_id, role_id, capability_id) with no condition column — the
 *                               condition lives in its own relation, never on the grant row.
 *   which Role granted the key  WAS: discarded by SELECT DISTINCT c.key.
 *                               NOW: capabilityAuthority.roleCapabilityGrants keeps the Role KEY, and
 *                               resolveOperationalContext carries the resulting entitlements onto
 *                               ResolvedOperationalContext beside the unchanged flat set.
 *   a per-grant evaluation slot WAS: absent — predicates attached to the ACTION, and authorizeAnyPath
 *                               unions paths for ONE actor, so an unconditioned path beside a
 *                               conditioned one allows every holder.
 *                               NOW: conditionalEntitlement.authorizeEntitledAction evaluates each
 *                               ENTITLEMENT separately, so Role A unconditional and Role B
 *                               conditional on the same key coexist.
 *
 * THE ACTION-LEVEL GAP IS NOT CLOSED, and is not meant to be: an action-level predicate still
 * constrains every holder of the key, which is why the two Purchase Order cells stay withheld from
 * THIS registry for good. `status` below describes the GRANT-level model, which is where the sentence
 * became sayable.
 */
exports.CONDITIONAL_ENTITLEMENT_MODEL = Object.freeze({
    status: "CLOSED_AT_GRANT_LEVEL",
    code: "CONDITIONAL_ENTITLEMENT_MODEL_GAP",
    /** What each of the three missing inputs was replaced by. Empty `missing` is the point. */
    missing: Object.freeze([]),
    closedBy: Object.freeze([
        "eos_policy.capability_grant_conditions (migration 1762214400000, applied 2026-09-24, 0 rows)",
        "capabilityAuthority.roleCapabilityGrants keeps the granting Role key",
        "conditionalEntitlement.authorizeEntitledAction evaluates one condition per ENTITLEMENT",
    ]),
    /** Still true, and deliberately so. */
    stillTrueOfActionLevelPolicies: Object.freeze([
        "predicates attach to the action; authorizeAnyPath unions paths for one actor",
    ]),
});
const decide = (allowed, outcome, contextEvaluated, predicate, detail) => Object.freeze({ allowed, outcome, predicate, detail, contextEvaluated });
/** Does this action declare a context policy at all? */
function requiresContext(capabilityKey, registry = exports.ACTION_CONTEXT_POLICIES) {
    return registry.has(capabilityKey);
}
const needsRecord = (policy) => policy.paths.some((path) => path.some((p) => p.kind === "RECORD_ASSIGNMENT"));
/**
 * Authorize one action for one already-resolved actor.
 *
 * ORDER, and every step of it is observable in the returned decision:
 *
 *   1  capability, from the effective set the runtime resolved. Refuses without reading anything.
 *   2  policy lookup. No policy -> ALLOWED, and no context authority is touched.
 *   3  record: required by the policy, supplied by the caller as an ID only, kind fixed by policy.
 *   4  the predicates, through the evaluator, on alternative paths.
 *
 * Nothing about the actor is caller-supplied: `capabilities` came from role_capabilities, the
 * Employee from employee_principal_links, eligibility/scope/assignment from their own tables.
 */
async function authorizeContextualAction(reader, request, registry = exports.ACTION_CONTEXT_POLICIES) {
    const { actor, capabilityKey } = request;
    // 1. CAPABILITY FIRST — before the registry is even consulted, so the refusal is byte-identical
    //    whether or not this action happens to be conditioned. A caller without authority learns only
    //    that they lack the capability.
    if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(capabilityKey)) {
        return decide(false, "CAPABILITY_MISSING", false, undefined, capabilityKey);
    }
    // 2. UNCONDITIONED STAYS UNCONDITIONED.
    const policy = registry.get(capabilityKey);
    if (!policy || policy.paths.length === 0)
        return decide(true, "ALLOWED", false);
    // 3. The record, when the policy needs one. A policy that asks about a record and is given none
    //    refuses; it does not fall through to "then it must be fine".
    let record;
    if (needsRecord(policy)) {
        if (!policy.recordKind) {
            return decide(false, "NOT_ASSIGNED", false, "RECORD_ASSIGNMENT", "policy declares no record kind");
        }
        if (typeof request.recordId !== "string" || request.recordId.trim() === "") {
            return decide(false, "NOT_ASSIGNED", false, "RECORD_ASSIGNMENT", "no record supplied");
        }
        record = { recordKind: policy.recordKind, recordId: request.recordId };
    }
    // 4. The context authority. A failure to ANSWER is a refusal, never an exception and never a pass.
    try {
        const decision = await (0, contextualAuthorization_1.authorizeAnyPath)(reader, {
            actor,
            capabilityKey,
            paths: policy.paths,
            record,
        });
        return decide(decision.allowed, decision.reason, true, decision.predicate, decision.detail);
    }
    catch {
        return decide(false, "CONTEXT_AUTHORITY_UNAVAILABLE", true, undefined, "the contextual authority could not be consulted");
    }
}
/**
 * The same decision, for a caller holding what `resolveOperationalContext` returned.
 *
 * This is the shape the five EOS transports already have in hand after
 * `resolveOperationalContext(deps.reader, deps.pool, ...)`, so adopting the seam in a transport or
 * kernel is one call and no new resolution.
 */
async function authorizeResolvedAction(db, resolved, request, registry = exports.ACTION_CONTEXT_POLICIES) {
    const actor = {
        tenantId: resolved.principalContext.tenantId,
        principalId: resolved.principalContext.uid,
        capabilities: resolved.capabilities,
    };
    return authorizeContextualAction((0, contextualAuthorization_1.postgresContextualReader)(db), { ...request, actor }, registry);
}
/**
 * Build a registry. Exists so a test — or a future governed activation step — supplies policies
 * explicitly rather than mutating the shipped one, which is frozen and must stay empty until an
 * action is activated on its own evidence.
 */
function actionContextRegistry(policies) {
    const map = new Map();
    for (const policy of policies) {
        if ((0, grantConditionPolicy_1.isWithheldConditionedCell)(policy.capabilityKey)) {
            // Not advice. A cell the Owner withheld cannot be registered by anybody, including a test that
            // thought it was only proving a shape.
            throw new Error(`${policy.capabilityKey} is a WITHHELD conditioned cell and may not carry an action-level policy`);
        }
        map.set(policy.capabilityKey, policy);
    }
    return Object.freeze(map);
}
//# sourceMappingURL=contextualActionAuthority.js.map