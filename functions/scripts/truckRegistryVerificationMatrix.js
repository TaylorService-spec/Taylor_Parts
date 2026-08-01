"use strict";

// EI Truck Registry — GOVERNED production access matrix (Gate C smoke verifier).
//
// Coverage is DERIVED from the governed sources — firestore.rules @ the governed commit,
// docs/audits/truck-registry-rules-deployment/verification-matrix.md, and DECISIONS #60 / ADR-010
// — NOT from any historical count. The historical operator-attested "80 passed / 0 failed" is
// deployment history only and is NOT reconciled against this matrix.
//
// Governed rule blocks (firestore.rules):
//   trucks / mobile_locations           read: isAdminOrDispatcher() ; create,update,delete: false
//   location_truck_claims               read: false                ; create,update,delete: false
//   equipment_models, equipment_model_aliases, equipment_part_compatibility,
//   equipment_compatibility_sources, equipment_compatibility_operations   read, write: false (D4)
//
// Derived matrix: 8 collections × 4 personas × 4 operations = 128 checks (4 ALLOW, 124 DENY).
// operationalRoles (PARTS_MANAGER/WAREHOUSE_MANAGER/PARTS_ASSOCIATE) are NOT included — they are
// work-eligibility attributes and receive no security authorization here (an optional future
// hardening proposal would add them as extra denial personas). `list` (collection read) is
// INTENTIONALLY excluded: `allow read` covers get+list, and the governed deployment-verification
// posture probes single-document reads; single-doc get is sufficient and deterministic.

const PERSONAS = Object.freeze(["admin", "dispatcher", "technician", "unauthenticated"]);
// Personas that carry a real password-authenticated ID token; "unauthenticated" sends none.
const AUTHENTICATED_PERSONAS = Object.freeze(["admin", "dispatcher", "technician"]);
// isAdminOrDispatcher(): the only roles the governed read grants.
const READ_ALLOWED_ROLES = Object.freeze(new Set(["admin", "dispatcher"]));
const OPERATIONS = Object.freeze(["get", "create", "update", "delete"]);

// readPolicy: "ADMIN_DISPATCHER" (isAdminOrDispatcher()) | "CLOSED" (read: if false). Writes are
// unconditionally CLOSED on every block.
const COLLECTIONS = Object.freeze([
  { name: "trucks", readPolicy: "ADMIN_DISPATCHER", rule: "trucks — read: isAdminOrDispatcher(); create,update,delete: false" },
  { name: "mobile_locations", readPolicy: "ADMIN_DISPATCHER", rule: "mobile_locations — read: isAdminOrDispatcher(); create,update,delete: false" },
  { name: "location_truck_claims", readPolicy: "CLOSED", rule: "location_truck_claims — read: false; create,update,delete: false" },
  { name: "equipment_models", readPolicy: "CLOSED", rule: "equipment_models — read, write: false (D4)" },
  { name: "equipment_model_aliases", readPolicy: "CLOSED", rule: "equipment_model_aliases — read, write: false (D4)" },
  { name: "equipment_part_compatibility", readPolicy: "CLOSED", rule: "equipment_part_compatibility — read, write: false (D4)" },
  { name: "equipment_compatibility_sources", readPolicy: "CLOSED", rule: "equipment_compatibility_sources — read, write: false (D4)" },
  { name: "equipment_compatibility_operations", readPolicy: "CLOSED", rule: "equipment_compatibility_operations — read, write: false (D4)" },
]);

class MatrixError extends Error {}

// Accepted HTTP denial statuses (safeguard #2): an unauthenticated request may return 401; an
// authenticated-but-unauthorized request should return 403. An ALLOWED read of a SEEDED doc must
// return 200 (a 404 is NOT accepted as proof of anything — existing seeded targets are required).
function deniedStatuses(persona) {
  return persona === "unauthenticated" ? Object.freeze([401, 403]) : Object.freeze([403]);
}
function allowedStatuses() {
  return Object.freeze([200]);
}

// Independent expected-outcome derivation from the governed rule policy (NOT a lookup into a
// pre-expanded structure). ALLOW only for a single-doc read of an ADMIN_DISPATCHER-readable
// collection by admin/dispatcher; everything else DENY.
function expectedOutcome(persona, collectionName, operation) {
  const col = COLLECTIONS.find((c) => c.name === collectionName);
  if (!col) throw new MatrixError(`unknown collection: ${collectionName}`);
  if (!PERSONAS.includes(persona)) throw new MatrixError(`unknown persona: ${persona}`);
  if (!OPERATIONS.includes(operation)) throw new MatrixError(`unknown operation: ${operation}`);
  const isRead = operation === "get";
  const allow = isRead && col.readPolicy === "ADMIN_DISPATCHER" && READ_ALLOWED_ROLES.has(persona);
  return { decision: allow ? "ALLOW" : "DENY", expected: allow ? allowedStatuses() : deniedStatuses(persona) };
}

function label(persona, collectionName, operation) {
  return `${persona}/${collectionName}/${operation}`;
}

// Deterministic generator: collection × persona × operation, sorted by label. Each row records the
// governed decision + accepted statuses. No status is observed here (that happens in the runner).
function buildMatrix() {
  const rows = [];
  for (const col of COLLECTIONS) {
    for (const persona of PERSONAS) {
      for (const operation of OPERATIONS) {
        const eo = expectedOutcome(persona, col.name, operation);
        rows.push({
          label: label(persona, col.name, operation),
          persona,
          collection: col.name,
          operation,
          decision: eo.decision,
          expected: [...eo.expected],
        });
      }
    }
  }
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}

// Authoritative crosswalk: each governed rule block -> the exact checks it maps to.
function buildCrosswalk() {
  return COLLECTIONS.map((col) => ({
    collection: col.name,
    rule: col.rule,
    checks: PERSONAS.flatMap((persona) =>
      OPERATIONS.map((operation) => ({
        label: label(persona, col.name, operation),
        decision: expectedOutcome(persona, col.name, operation).decision,
      })),
    ),
  }));
}

module.exports = {
  PERSONAS,
  AUTHENTICATED_PERSONAS,
  READ_ALLOWED_ROLES,
  OPERATIONS,
  COLLECTIONS,
  MatrixError,
  deniedStatuses,
  allowedStatuses,
  expectedOutcome,
  label,
  buildMatrix,
  buildCrosswalk,
};
