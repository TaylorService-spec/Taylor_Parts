// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md, PR 0).
// Deterministic unit test for buildEmployeeSessionResult(), the pure
// shape-builder src/auth/employeeSession.js's resolveEmployeeSession()
// delegates to for every linkage state -- proves employmentStatus is
// exposed alongside operationalRoles, and that unresolved/broken
// linkage fails closed to the exact same empty shape as before this
// PR (no new field ever silently backfills a default that would look
// like a valid, ACTIVE, eligible session).
//
// Imports from employeeSessionResult.js directly (not employeeSession.js,
// which imports the Firebase SDK for its Firestore reads) -- this pure
// function has no Firebase dependency, same convention as
// domain/commercialProfile.js.
//
// Run: node test/employeeSession.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { buildEmployeeSessionResult } from "../src/auth/employeeSessionResult.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// --- No employeeId (unresolved linkage -- a valid, expected migration state) ---
ok("no employeeId: fails closed to the empty shape, employmentStatus included", () => {
  const result = buildEmployeeSessionResult("technician", null, null);
  assert.deepEqual(result, {
    role: "technician",
    employeeId: null,
    displayName: null,
    operationalRoles: [],
    employmentStatus: null,
  });
});

// --- employeeId present, but no Employee document (broken linkage) ---
ok("broken linkage (employeeId set, no employeeData): fails closed identically to unresolved", () => {
  const result = buildEmployeeSessionResult("technician", "emp-broken", null);
  assert.deepEqual(result, {
    role: "technician",
    employeeId: "emp-broken",
    displayName: null,
    operationalRoles: [],
    employmentStatus: null,
  });
});

// --- Resolved: ACTIVE, eligible ---
ok("resolved, ACTIVE, eligible: employmentStatus and operationalRoles both surface", () => {
  const result = buildEmployeeSessionResult("technician", "emp-1", {
    displayName: "Dana Prime",
    operationalRoles: ["PARTS_MANAGER"],
    employmentStatus: "ACTIVE",
  });
  assert.deepEqual(result, {
    role: "technician",
    employeeId: "emp-1",
    displayName: "Dana Prime",
    operationalRoles: ["PARTS_MANAGER"],
    employmentStatus: "ACTIVE",
  });
});

// --- Resolved, but inactive employment ---
ok("resolved, INACTIVE: employmentStatus reflects the real value, not coerced to ACTIVE or null", () => {
  const result = buildEmployeeSessionResult("technician", "emp-2", {
    displayName: "Former Employee",
    operationalRoles: ["PARTS_ASSOCIATE"],
    employmentStatus: "TERMINATED",
  });
  assert.equal(result.employmentStatus, "TERMINATED");
  assert.deepEqual(result.operationalRoles, ["PARTS_ASSOCIATE"]);
});

// --- Resolved, but the Employee document has no operationalRoles/employmentStatus fields at all ---
ok("resolved, missing operationalRoles/employmentStatus fields: default to [] / null, not undefined", () => {
  const result = buildEmployeeSessionResult("admin", "emp-3", { displayName: "Legacy Employee" });
  assert.deepEqual(result.operationalRoles, []);
  assert.equal(result.employmentStatus, null);
});

// --- role itself is independent of employeeId/employeeData resolution ---
ok("role passes through unchanged regardless of linkage state", () => {
  assert.equal(buildEmployeeSessionResult("admin", null, null).role, "admin");
  assert.equal(buildEmployeeSessionResult("dispatcher", "emp-x", null).role, "dispatcher");
  assert.equal(buildEmployeeSessionResult(null, null, null).role, null);
});

console.log(`\n${passed} passed, 0 failed`);
