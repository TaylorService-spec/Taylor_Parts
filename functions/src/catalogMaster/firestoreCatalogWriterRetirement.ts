// THE FIRESTORE CATALOG WRITER RETIREMENT SWITCH -- built, proven, and NOT thrown.
//
// The catalog cutover's last step is "disable the Firestore catalog writers" (docs/architecture/
// catalog-cutover-plan.md §5). This module is the mechanism that makes them unreachable, so that step is a
// one-line, reviewable change rather than a hunt through callables, import paths and scripts on the day:
//
//   * FIRESTORE_CATALOG_WRITER_STATE is "OPEN" today. Every Firestore catalog master writer calls
//     assertFirestoreCatalogWriterOpen(<writer>) before validation, capability resolution or any read (the three
//     Part commands as their first statement; the Equipment command as soon as the envelope names
//     importEquipmentModel), so while OPEN nothing about them changes.
//   * Setting the constant to "RETIRED" (a separately authorized PR, after copy + verify + reconcile, deployed to
//     each Firebase environment) makes every listed writer refuse with FirestoreCatalogWriterRetiredError before it
//     touches Firestore. The callable adapters map it to `failed-precondition`.
//
// It is a CODE constant, not an environment variable or a Firestore flag: a runtime flag is a second place the
// answer lives, can differ per instance, and would itself be a new Firebase dependency. Changing the constant is a
// commit someone reviewed.
//
// Pure: no Firebase, no I/O. functions/test/catalogMaster.test.mjs asserts that every writer in the manifest calls
// the guard with its own id, and that RETIRED refuses.

export type FirestoreCatalogWriterState = "OPEN" | "RETIRED";

/** THE SWITCH. Do not change without the authorization catalog-cutover-plan.md §5 requires. */
export const FIRESTORE_CATALOG_WRITER_STATE: FirestoreCatalogWriterState = "OPEN";

/** Every Firestore catalog MASTER writer, by id, with where it is reached from. */
export const FIRESTORE_CATALOG_WRITERS = Object.freeze({
  "part.create": Object.freeze({
    module: "functions/src/partMaster/partMasterCommands.ts",
    entry: "createPart",
    reachedFrom: Object.freeze([
      "callable createPart (functions/src/index.ts -> partMasterCallables.ts createPartCallable)",
      "callable executeDataImport (dataImport/firestoreDataImportAdapters.ts -> createPart)",
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
});

export type FirestoreCatalogWriterId = keyof typeof FIRESTORE_CATALOG_WRITERS;

export class FirestoreCatalogWriterRetiredError extends Error {
  readonly code = "FIRESTORE_CATALOG_WRITER_RETIRED";
  constructor(readonly writer: FirestoreCatalogWriterId) {
    super(`the Firestore catalog writer ${writer} is retired; catalog master data is written through the PostgreSQL catalog authority`);
    this.name = "FirestoreCatalogWriterRetiredError";
  }
}

/** First statement of every Firestore catalog master writer. A no-op while OPEN. */
export function assertFirestoreCatalogWriterOpen(
  writer: FirestoreCatalogWriterId,
  state: FirestoreCatalogWriterState = FIRESTORE_CATALOG_WRITER_STATE,
): void {
  if (!Object.prototype.hasOwnProperty.call(FIRESTORE_CATALOG_WRITERS, writer)) {
    throw new Error(`unknown Firestore catalog writer ${String(writer)}`);
  }
  if (state !== "OPEN") throw new FirestoreCatalogWriterRetiredError(writer);
}
