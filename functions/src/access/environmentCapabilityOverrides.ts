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

// The exact 11 spine capability ids eligible for per-environment activation
// (spec §31). This is a hardcoded allow-list, NOT read from the registry: it
// bounds what ANY environment can possibly activate, so registry data can only
// ever be a subset of a known-safe set. Excluded on purpose (stay active:false
// even in sandbox): workOrder.parts.plan, admin.credentialReset.initiate,
// report.*, coverage.*, equipment.* -- separate workstreams.
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
