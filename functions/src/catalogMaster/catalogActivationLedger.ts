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
    replacementAuthority: null,
    activationBlocking: true,
    retirementBlocking: true,
    reason:
      "CATALOG_ACTIVATION_DEPENDENCY: SALES_AGREEMENT_REFERENCE_VALIDATION. The Sales Agreement command "
      + "itself still executes in Firebase, so its reference check cannot consume PostgreSQL Catalog "
      + "without a bridge. Replacing the read with an HTTP call would validate against one store and "
      + "commit in another, with nothing making the two agree. The validation is NOT weakened and the "
      + "Sales Agreement implementation is untouched: it moves when Commercial moves.",
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
    replacementAuthority: "eos_ops.equipment_models (identity only)",
    activationBlocking: true,
    retirementBlocking: true,
    reason:
      "It needs Equipment Model IDENTITY, which the Catalog slice does migrate -- but the enclosing "
      + "commands still run in Firebase, so resolving against PostgreSQL would be a bridge. The "
      + "COMPATIBILITY RELATIONSHIP data is a separate authority the Catalog slice does not own and "
      + "does not migrate; only the model identity is Catalog's.",
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
    reason: "Not reachable from the Functions entry point; no deployed operation imports it.",
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
