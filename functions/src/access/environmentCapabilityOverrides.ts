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
// PRODUCTION ADOPTION ELIGIBILITY (2C.6F). A SEPARATE, NARROWER allow-list than the spine set
// above, and deliberately not derived from it.
//
// Production adoption is higher-risk than sandbox activation, so a capability being registered --
// or even being sandbox-eligible -- must not make it production-adoptable. Every id here was named
// by an Owner ruling for production. There is NO prefix matching and no `report.*` wildcard: the
// fourteen deferred Reporting capabilities share the prefix and are absent on purpose, so a future
// catalog addition under any existing prefix is NOT silently production-adoptable.
//
// FIRST AND ONLY USE TODAY: Reporting SET 2 (5 entity/execution reads + 20 ordinary field reads).
// Deferred and therefore ABSENT: the 4 report.definition mutations (no saved-definition callable is
// deployed in production) and the 10 sensitive field reads (billingAddress, externalIds, notes,
// paymentTerms, taxStatus, accountOwner, contact email, contact phone, location accessNotes,
// equipment notes).
export const PRODUCTION_ACTIVATION_ELIGIBLE_IDS: ReadonlySet<PermissionId> = new Set<PermissionId>([
  "report.customer.read",
  "report.contact.read",
  "report.location.read",
  "report.equipment.read",
  "report.definition.read",
  "report.customer.field.name.read",
  "report.customer.field.status.read",
  "report.customer.field.relationshipTypes.read",
  "report.customer.field.tags.read",
  "report.customer.field.createdAt.read",
  "report.customer.field.commercialProfile.read",
  "report.customer.field.billingContact.read",
  "report.contact.field.name.read",
  "report.contact.field.role.read",
  "report.contact.field.customer.read",
  "report.location.field.name.read",
  "report.location.field.address.read",
  "report.location.field.customer.read",
  "report.equipment.field.name.read",
  "report.equipment.field.status.read",
  "report.equipment.field.identity.read",
  "report.equipment.field.dates.read",
  "report.equipment.field.customer.read",
  "report.equipment.field.location.read",
  "report.equipment.field.createdAt.read",
]);
export const SPINE_OVERRIDE_ELIGIBLE_IDS: ReadonlySet<PermissionId> = new Set<PermissionId>([
  // 2C.6C -- the REPORTING family. These were catalog `active: true`, which in this architecture
  // means LIVE IN EVERY ENVIRONMENT, production included: an override set can only ADD
  // activation, never remove it. Reporting ELIGIBILITY was ruled settled (admin holds the whole
  // family); production ACTIVATION was never reviewed, and runReportDefinitionCallable is already
  // deployed there. Registering them here, with the catalog flipped to `active: false`, is what
  // lets those two axes be answered separately instead of one implying the other.
  "report.customer.read",
  "report.customer.field.name.read",
  "report.customer.field.status.read",
  "report.customer.field.relationshipTypes.read",
  "report.customer.field.billingAddress.read",
  "report.customer.field.tags.read",
  "report.customer.field.externalIds.read",
  "report.customer.field.createdAt.read",
  "report.customer.field.paymentTerms.read",
  "report.customer.field.taxStatus.read",
  "report.customer.field.commercialProfile.read",
  "report.customer.field.billingContact.read",
  "report.contact.read",
  "report.contact.field.name.read",
  "report.contact.field.email.read",
  "report.contact.field.phone.read",
  "report.contact.field.role.read",
  "report.contact.field.customer.read",
  "report.location.read",
  "report.location.field.name.read",
  "report.location.field.address.read",
  "report.location.field.customer.read",
  "report.equipment.read",
  "report.equipment.field.name.read",
  "report.equipment.field.status.read",
  "report.equipment.field.identity.read",
  "report.equipment.field.dates.read",
  "report.equipment.field.notes.read",
  "report.equipment.field.customer.read",
  "report.equipment.field.location.read",
  "report.equipment.field.createdAt.read",
  "report.definition.create",
  "report.definition.read",
  "report.definition.rename",
  "report.definition.duplicate",
  "report.definition.delete",
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
  // SALES AGREEMENT (Slice 4). Eligible so the commercial chain is exercisable in sandbox AT ALL:
  // WON -> Sales Order now REQUIRES an accepted Agreement, so without these the sales spine that is
  // already active here is unreachable — correct and unusable.
  //
  // THIS LIST IS LOAD-BEARING, not documentation. The registry entry alone activates nothing: the
  // resolver INTERSECTS the environment's declared overrides with this set, so a capability listed
  // in config/environments.json and in ENVIRONMENT_ACTIVATION_REGISTRY but missing here stays
  // denied. That is exactly what happened on first deploy — the four ids were in the registry and
  // not here, every persona resolved false, and the live check caught what a CLI "Deploy complete!"
  // never would have.
  //
  // Eligibility is not activation and neither is authorization: config/environments.json decides
  // what an environment DOES activate, and a principal still needs a qualifying Role grant.
  // Production stays triple-blocked — role-keyed resolution, no override key on any production
  // entry, and a test asserting its absence.
  "salesAgreement.create",
  "salesAgreement.updateDraft",
  "salesAgreement.accept",
  "salesAgreement.read",
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
  // SERIALIZED EQUIPMENT FORWARD LIFECYCLE. Owner-authorized 2026-08-23. Without eligibility these
  // two are permanently denied everywhere -- they are registered active:false, and the resolver
  // refuses an inactive permission AHEAD of any Role grant -- so the acquisition and install
  // authorities could be built, tested and merged and still never execute anywhere.
  //
  // THE THREE BLOCKS ARE UNCHANGED AND THIS IS ONLY THE FIRST OF THEM. Eligibility bounds what an
  // environment MAY activate; config/environments.json decides what it DOES (sandbox and the
  // certification emulator, nothing else); and a principal still needs a qualifying Role grant --
  // which for these two means inventorySerializedAssetAcquirer or equipmentInstaller, held
  // separately and by different people. Production stays triple-blocked: role-keyed resolution
  // returns EMPTY for production regardless of data, no production entry carries an override key,
  // and a test asserts both.
  //
  // The two ids are listed separately, and must stay separate, for the same reason the Roles are
  // separate: an environment that could activate one implicitly by activating the other would
  // dissolve the segregation at the environment layer after the Role layer had preserved it.
  "inventory.serializedAsset.acquire",
  "equipment.install",
  // FIN-004 CONSOLIDATED REACH. Owner-authorized 2026-09-01, for sandbox Owner review only.
  //
  // WHY ONLY THIS ONE. `finance.read` is the fact-family gate and is already activated here, but
  // FIN-004 requires a reach scope IN ADDITION — either alone reads nothing. Without a scope every
  // Financials surface in sandbox denies, which is correct and unreviewable. Consolidated is the
  // deliberate choice because the review covers the complete seeded Taylor + Ventana composition;
  // SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY are NOT made eligible merely because they
  // exist, and making one eligible later remains a separate decision.
  //
  // THIS IS NOT AN ADMIN BYPASS AND CREATES NO SHORTCUT. `admin` and `owner` already hold this
  // capability in their Role definitions; the only thing standing between them and reach was the
  // catalog's active:false, which is exactly what this list lifts and nothing else. Every principal
  // — admin included — still resolves through the one canonical FIN-004 resolver, and a Role that
  // does not hold the capability still resolves DENY noQualifyingGrant. No Role definition was
  // changed, and no grant was written.
  //
  // Production stays triple-blocked, unchanged: role-keyed resolution returns EMPTY for production
  // regardless of data, no production entry carries an override key, and a test asserts both.
  // Certification declares no overrides and is untouched.
  "finance.visibility.consolidated",
  // PERFORMANCE GOAL AUTHORITY. Eligible for environment activation; eligibility is not
  // activation and activation is not a grant. Present here so a registry entry for these ids is
  // POSSIBLE at all -- the intersection below is what stops a careless registry edit sweeping in
  // an unrelated capability.
  "performance.goal.read",
  "performance.goal.create",
  "performance.goal.approve",
  "performance.goal.supersede",
  "performance.goal.retire",
  // CERT-FIN-02 FINANCIAL POLICY (Owner ruling, financial-policy authority). Deployment-time
  // company accounting configuration.
  //
  // WHY THESE ARE HERE RATHER THAN `active: true` IN THE CATALOG. The Owner ruled the capabilities
  // activated; in this architecture a catalogued `active: true` means LIVE IN EVERY ENVIRONMENT,
  // production included, because an override set can only ADD activation and never remove it. That
  // is precisely the defect DECISIONS #166 corrected for the report.* family one day earlier. So
  // the catalog entries stay `active: false` and activation happens per environment through this
  // seam -- which is what "activate" means in this codebase. Production activation is a separate
  // ruling and this path cannot deliver it: production is triple-blocked above.
  //
  // ELIGIBILITY IS NOT ACTIVATION, AND NEITHER IS AUTHORIZATION. Being here only makes a registry
  // entry POSSIBLE. config/environments.json decides what an environment DOES activate, and a
  // principal still needs a qualifying Role grant on top of that.
  //
  // AND NEITHER BEATS THE LOCK. Once a profile is LOCKED the trusted command refuses mutation for
  // every principal including admin and owner, on stored state, inside the transaction -- so no
  // amount of activation here reaches a locked policy.
  "financialPolicy.profile.read",
  "financialPolicy.profile.configure",
]);

const EMPTY: ReadonlySet<PermissionId> = new Set<PermissionId>();

// Minimal shape this module reads from the environment registry. Deliberately
// structural (not the full registry type): only role, project identity, and the
// override declaration matter to the activation decision.
export interface ActivationRegistryEnv {
  /**
   * PRODUCTION ADOPTION (2C.6F). Exact PermissionIds this PRODUCTION environment has explicitly
   * adopted for use despite their catalog `active: false`.
   *
   * DELIBERATELY A DIFFERENT FIELD FROM `capabilityActivationOverrides`, not a widening of it.
   * That field's production hard-block is intentional defence in depth and is UNCHANGED: a
   * production environment still yields EMPTY from it no matter what its data says. This field
   * carries a different meaning -- not "an environment override" but "production has adopted
   * this governed capability" -- and is read by a different resolver with its own narrower
   * eligibility list.
   */
  readonly productionCapabilityActivations?: readonly unknown[] | null;
  readonly role?: unknown;
  readonly firebase?: { readonly projectId?: unknown } | null;
  readonly capabilityActivationOverrides?: unknown;
  /**
   * Whether this environment's operational evidence is synthetic, and therefore whether a trusted
   * Function may send it to the private model. Declared per environment in config/environments.json
   * and mirrored into the snapshot below. Anything other than literal `true` means no.
   */
  readonly privateAiSyntheticOperationalInterpretation?: unknown;
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

/**
 * May the environment owning `projectId` send operational evidence to the private model?
 *
 * This is a DATA CLASSIFICATION question, not a feature flag: it asks whether the work orders this
 * runtime can read are synthetic. Answering it wrongly does not degrade a feature, it sends real
 * customer facts to a model, so every branch below refuses and only an explicit `true` on a matched
 * non-production environment permits.
 *
 * PURE: no I/O, no process access -- the caller supplies the registry and the project id.
 *
 *  - missing/empty projectId          -> false
 *  - projectId not in the registry    -> false (an unknown environment is never trusted)
 *  - env.role === "production"        -> false unconditionally, ignoring what the data says
 *  - flag absent, or any value that
 *    is not literally `true`          -> false
 *
 * The production block is deliberately redundant with the registry data. Production declares false
 * AND is refused by role, so neither the data nor the code has to be trusted on its own.
 */
export function resolveSyntheticOperationalInterpretation(
  registry: ActivationRegistry | null | undefined,
  projectId: string | null | undefined,
): boolean {
  if (typeof projectId !== "string" || projectId.length === 0) return false;
  const environments = registry?.environments;
  if (!Array.isArray(environments)) return false;

  const env = environments.find(
    (e) => typeof e?.firebase?.projectId === "string" && e.firebase.projectId === projectId,
  );
  if (!env) return false;
  if (env.role === "production") return false;

  return env.privateAiSyntheticOperationalInterpretation === true;
}

// Runtime registry SNAPSHOT that ships INSIDE the Functions deploy bundle.
//
// Why a snapshot and not a read of config/environments.json: only the
// `functions/` directory is uploaded on deploy (firebase.json functions.source),
// so the repo-root registry is unreachable from the deployed runtime. This is a
// minimal projection -- role + projectId + override declaration only -- and its
// exact agreement with the canonical registry is CI-enforced by
// functions/test/environmentCapabilityOverrides.test.mjs. Drift fails the build.
// 2C.6C -- the reporting capabilities that were live in EVERY environment before the catalog moved
// to `active: false`. Spread into each NON-PRODUCTION environment below so this correction changes
// exactly one environment's behaviour: production's.
//
// PRODUCTION IS DELIBERATELY ABSENT. Its override set stays empty, so every id here resolves
// inactivePermission there -- BEFORE Role eligibility is consulted. Admin keeps all 39 report
// permissions and is denied all 39 in production. That is the distinction: eligibility is not
// activation, and `Admin can do all things` means admin is eligible for everything ACTIVE in the
// environment -- never that admin activates a family the environment has not adopted.
const REPORTING_PREVIOUSLY_ACTIVE_IDS: readonly PermissionId[] = Object.freeze([
  "report.customer.read",
  "report.customer.field.name.read",
  "report.customer.field.status.read",
  "report.customer.field.relationshipTypes.read",
  "report.customer.field.billingAddress.read",
  "report.customer.field.tags.read",
  "report.customer.field.externalIds.read",
  "report.customer.field.createdAt.read",
  "report.customer.field.paymentTerms.read",
  "report.customer.field.taxStatus.read",
  "report.customer.field.commercialProfile.read",
  "report.customer.field.billingContact.read",
  "report.contact.read",
  "report.contact.field.name.read",
  "report.contact.field.email.read",
  "report.contact.field.phone.read",
  "report.contact.field.role.read",
  "report.contact.field.customer.read",
  "report.location.read",
  "report.location.field.name.read",
  "report.location.field.address.read",
  "report.location.field.customer.read",
  "report.equipment.read",
  "report.equipment.field.name.read",
  "report.equipment.field.status.read",
  "report.equipment.field.identity.read",
  "report.equipment.field.dates.read",
  "report.equipment.field.notes.read",
  "report.equipment.field.customer.read",
  "report.equipment.field.location.read",
  "report.equipment.field.createdAt.read",
  "report.definition.create",
  "report.definition.read",
  "report.definition.rename",
  "report.definition.duplicate",
  "report.definition.delete",
  // CERT-FIN-02 financial policy, Owner ruling. This list is the SANDBOX activation set that ships
  // inside the Functions bundle (config/environments.json does not), and a drift guard asserts it
  // equals the canonical registry's. Only the sandbox: certification pins its own three-id set and
  // production carries no key at all.
  "financialPolicy.profile.read",
  "financialPolicy.profile.configure",
]);

export const ENVIRONMENT_ACTIVATION_REGISTRY: ActivationRegistry = Object.freeze({
  environments: Object.freeze([
    Object.freeze({ role: "sandbox", firebase: Object.freeze({ projectId: null }),
      privateAiSyntheticOperationalInterpretation: false }),
    Object.freeze({
      role: "sandbox",
      firebase: Object.freeze({ projectId: "eos-platform-sandbox" }),
      // The sandbox runs prod-derived work-order fixtures. Its purpose line in the canonical
      // registry says "synthetic data", but a purpose sentence describes an intention and this
      // flag governs whether customer facts may reach a model, so the flag does not follow it.
      privateAiSyntheticOperationalInterpretation: false,
      capabilityActivationOverrides: Object.freeze([
        // 2C.6C: preserves this environment's pre-existing Reporting posture, which came from
        // the catalog being active:true rather than from any deliberate activation here.
        ...REPORTING_PREVIOUSLY_ACTIVE_IDS,
        "opportunity.write",
        "opportunity.read",
        "opportunity.createSalesOrder",
        "salesAgreement.create",
        "salesAgreement.updateDraft",
        "salesAgreement.accept",
        "salesAgreement.read",
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
        // SERIALIZED EQUIPMENT FORWARD LIFECYCLE. Owner-authorized 2026-08-23, sandbox and the
        // certification emulator only. Mirrors config/environments.json, which is canonical.
        //
        // ACTIVATION IS NOT A GRANT. Both ids stay active:false in the catalog and neither is held
        // by any Role except through the two new stations (inventorySerializedAssetAcquirer,
        // equipmentInstaller). Listing them here removes the inactivePermission denial and nothing
        // else -- an employee with no matching Role still resolves DENY noQualifyingGrant, which is
        // asserted rather than assumed.
        "inventory.serializedAsset.acquire",
        "equipment.install",
        // FIN-004 CONSOLIDATED REACH for Owner review. Owner-authorized 2026-09-01, sandbox only.
        // Mirrors config/environments.json, which is canonical; the drift guard compares them.
        //
        // ACTIVATION IS NOT A GRANT, and here that distinction is load-bearing rather than
        // ceremonial: the capability stays active:false in the catalog, `admin` and `owner` already
        // hold it in their Role definitions, and lifting the inactive-permission denial is the only
        // effect. A Role that does not hold it still resolves DENY noQualifyingGrant.
        "finance.visibility.consolidated",
        // PERFORMANCE GOAL AUTHORITY, sandbox only. Mirrors config/environments.json, which is
        // canonical; the drift guard compares them.
        //
        // ACTIVATION IS NOT A GRANT. All five stay active:false in the catalog. Lifting the
        // inactive-permission denial is the ONLY effect: a principal whose Role does not carry the
        // verb still resolves DENY noQualifyingGrant, and the goal authority then asks three more
        // questions after that one -- the target's own scope, authority over the metric's actual,
        // and hierarchical visibility for an EMPLOYEE target. Activating these widens none of them.
        "performance.goal.read",
        "performance.goal.create",
        "performance.goal.approve",
        "performance.goal.supersede",
        "performance.goal.retire",
      ]),
    }),
    // DEPLOYABLE SYNTHETIC CERTIFICATION RUNTIME. Provisioned 2026-08-30.
    //
    // A real Firebase project, unlike demo-certworld -- which is why it is declared in
    // config/environments.json too, and why the drift guard compares it position for position.
    //
    // ACTIVATION IS NARROW AND OWNER-RULED, and the note above it used to say the opposite.
    //
    // It read "It activates NO capabilities ... nothing is deployed here yet, so an override set
    // would be a list of permissions for code that does not exist." That was true when the project
    // was empty. It is now factually stale: this environment holds a governed synthetic Firestore
    // world built from the certification-world fixture authority, and it has run the Purchasing and
    // Receiving ceremonies through the real product commands.
    //
    // What has NOT changed is the deployment posture. No Functions, no Hosting, no browser surface,
    // every readiness flag false, and privateAiSyntheticOperationalInterpretation false. The world
    // is exercised by BOUNDED REPOSITORY-OWNED OPERATOR TOOLS, not by a client -- so an activation
    // here opens a capability to a governed script acting as a named employee, and to nothing else.
    //
    // THREE IDS, AND DELIBERATELY NOT FOUR (Owner ruling CERT-CYCLE-11, 2026-09-02). The G07
    // ceremony opens a count, submits it, and reconciles it. It never cancels one, so
    // inventory.cycleCount.cancel stays inactive: certification authority is widened only as far as
    // the scenario requires, and an activation list is not a wish list. inventory.transfer.* and
    // inventory.returns.intake likewise remain separate future decisions, even though the
    // demo-certworld emulator entry below activates all three families together.
    //
    // THE CATALOG POSTURE IS UNCHANGED. permissionCatalog still registers every cycleCount id
    // active:false, and the resolver still denies an inactive permission ahead of any grant. This
    // per-environment override is the governed activation seam -- and it opens the family only;
    // WHO may perform each act is still decided by Role, which is why the Counter/Reconciler split
    // survives this change untouched.
    Object.freeze({
      role: "sandbox",
      firebase: Object.freeze({ projectId: "eos-platform-certification" }),
      privateAiSyntheticOperationalInterpretation: false,
      capabilityActivationOverrides: Object.freeze([
        "inventory.cycleCount.create",
        "inventory.cycleCount.submit",
        "inventory.cycleCount.reconcile",
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
    // NARROWER THAN SANDBOX ON PURPOSE. eos-platform-sandbox activates a far wider set across Sales,
    // Finance, CRM and the scanner; this activates only the ids the certification workflows exercise. Activation
    // is not a wish list, and a certification environment that quietly held broader authority than
    // it needed would be a worse model of the sandbox, not a better one.
    Object.freeze({
      // ROLE IS A GOVERNED THREE-VALUE ENUM -- sandbox | integration | production. An earlier
      // version of this entry invented "certification", which the deployment-drift registry guard
      // rejected: the word describes what this environment is FOR, and that belongs in its id and
      // purpose, not in a vocabulary another contract validates against.
      role: "sandbox",
      firebase: Object.freeze({ projectId: "demo-certworld" }),
      // The one environment permitted to send operational evidence to the private model. Its
      // data is seeded fixture data, and the demo- prefix is reserved by the emulator suite, so
      // this project cannot exist outside a local emulator and cannot hold customer records.
      privateAiSyntheticOperationalInterpretation: true,
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
        // Serialized equipment forward lifecycle, Owner-authorized 2026-08-23. The emulator gets the
        // same two ids as the sandbox because E01/E02 exercise the same commands here first.
        "inventory.serializedAsset.acquire",
        "equipment.install",
      ]),
    }),
    Object.freeze({ role: "integration", firebase: Object.freeze({ projectId: null }),
      privateAiSyntheticOperationalInterpretation: false }),
    // taylor-parts-production: role "production", NO capabilityActivationOverrides
    // key -- both the data (absence) and the code (role-keyed) block it.
    Object.freeze({ role: "production", firebase: Object.freeze({ projectId: "taylor-parts" }),
      // Declared false AND refused by role. Two independent blocks, so a future edit to
      // either one cannot open this on its own.
      privateAiSyntheticOperationalInterpretation: false,
      // 2C.6F -- the FIRST production capability adoption. Reporting SET 2: 25 of the 39 report.*
      // capabilities, named by Owner ruling. This is NOT capabilityActivationOverrides -- that field
      // stays absent here, and would be refused by role even if present.
      //
      // The other 14 report.* capabilities are ABSENT on purpose and resolve DENY/inactivePermission:
      // 4 definition mutations (no saved-definition callable is deployed in production) and 10
      // sensitive field reads. Admin stays ELIGIBLE for all 39 everywhere; this is only what
      // production has ADOPTED.
      productionCapabilityActivations: Object.freeze([
        "report.customer.read",
        "report.contact.read",
        "report.location.read",
        "report.equipment.read",
        "report.definition.read",
        "report.customer.field.name.read",
        "report.customer.field.status.read",
        "report.customer.field.relationshipTypes.read",
        "report.customer.field.tags.read",
        "report.customer.field.createdAt.read",
        "report.customer.field.commercialProfile.read",
        "report.customer.field.billingContact.read",
        "report.contact.field.name.read",
        "report.contact.field.role.read",
        "report.contact.field.customer.read",
        "report.location.field.name.read",
        "report.location.field.address.read",
        "report.location.field.customer.read",
        "report.equipment.field.name.read",
        "report.equipment.field.status.read",
        "report.equipment.field.identity.read",
        "report.equipment.field.dates.read",
        "report.equipment.field.customer.read",
        "report.equipment.field.location.read",
        "report.equipment.field.createdAt.read",
      ]) }),
  ]) as readonly ActivationRegistryEnv[],
});

let cachedOverrides: ReadonlySet<PermissionId> | null = null;

/**
 * The activation override set for the CURRENTLY DEPLOYED project, derived from
 * the Functions runtime's own trusted project identity (`GCLOUD_PROJECT`, auto-
 * populated by the platform -- never client-supplied, so it cannot be spoofed).
 * Cached at cold start: the deployed project cannot change within a runtime.
 */
/**
 * PRODUCTION ADOPTION RESOLVER (2C.6F). The production-only counterpart to
 * resolveCapabilityOverrides, kept as a separate function so that one's absolute production
 * refusal survives verbatim.
 *
 * Fails closed at every step, and the order matters:
 *  - missing/empty projectId        -> EMPTY
 *  - project not in the registry    -> EMPTY (an unknown environment adopts nothing)
 *  - env.role !== "production"      -> EMPTY (this field is INERT outside production, the mirror
 *                                     image of capabilityActivationOverrides being inert inside it)
 *  - malformed/absent declaration   -> EMPTY
 *  - id not in PRODUCTION_ACTIVATION_ELIGIBLE_IDS -> dropped
 *
 * Adoption is NOT eligibility. Everything this returns still has to pass Role membership, scope,
 * conditions and accessVersion in resolveEffectivePermission. Admin does not bypass activation,
 * and activation does not confer a grant.
 */
export function resolveProductionCapabilityActivations(
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
  // Mirror hard-block: this authority exists ONLY for production. A non-production environment
  // declaring it gets nothing, exactly as a production environment declaring
  // capabilityActivationOverrides gets nothing.
  if (env.role !== "production") return EMPTY;

  const declared = Array.isArray(env.productionCapabilityActivations)
    ? env.productionCapabilityActivations
    : [];
  const result = new Set<PermissionId>();
  for (const id of declared) {
    if (typeof id === "string" && PRODUCTION_ACTIVATION_ELIGIBLE_IDS.has(id as PermissionId)) {
      result.add(id as PermissionId);
    }
  }
  return result;
}
export function resolveRuntimeCapabilityOverrides(): ReadonlySet<PermissionId> {
  if (cachedOverrides) return cachedOverrides;
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
  // 2C.6F: the SINGLE place the two activation authorities are composed. Every runtime consumer
  // (eleven call sites: the effective-access feed, reporting execution and saved definitions,
  // reorder, finance, performance, cycle count, transfer, install, acquire, labor) reads activation
  // through THIS function, so composing here is what makes production adoption honoured
  // consistently without touching a single caller.
  //
  // Exactly one of the two can ever be non-empty for a given project, because each refuses the
  // other's role. The union is therefore a statement of intent, not an overlap to reason about.
  const nonProduction = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
  const production = resolveProductionCapabilityActivations(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
  cachedOverrides = production.size > 0 ? production : nonProduction;
  return cachedOverrides;
}

// Test-only: reset the cold-start cache so a test can exercise different
// GCLOUD_PROJECT values in one process. Never called by production code.
export function __resetRuntimeCapabilityOverridesCacheForTest(): void {
  cachedOverrides = null;
}
