// P1B — EMPLOYEE / TRUCK / MOBILE CROSSWALK. The pure analyzer.
//
// ============================ WHAT THIS IS ============================
//
// Migration-only evidence tooling. It produces ONE deterministic crosswalk:
//
//   Firebase UID -> Employee id -> fieldops technician id (if present)
//                -> Truck assignment -> MOBILE id -> explicit operating company config
//
// It exists to let a migration decide whether it may proceed. It is NOT a runtime module, it is
// NOT imported by functions/src, and it decides no business fact of its own. Every conclusion it
// reaches is a restatement of data it was handed plus the two authoritative rulings below.
//
// READ-ONLY, ALWAYS. This module takes plain arrays and returns a plain object. It opens no
// connection, holds no credential, and has no write path of any kind. The operator entry point
// (scripts/employeeTruckCrosswalk.mjs) is the only file that touches Firestore, and it only reads.
//
// ============================ RULING R4 — EMPLOYEE / IDENTITY ============================
//
// The canonical business Employee is `employees`. Security identity is `eos_policy.principals`.
// A Firebase UID is an EXTERNAL IDENTITY KEY ONLY — it is the (identity_provider,
// external_subject) side of the principal mapping (functions/migrations/
// 1757548800000_tenant-and-identity.sql), never an EOS-native identifier.
//
// `fieldops_technicians` is TEMPORARY COMPATIBILITY / OPERATIONAL PROJECTION. It must not remain
// assignment or employee-identity authority, so this analyzer:
//
//   * never copies a technician id into an Employee field. `employeeId` on a crosswalk row is
//     only ever an id that was found in `employees`, or null. There is no fallback chain that
//     ends at a technician id — see resolveIdentityRow(), where `technicianId` is carried in its
//     own field and is never assigned to `employeeId`;
//   * reports a technician id that coincides with an employee id as a COINCIDENCE
//     (`technicianIdMatchesEmployeeId`), not as a derivation. 11 of the 13 sandbox technician ids
//     happen to equal employee ids. That is authoring history, not a rule, and a migration that
//     implements it as a rule breaks on `tech-sbx-01` / `tech-sbx-02`;
//   * classifies a technician with no corresponding Employee as ORPHAN_TECHNICIAN rather than
//     minting an Employee for it. Minting is a decision this tool is not allowed to make.
//
// ============================ RULING R5 — OPERATING COMPANY ============================
//
// Operating company is a MANDATORY inventory authority, and it is NEVER DERIVED. In particular it
// is never derived from `homeWarehouseId`.
//
// config/ownership/operating-company-roots.sandbox.json says this in its own header ("THEY ARE NOT
// INFERRED, AND NO CODE MAY EVER INFER THEM ... If a rule appears to exist in the data below, it
// is a coincidence of authoring order and must not be implemented"), and the sandbox data proves
// why: all five `cert-trk-01`..`cert-trk-05` MOBILE locations carry `homeWarehouseId: "wh-main"`,
// which is a `taylor` warehouse — while the authored configuration assigns `cert-trk-04` and
// `cert-trk-05` to `ventana`. A homeWarehouseId-derived answer is provably wrong for 2 of the 5.
//
// So `resolveOperatingCompanyForMobileLocation()` below takes a MOBILE id and the authored
// configuration, and nothing else. A warehouse id is not one of its parameters, and the MOBILE
// location record is not one of its parameters, precisely so that no future edit can quietly reach
// for `homeWarehouseId`. When no authored mapping exists the answer is MISSING — never a guess —
// and the crosswalk emits MISSING_OPERATING_COMPANY_MAPPING, which refuses the migration.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");
export const OPERATING_COMPANY_ROOTS_SANDBOX = join(
  REPO_ROOT,
  "config/ownership/operating-company-roots.sandbox.json",
);

// ---------------------------------------------------------------------------------------------
// Collections. Named exactly as functions/src/truckRegistry/truckRegistryRepository.ts names them
// so a reader can check the two against each other without guessing.
// ---------------------------------------------------------------------------------------------

export const COLLECTIONS = Object.freeze({
  EMPLOYEES: "employees",
  USERS: "users",
  TECHNICIANS: "fieldops_technicians",
  TRUCKS: "trucks",
  MOBILE_LOCATIONS: "mobile_locations",
  LOCATION_TRUCK_CLAIMS: "location_truck_claims",
});

/**
 * THE COMPLETE OUTCOME VOCABULARY. Exactly these eight terms; nothing else is ever emitted in a
 * row's `outcomes`. A row that is defect-free still gets a `disposition` (CLEAN / FLAGGED), so
 * every row is classified without inventing a ninth term to mean "fine".
 */
export const OUTCOMES = Object.freeze({
  CLEAN_EMPLOYEE_MAPPING: "CLEAN_EMPLOYEE_MAPPING",
  ORPHAN_TECHNICIAN: "ORPHAN_TECHNICIAN",
  EMPLOYEE_WITHOUT_UID: "EMPLOYEE_WITHOUT_UID",
  UID_WITHOUT_EMPLOYEE: "UID_WITHOUT_EMPLOYEE",
  TRUCK_ASSIGNED_TO_UNKNOWN_EMPLOYEE: "TRUCK_ASSIGNED_TO_UNKNOWN_EMPLOYEE",
  MOBILE_WITHOUT_TRUCK: "MOBILE_WITHOUT_TRUCK",
  MISSING_OPERATING_COMPANY_MAPPING: "MISSING_OPERATING_COMPANY_MAPPING",
  CONFLICTING_OPERATING_COMPANY_CONFIGURATION: "CONFLICTING_OPERATING_COMPANY_CONFIGURATION",
});

export const OUTCOME_VALUES = Object.freeze(Object.values(OUTCOMES));

/**
 * CLEAN_EMPLOYEE_MAPPING is the one outcome that is not a defect. Every other outcome flags the
 * row. Kept as data rather than as an inline `!== CLEAN` so adding a term forces a decision here.
 */
const NON_DEFECT_OUTCOMES = new Set([OUTCOMES.CLEAN_EMPLOYEE_MAPPING]);

/**
 * Row families. Rows are emitted IDENTITY, then TRUCK, then MOBILE, each family sorted by `key`.
 * Output determinism depends on exactly that, and is asserted by the test suite.
 */
export const ROW_TYPES = Object.freeze({ IDENTITY: "IDENTITY", TRUCK: "TRUCK", MOBILE: "MOBILE" });

/** Company resolution states. MISSING and CONFLICT are deliberately distinct — see R5. */
export const COMPANY_RESOLUTION = Object.freeze({
  RESOLVED: "RESOLVED",
  MISSING: "MISSING",
  CONFLICT: "CONFLICT",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

/** R5 refuses a migration that cannot name every operating company from authored configuration. */
export const MIGRATION_READINESS = Object.freeze({ PROCEED: "PROCEED", REFUSE: "REFUSE" });

/**
 * The canonical operating-company id SHAPE, mirroring isOperatingCompanyIdShape() in
 * functions/src/ownership/operatingCompanyAuthority.ts. A shape check, never a membership check:
 * membership is `governedCompanyIds` from the authored configuration, checked separately, because
 * the ruling requires a new company to be addable without a code change.
 */
export const OPERATING_COMPANY_ID_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;

export function isOperatingCompanyIdShape(value) {
  return typeof value === "string" && OPERATING_COMPANY_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------------------------
// Authored operating-company configuration
// ---------------------------------------------------------------------------------------------

const nonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Parse an authored operating-company roots document into the ONLY company truth this tool has.
 *
 * `mobileLocations` is a Map<mobileLocationId, {operatingCompanyId, provenance}> built from the
 * file's `roots.mobile_locations` entries and nothing else. `roots.warehouses` is read only to
 * report coverage; it is deliberately NOT indexed into any lookup a MOBILE location could reach,
 * because that index is exactly the shape a homeWarehouseId derivation would take.
 *
 * `derivedNotRoots` in the file (which records that trucks "derive from homeWarehouseId") is a
 * note about why trucks are not authored roots. It is NOT a licence to perform that derivation and
 * is not loaded into any resolver here.
 *
 * Conflicts are detected, never resolved: two entries for one id that disagree, an id whose
 * company is malformed, and an id whose company is outside `governedCompanyIds` all produce a
 * CONFLICT for that id rather than a winner.
 */
export function loadOperatingCompanyConfig(
  source = OPERATING_COMPANY_ROOTS_SANDBOX,
  { label = null } = {},
) {
  const document = typeof source === "string" ? JSON.parse(readFileSync(source, "utf8")) : source;
  const configLabel = label ?? (typeof source === "string" ? source : (document?.environment ?? "(inline)"));

  const governed = Array.isArray(document?.governedCompanyIds) ? document.governedCompanyIds : [];
  const governedCompanyIds = new Set(governed.filter(nonEmptyString));

  const mobileLocations = new Map();
  const conflicts = [];
  const entries = Array.isArray(document?.roots?.mobile_locations) ? document.roots.mobile_locations : [];

  for (const entry of entries) {
    const id = entry?.id;
    if (!nonEmptyString(id)) {
      conflicts.push({ mobileLocationId: null, reason: "AUTHORED_ENTRY_WITHOUT_ID" });
      continue;
    }
    const operatingCompanyId = entry?.operatingCompanyId;
    if (!isOperatingCompanyIdShape(operatingCompanyId)) {
      conflicts.push({ mobileLocationId: id, reason: "AUTHORED_COMPANY_ID_MALFORMED", observed: operatingCompanyId ?? null });
      mobileLocations.set(id, { operatingCompanyId: null, provenance: entry?.provenance ?? null, conflicted: true });
      continue;
    }
    if (governedCompanyIds.size > 0 && !governedCompanyIds.has(operatingCompanyId)) {
      conflicts.push({ mobileLocationId: id, reason: "AUTHORED_COMPANY_ID_NOT_GOVERNED", observed: operatingCompanyId });
      mobileLocations.set(id, { operatingCompanyId: null, provenance: entry?.provenance ?? null, conflicted: true });
      continue;
    }
    const existing = mobileLocations.get(id);
    if (existing && existing.operatingCompanyId !== operatingCompanyId) {
      conflicts.push({
        mobileLocationId: id,
        reason: "AUTHORED_DUPLICATE_DISAGREES",
        observed: [existing.operatingCompanyId, operatingCompanyId].filter(Boolean).sort(),
      });
      mobileLocations.set(id, { operatingCompanyId: null, provenance: entry?.provenance ?? null, conflicted: true });
      continue;
    }
    if (existing?.conflicted) continue;
    mobileLocations.set(id, { operatingCompanyId, provenance: entry?.provenance ?? null, conflicted: false });
  }

  const warehouseCount = Array.isArray(document?.roots?.warehouses) ? document.roots.warehouses.length : 0;

  return Object.freeze({
    label: configLabel,
    environment: document?.environment ?? null,
    status: document?.status ?? null,
    governedCompanyIds: Object.freeze([...governedCompanyIds].sort()),
    mobileLocations,
    authoredMobileLocationCount: mobileLocations.size,
    authoredWarehouseCount: warehouseCount,
    conflicts: Object.freeze(conflicts),
  });
}

/** An empty authored configuration — every MOBILE id resolves MISSING. Used by tests and as the
 *  honest default when an operator names no config file. */
export function emptyOperatingCompanyConfig(label = "(no authored configuration)") {
  return loadOperatingCompanyConfig({ environment: null, status: null, governedCompanyIds: [], roots: {} }, { label });
}

/**
 * THE ONLY company resolver. Takes a MOBILE location id and the authored configuration.
 *
 * It deliberately accepts no record, no warehouse id and no truck — there is nothing in scope here
 * to derive from, which is how R5 is enforced structurally rather than by comment. An id with no
 * authored entry is MISSING, full stop.
 */
export function resolveOperatingCompanyForMobileLocation(mobileLocationId, config) {
  if (!nonEmptyString(mobileLocationId)) {
    return { state: COMPANY_RESOLUTION.NOT_APPLICABLE, operatingCompanyId: null, provenance: null };
  }
  const authored = config.mobileLocations.get(mobileLocationId);
  if (authored === undefined) {
    return { state: COMPANY_RESOLUTION.MISSING, operatingCompanyId: null, provenance: null };
  }
  if (authored.conflicted || authored.operatingCompanyId === null) {
    return { state: COMPANY_RESOLUTION.CONFLICT, operatingCompanyId: null, provenance: authored.provenance ?? null };
  }
  return {
    state: COMPANY_RESOLUTION.RESOLVED,
    operatingCompanyId: authored.operatingCompanyId,
    provenance: authored.provenance ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Input normalization. Every collection arrives as [{ id, data }] — the exact shape a read-only
// Firestore QuerySnapshot yields (doc.id / doc.data()) and the exact shape a fixture can be
// written by hand. No Firestore type ever crosses into this module.
// ---------------------------------------------------------------------------------------------

function indexById(records) {
  const map = new Map();
  for (const record of records ?? []) {
    if (!nonEmptyString(record?.id)) continue;
    map.set(record.id, record.data ?? {});
  }
  return map;
}

const stringOrNull = (value) => (nonEmptyString(value) ? value : null);

/**
 * Every row gets a disposition, so "classify every row" holds without inventing a ninth outcome
 * term to mean "fine". FLAGGED when any defect outcome is present, or when the row carries a
 * non-reciprocal identity link — a real defect that none of the eight terms names, and which is
 * therefore reported through `linkIntegrity` and `notes` rather than by widening the vocabulary.
 */
function disposition(outcomes, forceFlagged) {
  return forceFlagged || outcomes.some((o) => !NON_DEFECT_OUTCOMES.has(o)) ? "FLAGGED" : "CLEAN";
}

function finalizeRow(row, { forceFlagged = false } = {}) {
  const outcomes = [...new Set(row.outcomes)].sort();
  return { ...row, outcomes, disposition: disposition(outcomes, forceFlagged) };
}

// ---------------------------------------------------------------------------------------------
// The crosswalk
// ---------------------------------------------------------------------------------------------

/**
 * Build the deterministic crosswalk.
 *
 * @param {object} input
 * @param {Array<{id: string, data: object}>} input.employees            `employees` — CANONICAL Employee (R4)
 * @param {Array<{id: string, data: object}>} input.users                `users/{uid}` — the Firebase UID side
 * @param {Array<{id: string, data: object}>} input.technicians          `fieldops_technicians` — COMPATIBILITY ONLY (R4)
 * @param {Array<{id: string, data: object}>} input.trucks               `trucks`
 * @param {Array<{id: string, data: object}>} input.mobileLocations      `mobile_locations`
 * @param {Array<{id: string, data: object}>} input.locationTruckClaims  `location_truck_claims`
 * @param {Array<object>} [input.principals]  optional `eos_policy.principals` export — SECURITY identity
 *                                            only; it never confers Employee authority.
 * @param {object} input.operatingCompanyConfig  from loadOperatingCompanyConfig()
 */
export function buildCrosswalk({
  employees = [],
  users = [],
  technicians = [],
  trucks = [],
  mobileLocations = [],
  locationTruckClaims = [],
  principals = [],
  operatingCompanyConfig,
  generatedAt = null,
  sourceLabel = null,
} = {}) {
  if (!operatingCompanyConfig) throw new Error("buildCrosswalk requires operatingCompanyConfig");

  const employeeById = indexById(employees);
  const userByUid = indexById(users);
  const technicianById = indexById(technicians);
  const truckById = indexById(trucks);
  const mobileById = indexById(mobileLocations);
  const claimByLocationId = indexById(locationTruckClaims);

  // UID -> employee id, taken ONLY from `employees/{id}.userId`. The Employee document is the
  // authority for its own back-link; `users/{uid}.employeeId` is reported as a cross-check but is
  // never the source of `employeeId` on a row.
  const employeeIdByUid = new Map();
  const uidCollisions = new Map();
  for (const [employeeId, data] of employeeById) {
    const uid = stringOrNull(data?.userId);
    if (uid === null) continue;
    if (employeeIdByUid.has(uid)) {
      const list = uidCollisions.get(uid) ?? [employeeIdByUid.get(uid)];
      list.push(employeeId);
      uidCollisions.set(uid, list);
      continue;
    }
    employeeIdByUid.set(uid, employeeId);
  }

  // Principal lookup is keyed by external subject. R4: a Firebase UID is an external identity key,
  // so this is a MAPPING, not an identity. Nothing downstream branches on it.
  const principalByExternalSubject = new Map();
  for (const principal of principals ?? []) {
    const subject = stringOrNull(principal?.external_subject ?? principal?.externalSubject);
    if (subject === null) continue;
    if (!principalByExternalSubject.has(subject)) {
      principalByExternalSubject.set(subject, {
        principalId: stringOrNull(principal?.id),
        identityProvider: stringOrNull(principal?.identity_provider ?? principal?.identityProvider),
        status: stringOrNull(principal?.status),
      });
    }
  }

  // Employee id -> the trucks whose assignment names it. `assignedDriverEmployeeId` is the
  // assignment field (truckRegistryRepository.ts); a technician id is never consulted here.
  const trucksByDriverEmployeeId = new Map();
  const truckIdsByLocationId = new Map();
  for (const [truckId, data] of truckById) {
    const driver = stringOrNull(data?.assignedDriverEmployeeId);
    if (driver !== null) {
      const list = trucksByDriverEmployeeId.get(driver) ?? [];
      list.push(truckId);
      trucksByDriverEmployeeId.set(driver, list);
    }
    const locationId = stringOrNull(data?.locationId);
    if (locationId !== null) {
      const list = truckIdsByLocationId.get(locationId) ?? [];
      list.push(truckId);
      truckIdsByLocationId.set(locationId, list);
    }
  }

  const companyFor = (mobileLocationId) =>
    resolveOperatingCompanyForMobileLocation(mobileLocationId, operatingCompanyConfig);

  // ---- IDENTITY rows: one per identity subject across employees, users and technicians -------
  const identitySubjects = new Set();
  for (const employeeId of employeeById.keys()) identitySubjects.add(`employee:${employeeId}`);
  for (const uid of userByUid.keys()) identitySubjects.add(`uid:${uid}`);
  for (const uid of employeeIdByUid.keys()) identitySubjects.add(`uid:${uid}`);
  for (const technicianId of technicianById.keys()) {
    // A technician whose id coincides with an employee id folds into that Employee's row; the
    // coincidence is reported there. A technician with no Employee gets its own orphan row.
    if (!employeeById.has(technicianId)) identitySubjects.add(`technician:${technicianId}`);
  }

  const identityRows = [];
  const emittedEmployeeIds = new Set();

  for (const employeeId of employeeById.keys()) {
    emittedEmployeeIds.add(employeeId);
    identityRows.push(
      buildIdentityRow({
        key: employeeId,
        employeeId,
        employeeData: employeeById.get(employeeId),
        userByUid,
        technicianById,
        principalByExternalSubject,
        trucksByDriverEmployeeId,
        truckById,
        mobileById,
        claimByLocationId,
        companyFor,
        uidCollisions,
      }),
    );
  }

  // UIDs with no Employee back-link. These are the probe/orphan identities.
  for (const uid of [...new Set([...userByUid.keys()])].sort()) {
    if (employeeIdByUid.has(uid)) continue;
    const userData = userByUid.get(uid) ?? {};
    // `users/{uid}.employeeId` is reported, never trusted: an employeeId that names no `employees`
    // document is still UID_WITHOUT_EMPLOYEE.
    const claimedEmployeeId = stringOrNull(userData?.employeeId);
    const claimedResolves = claimedEmployeeId !== null && employeeById.has(claimedEmployeeId);
    const principal = principalByExternalSubject.get(uid) ?? null;
    // users/{uid}.technicianId is how callerContext.ts sources technicianId today (R4:
    // compatibility, not authority). Reported so the migration can see the legacy edge.
    const legacyTechnicianId = stringOrNull(userData?.technicianId);
    identityRows.push(
      finalizeRow({
        rowType: ROW_TYPES.IDENTITY,
        key: `uid:${uid}`,
        firebaseUid: uid,
        employeeId: null,
        employeeUserIdBackLink: null,
        userEmployeeIdForwardLink: claimedEmployeeId,
        reciprocalEmployeeLink: false,
        linkIntegrity: "ABSENT",
        principalId: principal?.principalId ?? null,
        principalIdentityProvider: principal?.identityProvider ?? null,
        technicianId: null,
        technicianIdSource: legacyTechnicianId === null ? null : "users.technicianId (compatibility)",
        legacyUserTechnicianId: legacyTechnicianId,
        technicianIdMatchesEmployeeId: false,
        truckIds: [],
        mobileLocationIds: [],
        operatingCompanyIds: [],
        operatingCompanyResolution: COMPANY_RESOLUTION.NOT_APPLICABLE,
        notes: claimedEmployeeId !== null && !claimedResolves
          ? [`users/${uid}.employeeId names ${claimedEmployeeId}, which is not in employees`]
          : [],
        outcomes: [OUTCOMES.UID_WITHOUT_EMPLOYEE],
      }),
    );
  }

  // Orphan technicians: a `fieldops_technicians` id with no Employee of that id. R4 forbids
  // inventing an Employee here, so the row carries employeeId: null and says so.
  for (const technicianId of [...technicianById.keys()].sort()) {
    if (emittedEmployeeIds.has(technicianId)) continue;
    const technicianData = technicianById.get(technicianId) ?? {};
    const technicianUserId = stringOrNull(technicianData?.userId);
    const employeeIdViaUid = technicianUserId === null ? null : (employeeIdByUid.get(technicianUserId) ?? null);
    identityRows.push(
      finalizeRow({
        rowType: ROW_TYPES.IDENTITY,
        key: `technician:${technicianId}`,
        firebaseUid: technicianUserId,
        // Deliberately null even when the technician carries a userId that resolves to an
        // Employee: `employeeIdReachableViaUid` records that reachability as EVIDENCE for a
        // migration author to act on, and is never promoted into employeeId by this tool.
        employeeId: null,
        employeeIdReachableViaUid: employeeIdViaUid,
        employeeUserIdBackLink: null,
        userEmployeeIdForwardLink: null,
        reciprocalEmployeeLink: false,
        linkIntegrity: "ABSENT",
        principalId: technicianUserId === null ? null : (principalByExternalSubject.get(technicianUserId)?.principalId ?? null),
        technicianId,
        technicianIdSource: `${COLLECTIONS.TECHNICIANS} (compatibility projection)`,
        technicianIdMatchesEmployeeId: false,
        truckIds: [],
        mobileLocationIds: [],
        operatingCompanyIds: [],
        operatingCompanyResolution: COMPANY_RESOLUTION.NOT_APPLICABLE,
        notes: [
          `${COLLECTIONS.TECHNICIANS}/${technicianId} has no ${COLLECTIONS.EMPLOYEES} document; R4 forbids promoting a technician id into Employee authority`,
        ],
        outcomes: [OUTCOMES.ORPHAN_TECHNICIAN],
      }),
    );
  }

  // ---- TRUCK rows ---------------------------------------------------------------------------
  const truckRows = [];
  for (const truckId of [...truckById.keys()].sort()) {
    const data = truckById.get(truckId) ?? {};
    const driverEmployeeId = stringOrNull(data?.assignedDriverEmployeeId);
    const driverResolves = driverEmployeeId !== null && employeeById.has(driverEmployeeId);
    const locationId = stringOrNull(data?.locationId);
    const company = companyFor(locationId);

    const outcomes = [];
    const notes = [];
    if (driverEmployeeId !== null && !driverResolves) {
      outcomes.push(OUTCOMES.TRUCK_ASSIGNED_TO_UNKNOWN_EMPLOYEE);
      notes.push(
        `assignedDriverEmployeeId ${driverEmployeeId} is not in ${COLLECTIONS.EMPLOYEES}` +
          (technicianById.has(driverEmployeeId)
            ? ` (it IS a ${COLLECTIONS.TECHNICIANS} id — R4: that does not make it an Employee)`
            : ""),
      );
    }
    if (driverEmployeeId === null) notes.push("truck has no assigned driver");
    if (company.state === COMPANY_RESOLUTION.MISSING) {
      outcomes.push(OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING);
      notes.push(
        `no authored operating-company mapping for MOBILE ${locationId}; R5 forbids deriving it ` +
          `from homeWarehouseId (${stringOrNull(data?.homeWarehouseId) ?? "unset"})`,
      );
    }
    if (company.state === COMPANY_RESOLUTION.CONFLICT) outcomes.push(OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION);

    // A truck record that carries its own operatingCompanyId and disagrees with the authored
    // MOBILE mapping is a CONFIGURATION conflict. Neither side wins here.
    const recordCompanyId = stringOrNull(data?.operatingCompanyId);
    if (
      recordCompanyId !== null &&
      company.state === COMPANY_RESOLUTION.RESOLVED &&
      recordCompanyId !== company.operatingCompanyId
    ) {
      outcomes.push(OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION);
      notes.push(
        `truck record operatingCompanyId=${recordCompanyId} disagrees with authored MOBILE ` +
          `${locationId}=${company.operatingCompanyId}`,
      );
    }
    if (driverResolves && outcomes.length === 0) outcomes.push(OUTCOMES.CLEAN_EMPLOYEE_MAPPING);

    truckRows.push(
      finalizeRow({
        rowType: ROW_TYPES.TRUCK,
        key: truckId,
        truckId,
        assignedDriverEmployeeId: driverEmployeeId,
        assignedDriverResolvesToEmployee: driverResolves,
        assignedDriverIsTechnicianIdOnly: driverEmployeeId !== null && !driverResolves && technicianById.has(driverEmployeeId),
        mobileLocationId: locationId,
        mobileLocationExists: locationId !== null && mobileById.has(locationId),
        claimTruckId: locationId === null ? null : stringOrNull(claimByLocationId.get(locationId)?.truckId),
        // Recorded as EVIDENCE OF WHAT MUST NOT BE USED. R5: never a company input.
        homeWarehouseId: stringOrNull(data?.homeWarehouseId),
        homeWarehouseIdUsedForCompany: false,
        truckRecordOperatingCompanyId: recordCompanyId,
        operatingCompanyId: company.operatingCompanyId,
        operatingCompanyProvenance: company.provenance,
        operatingCompanyResolution: company.state,
        status: stringOrNull(data?.status),
        notes,
        outcomes,
      }),
    );
  }

  // ---- MOBILE rows --------------------------------------------------------------------------
  const mobileRows = [];
  for (const locationId of [...mobileById.keys()].sort()) {
    const data = mobileById.get(locationId) ?? {};
    const truckIds = (truckIdsByLocationId.get(locationId) ?? []).slice().sort();
    const claimTruckId = stringOrNull(claimByLocationId.get(locationId)?.truckId);
    const hasTruck = truckIds.length > 0 || claimTruckId !== null;
    const company = companyFor(locationId);

    const outcomes = [];
    const notes = [];
    if (!hasTruck) {
      outcomes.push(OUTCOMES.MOBILE_WITHOUT_TRUCK);
      notes.push(`no ${COLLECTIONS.TRUCKS} document references this MOBILE id and no ${COLLECTIONS.LOCATION_TRUCK_CLAIMS} entry exists`);
    }
    if (company.state === COMPANY_RESOLUTION.MISSING) {
      outcomes.push(OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING);
      notes.push(
        "no authored operating-company mapping; R5 refuses the migration rather than inferring one" +
          (stringOrNull(data?.homeWarehouseId) === null
            ? ""
            : ` (homeWarehouseId=${data.homeWarehouseId} is present and is NOT consulted)`),
      );
    }
    if (company.state === COMPANY_RESOLUTION.CONFLICT) {
      outcomes.push(OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION);
      notes.push("authored configuration is conflicting or malformed for this MOBILE id");
    }

    // The record's own stamped company vs the authored configuration. 0 of 7 sandbox
    // mobile_locations carry operatingCompanyId today; this is here for when some do.
    const recordCompanyId = stringOrNull(data?.operatingCompanyId);
    if (
      recordCompanyId !== null &&
      company.state === COMPANY_RESOLUTION.RESOLVED &&
      recordCompanyId !== company.operatingCompanyId
    ) {
      outcomes.push(OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION);
      notes.push(`record operatingCompanyId=${recordCompanyId} disagrees with authored ${company.operatingCompanyId}`);
    }

    const driverEmployeeIds = truckIds
      .map((truckId) => stringOrNull(truckById.get(truckId)?.assignedDriverEmployeeId))
      .filter((id) => id !== null)
      .sort();

    mobileRows.push(
      finalizeRow({
        rowType: ROW_TYPES.MOBILE,
        key: locationId,
        mobileLocationId: locationId,
        truckIds,
        claimTruckId,
        assignedDriverEmployeeIds: driverEmployeeIds,
        recordOperatingCompanyId: recordCompanyId,
        operatingCompanyId: company.operatingCompanyId,
        operatingCompanyProvenance: company.provenance,
        operatingCompanyResolution: company.state,
        // Present in the data, never an input. See R5.
        homeWarehouseId: stringOrNull(data?.homeWarehouseId),
        homeWarehouseIdUsedForCompany: false,
        active: typeof data?.active === "boolean" ? data.active : null,
        notes,
        outcomes,
      }),
    );
  }

  const rows = [
    ...identityRows.sort((a, b) => a.key.localeCompare(b.key)),
    ...truckRows,
    ...mobileRows,
  ];

  const outcomeCounts = Object.fromEntries(OUTCOME_VALUES.map((o) => [o, 0]));
  for (const row of rows) for (const outcome of row.outcomes) outcomeCounts[outcome] += 1;

  const refusals = rows
    .filter((row) => row.outcomes.includes(OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING))
    .map((row) => ({ rowType: row.rowType, key: row.key, reason: OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING }));

  const conflicts = rows
    .filter((row) => row.outcomes.includes(OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION))
    .map((row) => ({ rowType: row.rowType, key: row.key, reason: OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION }));

  // R5: an unknown operating company refuses the migration. A conflicting authored configuration
  // refuses it too — a migration cannot pick a side that authoring did not.
  const migrationReadiness =
    refusals.length > 0 || conflicts.length > 0 ? MIGRATION_READINESS.REFUSE : MIGRATION_READINESS.PROCEED;

  return {
    schema: "eos.p1b.employee-truck-mobile-crosswalk/1",
    generatedAt,
    sourceLabel,
    readOnly: true,
    rulings: {
      R4: "employees is the canonical business Employee; eos_policy.principals is security identity; a Firebase UID is an external identity key only; fieldops_technicians is compatibility data and never Employee or assignment authority",
      R5: "operating company is mandatory inventory authority, comes only from explicit authored configuration, and is NEVER derived — in particular never from homeWarehouseId; unknown company refuses the migration",
    },
    operatingCompanyConfig: {
      label: operatingCompanyConfig.label,
      environment: operatingCompanyConfig.environment,
      status: operatingCompanyConfig.status,
      governedCompanyIds: operatingCompanyConfig.governedCompanyIds,
      authoredMobileLocationCount: operatingCompanyConfig.authoredMobileLocationCount,
      authoredWarehouseCount: operatingCompanyConfig.authoredWarehouseCount,
      conflicts: operatingCompanyConfig.conflicts,
    },
    counts: {
      [COLLECTIONS.EMPLOYEES]: employeeById.size,
      [COLLECTIONS.USERS]: userByUid.size,
      [COLLECTIONS.TECHNICIANS]: technicianById.size,
      [COLLECTIONS.TRUCKS]: truckById.size,
      [COLLECTIONS.MOBILE_LOCATIONS]: mobileById.size,
      [COLLECTIONS.LOCATION_TRUCK_CLAIMS]: claimByLocationId.size,
      principals: principalByExternalSubject.size,
      rows: rows.length,
    },
    outcomeCounts,
    dispositionCounts: {
      CLEAN: rows.filter((r) => r.disposition === "CLEAN").length,
      FLAGGED: rows.filter((r) => r.disposition === "FLAGGED").length,
    },
    duplicateUidBackLinks: [...uidCollisions.entries()]
      .map(([uid, employeeIds]) => ({ firebaseUid: uid, employeeIds: [...employeeIds].sort() }))
      .sort((a, b) => a.firebaseUid.localeCompare(b.firebaseUid)),
    refusals,
    conflicts,
    migrationReadiness,
    rows,
  };
}

function buildIdentityRow({
  key,
  employeeId,
  employeeData,
  userByUid,
  technicianById,
  principalByExternalSubject,
  trucksByDriverEmployeeId,
  truckById,
  mobileById,
  claimByLocationId,
  companyFor,
  uidCollisions,
}) {
  const uid = stringOrNull(employeeData?.userId);
  const userData = uid === null ? null : (userByUid.get(uid) ?? null);
  const userEmployeeIdForwardLink = stringOrNull(userData?.employeeId);
  const reciprocal = uid !== null && userData !== null && userEmployeeIdForwardLink === employeeId;

  // R4. The technician id is carried in its OWN field. It is not, and must never become,
  // `employeeId`. A technician document whose id equals this employee id is a COINCIDENCE of
  // sandbox authoring (11 of 13 in the census), reported as such.
  const technicianId = technicianById.has(employeeId) ? employeeId : null;

  const truckIds = (trucksByDriverEmployeeId.get(employeeId) ?? []).slice().sort();
  const mobileLocationIds = [
    ...new Set(truckIds.map((truckId) => stringOrNull(truckById.get(truckId)?.locationId)).filter((id) => id !== null)),
  ].sort();

  const resolutions = mobileLocationIds.map((id) => companyFor(id));
  const operatingCompanyIds = [...new Set(resolutions.map((r) => r.operatingCompanyId).filter((id) => id !== null))].sort();

  const outcomes = [];
  const notes = [];

  if (uid === null) {
    outcomes.push(OUTCOMES.EMPLOYEE_WITHOUT_UID);
    notes.push(`${COLLECTIONS.EMPLOYEES}/${employeeId} carries no userId back-link`);
  } else if (!reciprocal) {
    // A UID that names no users document, or a users document pointing elsewhere, is not a clean
    // mapping — but the Employee still exists, so it is not UID_WITHOUT_EMPLOYEE either.
    notes.push(
      userData === null
        ? `${COLLECTIONS.EMPLOYEES}/${employeeId}.userId=${uid} names no ${COLLECTIONS.USERS} document`
        : `${COLLECTIONS.USERS}/${uid}.employeeId=${userEmployeeIdForwardLink ?? "unset"} does not point back at ${employeeId}`,
    );
  }
  if (uid !== null && uidCollisions.has(uid)) {
    notes.push(`Firebase UID ${uid} is claimed by more than one Employee: ${uidCollisions.get(uid).join(", ")}`);
  }

  let companyResolution = COMPANY_RESOLUTION.NOT_APPLICABLE;
  if (resolutions.length > 0) {
    if (resolutions.some((r) => r.state === COMPANY_RESOLUTION.MISSING)) {
      companyResolution = COMPANY_RESOLUTION.MISSING;
      outcomes.push(OUTCOMES.MISSING_OPERATING_COMPANY_MAPPING);
      notes.push("a MOBILE location reached through this employee's truck assignment has no authored operating company");
    } else if (resolutions.some((r) => r.state === COMPANY_RESOLUTION.CONFLICT)) {
      companyResolution = COMPANY_RESOLUTION.CONFLICT;
      outcomes.push(OUTCOMES.CONFLICTING_OPERATING_COMPANY_CONFIGURATION);
    } else {
      companyResolution = COMPANY_RESOLUTION.RESOLVED;
    }
  }

  if (outcomes.length === 0 && reciprocal) outcomes.push(OUTCOMES.CLEAN_EMPLOYEE_MAPPING);

  const principal = uid === null ? null : (principalByExternalSubject.get(uid) ?? null);

  const linkIntegrity = uid === null ? "ABSENT" : reciprocal ? "RECIPROCAL" : "NON_RECIPROCAL";

  return finalizeRow({
    rowType: ROW_TYPES.IDENTITY,
    key,
    firebaseUid: uid,
    employeeId,
    employeeUserIdBackLink: uid,
    userEmployeeIdForwardLink,
    reciprocalEmployeeLink: reciprocal,
    linkIntegrity,
    principalId: principal?.principalId ?? null,
    principalIdentityProvider: principal?.identityProvider ?? null,
    principalStatus: principal?.status ?? null,
    technicianId,
    technicianIdSource: technicianId === null ? null : `${COLLECTIONS.TECHNICIANS} (compatibility projection)`,
    technicianIdMatchesEmployeeId: technicianId !== null,
    legacyUserTechnicianId: stringOrNull(userData?.technicianId),
    truckIds,
    mobileLocationIds,
    mobileLocationsExist: mobileLocationIds.every((id) => mobileById.has(id)),
    claimTruckIds: mobileLocationIds
      .map((id) => stringOrNull(claimByLocationId.get(id)?.truckId))
      .filter((id) => id !== null),
    operatingCompanyIds,
    operatingCompanyResolution: companyResolution,
    employmentStatus: stringOrNull(employeeData?.employmentStatus),
    notes,
    outcomes,
  }, { forceFlagged: linkIntegrity === "NON_RECIPROCAL" });
}

/**
 * The one-line-per-row human rendering. Deterministic; used by --format text and by the
 * operator's terminal read of a run.
 */
export function formatCrosswalkText(document) {
  const lines = [];
  lines.push(`crosswalk ${document.schema}`);
  lines.push(`source: ${document.sourceLabel ?? "(unspecified)"}`);
  lines.push(`operating-company config: ${document.operatingCompanyConfig.label}`);
  lines.push(`migrationReadiness: ${document.migrationReadiness}`);
  lines.push("");
  for (const row of document.rows) {
    const chain = [
      row.firebaseUid ?? "-",
      row.employeeId ?? "-",
      row.technicianId ?? "-",
      (row.truckIds ?? (row.truckId ? [row.truckId] : [])).join("+") || "-",
      (row.mobileLocationIds ?? (row.mobileLocationId ? [row.mobileLocationId] : [])).join("+") || "-",
      (row.operatingCompanyIds ?? (row.operatingCompanyId ? [row.operatingCompanyId] : [])).join("+") || "-",
    ].join(" -> ");
    lines.push(`${row.rowType} ${row.key}: ${chain} [${row.disposition}] ${row.outcomes.join(",")}`);
  }
  lines.push("");
  for (const [outcome, count] of Object.entries(document.outcomeCounts)) lines.push(`  ${outcome}: ${count}`);
  return lines.join("\n");
}
