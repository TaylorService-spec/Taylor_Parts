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
import { createRequire, } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// THE PROVENANCE OF THE TWO KEYS THE WAVE 10 RULING SEPARATES, recorded because identical holder
// sets are exactly what made them look like one authority. They are not: the rows were written by
// two different mechanisms, and neither one ever writes the other's key.
//
//   admin.securityPolicy.read   granted_by migration:1762041600000
//                               -> functions/migrations/1762041600000_administration-security-policy-
//                                  read-authority.sql, whose INSERT names ('admin'|'owner',
//                                  'admin.securityPolicy.read') and nothing else.
//   admin.principalAccess.read  granted_by employee-capability-grants:<operator>
//                               -> EMPLOYEE_CAPABILITY_GRANT_KEYS, reconciled from the Role catalog
//                                  by scripts/employeeCapabilityGrantMigrationCli.js. The derivation
//                                  yields admin and owner, and it is derived rather than written.
//
// Neither key is mutated by this lane, here or anywhere.
const SECURITY_POLICY_READ_GRANTED_BY = "migration:1762041600000";
const PRINCIPAL_ACCESS_READ_GRANTED_BY = "employee-capability-grants";

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

// ════════════════════ 4. THE PROJECTION -- CLOSED (Owner ruling, Wave 9 / Lane AH) ════════════════════
//
// This section used to pin the OPPOSITE: "the EOS navigation projection declares NO surface for five
// of the seven", and "the capability exists, the surface does not, and that is the whole remaining
// distance". That distance has now been travelled, under an explicit Owner ruling, and the two stale
// gap entries were REMOVED rather than reworded -- a gap whose stated reason ("no READ capability
// governs it") is false is not a gap.
//
// WHAT DID NOT CHANGE, and the readiness claim depends on all three:
//   * No capability was minted, no Role widened, no Principal granted anything directly.
//   * EOS_NAVIGATION_AUTHORITY_READY was FALSE in every environment when this was written, so none
//     of it was reachable by anybody; Section 4 was a readiness proof, not a cutover. Wave 11 /
//     Lane AS performed the cutover in ONE non-production environment (platform-sandbox), and
//     production remains false and fenced. Nothing in THIS file changed to make that true -- which
//     is the point: the readiness proof was the whole of the code change.
//   * The projection is NOT the security boundary. Every read and command behind these surfaces
//     re-authorizes server-side on the same capability, exactly as before.

test("the five Administration surfaces are now projected, each on its own Object read", () => {
  const { EXPERIENCE_SURFACES, EXPERIENCE_SURFACE_GAPS } = require("../lib/eosOps/experienceAuthority.js");
  const byKey = new Map(EXPERIENCE_SURFACES.map((s) => [s.key, s]));

  // The two that were already governed before Lane AA, unchanged.
  assert.ok(byKey.has("administration.users"));
  assert.ok(byKey.has("administration.auditLogs"));

  // THE FOUR CAPABILITY-EARNED ONES, and the exact key each is earned by. Asserting the key and not
  // merely the presence is the point: a surface pointed at a convenient capability rather than at its
  // own Object read is the failure mode the old gap text warned about.
  const grantKeys = (key) => byKey.get(key).grants.map((g) => g.capabilityKey);
  assert.deepEqual(grantKeys("administration.rolesPermissions"), ["admin.securityPolicy.read"]);
  assert.deepEqual(grantKeys("administration.objects"), ["admin.securityPolicy.read"]);
  assert.deepEqual(grantKeys("administration.workflows"), ["workflowDefinition.read"]);
  // PERMISSION PREVIEW READS A PRINCIPAL'S EFFECTIVE ACCESS, so it is earned by the `principal`
  // Object's own read and NOT by the policy-configuration read (Owner ruling, Wave 10 -- this
  // supersedes Wave 9, which had it on `admin.securityPolicy.read`).
  assert.deepEqual(grantKeys("administration.permissionPreview"), ["admin.principalAccess.read"]);

  // NO ADMINISTRATION WRITE EARNS ANY OF THE GOVERNED-CONFIGURATION SURFACES. The old gap reason said
  // gating a read surface on `admin.roleAssignment.write` "would make a reader indistinguishable from
  // a writer"; this asserts that nothing did.
  const {
    ADMINISTRATION_WRITE_CAPABILITY_KEYS,
  } = require("../lib/adminPolicy/administrationSurfaceAuthority.js");
  const writes = new Set(ADMINISTRATION_WRITE_CAPABILITY_KEYS);
  const GOVERNED_CONFIGURATION_SURFACES = [
    "administration.rolesPermissions", "administration.objects", "administration.workflows",
    "administration.permissionPreview", "administration.overview", "administration.users",
    "administration.auditLogs",
  ];
  for (const key of GOVERNED_CONFIGURATION_SURFACES) {
    for (const capabilityKey of grantKeys(key)) {
      assert.equal(writes.has(capabilityKey), false, `${key} is earned by the WRITE ${capabilityKey}`);
    }
  }

  // THE ONE ADMINISTRATION SURFACE THAT *IS* EARNED BY A WRITE, named rather than excluded by a
  // filter nobody reads. `administration.dataImport` has been gated on `admin.dataImport.execute`
  // since it was declared, and this lane did not touch it. It is a coherent exception -- Data Import
  // is a DOING surface with no read half, so the authority to import IS the reason to be there --
  // and it is precisely why that surface is NOT a child of the Administration container above.
  // Recorded here so it stays a decision; if a `admin.dataImport.read` is ever registered, this line
  // is what says the surface should move to it.
  assert.deepEqual(grantKeys("administration.dataImport"), ["admin.dataImport.execute"]);
  assert.equal(writes.has("admin.dataImport.execute"), true);

  // THE COMBINED KEY IS GONE, NOT RENAMED. `administration.objectsAndWorkflows` was one gap key over
  // two different authorities; it survives neither as a surface nor as a gap.
  const gapKeys = EXPERIENCE_SURFACE_GAPS.map((g) => g.key);
  assert.equal(byKey.has("administration.objectsAndWorkflows"), false);
  assert.equal(gapKeys.includes("administration.objectsAndWorkflows"), false);
  assert.equal(gapKeys.includes("administration.rolesPermissions"), false,
    "rolesPermissions is declared BOTH projected and a gap");
});

test("administration.overview is a CONTAINER -- derived from its children, earnable by no capability", () => {
  const {
    EXPERIENCE_SURFACES, surfaceCatalogViolations, surfaceCatalogCapabilityKeys,
  } = require("../lib/eosOps/experienceAuthority.js");
  const overview = EXPERIENCE_SURFACES.find((s) => s.key === "administration.overview");

  // No grant path at all. There is no capability that opens it directly, so there is no id anybody
  // could be granted -- or could mint -- that would make it an unconditional door.
  assert.deepEqual(overview.grants, []);
  assert.deepEqual([...overview.containerOf].sort(), [
    "administration.auditLogs", "administration.objects", "administration.permissionPreview",
    "administration.rolesPermissions", "administration.users", "administration.workflows",
  ]);

  // Data Import is deliberately NOT a child: import authority must not open the policy menu.
  assert.equal(overview.containerOf.includes("administration.dataImport"), false);

  // Every child is a real, capability-earned surface -- the catalog invariants refuse an unknown
  // child, a self-reference and a nested container, and the whole catalog satisfies them.
  assert.deepEqual([...surfaceCatalogViolations()], []);
  // The container contributes NO capability key to the catalog's "these all exist" proof, because it
  // names none. If it ever does, that proof and this line both fail.
  assert.equal(surfaceCatalogCapabilityKeys().includes("administration.overview"), false);
});

// ═════ THE CLIENT'S DERIVED-SURFACE MIRROR IS PINNED TO THIS CATALOG -- KEYS AND CHILDREN ═════
//
// Wave 11 / Lane AS added this pin for `NAV_DERIVED_SURFACE_KEYS`, which lets navConfig.js refuse a
// placeholder row on a CONTAINER destination -- the rule that keeps `administration/overview` out of
// the shrink-only legacy register for a reason about the surface's KIND rather than its name.
//
// WAVE 12 / LANE AV WIDENED WHAT THE MIRROR CARRIES, so this pin widens with it. The client now
// answers the container under BOTH authority sources, from `NAV_DERIVED_SURFACE_CHILDREN` -- the
// same disjunction, over the same children, joined through NAV_SURFACE_ACCESS into the destinations
// its predicate can ask about. That is what makes the two ends agree BY CONSTRUCTION instead of by
// two people maintaining two lists: there is one list, it lives HERE, and the client mirrors it.
//
// SO THIS TEST IS THE WHOLE JOIN. Add a container above without adding it below, move a child, or
// -- the one that matters most -- add `administration.dataImport` to `containerOf` on either side,
// and this fails rather than letting a data-import grant quietly open the policy menu in one of the
// two places. It sits beside the `containerOf` assertion it mirrors, in the file that owns the
// answer.
test("the client's derived-surface mirror names exactly this catalog's containers AND their children", async () => {
  const { EXPERIENCE_SURFACES } = require("../lib/eosOps/experienceAuthority.js");
  const here = dirname(fileURLToPath(import.meta.url));
  const navConfigUrl = pathToFileURL(
    join(here, "..", "..", "field-ops-app-vite", "src", "navigation", "navConfig.js"),
  ).href;
  const {
    NAV_CONTAINERS, NAV_DERIVED_SURFACE_CHILDREN, NAV_DERIVED_SURFACE_KEYS, NAV_SURFACE_ACCESS,
    NAV_LEGACY_PLACEHOLDER_DESTINATIONS, containerRegisterViolations,
    legacyPlaceholderRegisterViolations, navigationSurfaceMapViolations,
  } = await import(navConfigUrl);

  const catalogContainers = EXPERIENCE_SURFACES.filter((s) => s.containerOf).map((s) => s.key).sort();
  assert.deepEqual([...NAV_DERIVED_SURFACE_KEYS].sort(), catalogContainers,
    "navConfig.js's NAV_DERIVED_SURFACE_KEYS has drifted from the surface catalog's containers");

  // THE CHILDREN, PER CONTAINER. This is the list the client's container rule actually walks.
  for (const entry of EXPERIENCE_SURFACES.filter((s) => s.containerOf)) {
    assert.deepEqual([...(NAV_DERIVED_SURFACE_CHILDREN[entry.key] ?? [])].sort(), [...entry.containerOf].sort(),
      `navConfig.js's mirror of ${entry.key}'s children has drifted from containerOf`);
  }

  // AND THE CLIENT'S CONTAINER SCOPE IS THOSE CHILDREN, joined through the surface map. Computed on
  // the client, re-derived independently here: two routes to the same six destinations.
  const expectedScope = EXPERIENCE_SURFACES.find((s) => s.key === "administration.overview").containerOf
    .map((childKey) => Object.entries(NAV_SURFACE_ACCESS).find(([, keys]) => keys.includes(childKey))?.[0]);
  assert.equal(expectedScope.includes(undefined), false,
    "a containerOf child surface is mapped to no nav destination -- the client menu could never open on it");
  assert.deepEqual([...NAV_CONTAINERS["administration/overview"]].sort(), [...expectedScope].sort());
  assert.equal(NAV_CONTAINERS["administration/overview"].includes("administration/dataImport"), false,
    "the client container would open the policy menu on a data-import grant; the server's does not");

  // Both client guards are clean against the real registers, and the shrink-only register is still
  // 62 with the container out of it -- the container answer made the row unnecessary, not allowed.
  assert.deepEqual(containerRegisterViolations(), []);
  assert.deepEqual(legacyPlaceholderRegisterViolations(), []);
  assert.deepEqual(navigationSurfaceMapViolations(), []);
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.includes("administration/overview"), false,
    "the Administration container is back in the shrink-only legacy placeholder register");
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.length, 62);
});

test("the two authority modules AGREE on every Administration surface -- pinned from both sides", () => {
  // THIS ASSERTION USED TO PIN A DIVERGENCE, and it is the same assertion, flipped by an Owner
  // ruling rather than deleted. The record of what it said matters as much as what it says now:
  //
  //   Lane AA (adminPolicy/administrationSurfaceAuthority.ts)
  //                 permissionPreview -> admin.principalAccess.read   ("the same effective-access read")
  //   Wave 9 ruling permissionPreview -> admin.securityPolicy.read    (set in EXPERIENCE_SURFACES by Lane AH)
  //   Wave 10 ruling (SUPERSEDES Wave 9, and the one in force)
  //                 permissionPreview -> admin.principalAccess.read   -- Lane AA was right
  //
  // WHY, IN THE OWNER'S OWN TERMS: Permission Preview READS AND EVALUATES A PRINCIPAL'S EFFECTIVE
  // ACCESS. That is the `principal` Object, and `admin.principalAccess.read` is its read. The
  // security-policy CONFIGURATION surfaces -- rolesPermissions and objects -- expose the
  // Role x Object x action matrix, which is nobody's effective access, and they keep
  // `admin.securityPolicy.read`. "Current grant populations being coincidentally identical does not
  // justify conflating the authorities."
  //
  // TWO FILES, ONE AUTHORITY, AND NO ROOM TO DRIFT AGAIN. The projection below is asserted to equal
  // administrationSurfaceAuthority.ts's own table ENTRY BY ENTRY and by construction rather than by
  // four hand-written strings, so neither file can move without the other or without this failing --
  // which is the property the pinned divergence existed to buy and the reason it was flipped instead
  // of removed.
  const { EXPERIENCE_SURFACES } = require("../lib/eosOps/experienceAuthority.js");
  const projection = new Map(EXPERIENCE_SURFACES.map((s) => [s.key, s.grants.map((g) => g.capabilityKey)]));

  assert.deepEqual(projection.get("administration.rolesPermissions"),
    [ADMINISTRATION_SURFACE_READ_CAPABILITY.rolesPermissions]);
  assert.deepEqual(projection.get("administration.objects"),
    [ADMINISTRATION_SURFACE_READ_CAPABILITY.objects]);
  assert.deepEqual(projection.get("administration.workflows"),
    [ADMINISTRATION_SURFACE_READ_CAPABILITY.workflows]);
  // Users carries a SECOND path (`employee.record.read`) that the read-authority table does not
  // model, so it is asserted as a superset rather than an equality -- the table's key must be among
  // the surface's grant paths, and it is the first of them.
  assert.deepEqual(projection.get("administration.users"),
    ["admin.principalAccess.read", "employee.record.read"]);
  assert.equal(projection.get("administration.users")[0],
    ADMINISTRATION_SURFACE_READ_CAPABILITY.users);

  // THE AGREEMENT, asserted from both sides so neither can move without this failing.
  assert.equal(ADMINISTRATION_SURFACE_READ_CAPABILITY.permissionPreview, "admin.principalAccess.read");
  assert.deepEqual(projection.get("administration.permissionPreview"), ["admin.principalAccess.read"]);
  assert.equal(ADMINISTRATION_SURFACE_READ_CAPABILITY.permissionPreview,
    projection.get("administration.permissionPreview")[0]);

  // AND THE SEPARATION THE RULING IS ABOUT, in the form that makes it real rather than asserted: the
  // configuration surfaces and Permission Preview are earned by DIFFERENT keys, in BOTH files.
  for (const configurationSurface of ["rolesPermissions", "objects"]) {
    assert.equal(ADMINISTRATION_SURFACE_READ_CAPABILITY[configurationSurface], "admin.securityPolicy.read");
    assert.notEqual(ADMINISTRATION_SURFACE_READ_CAPABILITY[configurationSurface],
      ADMINISTRATION_SURFACE_READ_CAPABILITY.permissionPreview,
      `${configurationSurface} and permissionPreview have been conflated onto one key again`);
    assert.notDeepEqual(projection.get(`administration.${configurationSurface}`),
      projection.get("administration.permissionPreview"));
  }

  // EVERY surface both files name is checked, not the four somebody remembered. A surface added to
  // administrationSurfaceAuthority.ts with a projection counterpart must agree too, or this fails.
  for (const s of ADMINISTRATION_SURFACES) {
    const required = ADMINISTRATION_SURFACE_READ_CAPABILITY[s];
    const paths = projection.get(`administration.${s}`);
    if (required === null || paths === undefined) continue;
    assert.equal(paths.includes(required), true,
      `administrationSurfaceAuthority says ${s} needs ${required}; EXPERIENCE_SURFACES does not offer it`);
  }

  // THE COINCIDENCE, RECORDED AND EXPLICITLY NOT RELIED ON. The two keys are held by exactly the same
  // two Roles today -- which is why no principal can presently observe the ruling at all, and why it
  // had to be decided from what the surface DOES rather than from who holds what.
  assert.deepEqual(NONPROD_HOLDERS["admin.principalAccess.read"], NONPROD_HOLDERS["admin.securityPolicy.read"]);
  // ...and they are nonetheless different rows with different PROVENANCE, which is the evidence that
  // identical populations are a coincidence rather than one authority under two names.
  assert.notEqual(SECURITY_POLICY_READ_GRANTED_BY, PRINCIPAL_ACCESS_READ_GRANTED_BY);

  assert.equal(typeof WORKFLOW_READ_GRANTED_BY_MIGRATION_NOT_ON_THIS_BRANCH, "string");
});

// ════════════════════ 5. CHANGING securityPolicy.read ALONE MOVES NOTHING ON PERMISSION PREVIEW ════════════════════
//
// AP5, and the decisive proof of the Wave 10 ruling. An authority separation that is only asserted is
// indistinguishable from a comment; what makes it real is that a CROSSED PAIR of principals gets
// crossed answers. Both halves are driven through the real `mayReadAdministrationSurface` and the
// real EXPERIENCE_SURFACES grant paths -- no capability set is described, every one is evaluated.

test("securityPolicy.read WITHOUT principalAccess.read: configuration yes, Permission Preview NO", () => {
  const { EXPERIENCE_SURFACES } = require("../lib/eosOps/experienceAuthority.js");
  const held = new Set(["admin.securityPolicy.read"]);

  assert.equal(mayReadAdministrationSurface(held, "rolesPermissions"), true);
  assert.equal(mayReadAdministrationSurface(held, "objects"), true);
  assert.equal(mayReadAdministrationSurface(held, "permissionPreview"), false,
    "securityPolicy.read alone still opens Permission Preview -- the authorities are still conflated");
  assert.equal(mayReadAdministrationSurface(held, "users"), false);
  // The Overview still opens, because the two configuration surfaces are reachable -- the container
  // is a disjunction and this principal genuinely has somewhere to go.
  assert.equal(mayReachAdministration(held), true);
  assert.deepEqual([...administrationSurfacesReadableBy(held)], ["overview", "objects", "rolesPermissions"]);

  // The SAME split in the projection catalog, which is the file this lane changed.
  const earns = (key) => EXPERIENCE_SURFACES.find((s) => s.key === key)
    .grants.some((g) => held.has(g.capabilityKey));
  assert.equal(earns("administration.rolesPermissions"), true);
  assert.equal(earns("administration.objects"), true);
  assert.equal(earns("administration.permissionPreview"), false);
});

test("principalAccess.read WITHOUT securityPolicy.read: Permission Preview yes, configuration NO", () => {
  const { EXPERIENCE_SURFACES } = require("../lib/eosOps/experienceAuthority.js");
  const held = new Set(["admin.principalAccess.read"]);

  assert.equal(mayReadAdministrationSurface(held, "permissionPreview"), true);
  assert.equal(mayReadAdministrationSurface(held, "users"), true);
  assert.equal(mayReadAdministrationSurface(held, "rolesPermissions"), false,
    "principalAccess.read reached the security-policy configuration -- the separation runs one way only");
  assert.equal(mayReadAdministrationSurface(held, "objects"), false);
  assert.equal(mayReachAdministration(held), true);
  assert.deepEqual([...administrationSurfacesReadableBy(held)], ["overview", "users", "permissionPreview"]);

  const earns = (key) => EXPERIENCE_SURFACES.find((s) => s.key === key)
    .grants.some((g) => held.has(g.capabilityKey));
  assert.equal(earns("administration.permissionPreview"), true);
  assert.equal(earns("administration.rolesPermissions"), false);
  assert.equal(earns("administration.objects"), false);
});

test("mutating admin.securityPolicy.read ALONE cannot change Permission Preview's answer", () => {
  // The claim stated as an experiment rather than as a property: hold principalAccess.read fixed,
  // swing securityPolicy.read through both of its values, and Permission Preview never moves. Then
  // do it the other way -- and the configuration surfaces never move either.
  const answer = (keys, surface) => mayReadAdministrationSurface(new Set(keys), surface);

  for (const withConfiguration of [[], ["admin.securityPolicy.read"]]) {
    assert.equal(answer(["admin.principalAccess.read", ...withConfiguration], "permissionPreview"), true);
    assert.equal(answer([...withConfiguration], "permissionPreview"), false);
  }
  for (const withPrincipal of [[], ["admin.principalAccess.read"]]) {
    assert.equal(answer(["admin.securityPolicy.read", ...withPrincipal], "rolesPermissions"), true);
    assert.equal(answer([...withPrincipal], "rolesPermissions"), false);
  }
  // Holding BOTH is the population every real Role has today, and it reaches everything -- which is
  // exactly why the crossed pairs above, and not this row, are what prove the separation.
  const both = ["admin.principalAccess.read", "admin.securityPolicy.read"];
  for (const surface of ["rolesPermissions", "objects", "permissionPreview", "users", "overview"]) {
    assert.equal(answer(both, surface), true);
  }
});
