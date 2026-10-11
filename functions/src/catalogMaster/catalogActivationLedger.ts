// THE CATALOG ACTIVATION DEPENDENCY LEDGER.
//
// Pure data plus derivations. It answers ONE question honestly: what still has to happen before the
// PostgreSQL Catalog authority can be activated, and WHO owns each of those things.
//
// ════════════════════ WHY A LEDGER RATHER THAN A ZERO ════════════════════
//
// The Catalog slice could reach "zero Firestore consumers" tomorrow by giving the Firebase Functions
// a PostgreSQL pool, or by having them call the Render Catalog API over HTTP. Both are forbidden,
// and for the same reason: they create MIXED RUNTIME AUTHORITY -- a business transaction half in
// Firestore and half in PostgreSQL, with no transaction spanning the two and no way to say which
// store was authoritative when they disagreed.
//
// So the consumers that cannot move without their own domain moving are RECORDED here instead of
// being bridged or hidden. Catalog is then truthfully BUILT and MIGRATION TOOLING READY, with
// activation blocked on named downstream migrations. That is a worse-sounding answer and a far
// better one than activating Parts and silently breaking Receiving, Cycle Count and Sales Agreement.
//
// ════════════════════ SOURCE EXISTS IS NOT RUNTIME REACHABLE ════════════════════
//
// A legacy adapter file does not block activation merely by existing. What blocks activation is a
// DEPLOYED business operation that reaches it. `deployedReachable` is that distinction, and the
// companion suite derives it from the import graph rather than trusting this list.

/**
 * THE STANDING PROJECTION RULE, after PostgreSQL Catalog activation.
 *
 * An optional projection -- Part balance, AI readiness, any enrichment whose absence changes no
 * business truth -- has exactly two permitted behaviours:
 *
 *   1. consume the PostgreSQL Catalog, or
 *   2. report UNAVAILABLE, explicitly, where a person can see it.
 *
 * It may NOT keep reading the frozen or retired Firestore Catalog and present that as current truth.
 * There is NO stale-read compatibility period, and the reason is that a stale read is the only
 * failure here that looks like success: a screen showing last month's part names is indistinguishable
 * from a screen showing this month's, and the person reading it has no way to tell. An UNAVAILABLE
 * projection is a worse experience and an honest one.
 */
export const PROJECTION_RULE_AFTER_ACTIVATION = Object.freeze({
  permitted: Object.freeze(["CONSUME_POSTGRES_CATALOG", "REPORT_UNAVAILABLE"] as const),
  forbidden: Object.freeze(["READ_FROZEN_FIRESTORE_CATALOG"] as const),
  staleReadCompatibilityPeriod: false,
} as const);

/**
 * THE ACTIVATION DISPOSITION VOCABULARY (Owner ruling, Lane 2).
 *
 * After Catalog activation, NO active deployed operation may use Firestore `parts`, `part_aliases` or
 * `equipment_models` as CURRENT BUSINESS TRUTH. This applies to READS exactly as it applies to writes,
 * which is the half that is easy to forget: a frozen collection cannot be written wrongly, so a freeze
 * feels like enough, and the stale READ then survives the cutover looking exactly like a correct one.
 *
 * Every ledger entry therefore carries a `disposition` from this closed list. It is not a label applied
 * after the fact -- `READ_FROZEN_FIRESTORE_CATALOG` is absent from it, so an entry whose honest answer is
 * "it keeps reading Firestore" cannot be written down at all, and the only way to add such an entry is to
 * fix the operation.
 */
export const ACTIVATION_DISPOSITIONS = Object.freeze([
  /** Reaches the governed PostgreSQL Catalog authority. The target state. */
  "CONSUME_POSTGRES_CATALOG",
  /** Reaches nothing, and SAYS SO where a person can see it. Never a zero, never an empty list. */
  "EXPLICITLY_UNAVAILABLE",
  /** Has no live caller; it is retired at the boundary rather than migrated or refused. */
  "DORMANT_RETIRED",
  /** Deployed legacy surface kept only until its deletion step. Blocks retirement, not activation. */
  "LEGACY_RETIREMENT_ONLY",
  /** Migration tooling reading the source as EVIDENCE, which is what a snapshot is for. */
  "MIGRATION_EVIDENCE",
] as const);
export type ActivationDisposition = (typeof ACTIVATION_DISPOSITIONS)[number];

/** Named so the prohibition is greppable, and deliberately NOT a member of ACTIVATION_DISPOSITIONS. */
export const FORBIDDEN_DISPOSITION = "READ_FROZEN_FIRESTORE_CATALOG" as const;

export const LEDGER_RUNTIMES = Object.freeze(["FIREBASE_FUNCTIONS", "RENDER_POSTGRES", "BROWSER"] as const);
export type LedgerRuntime = (typeof LEDGER_RUNTIMES)[number];

export const CONSUMER_CLASSIFICATIONS = Object.freeze([
  /** Reachable from a deployed operation that has a live caller. The real blockers. */
  "ACTIVE_DEPLOYED_BUSINESS_PATH",
  /** Exported and externally invokable, but this repository has no caller left. Blocks RETIREMENT. */
  "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
  /** Executable, but not reachable from any deployed entrypoint. Blocks nothing. */
  "INTERNAL_UNDEPLOYED",
  /** Migration tooling, snapshots, censuses. Evidence, never runtime authority. */
  "MIGRATION_EVIDENCE",
  /** Reached only by tests. */
  "TEST_ONLY",
  /** Names a collection and reaches nothing. */
  "DEAD",
] as const);
export type ConsumerClassification = (typeof CONSUMER_CLASSIFICATIONS)[number];

export interface CatalogDependency {
  readonly consumer: string;
  /** The domain that OWNS the move. Catalog does not own other domains' migrations. */
  readonly owningDomain: string;
  readonly currentRuntime: LedgerRuntime;
  /** The Catalog fact it consumes. Naming it is what shows whether a replacement exists. */
  readonly catalogFact: string;
  readonly classification: ConsumerClassification;
  /** Derived from the import graph by the companion suite, never asserted here alone. */
  readonly deployedReachable: boolean;
  /** Where this fact lives after the move, or null when that authority does not exist yet. */
  readonly replacementAuthority: string | null;
  readonly activationBlocking: boolean;
  readonly retirementBlocking: boolean;
  /**
   * The DECIDED disposition at the activation boundary. Reads included; no frozen-Firestore option exists.
   * `activationBlocking` says whether the consumer has REACHED it yet -- the two are different questions,
   * and keeping them apart is what stops "we know where this lands" being mistaken for "this is done".
   */
  readonly disposition: ActivationDisposition;
  readonly reason: string;
}

const d = (x: CatalogDependency): CatalogDependency => Object.freeze(x);

/**
 * THE LEDGER.
 *
 * Every entry is a Firestore Catalog consumer that survived the client cutover. The client is gone
 * from this list entirely, which is the one part of the cutover this slice could complete on its
 * own: the browser now reaches PostgreSQL through Render for every Part read and write.
 */
export const CATALOG_ACTIVATION_DEPENDENCIES: readonly CatalogDependency[] = Object.freeze([
  // ══════════ PART MASTER'S OWN LEGACY ADAPTER ══════════
  d({
    consumer: "functions/src/partMaster/partMasterRepository.ts",
    owningDomain: "partMaster",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "the Part record itself: getById for every server Part resolution, and the staged create/update",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: "functions/src/catalogMaster/postgresPartMasterWriter.ts + postgresCatalogReads.ts",
    activationBlocking: true,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "THE legacy Firestore Part adapter, and the widest single dependency in this ledger: twenty-seven "
      + "deploy-reachable modules across twelve domains import it. It is deliberately NOT ported to an "
      + "HTTP client -- a Firebase Function calling the Render Catalog API is the forbidden bridge. It "
      + "stops blocking when the domains below stop reaching it, not before.",
  }),
  d({
    consumer: "functions/src/partMaster/partAliasRepository.ts",
    owningDomain: "partMaster",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part identity: alias records and the INTERNAL_PN preservation the Part writer performs",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: "functions/src/catalogMaster/postgresPartAliasWriter.ts",
    activationBlocking: true,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "Reached by the deployed alias callables and by partMasterCommands' atomic rename. The PostgreSQL "
      + "replacement exists and is proved; what remains is retiring the Firebase callables, which is a "
      + "deployment rather than a code change.",
  }),
  d({
    consumer: "functions/src/partMaster/partMasterCallables.ts",
    owningDomain: "partMaster",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "createPart / updatePart / changePartStatus",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    deployedReachable: true,
    replacementAuthority: "/operations/catalog createPart | updatePart | changePartStatus",
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "The client no longer calls these: partMasterCommandClient reaches Render. They remain exported "
      + "from index.ts and are therefore deployed and externally invokable by anything holding a token, "
      + "which is a second write authority this repository cannot see the callers of. Not deleted yet, "
      + "by ruling.",
  }),
  d({
    consumer: "functions/src/partMaster/partAliasCallables.ts",
    owningDomain: "partMaster",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "the seven alias operations, including the scanner lookup",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    deployedReachable: true,
    replacementAuthority: "/operations/catalog createPartAlias | deactivatePartAlias | reactivatePartAlias | listPartAliases | probePartAlias | lookupScannedPart",
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason: "Same posture as the Part callables: no repository caller remains, the exports are still deployed.",
  }),

  // ══════════ OTHER DOMAINS THAT READ A PART ══════════
  //
  // None of these is pulled into the Catalog slice. Each reads a Part inside a Firebase transaction
  // that Catalog does not own, and each moves when ITS domain moves.
  d({
    consumer: "functions/src/salesAgreement/salesAgreementLineReferences.ts",
    owningDomain: "salesAgreement (Commercial)",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "PART and EQUIPMENT_MODEL existence, validated INSIDE the Sales Agreement Firestore transaction",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: "eosCommercial/commands/salesAgreementCommandService + salesOrderCommandService (PostgreSQL, SERVED, Catalog COMPOSED)",
    activationBlocking: true,
    retirementBlocking: true,
    disposition: "CONSUME_POSTGRES_CATALOG",
    reason:
      "CATALOG_ACTIVATION_DEPENDENCY: COMMERCIAL_CLIENT_CUTOVER -- and NO LONGER a missing authority. "
      + "The PostgreSQL Sales Agreement and Sales Order commands exist, are served on /commercial/, and "
      + "now resolve PART / EQUIPMENT_MODEL references against eos_ops inside their OWN transaction: "
      + "the Catalog authority is composed in eosApi/server.ts, so CATALOG_AUTHORITY_UNAVAILABLE no "
      + "longer fires there. What keeps THIS file live is that the browser still calls the FIREBASE "
      + "Sales Agreement callables (services/salesAgreementCommandClient.js invokes httpsCallable). "
      + "The remaining work is a Commercial CLIENT cutover, not a Commercial migration.",
  }),
  d({
    consumer: "functions/src/workOrderInstall/workOrderInstallCommand.ts",
    owningDomain: "workOrderInstall (Work Order / Equipment)",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "whether the serialized asset's Part is a WHOLE-UNIT Part",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: null,
    activationBlocking: true,
    retirementBlocking: true,
    disposition: "CONSUME_POSTGRES_CATALOG",
    reason:
      "CATALOG_ACTIVATION_DEPENDENCY: WORK_ORDER_INSTALL_PART_AUTHORITY. The install command runs in "
      + "Firebase. The wholeUnit fact is NOT accepted from the client -- an untrusted flag deciding "
      + "whether a unit may be installed is exactly the check this read exists to be -- and it is NOT "
      + "duplicated onto the equipment record to dodge the dependency, which would create a second "
      + "place the answer could be wrong. It moves when Work Order / Equipment moves.",
  }),
  d({
    consumer: "functions/src/equipmentCompatibility/repository.ts",
    owningDomain: "equipmentCompatibility",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "EQUIPMENT_MODEL identity and existence",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: "eos_ops.equipment_models (identity only), already enforced by postgresPartMasterWriter.requireEquipmentModel",
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "DOWNGRADED from activation-blocking on measured reachability, not on reclassification. Traced from "
      + "the entry point, the ONLY thing reachable in this module is the EQUIPMENT_MODELS_COLLECTION "
      + "constant, imported by partMaster/partMasterCommands.ts; the existence probe itself "
      + "(assertEquipmentModelExists) lives in the Part commands, so it is already counted under Part "
      + "Master and retires with it. equipmentCompatibilityReadCallable is NOT exported from index.ts, so "
      + "the compatibility RELATIONSHIP domain has no deployed operation at all. And the one Catalog fact "
      + "that is consumed -- Equipment Model existence for a Part -- is ALREADY enforced by the PostgreSQL "
      + "target: postgresPartMasterWriter.requireEquipmentModel refuses EQUIPMENT_MODEL_NOT_FOUND, tenant-"
      + "scoped, on both create and update. There is nothing left to wire and no second authority to "
      + "build. What remains is deleting the legacy module, which is retirement.",
  }),

  d({
    consumer: "functions/src/dataImport/firestoreDataImportAdapters.ts",
    owningDomain: "dataImport",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "MUTATES Parts -- it calls the governed Firestore createPart command",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: null,
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "EXPLICITLY_UNAVAILABLE",
    reason:
      "NONPROD_ADMIN_TOOLING_RETIREMENT_BLOCKER (Owner ruling B, Lane 2) -- RECLASSIFIED from "
      + "DATA_IMPORT_RUNTIME_MIGRATION_BLOCKER, on two facts rather than on convenience. FIRST, this "
      + "runtime is NONPRODUCTION-ONLY, enforced by the backend and not by a hidden menu: "
      + "importTargetGuard.ts refuses the production project by name AND refuses any registry entry with "
      + "role 'production', with no default target. It therefore cannot be a production business-"
      + "continuity dependency. SECOND, it is now CUTOVER-AWARE: executeDataImport refuses a PARTS job at "
      + "the entity-type boundary, before the job is claimed and before any row is written "
      + "(catalogWriterState.ts `part.import`, mirroring the CRM cutover's `account.import`). It still "
      + "blocks RETIREMENT, because the adapter and its callable remain deployed. Restoring Part import "
      + "through Render is a later Administration/Data Import migration and is NOT a prerequisite to "
      + "Catalog business activation.",
  }),
  d({
    consumer: "functions/src/dataImport/firestoreInventoryImportAdapters.ts",
    owningDomain: "dataImport",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part existence and internal part number, to resolve an opening-balance row's Part reference",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: null,
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "EXPLICITLY_UNAVAILABLE",
    reason:
      "Same nonproduction-only runtime, but it READS the catalog rather than writing it, and a read stops "
      + "being safe at a DIFFERENT MOMENT: a FROZEN Firestore catalog is still CURRENT during the rollback "
      + "window, so this read stays legal there and becomes a stale read only once PostgreSQL is ACTIVE. It "
      + "is therefore guarded on the READ side (catalogWriterState.ts `dataImport.inventory.partReference`, "
      + "keyed on postgres === ACTIVE), refusing the INVENTORY job whole rather than resolving references "
      + "against a snapshot. Guarding it with the writer freeze instead would have broken opening-balance "
      + "imports throughout the rollback window for no reason.",
  }),

  // ══════════ INVENTORY OPERATIONS -- FOUND BY LANE 2, NOT PREVIOUSLY LISTED ══════════
  //
  // These four were missing from this ledger, and the reason they were missing is worth recording,
  // because it is a measurement error that will recur. The ledger listed partMasterRepository.ts as the
  // single widest entry and treated its CALLERS as covered by it. They are not covered: a caller is a
  // separate deployed OPERATION, with its own capability, its own users and its own disposition, and
  // "the adapter is listed" says nothing about what happens to the Cycle Count screen at activation.
  // Reachability was derived from the entry point per operation, and these four came out.
  d({
    consumer: "functions/src/cycleCount/cycleCountCallableWiring.ts",
    owningDomain: "cycleCount (Inventory Operations)",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part identity, status, and controlType -> trackingMode, which decides whether a count line snapshots a quantity or a blind serial set",
    classification: "INTERNAL_UNDEPLOYED",
    deployedReachable: false,
    replacementAuthority: "eos_ops.parts via eosOps/cycleCountRepository.ts -- eosOps/cycleCountOperations.ts on /operations/cycle-count; writer ACTIVE, gated by the inventory baseline certification (cycleCount/cycleCountWriterState.ts)",
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "RETIRED FROM THE REPOSITORY (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01). The client Cycle Count screens are "
      + "cut over to /operations/cycle-count, the Firestore writer is FROZEN, and index.ts no longer exports the sheet/line callables, "
      + "so nothing in this repository reaches this wiring. The DEPLOYED copies stay runtime-stale until the bounded Firebase "
      + "removal window -- tracked there, not here",
  }),
  d({
    consumer: "functions/src/inventoryTransfer/transferCallableWiring.ts",
    owningDomain: "inventoryTransfer (Inventory Operations)",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part identity, status, and controlType -> trackingMode, which decides serial sufficiency versus quantity sufficiency",
    classification: "INTERNAL_UNDEPLOYED",
    deployedReachable: false,
    replacementAuthority: "eos_ops.transfer_orders via eosOps/purchasingRepository.ts -- eosOps/transferOperations.ts on /operations/transfer (and the relocation on /operations/relocation); writers ACTIVE, gated by the inventory baseline certification",
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "RETIRED FROM THE REPOSITORY (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01). Transfers and relocations are cut "
      + "over to /operations/transfer and /operations/relocation, both Firestore writers are FROZEN, and index.ts no longer exports "
      + "the Transfer callables or relocateStock, so nothing in this repository reaches this wiring. The DEPLOYED copies stay "
      + "runtime-stale until the bounded Firebase removal window",
  }),
  d({
    consumer: "functions/src/inventory/partBalanceReadService.ts",
    owningDomain: "inventory (projection)",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part.controlType -- serial-tracked or quantity-tracked, which decides the SHAPE of the balance answer",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: null,
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "EXPLICITLY_UNAVAILABLE",
    reason:
      "A PROJECTION, and it satisfies every condition the ruling attaches to one. No mutation depends on "
      + "it: the only importers are read paths (partBalanceBatchReadService, ai/workOrderReadinessContext, "
      + "ai/workOrderContext). Its quantity authority is the Firestore inventory ledger, which is NOT "
      + "catalog and does not move in this cutover; its one catalog fact is controlType. Guarded on the "
      + "READ side (postgres === ACTIVE) so it answers failed-precondition CATALOG_AUTHORITY_MOVED rather "
      + "than computing a balance from a stale controlType. NO false zero: this service already refuses an "
      + "unresolvable Part rather than assuming quantity-tracking -- the PRT-2001 defect its own header "
      + "records, where a caller-supplied serialTracked answered KNOWN 0 for a shelf holding two serialized "
      + "units. A stale controlType is that same defect arriving by a different route, so it gets the same "
      + "answer: refuse. No PostgreSQL balance read exists to point at -- there is no on-hand projection "
      + "over eos_ops.inventory_movements anywhere in the repository -- and inventing one here would be a "
      + "second quantity authority.",
  }),
  d({
    consumer: "functions/src/inventory/partBalanceBatchReadService.ts",
    owningDomain: "inventory (projection)",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part.controlType for each requested Part, in one batched read instead of N",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: null,
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "EXPLICITLY_UNAVAILABLE",
    reason:
      "The batch form of the same read, deployed as getPartBalances, and guarded identically. One "
      + "migration state must produce one answer whether a caller asks about one Part or forty: a batch "
      + "that degraded to per-Part omissions would be the empty-value failure the ruling forbids, and the "
      + "caller could not tell a missing Part from an unavailable authority.",
  }),

  d({
    consumer: "functions/src/inventoryReceiving/receivingCallableWiring.ts",
    owningDomain: "inventoryReceiving (Reorder receiving, #1961)",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part identity, status, and controlType -> trackingMode, resolved both inside and outside the receiving transaction",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: "the PostgreSQL Reorder receiving command in #1961, composed with the PostgreSQL Catalog in the Render runtime",
    activationBlocking: true,
    retirementBlocking: true,
    disposition: "CONSUME_POSTGRES_CATALOG",
    reason:
      "THE MOST LIVE OF ALL OF THESE, and the one whose absence from this ledger mattered most. Unlike "
      + "Cycle Count and Transfer, inventory.stock.receive is NOT an ungranted capability: it is granted to "
      + "admin, dispatcher and owner, so a real principal can receive stock today. It resolves the Part "
      + "twice -- once in the transaction for the command and once outside it for the scanning surface -- "
      + "specifically so what the scanner shows and what the command enforces cannot disagree, which is a "
      + "guarantee a stale catalog would silently break. It is not wired here and must not be: the "
      + "replacement is the PostgreSQL receiving authority in #1961, which is HELD, and #1961 is out of "
      + "scope for this lane by ruling.",
  }),
  d({
    consumer: "functions/src/ai/workOrderReadinessContext.ts",
    owningDomain: "ai (projection)",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part.controlType for each planned part, to shape that part's balance projection",
    classification: "ACTIVE_DEPLOYED_BUSINESS_PATH",
    deployedReachable: true,
    replacementAuthority: null,
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "EXPLICITLY_UNAVAILABLE",
    reason:
      "A PROJECTION on the same terms as Part Balance, and guarded the same way "
      + "(catalogWriterState.ts `ai.workOrderReadiness.controlType`): readiness reports unavailable rather "
      + "than shaping balances from a frozen controlType. Its absence changes no business truth -- nothing "
      + "downstream of it writes -- and a readiness screen quietly built on last month's tracking modes is "
      + "precisely the stale read that is indistinguishable from a correct one.",
  }),

  // ══════════ PART MASTER'S OWN COMMAND LAYER ══════════
  //
  // These three sit behind the callables already listed above. They are separated out because the
  // derivation names them individually, and a ledger that silently folded them into "the repository"
  // is how the four Inventory Operations consumers went unlisted in the first place.
  d({
    consumer: "functions/src/partMaster/partMasterCommands.ts",
    owningDomain: "partMaster",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "the governed Firestore Part create/update/status, and the equipment-model existence probe they perform",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    deployedReachable: true,
    replacementAuthority: "/operations/catalog createPart | updatePart | changePartStatus (postgresPartMasterWriter.ts)",
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "The Firestore write authority itself. It already calls assertFirestoreCatalogWriterOpen first, so "
      + "the freeze stops it; the browser reaches Render instead; and its one remaining programmatic "
      + "caller, Data Import, is now refused at the job boundary before it gets here. It also owns the "
      + "equipment-model existence probe, whose PostgreSQL equivalent (requireEquipmentModel) already "
      + "exists and is enforced. What is left is deletion.",
  }),
  d({
    consumer: "functions/src/partMaster/partAliasCommands.ts",
    owningDomain: "partMaster",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "the Part a new or changed alias resolves to, read before the alias is staged",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    deployedReachable: true,
    replacementAuthority: "/operations/catalog createPartAlias | deactivatePartAlias | reactivatePartAlias (postgresPartAliasWriter.ts)",
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "Behind the alias callables already listed. The PostgreSQL alias authority exists and is proved, "
      + "including the atomic Part+alias rename that makes an alias a property of Part identity rather "
      + "than a side table. Retirement, not migration.",
  }),
  d({
    consumer: "functions/src/partMaster/partSupplierItems.ts",
    owningDomain: "partMaster",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part existence, to refuse a supplier item pointing at a Part that is not there",
    classification: "INTERNAL_UNDEPLOYED",
    deployedReachable: false,
    replacementAuthority: "eos_ops.supplier_catalog_items via eosOps/supplierCatalogRepository.ts, which resolves the Part in PostgreSQL",
    activationBlocking: false,
    retirementBlocking: true,
    disposition: "LEGACY_RETIREMENT_ONLY",
    reason:
      "A referential-integrity read, not a catalog authority: it asks only whether the Part exists before "
      + "attaching a supplier item to it. The PostgreSQL supplier catalog already resolves that reference "
      + "on its own side, so no second answer is being built. RETIRED FROM THE REPOSITORY (Firebase retirement F2, "
      + "2026-10-10): its only deployed adapter, partSupplierItemCallables.ts, is removed -- no caller remained and the "
      + "Firestore writer is FROZEN -- so nothing in this repository reaches it. The DEPLOYED copies stay runtime-stale until "
      + "the bounded Firebase removal window, so it still blocks retirement.",
  }),

  // ══════════ NOT REACHABLE FROM A DEPLOYED ENTRYPOINT ══════════
  d({
    consumer: "functions/src/equipmentCompatibility/commands.ts",
    owningDomain: "equipmentCompatibility",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Equipment Model import/update",
    classification: "INTERNAL_UNDEPLOYED",
    deployedReachable: false,
    replacementAuthority: "eos_ops.equipment_models",
    activationBlocking: false,
    retirementBlocking: false,
    disposition: "DORMANT_RETIRED",
    reason:
      "runEquipmentCompatibilityCommand has NO deployed callable -- it is not exported from index.ts, "
      + "and only tests reach it. Source existing is not runtime reachability.",
  }),
  d({
    consumer: "functions/src/partMaster/partReferenceCompatibility.ts",
    owningDomain: "partMaster",
    currentRuntime: "FIREBASE_FUNCTIONS",
    catalogFact: "Part existence for a compatibility reference",
    classification: "INTERNAL_UNDEPLOYED",
    deployedReachable: false,
    replacementAuthority: "/operations/catalog readPart",
    activationBlocking: false,
    retirementBlocking: false,
    disposition: "DORMANT_RETIRED",
    reason: "Not reachable from the Functions entry point; no deployed operation imports it.",
  }),
]);

/**
 * OPERATIONS DISPOSITIONED AT THE CATALOG ACTIVATION BOUNDARY THAT CONSUME NO CATALOG OBJECT.
 *
 * The Owner ruled a disposition for canonical Purchasing at this boundary. It does NOT belong in the
 * ledger above, and the distinction matters: that ledger is the ACTIVATION GATE, and every row in it is
 * a Firestore Catalog consumer. Adding a row for something that reads no `parts`, `part_aliases` or
 * `equipment_models` would put a fact in the gate that the gate cannot measure, and the census suite --
 * which derives the two halves from the source and compares them in both directions -- would be
 * asserting against a dependency that is not there.
 */
export const NON_CATALOG_BOUNDARY_DISPOSITIONS = Object.freeze([
  Object.freeze({
    operation: "legacy Firebase receiving, sourceKind = canonical PURCHASE_ORDER",
    module: "functions/src/inventoryReceiving/receivingCallables.ts",
    disposition: "DORMANT_RETIRE_OR_REFUSE" as const,
    /** VERIFIED, not planned: the refusal is already in the deployed code, and predates this lane. */
    alreadyEnforced: true,
    evidence:
      "validateReceiveRequest refuses anything but source.type === REORDER_PURCHASE_ORDER with "
      + "invalid-argument, at the callable boundary -- before authorization, before any Firestore read and "
      + "before any lifecycle change. The canonical branch in receivingSourceResolver.ts is therefore "
      + "unreachable from the deployed write path. Canonical purchasing is dormant on the evidence already "
      + "established: zero canonical purchase_orders, zero canonical receiving population, no live "
      + "canonical Purchasing screen.",
    doesNotAffect:
      "REORDER_PURCHASE_ORDER, which is an ACTIVE business process whose PostgreSQL replacement is in "
      + "#1961. The refusal is keyed on the source type ALONE and is not a receiving shutdown: a blanket "
      + "guard here would have taken Reorder receiving down with it, which is the one thing this "
      + "disposition must not do.",
    catalogExposure:
      "NONE, measured rather than assumed: neither receivingCallables.ts, receivingSourceResolver.ts nor "
      + "purchaseOrderProgressRead.ts reads parts, part_aliases or equipment_models. The deployed canonical "
      + "READS (getPurchaseOrderReceivingProgress, listReceivablePurchaseOrders) read purchase_orders and "
      + "receiving_orders only, so Catalog activation does not make them serve frozen catalog truth.",
  }),
]);

export interface CatalogGateReading {
  /** Client modules still reading Firestore for a Catalog fact. Must be ZERO. */
  readonly clientFirestoreConsumers: number;
  /** Deployed server operations still consuming MUTABLE Firestore Catalog. Must be ZERO. */
  readonly activeDeployedServerConsumers: readonly string[];
  readonly mayActivate: boolean;
  /** Named downstream migrations activation is waiting on, by owning domain. */
  readonly blockedOnDomains: readonly string[];
  readonly retirementBlockers: readonly string[];
}

/**
 * THE GATE.
 *
 * Migration evidence and unreachable legacy implementation files do not count. Deployed,
 * externally-invokable legacy authority does not block ACTIVATION but does block RETIREMENT.
 */
export function readCatalogActivationGate(input: {
  readonly clientFirestoreConsumers: number;
  readonly dependencies?: readonly CatalogDependency[];
}): CatalogGateReading {
  const deps = input.dependencies ?? CATALOG_ACTIVATION_DEPENDENCIES;
  const active = deps.filter((x) => x.activationBlocking && x.deployedReachable);
  const retirement = deps.filter((x) => x.retirementBlocking);
  return Object.freeze({
    clientFirestoreConsumers: input.clientFirestoreConsumers,
    activeDeployedServerConsumers: Object.freeze(active.map((x) => x.consumer).sort()),
    mayActivate: input.clientFirestoreConsumers === 0 && active.length === 0,
    blockedOnDomains: Object.freeze([...new Set(active.map((x) => x.owningDomain))].sort()),
    retirementBlockers: Object.freeze([...new Set(retirement.map((x) => x.consumer))].sort()),
  });
}
