// EI Phase-2 Receiving -- Capability Grant Gate: OFFLINE proof of the governed resolver semantics for
// inventory.stock.receive after granting it to admin + dispatcher. Pure `node` against the compiled
// resolver + seeded roles. Prerequisite: npm run build.
import assert from "node:assert/strict";
import { resolveEffectivePermission } from "../lib/access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
// Canonical merged catalog (compat + governed-business) -- the same catalog the E1 wiring + effectiveAccessFeed resolve against.
const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const CAP = "inventory.stock.receive";
const GLOBAL = { scope: { type: "global" }, condition: {} };
function assign(roleId, over = {}) {
  return { id: `a-${roleId}`, principalUid: "p1", roleId, scope: { type: "global" }, grantedBy: "seed", grantedAt: { toMillis: () => 0 }, status: "active", accessVersionAtGrant: 1, ...over };
}
function resolve(assignments, currentAccessVersion = 1) {
  return resolveEffectivePermission({ permissionId: CAP, assignments, roles: ROLES, currentAccessVersion, target: GLOBAL });
}
const allow = (r) => assert.equal(r.decision, "ALLOW", `expected ALLOW, got ${r.decision}/${r.reason}`);
const deny = (r) => assert.equal(r.decision, "DENY", `expected DENY, got ${r.decision}`);

check("ADMIN allowed", () => allow(resolve([assign("admin")])));
check("DISPATCHER allowed", () => allow(resolve([assign("dispatcher")])));
// PIN MOVED 2026-09-24 (Owner ruling A -- narrow the compiled Owner Role). This used to read "OWNER
// allowed (inherits admin by governed composition)", which named the mechanism honestly: Owner held
// receiving because OWNER_PERMISSIONS spread ADMIN_ROLE.permissions, not because anyone decided the
// Owner should receive stock. Live nonprod never granted it -- inventory.stock.receive is one of the
// 19 capabilities held by admin and withheld from owner -- so the catalog was the thing that was
// wrong. Owner is now DENIED here, and denied for the right reason: it has no such grant.
check("OWNER denied -- receiving is warehouse execution, not oversight (ruling A)", () => {
  const r = resolve([assign("owner")]);
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant", "the DENY must be an absent grant, not an inactive capability");
});

// The assignment-state machinery below was previously exercised through `owner`. It has been moved
// to `inventoryReceivingClerk` -- the narrow standalone Role the Owner directed for this capability
// -- because a stale-version or revoked-assignment check run against a Role that no longer HOLDS
// the capability would DENY for the wrong reason and prove nothing. Same assertions, live subject.
check("holder with stale accessVersion denied", () => deny(resolve([assign("inventoryReceivingClerk", { accessVersionAtGrant: 2 })], 1)));
check("holder with revoked/disabled assignment denied", () => {
  deny(resolve([assign("inventoryReceivingClerk", { status: "inactive" })]));
  deny(resolve([assign("inventoryReceivingClerk", { status: "disabled" })]));
});
check("holder with malformed assignment state denied -- fail closed", () => {
  deny(resolve([assign("inventoryReceivingClerk", { accessVersionAtGrant: "bad" })]));
  deny(resolve([assign("inventoryReceivingClerk", { status: "weird" })]));
});
check("the moved subject really does hold the capability -- these checks are not vacuous", () => {
  allow(resolve([assign("inventoryReceivingClerk")]));
});

check("technician denied", () => deny(resolve([assign("technician")])));
check("no assignment denied -- catalog registration alone does NOT grant (no bypass)", () => deny(resolve([])));
check("unknown/superuser-named role denied (no inherited superuser)", () => deny(resolve([assign("superuser")])));

check("stale accessVersion denied (accessVersionAtGrant > current)", () => deny(resolve([assign("admin", { accessVersionAtGrant: 2 })], 1)));
check("malformed assignment state denied -- fail closed", () => {
  deny(resolve([assign("admin", { accessVersionAtGrant: "bad" })])); // non-numeric -> not well-formed -> no grant
  deny(resolve([assign("admin", { status: "weird" })]));            // status not in {active,disabled}
  deny(resolve([{ notAnAssignment: true }]));                        // structurally broken -> no grant
});

check("revocation: inactive / disabled assignment denied", () => {
  deny(resolve([assign("admin", { status: "inactive" })]));
  deny(resolve([assign("admin", { status: "disabled" })])); // well-formed but not active -> no grant
});

check("no unrelated capability changed: admin still resolves a known existing grant; technician still lacks receive", () => {
  allow(resolveEffectivePermission({ permissionId: "reorder.request.markReceived", assignments: [assign("admin")], roles: ROLES, currentAccessVersion: 1, target: GLOBAL }));
  deny(resolveEffectivePermission({ permissionId: CAP, assignments: [assign("technician")], roles: ROLES, currentAccessVersion: 1, target: GLOBAL }));
});

check("a SECOND active admin assignment still resolves ALLOW; both-inactive denies (revocation fully applied)", () => {
  allow(resolve([assign("admin", { id: "a-admin-2" }), assign("admin", { status: "inactive", id: "a-admin-3" })]));
  deny(resolve([assign("admin", { status: "inactive", id: "x1" }), assign("dispatcher", { status: "inactive", id: "x2" })]));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
