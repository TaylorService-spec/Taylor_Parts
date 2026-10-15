"use strict";
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
//                                Supplier, Part Alias, Part-Supplier Item, Equipment Model Alias, and the
//                                Part <-> Equipment compatibility relationship and its evidence). Reversible -- but
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogMutationHeldError = exports.CATALOG_MUTATION_HOLD = exports.CATALOG_MUTATION_HOLD_REASON = exports.PostgresCatalogWriterInactiveError = exports.FirestoreCatalogNotCurrentError = exports.FIRESTORE_CATALOG_READERS = exports.FirestoreCatalogWriterClosedError = exports.FIRESTORE_CATALOG_WRITERS = exports.CatalogWriterStateError = exports.CATALOG_WRITER_TRANSITIONS = exports.CATALOG_WRITER_AUTHORITY = void 0;
exports.assertCatalogWriterAuthorityCoherent = assertCatalogWriterAuthorityCoherent;
exports.assertCatalogWriterTransition = assertCatalogWriterTransition;
exports.assertFirestoreCatalogWriterOpen = assertFirestoreCatalogWriterOpen;
exports.assertFirestoreCatalogReadCurrent = assertFirestoreCatalogReadCurrent;
exports.assertPostgresCatalogActive = assertPostgresCatalogActive;
exports.assertCatalogMutationNotHeld = assertCatalogMutationNotHeld;
/** THE COMMITTED STATE. Change only through an allowed transition, with the authorization §5 requires. */
// FREEZE (Controller ruling 2026-09-28, activation window step 2): OPEN/INACTIVE -> FROZEN/INACTIVE, the declared FREEZE
// transition. PostgreSQL stays INACTIVE -- and the Render Catalog transport therefore refuses (assertPostgresCatalogActive)
// -- until the verified COPY and the separate ACTIVATE_POSTGRES change (window step 18).
// ACTIVATE_POSTGRES (Controller ruling 2026-09-28, activation window step 18): FROZEN/INACTIVE -> FROZEN/ACTIVE, taken only
// after the Catalog COPY is verified. The Render Catalog transport answers from here on; Firestore stays FROZEN.
exports.CATALOG_WRITER_AUTHORITY = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });
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
    // THE JOB-LEVEL PART IMPORT WRITER. `part.create` above already guards every individual row, because
    // Data Import calls the governed createPart rather than writing Parts itself. This id exists because a
    // per-row guard is the wrong SHAPE for an import: a frozen catalog would let an administrator approve a
    // 400-row Parts job, claim it, and then fail all 400 rows one at a time, which reads as a broken import
    // rather than as "this runtime no longer writes Parts". The CRM cutover already settled this shape for
    // `account.import` (crm/crmWriterState.ts); Catalog follows it rather than inventing a second one.
    "part.import": Object.freeze({
        module: "functions/src/dataImport/dataImportCallables.ts",
        entry: "executeDataImportCallable (entityType PARTS), refused before the job is claimed and before any row is written",
        reachedFrom: Object.freeze([
            "callable executeDataImport (functions/src/index.ts -> dataImportCallables.ts) with a staged PARTS job",
            "client field-ops-app-vite/src/services/access/dataImportClient.js (executeDataImport)",
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
    // ──────────────── Part <-> Equipment COMPATIBILITY (Owner ruling, 2026-09-23) ────────────────
    //
    // "PART <-> EQUIPMENT COMPATIBILITY WRITERS -- these are persisted Catalog/reference authority.
    // INCLUDE them in CATALOG_WRITER_AUTHORITY and the same Firestore Catalog freeze boundary. A Catalog
    // freeze must prevent compatibility relationships from changing while Catalog master data is frozen."
    //
    // An earlier completeness pass called these borderline and left them out on the theory that a
    // relationship record is not master data. The ruling settles it, and the code agrees: the
    // compatibility record is persisted, versioned, company-neutral reference configuration keyed on two
    // catalog identities (equipmentModelId + partId), it is written by the same command orchestrator and
    // the same two-transaction machinery as equipmentModel.import, and `importCompatibilitySource` does
    // not merely append evidence -- planMutation's importCompatibilitySource branch stages
    // `compatibility.stageUpdate(...)` on the relationship itself (verificationStatus -> CONFLICT,
    // version + 1) when the governed analyzer finds contradicting evidence. So evidence is a compatibility
    // WRITER too, and leaving it open would leave a path that changes a frozen relationship.
    //
    // `equipment_compatibility_operations` (the idempotency/state ledger) is NOT a writer here: it is the
    // command's own bookkeeping, never catalog data, and it is written only as part of an action that is
    // already gated above.
    "equipmentPartCompatibility.import": Object.freeze({
        module: "functions/src/equipmentCompatibility/commands.ts",
        entry: "runEquipmentCompatibilityCommand (action importCompatibility)",
        reachedFrom: Object.freeze([
            "no deployed callable exports it (functions/src/index.ts); reached only by tests and operator code",
        ]),
    }),
    "equipmentPartCompatibility.verify": Object.freeze({
        module: "functions/src/equipmentCompatibility/commands.ts",
        entry: "runEquipmentCompatibilityCommand (action verifyCompatibility)",
        reachedFrom: Object.freeze([
            "no deployed callable exports it (functions/src/index.ts); reached only by tests and operator code",
        ]),
    }),
    "equipmentPartCompatibility.correct": Object.freeze({
        module: "functions/src/equipmentCompatibility/commands.ts",
        entry: "runEquipmentCompatibilityCommand (action correctCompatibility)",
        reachedFrom: Object.freeze([
            "no deployed callable exports it (functions/src/index.ts); reached only by tests and operator code",
        ]),
    }),
    "equipmentCompatibilitySource.import": Object.freeze({
        module: "functions/src/equipmentCompatibility/commands.ts",
        entry: "runEquipmentCompatibilityCommand (action importCompatibilitySource)",
        reachedFrom: Object.freeze([
            "no deployed callable exports it (functions/src/index.ts); reached only by tests and operator code",
            "writes `equipment_compatibility_sources` AND, on a governed conflict, updates the cited `equipment_part_compatibility` record",
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
// ════════════════════ THE READ SIDE: WHEN A FIRESTORE CATALOG READ STOPS BEING TRUE ════════════════════
//
// Everything above governs WRITERS. A reader needs its own rule, because the two stop being safe at
// DIFFERENT MOMENTS, and collapsing them would be wrong in both directions.
//
//   FROZEN/INACTIVE  the legacy writers refuse, but Firestore is STILL THE AUTHORITY -- it simply is not
//                    accepting changes. A read here is current truth, and it must stay legal: this is the
//                    rollback window, and a reader that refused during it would take the whole platform
//                    down for a migration that has not happened yet and might be rolled back.
//   FROZEN/ACTIVE    PostgreSQL has accepted authoritative writes. From this instant the Firestore copy is
//                    a SNAPSHOT of a past state. Every read of it is a stale read presented as current.
//
// So the read guard keys on `postgres === "ACTIVE"`, not on the Firestore state. A reader that cannot
// reach PostgreSQL from its own runtime -- which is every Firebase Functions reader, because a Firebase
// Function calling Render or opening a PostgreSQL pool is the forbidden bridge -- has exactly one honest
// answer left, and it is to say it does not know.
//
// THIS IS THE PROJECTION RULE, ENFORCED. catalogActivationLedger.ts states it
// (CONSUME_POSTGRES_CATALOG | REPORT_UNAVAILABLE, never READ_FROZEN_FIRESTORE_CATALOG); a rule with no
// executable guard behind it is a comment. A stale read is the one failure here that looks like success:
// a balance computed from last month's controlType, or an import resolved against Parts that have since
// been renamed, is indistinguishable from a correct one to the person reading it.
/** Every deployed Firestore catalog READ whose answer stops being current truth at PostgreSQL activation. */
exports.FIRESTORE_CATALOG_READERS = Object.freeze({
    "dataImport.inventory.partReference": Object.freeze({
        module: "functions/src/dataImport/firestoreInventoryImportAdapters.ts",
        entry: "loadInventoryReferences / opening-balance Part resolution",
        fact: "Part existence and internalPartNumber, to resolve an opening-balance row's Part reference",
    }),
    "ai.workOrderReadiness.controlType": Object.freeze({
        module: "functions/src/ai/workOrderReadinessContext.ts",
        entry: "buildWorkOrderReadinessDeps().loadBalances",
        fact: "Part.controlType for each planned part, to shape that part's balance projection",
    }),
    "inventory.partBalance.controlType": Object.freeze({
        module: "functions/src/inventory/partBalanceReadService.ts",
        entry: "getPartBalanceCallable / readPartBalances",
        fact: "Part.controlType -- whether the Part is counted by quantity or by serial, which decides the SHAPE of the answer",
    }),
});
/**
 * The Catalog authority has moved to PostgreSQL and this runtime cannot reach it.
 *
 * `CATALOG_AUTHORITY_MOVED` is deliberately NOT one of the writer codes. "Frozen" and "retired" describe
 * what happened to the WRITER; this describes what happened to the TRUTH, and a caller that wants to tell
 * a person why a number is missing needs the second sentence, not the first.
 */
class FirestoreCatalogNotCurrentError extends Error {
    reader;
    code = "CATALOG_AUTHORITY_MOVED";
    constructor(reader) {
        super(`the catalog authority has moved to PostgreSQL; ${reader} reads the frozen Firestore catalog, which is no `
            + "longer current truth, and this runtime cannot reach the PostgreSQL catalog");
        this.reader = reader;
        this.name = "FirestoreCatalogNotCurrentError";
    }
}
exports.FirestoreCatalogNotCurrentError = FirestoreCatalogNotCurrentError;
/** First act of every deployed Firestore catalog READ. A no-op until PostgreSQL is ACTIVE. */
function assertFirestoreCatalogReadCurrent(reader, authority = exports.CATALOG_WRITER_AUTHORITY) {
    if (!Object.prototype.hasOwnProperty.call(exports.FIRESTORE_CATALOG_READERS, reader)) {
        throw new Error(`unknown Firestore catalog reader ${String(reader)}`);
    }
    assertCatalogWriterAuthorityCoherent(authority);
    if (authority.postgres === "ACTIVE")
        throw new FirestoreCatalogNotCurrentError(reader);
}
// ════════════════════ the PostgreSQL side: the Render Catalog transport is gated too ════════════════════
//
// The Firestore guards above stop the LEGACY writers. This is the other half: until the ACTIVATE_POSTGRES transition is
// committed, the Render Catalog transport refuses every operation, so no PostgreSQL Catalog write can land between the
// integration deploy and the verified COPY (a write there would make the COPY refuse a tenant row the snapshot does not
// contain). Mirrors crm/crmWriterState.ts assertPostgresCrmWriterActive -- the same boundary, the same shape.
class PostgresCatalogWriterInactiveError extends Error {
    writer;
    code = "POSTGRES_CATALOG_INACTIVE";
    constructor(writer) {
        super(`the PostgreSQL Catalog authority is not active yet (${writer}); the Catalog cutover has not activated it`);
        this.writer = writer;
        this.name = "PostgresCatalogWriterInactiveError";
    }
}
exports.PostgresCatalogWriterInactiveError = PostgresCatalogWriterInactiveError;
function assertPostgresCatalogActive(writer, authority = exports.CATALOG_WRITER_AUTHORITY) {
    assertCatalogWriterAuthorityCoherent(authority);
    if (authority.postgres !== "ACTIVE")
        throw new PostgresCatalogWriterInactiveError(writer);
}
exports.CATALOG_MUTATION_HOLD_REASON = "DQ-034: active release-journey readers still read the frozen Firebase catalog";
/**
 * THE COMMITTED HOLD. Lifted only by a reviewed code change, with the §5.4 evidence.
 * DQ-034 LIFTED 2026-10-01 (Owner rulings INVENTORY / WAREHOUSE ACTIVATION + GLOBAL FIREBASE DATA CLASSIFICATION): (a) the deployed client ce2a890 reaches no Firebase Catalog reader in any release journey -- Transfer / relocation / cycle count / acquire are EOS, canonical Receiving, the scanner lookup and part balance are gated OFF everywhere, the Work Order install client has no caller; (b) a fresh read-only export (sha256 310b34be...) VERIFIES --sample all with canonical digest a2a30e3c... == the activation digest.
 */
exports.CATALOG_MUTATION_HOLD = Object.freeze({
    held: false,
    ruling: "DQ-034",
    reason: exports.CATALOG_MUTATION_HOLD_REASON,
});
class CatalogMutationHeldError extends Error {
    operation;
    reason;
    code = "CATALOG_MUTATION_HELD";
    constructor(operation, reason) {
        super(`Catalog changes are paused during the migration (${operation} refused): ${reason}`);
        this.operation = operation;
        this.reason = reason;
        this.name = "CatalogMutationHeldError";
    }
}
exports.CatalogMutationHeldError = CatalogMutationHeldError;
/** First act of every PostgreSQL Catalog mutation the transport dispatches. A no-op only when the hold is lifted. */
function assertCatalogMutationNotHeld(operation, hold = exports.CATALOG_MUTATION_HOLD) {
    if (hold?.held !== false)
        throw new CatalogMutationHeldError(operation, hold?.reason ?? exports.CATALOG_MUTATION_HOLD_REASON);
}
//# sourceMappingURL=catalogWriterState.js.map