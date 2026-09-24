// CAN ADMINISTRATION BE *NAVIGATED TO* YET? -- the read-entry half, proved, and the half that is not.
//
// ════════════════════ WHAT THIS FILE IS FOR ════════════════════
//
// Lane AA registered `admin.securityPolicy.read` and wrote administrationSurfaceAuthority.ts, and a
// reasonable reader concludes from that that Administration is now reachable under the EOS
// navigation authority. It is not, and the distance between those two statements is the entire
// subject of this file.
//
// TWO DIFFERENT QUESTIONS, and only one of them is answered today:
//
//   "May this principal READ this Administration surface?"      ANSWERED. By capability, by Object,
//                                                                with no Role key and no Firestore.
//                                                                Sections 1-3 prove it.
//
//   "Will the EOS navigation authority OFFER this destination?" NO, for five of the seven. The
//                                                                projection answers in SURFACE KEYS
//                                                                (eosOps/experienceAuthority.ts) and
//                                                                declares no surface for them.
//                                                                Section 4 pins that, so the gap
//                                                                cannot be mistaken for a denial.
//
// NOTHING HERE MUTATES ANYTHING and nothing here is an enforcement point. administrationSurface-
// Authority.ts says so in its own header; this file only asks it questions.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ADMINISTRATION_SURFACES,
  ADMINISTRATION_SURFACE_READ_CAPABILITY,
  administrationSurfacesReadableBy,
  mayReachAdministration,
  mayReadAdministrationSurface,
} = require("../lib/adminPolicy/administrationSurfaceAuthority.js");

// ════════════════════ THE MEASURED GRANT POPULATION ════════════════════
//
// eos-policy-nonprod (dpg-dah48qht0dsc73egnml0-a), read-only, 2026-09-24:
//
//   SELECT c.key, string_agg(r.key, ',' ORDER BY r.key)
//     FROM eos_policy.capabilities c
//     LEFT JOIN eos_policy.role_capabilities rc ON rc.capability_id = c.id
//     LEFT JOIN eos_policy.roles r              ON r.id = rc.role_id
//    GROUP BY c.key;
//
// WHY A PINNED FIXTURE RATHER THAN A LIVE READ. A test that reached nonprod would be a test that
// fails when a network does, and would make the suite depend on a database no contributor can
// reach. What a fixture buys instead is that the numbers a readiness decision was taken on are
// written down next to the decision -- so the day the population changes, this file is what says so.
//
// WHY NOT A LOCALLY-MIGRATED DATABASE EITHER. administrationReadAuthority.test.mjs already resolves
// admin / owner / dispatcher through the REAL `capabilitiesForRoleKeys` against a real PostgreSQL,
// and it is the live-resolution proof; it is not duplicated here. But its database is migrated and
// seeded from scratch, so the grants written by migrations that ran BEFORE the seed are not
// observable in it -- `admin.principalAccess.read` and `audit.event.read` both land that way. The
// population below is the one a principal actually meets, and it is the only place these five rows
// can be asserted together.
const NONPROD_HOLDERS = Object.freeze({
  "admin.securityPolicy.read": Object.freeze(["admin", "owner"]),
  "admin.principalAccess.read": Object.freeze(["admin", "owner"]),
  "workflowDefinition.read": Object.freeze(["admin", "owner"]),
  "audit.event.read": Object.freeze([
    "accountingManager", "admin", "controller", "fieldManager", "financeManager", "generalManager",
    "operationsManager", "owner", "partsManager", "salesManager", "shopManager", "warehouseManager",
  ]),
});

// THE LINEAGE DELTA, recorded rather than smoothed over. `workflowDefinition.read` is granted in
// nonprod by migration 1762128000000_workflow-definition-read-authority, which is NOT on this
// branch (nonprod has 50 migrations applied; this tree carries 48 files). On this lineage the key is
// registered and held by nobody, and administrationReadAuthority.test.mjs asserts exactly that.
// Both statements are true of their own database, and conflating them is how a readiness claim goes
// wrong: Administration > Workflows is readable by admin and owner IN NONPROD and by nobody here.
const WORKFLOW_READ_GRANTED_BY_MIGRATION_NOT_ON_THIS_BRANCH = "1762128000000";

/** The effective capability set a Role's holder resolves to, restricted to Administration reads. */
const administrationReadsHeldBy = (roleKey) => new Set(
  Object.entries(NONPROD_HOLDERS).filter(([, roles]) => roles.includes(roleKey)).map(([key]) => key),
);

// ════════════════════ 1. ADMIN AND OWNER (AG2) ════════════════════

for (const roleKey of ["admin", "owner"]) {
  test(`${roleKey} projects every Administration surface, from capabilities alone`, () => {
    const held = administrationReadsHeldBy(roleKey);
    // All four reads, and they are the four the surface map names. Not "admin is an administrator".
    assert.deepEqual([...held].sort(), [
      "admin.principalAccess.read", "admin.securityPolicy.read", "audit.event.read",
      "workflowDefinition.read",
    ]);

    // THE FIVE SURFACES AG2 ASKS ABOUT, each answered by the Object read that governs it.
    assert.equal(mayReadAdministrationSurface(held, "overview"), true);
    assert.equal(mayReadAdministrationSurface(held, "rolesPermissions"), true);
    assert.equal(mayReadAdministrationSurface(held, "objects"), true);
    assert.equal(mayReadAdministrationSurface(held, "workflows"), true);
    assert.equal(mayReadAdministrationSurface(held, "permissionPreview"), true);

    // And the whole catalogue, so an addition to it cannot pass unnoticed.
    assert.deepEqual([...administrationSurfacesReadableBy(held)], [...ADMINISTRATION_SURFACES]);
    assert.equal(mayReachAdministration(held), true);
  });
}

test("each surface is opened by its OWN Object read, and by nothing else", () => {
  // The sharp form of "no blanket capability": hold exactly one read and exactly the surfaces that
  // read governs open. A principal who can list Users must not thereby see the security matrix.
  const expected = {
    "admin.securityPolicy.read": ["overview", "objects", "rolesPermissions"],
    "admin.principalAccess.read": ["overview", "users", "permissionPreview"],
    "workflowDefinition.read": ["overview", "workflows"],
    "audit.event.read": ["overview", "auditLogs"],
  };
  for (const [key, surfaces] of Object.entries(expected)) {
    assert.deepEqual([...administrationSurfacesReadableBy([key])], surfaces,
      `${key} opens something other than the surfaces it governs`);
  }
  // Objects and Roles & Permissions are ONE authority seen twice -- that is a decision, so pin it.
  assert.equal(ADMINISTRATION_SURFACE_READ_CAPABILITY.objects,
    ADMINISTRATION_SURFACE_READ_CAPABILITY.rolesPermissions);
  // Permission Preview's ENTRY is the principal read. Its DATA SOURCE is untouched and still legacy;
  // this line is about reaching the door, never about what is behind it.
  assert.equal(ADMINISTRATION_SURFACE_READ_CAPABILITY.permissionPreview, "admin.principalAccess.read");
});

// ════════════════════ 2. DISPATCHER (AG3) ════════════════════

test("dispatcher receives NO Administration policy navigation through the governed projection", () => {
  // MEASURED, not assumed: in nonprod `dispatcher` holds 29 capabilities and not one of them sits on
  // the rolesPermissions, principal, workflowDefinition or auditLog Objects.
  const held = administrationReadsHeldBy("dispatcher");
  assert.equal(held.size, 0, "dispatcher has acquired an Administration read");

  for (const surface of ADMINISTRATION_SURFACES) {
    assert.equal(mayReadAdministrationSurface(held, surface), false,
      `dispatcher was offered Administration > ${surface}`);
  }
  assert.deepEqual([...administrationSurfacesReadableBy(held)], []);
  assert.equal(mayReachAdministration(held), false);

  // THE NARROWING IS THE POINT, and it is Owner-accepted. Dispatcher reaches Administration TODAY
  // through navConfig.js's PLACEHOLDER_DEFAULT_ROLES -- a legacy Firebase role default, not a grant.
  // Under the governed projection that default is gone and dispatcher is refused. Recording it here
  // means the day somebody "fixes" the regression, this test is what they have to argue with.
  assert.equal(NONPROD_HOLDERS["admin.securityPolicy.read"].includes("dispatcher"), false);
  assert.equal(NONPROD_HOLDERS["admin.principalAccess.read"].includes("dispatcher"), false);
  assert.equal(NONPROD_HOLDERS["audit.event.read"].includes("dispatcher"), false);
  assert.equal(NONPROD_HOLDERS["workflowDefinition.read"].includes("dispatcher"), false);
});

test("technician receives none of it either, and neither does an unknown principal", () => {
  for (const roleKey of ["technician", "noSuchRole"]) {
    assert.equal(mayReachAdministration(administrationReadsHeldBy(roleKey)), false);
  }
});

// ════════════════════ 3. NEVER A ROLE KEY, NEVER users/{uid}.role ════════════════════

test("a Role key is not a capability, in any shape a caller might pass one", () => {
  // The legacy authority this subsystem replaces is `users/{uid}.role === "admin"`. If that string
  // could ever be mistaken for authority here, the replacement would be cosmetic.
  for (const shape of [["admin"], ["owner"], ["admin", "owner", "dispatcher"], new Set(["admin"])]) {
    assert.equal(mayReachAdministration(shape), false, "a Role key opened Administration");
    assert.deepEqual([...administrationSurfacesReadableBy(shape)], []);
  }
  // And the write that legacy gating would have reached for still opens nothing.
  assert.equal(mayReachAdministration(["admin.roleAssignment.write", "admin.accessRequest.decide"]), false);
});

// ════════════════════ 4. WHAT IS *NOT* CLOSED: THE PROJECTION ════════════════════

test("the EOS navigation projection declares NO surface for five of the seven", () => {
  const { EXPERIENCE_SURFACES, EXPERIENCE_SURFACE_GAPS } = require("../lib/eosOps/experienceAuthority.js");
  const projected = new Set(EXPERIENCE_SURFACES.map((s) => s.key));

  // Two of the seven ARE projected, and they are the two that were already governed before Lane AA.
  assert.equal(projected.has("administration.users"), true);
  assert.equal(projected.has("administration.auditLogs"), true);

  // The other five are not. `grantedSurfaceKeys` iterates EXPERIENCE_SURFACES and nothing else, so a
  // capability with no surface earns no door -- holding `admin.securityPolicy.read` cannot make
  // Roles & Permissions appear, because there is no surface for the projection to return.
  for (const key of ["administration.rolesPermissions", "administration.objectsAndWorkflows",
    "administration.workflows", "administration.permissionPreview", "administration.overview"]) {
    assert.equal(projected.has(key), false, `${key} is projected -- update this readiness record`);
  }

  // Still declared gaps, with reasons that Lane AA's migration has now made STALE: the reason given
  // is "no READ capability governs it", and one now does. The gap survives for a different reason --
  // no surface, no NAV_SURFACE_ACCESS row -- and rewriting the reason is a deliberate act, not this
  // file's. Pinned so the staleness is visible rather than believed.
  const gapKeys = EXPERIENCE_SURFACE_GAPS.map((g) => g.key);
  assert.ok(gapKeys.includes("administration.rolesPermissions"));
  assert.ok(gapKeys.includes("administration.objectsAndWorkflows"));
  const rolesGap = EXPERIENCE_SURFACE_GAPS.find((g) => g.key === "administration.rolesPermissions");
  assert.match(rolesGap.reason, /No READ capability governs/,
    "the gap reason changed -- re-run the readiness matrix");
});

test("the capability exists, the surface does not, and that is the whole remaining distance", () => {
  // Said as one assertion because it is the finding: AG2's question is answered YES at the authority
  // layer and NO at the projection layer, and a readiness flag must be decided on the second.
  const admin = administrationReadsHeldBy("admin");
  const { EXPERIENCE_SURFACES } = require("../lib/eosOps/experienceAuthority.js");
  const projected = new Set(EXPERIENCE_SURFACES.map((s) => s.key));

  assert.equal(mayReadAdministrationSurface(admin, "rolesPermissions"), true, "authority layer: YES");
  assert.equal(projected.has("administration.rolesPermissions"), false, "projection layer: NO");

  assert.equal(typeof WORKFLOW_READ_GRANTED_BY_MIGRATION_NOT_ON_THIS_BRANCH, "string");
});
