"use strict";
// FIRESTORE Truck Registry -> eos_ops `mobile_locations` / `trucks`: the MIGRATION SOURCE CONTRACT.
//
// MIGRATION_ONLY. Sibling of legacyInventoryMovementMapping.ts / inventoryWriterCapabilityCensus.ts:
// pure, no Firebase, no Firestore, no Postgres connection, no `pg` client, no filesystem, no clock,
// no randomness. It takes plain arrays of documents plus an already-parsed authored configuration
// object and returns a plan. It reads nothing and writes nothing.
//
// It answers exactly one question: MAY the truck/MOBILE-location import proceed, and if so, which
// rows would it write? Every answer is a restatement of the data it was handed plus the rulings
// below. It decides no business fact of its own -- in particular it never decides an operating
// company, it only looks one up.
//
// ============================ RULING: THE OPERATING COMPANY IS AUTHORED ============================
//
// Operating company is a MANDATORY inventory authority and is NEVER DERIVED. In particular it is
// never derived from `homeWarehouseId`, and the live sandbox proves the derivation WRONG rather
// than merely unprincipled: all five `cert-trk-01`..`cert-trk-05` MOBILE locations carry
// `homeWarehouseId: "wh-main"` -- a `taylor` warehouse -- while
// config/ownership/operating-company-roots.sandbox.json authors `cert-trk-04` and `cert-trk-05` as
// `ventana`. Two of five would be wrong.
//
// That configuration file forbids the inference in its own header ("THEY ARE NOT INFERRED, AND NO
// CODE MAY EVER INFER THEM ... If a rule appears to exist in the data below, it is a coincidence of
// authoring order and must not be implemented"), and it is the reason `resolveOperatingCompanyForMobileLocation`
// below takes a MOBILE location id and the authored configuration AND NOTHING ELSE. A warehouse id
// is not one of its parameters, and neither is the MOBILE location document, precisely so that no
// future edit can quietly reach for `homeWarehouseId`.
//
// This is the same shape scripts/employeeTruckCrosswalk.lib.mjs:38-57 already implements for the
// employee/truck crosswalk, deliberately so: the two are held to the same authored file by a parity
// test (test/truckFleetMigrationSource.test.mjs) rather than diverging into two company rules.
//
// MISSING and CONFLICT stay DISTINCT, and both REFUSE. "No authored mapping" and "the authoring
// contradicts itself" are different operator problems with different fixes, and collapsing them
// would hide which one happened.
//
// ============================ RULING: IDS ARE CARRIED, NEVER REWRITTEN ============================
//
// A MOBILE location id is operator-typed free text -- nothing in the product constructs one
// (functions/src/truckRegistry/validation.ts:39-50 accepts any non-empty trimmed string and it
// becomes the document key), and the live sandbox carries three unrelated conventions at once. The
// ids are already referenced by operational ledger evidence, so a "tidier" id would break the only
// link between a movement and the place it happened. This planner therefore copies every id
// verbatim and reports `idsRewritten: 0` as a checked fact, not as a promise.
//
// ============================ RULING: THE CLAIM COLLECTION IS EVIDENCE, NOT A TABLE ============================
//
// `location_truck_claims` exists solely because Firestore cannot express a cross-document 1:1
// (functions/src/truckRegistry/types.ts:7-9). Migration 008 expresses it as a partial UNIQUE index
// plus a composite foreign key, so there is nothing left for the claim to do. This planner reads
// every claim as EVIDENCE -- it must agree with the truck it names, in both directions -- and plans
// ZERO claim rows. A claim that disagrees with its truck is a refusal, because it means the two
// Firestore facts the import would have to choose between are not the same fact.
//
// ============================ WHAT THIS PLANNER DOES NOT CARRY ============================
//
// `assignedDriverEmployeeId`. The truck side of the driver relationship is real, but the identity on
// the other side of it is not settled in `eos_ops`, and choosing between `employees`,
// `fieldops_technicians` and `eos_policy.principals` is a decision about Employee identity rather
// than about Trucks (scripts/employeeTruckCrosswalk.lib.mjs:18-37 documents at length why a
// technician id must never be treated as an employee id). Migration 008 has no column for it, so
// this planner reports the count of trucks whose driver field is set -- as a HANDOFF FACT, so the
// number is visible and not silently dropped -- and plans no driver data.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPERATING_COMPANY_ID_PATTERN = exports.TRUCK_STATUSES = exports.TRUCK_FLEET_OUTCOMES = exports.MIGRATION_READINESS = exports.COMPANY_RESOLUTION = exports.MOBILE = void 0;
exports.isDefectOutcome = isDefectOutcome;
exports.isOperatingCompanyIdShape = isOperatingCompanyIdShape;
exports.loadOperatingCompanyRoots = loadOperatingCompanyRoots;
exports.resolveOperatingCompanyForMobileLocation = resolveOperatingCompanyForMobileLocation;
exports.planTruckFleetMigration = planTruckFleetMigration;
// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------
/** The physical movement type this planner may emit. Migration 008 CHECKs the same value. */
exports.MOBILE = "MOBILE";
/** Company resolution states. MISSING and CONFLICT are deliberately distinct -- see the header. */
exports.COMPANY_RESOLUTION = Object.freeze({
    RESOLVED: "RESOLVED",
    MISSING: "MISSING",
    CONFLICT: "CONFLICT",
});
/** A plan either proceeds or refuses. There is no "proceed with warnings". */
exports.MIGRATION_READINESS = Object.freeze({ PROCEED: "PROCEED", REFUSE: "REFUSE" });
/**
 * THE COMPLETE OUTCOME VOCABULARY. Exactly these terms; nothing else is ever emitted.
 *
 * `CLEAN` and `MOBILE_WITHOUT_TRUCK` are the two NON-DEFECT outcomes. The second one is an
 * observation, not a problem: 5 of the 7 live `mobile_locations` have no truck and no claim while
 * carrying 55 ledger references between them, and migration 008's link columns are nullable exactly
 * so those records import as what they are.
 */
exports.TRUCK_FLEET_OUTCOMES = Object.freeze({
    CLEAN: "CLEAN",
    MOBILE_WITHOUT_TRUCK: "MOBILE_WITHOUT_TRUCK",
    MISSING_OPERATING_COMPANY_MAPPING: "MISSING_OPERATING_COMPANY_MAPPING",
    CONFLICTING_OPERATING_COMPANY_CONFIGURATION: "CONFLICTING_OPERATING_COMPANY_CONFIGURATION",
    MALFORMED_MOBILE_LOCATION: "MALFORMED_MOBILE_LOCATION",
    MALFORMED_TRUCK: "MALFORMED_TRUCK",
    TRUCK_STATUS_CONTRADICTS_ACTIVE: "TRUCK_STATUS_CONTRADICTS_ACTIVE",
    TRUCK_LOCATION_NOT_FOUND: "TRUCK_LOCATION_NOT_FOUND",
    TRUCK_LOCATION_ALREADY_LINKED: "TRUCK_LOCATION_ALREADY_LINKED",
    CLAIM_WITHOUT_TRUCK: "CLAIM_WITHOUT_TRUCK",
    CLAIM_DISAGREES_WITH_TRUCK: "CLAIM_DISAGREES_WITH_TRUCK",
    MISSING_CLAIM_FOR_LINKED_TRUCK: "MISSING_CLAIM_FOR_LINKED_TRUCK",
    DUPLICATE_SOURCE_ID: "DUPLICATE_SOURCE_ID",
});
/** Kept as data rather than as an inline `!== CLEAN` so adding a term forces a decision here. */
const NON_DEFECT_OUTCOMES = new Set([
    exports.TRUCK_FLEET_OUTCOMES.CLEAN,
    exports.TRUCK_FLEET_OUTCOMES.MOBILE_WITHOUT_TRUCK,
]);
function isDefectOutcome(outcome) {
    return !NON_DEFECT_OUTCOMES.has(outcome);
}
/** The three truck statuses, exactly as functions/src/truckRegistry/types.ts:11-12 declares them. */
exports.TRUCK_STATUSES = ["ACTIVE", "IDLE", "OUT_OF_SERVICE"];
const DEACTIVATED_STATUS = "OUT_OF_SERVICE";
/**
 * The canonical operating-company id SHAPE, mirroring `isOperatingCompanyIdShape()` in
 * functions/src/ownership/operatingCompanyAuthority.ts:68-70. A shape check, never a membership
 * check: membership is `governedCompanyIds` from the authored file, checked separately, because the
 * ruling requires a new company to be addable without a code change.
 */
exports.OPERATING_COMPANY_ID_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;
function isOperatingCompanyIdShape(value) {
    return typeof value === "string" && exports.OPERATING_COMPANY_ID_PATTERN.test(value);
}
const nonEmptyString = (value) => typeof value === "string" && value.trim() !== "";
/**
 * Parse an authored operating-company roots document into the ONLY company truth this module has.
 *
 * `roots.mobile_locations` is the entire input. `roots.warehouses` is NOT read: a warehouse entry
 * could only ever be used to derive a truck's or a location's company, which is the forbidden
 * derivation. The document's own `derivedNotRoots.trucks` note (that 2/2 trucks derive from their
 * home warehouse) is a REFERENTIAL observation explaining why trucks are not authored roots -- it is
 * not a licence to perform that derivation, and nothing here reads it.
 *
 * Every malformed authoring is recorded and the affected id is marked `conflicted`, so it resolves
 * to CONFLICT rather than silently disappearing into MISSING.
 */
function loadOperatingCompanyRoots(document, options = {}) {
    const label = options.label ?? "operating-company-roots";
    const doc = (document ?? {});
    const rawGoverned = Array.isArray(doc.governedCompanyIds) ? doc.governedCompanyIds : [];
    const governedCompanyIds = new Set(rawGoverned.filter(isOperatingCompanyIdShape));
    const roots = (doc.roots ?? {});
    const entries = Array.isArray(roots.mobile_locations) ? roots.mobile_locations : [];
    const mobileLocations = new Map();
    const conflicts = [];
    for (const raw of entries) {
        const entry = (raw ?? {});
        const id = entry.id;
        const provenance = nonEmptyString(entry.provenance) ? entry.provenance : null;
        if (!nonEmptyString(id)) {
            conflicts.push({ mobileLocationId: null, reason: "AUTHORED_ENTRY_WITHOUT_ID" });
            continue;
        }
        const operatingCompanyId = entry.operatingCompanyId;
        if (!isOperatingCompanyIdShape(operatingCompanyId)) {
            conflicts.push({ mobileLocationId: id, reason: "AUTHORED_COMPANY_ID_MALFORMED", observed: operatingCompanyId ?? null });
            mobileLocations.set(id, { operatingCompanyId: null, provenance, conflicted: true });
            continue;
        }
        if (governedCompanyIds.size > 0 && !governedCompanyIds.has(operatingCompanyId)) {
            conflicts.push({ mobileLocationId: id, reason: "AUTHORED_COMPANY_ID_NOT_GOVERNED", observed: operatingCompanyId });
            mobileLocations.set(id, { operatingCompanyId: null, provenance, conflicted: true });
            continue;
        }
        const existing = mobileLocations.get(id);
        if (existing !== undefined && existing.operatingCompanyId !== operatingCompanyId) {
            conflicts.push({ mobileLocationId: id, reason: "AUTHORED_ID_ASSIGNED_TWICE", observed: operatingCompanyId });
            mobileLocations.set(id, { operatingCompanyId: null, provenance, conflicted: true });
            continue;
        }
        mobileLocations.set(id, { operatingCompanyId, provenance, conflicted: false });
    }
    return { label, governedCompanyIds, mobileLocations, conflicts };
}
/**
 * THE ONLY company resolver in this module.
 *
 * Its parameters are a MOBILE location id and the authored configuration. Not a warehouse id, not a
 * truck, not the location document -- see the header. There is no fallback, no default and no
 * "reasonable guess" branch; an id the configuration does not name resolves to MISSING and refuses
 * the migration.
 */
function resolveOperatingCompanyForMobileLocation(mobileLocationId, config) {
    if (!nonEmptyString(mobileLocationId)) {
        return { state: exports.COMPANY_RESOLUTION.MISSING, operatingCompanyId: null, provenance: null };
    }
    const authored = config.mobileLocations.get(mobileLocationId);
    if (authored === undefined) {
        return { state: exports.COMPANY_RESOLUTION.MISSING, operatingCompanyId: null, provenance: null };
    }
    if (authored.conflicted || authored.operatingCompanyId === null) {
        return { state: exports.COMPANY_RESOLUTION.CONFLICT, operatingCompanyId: null, provenance: authored.provenance };
    }
    return {
        state: exports.COMPANY_RESOLUTION.RESOLVED,
        operatingCompanyId: authored.operatingCompanyId,
        provenance: authored.provenance,
    };
}
// ---------------------------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------------------------
const isTruckStatus = (value) => typeof value === "string" && exports.TRUCK_STATUSES.includes(value);
/**
 * Plan the import. Deterministic: rows and defects are emitted in input order, and identical input
 * always yields an identical plan.
 *
 * REFUSAL IS THE DEFAULT POSTURE. Any defect at all sets readiness to REFUSE and the row arrays are
 * returned EMPTY -- a partial import of a registry whose invariants did not hold is how two
 * authorities for the same truck get created, which is the failure this whole packet exists to
 * avoid. The defect list names every problem in one pass so an operator fixes them together rather
 * than one rerun at a time.
 */
function planTruckFleetMigration(input) {
    const { tenantId, actorId, operatingCompanyConfig: config } = input;
    const defects = [];
    const observations = [];
    const defect = (outcome, subject, id, detail) => {
        defects.push({ outcome, subject, id, detail });
    };
    // ---- MOBILE locations ----
    const mobileRows = [];
    const mobileById = new Map();
    const companiesPlanned = {};
    for (const doc of input.mobileLocations) {
        const d = doc.data ?? {};
        if (!nonEmptyString(doc.id)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION, "MOBILE_LOCATION", String(doc.id), "blank document id");
            continue;
        }
        if (mobileById.has(doc.id)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.DUPLICATE_SOURCE_ID, "MOBILE_LOCATION", doc.id, "the same id appears twice in the source");
            continue;
        }
        // The stored `locationId` field must agree with the document key -- the same integrity check
        // mobileLocationFromFirestore (truckRegistryRepository.ts:82) makes before trusting a record.
        if (d.locationId !== undefined && d.locationId !== doc.id) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION, "MOBILE_LOCATION", doc.id, "stored locationId disagrees with the document key");
            continue;
        }
        if (d.type !== exports.MOBILE) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION, "MOBILE_LOCATION", doc.id, `type is ${String(d.type)}, not MOBILE`);
            continue;
        }
        if (!nonEmptyString(d.displayLabel)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION, "MOBILE_LOCATION", doc.id, "missing or blank displayLabel");
            continue;
        }
        if (typeof d.active !== "boolean") {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_MOBILE_LOCATION, "MOBILE_LOCATION", doc.id, "active is not a boolean");
            continue;
        }
        // THE company step. Note what is NOT passed in: no warehouse, no document.
        const company = resolveOperatingCompanyForMobileLocation(doc.id, config);
        if (company.state === exports.COMPANY_RESOLUTION.MISSING) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING, "MOBILE_LOCATION", doc.id, `${config.label} authors no operating company for this MOBILE location, and none will be inferred`);
            continue;
        }
        if (company.state === exports.COMPANY_RESOLUTION.CONFLICT) {
            defect(exports.TRUCK_FLEET_OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION, "MOBILE_LOCATION", doc.id, `${config.label} authors a malformed, ungoverned or contradictory operating company for this MOBILE location`);
            continue;
        }
        const row = {
            tenantId,
            locationType: exports.MOBILE,
            locationId: doc.id, // verbatim
            operatingCompanyKey: company.operatingCompanyId,
            displayLabel: d.displayLabel,
            active: d.active,
            createdBy: actorId,
            updatedBy: actorId,
        };
        mobileRows.push(row);
        mobileById.set(doc.id, row);
        companiesPlanned[row.operatingCompanyKey] = (companiesPlanned[row.operatingCompanyKey] ?? 0) + 1;
    }
    // ---- trucks ----
    const truckRows = [];
    const truckById = new Map();
    const truckByLocationId = new Map();
    let trucksWithDriverNotCarried = 0;
    for (const doc of input.trucks) {
        const d = doc.data ?? {};
        if (!nonEmptyString(doc.id)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_TRUCK, "TRUCK", String(doc.id), "blank document id");
            continue;
        }
        if (truckById.has(doc.id)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.DUPLICATE_SOURCE_ID, "TRUCK", doc.id, "the same id appears twice in the source");
            continue;
        }
        if (d.truckId !== undefined && d.truckId !== doc.id) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_TRUCK, "TRUCK", doc.id, "stored truckId disagrees with the document key");
            continue;
        }
        if (!nonEmptyString(d.vehicleNumber)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_TRUCK, "TRUCK", doc.id, "missing or blank vehicleNumber");
            continue;
        }
        if (!nonEmptyString(d.displayLabel)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_TRUCK, "TRUCK", doc.id, "missing or blank displayLabel");
            continue;
        }
        if (!nonEmptyString(d.homeWarehouseId)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_TRUCK, "TRUCK", doc.id, "missing or blank homeWarehouseId");
            continue;
        }
        if (!isTruckStatus(d.status)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_TRUCK, "TRUCK", doc.id, `status is ${String(d.status)}, not one of ${exports.TRUCK_STATUSES.join("|")}`);
            continue;
        }
        if (typeof d.active !== "boolean") {
            defect(exports.TRUCK_FLEET_OUTCOMES.MALFORMED_TRUCK, "TRUCK", doc.id, "active is not a boolean");
            continue;
        }
        // The biconditional migration 008 CHECKs. Caught here so a contradictory legacy record is named
        // in a defect list rather than exploding as a constraint violation halfway through an import.
        if ((d.status === DEACTIVATED_STATUS) !== (d.active === false)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.TRUCK_STATUS_CONTRADICTS_ACTIVE, "TRUCK", doc.id, `status ${d.status} with active=${String(d.active)} is a state the governed commands cannot produce`);
            continue;
        }
        if (nonEmptyString(d.assignedDriverEmployeeId))
            trucksWithDriverNotCarried += 1;
        // ---- the link ----
        let mobileLocationId = null;
        if (nonEmptyString(d.locationId)) {
            if (!mobileById.has(d.locationId)) {
                defect(exports.TRUCK_FLEET_OUTCOMES.TRUCK_LOCATION_NOT_FOUND, "TRUCK", doc.id, `locationId ${d.locationId} names no importable mobile_location`);
                continue;
            }
            const incumbent = truckByLocationId.get(d.locationId);
            if (incumbent !== undefined) {
                defect(exports.TRUCK_FLEET_OUTCOMES.TRUCK_LOCATION_ALREADY_LINKED, "TRUCK", doc.id, `MOBILE location ${d.locationId} is already linked by truck ${incumbent}; the 1:1 does not hold in the source`);
                continue;
            }
            mobileLocationId = d.locationId;
            truckByLocationId.set(d.locationId, doc.id);
        }
        const row = {
            tenantId,
            truckId: doc.id, // verbatim
            vehicleNumber: d.vehicleNumber,
            displayLabel: d.displayLabel,
            status: d.status,
            active: d.active,
            homeWarehouseId: d.homeWarehouseId,
            mobileLocationType: mobileLocationId === null ? null : exports.MOBILE,
            mobileLocationId,
            createdBy: actorId,
            updatedBy: actorId,
        };
        truckRows.push(row);
        truckById.set(doc.id, row);
    }
    // ---- claims: read as evidence, planned as nothing ----
    let claimsReconciled = 0;
    const claimedLocationIds = new Set();
    for (const doc of input.claims) {
        const d = doc.data ?? {};
        const locationId = doc.id;
        const claimedTruckId = d.truckId;
        if (!nonEmptyString(locationId) || !nonEmptyString(claimedTruckId)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.CLAIM_DISAGREES_WITH_TRUCK, "CLAIM", String(locationId), "claim carries no usable locationId/truckId pair");
            continue;
        }
        if (d.locationId !== undefined && d.locationId !== locationId) {
            defect(exports.TRUCK_FLEET_OUTCOMES.CLAIM_DISAGREES_WITH_TRUCK, "CLAIM", locationId, "stored locationId disagrees with the document key");
            continue;
        }
        claimedLocationIds.add(locationId);
        const truck = truckById.get(claimedTruckId);
        if (truck === undefined) {
            defect(exports.TRUCK_FLEET_OUTCOMES.CLAIM_WITHOUT_TRUCK, "CLAIM", locationId, `claim names truck ${claimedTruckId}, which is not importable`);
            continue;
        }
        if (truck.mobileLocationId !== locationId) {
            defect(exports.TRUCK_FLEET_OUTCOMES.CLAIM_DISAGREES_WITH_TRUCK, "CLAIM", locationId, `claim says truck ${claimedTruckId} holds this location, but that truck links to ${String(truck.mobileLocationId)}`);
            continue;
        }
        claimsReconciled += 1;
    }
    // Every linked truck must be backed by a claim: in the source that link IS the claim, so a link
    // without one means the Firestore invariant was already broken.
    for (const row of truckRows) {
        if (row.mobileLocationId !== null && !claimedLocationIds.has(row.mobileLocationId)) {
            defect(exports.TRUCK_FLEET_OUTCOMES.MISSING_CLAIM_FOR_LINKED_TRUCK, "TRUCK", row.truckId, `truck links MOBILE location ${row.mobileLocationId} but no location_truck_claims document guards it`);
        }
    }
    // ---- observations (non-defects) ----
    for (const row of mobileRows) {
        if (!truckByLocationId.has(row.locationId)) {
            observations.push({ outcome: exports.TRUCK_FLEET_OUTCOMES.MOBILE_WITHOUT_TRUCK, subject: "MOBILE_LOCATION", id: row.locationId });
        }
    }
    // ---- reconciliation ----
    const linkedTrucks = truckRows.filter((r) => r.mobileLocationId !== null).length;
    // A CHECKED fact, not a promise: every planned id must be an id that arrived in the source. A
    // future edit that normalized, prefixed or regenerated an id would make this non-zero and unbalance
    // the plan, rather than silently shipping records the ledger can no longer find.
    const sourceMobileIds = new Set(input.mobileLocations.map((d) => d.id));
    const sourceTruckIds = new Set(input.trucks.map((d) => d.id));
    const idsRewritten = mobileRows.filter((r) => !sourceMobileIds.has(r.locationId)).length +
        truckRows.filter((r) => !sourceTruckIds.has(r.truckId)).length +
        truckRows.filter((r) => r.mobileLocationId !== null && !sourceMobileIds.has(r.mobileLocationId)).length;
    const refuse = defects.length > 0;
    const balanced = !refuse &&
        mobileRows.length === input.mobileLocations.length &&
        truckRows.length === input.trucks.length &&
        claimsReconciled === input.claims.length &&
        linkedTrucks === claimsReconciled &&
        idsRewritten === 0;
    const reconciliation = {
        mobileLocationsIn: input.mobileLocations.length,
        mobileLocationsPlanned: refuse ? 0 : mobileRows.length,
        trucksIn: input.trucks.length,
        trucksPlanned: refuse ? 0 : truckRows.length,
        claimsIn: input.claims.length,
        claimsReconciled,
        claimRowsPlanned: 0,
        linkedTrucks: refuse ? 0 : linkedTrucks,
        unlinkedTrucks: refuse ? 0 : truckRows.length - linkedTrucks,
        mobileLocationsWithoutTruck: observations.length,
        idsRewritten,
        companiesPlanned: refuse ? Object.freeze({}) : Object.freeze({ ...companiesPlanned }),
        homeWarehouseIdUsedForCompany: false,
        trucksWithDriverNotCarried,
        balanced,
    };
    return {
        readiness: refuse ? exports.MIGRATION_READINESS.REFUSE : exports.MIGRATION_READINESS.PROCEED,
        mobileLocationRows: refuse ? [] : Object.freeze(mobileRows.slice()),
        truckRows: refuse ? [] : Object.freeze(truckRows.slice()),
        defects: Object.freeze(defects.slice()),
        observations: Object.freeze(observations.slice()),
        reconciliation,
    };
}
//# sourceMappingURL=truckFleetMigrationSource.js.map