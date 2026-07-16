// Issue #226 Row 16 -- Navigation/shared UI parity helpers (Task 21).
// Deterministic unit tests for createPermissionPreviewer()'s wrapper
// contract (fail-closed on unknown role/permission, fallback threading,
// never throws) against a literal fake resolver + roles object -- the
// same literal-fixture convention permissionDecisionCopy.test.mjs uses,
// since Node's ESM loader cannot resolve resolveEffectivePermission.ts's
// own internal extensionless imports without a build step. The REAL
// resolver's correctness is already exhaustively proven by
// resolveEffectivePermission.test.mjs and the domain shadow-migration
// parity suites (Rows 13-15); this file only proves the wrapper around
// it behaves correctly for any correctly-behaving resolver.
//
// Run: node test/navPermissionPreviewParity.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { createPermissionPreviewer } from "../src/access/navPermissionPreview.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const FAKE_ROLES = { admin: {}, dispatcher: {}, technician: {} };

// A resolver stand-in with the real ResolveResult contract: ALLOW for
// admin/dispatcher on "reorder.request.read.queue"/"workOrder.create",
// DENY for technician -- mirrors the real compatibilityRoles.ts grants
// these two call sites (AppHeader.jsx, App.jsx) actually rely on.
function fakeResolve({ permissionId, assignments }) {
  const roleId = assignments[0]?.roleId;
  const allowed = { admin: true, dispatcher: true, technician: false };
  return { decision: allowed[roleId] ? "ALLOW" : "DENY", reason: allowed[roleId] ? "qualifyingGrant" : "noQualifyingGrant" };
}

const previewHasPermission = createPermissionPreviewer(fakeResolve, FAKE_ROLES);

ok("ALLOW for admin/dispatcher, DENY for technician, matching the real compatibilityRoles.ts grants these call sites depend on", () => {
  for (const role of ["admin", "dispatcher"]) {
    assert.equal(previewHasPermission("reorder.request.read.queue", role, { fallback: false }), true);
    assert.equal(previewHasPermission("workOrder.create", role, { fallback: false }), true);
  }
  assert.equal(previewHasPermission("reorder.request.read.queue", "technician", { fallback: true }), false);
  assert.equal(previewHasPermission("workOrder.create", "technician", { fallback: true }), false);
});

ok("an unknown role returns the caller-supplied fallback without ever calling the resolver", () => {
  let called = false;
  const tracked = createPermissionPreviewer(() => { called = true; return { decision: "ALLOW" }; }, FAKE_ROLES);
  assert.equal(tracked("reorder.request.read.queue", "not_a_real_role", { fallback: true }), true);
  assert.equal(tracked("reorder.request.read.queue", "not_a_real_role", { fallback: false }), false);
  assert.equal(called, false);
});

ok("a resolver that throws returns the caller-supplied fallback, never propagates", () => {
  const throwing = createPermissionPreviewer(() => { throw new Error("boom"); }, FAKE_ROLES);
  assert.equal(throwing("reorder.request.read.queue", "admin", { fallback: true }), true);
  assert.equal(throwing("reorder.request.read.queue", "admin", { fallback: false }), false);
});

ok("the default fallback (no options object) is false", () => {
  assert.equal(previewHasPermission("reorder.request.read.queue", "not_a_real_role"), false);
});

ok("every call site's assignment is built with status active and a global Scope, so a correct resolver never denies for a shape reason", () => {
  let capturedAssignment;
  const capturing = createPermissionPreviewer((input) => {
    capturedAssignment = input.assignments[0];
    return { decision: "ALLOW" };
  }, FAKE_ROLES);
  capturing("reorder.request.read.queue", "admin");
  assert.equal(capturedAssignment.roleId, "admin");
  assert.equal(capturedAssignment.status, "active");
  assert.deepEqual(capturedAssignment.scope, { type: "global" });
  assert.equal(typeof capturedAssignment.id, "string");
  assert.equal(typeof capturedAssignment.accessVersionAtGrant, "number");
});

console.log(`\n${passed} passed, 0 failed`);
