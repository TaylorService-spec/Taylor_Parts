// P2-N — what actually binds a PERSON to a CAPABILITY.
//
// Pins the answers to two questions the program had recorded as UNPROVEN:
//
//   (A) does the capability resolution path consider the 45 governed business Roles,
//       or only the three compatibility Roles?
//   (B) is a `roleAssignment` ever consulted in the live authorization path?
//
// Every assertion here EXECUTES the shipped resolver and the shipped services. Nothing is
// established by reading source. See docs/architecture/governed-role-binding-analysis.md.
//
// Dependency-free: plain Node assert against the compiled lib/ output, matching the convention of
// resolveEffectivePermission.test.mjs. NO emulator — every path exercised here is either pure or
// driven through an injected `db` stub.
//
// Prerequisite: `npm run build` in functions/ first (imports lib/, not src/).
import assert from "node:assert/strict";
import { resolveEffectivePermission } from "../lib/access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";
import { GOVERNED_ASSIGNABLE_ROLE_IDS } from "../lib/access/trustedWriterCommands.js";
import {
  listRecordChangeHistory,
  AUDIT_READ_CAPABILITY,
  UnauthorizedActorError,
} from "../lib/access/recordChangeHistoryReadService.js";

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") return r.then(
      () => { passed++; console.log(`  ok   ${name}`); },
      (err) => { failed++; console.error(`  FAIL ${name}: ${err.message}`); },
    );
    passed++; console.log(`  ok   ${name}`);
  } catch (err) {
    failed++; console.error(`  FAIL ${name}: ${err.message}`);
  }
  return Promise.resolve();
}

const MERGED = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
// Lift the blanket active:false gate so this suite measures BINDING, not per-environment
// activation. Activation is a separate, already-tested gate (activationOverridesWiring.test.mjs).
const ALL_ACTIVATION_OVERRIDES = new Set(
  PERMISSION_CATALOG.filter((p) => p.active === false).map((p) => p.id),
);
const GLOBAL_TARGET = {
  scope: { type: "global" },
  condition: { operationalRoleActive: () => true, isOwnAssignment: true, employmentActive: true, status: "active" },
};

function assignment(roleId, overrides = {}) {
  return {
    id: "assignment-1",
    principalUid: "principal-1",
    roleId,
    scope: { type: "global" },
    grantedBy: "granter-1",
    grantedAt: { toMillis: () => 1 },
    status: "active",
    accessVersionAtGrant: 0,
    ...overrides,
  };
}

function resolveWith(permissionId, assignments, roles) {
  return resolveEffectivePermission({
    permissionId,
    assignments,
    roles,
    currentAccessVersion: 0,
    target: GLOBAL_TARGET,
    activationOverrides: ALL_ACTIVATION_OVERRIDES,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// (B) A ROLE GRANT ALONE CONFERS NOTHING. Only a roleAssignment does.
// ─────────────────────────────────────────────────────────────────────────────

await check("B1 — admin holds customer.record.read, yet with NO assignment resolves DENY", () => {
  assert.ok(COMPATIBILITY_ROLES.admin.permissions.includes("customer.record.read"));
  const r = resolveWith("customer.record.read", [], MERGED);
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant");
});

await check("B2 — the SAME capability with an active assignment to admin resolves ALLOW", () => {
  const r = resolveWith("customer.record.read", [assignment("admin")], MERGED);
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.matchedRoleId, "admin");
});

await check("B3 — every ALLOW names the assignment it came from", () => {
  const r = resolveWith("customer.record.read", [assignment("admin")], MERGED);
  assert.equal(r.matchedAssignmentId, "assignment-1");
});

await check("B4 — a disabled assignment confers nothing", () => {
  const r = resolveWith("customer.record.read", [assignment("admin", { status: "disabled" })], MERGED);
  assert.equal(r.decision, "DENY");
});

await check("B5 — an assignment staler than the principal's accessVersion confers nothing", () => {
  const r = resolveEffectivePermission({
    permissionId: "customer.record.read",
    assignments: [assignment("admin", { accessVersionAtGrant: 9 })],
    roles: MERGED,
    currentAccessVersion: 0,
    target: GLOBAL_TARGET,
    activationOverrides: ALL_ACTIVATION_OVERRIDES,
  });
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant");
});

// ─────────────────────────────────────────────────────────────────────────────
// (A) THE GOVERNED BUSINESS ROLES ARE LIVE AUTHORITY, NOT DECLARATIONS.
// ─────────────────────────────────────────────────────────────────────────────

await check("A1 — the catalog is 3 compatibility Roles + 45 governed business Roles", () => {
  assert.equal(Object.keys(COMPATIBILITY_ROLES).length, 3);
  assert.equal(Object.keys(GOVERNED_BUSINESS_ROLES).length, 45);
});

await check("A2 — every governed business Role is grantable through the trusted-writer path", () => {
  const assignable = new Set(GOVERNED_ASSIGNABLE_ROLE_IDS);
  const unassignable = Object.keys(GOVERNED_BUSINESS_ROLES).filter((r) => !assignable.has(r));
  assert.deepEqual(unassignable, [], `governed Roles nobody can be given: ${unassignable.join(", ")}`);
});

await check("A3 — under the merged catalog, every governed Role carrying a permission resolves ALLOW", () => {
  const inert = [];
  for (const [roleId, role] of Object.entries(GOVERNED_BUSINESS_ROLES)) {
    if (role.permissions.length === 0) continue; // generalEmployee: a position marker, no capability
    const anyAllow = role.permissions.some(
      (pid) => resolveWith(pid, [assignment(roleId)], MERGED).decision === "ALLOW",
    );
    if (!anyAllow) inert.push(roleId);
  }
  assert.deepEqual(inert, [], `governed Roles that resolve no capability at all: ${inert.join(", ")}`);
});

await check("A4 — an assignment to a governed business Role is what produces the ALLOW", () => {
  const r = resolveWith("inventory.location.bin.manage", [assignment("inventoryBinAdministrator")], MERGED);
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.matchedRoleId, "inventoryBinAdministrator");
  assert.equal(r.matchedAssignmentId, "assignment-1");
});

await check("A5 — the same assignment resolves DENY against a COMPATIBILITY-ONLY catalog", () => {
  const r = resolveWith("inventory.location.bin.manage", [assignment("inventoryBinAdministrator")], COMPATIBILITY_ROLES);
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant");
});

// ─────────────────────────────────────────────────────────────────────────────
// THE MEASURED GAP. Two live Admin services default their Role catalog to
// COMPATIBILITY_ROLES and their callable wiring never overrides it, so every governed
// business Role that declares their capability is silently denied. Characterization:
// if this is fixed, these two assertions fail and should be updated, not deleted.
// ─────────────────────────────────────────────────────────────────────────────

await check("G1 — governed Roles declare audit.event.read and resolve ALLOW under the merged catalog", () => {
  const declarers = Object.keys(GOVERNED_BUSINESS_ROLES).filter((r) =>
    GOVERNED_BUSINESS_ROLES[r].permissions.includes(AUDIT_READ_CAPABILITY),
  );
  assert.ok(declarers.length > 0, "expected governed Roles to declare audit.event.read");
  for (const roleId of declarers) {
    const r = resolveWith(AUDIT_READ_CAPABILITY, [assignment(roleId)], MERGED);
    assert.equal(r.decision, "ALLOW", `${roleId} should resolve ALLOW under the merged catalog`);
  }
});

// A stub Firestore exposing exactly the surface actorHasAuditRead() touches.
function stubDb(roleId) {
  return {
    collection(name) {
      if (name === "users") {
        return { doc: () => ({ get: async () => ({ data: () => ({ accessVersion: 0 }) }) }) };
      }
      if (name === "roleAssignments") {
        const snap = { docs: [{ id: "assignment-1", data: () => assignment(roleId) }] };
        const q = { where: () => q, get: async () => snap };
        return q;
      }
      throw new Error(`stubDb: unexpected collection "${name}"`);
    },
  };
}

await check("G2 — listRecordChangeHistory REFUSES a controller, whom the resolver would ALLOW", async () => {
  // Same principal, same assignment, same capability as G1 — but through the shipped service,
  // with no `roles` dep supplied, exactly as administrationUsersCallables.ts calls it.
  assert.ok(GOVERNED_BUSINESS_ROLES.controller.permissions.includes(AUDIT_READ_CAPABILITY));
  await assert.rejects(
    () =>
      listRecordChangeHistory(
        { actorUid: "principal-1", targetType: "employee", targetId: "emp-1" },
        { db: stubDb("controller") },
      ),
    UnauthorizedActorError,
    "expected the compatibility-only default catalog to deny a governed Role holder",
  );
});

await check("G3 — the SAME service call succeeds once the merged catalog is supplied", async () => {
  const rows = await listRecordChangeHistory(
    { actorUid: "principal-1", targetType: "employee", targetId: "emp-1" },
    { db: stubDbWithEvents("controller"), roles: MERGED },
  );
  assert.ok(Array.isArray(rows), "expected the authorized path to return rows");
});

function stubDbWithEvents(roleId) {
  const base = stubDb(roleId);
  return {
    collection(name) {
      if (name === "auditEvents" || name === "employees" || name === "users") {
        const q = {
          where: () => q, orderBy: () => q, limit: () => q,
          doc: () => ({ get: async () => ({ data: () => ({ accessVersion: 0 }) }) }),
          get: async () => ({ docs: [], empty: true, forEach: () => {} }),
        };
        return name === "users" ? base.collection("users") : q;
      }
      return base.collection(name);
    },
  };
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
