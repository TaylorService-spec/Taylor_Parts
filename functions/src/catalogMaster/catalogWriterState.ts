// THE CATALOG WRITER AUTHORITY STATE -- which writer set may write catalog master data, stated once.
//
// ════════════════════ THE OWNER RULING (controlled freeze window) ════════════════════
//
// docs/architecture/catalog-cutover-plan.md §5. There are two writer sets and NEVER two authoritative ones:
//
//   Firestore (legacy)  OPEN     the legacy commands write, as today
//                       FROZEN   the legacy commands REFUSE -- every writer in FIRESTORE_CATALOG_WRITERS below:
//                                no Part create/update/status, no Equipment Model create/update, no catalog import
//                                write, and none of the rest of the catalog master surface either (Manufacturer,
//                                Supplier, Part Alias, Part-Supplier Item, Equipment Model Alias). Reversible -- but
//                                only while PostgreSQL is still INACTIVE: that is the rollback path if copy / verify
//                                / reconcile fails.
//                       RETIRED  the legacy commands refuse for good; their removal follows. Not reversible.
//   PostgreSQL (target) INACTIVE nothing composes the catalogMaster writers into the Render API
//                       ACTIVE   the governed PostgreSQL writers accept authoritative writes
//
// The only legal states and moves:
//
//   OPEN/INACTIVE  --FREEZE (step 2)-->                    FROZEN/INACTIVE
//   FROZEN/INACTIVE --ROLLBACK_BEFORE_POSTGRES_WRITES-->   OPEN/INACTIVE      (copy/verify/reconcile failed)
//   FROZEN/INACTIVE --ACTIVATE_POSTGRES (step 7)-->        FROZEN/ACTIVE
//   FROZEN/ACTIVE  --RETIRE_FIRESTORE (step 10)-->         RETIRED/ACTIVE
//
// OPEN/ACTIVE is incoherent (two authoritative writer sets). Nothing leaves ACTIVE: once PostgreSQL has accepted
// authoritative writes there is no silent revert to Firestore; a reverse migration is a separate Owner decision
// and would be a new, reviewed design, not a state of this switch.
//
// FREEZE IS NOT REMOVAL. FROZEN keeps every legacy writer in source, refusing; RETIRED is the precondition for
// deleting them (step 10). The committed state is a CODE constant: changing it is a reviewed commit and a deploy,
// never an environment variable or a Firestore flag (a runtime flag would be a second place the answer lives and a
// new Firebase dependency). functions/test/catalogMaster.test.mjs asserts the committed state is coherent, that
// every legacy writer calls the guard first, and that while PostgreSQL is INACTIVE nothing outside catalogMaster
// imports the PostgreSQL writers.
//
// Pure: no Firebase, no I/O.

export type FirestoreCatalogWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresCatalogWriterState = "INACTIVE" | "ACTIVE";

export interface CatalogWriterAuthority {
  readonly firestore: FirestoreCatalogWriterState;
  readonly postgres: PostgresCatalogWriterState;
}

/** THE COMMITTED STATE. Change only through an allowed transition, with the authorization §5 requires. */
export const CATALOG_WRITER_AUTHORITY: CatalogWriterAuthority = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });

export const CATALOG_WRITER_TRANSITIONS = Object.freeze([
  Object.freeze({ name: "FREEZE", from: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }) }),
  Object.freeze({ name: "ROLLBACK_BEFORE_POSTGRES_WRITES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }) }),
  Object.freeze({ name: "ACTIVATE_POSTGRES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }) }),
  Object.freeze({ name: "RETIRE_FIRESTORE", from: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }), to: Object.freeze({ firestore: "RETIRED", postgres: "ACTIVE" }) }),
] as const);

export class CatalogWriterStateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CatalogWriterStateError";
  }
}

/** Exactly one authoritative writer set: OPEN only with INACTIVE, RETIRED only with ACTIVE. */
export function assertCatalogWriterAuthorityCoherent(state: CatalogWriterAuthority): void {
  const f = state?.firestore, p = state?.postgres;
  if (!["OPEN", "FROZEN", "RETIRED"].includes(f as string) || !["INACTIVE", "ACTIVE"].includes(p as string)) {
    throw new CatalogWriterStateError("CATALOG_WRITER_STATE_INVALID", "unknown catalog writer state");
  }
  if (f === "OPEN" && p === "ACTIVE") throw new CatalogWriterStateError("TWO_AUTHORITATIVE_WRITER_SETS", "Firestore OPEN with PostgreSQL ACTIVE would be two authoritative catalog writer sets");
  if (f === "RETIRED" && p === "INACTIVE") throw new CatalogWriterStateError("NO_AUTHORITATIVE_WRITER_SET", "Firestore RETIRED with PostgreSQL INACTIVE leaves no catalog writer at all");
}

/** A move is legal only if it is one of CATALOG_WRITER_TRANSITIONS; returns its name. */
export function assertCatalogWriterTransition(from: CatalogWriterAuthority, to: CatalogWriterAuthority): string {
  assertCatalogWriterAuthorityCoherent(from);
  assertCatalogWriterAuthorityCoherent(to);
  const match = CATALOG_WRITER_TRANSITIONS.find((t) => t.from.firestore === from.firestore && t.from.postgres === from.postgres && t.to.firestore === to.firestore && t.to.postgres === to.postgres);
  if (!match) {
    const code = from.postgres === "ACTIVE" && to.firestore === "OPEN" ? "NO_SILENT_REVERT_TO_FIRESTORE" : "CATALOG_WRITER_TRANSITION_NOT_ALLOWED";
    throw new CatalogWriterStateError(code, `${from.firestore}/${from.postgres} -> ${to.firestore}/${to.postgres} is not an allowed catalog writer transition`);
  }
  return match.name;
}

/** Every legacy Firestore catalog MASTER writer, by id, with where it is reached from. */
export const FIRESTORE_CATALOG_WRITERS = Object.freeze({
  "part.create": Object.freeze({
    module: "functions/src/partMaster/partMasterCommands.ts",
    entry: "createPart",
    reachedFrom: Object.freeze([
      "callable createPart (functions/src/index.ts -> partMasterCallables.ts createPartCallable)",
      "callable executeDataImport (dataImport/firestoreDataImportAdapters.ts -> createPart): the catalog import write",
      "functions/scripts/executePartMasterCreate.js, functions/scripts/generatePartMasterMigrationEvidence.js",
      "client field-ops-app-vite/src/services/partMasterCommandClient.js (create), access/dataImportClient.js (executeDataImport)",
    ]),
  }),
  "part.update": Object.freeze({
    module: "functions/src/partMaster/partMasterCommands.ts",
    entry: "updatePart",
    reachedFrom: Object.freeze([
      "callable updatePart (partMasterCallables.ts updatePartCallable)",
      "client field-ops-app-vite/src/services/partMasterCommandClient.js (update)",
    ]),
  }),
  "part.changeStatus": Object.freeze({
    module: "functions/src/partMaster/partMasterCommands.ts",
    entry: "changePartStatus",
    reachedFrom: Object.freeze([
      "callable changePartStatus (partMasterCallables.ts changePartStatusCallable)",
      "client field-ops-app-vite/src/services/partMasterCommandClient.js (changeStatus)",
    ]),
  }),
  "equipmentModel.import": Object.freeze({
    module: "functions/src/equipmentCompatibility/commands.ts",
    entry: "runEquipmentCompatibilityCommand (action importEquipmentModel)",
    reachedFrom: Object.freeze([
      "no deployed callable exports it (functions/src/index.ts); reached only by tests and operator code",
    ]),
  }),

  // ──────────────── the rest of the catalog master surface (freeze-completeness census) ────────────────
  //
  // The four writers above were the copy scope (the migration-only snapshot export allowlists exactly the
  // `parts` and `equipment_models` collections). They are NOT the whole legacy catalog master surface, and a
  // freeze that covers only
  // the copied collections is not a freeze of catalog master data: §2 gap 3 of docs/architecture/
  // catalog-cutover-plan.md says the dependent Firestore authorities `part_aliases`, `part_supplier_items`
  // and `equipment_model_aliases` "must move or stay frozen with the catalog until their own cutover", and
  // §8 repeats it as an unresolved fact. Manufacturer and Supplier are catalog master data by this
  // repository's own definition: both are written through the Part Master command machinery, both gate on
  // inventory.catalog.manage / inventory.catalog.activate (supplierMasterCommands.ts states it outright --
  // "Supplier is a catalog-governed object ... the SAME capabilities parts/manufacturers/part_supplier_items
  // use"), and ownership/ownershipMatrix.ts classes parts, part_aliases, part_supplier_items, manufacturers,
  // equipment_models and suppliers alike as company-neutral REFERENCE "shared catalog/reference data".
  //
  // Registering them here is what puts them inside the ONE freeze switch. It changes nothing while the
  // committed state is OPEN/INACTIVE; it is what makes FREEZE mean "no catalog master write", not "no write
  // to the two collections the snapshot happens to carry".

  "manufacturer.create": Object.freeze({
    module: "functions/src/partMaster/partMasterCommands.ts",
    entry: "createManufacturer",
    reachedFrom: Object.freeze([
      "callable createManufacturer (functions/src/index.ts -> manufacturerCallables.ts createManufacturerCallable)",
      "client field-ops-app-vite/src/services/manufacturerCommandClient.js (create)",
    ]),
  }),
  "manufacturer.update": Object.freeze({
    module: "functions/src/partMaster/partMasterCommands.ts",
    entry: "updateManufacturer",
    reachedFrom: Object.freeze([
      "callable updateManufacturer (manufacturerCallables.ts updateManufacturerCallable)",
      "client field-ops-app-vite/src/services/manufacturerCommandClient.js (update)",
    ]),
  }),
  "manufacturer.changeStatus": Object.freeze({
    module: "functions/src/partMaster/partMasterCommands.ts",
    entry: "changeManufacturerStatus",
    reachedFrom: Object.freeze([
      "callable changeManufacturerStatus (manufacturerCallables.ts changeManufacturerStatusCallable)",
      "client field-ops-app-vite/src/services/manufacturerCommandClient.js (changeStatus)",
    ]),
  }),

  "supplier.create": Object.freeze({
    module: "functions/src/supplierMaster/supplierMasterCommands.ts",
    entry: "createSupplier",
    reachedFrom: Object.freeze([
      "callable createSupplier (functions/src/index.ts -> supplierMasterCallables.ts createSupplierCallable)",
      "functions/scripts/seedSupplierSandbox.mjs (operator seed, via the command)",
    ]),
  }),
  "supplier.update": Object.freeze({
    module: "functions/src/supplierMaster/supplierMasterCommands.ts",
    entry: "updateSupplier",
    reachedFrom: Object.freeze([
      "callable updateSupplier (supplierMasterCallables.ts updateSupplierCallable)",
    ]),
  }),
  "supplier.activate": Object.freeze({
    module: "functions/src/supplierMaster/supplierMasterCommands.ts",
    entry: "changeSupplierStatus (action activateSupplier)",
    reachedFrom: Object.freeze([
      "callable activateSupplier (supplierMasterCallables.ts activateSupplierCallable) -> activateSupplier",
    ]),
  }),
  "supplier.deactivate": Object.freeze({
    module: "functions/src/supplierMaster/supplierMasterCommands.ts",
    entry: "changeSupplierStatus (action deactivateSupplier)",
    reachedFrom: Object.freeze([
      "callable deactivateSupplier (supplierMasterCallables.ts deactivateSupplierCallable) -> deactivateSupplier",
    ]),
  }),

  "partAlias.create": Object.freeze({
    module: "functions/src/partMaster/partAliasCommands.ts",
    entry: "createPartAlias",
    reachedFrom: Object.freeze([
      "callable createPartAlias (functions/src/index.ts -> partAliasCallables.ts createPartAliasCallable)",
      "client field-ops-app-vite/src/services/partAliasCallableClient.js",
      "NOT the updatePart INTERNAL_PN alias backfill: that stages its alias write inside updatePart, which the part.update guard already covers",
    ]),
  }),
  "partAlias.deactivate": Object.freeze({
    module: "functions/src/partMaster/partAliasCommands.ts",
    entry: "changeAliasStatus (action deactivatePartAlias)",
    reachedFrom: Object.freeze([
      "callable deactivatePartAlias (partAliasCallables.ts deactivatePartAliasCallable) -> deactivatePartAlias",
    ]),
  }),
  "partAlias.reactivate": Object.freeze({
    module: "functions/src/partMaster/partAliasCommands.ts",
    entry: "changeAliasStatus (action reactivatePartAlias)",
    reachedFrom: Object.freeze([
      "callable reactivatePartAlias (partAliasCallables.ts reactivatePartAliasCallable) -> reactivatePartAlias",
    ]),
  }),

  "partSupplierItem.create": Object.freeze({
    module: "functions/src/partMaster/partSupplierItems.ts",
    entry: "createPartSupplierItem",
    reachedFrom: Object.freeze([
      "callable createPartSupplierItem (functions/src/index.ts -> partSupplierItemCallables.ts createPartSupplierItemCallable)",
    ]),
  }),
  "partSupplierItem.update": Object.freeze({
    module: "functions/src/partMaster/partSupplierItems.ts",
    entry: "updatePartSupplierItem",
    reachedFrom: Object.freeze([
      "callable updatePartSupplierItem (partSupplierItemCallables.ts updatePartSupplierItemCallable)",
    ]),
  }),
  "partSupplierItem.changeStatus": Object.freeze({
    module: "functions/src/partMaster/partSupplierItems.ts",
    entry: "changePartSupplierItemStatus",
    reachedFrom: Object.freeze([
      "callable changePartSupplierItemStatus (partSupplierItemCallables.ts changePartSupplierItemStatusCallable)",
    ]),
  }),
  "partSupplierItem.setPreferred": Object.freeze({
    module: "functions/src/partMaster/partSupplierItems.ts",
    entry: "setPreferredSupplier",
    reachedFrom: Object.freeze([
      "callable setPreferredSupplier (partSupplierItemCallables.ts setPreferredSupplierCallable)",
    ]),
  }),

  "equipmentModelAlias.import": Object.freeze({
    module: "functions/src/equipmentCompatibility/commands.ts",
    entry: "runEquipmentCompatibilityCommand (action importEquipmentModelAlias)",
    reachedFrom: Object.freeze([
      "no deployed callable exports it (functions/src/index.ts); reached only by tests and operator code",
    ]),
  }),
});

export type FirestoreCatalogWriterId = keyof typeof FIRESTORE_CATALOG_WRITERS;

export class FirestoreCatalogWriterClosedError extends Error {
  readonly code: "FIRESTORE_CATALOG_WRITER_FROZEN" | "FIRESTORE_CATALOG_WRITER_RETIRED";
  constructor(readonly writer: FirestoreCatalogWriterId, readonly state: "FROZEN" | "RETIRED") {
    super(state === "FROZEN"
      ? `the Firestore catalog writer ${writer} is frozen for the catalog cutover; no catalog master write is accepted until the cutover completes`
      : `the Firestore catalog writer ${writer} is retired; catalog master data is written through the PostgreSQL catalog authority`);
    this.name = "FirestoreCatalogWriterClosedError";
    this.code = state === "FROZEN" ? "FIRESTORE_CATALOG_WRITER_FROZEN" : "FIRESTORE_CATALOG_WRITER_RETIRED";
  }
}

/** First act of every legacy Firestore catalog master writer. A no-op only while Firestore is OPEN. */
export function assertFirestoreCatalogWriterOpen(
  writer: FirestoreCatalogWriterId,
  authority: CatalogWriterAuthority = CATALOG_WRITER_AUTHORITY,
): void {
  if (!Object.prototype.hasOwnProperty.call(FIRESTORE_CATALOG_WRITERS, writer)) {
    throw new Error(`unknown Firestore catalog writer ${String(writer)}`);
  }
  assertCatalogWriterAuthorityCoherent(authority);
  if (authority.firestore !== "OPEN") throw new FirestoreCatalogWriterClosedError(writer, authority.firestore);
}
