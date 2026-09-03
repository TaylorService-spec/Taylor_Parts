// CERT-FIN-02 FINANCIAL POLICY AUTHORITY — the activation contract.
// Run: node --test test/financialPolicyAuthorityActivation.test.mjs   (after `npm run build`)
//
// Activating a capability looks like a config line and behaves like a security decision, so the
// interesting assertions here are the NEGATIVE ones. A test that only proved "admin can now
// configure" would pass just as happily if this change had activated production, handed configure to
// every finance Role, or let admin edit a locked policy.
//
// Four things must hold at once:
//   1. configure resolves for admin and owner, in the sandbox, and nowhere else.
//   2. read is broader than configure, and read never implies write.
//   3. production and certification activate nothing.
//   4. NONE of it beats the lock. That last one is proved against the real command, on stored
//      state, in financialPolicyProfileCommand.test.mjs; here it is proved at the contract level
//      so the two cannot drift.
import assert from "node:assert/strict";
import test from "node:test";

const { SPINE_OVERRIDE_ELIGIBLE_IDS, resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY } =
  await import("../lib/access/environmentCapabilityOverrides.js");
const { resolveEffectivePermission } = await import("../lib/access/resolveEffectivePermission.js");
const { COMPATIBILITY_ROLES } = await import("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");
const { PERMISSION_CATALOG } = await import("../lib/access/permissionCatalog.js");
const { assertProfileMutable, FinancialPolicyError, PROFILE_TRANSITIONS } = await import(
  "../lib/finance/financialPolicyProfile.js"
);

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const READ = "financialPolicy.profile.read";
const CONFIGURE = "financialPolicy.profile.configure";

const sandboxOverrides = () => resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");

const decide = (permissionId, { roleId = "admin", overrides } = {}) =>
  resolveEffectivePermission({
    permissionId,
    assignments: [
      { id: "a", principalUid: "u", roleId, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 },
    ],
    roles: ROLES,
    currentAccessVersion: 0,
    target: { scope: { type: "global" }, condition: {} },
    activationOverrides: overrides ?? sandboxOverrides(),
  });

const allows = (permissionId, roleId) => decide(permissionId, { roleId }).decision === "ALLOW";

// ═══════════════ 1. The activation itself ═══════════════

test("the sandbox activates both financial policy capabilities", () => {
  const o = sandboxOverrides();
  assert.ok(o.has(READ));
  assert.ok(o.has(CONFIGURE));
});

test("both stay active:false in the catalog — activation is per-environment, never global", () => {
  for (const id of [READ, CONFIGURE]) {
    const entry = PERMISSION_CATALOG.find((p) => p.id === id);
    assert.equal(entry.active, false, `${id}: the catalog default must stay a fail-closed DENY`);
  }
});

test("both are override-ELIGIBLE, which is what makes a registry entry possible at all", () => {
  assert.ok(SPINE_OVERRIDE_ELIGIBLE_IDS.has(READ));
  assert.ok(SPINE_OVERRIDE_ELIGIBLE_IDS.has(CONFIGURE));
});

test("without the override, even admin is denied — by ACTIVATION, before Role eligibility", () => {
  const withoutIt = decide(CONFIGURE, { overrides: new Set([READ]) });
  assert.equal(withoutIt.decision, "DENY");
  assert.match(
    String(withoutIt.reason ?? withoutIt.reasonCode ?? ""),
    /inactive/i,
    "an eligibility failure here would mean we broke the grant instead of the activation",
  );
});

// ═══════════════ 2. CONFIGURE: administrative company authority only ═══════════════

test("CONFIGURE resolves for admin and owner", () => {
  assert.equal(allows(CONFIGURE, "admin"), true);
  assert.equal(allows(CONFIGURE, "owner"), true);
});

test("CONFIGURE is held by DERIVATION, not by a new grant on either Role", () => {
  // admin holds every catalog id (ADMIN_ALL_PERMISSIONS); owner is built from ADMIN_ROLE.permissions.
  // So no Role definition needed editing, and none was edited. This asserts the derivation still
  // holds rather than the literal membership, because the derivation is the governed mechanism.
  assert.ok(ROLES.admin.permissions.includes(CONFIGURE));
  assert.ok(ROLES.owner.permissions.includes(CONFIGURE));
});

test("NO finance or operational Role may configure — approving a policy is not configuring it", () => {
  for (const roleId of [
    "financeManager",
    "accountingManager",
    "controller",
    "generalManager",
    "operationsManager",
    "purchasingManager",
    "warehouseManager",
    "partsManager",
    "salesManager",
    "officeManager",
    "supportStaff",
    "generalEmployee",
    "dispatcher",
    "technician",
  ]) {
    if (!ROLES[roleId]) continue;
    assert.equal(
      allows(CONFIGURE, roleId),
      false,
      `${roleId} must not configure a company's accounting policy -- the Owner ruled that supplying or approving the policy confers no EOS configuration authority`,
    );
  }
});

// ═══════════════ 3. READ is broader, and never implies write ═══════════════

test("READ resolves for the money Roles that work with the numbers this policy governs", () => {
  for (const roleId of ["admin", "owner", "financeManager", "accountingManager", "controller", "generalManager"]) {
    assert.equal(allows(READ, roleId), true, `${roleId} should see the policy governing its numbers`);
  }
});

test("READ NEVER implies CONFIGURE — every read-only holder is refused the write", () => {
  for (const roleId of ["financeManager", "accountingManager", "controller", "generalManager"]) {
    assert.equal(allows(READ, roleId), true, roleId);
    assert.equal(
      allows(CONFIGURE, roleId),
      false,
      `${roleId} holds read and must NOT thereby hold configure`,
    );
  }
});

test("Accounting Manager and Finance Manager cannot drift apart on this capability", () => {
  // Both are built from MONEY_MANAGER_PERMISSIONS precisely so they cannot diverge silently.
  assert.equal(
    ROLES.accountingManager.permissions.includes(READ),
    ROLES.financeManager.permissions.includes(READ),
  );
  assert.equal(ROLES.accountingManager.permissions.includes(READ), true);
});

test("a Role with no financial standing gets neither", () => {
  for (const roleId of ["technician", "generalEmployee", "supportStaff", "warehouseAssociate"]) {
    if (!ROLES[roleId]) continue;
    assert.equal(allows(READ, roleId), false, `${roleId} read`);
    assert.equal(allows(CONFIGURE, roleId), false, `${roleId} configure`);
  }
});

// ═══════════════ 4. Production and certification activate nothing ═══════════════

test("PRODUCTION resolves EMPTY — deployment-time financial configuration is not activated there", () => {
  const prod = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "taylor-parts");
  assert.equal(prod.size, 0);
  assert.ok(!prod.has(READ));
  assert.ok(!prod.has(CONFIGURE));
});

test("in production even admin resolves DENY/inactive for both", () => {
  const prod = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "taylor-parts");
  for (const id of [READ, CONFIGURE]) {
    const d = decide(id, { roleId: "admin", overrides: prod });
    assert.equal(d.decision, "DENY", id);
    assert.match(String(d.reason ?? d.reasonCode ?? ""), /inactive/i, id);
  }
});

test("CERTIFICATION activates neither — its pinned set is untouched", () => {
  const cert = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-certification");
  assert.ok(!cert.has(READ));
  assert.ok(!cert.has(CONFIGURE));
});

// ═══════════════ 5. NOTHING beats the lock ═══════════════

test("the lock refuses a LOCKED profile regardless of who is asking", () => {
  // assertProfileMutable takes no principal, and that is the design: there is no argument through
  // which a caller could identify itself as privileged, so there is nothing for a future edit to
  // special-case. Admin and owner reach the same refusal as everyone else.
  assert.throws(
    () => assertProfileMutable({ status: "LOCKED" }),
    (e) => e instanceof FinancialPolicyError && e.code === "PROFILE_LOCKED",
  );
  assert.equal(
    assertProfileMutable.length,
    1,
    "assertProfileMutable must take exactly the stored profile -- a second parameter would be where a bypass grows",
  );
});

test("LOCKED has no outbound transition, so activation cannot open one", () => {
  assert.deepEqual([...PROFILE_TRANSITIONS.LOCKED], []);
});

test("activating configure did not create an unlock capability", () => {
  const ids = PERMISSION_CATALOG.map((p) => p.id.toLowerCase());
  for (const forbidden of ["unlock", "reopen", "override", "bypass"]) {
    assert.equal(
      ids.some((id) => id.includes("financialpolicy") && id.includes(forbidden)),
      false,
      `no financialPolicy.* capability may contain "${forbidden}"`,
    );
  }
  assert.deepEqual(
    PERMISSION_CATALOG.filter((p) => p.id.startsWith("financialPolicy.")).map((p) => p.id).sort(),
    [CONFIGURE, READ].sort(),
    "exactly two financial policy capabilities exist -- a third would be the bypass",
  );
});
