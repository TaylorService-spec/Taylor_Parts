// THE CATALOG RUNTIME CENSUS -- the hard activation gate for the Catalog cutover.
//
// Pure data plus derivations: no database, no Firebase, no I/O, no scanning. Its companion suite
// DERIVES the executable set from the repository and asserts the two correspond in BOTH directions,
// so a consumer cannot be retired from this list without actually being retired from the code, and a
// new one cannot appear in the code without appearing here.
//
// ════════════════════ THE LESSON THIS INHERITS ════════════════════
//
// The Reorder census learned two things the hard way, and both apply here:
//
//   1. A census that matches NAMES measures names, not REACHABILITY. A client module that calls a
//      wrapper which calls a Firestore read is a consumer, however many hops away it sits.
//   2. `parts` is a Firestore collection AND a PostgreSQL table. A schema qualifier -- a literal
//      `eos_ops.` or the `${SCHEMA}.` the repositories interpolate -- means PostgreSQL. Only an
//      UNQUALIFIED name is a Firestore collection. Without that discriminator every governed
//      PostgreSQL command counts as a legacy consumer and the gate can never open.
//
// ════════════════════ NO FALLBACK IS A CLASSIFICATION, NOT A PROMISE ════════════════════
//
// `RENDER_WITH_FIRESTORE_FALLBACK` exists and is ACTIVATION-BLOCKING precisely so that a
// "try Render, and read Firestore if it fails" module has a name here rather than passing as
// migrated. A fallback is the shape that makes a cutover untestable: it works in every test, and in
// production it silently keeps the old authority alive for exactly the cases that fail.

export const CATALOG_OBJECTS = Object.freeze([
  /** parts -- the Part Master. */
  "PART",
  /** part_aliases -- Part identity. */
  "PART_ALIAS",
  /** equipment_models -- the reference a Part points at. */
  "EQUIPMENT_MODEL",
] as const);
export type CatalogObject = (typeof CATALOG_OBJECTS)[number];

export const CATALOG_RUNTIME_CLASSIFICATIONS = Object.freeze([
  /** Live code that READS the Firestore object to serve a user. BLOCKS activation. */
  "FIRESTORE_RUNTIME_READ",
  /** Live code that WRITES it. BLOCKS activation. */
  "FIRESTORE_RUNTIME_WRITE",
  /**
   * Reaches the Render Catalog API but falls back to Firestore. BLOCKS, and is named separately
   * because it is the failure mode that hides itself: green in every test, and in production it
   * keeps the retired authority answering for exactly the requests that failed.
   */
  "RENDER_WITH_FIRESTORE_FALLBACK",
  /** A client module that reaches a Catalog Firebase callable, directly or through a wrapper. BLOCKS. */
  "CALLABLE_CLIENT_WRAPPER",
  /**
   * A Catalog Firebase callable EXPORTED from the Functions entry point, and therefore deployed and
   * externally invokable. BLOCKS the Firebase retirement, though not the PostgreSQL activation.
   */
  "DEPLOYED_LEGACY_AUTHORITY",
  /** Reaches the governed PostgreSQL/Render Catalog authority. The target state; blocks nothing. */
  "RENDER_RUNTIME",
  /** Migration tooling, snapshot exporters, census modules. Evidence, never runtime authority. */
  "MIGRATION_EVIDENCE",
  /** firestore.rules itself -- the authority retired at the final deployment step. */
  "RULES_AUTHORITY",
  /** Names the collection in a shape, catalog or constant and reaches nothing. */
  "DEAD",
] as const);
export type CatalogRuntimeClassification = (typeof CATALOG_RUNTIME_CLASSIFICATIONS)[number];

/** The four that block PostgreSQL Catalog activation. */
export const CATALOG_ACTIVATION_BLOCKING: readonly CatalogRuntimeClassification[] = Object.freeze([
  "FIRESTORE_RUNTIME_READ", "FIRESTORE_RUNTIME_WRITE", "RENDER_WITH_FIRESTORE_FALLBACK", "CALLABLE_CLIENT_WRAPPER",
]);

/** What additionally blocks the FIREBASE RETIREMENT, which is a later and separate step. */
export const CATALOG_RETIREMENT_BLOCKING: readonly CatalogRuntimeClassification[] = Object.freeze([
  ...CATALOG_ACTIVATION_BLOCKING, "DEPLOYED_LEGACY_AUTHORITY",
]);

export interface CatalogCensusEntry {
  /** The census key is (path, OBJECT). A file touching two objects has two entries. */
  readonly path: string;
  readonly object: CatalogObject;
  readonly classification: CatalogRuntimeClassification;
  readonly consumer: string;
}

const e = (entry: CatalogCensusEntry): CatalogCensusEntry => Object.freeze(entry);

/**
 * THE CATALOG RUNTIME CENSUS, as the repository stands today.
 *
 * Everything here is BLOCKING or evidence; nothing has moved yet, because the Render Catalog API is
 * BUILT and INERT and no client has been cut over to it. That is the honest state, and it is what
 * makes the remaining work measurable rather than asserted.
 */
export const CATALOG_RUNTIME_CENSUS: readonly CatalogCensusEntry[] = Object.freeze([
  // ══════════ CLIENT: direct Firestore reads. THE REAL GAP ══════════
  e({ path: "field-ops-app-vite/src/services/partMasterQueries.js", object: "PART",
    classification: "FIRESTORE_RUNTIME_READ",
    consumer: "fetchPartMasterList reads the WHOLE parts collection; six surfaces depend on it (PART_CATALOGUE_WHOLE_COLLECTION_READ)" }),
  e({ path: "field-ops-app-vite/src/hooks/useWholeUnitParts.js", object: "PART",
    classification: "FIRESTORE_RUNTIME_READ", consumer: "queries parts where wholeUnit == true, capped but still a direct catalogue read" }),
  e({ path: "field-ops-app-vite/src/hooks/useSerialTrackedParts.js", object: "PART",
    classification: "FIRESTORE_RUNTIME_READ", consumer: "queries parts by tracking mode, directly against Firestore" }),
  e({ path: "field-ops-app-vite/src/modules/inventory/PartsList.jsx", object: "PART",
    classification: "FIRESTORE_RUNTIME_READ", consumer: "the Parts administration list reads the collection directly" }),

  // ══════════ SERVER: the Firestore Catalog authority ══════════
  //
  // The server Part read funnels through ONE repository -- Receiving, inventory balance, the AI
  // readiness context and the rest all call partMasterRepository.getById rather than naming the
  // collection. That is why they are absent here and why this single entry carries them: moving this
  // repository is what moves every server Part read at once.
  e({ path: "functions/src/partMaster/partMasterRepository.ts", object: "PART",
    classification: "FIRESTORE_RUNTIME_WRITE",
    consumer: "THE Firestore Part persistence boundary: getById for every server Part resolution, and the staged create/update" }),
  e({ path: "functions/src/partMaster/partAliasRepository.ts", object: "PART_ALIAS",
    classification: "FIRESTORE_RUNTIME_WRITE", consumer: "the Firestore alias persistence boundary" }),
  e({ path: "functions/src/equipmentCompatibility/repository.ts", object: "EQUIPMENT_MODEL",
    classification: "FIRESTORE_RUNTIME_WRITE", consumer: "the Firestore Equipment Model persistence boundary" }),
  e({ path: "functions/src/salesAgreement/salesAgreementLineReferences.ts", object: "PART",
    classification: "FIRESTORE_RUNTIME_READ", consumer: "resolves a sales agreement line's Part reference against Firestore" }),
  e({ path: "functions/src/salesAgreement/salesAgreementLineReferences.ts", object: "EQUIPMENT_MODEL",
    classification: "FIRESTORE_RUNTIME_READ", consumer: "the same reference check for an Equipment Model line" }),
  e({ path: "functions/src/workOrderInstall/workOrderInstallCommand.ts", object: "PART",
    classification: "FIRESTORE_RUNTIME_READ", consumer: "the install command resolves the Part being installed" }),

  // ══════════ SERVER: deployed Firebase callables ══════════
  e({ path: "functions/src/partMaster/partMasterCallables.ts", object: "PART",
    classification: "DEPLOYED_LEGACY_AUTHORITY",
    consumer: "createPart / updatePart / changePartStatus: exported from index.ts, deployed and externally invokable" }),
  e({ path: "functions/src/partMaster/partAliasCallables.ts", object: "PART_ALIAS",
    classification: "DEPLOYED_LEGACY_AUTHORITY",
    consumer: "the seven alias callables including the scanner lookup: exported from index.ts" }),

  // ══════════ THE TARGET, BUILT AND INERT ══════════
  e({ path: "functions/src/catalogMaster/catalogHttp.ts", object: "PART",
    classification: "RENDER_RUNTIME",
    consumer: "the governed Render Catalog API: bounded reads and the Part commands. BUILT / INERT -- no client calls it yet" }),
  e({ path: "functions/src/catalogMaster/postgresCatalogReads.ts", object: "PART",
    classification: "RENDER_RUNTIME", consumer: "the bounded PostgreSQL Part reads the API serves" }),

  // ══════════ MIGRATION EVIDENCE ══════════
  e({ path: "functions/src/catalogMaster/catalogSnapshot.ts", object: "PART",
    classification: "MIGRATION_EVIDENCE", consumer: "the snapshot census names the source collection" }),
  e({ path: "functions/src/catalogMaster/catalogCutover.ts", object: "PART",
    classification: "MIGRATION_EVIDENCE", consumer: "COPY / VERIFY names the source collection" }),

  // ══════════ names them, reaches nothing ══════════
  //
  // Nav keys, section keys, labels, metadata bindings and census documents. Each NAMES a catalog
  // collection and performs no read: they are listed so the count can only go down deliberately.
  e({ path: "field-ops-app-vite/src/App.jsx", object: "PART", classification: "DEAD",
    consumer: "a navigation item key, compared as a string" }),
  e({ path: "field-ops-app-vite/src/navigation/navConfig.js", object: "PART", classification: "DEAD",
    consumer: "the navigation destination key for the Parts screen" }),
  e({ path: "field-ops-app-vite/src/modules/dashboard/MyDashboard.jsx", object: "PART", classification: "DEAD",
    consumer: "a View in Parts link target, resolved as a route key" }),
  e({ path: "field-ops-app-vite/src/modules/inventory/PartMasterList.jsx", object: "PART", classification: "DEAD",
    consumer: "a refusal label and a singular/plural count label" }),
  e({ path: "field-ops-app-vite/src/modules/inventory/TruckFleetCard.jsx", object: "PART", classification: "DEAD",
    consumer: "a metric tile key on the truck card; no catalogue is read" }),
  e({ path: "field-ops-app-vite/src/modules/inventory/mobile/MobileInventorySections.jsx", object: "PART",
    classification: "DEAD", consumer: "a mobile inventory section key; the section reads nothing itself" }),
  e({ path: "field-ops-app-vite/src/shared/search/searchProviders.js", object: "PART", classification: "DEAD",
    consumer: "the search provider key; the provider is pure over data the caller already loaded" }),
  e({ path: "field-ops-app-vite/src/domain/mobileLocationInventoryProjection.js", object: "PART",
    classification: "DEAD", consumer: "a pure projection over data passed to it" }),
  e({ path: "field-ops-app-vite/src/domain/partsAttentionProjection.js", object: "PART",
    classification: "DEAD", consumer: "a pure projection over data passed to it" }),
  e({ path: "field-ops-app-vite/src/domain/partsGovernedRecommendation.js", object: "PART",
    classification: "DEAD", consumer: "a pure recommendation over data passed to it" }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/part.js", object: "PART", classification: "DEAD",
    consumer: "the Part metadata definition binding; it renders, it does not read" }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/partAlias.js", object: "PART_ALIAS",
    classification: "DEAD", consumer: "the alias metadata definition binding" }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/equipmentModel.js", object: "EQUIPMENT_MODEL",
    classification: "DEAD", consumer: "the Equipment Model metadata definition binding" }),
  e({ path: "field-ops-app-vite/src/metadata/administration/profiles/part.js", object: "PART",
    classification: "DEAD", consumer: "the Part administration profile definition" }),
  e({ path: "field-ops-app-vite/src/metadata/administration/profiles/part.js", object: "PART_ALIAS",
    classification: "DEAD", consumer: "the profile's alias related-object binding" }),
  e({ path: "field-ops-app-vite/src/access/legacyAuthorizationSurface.ts", object: "PART",
    classification: "DEAD", consumer: "the legacy authorization surface census, client side" }),
  e({ path: "functions/src/access/legacyAuthorizationSurface.ts", object: "PART",
    classification: "DEAD", consumer: "the legacy authorization surface census, server side" }),
  e({ path: "functions/src/ownership/ownershipMatrix.ts", object: "PART", classification: "DEAD",
    consumer: "names the collection in the ownership matrix family map; nothing is read" }),
  e({ path: "functions/src/ownership/ownershipMatrix.ts", object: "PART_ALIAS", classification: "DEAD",
    consumer: "the same ownership matrix, its alias family entry" }),
  e({ path: "functions/src/ownership/ownershipMatrix.ts", object: "EQUIPMENT_MODEL", classification: "DEAD",
    consumer: "the same ownership matrix, its equipment model family entry" }),
  e({ path: "functions/src/performance/performanceMetricRegistry.ts", object: "PART", classification: "DEAD",
    consumer: "a performance metric's domain label, compared as a string" }),
  e({ path: "functions/src/equipmentCompatibility/operations.ts", object: "EQUIPMENT_MODEL",
    classification: "DEAD", consumer: "the operation target-type vocabulary; the repository performs the reads" }),
]);

export interface CatalogActivationReadiness {
  readonly ready: boolean;
  readonly blockedBy: readonly string[];
  readonly runtimeConsumerCount: number;
  readonly firebaseRetired: boolean;
  readonly firebaseRetirementBlockedBy: readonly string[];
  /** Any module that falls back to Firestore. Must be empty, always. */
  readonly fallbackConsumers: readonly string[];
}

/**
 * MAY THE POSTGRESQL CATALOG AUTHORITY BE ACTIVATED, AND IS FIREBASE RETIRED?
 *
 * Two questions, answered separately because they are answered at different steps. Activation needs
 * ZERO runtime consumers -- Firestore reads, Firestore writes, callable client wrappers and
 * fallbacks alike. Retirement additionally needs the deployed callable exports gone.
 */
export function catalogActivationReadiness(
  census: readonly CatalogCensusEntry[] = CATALOG_RUNTIME_CENSUS,
): CatalogActivationReadiness {
  const blocking = census.filter((c) => CATALOG_ACTIVATION_BLOCKING.includes(c.classification));
  const retirementBlocking = census.filter((c) => CATALOG_RETIREMENT_BLOCKING.includes(c.classification));
  const fallback = census.filter((c) => c.classification === "RENDER_WITH_FIRESTORE_FALLBACK");
  return Object.freeze({
    ready: blocking.length === 0,
    blockedBy: Object.freeze([...new Set(blocking.map((c) => c.path))].sort()),
    runtimeConsumerCount: blocking.length,
    firebaseRetired: retirementBlocking.length === 0,
    firebaseRetirementBlockedBy: Object.freeze([...new Set(retirementBlocking.map((c) => c.path))].sort()),
    fallbackConsumers: Object.freeze(fallback.map((c) => c.path).sort()),
  });
}
