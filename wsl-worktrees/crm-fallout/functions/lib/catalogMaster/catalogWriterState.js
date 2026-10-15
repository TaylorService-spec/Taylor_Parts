"use strict";
// THE CATALOG WRITER AUTHORITY STATE -- which writer set may write catalog master data, stated once.
//
// ════════════════════ THE OWNER RULING (controlled freeze window) ════════════════════
//
// docs/architecture/catalog-cutover-plan.md §5. There are two writer sets and NEVER two authoritative ones:
//
//   Firestore (legacy)  OPEN     the legacy commands write, as today
//                       FROZEN   the legacy commands REFUSE (no Part create/update/status, no Equipment Model
//                                create/update, no catalog import write). Reversible -- but only while PostgreSQL
//                                is still INACTIVE: that is the rollback path if copy / verify / reconcile fails.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirestoreCatalogWriterClosedError = exports.FIRESTORE_CATALOG_WRITERS = exports.CatalogWriterStateError = exports.CATALOG_WRITER_TRANSITIONS = exports.CATALOG_WRITER_AUTHORITY = void 0;
exports.assertCatalogWriterAuthorityCoherent = assertCatalogWriterAuthorityCoherent;
exports.assertCatalogWriterTransition = assertCatalogWriterTransition;
exports.assertFirestoreCatalogWriterOpen = assertFirestoreCatalogWriterOpen;
/** THE COMMITTED STATE. Change only through an allowed transition, with the authorization §5 requires. */
exports.CATALOG_WRITER_AUTHORITY = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });
exports.CATALOG_WRITER_TRANSITIONS = Object.freeze([
    Object.freeze({ name: "FREEZE", from: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }) }),
    Object.freeze({ name: "ROLLBACK_BEFORE_POSTGRES_WRITES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }) }),
    Object.freeze({ name: "ACTIVATE_POSTGRES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }) }),
    Object.freeze({ name: "RETIRE_FIRESTORE", from: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }), to: Object.freeze({ firestore: "RETIRED", postgres: "ACTIVE" }) }),
]);
class CatalogWriterStateError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CatalogWriterStateError";
    }
}
exports.CatalogWriterStateError = CatalogWriterStateError;
/** Exactly one authoritative writer set: OPEN only with INACTIVE, RETIRED only with ACTIVE. */
function assertCatalogWriterAuthorityCoherent(state) {
    const f = state?.firestore, p = state?.postgres;
    if (!["OPEN", "FROZEN", "RETIRED"].includes(f) || !["INACTIVE", "ACTIVE"].includes(p)) {
        throw new CatalogWriterStateError("CATALOG_WRITER_STATE_INVALID", "unknown catalog writer state");
    }
    if (f === "OPEN" && p === "ACTIVE")
        throw new CatalogWriterStateError("TWO_AUTHORITATIVE_WRITER_SETS", "Firestore OPEN with PostgreSQL ACTIVE would be two authoritative catalog writer sets");
    if (f === "RETIRED" && p === "INACTIVE")
        throw new CatalogWriterStateError("NO_AUTHORITATIVE_WRITER_SET", "Firestore RETIRED with PostgreSQL INACTIVE leaves no catalog writer at all");
}
/** A move is legal only if it is one of CATALOG_WRITER_TRANSITIONS; returns its name. */
function assertCatalogWriterTransition(from, to) {
    assertCatalogWriterAuthorityCoherent(from);
    assertCatalogWriterAuthorityCoherent(to);
    const match = exports.CATALOG_WRITER_TRANSITIONS.find((t) => t.from.firestore === from.firestore && t.from.postgres === from.postgres && t.to.firestore === to.firestore && t.to.postgres === to.postgres);
    if (!match) {
        const code = from.postgres === "ACTIVE" && to.firestore === "OPEN" ? "NO_SILENT_REVERT_TO_FIRESTORE" : "CATALOG_WRITER_TRANSITION_NOT_ALLOWED";
        throw new CatalogWriterStateError(code, `${from.firestore}/${from.postgres} -> ${to.firestore}/${to.postgres} is not an allowed catalog writer transition`);
    }
    return match.name;
}
/** Every legacy Firestore catalog MASTER writer, by id, with where it is reached from. */
exports.FIRESTORE_CATALOG_WRITERS = Object.freeze({
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
});
class FirestoreCatalogWriterClosedError extends Error {
    writer;
    state;
    code;
    constructor(writer, state) {
        super(state === "FROZEN"
            ? `the Firestore catalog writer ${writer} is frozen for the catalog cutover; no catalog master write is accepted until the cutover completes`
            : `the Firestore catalog writer ${writer} is retired; catalog master data is written through the PostgreSQL catalog authority`);
        this.writer = writer;
        this.state = state;
        this.name = "FirestoreCatalogWriterClosedError";
        this.code = state === "FROZEN" ? "FIRESTORE_CATALOG_WRITER_FROZEN" : "FIRESTORE_CATALOG_WRITER_RETIRED";
    }
}
exports.FirestoreCatalogWriterClosedError = FirestoreCatalogWriterClosedError;
/** First act of every legacy Firestore catalog master writer. A no-op only while Firestore is OPEN. */
function assertFirestoreCatalogWriterOpen(writer, authority = exports.CATALOG_WRITER_AUTHORITY) {
    if (!Object.prototype.hasOwnProperty.call(exports.FIRESTORE_CATALOG_WRITERS, writer)) {
        throw new Error(`unknown Firestore catalog writer ${String(writer)}`);
    }
    assertCatalogWriterAuthorityCoherent(authority);
    if (authority.firestore !== "OPEN")
        throw new FirestoreCatalogWriterClosedError(writer, authority.firestore);
}
//# sourceMappingURL=catalogWriterState.js.map