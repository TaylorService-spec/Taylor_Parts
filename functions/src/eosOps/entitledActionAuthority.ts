// THE ENTITLED ACTION SEAM — the composition that turns PostgreSQL grant rows into provenance-
// bearing entitlements and decides one action against them.
//
// Three files, three jobs, and they stay apart:
//
//   capabilityAuthority.ts      ALL eos_policy SQL. Grants, with the grantor kept.
//   conditionalEntitlement.ts   The PURE model: what an entitlement is, what a condition is, and
//                               how a decision is reached. No database, testable on its own.
//   THIS FILE                   The composition, and the ONLY production entry point.
//
// ════════════════════ THE PRODUCTION PATH IS THE WITHHOLDING ════════════════════
//
// `authorizeEntitledResolvedAction` takes NO condition catalog. It uses SHIPPED_GRANT_CONDITIONS,
// which is empty and frozen, and asserts that catalog names no WITHHELD cell before it decides
// anything. There is therefore no argument a caller can pass, and no row a database can hold, that
// activates `reorder.purchaseOrder.read` or `.create` through this function. Activating a grant
// condition is an edit to the shipped catalog — a reviewed code change — exactly as activating an
// action policy is an edit to ACTION_CONTEXT_POLICIES.
//
// A test may build its own catalog and call the PURE decision directly. That is expressing the
// model, which is this lane's deliverable; it reaches no deployed command.
import type { Pool, PoolClient } from "pg";
import {
  grantConditionRows,
  principalCapabilityGrants,
  resolveOperationalContext,
  roleCapabilityGrants,
  type GrantConditionProvider,
  type ResolvedOperationalContext,
} from "./capabilityAuthority";
// No `resolvePrincipalContext` import any more: this module used to resolve the principal itself,
// only to learn the tenant its condition catalog needed, and then hand the same input to
// `resolveOperationalContext`, which resolved it a second time. The condition PROVIDER takes the
// resolved tenant as an argument instead, so there is exactly one principal resolution per request.
import type { ResolveContextInput } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { postgresContextualReader, type ContextualReader } from "./contextualAuthorization";
import {
  assertNoWithheldGrantConditions,
  authorizeEntitledAction,
  capabilityKeysOf,
  entitlementsFrom,
  grantConditionCatalogFromRows,
  SHIPPED_GRANT_CONDITIONS,
  type CapabilityGrant,
  type EntitledActionDecision,
  type EntitledActor,
  type EntitlementResolver,
  type EntitlementSet,
  type GrantConditionCatalog,
} from "./conditionalEntitlement";

/**
 * Entitlements from Role grants, with the granting Role preserved.
 *
 * `capabilityKeysOf` of this result EQUALS `capabilitiesForRoleKeys(pool, tenantId, roleKeys)`.
 * That equality is the adoption contract: this resolver adds provenance, it does not restate policy.
 */
export async function resolveRoleEntitlements(
  pool: Pool,
  tenantId: string,
  roleKeys: readonly string[],
  conditions: GrantConditionCatalog = SHIPPED_GRANT_CONDITIONS,
): Promise<EntitlementSet> {
  const rows = await roleCapabilityGrants(pool, tenantId, roleKeys);
  const grants: CapabilityGrant[] = rows.map((r) => ({
    grantor: { kind: "ROLE", roleKey: r.roleKey }, capabilityKey: r.capabilityKey,
  }));
  return entitlementsFrom(grants, conditions);
}

/**
 * Entitlements from DIRECT Principal grants (AB3), resolved only when a caller asks.
 *
 * The operational runtime resolves capabilities from Roles alone today; folding these into the
 * effective set implicitly would widen access. Kept separate so a future direct-grant activation is
 * a deliberate composition, and so a direct grant can carry a condition the day one is needed
 * without any change here.
 */
export async function resolveDirectEntitlements(
  pool: Pool,
  tenantId: string,
  principalId: string,
  conditions: GrantConditionCatalog = SHIPPED_GRANT_CONDITIONS,
): Promise<EntitlementSet> {
  const rows = await principalCapabilityGrants(pool, tenantId, principalId);
  const grants: CapabilityGrant[] = rows.map((r) => ({
    grantor: { kind: "PRINCIPAL", principalId: r.principalId }, capabilityKey: r.capabilityKey,
  }));
  return entitlementsFrom(grants, conditions);
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
export async function postgresGrantConditions(pool: Pool, tenantId: string): Promise<GrantConditionCatalog> {
  return grantConditionCatalogFromRows(await grantConditionRows(pool, tenantId));
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
export async function authorizeEntitledResolvedAction(
  pool: Pool,
  resolved: ResolvedOperationalContext,
  request: { readonly capabilityKey: string; readonly recordId?: string },
  reader?: ContextualReader,
): Promise<EntitledActionDecision> {
  // The Owner's withheld cells can never enter a deployed decision, whatever the shipped catalog
  // grows to hold.
  assertNoWithheldGrantConditions(SHIPPED_GRANT_CONDITIONS);

  const tenantId = resolved.principalContext.tenantId;
  // LAZY AND MEMOIZED, here too. This entry point serves a caller holding only a principal context,
  // so it must re-resolve from the pool -- but it need not do so BEFORE the flat capability check
  // has admitted the caller, and it need not do so twice. `authorizeEntitledAction` invokes this at
  // most once, and only after step 1 of the Owner's order has passed. A failure to read propagates
  // into the decision as CONTEXT_AUTHORITY_UNAVAILABLE, exactly as it did when it was caught here.
  let pending: Promise<EntitlementSet> | undefined;
  const entitlements: EntitlementResolver = () => (pending ??= resolveRoleEntitlements(
    pool, tenantId, resolved.principalContext.heldRoleKeys, SHIPPED_GRANT_CONDITIONS));
  const actor: EntitledActor = Object.freeze({
    tenantId,
    principalId: resolved.principalContext.uid,
    // The runtime authority's own set, NOT the derived one: if the two ever disagree the decision
    // takes the intersection, which is the stricter answer.
    capabilities: resolved.capabilities,
    entitlements,
  });
  return authorizeEntitledAction(reader ?? postgresContextualReader(pool as unknown as Pick<PoolClient, "query">), {
    actor, capabilityKey: request.capabilityKey, recordId: request.recordId,
  });
}

/** The derived flat set, for a caller that wants to compare the two resolvers itself. */
export { capabilityKeysOf };

// ==================== THE RUNTIME SEAM ====================
//
// `resolveOperationalContext` already resolved this actor's entitlements -- provenance and all -- on
// the request path, for all five EOS transports. A gate site holding that context therefore needs no
// second resolution and no pool of its own to reach a CONDITIONAL decision: it needs this function.
//
// WHY THIS IS NOT `authorizeEntitledResolvedAction`. That function re-resolves entitlements from the
// pool with SHIPPED_GRANT_CONDITIONS, which is right for a caller that has only a principal context
// and wrong for a caller inside a request that already paid for the read. Both apply the SAME
// catalog; neither takes one from its caller, so neither can be handed a weaker policy.

/** The actor shape every one of the thirteen gate sites already has, plus the resolved entitlements. */
export interface OperationalActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
  /** The REQUIRED, request-scoped entitlement provider. Never an optional field, never a value. */
  readonly entitlements: EntitlementResolver;
}

/** Re-exported from the pure model, which is where a gate site should import it from. */
export { hasResolvedEntitlements } from "./conditionalEntitlement";

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
export function authorizeOperationalAction(
  reader: ContextualReader,
  actor: OperationalActor,
  request: { readonly capabilityKey: string; readonly recordId?: string },
): Promise<EntitledActionDecision> {
  return authorizeEntitledAction(reader, {
    actor: {
      tenantId: actor.tenantId,
      principalId: actor.principalId,
      capabilities: actor.capabilities,
      entitlements: actor.entitlements,
    },
    capabilityKey: request.capabilityKey,
    recordId: request.recordId,
  });
}

/** The same decision for a caller holding the whole resolved context rather than a domain actor. */
export function authorizeResolvedOperationalAction(
  reader: ContextualReader,
  resolved: ResolvedOperationalContext,
  request: { readonly capabilityKey: string; readonly recordId?: string },
): Promise<EntitledActionDecision> {
  return authorizeOperationalAction(reader, {
    tenantId: resolved.principalContext.tenantId,
    principalId: resolved.principalContext.uid,
    capabilities: resolved.capabilities,
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
export async function resolveEntitledOperationalContext(
  reader: PolicyReader,
  pool: Pool,
  input: ResolveContextInput,
): Promise<ResolvedOperationalContext> {
  // ONE principal resolution, not two. This used to resolve the principal itself -- only to learn
  // the tenant the condition catalog needed -- and then hand the same input to
  // `resolveOperationalContext`, which resolved it all over again. The provider takes the tenant as
  // an argument instead, so the duplicate resolution is gone.
  const context = await resolveOperationalContext(reader, pool, input, postgresGrantConditionProvider(pool));
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
export function postgresGrantConditionProvider(pool: Pool): GrantConditionProvider {
  return async (tenantId: string) => {
    const conditions = await postgresGrantConditions(pool, tenantId);
    assertNoWithheldGrantConditions(conditions);
    return conditions;
  };
}
