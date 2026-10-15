"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENVIRONMENT_ACTIVATION_REGISTRY = exports.SPINE_OVERRIDE_ELIGIBLE_IDS = void 0;
exports.resolveCapabilityOverrides = resolveCapabilityOverrides;
exports.resolveRuntimeCapabilityOverrides = resolveRuntimeCapabilityOverrides;
exports.__resetRuntimeCapabilityOverridesCacheForTest = __resetRuntimeCapabilityOverridesCacheForTest;
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
exports.SPINE_OVERRIDE_ELIGIBLE_IDS = new Set([
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
]);
const EMPTY = new Set();
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
function resolveCapabilityOverrides(registry, projectId) {
    if (typeof projectId !== "string" || projectId.length === 0)
        return EMPTY;
    const environments = registry?.environments;
    if (!Array.isArray(environments))
        return EMPTY;
    const env = environments.find((e) => typeof e?.firebase?.projectId === "string" && e.firebase.projectId === projectId);
    if (!env)
        return EMPTY;
    // Hard-block #2: role-keyed. A production environment yields EMPTY no matter
    // what its registry entry says -- the block does not trust the data.
    if (env.role === "production")
        return EMPTY;
    const declared = Array.isArray(env.capabilityActivationOverrides)
        ? env.capabilityActivationOverrides
        : [];
    const result = new Set();
    for (const id of declared) {
        // Hard-block #3: intersect with the eligible allow-list.
        if (typeof id === "string" && exports.SPINE_OVERRIDE_ELIGIBLE_IDS.has(id)) {
            result.add(id);
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
exports.ENVIRONMENT_ACTIVATION_REGISTRY = Object.freeze({
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
            ]),
        }),
        Object.freeze({ role: "integration", firebase: Object.freeze({ projectId: null }) }),
        // taylor-parts-production: role "production", NO capabilityActivationOverrides
        // key -- both the data (absence) and the code (role-keyed) block it.
        Object.freeze({ role: "production", firebase: Object.freeze({ projectId: "taylor-parts" }) }),
    ]),
});
let cachedOverrides = null;
/**
 * The activation override set for the CURRENTLY DEPLOYED project, derived from
 * the Functions runtime's own trusted project identity (`GCLOUD_PROJECT`, auto-
 * populated by the platform -- never client-supplied, so it cannot be spoofed).
 * Cached at cold start: the deployed project cannot change within a runtime.
 */
function resolveRuntimeCapabilityOverrides() {
    if (cachedOverrides)
        return cachedOverrides;
    const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
    cachedOverrides = resolveCapabilityOverrides(exports.ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
    return cachedOverrides;
}
// Test-only: reset the cold-start cache so a test can exercise different
// GCLOUD_PROJECT values in one process. Never called by production code.
function __resetRuntimeCapabilityOverridesCacheForTest() {
    cachedOverrides = null;
}
//# sourceMappingURL=environmentCapabilityOverrides.js.map