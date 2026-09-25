// THE GOVERNED Role -> Capability AUTHORITY BASELINE.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// `eos_policy.role_capabilities` held 387 rows in nonprod when this baseline was established. Only
// 258 of them carried a
// `granted_by` of the form `migration:<id>`; the other 129 were written by governed operator
// commands (the Sample Company seed's grant reconcile, the Employee capability reconcile, an
// Owner-ruled reconcile run, and one Administration activation made by an admin Principal).
// Nothing in the repository recorded WHY those 129 existed, so "why does this Role hold this
// capability?" could only be answered from tribal memory, and the authority could not be rebuilt
// from the repository at all.
//
// The Owner's ruling was NOT to author 129 retrospective migrations. It was to establish a
// governed authority baseline: every grant classified as exactly ONE canonical reconstruction
// source, and a deterministic pipeline that rebuilds the whole authority from the repository.
//
// ════════════════════ THE FOUR CANONICAL SOURCES ════════════════════
//
//   MIGRATION_BACKED     An accepted policy migration's own INSERT produces the pair when the
//                        migration chain is replayed against a canonically seeded tenant. The
//                        migration file IS the declaration; nothing is transcribed here.
//   CANONICAL_CATALOG    No migration produces the pair. The in-repo Role catalog
//                        (access/compatibilityRoles.ts + access/governedBusinessRoles.ts) declares
//                        it, and the governed reconcile tool
//                        (eosOps/migration/inventoryCapabilityGrantMigration.ts) applied it.
//   NONPROD_ACTIVATION   Neither a migration nor the Role catalog declares the pair. It exists
//                        because an Owner-authorized ENVIRONMENT ACTIVATION was performed against
//                        nonprod through the governed Administration command. It is NOT global
//                        authority and must never be promoted into one.
//   FIXTURE_ONLY         A pair whose only reconstruction source is a test/demo fixture. MEASURED
//                        COUNT: ZERO. The 89 `sample-company-v2:rudy` rows are deliberately NOT
//                        filed here: the Sample Company script does not carry a Role->capability
//                        list of its own, it calls `reconcileInventoryCapabilityGrants`, whose
//                        grants are DERIVED from the Role catalog. The fixture supplied the actor
//                        and the Role scope, never the authority -- so the catalog, not the
//                        fixture, is their reconstruction source. Every one of those 89 rows is
//                        reproduced without the fixture by the pipeline below.
//   UNEXPLAINED          Present in the live database and backed by none of the above. Merely
//                        being present in nonprod is not evidence (Owner ruling AN2: DO NOT BLESS
//                        LIVE DRIFT). MEASURED COUNT: ZERO.
//
// A row may have SEVERAL supporting evidences and gets exactly ONE canonical source, assigned in
// the order above. 71 pairs are both produced by a migration replay AND declared by the Role
// catalog AND stamped in nonprod with a later reconcile actor; they are MIGRATION_BACKED, because
// the migration is what a clean rebuild uses to produce them. `observedGrantedBy` on each entry
// preserves the live stamp so the secondary evidence is never lost.
//
// ════════════════════ WHAT THE NUMBER MEANS AFTER RULING E ════════════════════
//
// This file now declares 413 pairs, and nonprod holds 387. That difference is NAMED, not drift.
//
// Owner ruling E: a governed capability/grant activation and the authority baseline that explains
// it MUST land as one change -- migration, baseline, migration-chain proof, rebuild-exactness
// proof, tests -- because the rebuild guard replays EVERY migration in `migrations/`, so a
// grant-bearing migration landed alone makes the rebuild produce rows the baseline does not declare
// and the guard reports MISSING DECLARATION. Migration 1762300800000 (the Owner-approved
// corrections, the edit-without-read reconciliation and Reporting Slice 1) therefore arrived
// together with its 26 rows here.
//
// So the baseline measures WHAT A DETERMINISTIC REBUILD OF THIS REPOSITORY PRODUCES. `deployment`
// in the JSON keeps the other question separately answerable: `measuredInNonprodTotal` 387,
// `notYetAppliedToNonprod` naming the one migration the deploy has not run. AN2 -- DO NOT BLESS
// LIVE DRIFT -- is untouched by this: drift is a row in the DATABASE that nothing in the repository
// explains, and this is the opposite, a row in the REPOSITORY the database has not run yet,
// attributable to exactly one migration and removable by its guarded down.
//
// ════════════════════ THE DETERMINISTIC REBUILD PIPELINE ════════════════════
//
//   A. Migration chain, every migration BEFORE `seedBoundaryMigration` (1761523200000).
//   B. Tenant row + `seedTenantPolicy` -- Objects, Fields, Roles, Object CRED, Workflows.
//      This is what the grant-bearing migrations read: 1761523200000 derives its grants from
//      `role_object_permissions`, which the seed writes from the Role catalog. A migration chain
//      run against an EMPTY database produces ZERO role_capabilities rows -- measured -- which is
//      why the seed sits between the phases rather than after them.
//   C. The remaining migrations -> every MIGRATION_BACKED pair, with matching `granted_by` stamps.
//   D. The governed reconcile tool over `GLOBAL_CATALOG_ACTIVATED_GRANTS` -> every
//      CANONICAL_CATALOG pair.
//   E. `NONPROD_ACTIVATED_CAPABILITY_GRANTS` -> the environment activation, applied ONLY when the
//      target is nonprod.
//
// Phases A-D are GLOBAL authority. Phase E is environment-specific and is a separate export with a
// separate applier, so an activation cannot be swept into a production grant list by accident
// (Owner ruling AN3). `assertNoEnvironmentActivationInGlobalAuthority` makes that structural.
//
// ════════════════════ WHAT THIS SUPERSEDES ════════════════════
//
// Two APPLIED migrations carry prose that is true about what that migration does and FALSE about
// the system now. Applied migration text is immutable and is NOT edited:
//
//   migrations/1761523200000_cred-capability-vocabulary-and-grant-preservation.sql:36
//     "The three workOrder.lifecycle.* and six workflowDefinition.* capabilities stay at ZERO
//      grants."
//   migrations/1761609600000_finance-administration-reorder-vocabulary.sql:43
//     "workOrder.lifecycle.dispatch / .cancel / .complete and every workflowDefinition.* stay at
//      ZERO."
//
// Both sentences describe the state those migrations left behind. Since then: the Wave 6 Owner
// activation put FIVE `workOrder.lifecycle.*` rows in nonprod (NONPROD_ACTIVATION below), and
// migration 1762128000000 granted `workflowDefinition.read` to admin and owner (MIGRATION_BACKED).
// A reader who takes either sentence as a statement about the system today reaches a wrong design
// premise -- that has already cost one lane. THIS FILE, not the migration prose, is the current
// statement of who holds a capability; the migration comments are historical records of a single
// migration's own effect.
import baseline from "./seed/roleCapabilityAuthorityBaseline.json";

export type CanonicalGrantSource =
  | "MIGRATION_BACKED"
  | "CANONICAL_CATALOG"
  | "NONPROD_ACTIVATION"
  | "FIXTURE_ONLY"
  | "UNEXPLAINED";

export interface AuthorityBaselineGrant {
  readonly roleKey: string;
  readonly capabilityKey: string;
  /** Exactly one canonical reconstruction source. */
  readonly source: CanonicalGrantSource;
  /** `migration:<id>`, `role-catalog`, or the ruling that authorized an activation. */
  readonly evidence: string;
  /** The live `granted_by` stamp at measurement time -- secondary evidence, never authority. */
  readonly observedGrantedBy: string;
}

export interface RoleCapabilityPair {
  readonly roleKey: string;
  readonly capabilityKey: string;
}

export class AuthorityBaselineError extends Error {}

const SUPPORTED_VERSION = 1;
if (baseline.version !== SUPPORTED_VERSION) {
  throw new AuthorityBaselineError(
    `roleCapabilityAuthorityBaseline.json is version ${baseline.version}; this module understands ${SUPPORTED_VERSION}`,
  );
}

const GRANTS: readonly AuthorityBaselineGrant[] = Object.freeze(
  (baseline.grants as AuthorityBaselineGrant[]).map((g) => Object.freeze({ ...g })),
);

/** Every classified grant in the baseline, role-key then capability-key ordered. */
export const AUTHORITY_BASELINE_GRANTS = GRANTS;

/** The measurement this baseline was established from. */
export const AUTHORITY_BASELINE_MEASURED_AT = baseline.measuredAt;
export const AUTHORITY_BASELINE_TENANT_KEY = baseline.tenantKey;

/**
 * THE TWO QUESTIONS, KEPT SEPARATE. `AUTHORITY_BASELINE_GRANTS` is what a deterministic rebuild of
 * this repository produces. These record what the live environment held when it was last measured
 * and which grant-bearing migrations the deploy has not run yet, so "what does nonprod hold RIGHT
 * NOW" never has to be inferred by subtracting one from the other in somebody's head.
 */
export const AUTHORITY_BASELINE_NONPROD_MEASURED_TOTAL: number = baseline.deployment.measuredInNonprodTotal;
export const AUTHORITY_BASELINE_NOT_YET_APPLIED_MIGRATIONS: readonly string[] =
  Object.freeze([...baseline.deployment.notYetAppliedToNonprod]);

/**
 * The migration whose replay needs a seeded tenant. Everything BEFORE it runs against the empty
 * database; the canonical policy seed runs; everything from it onward runs afterwards.
 */
export const SEED_BOUNDARY_MIGRATION = baseline.seedBoundaryMigration;

/** The migration ids that carry an `INSERT INTO role_capabilities`. */
export const GRANT_BEARING_MIGRATIONS: readonly string[] = Object.freeze([...baseline.grantBearingMigrations]);

const pairKey = (roleKey: string, capabilityKey: string): string => `${roleKey}\u0000${capabilityKey}`;

const bySource = (source: CanonicalGrantSource): readonly RoleCapabilityPair[] =>
  Object.freeze(
    GRANTS.filter((g) => g.source === source).map((g) => Object.freeze({ roleKey: g.roleKey, capabilityKey: g.capabilityKey })),
  );

/**
 * GLOBAL. Produced by replaying the accepted migration chain against a canonically seeded tenant.
 * Not enumerated as a decision -- enumerated as a RECORD of what the migrations produce, so the
 * rebuild guard can prove the migrations still produce exactly this.
 */
export const MIGRATION_BACKED_GRANTS = bySource("MIGRATION_BACKED");

/**
 * GLOBAL. No migration produces these; the Role catalog declares them and the governed reconcile
 * tool applied them. Each one is cross-checked against the live Role catalog by
 * `assertGlobalCatalogGrantsAreCatalogDeclared` -- if the catalog stops declaring one, this file
 * is wrong and the guard says so rather than the pair silently becoming unexplained.
 */
export const GLOBAL_CATALOG_ACTIVATED_GRANTS = bySource("CANONICAL_CATALOG");

/**
 * NONPROD-ONLY. Owner-authorized Wave 6 environment activation, applied through the governed
 * Administration command by the administering admin Principal
 * (`639c1970-dbdb-4bc0-af7c-118559151e2f`, external subject `ZVu3lHTP1NQhj0Am04zTAGou0dx1`) on
 * 2026-09-24 05:05:17-05:05:21Z.
 *
 * FIVE rows, not seven: `owner` is deliberately absent from all three keys. No migration anywhere
 * grants `workOrder.lifecycle.*` -- verified across the migration chain, where the five files that
 * mention those keys only INSERT INTO capabilities (vocabulary, migration 1761350400000 fixes the
 * metadata). The Role catalog does not declare them either, and must not: `ADMIN_ROLE.permissions`
 * composes the whole legacy permission catalog and `OWNER_PERMISSIONS` spreads `ADMIN_ROLE`, so a
 * catalog declaration on `admin` would manufacture an `owner` grant the ruling never made.
 *
 * THIS IS NOT GLOBAL AUTHORITY. It is never merged into the exports above.
 */
export const NONPROD_ACTIVATED_CAPABILITY_GRANTS = bySource("NONPROD_ACTIVATION");

/** MEASURED ZERO. Exported so "is anything fixture-only?" is answerable, not assumed. */
export const FIXTURE_ONLY_GRANTS = bySource("FIXTURE_ONLY");

/** MEASURED ZERO. A non-empty result here is a governance failure, not a category. */
export const UNEXPLAINED_GRANTS = bySource("UNEXPLAINED");

/**
 * The Role catalog declares these pairs and nonprod does NOT hold them. They are recorded so the
 * gap is visible and reviewable -- they are NOT authority, are NOT applied by the rebuild, and
 * must never be read as grants. The commonest cause is a governed reconcile run that was scoped to
 * a subset of Roles (the Sample Company seed scopes `roleKeys` to its manifest), so the catalog
 * moved ahead of the environment.
 */
export const CATALOG_DECLARED_NOT_ACTIVATED: readonly RoleCapabilityPair[] = Object.freeze(
  (baseline.catalogDeclaredNotActivated as RoleCapabilityPair[]).map((p) => Object.freeze({ ...p })),
);

/** GLOBAL authority: everything that is true independent of environment. */
export function globalAuthorityGrants(): readonly RoleCapabilityPair[] {
  return Object.freeze([...MIGRATION_BACKED_GRANTS, ...GLOBAL_CATALOG_ACTIVATED_GRANTS]);
}

/** GLOBAL authority plus the activations this one environment has been granted. */
export function nonprodAuthorityGrants(): readonly RoleCapabilityPair[] {
  return Object.freeze([...globalAuthorityGrants(), ...NONPROD_ACTIVATED_CAPABILITY_GRANTS]);
}

/**
 * AN5 -- "why does this Role have this capability?", answered without tribal history.
 * Returns undefined when the baseline does not declare the pair at all.
 */
export function explainGrant(roleKey: string, capabilityKey: string): AuthorityBaselineGrant | undefined {
  return GRANTS.find((g) => g.roleKey === roleKey && g.capabilityKey === capabilityKey);
}

export function countsBySource(): Readonly<Record<CanonicalGrantSource, number>> {
  const counts: Record<CanonicalGrantSource, number> = {
    MIGRATION_BACKED: 0, CANONICAL_CATALOG: 0, NONPROD_ACTIVATION: 0, FIXTURE_ONLY: 0, UNEXPLAINED: 0,
  };
  for (const g of GRANTS) counts[g.source] += 1;
  return Object.freeze(counts);
}

/**
 * FAIL CLOSED ON PROMOTION. An environment activation appearing anywhere in the global authority
 * is the failure mode AN3 names: a nonprod-only decision silently becoming a production grant.
 * Structural, not stylistic -- callers that build a production grant list call this first.
 */
export function assertNoEnvironmentActivationInGlobalAuthority(
  globalGrants: readonly RoleCapabilityPair[] = globalAuthorityGrants(),
  activations: readonly RoleCapabilityPair[] = NONPROD_ACTIVATED_CAPABILITY_GRANTS,
): void {
  const global = new Set(globalGrants.map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const promoted = activations.filter((p) => global.has(pairKey(p.roleKey, p.capabilityKey)));
  if (promoted.length > 0) {
    throw new AuthorityBaselineError(
      "environment-specific capability activation promoted into GLOBAL authority: " +
        promoted.map((p) => `${p.roleKey}/${p.capabilityKey}`).join(", ") +
        "; a nonprod activation is never global authority",
    );
  }
}

/**
 * FAIL CLOSED ON A LOST DECLARATION. Every CANONICAL_CATALOG pair must still be declared by the
 * Role catalog. The caller supplies the derivation (`deriveLegacyRoleGrants`) so this module stays
 * dependency-free and the check is provable against a synthetic catalog too.
 */
export function assertGlobalCatalogGrantsAreCatalogDeclared(
  catalogDerived: readonly RoleCapabilityPair[],
  declared: readonly RoleCapabilityPair[] = GLOBAL_CATALOG_ACTIVATED_GRANTS,
): void {
  const derived = new Set(catalogDerived.map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const orphaned = declared.filter((p) => !derived.has(pairKey(p.roleKey, p.capabilityKey)));
  if (orphaned.length > 0) {
    throw new AuthorityBaselineError(
      "baseline declares a CANONICAL_CATALOG grant the Role catalog no longer declares: " +
        orphaned.map((p) => `${p.roleKey}/${p.capabilityKey}`).join(", ") +
        "; the catalog is the reconstruction source -- fix the catalog or reclassify the grant",
    );
  }
}

/**
 * FAIL CLOSED ON A DIVERGENT ACTIVATION. The environment activation is NOT re-typed here: the
 * authorization record is `workOrderLifecycleGrantActivation.ts`'s
 * `WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS`, which is on the accepted lineage and already pinned by
 * `workOrderLifecycleActivation.test.mjs`. This decomposes each NONPROD_ACTIVATION capability key
 * back into (object, action) and proves the two records name the SAME set, so a sixth activated
 * row stays a single reviewed diff in one place rather than two lists drifting apart.
 *
 * The ruling is passed in rather than imported so this module stays a pure data module with no
 * command-layer dependency.
 */
export function assertActivationMatchesRuling(
  rulingGrants: readonly { readonly objectKey: string; readonly actionKey: string; readonly roleKey: string }[],
  activations: readonly RoleCapabilityPair[] = NONPROD_ACTIVATED_CAPABILITY_GRANTS,
): void {
  const decompose = (p: RoleCapabilityPair): string => {
    const segments = p.capabilityKey.split(".");
    if (segments.length < 2) {
      throw new AuthorityBaselineError(`activation capability key is not object-qualified: ${p.capabilityKey}`);
    }
    return `${segments[0]}|${segments[segments.length - 1]}|${p.roleKey}`;
  };
  const fromBaseline = [...activations].map(decompose).sort();
  const fromRuling = rulingGrants.map((g) => `${g.objectKey}|${g.actionKey}|${g.roleKey}`).sort();
  if (fromBaseline.length !== fromRuling.length || fromBaseline.some((v, i) => v !== fromRuling[i])) {
    throw new AuthorityBaselineError(
      "the NONPROD activation baseline and the Owner ruling's activation set disagree; baseline=[" +
        `${fromBaseline.join(", ")}] ruling=[${fromRuling.join(", ")}]`,
    );
  }
}

export interface AuthorityComparison {
  readonly missingDeclaration: readonly RoleCapabilityPair[];
  readonly unexplainedExtra: readonly RoleCapabilityPair[];
}

/**
 * CURRENT GOVERNED NONPROD AUTHORITY vs REBUILT NONPROD AUTHORITY.
 *
 *   missingDeclaration  the rebuild produced a pair the baseline does not declare -- something in
 *                       the environment or the chain grants authority nothing explains.
 *   unexplainedExtra    the baseline declares a pair the rebuild does not produce -- a declaration
 *                       no reconstruction source can actually deliver.
 */
export function compareAuthority(
  governed: readonly RoleCapabilityPair[],
  rebuilt: readonly RoleCapabilityPair[],
): AuthorityComparison {
  const g = new Set(governed.map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const r = new Set(rebuilt.map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const sort = (xs: RoleCapabilityPair[]): readonly RoleCapabilityPair[] =>
    Object.freeze(xs.sort((a, b) =>
      a.roleKey === b.roleKey ? a.capabilityKey.localeCompare(b.capabilityKey) : a.roleKey.localeCompare(b.roleKey)));
  return Object.freeze({
    missingDeclaration: sort(rebuilt.filter((p) => !g.has(pairKey(p.roleKey, p.capabilityKey))).map((p) => ({ ...p }))),
    unexplainedExtra: sort(governed.filter((p) => !r.has(pairKey(p.roleKey, p.capabilityKey))).map((p) => ({ ...p }))),
  });
}

/** `compareAuthority`, raising on any difference. The deterministic guard's single entry point. */
export function assertAuthorityRebuildMatches(
  governed: readonly RoleCapabilityPair[],
  rebuilt: readonly RoleCapabilityPair[],
): void {
  const { missingDeclaration, unexplainedExtra } = compareAuthority(governed, rebuilt);
  const show = (xs: readonly RoleCapabilityPair[]): string => xs.map((p) => `${p.roleKey}/${p.capabilityKey}`).join(", ");
  if (missingDeclaration.length > 0 || unexplainedExtra.length > 0) {
    throw new AuthorityBaselineError(
      `rebuilt authority does not match the governed baseline; MISSING DECLARATION (${missingDeclaration.length}): ` +
        `${show(missingDeclaration)}; UNEXPLAINED EXTRA (${unexplainedExtra.length}): ${show(unexplainedExtra)}`,
    );
  }
}
