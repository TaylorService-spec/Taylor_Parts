"use strict";

// EI Truck Registry — GATE E4 READ-ONLY BACKEND VERIFIER (pure core, no I/O).
//
// Purpose: independently verify the BACKEND facts the production Truck Inventory UI does NOT expose
// for a single, Owner-named truck — stored version, MOBILE location identity, the reciprocal
// location_truck_claims guard doc, the createTruck audit outcome, absence of hidden duplicate
// records, and cross-record coherence (including the containment actions applied in this session:
// one unassignTruckDriver + one changeTruckStatus->IDLE). It performs NO production mutation and,
// by construction, cannot: this core receives ONLY an injected read surface (`reads.getDoc` +
// `reads.queryByField`) and an evidence `publish` sink — it never sees a Firestore/Admin handle,
// so no write API is reachable from here. Every check fails CLOSED: absent, malformed, duplicate,
// query-failure, or unextractable state is a FAIL, never a silent pass. Evidence is published
// ONLY after every check passes.
//
// This module does no I/O on import (the real Firestore adapter + atomic publisher are wired in
// truckBackendVerifierCli.js and injected). The unit tests exercise this core with in-memory fakes.

const {
  VerificationError,
  sha256,
  assertEvidenceSecretFree,
} = require("./firestoreDeploymentVerificationShared");

const EXPECTED_PROJECT = "taylor-parts";
const REGION = "us-central1";

// Governed identity/label bounds — mirror functions/src/truckRegistry/validation.ts (ID_MAX=200,
// LABEL_MAX=300) and the canonical status enum + collection names in the truck-registry repository,
// so this verifier accepts exactly what the trusted create service would have accepted/stored.
const ID_MAX = 200;
const LABEL_MAX = 300;
const TRUCK_STATUSES = Object.freeze(["ACTIVE", "IDLE", "OUT_OF_SERVICE"]);
const DEACTIVATED_STATUS = "OUT_OF_SERVICE";
const INITIAL_VERSION = 1;

const TRUCKS_COLLECTION = "trucks";
const MOBILE_LOCATIONS_COLLECTION = "mobile_locations";
const LOCATION_TRUCK_CLAIMS_COLLECTION = "location_truck_claims";
const AUDIT_EVENTS_COLLECTION = "auditEvents";

// The audit `action` values the containment sequence must (and must ONLY) have applied.
const AUDIT_ACTION_CREATE = "createTruck";
const AUDIT_ACTION_UNASSIGN = "unassignTruckDriver";
const AUDIT_ACTION_CHANGE_STATUS = "changeTruckStatus";
const EXPECTED_APPLIED_ACTIONS = Object.freeze([
  AUDIT_ACTION_CREATE,
  AUDIT_ACTION_UNASSIGN,
  AUDIT_ACTION_CHANGE_STATUS,
]);
// Every governed truck audit action (used to detect malformed/unexpected actions).
const KNOWN_TRUCK_AUDIT_ACTIONS = Object.freeze([
  "createTruck",
  "assignTruckDriver",
  "unassignTruckDriver",
  "changeTruckStatus",
  "changeTruckHomeWarehouse",
  "deactivateTruck",
  "reactivateTruck",
  "deleteTruckCreatedInError",
]);
const KNOWN_AUDIT_OUTCOMES = Object.freeze(["applied", "denied", "uncertain"]);

// Bounded, deterministic query fan-outs. A truck realistically has a handful of audit events and
// exactly one reciprocal location/claim; if a query returns its LIMIT, that is an overflow we fail
// closed on (indeterminate cardinality), never a silent truncation.
const DUP_QUERY_LIMIT = 5;
const AUDIT_QUERY_LIMIT = 200;

// Read cardinality/shape categories — reported per check so zero / one / multiple / malformed /
// query-failure are always distinguished (never collapsed).
const CAT = Object.freeze({
  PRESENT_ONE: "PRESENT_ONE",
  ABSENT_ZERO: "ABSENT_ZERO",
  DUPLICATE_MULTIPLE: "DUPLICATE_MULTIPLE",
  MALFORMED: "MALFORMED",
  QUERY_FAILURE: "QUERY_FAILURE",
  BLOCKED: "BLOCKED",
});

const ALLOWED_READ_METHODS = Object.freeze(["getDoc", "queryByField"]);

class Matrix {
  constructor() { this.results = []; }
  add(label, pass, category) { this.results.push({ label, pass: Boolean(pass), category }); return pass; }
  get total() { return this.results.length; }
  get passed() { return this.results.filter((r) => r.pass).length; }
  failedLabels() { return this.results.filter((r) => !r.pass).map((r) => r.label); }
}

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
// Governed identifier predicate — identical acceptance to the trusted create service.
function isId(v) { return isNonEmptyString(v) && v.length <= ID_MAX && v === v.trim(); }
function isRequiredLabel(v) { return isNonEmptyString(v) && v.length <= LABEL_MAX; }
function isPositiveIntVersion(v) { return typeof v === "number" && Number.isInteger(v) && v >= INITIAL_VERSION; }

// Best-effort millis extraction for the temporal-ordering check. Handles Admin SDK Timestamp
// (toMillis()), the {_seconds,_nanoseconds} / {seconds,nanoseconds} plain shapes, a raw number, and
// Date. Returns null when time cannot be established -> the ordering check then fails closed.
function toMillis(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") { const m = v.toMillis(); return typeof m === "number" && Number.isFinite(m) ? m : null; }
  if (typeof v._seconds === "number") return v._seconds * 1000 + (typeof v._nanoseconds === "number" ? v._nanoseconds / 1e6 : 0);
  if (typeof v.seconds === "number") return v.seconds * 1000 + (typeof v.nanoseconds === "number" ? v.nanoseconds / 1e6 : 0);
  return null;
}

// Governed pin assertions — fail closed BEFORE any read.
function assertGovernedPins(config, targetProject, targetCommit) {
  if (!config || typeof config !== "object") throw new VerificationError("config must be an object");
  if (config.projectId !== EXPECTED_PROJECT) throw new VerificationError(`config.projectId must be exactly ${EXPECTED_PROJECT}`);
  if (config.confirmProject !== config.projectId) throw new VerificationError("config.confirmProject must exactly match config.projectId");
  if (!/^[0-9a-f]{40}$/.test(config.governedCommit || "")) throw new VerificationError("config.governedCommit must be a full 40-character Git SHA");
  if (targetProject !== EXPECTED_PROJECT) throw new VerificationError(`target project must be exactly ${EXPECTED_PROJECT}`);
  if (typeof targetCommit !== "string" || targetCommit !== config.governedCommit) {
    throw new VerificationError("checkout HEAD must exactly equal config.governedCommit (clean governed checkout)");
  }
}

// Owner-supplied truck id + expected visible values. Enforces the governed shapes; the driver
// expectation MUST be exactly null (the quarantined truck is unassigned).
function validateTruckTarget(config) {
  if (!isId(config.truckId)) throw new VerificationError("config.truckId must be a governed identifier (non-empty, trimmed, <=200)");
  const e = config.expected;
  if (!e || typeof e !== "object") throw new VerificationError("config.expected must be an object");
  if (!isRequiredLabel(e.displayLabel)) throw new VerificationError("config.expected.displayLabel must be a non-empty label (<=300)");
  if (!isRequiredLabel(e.vehicleNumber)) throw new VerificationError("config.expected.vehicleNumber must be a non-empty label (<=300)");
  if (!TRUCK_STATUSES.includes(e.status)) throw new VerificationError(`config.expected.status must be one of ${TRUCK_STATUSES.join(", ")}`);
  if (!isId(e.homeWarehouseId)) throw new VerificationError("config.expected.homeWarehouseId must be a governed identifier");
  if (e.assignedDriverEmployeeId !== null) throw new VerificationError("config.expected.assignedDriverEmployeeId must be null (unassigned)");
  return config;
}

function assertReadOnlySurface(reads) {
  if (!reads || typeof reads !== "object") throw new VerificationError("reads surface missing");
  const keys = Object.keys(reads);
  for (const k of keys) {
    if (!ALLOWED_READ_METHODS.includes(k)) throw new VerificationError(`read surface exposes a non-read method: ${k}`);
  }
  for (const required of ALLOWED_READ_METHODS) {
    if (typeof reads[required] !== "function") throw new VerificationError(`read surface missing ${required}()`);
  }
}

// --- single-doc + query categorizers (never throw; classify instead) ---
async function categorizeDoc(reads, collection, id) {
  try {
    const doc = await reads.getDoc(collection, id);
    if (doc === null || doc === undefined) return { category: CAT.ABSENT_ZERO, doc: null };
    if (typeof doc !== "object" || typeof doc.id !== "string" || doc.data === null || typeof doc.data !== "object") {
      return { category: CAT.MALFORMED, doc: null };
    }
    return { category: CAT.PRESENT_ONE, doc };
  } catch {
    return { category: CAT.QUERY_FAILURE, doc: null };
  }
}
async function categorizeQuery(reads, collection, field, value, limit) {
  try {
    const rows = await reads.queryByField(collection, field, value, limit);
    if (!Array.isArray(rows)) return { category: CAT.MALFORMED, rows: [] };
    if (rows.length === 0) return { category: CAT.ABSENT_ZERO, rows };
    if (rows.length >= limit || rows.length > 1) return { category: CAT.DUPLICATE_MULTIPLE, rows };
    const only = rows[0];
    if (typeof only !== "object" || typeof only.id !== "string" || only.data === null || typeof only.data !== "object") {
      return { category: CAT.MALFORMED, rows };
    }
    return { category: CAT.PRESENT_ONE, rows };
  } catch {
    return { category: CAT.QUERY_FAILURE, rows: [] };
  }
}

async function runVerification({ config, targetProject, targetCommit, reads, publish, verifyDate, log = () => {} }) {
  assertGovernedPins(config, targetProject, targetCommit);
  validateTruckTarget(config);
  assertReadOnlySurface(reads);

  const truckId = config.truckId;
  const expected = config.expected;
  const m = new Matrix();

  // ---- Group 1: trucks/{truckId} ----
  const truckRes = await categorizeDoc(reads, TRUCKS_COLLECTION, truckId);
  m.add("truck.present-exactly-one", truckRes.category === CAT.PRESENT_ONE, truckRes.category);
  const truck = truckRes.doc ? truckRes.doc.data : null;
  const truckDocId = truckRes.doc ? truckRes.doc.id : null;

  let locationId = null;
  if (truck) {
    m.add("truck.stored-id-equals-doc-id", truck.truckId === truckDocId && truckDocId === truckId, truckRes.category);
    m.add("truck.version-positive-integer", isPositiveIntVersion(truck.version), truckRes.category);
    m.add("truck.displayLabel-matches-expected", truck.displayLabel === expected.displayLabel, truckRes.category);
    m.add("truck.vehicleNumber-matches-expected", truck.vehicleNumber === expected.vehicleNumber, truckRes.category);
    m.add("truck.status-matches-expected", truck.status === expected.status, truckRes.category);
    m.add("truck.homeWarehouse-matches-expected", truck.homeWarehouseId === expected.homeWarehouseId, truckRes.category);
    m.add("truck.driver-null", truck.assignedDriverEmployeeId === null, truckRes.category);
    m.add("truck.locationId-valid", isId(truck.locationId), truckRes.category);
    m.add("truck.active-true", truck.active === true, truckRes.category);
    if (isId(truck.locationId)) locationId = truck.locationId;
  } else {
    for (const label of [
      "truck.stored-id-equals-doc-id", "truck.version-positive-integer",
      "truck.displayLabel-matches-expected", "truck.vehicleNumber-matches-expected",
      "truck.status-matches-expected", "truck.homeWarehouse-matches-expected",
      "truck.driver-null", "truck.locationId-valid", "truck.active-true",
    ]) m.add(label, false, CAT.BLOCKED);
  }

  // ---- Group 2: mobile_locations/{locationId} ----
  let location = null;
  if (locationId) {
    const locRes = await categorizeDoc(reads, MOBILE_LOCATIONS_COLLECTION, locationId);
    m.add("location.present-exactly-one", locRes.category === CAT.PRESENT_ONE, locRes.category);
    location = locRes.doc ? locRes.doc.data : null;
    const locDocId = locRes.doc ? locRes.doc.id : null;
    if (location) {
      m.add("location.stored-id-equals-doc-id", location.locationId === locDocId && locDocId === locationId, locRes.category);
      m.add("location.type-is-MOBILE", location.type === "MOBILE", locRes.category);
      m.add("location.active-true", location.active === true, locRes.category);
    } else {
      for (const label of ["location.stored-id-equals-doc-id", "location.type-is-MOBILE", "location.active-true"]) m.add(label, false, locRes.category);
    }
  } else {
    for (const label of ["location.present-exactly-one", "location.stored-id-equals-doc-id", "location.type-is-MOBILE", "location.active-true"]) m.add(label, false, CAT.BLOCKED);
  }

  // ---- Group 3: location_truck_claims/{locationId} ----
  let claim = null;
  if (locationId) {
    const claimRes = await categorizeDoc(reads, LOCATION_TRUCK_CLAIMS_COLLECTION, locationId);
    m.add("claim.present-exactly-one", claimRes.category === CAT.PRESENT_ONE, claimRes.category);
    claim = claimRes.doc ? claimRes.doc.data : null;
    const claimDocId = claimRes.doc ? claimRes.doc.id : null;
    if (claim) {
      m.add("claim.stored-id-equals-doc-id", claim.locationId === claimDocId && claimDocId === locationId, claimRes.category);
      m.add("claim.truckId-matches", claim.truckId === truckId, claimRes.category);
    } else {
      for (const label of ["claim.stored-id-equals-doc-id", "claim.truckId-matches"]) m.add(label, false, claimRes.category);
    }
  } else {
    for (const label of ["claim.present-exactly-one", "claim.stored-id-equals-doc-id", "claim.truckId-matches"]) m.add(label, false, CAT.BLOCKED);
  }

  // reciprocal identity agreement (aggregate)
  const reciprocal = Boolean(
    truck && location && claim && locationId &&
    truck.locationId === locationId &&
    location.locationId === locationId &&
    claim.locationId === locationId &&
    claim.truckId === truckId,
  );
  m.add("reciprocal.truck-location-claim-identities-agree", reciprocal, reciprocal ? CAT.PRESENT_ONE : CAT.BLOCKED);

  // ---- Group 4: duplicate detection (bounded, deterministic) ----
  if (locationId) {
    const trucksByLoc = await categorizeQuery(reads, TRUCKS_COLLECTION, "locationId", locationId, DUP_QUERY_LIMIT);
    const singleTruckByLoc = trucksByLoc.category === CAT.PRESENT_ONE && trucksByLoc.rows[0].id === truckId;
    m.add("duplicates.exactly-one-truck-references-location", singleTruckByLoc, trucksByLoc.category);

    const claimsByTruck = await categorizeQuery(reads, LOCATION_TRUCK_CLAIMS_COLLECTION, "truckId", truckId, DUP_QUERY_LIMIT);
    const singleClaimByTruck = claimsByTruck.category === CAT.PRESENT_ONE && claimsByTruck.rows[0].data.locationId === locationId;
    m.add("duplicates.exactly-one-claim-points-to-truck", singleClaimByTruck, claimsByTruck.category);
    // "no second MOBILE location linked to the truck" is entailed by exactly-one-claim (claims are
    // 1:1 keyed by locationId and carry truckId) AND exactly-one-truck-by-location.
    m.add("duplicates.no-second-location-linked-to-truck", singleClaimByTruck && singleTruckByLoc, (singleClaimByTruck && singleTruckByLoc) ? CAT.PRESENT_ONE : CAT.DUPLICATE_MULTIPLE);
  } else {
    for (const label of [
      "duplicates.exactly-one-truck-references-location",
      "duplicates.exactly-one-claim-points-to-truck",
      "duplicates.no-second-location-linked-to-truck",
    ]) m.add(label, false, CAT.BLOCKED);
  }

  // ---- Group 5: audit verification (single-field targetId equality -> automatic index) ----
  let auditSummary = { appliedByAction: {}, appliedTotal: 0, deniedCount: 0, uncertainCount: 0, malformed: false, overflow: false };
  const auditRes = await (async () => {
    try {
      const rows = await reads.queryByField(AUDIT_EVENTS_COLLECTION, "targetId", truckId, AUDIT_QUERY_LIMIT);
      if (!Array.isArray(rows)) return { category: CAT.MALFORMED, rows: [] };
      if (rows.length >= AUDIT_QUERY_LIMIT) return { category: CAT.DUPLICATE_MULTIPLE, rows }; // overflow -> fail closed
      return { category: CAT.PRESENT_ONE, rows };
    } catch {
      return { category: CAT.QUERY_FAILURE, rows: [] };
    }
  })();

  if (auditRes.category === CAT.QUERY_FAILURE || auditRes.category === CAT.MALFORMED || auditRes.category === CAT.DUPLICATE_MULTIPLE) {
    auditSummary.overflow = auditRes.category === CAT.DUPLICATE_MULTIPLE;
    for (const label of [
      "audit.exactly-one-createTruck-applied",
      "audit.exactly-one-unassignTruckDriver-applied",
      "audit.exactly-one-changeTruckStatus-applied",
      "audit.no-other-applied-actions",
      "audit.no-malformed-or-uncertain-outcomes",
    ]) m.add(label, false, auditRes.category);
  } else {
    const appliedByAction = {};
    const appliedTimes = {};
    let malformed = false;
    let deniedCount = 0;
    let uncertainCount = 0;
    for (const row of auditRes.rows) {
      const d = row && row.data;
      if (!d || typeof d !== "object") { malformed = true; continue; }
      // targetType ESTABLISHES truck-authority membership (the query is targetId-only, so a targetId
      // can collide across governed target types). It must never be inferred: absent / null /
      // non-string / empty targetType is MALFORMED -> fail closed; a valid string other than "truck"
      // is a legitimate cross-target collision and is ignored; ONLY targetType === "truck" is counted
      // toward the required create/unassign/status sequence.
      const targetType = d.targetType;
      if (typeof targetType !== "string" || targetType.trim() === "") { malformed = true; continue; }
      if (targetType !== "truck") continue;
      const action = d.action;
      const outcome = d.outcome;
      if (typeof action !== "string" || !KNOWN_TRUCK_AUDIT_ACTIONS.includes(action) ||
          typeof outcome !== "string" || !KNOWN_AUDIT_OUTCOMES.includes(outcome)) { malformed = true; continue; }
      if (outcome === "applied") {
        appliedByAction[action] = (appliedByAction[action] || 0) + 1;
        if (EXPECTED_APPLIED_ACTIONS.includes(action)) {
          const ms = toMillis(d.at);
          if (ms === null) malformed = true; else appliedTimes[action] = ms;
        }
      } else if (outcome === "denied") { deniedCount += 1; }
      else { uncertainCount += 1; }
    }
    const appliedTotal = Object.values(appliedByAction).reduce((a, b) => a + b, 0);
    const otherApplied = Object.keys(appliedByAction).filter((a) => !EXPECTED_APPLIED_ACTIONS.includes(a));
    auditSummary = { appliedByAction, appliedTotal, appliedTimes, deniedCount, uncertainCount, malformed, overflow: false, otherApplied };

    m.add("audit.exactly-one-createTruck-applied", appliedByAction[AUDIT_ACTION_CREATE] === 1, CAT.PRESENT_ONE);
    m.add("audit.exactly-one-unassignTruckDriver-applied", appliedByAction[AUDIT_ACTION_UNASSIGN] === 1, CAT.PRESENT_ONE);
    m.add("audit.exactly-one-changeTruckStatus-applied", appliedByAction[AUDIT_ACTION_CHANGE_STATUS] === 1, CAT.PRESENT_ONE);
    m.add("audit.no-other-applied-actions", otherApplied.length === 0 && appliedTotal === EXPECTED_APPLIED_ACTIONS.length, otherApplied.length === 0 ? CAT.PRESENT_ONE : CAT.DUPLICATE_MULTIPLE);
    m.add("audit.no-malformed-or-uncertain-outcomes", !malformed && uncertainCount === 0, malformed ? CAT.MALFORMED : CAT.PRESENT_ONE);
  }

  // ---- Group 6: cross-record consistency ----
  const appliedTotal = auditSummary.appliedTotal || 0;
  const versionCoherent = Boolean(truck && isPositiveIntVersion(truck.version) && truck.version === appliedTotal && appliedTotal === EXPECTED_APPLIED_ACTIONS.length);
  m.add("consistency.version-equals-applied-audit-count", versionCoherent, versionCoherent ? CAT.PRESENT_ONE : CAT.BLOCKED);

  const t = auditSummary.appliedTimes || {};
  const orderingKnown = typeof t[AUDIT_ACTION_CREATE] === "number" && typeof t[AUDIT_ACTION_UNASSIGN] === "number" && typeof t[AUDIT_ACTION_CHANGE_STATUS] === "number";
  const creationPrecedes = orderingKnown && t[AUDIT_ACTION_CREATE] <= t[AUDIT_ACTION_UNASSIGN] && t[AUDIT_ACTION_CREATE] <= t[AUDIT_ACTION_CHANGE_STATUS];
  m.add("consistency.creation-precedes-containment", creationPrecedes, orderingKnown ? CAT.PRESENT_ONE : CAT.BLOCKED);

  const finalStateContained = Boolean(truck && truck.status === "IDLE" && truck.status !== DEACTIVATED_STATUS && truck.active === true && truck.assignedDriverEmployeeId === null);
  m.add("consistency.final-state-idle-and-unassigned", finalStateContained, finalStateContained ? CAT.PRESENT_ONE : CAT.BLOCKED);

  // Structural no-write guarantee (this core only ever received read closures; re-assert).
  let readOnly = true;
  try { assertReadOnlySurface(reads); } catch { readOnly = false; }
  m.add("consistency.no-write-api-reachable", readOnly, readOnly ? CAT.PRESENT_ONE : CAT.MALFORMED);

  // ---- verdict ----
  const passedAll = m.passed === m.total;
  log(`GATE-E4 BACKEND VERIFY truck=${truckId} checks=${m.passed}/${m.total} verdict=${passedAll ? "PASS" : "FAIL"}`);
  if (!passedAll) {
    throw new VerificationError(`backend verification FAILED (${m.total - m.passed}/${m.total}): ${m.failedLabels().join(", ")}`);
  }

  // ---- sanitized report (only governed booleans/counts + Owner-supplied ids/labels + a
  // non-reversible locationId hash + version/timestamps that are safe) ----
  const report = {
    verified: true,
    verify_date: verifyDate,
    note: "Read-only Gate E4 backend verification of a single Owner-named truck. No production mutation performed or reachable.",
    project: EXPECTED_PROJECT,
    region: REGION,
    governedCommit: config.governedCommit,
    truckId,
    expected: {
      displayLabel: expected.displayLabel,
      vehicleNumber: expected.vehicleNumber,
      status: expected.status,
      homeWarehouseId: expected.homeWarehouseId,
      assignedDriverEmployeeId: null,
    },
    locationIdSha256: sha256(locationId),
    stored: {
      version: truck.version,
      active: truck.active === true,
      status: truck.status,
      driverAssigned: truck.assignedDriverEmployeeId !== null,
    },
    audit_summary: {
      appliedCreateTruck: auditSummary.appliedByAction[AUDIT_ACTION_CREATE] || 0,
      appliedUnassignTruckDriver: auditSummary.appliedByAction[AUDIT_ACTION_UNASSIGN] || 0,
      appliedChangeTruckStatus: auditSummary.appliedByAction[AUDIT_ACTION_CHANGE_STATUS] || 0,
      otherAppliedCount: (auditSummary.otherApplied || []).length,
      deniedCount: auditSummary.deniedCount || 0,
      uncertainCount: auditSummary.uncertainCount || 0,
      versionEqualsAppliedCount: versionCoherent,
      creationPrecedesContainment: creationPrecedes,
    },
    matrix_total: m.total,
    passed: m.passed,
    checks: m.results,
  };
  assertEvidenceSecretFree(report);

  const finalDir = await publish({ "verification-report.json": report });
  log(`GATE-E4 BACKEND VERIFY evidence published: ${finalDir}`);
  return { report, evidenceDir: finalDir, matrixTotal: m.total, passed: m.passed };
}

module.exports = {
  EXPECTED_PROJECT,
  REGION,
  ID_MAX,
  LABEL_MAX,
  TRUCK_STATUSES,
  DEACTIVATED_STATUS,
  INITIAL_VERSION,
  TRUCKS_COLLECTION,
  MOBILE_LOCATIONS_COLLECTION,
  LOCATION_TRUCK_CLAIMS_COLLECTION,
  AUDIT_EVENTS_COLLECTION,
  EXPECTED_APPLIED_ACTIONS,
  DUP_QUERY_LIMIT,
  AUDIT_QUERY_LIMIT,
  CAT,
  ALLOWED_READ_METHODS,
  isId,
  isRequiredLabel,
  isPositiveIntVersion,
  toMillis,
  assertGovernedPins,
  validateTruckTarget,
  assertReadOnlySurface,
  runVerification,
};
