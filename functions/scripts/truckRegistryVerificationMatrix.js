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
// Derived matrix: 128 doc-level checks (8 collections × 4 personas × 4 ops get/create/update/delete)
// PLUS 8 collection-`list` checks on the two ADMIN_DISPATCHER-readable collections (trucks,
// mobile_locations) × 4 personas = 136 total (8 ALLOW, 128 DENY). The collection-list read is what
// the real Truck Registry UI performs (getDocs(collection(...))). CLOSED collections get no separate
// list check — their list is governed-denied by the same `read: false` rule as their get.
// operationalRoles (PARTS_MANAGER/WAREHOUSE_MANAGER/PARTS_ASSOCIATE) are NOT included — they are
// work-eligibility attributes and receive no security authorization here (an optional future
// hardening proposal would add them as extra denial personas).

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

// The collection-list read the real Truck Registry UI performs (getDocs(collection(...))). It is a
// distinct REST operation from a single-doc get, so it is verified explicitly — but ONLY for the
// ADMIN_DISPATCHER-readable collections the UI actually lists (trucks, mobile_locations). A CLOSED
// collection's list is already governed-denied by the same `read: false` rule as its get, so no
// separate list check is added there.
const LIST_OPERATION = "list";
const ALL_OPERATIONS = Object.freeze([...OPERATIONS, LIST_OPERATION]);
function listApplies(col) {
  return col.readPolicy === "ADMIN_DISPATCHER";
}
function operationsFor(col) {
  return listApplies(col) ? ALL_OPERATIONS : OPERATIONS;
}

class MatrixError extends Error {}

// Accepted HTTP denial statuses (safeguard #2): an unauthenticated request may return 401; an
// authenticated-but-unauthorized request should return 403. An ALLOWED read of a SEEDED doc (get or
// list) must return 200 (a 404 is NOT accepted as proof — existing seeded targets are required).
function deniedStatuses(persona) {
  return persona === "unauthenticated" ? Object.freeze([401, 403]) : Object.freeze([403]);
}
function allowedStatuses() {
  return Object.freeze([200]);
}

// Independent expected-outcome derivation from the governed rule policy (NOT a lookup into a
// pre-expanded structure). ALLOW only for a READ (single-doc get OR collection list) of an
// ADMIN_DISPATCHER-readable collection by admin/dispatcher; everything else DENY.
function expectedOutcome(persona, collectionName, operation) {
  const col = COLLECTIONS.find((c) => c.name === collectionName);
  if (!col) throw new MatrixError(`unknown collection: ${collectionName}`);
  if (!PERSONAS.includes(persona)) throw new MatrixError(`unknown persona: ${persona}`);
  if (!ALL_OPERATIONS.includes(operation)) throw new MatrixError(`unknown operation: ${operation}`);
  const isRead = operation === "get" || operation === LIST_OPERATION;
  const allow = isRead && col.readPolicy === "ADMIN_DISPATCHER" && READ_ALLOWED_ROLES.has(persona);
  return { decision: allow ? "ALLOW" : "DENY", expected: allow ? allowedStatuses() : deniedStatuses(persona) };
}

function label(persona, collectionName, operation) {
  return `${persona}/${collectionName}/${operation}`;
}

// Deterministic generator: collection × persona × operation, sorted by label. The doc-level ops
// (get/create/update/delete) apply to every collection; `list` applies only to the readable
// collections. Each row records the governed decision + accepted statuses. No status is observed
// here (that happens in the runner).
function buildMatrix() {
  const rows = [];
  for (const col of COLLECTIONS) {
    for (const persona of PERSONAS) {
      for (const operation of operationsFor(col)) {
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

// Authoritative crosswalk: each governed rule block -> the exact checks it maps to (list included
// only for the readable collections).
function buildCrosswalk() {
  return COLLECTIONS.map((col) => ({
    collection: col.name,
    rule: col.rule,
    checks: PERSONAS.flatMap((persona) =>
      operationsFor(col).map((operation) => ({
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
  LIST_OPERATION,
  ALL_OPERATIONS,
  COLLECTIONS,
  MatrixError,
  deniedStatuses,
  allowedStatuses,
  expectedOutcome,
  label,
  listApplies,
  operationsFor,
  buildMatrix,
  buildCrosswalk,
};
