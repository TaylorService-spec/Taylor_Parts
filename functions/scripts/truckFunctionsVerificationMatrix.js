"use strict";

// EI Truck Registry — GATE D governed FUNCTIONS deployment-verification matrix. Pure data +
// helpers (no I/O, no self-execution): the exact eight callable names, the region, the personas,
// the authorization-denial matrix, and the governed success sequence the verifier core drives.
// Consumed by verifyTruckFunctionsDeployment.js (core) and truckFunctionsVerifierCli.js (operator).
//
// It describes the LATER targeted deployment/verification of exactly these eight Functions; nothing
// here deploys, invokes, or accesses production.

// The exact eight trusted callables (functions/src/index.ts), in deployment-allowlist order.
const CALLABLES = Object.freeze([
  "createTruckCallable",
  "assignTruckDriverCallable",
  "reassignTruckDriverCallable",
  "unassignTruckDriverCallable",
  "changeTruckStatusCallable",
  "changeTruckHomeWarehouseCallable",
  "deactivateTruckCallable",
  "reactivateTruckCallable",
]);

// The onCall region every callable is deployed to (functions/src/truckRegistry/truckRegistryCallables.ts).
const REGION = "us-central1";

// Personas. `admin` is the sole AUTHORIZED caller; `technician` is an authenticated but UNAUTHORIZED
// principal (role not admin/dispatcher). The unauthenticated case carries no token.
const PERSONA_ROLE = Object.freeze({ admin: "admin", technician: "technician" });
const AUTHENTICATED_PERSONAS = Object.freeze(["admin", "technician"]);

// Governed fixture collections the verifier SEEDS (prefixed, disposable) so the authorized flows can
// reference an ACTIVE warehouse / ACTIVE employee. isWarehouseActive is existence-primary (active !==
// false && status !== "INACTIVE"); isEmployeeActive requires employmentStatus === "ACTIVE".
const SEED_FIXTURES = Object.freeze([
  { key: "wh1", collection: "warehouses", fields: { name: "GateD WH1", status: "ACTIVE", active: true } },
  { key: "wh2", collection: "warehouses", fields: { name: "GateD WH2", status: "ACTIVE", active: true } },
  { key: "emp1", collection: "employees", fields: { displayName: "GateD Driver 1", employmentStatus: "ACTIVE" } },
  { key: "emp2", collection: "employees", fields: { displayName: "GateD Driver 2", employmentStatus: "ACTIVE" } },
]);

// Collections whose run-prefixed documents must be swept during cleanup/residual. The seeded
// warehouses/employees are prefixed; the trucks/mobile_locations/location_truck_claims created BY a
// successful createTruck are keyed by the prefixed truckId/locationId, so a documentId-prefix sweep
// finds them all. auditEvents are keyed by a non-prefixed deterministic id, so they are swept
// separately by the disposable persona actorUids (see the core's cleanup/residual).
const PREFIX_SWEEP_COLLECTIONS = Object.freeze([
  "warehouses",
  "employees",
  "trucks",
  "mobile_locations",
  "location_truck_claims",
]);
const AUDIT_COLLECTION = "auditEvents";

// The authorization-denial matrix: EVERY callable must deny an unauthenticated caller
// ("unauthenticated") and an authenticated non-admin/dispatcher caller ("permission-denied").
// Payloads are well-formed (valid idempotencyKey/ids/expectedVersion) so the ONLY reason for failure
// is authorization — never invalid-argument masking. (The role check runs before any truck read, so
// these need no pre-existing truck.)
const DENIAL_CASES = Object.freeze([
  { persona: "unauthenticated", expectedCode: "unauthenticated" },
  { persona: "technician", expectedCode: "permission-denied" },
]);

function buildDenialMatrix() {
  const rows = [];
  for (const c of DENIAL_CASES) {
    for (const callable of CALLABLES) {
      rows.push({ label: `deny:${c.persona}:${callable}`, persona: c.persona, callable, expectedCode: c.expectedCode });
    }
  }
  return rows; // 2 personas x 8 callables = 16 rows
}

// The governed AUTHORIZED success sequence on ONE disposable truck. Seven callables APPLY (version
// bumps 1..7); deactivate is attempted between them and MUST fail closed with the governed
// INVENTORY_STATE_UNKNOWN outcome (mapped to failed-precondition) WITHOUT changing the version — it
// stays intentionally fail-closed until a real inventory predicate exists. changeStatus/reactivate
// need no successful deactivate (changeStatus accepts any distinct enum; reactivate has no
// current-status precondition), so the whole sequence is realizable today.
const SUCCESS_SEQUENCE = Object.freeze([
  { key: "create", callable: "createTruckCallable", expectVersion: 1 },
  { key: "assign", callable: "assignTruckDriverCallable", employee: "emp1", expectVersion: 2 },
  { key: "reassign", callable: "reassignTruckDriverCallable", employee: "emp2", expectVersion: 3 },
  { key: "unassign", callable: "unassignTruckDriverCallable", expectVersion: 4 },
  { key: "status", callable: "changeTruckStatusCallable", status: "IDLE", expectVersion: 5 },
  { key: "warehouse", callable: "changeTruckHomeWarehouseCallable", warehouse: "wh2", expectVersion: 6 },
  { key: "deactivate", callable: "deactivateTruckCallable", expectFailClosed: "failed-precondition" },
  { key: "reactivate", callable: "reactivateTruckCallable", targetStatus: "ACTIVE", expectVersion: 7 },
]);

// Total governed assertions: 8 discovery + 16 denial + 8 sequence = 32.
const MATRIX_TOTAL = CALLABLES.length + buildDenialMatrix().length + SUCCESS_SEQUENCE.length;

// A stable, sanitized crosswalk (governed labels only — no run-specific values) for evidence.
function buildCrosswalk() {
  return {
    region: REGION,
    callables: [...CALLABLES],
    discovery: CALLABLES.map((name) => ({ label: `discovery:${name}`, requires: `present@${REGION}` })),
    denial: buildDenialMatrix().map((r) => ({ label: r.label, expectedCode: r.expectedCode })),
    sequence: SUCCESS_SEQUENCE.map((s) => ({
      label: `seq:${s.key}:${s.callable}`,
      expected: s.expectFailClosed ? `fail-closed:${s.expectFailClosed}` : `applied@v${s.expectVersion}`,
    })),
    matrix_total: MATRIX_TOTAL,
  };
}

module.exports = {
  CALLABLES,
  REGION,
  PERSONA_ROLE,
  AUTHENTICATED_PERSONAS,
  SEED_FIXTURES,
  PREFIX_SWEEP_COLLECTIONS,
  AUDIT_COLLECTION,
  DENIAL_CASES,
  SUCCESS_SEQUENCE,
  MATRIX_TOTAL,
  buildDenialMatrix,
  buildCrosswalk,
};
