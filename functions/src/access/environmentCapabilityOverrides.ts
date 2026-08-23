// Per-environment capability activation -- backend resolver
// (per-environment-capability-activation-spec.md, Owner-directed 2026-08-14).
//
// The sales/fulfillment/finance spine (11 capabilities) is registered
// `active:false` in permissionCatalog.ts -- a hard, fail-closed DENY for
// every principal in every environment. This module is the ONLY thing that
// lifts that blanket deny, and only for a non-production environment that
// explicitly declares the capability in config/environments.json. Production
// is NEVER activatable through this path (see the triple hard-block below).
//
// PURE + dependency-free decision core (`resolveCapabilityOverrides`), mirrored
// on the frontend by scripts/resolveEnvironment.mjs's build-time projection --
// same rule, two runtimes, kept honest by parity tests (matching this repo's
// "duplicate small glue, no shared/monorepo tooling" convention).
//
// TRIPLE PRODUCTION HARD-BLOCK (defense in depth):
//   1. Data      -- no `role:"production"` env carries capabilityActivationOverrides
//                   (asserted by scripts/environmentArchitecture.test.mjs).
//   2. Code      -- role === "production" returns EMPTY unconditionally here,
//                   ignoring registry data entirely (keyed on ROLE, mirroring
//                   resolveEnvironment.mjs's isProductionEnvironment).
//   3. Eligible  -- the result is intersected with SPINE_OVERRIDE_ELIGIBLE_IDS,
//                   so a careless environments.json edit cannot sweep in an
//                   unrelated active:false capability.
// The resolver itself adds a fourth: an omitted/empty set is a strict no-op.
import type { PermissionId } from "../types/access";

// The exact 13 spine capability ids eligible for per-environment activation
// (spec §31). This is a hardcoded allow-list, NOT read from the registry: it
// bounds what ANY environment can possibly activate, so registry data can only
// ever be a subset of a known-safe set. Excluded on purpose (stay active:false
// even in sandbox): workOrder.parts.plan, admin.credentialReset.initiate,
// report.*, coverage.*, inventory.catalog.manage, inventory.catalog.activate --
// separate workstreams. `inventory.catalog.read` is a deliberate, narrow
// exception (Wave 6 Owner Decision, 2026-08-15): a trusted READ-only projection
// (functions/src/partMaster/manufacturerReadService.ts), never the write/
// activate authority Part Master's own governance track still owns.
export const SPINE_OVERRIDE_ELIGIBLE_IDS: ReadonlySet<PermissionId> = new Set<PermissionId>([
  "opportunity.write",
  "opportunity.read",
  "opportunity.createSalesOrder",
  "salesOrder.read",
  "salesOrder.write",
  "salesOrder.fulfill",
  "salesOrder.service",
  "finance.invoice.issue",
  "finance.payment.apply",
  "finance.adjustment.record",
  "finance.read",
  "finance.refund.record",
  "inventory.catalog.read",
  // WAVE 7 (Owner-authorized sandbox activation). Eligible so the Wave 7 package is
  // exercisable in platform-sandbox at all: without these, #1001's parts-planning UI and
  // #1019's CRM Activity surface are permanently denied and there is nothing to validate.
  // The exclusion note above named workOrder.parts.plan as a separate workstream; that was
  // true until this decision, and it is corrected here rather than left to contradict the list.
  //
  // ELIGIBILITY IS NOT ACTIVATION, AND NEITHER IS AUTHORIZATION. This set only bounds what an
  // environment MAY activate; config/environments.json decides what it DOES activate, and a
  // principal still needs a qualifying Role grant on top. Production stays triple-blocked:
  // role-keyed resolution, no override key on any production environment, and a test asserting it.
  // create and read stay separate ids so a future read-only grant remains possible.
  "workOrder.parts.plan",
  "crm.activity.create",
  "crm.activity.read",
  // Consolidated sandbox promotion: the read/command families the E2E matrix exercises. Same
  // posture as every id above -- eligibility bounds what an environment MAY activate; the registry
  // decides what it DOES; a principal still needs a qualifying Role grant. Production stays
  // triple-blocked (role-keyed resolution, no override key on any production entry, asserted).
  "fulfillment.coordinatedVisit.read",
  "inventory.serializedAsset.read",
  "inventory.location.display.read",
  "inventory.transfer.create",
  "inventory.transfer.dispatch",
  "inventory.transfer.receive",
  "inventory.transfer.cancel",
  "inventory.cycleCount.create",
  "inventory.cycleCount.submit",
  "inventory.cycleCount.reconcile",
  "inventory.cycleCount.cancel",
  // SCANNER PROMOTION. The six capabilities the scanner program added, made ELIGIBLE so the sandbox
  // can exercise them at all -- without these, put-away, pick, bin administration, returns intake
  // and every lookup read are permanently denied and there is nothing to validate.
  //
  // Same posture as every id above, and worth restating because it is the whole safety argument:
  // ELIGIBILITY IS NOT ACTIVATION, AND NEITHER IS AUTHORIZATION. This set only bounds what an
  // environment MAY activate; config/environments.json decides what it DOES activate; and a
  // principal still needs a qualifying Role grant on top of both. Production stays triple-blocked --
  // role-keyed resolution returns EMPTY for production regardless of data, no production entry
  // carries an override key, and a test asserts it.
  //
  // inventory.stock.receive is deliberately ABSENT. It is not active:false and needs no override,
  // and widening who may accept stock remains the separately deferred decision it already was.
  "inventory.catalog.alias.read",
  "inventory.balance.read",
  "inventory.location.bin.manage",
  "inventory.location.bin.read",
  "inventory.placement.record",
  "inventory.returns.intake",
]);

const EMPTY: ReadonlySet<PermissionId> = new Set<PermissionId>();

// Minimal shape this module reads from the environment registry. Deliberately
// structural (not the full registry type): only role, project identity, and the
// override declaration matter to the activation decision.
export interface ActivationRegistryEnv {
  readonly role?: unknown;
  readonly firebase?: { readonly projectId?: unknown } | null;
  readonly capabilityActivationOverrides?: unknown;
}
export interface ActivationRegistry {
  readonly environments?: readonly ActivationRegistryEnv[];
}

/**
 * Resolve the set of spine capability ids that the environment owning
 * `projectId` activates despite their catalog active:false. PURE: no I/O,
 * no process access -- the caller supplies the registry and the project id.
 *
 * Fail-closed at every branch:
 *  - missing/empty projectId          -> EMPTY
 *  - projectId not in the registry    -> EMPTY (unknown env)
 *  - env.role === "production"        -> EMPTY unconditionally (ignores data)
 *  - otherwise                        -> declared overrides ∩ eligible set
 */
export function resolveCapabilityOverrides(
  registry: ActivationRegistry | null | undefined,
  projectId: string | null | undefined,
): ReadonlySet<PermissionId> {
  if (typeof projectId !== "string" || projectId.length === 0) return EMPTY;
  const environments = registry?.environments;
  if (!Array.isArray(environments)) return EMPTY;

  const env = environments.find(
    (e) => typeof e?.firebase?.projectId === "string" && e.firebase.projectId === projectId,
  );
  if (!env) return EMPTY;

  // Hard-block #2: role-keyed. A production environment yields EMPTY no matter
  // what its registry entry says -- the block does not trust the data.
  if (env.role === "production") return EMPTY;

  const declared = Array.isArray(env.capabilityActivationOverrides)
    ? env.capabilityActivationOverrides
    : [];
  const result = new Set<PermissionId>();
  for (const id of declared) {
    // Hard-block #3: intersect with the eligible allow-list.
    if (typeof id === "string" && SPINE_OVERRIDE_ELIGIBLE_IDS.has(id as PermissionId)) {
      result.add(id as PermissionId);
    }
  }
  return result;
}

// Runtime registry SNAPSHOT that ships INSIDE the Functions deploy bundle.
//
// Why a snapshot and not a read of config/environments.json: only the
// `functions/` directory is uploaded on deploy (firebase.json functions.source),
// so the repo-root registry is unreachable from the deployed runtime. This is a
// minimal projection -- role + projectId + override declaration only -- and its
// exact agreement with the canonical registry is CI-enforced by
// functions/test/environmentCapabilityOverrides.test.mjs. Drift fails the build.
export const ENVIRONMENT_ACTIVATION_REGISTRY: ActivationRegistry = Object.freeze({
  environments: Object.freeze([
    Object.freeze({ role: "sandbox", firebase: Object.freeze({ projectId: null }) }),
    Object.freeze({
      role: "sandbox",
      firebase: Object.freeze({ projectId: "eos-platform-sandbox" }),
      capabilityActivationOverrides: Object.freeze([
        "opportunity.write",
        "opportunity.read",
        "opportunity.createSalesOrder",
        "salesOrder.read",
        "salesOrder.write",
        "salesOrder.fulfill",
        "salesOrder.service",
        "finance.invoice.issue",
        "finance.payment.apply",
        "finance.adjustment.record",
        "finance.read",
        "finance.refund.record",
        "inventory.catalog.read",
        // Wave 7 Owner-authorized sandbox activation. This embedded snapshot ships in the
        // Functions deploy bundle (config/environments.json does not), so it must be kept in
        // step with the canonical registry -- a drift guard test asserts exactly that.
        "workOrder.parts.plan",
        "crm.activity.create",
        "crm.activity.read",
        // Consolidated sandbox promotion. This snapshot ships in the Functions bundle
        // (config/environments.json does not); a drift guard asserts it matches the registry.
        "fulfillment.coordinatedVisit.read",
        "inventory.serializedAsset.read",
        "inventory.location.display.read",
        "inventory.transfer.create",
        "inventory.transfer.dispatch",
        "inventory.transfer.receive",
        "inventory.transfer.cancel",
        "inventory.cycleCount.create",
        "inventory.cycleCount.submit",
        "inventory.cycleCount.reconcile",
        "inventory.cycleCount.cancel",
        // SCANNER PROMOTION. Mirrors config/environments.json's platform-sandbox entry, which is the
        // canonical source; a parity test fails if this snapshot and that file ever disagree.
        "inventory.catalog.alias.read",
        "inventory.balance.read",
        "inventory.location.bin.manage",
        "inventory.location.bin.read",
        "inventory.placement.record",
        "inventory.returns.intake",
      ]),
    }),
    // CERTIFICATION WORLD EMULATOR. Owner-approved 2026-08-22.
    //
    // demo-certworld is not a Firebase project and cannot become one: the demo- prefix is reserved
    // by the emulator suite, so an Admin SDK pointed at it is talking to localhost or to nothing.
    // This entry therefore cannot widen access to any deployed environment, whatever it declares.
    //
    // WHY IT HAD TO EXIST. inventory.transfer.*, inventory.cycleCount.* and inventory.returns.intake
    // are all registered active:false, which the resolver denies AHEAD of any Role grant. With no
    // registry entry the certification emulator resolved EMPTY overrides, so every one of those
    // capabilities denied for every employee, always -- and the only ways to run a real transfer
    // test were to hand-feed an override set from fixture code or to stub the authorize callback.
    // Both are the same lie told at different depths.
    //
    // EXACT KEY, NEVER A PREFIX. `demo-foo` inherits nothing from this entry; the lookup is a
    // string equality against projectId and there is no pattern matching anywhere in the resolver.
    //
    // NARROWER THAN SANDBOX ON PURPOSE. eos-platform-sandbox activates 33 ids across Sales, Finance,
    // CRM and the scanner; this activates the 9 the Pass 3 workflows actually exercise. Activation
    // is not a wish list, and a certification environment that quietly held broader authority than
    // it needed would be a worse model of the sandbox, not a better one.
    Object.freeze({
      // ROLE IS A GOVERNED THREE-VALUE ENUM -- sandbox | integration | production. An earlier
      // version of this entry invented "certification", which the deployment-drift registry guard
      // rejected: the word describes what this environment is FOR, and that belongs in its id and
      // purpose, not in a vocabulary another contract validates against.
      role: "sandbox",
      firebase: Object.freeze({ projectId: "demo-certworld" }),
      capabilityActivationOverrides: Object.freeze([
        "inventory.transfer.create",
        "inventory.transfer.dispatch",
        "inventory.transfer.receive",
        "inventory.transfer.cancel",
        "inventory.cycleCount.create",
        "inventory.cycleCount.submit",
        "inventory.cycleCount.reconcile",
        "inventory.cycleCount.cancel",
        "inventory.returns.intake",
      ]),
    }),
    Object.freeze({ role: "integration", firebase: Object.freeze({ projectId: null }) }),
    // taylor-parts-production: role "production", NO capabilityActivationOverrides
    // key -- both the data (absence) and the code (role-keyed) block it.
    Object.freeze({ role: "production", firebase: Object.freeze({ projectId: "taylor-parts" }) }),
  ]) as readonly ActivationRegistryEnv[],
});

let cachedOverrides: ReadonlySet<PermissionId> | null = null;

/**
 * The activation override set for the CURRENTLY DEPLOYED project, derived from
 * the Functions runtime's own trusted project identity (`GCLOUD_PROJECT`, auto-
 * populated by the platform -- never client-supplied, so it cannot be spoofed).
 * Cached at cold start: the deployed project cannot change within a runtime.
 */
export function resolveRuntimeCapabilityOverrides(): ReadonlySet<PermissionId> {
  if (cachedOverrides) return cachedOverrides;
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
  cachedOverrides = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
  return cachedOverrides;
}

// Test-only: reset the cold-start cache so a test can exercise different
// GCLOUD_PROJECT values in one process. Never called by production code.
export function __resetRuntimeCapabilityOverridesCacheForTest(): void {
  cachedOverrides = null;
}
