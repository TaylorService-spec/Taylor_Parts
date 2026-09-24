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
  roleCapabilityGrants,
  type ResolvedOperationalContext,
} from "./capabilityAuthority";
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
 * INERT: no migration creates `eos_policy.capability_grant_conditions` this Wave, so this throws
 * against a currently-migrated database and every caller must treat that as a refusal, never as
 * "no conditions exist". It is exercised against a database created from
 * PROPOSED_GRANT_CONDITION_SCHEMA so the reader and the schema are proved together.
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
  let entitlements: EntitlementSet;
  try {
    entitlements = await resolveRoleEntitlements(
      pool, tenantId, resolved.principalContext.heldRoleKeys, SHIPPED_GRANT_CONDITIONS);
  } catch {
    return Object.freeze({
      allowed: false, outcome: "CONTEXT_AUTHORITY_UNAVAILABLE" as const,
      detail: "entitlements could not be resolved", contextEvaluated: false,
      viaGrantor: null, viaCondition: false, denials: Object.freeze([]),
    });
  }
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
