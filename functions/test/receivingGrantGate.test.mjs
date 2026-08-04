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
// OWNER (Owner-ratified) inherits the capability from ADMIN by governed composition (owner >= admin).
check("OWNER allowed (inherits admin by governed composition)", () => allow(resolve([assign("owner")])));
check("OWNER stale accessVersion denied", () => deny(resolve([assign("owner", { accessVersionAtGrant: 2 })], 1)));
check("OWNER revoked/disabled assignment denied", () => {
  deny(resolve([assign("owner", { status: "inactive" })]));
  deny(resolve([assign("owner", { status: "disabled" })]));
});
check("OWNER malformed assignment state denied -- fail closed", () => {
  deny(resolve([assign("owner", { accessVersionAtGrant: "bad" })]));
  deny(resolve([assign("owner", { status: "weird" })]));
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
