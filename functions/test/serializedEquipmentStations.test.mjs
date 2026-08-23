// TWO STATIONS, TWO ROLES, AND NOBODY HOLDING BOTH.
//
// ============================ WHAT THIS FILE IS DEFENDING ============================
//
// Non-PO acquisition asserts ownership of a specific machine with NO supplier, NO order and NO
// receipt to check it against. Install places that machine at a customer IRREVERSIBLY -- Equipment
// accountId and locationId are immutable after create, and nothing clears the asset's
// currentEquipmentId.
//
// One person holding both could take a unit from non-existence to a customer's premises with no
// second party anywhere in the chain. That is the control this file exists to keep, and it has to be
// kept in four independent places, because defeating it in any ONE of them is enough:
//
//   the ROLE definitions      -- neither Role may name the other's capability
//   the ELIGIBILITY list      -- an environment must not be able to activate one via the other
//   the ENVIRONMENT registry  -- production must activate neither, whatever the data says
//   the STAFFING              -- no person may hold both Roles
//
// So the assertions below are not four phrasings of one check. They are four different ways the
// separation could be dissolved, tested where each would happen.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { __GOVERNED_ASSIGNABLE_ROLES_FOR_TEST: GRANTABLE_ROLES } =
  await import(L("functions/lib/access/trustedWriterCommands.js"));
const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY, SPINE_OVERRIDE_ELIGIBLE_IDS } =
  await import(L("functions/lib/access/environmentCapabilityOverrides.js"));
const { PERMISSION_CATALOG } = await import(L("functions/lib/access/permissionCatalog.js"));
const { buildWorkforce, SERIALIZED_EQUIPMENT_STATIONS } =
  await import(L("functions/scripts/certificationWorld/data/workforce.mjs"));

const ACQUIRE = "inventory.serializedAsset.acquire";
const INSTALL = "equipment.install";
const ACQUIRER_ROLE = "inventorySerializedAssetAcquirer";
const INSTALLER_ROLE = "equipmentInstaller";

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };

/** One principal holding exactly these Roles, asked one question, in one environment. */
const decide = (permissionId, roleIds, overrides) => resolveEffectivePermission({
  permissionId,
  assignments: roleIds.map((roleId, i) => ({
    id: `a${i}`, principalUid: "u1", roleId, status: "active",
    scope: { type: "global" }, accessVersionAtGrant: 1,
  })),
  roles: ROLES,
  currentAccessVersion: 1,
  target: GLOBAL_TARGET,
  activationOverrides: overrides,
});
const overridesFor = (projectId) => resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
const CERTWORLD = overridesFor("demo-certworld");
const SANDBOX = overridesFor("eos-platform-sandbox");

// ── 1. THE ROLES ──────────────────────────────────────────────────────────────────────────────

test("each Role carries EXACTLY its own capability and nothing else", () => {
  // Least privilege stated as an equality, not a subset. A Role that grew a second capability later
  // would still pass "includes its own id"; it would not pass this.
  assert.deepEqual([...GOVERNED_BUSINESS_ROLES[ACQUIRER_ROLE].permissions], [ACQUIRE]);
  assert.deepEqual([...GOVERNED_BUSINESS_ROLES[INSTALLER_ROLE].permissions], [INSTALL]);
});

test("neither Role is privileged, and neither is a compatibility Role", () => {
  // privileged Roles require two-person approval to grant, which would make these unstaffable by the
  // ordinary path; compatibility Roles are the legacy supersets these exist to stop relying on.
  for (const id of [ACQUIRER_ROLE, INSTALLER_ROLE]) {
    assert.equal(GOVERNED_BUSINESS_ROLES[id].privileged, false, `${id} must not be privileged`);
    assert.equal(GOVERNED_BUSINESS_ROLES[id].compatibility, false, `${id} must not be a compatibility Role`);
  }
});

test("BOTH Roles are grantable -- a Role the writer cannot name is a Role nobody can hold", () => {
  // The Admin Superset gap this program already closed once: a Role defined, visible in the catalog,
  // and impossible to give anyone. Absent from this allowlist, staffing would fail at assignment
  // time with UnknownRoleError and the stations would exist only on paper.
  assert.ok(GRANTABLE_ROLES[ACQUIRER_ROLE], `${ACQUIRER_ROLE} is not grantable`);
  assert.ok(GRANTABLE_ROLES[INSTALLER_ROLE], `${INSTALLER_ROLE} is not grantable`);
});

test("no OTHER governed business Role carries either capability", () => {
  // If some existing Role already conferred install, the new Role would be decoration and the
  // separation would be defeated by whoever holds that other Role.
  for (const [id, role] of Object.entries(GOVERNED_BUSINESS_ROLES)) {
    if (id === ACQUIRER_ROLE || id === INSTALLER_ROLE || id === "owner") continue;
    const perms = role.permissions ?? [];
    assert.equal(perms.includes(ACQUIRE), false, `${id} unexpectedly carries ${ACQUIRE}`);
    assert.equal(perms.includes(INSTALL), false, `${id} unexpectedly carries ${INSTALL}`);
  }
});

// ── 2. THE SEPARATION, SEMANTICALLY ───────────────────────────────────────────────────────────

test("SoD: the acquirer may acquire and may NOT install", () => {
  assert.equal(decide(ACQUIRE, [ACQUIRER_ROLE], CERTWORLD).decision, "ALLOW");
  const denied = decide(INSTALL, [ACQUIRER_ROLE], CERTWORLD);
  assert.equal(denied.decision, "DENY");
  // The REASON matters. `inactivePermission` would mean the environment simply had not turned
  // install on -- a denial that says nothing about the Role and would vanish the moment it did.
  // `noQualifyingGrant` is the separation actually holding.
  assert.equal(denied.reason, "noQualifyingGrant");
});

test("SoD: the installer may install and may NOT acquire", () => {
  assert.equal(decide(INSTALL, [INSTALLER_ROLE], CERTWORLD).decision, "ALLOW");
  const denied = decide(ACQUIRE, [INSTALLER_ROLE], CERTWORLD);
  assert.equal(denied.decision, "DENY");
  assert.equal(denied.reason, "noQualifyingGrant");
});

test("the receiving clerk Role does NOT confer acquisition", () => {
  // The staffing gives cw-emp-044/045 both stations, and this is what stops that being read as
  // "receiving implies acquisition". They hold both because they are staffed for both.
  assert.equal(decide(ACQUIRE, ["inventoryReceivingClerk"], CERTWORLD).decision, "DENY");
});

test("MUTATION: holding BOTH Roles would allow both -- so the staffing check is load-bearing", () => {
  // Proves the separation lives in the staffing, not in some accident of the resolver. If this
  // failed, the disjointness assertion below would be proving nothing.
  assert.equal(decide(ACQUIRE, [ACQUIRER_ROLE, INSTALLER_ROLE], CERTWORLD).decision, "ALLOW");
  assert.equal(decide(INSTALL, [ACQUIRER_ROLE, INSTALLER_ROLE], CERTWORLD).decision, "ALLOW");
});

// ── 3. ACTIVATION ─────────────────────────────────────────────────────────────────────────────

test("both capabilities are registered active:false -- activation is doing real work", () => {
  for (const id of [ACQUIRE, INSTALL]) {
    assert.equal(PERMISSION_CATALOG.find((p) => p.id === id)?.active, false,
      `${id} is not active:false; every activation entry for it would be pointless`);
  }
});

test("ACTIVATION IS NOT A GRANT", () => {
  // The whole reason activation is safe to widen. An environment turning a capability on does not
  // give it to anybody -- a principal with no qualifying Role still denies, in the environment where
  // the capability IS active.
  for (const [cap, ov] of [[ACQUIRE, SANDBOX], [INSTALL, SANDBOX], [ACQUIRE, CERTWORLD], [INSTALL, CERTWORLD]]) {
    const d = decide(cap, ["warehouseAssociate"], ov);
    assert.equal(d.decision, "DENY");
    assert.equal(d.reason, "noQualifyingGrant");
  }
});

test("the certification emulator and the sandbox both activate both ids", () => {
  for (const ov of [CERTWORLD, SANDBOX]) {
    assert.ok(ov.has(ACQUIRE), "acquire not activated");
    assert.ok(ov.has(INSTALL), "install not activated");
  }
});

test("PRODUCTION activates NEITHER", () => {
  const production = overridesFor("taylor-parts");
  assert.equal(production.size, 0, "production must resolve an empty override set");
  assert.equal(decide(ACQUIRE, [ACQUIRER_ROLE], production).decision, "DENY");
  assert.equal(decide(INSTALL, [INSTALLER_ROLE], production).decision, "DENY");
});

test("MUTATION: production is refused by ROLE, not by the absence of data", () => {
  // The registry entry is what the resolver reads, so the test forges one: a production environment
  // that DECLARES both ids. It must still resolve empty, because the block is keyed on role and does
  // not trust the declaration.
  const forged = { environments: [{ role: "production", firebase: { projectId: "taylor-parts" },
    capabilityActivationOverrides: [ACQUIRE, INSTALL] }] };
  assert.equal(resolveCapabilityOverrides(forged, "taylor-parts").size, 0,
    "a production entry declaring these ids must still activate nothing");
});

test("an UNKNOWN project and an arbitrary demo project inherit nothing", () => {
  // No prefix matching anywhere: `demo-certworld` has an entry and `demo-foo` does not, and sharing
  // the prefix must confer nothing.
  for (const projectId of ["demo-foo", "eos-platform-sandbx", "", null, undefined]) {
    assert.equal(overridesFor(projectId).size, 0, `${String(projectId)} must inherit no activation`);
  }
});

test("eligibility lists the two ids SEPARATELY, and neither implies the other", () => {
  // An eligibility entry covering both as one unit would let an environment activate install by
  // activating acquisition -- dissolving at the environment layer the separation the Role layer just
  // preserved.
  assert.ok(SPINE_OVERRIDE_ELIGIBLE_IDS.has(ACQUIRE));
  assert.ok(SPINE_OVERRIDE_ELIGIBLE_IDS.has(INSTALL));
  const forgedOne = { environments: [{ role: "sandbox", firebase: { projectId: "x" },
    capabilityActivationOverrides: [ACQUIRE] }] };
  const only = resolveCapabilityOverrides(forgedOne, "x");
  assert.equal(only.has(ACQUIRE), true);
  assert.equal(only.has(INSTALL), false, "activating acquisition must not activate install");
});

// ── 4. THE STAFFING ───────────────────────────────────────────────────────────────────────────

const workforce = buildWorkforce();
const holders = (roleId) => workforce.filter((e) => e.certGovernedRoles.includes(roleId)).map((e) => e.employeeId);

test("the staffing table and the built workforce agree", () => {
  // Two places that could disagree about who is staffed. The table is the declaration; this asserts
  // it actually reached the employee records.
  assert.deepEqual(holders(ACQUIRER_ROLE), [...SERIALIZED_EQUIPMENT_STATIONS[ACQUIRER_ROLE]]);
  assert.deepEqual(holders(INSTALLER_ROLE), [...SERIALIZED_EQUIPMENT_STATIONS[INSTALLER_ROLE]]);
});

test("ACQUIRERS ∩ INSTALLERS = ∅", () => {
  const a = new Set(holders(ACQUIRER_ROLE));
  const overlap = holders(INSTALLER_ROLE).filter((id) => a.has(id));
  assert.deepEqual(overlap, [], "an employee holding both stations defeats the separation entirely");
  assert.equal(a.size, 2);
  assert.equal(holders(INSTALLER_ROLE).length, 2);
});

test("EVERY staffed employee resolves the way the station says, and only that way", () => {
  // The end-to-end claim, per person, through the real resolver -- not through the Role definitions
  // and not through the table. This is the assertion the E01/E02 runs depend on.
  for (const id of SERIALIZED_EQUIPMENT_STATIONS[ACQUIRER_ROLE]) {
    const roles = workforce.find((e) => e.employeeId === id).certGovernedRoles;
    assert.equal(decide(ACQUIRE, roles, CERTWORLD).decision, "ALLOW", `${id} cannot acquire`);
    assert.equal(decide(INSTALL, roles, CERTWORLD).decision, "DENY", `${id} can install -- SoD broken`);
  }
  for (const id of SERIALIZED_EQUIPMENT_STATIONS[INSTALLER_ROLE]) {
    const roles = workforce.find((e) => e.employeeId === id).certGovernedRoles;
    assert.equal(decide(INSTALL, roles, CERTWORLD).decision, "ALLOW", `${id} cannot install`);
    assert.equal(decide(ACQUIRE, roles, CERTWORLD).decision, "DENY", `${id} can acquire -- SoD broken`);
  }
});

test("the installers meet the selection criteria they were chosen against", () => {
  // The criteria are recorded next to the table; this is what stops them being prose. If a future
  // edit moved the station onto an unavailable technician or someone carrying other authority, the
  // justification would silently stop being true.
  for (const id of SERIALIZED_EQUIPMENT_STATIONS[INSTALLER_ROLE]) {
    const e = workforce.find((x) => x.employeeId === id);
    assert.equal(e.securityRole, "technician", `${id} is not a technician`);
    assert.ok(e.certAssignments.includes("SERVICE"), `${id} carries no SERVICE responsibility`);
    assert.equal(e.active, true);
    assert.equal(e.certAvailable, true, `${id} is not available`);
    assert.equal(e.employmentStatus, "ACTIVE");
    assert.deepEqual(e.certGovernedRoles, [INSTALLER_ROLE],
      `${id} holds governed authority beyond the installer station -- the no-collision claim fails`);
  }
});

test("NOBODY is staffed for these stations by accident", () => {
  // 47 employees, 4 staffed. A change that widened either station would show up here rather than in
  // whatever it later allowed.
  const staffed = workforce.filter((e) =>
    e.certGovernedRoles.includes(ACQUIRER_ROLE) || e.certGovernedRoles.includes(INSTALLER_ROLE));
  assert.equal(staffed.length, 4);
  assert.equal(staffed.some((e) => e.securityRole === "admin" || e.certGovernedRoles.includes("owner")), false,
    "no staffed station may depend on an Admin or Owner identity");
});
