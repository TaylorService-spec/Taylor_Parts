"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasResolvedEntitlements = exports.capabilityKeysOf = void 0;
exports.resolveRoleEntitlements = resolveRoleEntitlements;
exports.resolveDirectEntitlements = resolveDirectEntitlements;
exports.postgresGrantConditions = postgresGrantConditions;
exports.authorizeEntitledResolvedAction = authorizeEntitledResolvedAction;
exports.authorizeOperationalAction = authorizeOperationalAction;
exports.authorizeResolvedOperationalAction = authorizeResolvedOperationalAction;
exports.resolveEntitledOperationalContext = resolveEntitledOperationalContext;
exports.postgresGrantConditionProvider = postgresGrantConditionProvider;
const capabilityAuthority_1 = require("./capabilityAuthority");
const contextualAuthorization_1 = require("./contextualAuthorization");
const conditionalEntitlement_1 = require("./conditionalEntitlement");
Object.defineProperty(exports, "capabilityKeysOf", { enumerable: true, get: function () { return conditionalEntitlement_1.capabilityKeysOf; } });
/**
 * Entitlements from Role grants, with the granting Role preserved.
 *
 * `capabilityKeysOf` of this result EQUALS `capabilitiesForRoleKeys(pool, tenantId, roleKeys)`.
 * That equality is the adoption contract: this resolver adds provenance, it does not restate policy.
 */
async function resolveRoleEntitlements(pool, tenantId, roleKeys, conditions = conditionalEntitlement_1.SHIPPED_GRANT_CONDITIONS) {
    const rows = await (0, capabilityAuthority_1.roleCapabilityGrants)(pool, tenantId, roleKeys);
    const grants = rows.map((r) => ({
        grantor: { kind: "ROLE", roleKey: r.roleKey }, capabilityKey: r.capabilityKey,
    }));
    return (0, conditionalEntitlement_1.entitlementsFrom)(grants, conditions);
}
/**
 * Entitlements from DIRECT Principal grants (AB3), the PRINCIPAL grantor kept, unexpired rows only.
 *
 * Since lane DX the runtime resolution (`resolveOperationalCapabilities`) composes these beside the Role grants on
 * every gate; this helper is the same composition for a caller holding only a principal id.
 */
async function resolveDirectEntitlements(pool, tenantId, principalId, conditions = conditionalEntitlement_1.SHIPPED_GRANT_CONDITIONS) {
    const rows = await (0, capabilityAuthority_1.principalCapabilityGrants)(pool, tenantId, principalId);
    const grants = rows.map((r) => ({
        grantor: { kind: "PRINCIPAL", principalId: r.principalId }, capabilityKey: r.capabilityKey,
    }));
    return (0, conditionalEntitlement_1.entitlementsFrom)(grants, conditions);
}
/**
 * The per-grant conditions this tenant holds in PostgreSQL.
 *
 * THE RELATION IS LIVE (migration 1762214400000, applied to nonprod 2026-09-24) and holds ZERO rows,
 * so this returns an EMPTY catalog for every tenant today -- provably the same catalog as
 * SHIPPED_GRANT_CONDITIONS, which is the whole of the zero-condition parity claim.
 *
 * A database that does NOT carry the relation makes this throw, and every caller must treat that as
 * a refusal, never as "no conditions exist": reading a missing condition store as "unconditioned"
 * would turn every conditioned grant into an unconditional one in one step.
 */
async function postgresGrantConditions(pool, tenantId) {
    return (0, conditionalEntitlement_1.grantConditionCatalogFromRows)(await (0, capabilityAuthority_1.grantConditionRows)(pool, tenantId));
}
/**
 * Decide one action for a context `resolveOperationalContext` already returned.
 *
 * BOTH authorities must agree. The flat capability set is the first boundary, unchanged; the
 * entitlement list is consulted only after it admits the caller. This model can therefore only ever
 * REFUSE somebody the previous model admitted — it has no way to admit somebody it refused.
 *
 * Every failure to CONSULT an authority — a dropped connection, a missing relation, an unreadable
 * stored condition — becomes CONTEXT_AUTHORITY_UNAVAILABLE. None of them becomes a pass.
 */
async function authorizeEntitledResolvedAction(pool, resolved, request, reader) {
    // The Owner's withheld cells can never enter a deployed decision, whatever the shipped catalog
    // grows to hold.
    (0, conditionalEntitlement_1.assertNoWithheldGrantConditions)(conditionalEntitlement_1.SHIPPED_GRANT_CONDITIONS);
    const tenantId = resolved.principalContext.tenantId;
    // LAZY AND MEMOIZED, here too. This entry point serves a caller holding only a principal context,
    // so it must re-resolve from the pool -- but it need not do so BEFORE the flat capability check
    // has admitted the caller, and it need not do so twice. `authorizeEntitledAction` invokes this at
    // most once, and only after step 1 of the Owner's order has passed. A failure to read propagates
    // into the decision as CONTEXT_AUTHORITY_UNAVAILABLE, exactly as it did when it was caught here.
    //
    // CONDITIONS FROM POSTGRESQL (2026-09-26). This entry point used to apply SHIPPED_GRANT_CONDITIONS
    // (empty) whatever the relation held -- once Administration can write conditions, ignoring them
    // here would let a conditioned grant decide as an unconditional one. It now reads the SAME stored
    // conditions every transport composes, asserting the withheld cells where they are read.
    //
    // BOTH GRANT SOURCES (lane DX): the Role grants AND the Principal's unexpired direct exceptions, each with its
    // own condition -- the same sources `resolveOperationalContext` resolved the flat set from. Re-resolving Roles
    // alone would report a direct-only key as "held, but nobody granted it" and refuse it (CAPABILITY_MISSING).
    let pending;
    const entitlements = () => (pending ??= (async () => {
        const conditions = await postgresGrantConditionProvider(pool)(tenantId);
        const [roles, direct] = await Promise.all([
            resolveRoleEntitlements(pool, tenantId, resolved.principalContext.heldRoleKeys, conditions),
            resolveDirectEntitlements(pool, tenantId, resolved.principalContext.uid, conditions),
        ]);
        return Object.freeze([...roles, ...direct]);
    })());
    const actor = Object.freeze({
        tenantId,
        principalId: resolved.principalContext.uid,
        // The runtime authority's own set, NOT the derived one: if the two ever disagree the decision
        // takes the intersection, which is the stricter answer.
        capabilities: resolved.capabilities,
        conditionallyHeld: resolved.conditionallyHeld,
        scopedHeld: resolved.scopedHeld,
        entitlements,
    });
    return (0, conditionalEntitlement_1.authorizeEntitledAction)(reader ?? (0, contextualAuthorization_1.postgresContextualReader)(pool), {
        actor, capabilityKey: request.capabilityKey, recordId: request.recordId, businessContext: request.businessContext,
    });
}
/** Re-exported from the pure model, which is where a gate site should import it from. */
var conditionalEntitlement_2 = require("./conditionalEntitlement");
Object.defineProperty(exports, "hasResolvedEntitlements", { enumerable: true, get: function () { return conditionalEntitlement_2.hasResolvedEntitlements; } });
/**
 * Decide one action for an actor the transport already resolved.
 *
 * The flat capability Set is still the FIRST boundary, inside `authorizeEntitledAction`, unchanged:
 * a caller without the key is refused CAPABILITY_MISSING having read nothing. With no condition on
 * any of this actor's entitlements -- the deployed state, `capability_grant_conditions` holding zero
 * rows -- the decision is ALLOWED via the unconditional entitlement with `contextEvaluated === false`
 * and ZERO context reads, which is byte-identical to `capabilities.has(key)`.
 *
 * `reader` exists so a test can count the context reads. In production it is the PostgreSQL reader
 * over the same pool the request is already using.
 */
function authorizeOperationalAction(reader, actor, request) {
    return (0, conditionalEntitlement_1.authorizeEntitledAction)(reader, {
        actor: {
            tenantId: actor.tenantId,
            principalId: actor.principalId,
            capabilities: actor.capabilities,
            conditionallyHeld: actor.conditionallyHeld,
            scopedHeld: actor.scopedHeld,
            entitlements: actor.entitlements,
        },
        capabilityKey: request.capabilityKey,
        recordId: request.recordId,
        businessContext: request.businessContext,
    });
}
/** The same decision for a caller holding the whole resolved context rather than a domain actor. */
function authorizeResolvedOperationalAction(reader, resolved, request) {
    return authorizeOperationalAction(reader, {
        tenantId: resolved.principalContext.tenantId,
        principalId: resolved.principalContext.uid,
        capabilities: resolved.capabilities,
        conditionallyHeld: resolved.conditionallyHeld,
        scopedHeld: resolved.scopedHeld,
        entitlements: resolved.entitlements,
    }, request);
}
/**
 * Resolve a context whose conditions come from the LIVE relation rather than the shipped catalog.
 *
 * THE DIFFERENCE IS ZERO TODAY and that is the point: `capability_grant_conditions` holds no rows,
 * so this produces exactly the entitlements `resolveOperationalContext` produces on its own. It is
 * here so that activating a condition is a governed INSERT plus a reviewed switch of the deployed
 * composition to this function -- not a schema change, not a redesign, and not something a caller
 * can do by passing an argument.
 *
 * IT FAILS CLOSED. A database without the relation throws out of `postgresGrantConditions`; neither
 * the provider nor this function catches it, because "the condition store could not be read" must
 * never resolve to "there are no conditions". The throw surfaces wherever the obligation is
 * discharged: out of this function when a gate site awaits the resolver, and as
 * CONTEXT_AUTHORITY_UNAVAILABLE when the decision path awaits it.
 */
async function resolveEntitledOperationalContext(reader, pool, input) {
    // ONE principal resolution, not two. This used to resolve the principal itself -- only to learn
    // the tenant the condition catalog needed -- and then hand the same input to
    // `resolveOperationalContext`, which resolved it all over again. The provider takes the tenant as
    // an argument instead, so the duplicate resolution is gone.
    const context = await (0, capabilityAuthority_1.resolveOperationalContext)(reader, pool, input, postgresGrantConditionProvider(pool));
    // AND THIS COMPOSITION DISCHARGES THE OBLIGATION EAGERLY, ON PURPOSE.
    //
    // Laziness is a performance property and the withheld-cell ruling is a safety property; where they
    // meet, the ruling wins. `postgresGrantConditionProvider` is the only code that can SEE a stored
    // row naming `reorder.purchaseOrder.read` or `.create`, and the Owner's guard says THIS FUNCTION
    // must reject such a store -- not some later gate site, and not only the gate sites that happen to
    // ask. So the resolver is awaited once, here, which is what makes `assertNoWithheldGrantConditions`
    // still throw out of the production resolver exactly as it did before.
    //
    // It costs nothing twice: the resolution is memoized on the context, so every gate site that goes
    // on to ask reads the stores ZERO further times. And it costs the DEPLOYED composition nothing at
    // all -- no composition sets `grantConditionSource` to POSTGRES, so the deployed path is
    // `resolveOperationalContext` with the SHIPPED provider, which stays fully lazy.
    await context.entitlements();
    return context;
}
/**
 * The PostgreSQL condition source, as a provider.
 *
 * Server composition, never a request field: `workforceHttp` selects it from
 * `deps.grantConditionSource`, which no deployed composition sets to POSTGRES.
 *
 * It asserts the Owner's withheld cells on every load, so a row naming
 * `reorder.purchaseOrder.read` or `.create` can never reach a deployed decision however it got into
 * the relation -- and it asserts them where the rows are READ, which is the only place that can see
 * them. It does not catch: an unreadable store fails closed.
 */
function postgresGrantConditionProvider(pool) {
    return async (tenantId) => {
        const conditions = await postgresGrantConditions(pool, tenantId);
        (0, conditionalEntitlement_1.assertNoWithheldGrantConditions)(conditions);
        return conditions;
    };
}
//# sourceMappingURL=entitledActionAuthority.js.map