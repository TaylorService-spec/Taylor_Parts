// SAMPLE COMPANY V2 -- the OFFLINE invariants. No database, no network, no Firebase.
//
// These are the properties that must hold before anything is ever seeded: the manifest's own shape, the
// distinctions the Owner rulings turn on (Employee != User Access, Job Role != Security Role, Record Owner !=
// Accountable Person != Assigned Person), the refusals, and the fact that the access contract can actually be
// satisfied by the Role catalog as it stands rather than by a Role somebody would have to invent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");

const seed = require("../scripts/seedSampleCompany.js");
const { MANIFEST, validateManifest, sampleCompanyCapabilityKeys, sampleCompanyRoleKeys, assertSampleCompanyInvocation,
  EMPLOYMENT_STATUS_VALUES, JOB_ROLE_VOCABULARY, MANIFEST_JOB_ROLES, PROFILE_COLUMNS } = seed;
const jobRoleVocabulary = require("../lib/eosWorkforce/jobRoleVocabulary.js");
const { deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const V1 = require("../scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json");

const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const clone = () => JSON.parse(JSON.stringify(MANIFEST));
const refusal = (mutate, pattern) => {
  const m = clone();
  mutate(m);
  assert.throws(() => validateManifest(m), pattern);
};

// ════════════════════════════ the manifest itself ════════════════════════════

test("the manifest validates as it is committed", () => {
  const lookups = validateManifest(MANIFEST);
  assert.equal(lookups.employees.size, 21);
  assert.equal(lookups.principalsByEmployee.size, 18);
});

test("employment status vocabulary is the governed one, not a second copy that could drift", () => {
  const authority = readFileSync(resolve(FUNCTIONS_DIR, "src/employeeIdentity/employeeAuthority.ts"), "utf8");
  for (const status of EMPLOYMENT_STATUS_VALUES) assert.match(authority, new RegExp(`"${status}"`));
  for (const e of MANIFEST.employees) assert.ok(EMPLOYMENT_STATUS_VALUES.includes(e.employmentStatus));
});

test("the minimum record counts the sample company is for are met", () => {
  assert.ok(MANIFEST.accounts.length >= 3, "3 Accounts");
  assert.ok(MANIFEST.contacts.length >= 6, "6 Contacts");
  assert.ok(MANIFEST.locations.length >= 5, "5 Locations");
  const kinds = (k) => MANIFEST.commercial.filter((r) => r.kind === k).length;
  assert.ok(kinds("OPPORTUNITY") >= 6, "6 Opportunities");
  assert.ok(kinds("SALES_AGREEMENT") >= 3, "3 Agreements");
  assert.ok(kinds("SALES_ORDER") >= 3, "3 Sales Orders");
  assert.ok(MANIFEST.equipmentModels.length >= 4, "4 equipment models");
  assert.ok(MANIFEST.equipment.desired.length >= 6, "6 installed equipment (declared; see the blocker)");
});

test("v2 is a byte-identical SUPERSET of the v1 synthetic seed, never a second population", () => {
  for (const e of V1.employees) {
    const carried = MANIFEST.employees.find((x) => x.key === e.key);
    assert.ok(carried, `v1 Employee ${e.key} is missing from v2`);
    assert.equal(carried.id, e.id, `v1 Employee id for ${e.key} changed`);
    assert.equal(carried.employmentStatus, e.employmentStatus);
    assert.equal(carried.jobRole, e.jobRole);
  }
  for (const a of V1.accounts) assert.ok(MANIFEST.accounts.some((x) => x.id === a.id), `v1 Account ${a.id} is missing`);
  for (const c of V1.contacts) assert.ok(MANIFEST.contacts.some((x) => x.id === c.id), `v1 Contact ${c.id} is missing`);
  for (const l of V1.locations) assert.ok(MANIFEST.locations.some((x) => x.id === l.id), `v1 Location ${l.id} is missing`);
  for (const r of V1.commercial) {
    const carried = MANIFEST.commercial.find((x) => x.number === r.number);
    assert.ok(carried, `v1 commercial record ${r.number} is missing`);
    assert.equal(carried.owner, r.owner, `${r.number} changed owner`);
    assert.equal(carried.accountable, r.accountable, `${r.number} changed accountable person`);
  }
});

// ════════════════════════════ Job Role ════════════════════════════

test("there is NEVER a generic SALES Job Role, and the two sales Job Roles are separate", () => {
  // The catalog is the PROJECTION now (Owner ruling 2026-09-25), not an array in the manifest, so the invariant is
  // asserted where the rows that reach the governed writer actually come from.
  for (const r of MANIFEST_JOB_ROLES) {
    assert.notEqual(r.key.toUpperCase(), "SALES");
    assert.notEqual(String(r.label).trim().toUpperCase(), "SALES");
  }
  assert.ok(MANIFEST_JOB_ROLES.some((r) => r.key === "RETAIL_SALES"));
  assert.ok(MANIFEST_JOB_ROLES.some((r) => r.key === "NATIONAL_ACCOUNTS_SALES"));
  // And the manifest may no longer bring a catalog of its own back, whatever it puts in it.
  refusal((m) => { m.jobRoles = [{ key: "SALES", label: "Sales" }]; }, /may not declare jobRoles/);
  refusal((m) => { m.jobRoles = []; }, /may not declare jobRoles/);
});

test("Retail Sales and National Accounts Sales are genuinely distinct, not one Job Role with two labels", () => {
  const retail = MANIFEST.employees.filter((e) => e.jobRole === "RETAIL_SALES");
  const national = MANIFEST.employees.filter((e) => e.jobRole === "NATIONAL_ACCOUNTS_SALES");
  assert.ok(retail.length >= 2 && national.length >= 1);
  const retailAccounts = MANIFEST.accounts.filter((a) => retail.some((e) => e.key === a.owner));
  const nationalAccounts = MANIFEST.accounts.filter((a) => national.some((e) => e.key === a.owner));
  assert.ok(retailAccounts.length >= 2 && nationalAccounts.length >= 1);
  assert.equal(retailAccounts.filter((a) => nationalAccounts.includes(a)).length, 0, "the two populations share no Account");
  assert.ok(retailAccounts.every((a) => a.segment === "RETAIL"));
  assert.ok(nationalAccounts.every((a) => a.segment === "NATIONAL_ACCOUNTS"));
});

// THIS SEED NO LONGER HAS A VOCABULARY OF ITS OWN (Owner ruling 2026-09-25). It used to hold fourteen keys, the
// manifest held a matching jobRoles[], and a third list of ten lived in migration/jobRoleCatalogSeed.ts. The Owner
// ruled none of them canonical. What is asserted here is the PROJECTION: that this seed's view of the vocabulary is
// the canonical one and nothing else, and that a key cannot be added from this side. Membership, the refused Security
// Role names and the P01-P16 mapping are pinned by test/canonicalJobRoleVocabulary.test.mjs.
test("the Job Role vocabulary is the canonical vocabulary, projected and not restated", () => {
  assert.deepEqual([...JOB_ROLE_VOCABULARY], [...jobRoleVocabulary.CANONICAL_JOB_ROLE_MANIFEST_KEYS]);
  assert.deepEqual(
    MANIFEST_JOB_ROLES.map((r) => [r.key, r.label, r.pgJobRoleId]),
    jobRoleVocabulary.CANONICAL_JOB_ROLES.map((r) => [r.manifestKey, r.displayName, r.jobRoleId]),
  );
  // The three keys the ruling retired, each because it named Security authority rather than a business position.
  for (const retired of ["ADMINISTRATOR", "DISPATCHER", "FINANCE_MANAGER"]) {
    assert.ok(!JOB_ROLE_VOCABULARY.includes(retired), `${retired} is a retired Job Role key`);
  }
  // Every Employee's declared position resolves in the canonical vocabulary; nothing else is assignable.
  for (const e of MANIFEST.employees) {
    assert.ok(JOB_ROLE_VOCABULARY.includes(e.jobRole), `${e.key} names Job Role ${e.jobRole}`);
  }
  refusal((m) => { m.employees[0].jobRole = "INVENTED_ROLE"; }, /undeclared Job Role INVENTED_ROLE/);
});

test("Job Role is never written to a PostgreSQL authority column", () => {
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  // The profile column map is the ONLY place this script names Employee columns; job role is absent from it.
  assert.equal(PROFILE_COLUMNS.filter(([, col]) => /job_role/.test(col)).length, 0);
  assert.ok(!/job_role/.test(source), "seedSampleCompany.js must never name a job_role column");
  // THE CLAIM THAT MOVED. The ruling used to read "Job Role authority is NOT YET IMPLEMENTED in
  // PostgreSQL", which was stale: migration 1760011200000 created eos_workforce.job_roles and
  // eos_workforce.employee_job_role_assignments and employeeJobRoleCommands.ts has been their governed
  // writer since EMP-RT-08. What stays true -- and is what this test is actually for -- is that Job Role is
  // never a COLUMN on the Employee and that THIS seed never writes one.
  assert.match(MANIFEST.rulings.jobRole, /NOT a column on eos_workforce\.employees and never will be/);
  assert.match(MANIFEST.rulings.jobRole, /employee_job_role_assignments/);
  assert.ok(MANIFEST.blockedRelationships.some((b) => b.code === "JOB_ROLE_NOT_WRITTEN_BY_THIS_SEED"));
  assert.ok(!MANIFEST.blockedRelationships.some((b) => b.code === "JOB_ROLE_POSTGRES_AUTHORITY_ABSENT"),
    "the old code claimed the PostgreSQL authority was absent; it exists and is empty, which is a different fact");
  // Every catalog entry carries the id the GOVERNED writer accepts, so nobody passes SCREAMING_CASE to it.
  // Read off the PROJECTION, because the manifest no longer declares the catalog.
  for (const r of MANIFEST_JOB_ROLES) assert.match(r.pgJobRoleId, /^[a-z][a-z0-9-]{1,62}$/, r.key);
  assert.equal(new Set(MANIFEST_JOB_ROLES.map((r) => r.pgJobRoleId)).size, MANIFEST_JOB_ROLES.length);
});

// ════════════════════════════ identity: three separate things ════════════════════════════

test("Employee != User Access: at least one ACTIVE Employee has no Principal at all", () => {
  const none = MANIFEST.employees.filter((e) => e.userAccess.state === "NONE");
  assert.ok(none.length >= 1);
  assert.ok(none.some((e) => e.employmentStatus === "ACTIVE"), "an ACTIVE Employee with no access is the sharper proof");
  for (const e of none) assert.ok(!MANIFEST.principals.some((p) => p.employee === e.key));
  refusal((m) => { for (const e of m.employees) e.userAccess = { state: "ENABLED" }; }, /at least one Employee must declare userAccess NONE/);
});

test("an Employee declaring NONE may never be given a Principal, and one declaring ENABLED must have one", () => {
  // records-clerk is the ACTIVE no-access Employee, so this refusal is the userAccess rule itself rather
  // than the accountability-eligibility rule an ON_LEAVE Employee would trip first.
  refusal((m) => {
    m.principals.push({ employee: "records-clerk", externalSubject: "synthetic-np-principal-should-not-exist", displayName: "x", securityRoles: ["technician"] });
  }, /declares userAccess NONE but is given a Principal/);
  refusal((m) => { m.principals = m.principals.filter((p) => p.employee !== "dispatcher"); }, /declares userAccess ENABLED but has no Principal/);
});

test("Employee != Principal: no Employee id is a credential-shaped subject, and no subject is an Employee id", () => {
  const subjects = new Set(MANIFEST.principals.filter((p) => !p.existingAdministrator).map((p) => p.externalSubject));
  for (const e of MANIFEST.employees) {
    assert.ok(!subjects.has(e.id), `${e.id} is used as both an Employee id and a Principal subject`);
    assert.match(e.id, /^synthetic-np-emp-/);
    // A Firebase uid is 28 unbroken URL-safe characters. Nothing here can be mistaken for one.
    assert.ok(!/^[A-Za-z0-9]{20,}$/.test(e.id), `${e.id} looks like a credential subject`);
  }
  refusal((m) => { m.employees[0].id = "AbCdEfGhIjKlMnOpQrStUvWxYz01"; }, /fixture Employee ids must be synthetic-np-emp-\*/);
});

test("a Principal carries no Job Role, and a Security Role is never inferred from one", () => {
  for (const p of MANIFEST.principals) assert.ok(!("jobRole" in p));
  refusal((m) => { m.principals[1].jobRole = "GENERAL_MANAGER"; }, /a Principal carries no Job Role/);
  // Two Employees with the SAME Job Role hold DIFFERENT Security Role sets, and two with different Job
  // Roles hold the same set -- so neither can be derived from the other.
  const roleFor = (key) => MANIFEST.principals.find((p) => p.employee === key).securityRoles.join(",");
  assert.equal(roleFor("service-technician-a"), roleFor("contract-technician"));
  assert.notEqual(MANIFEST.employees.find((e) => e.key === "contract-technician").employmentStatus,
    MANIFEST.employees.find((e) => e.key === "service-technician-a").employmentStatus);
  assert.equal(roleFor("retail-sales-a"), roleFor("national-accounts-sales"));
  assert.notEqual(MANIFEST.employees.find((e) => e.key === "retail-sales-a").jobRole,
    MANIFEST.employees.find((e) => e.key === "national-accounts-sales").jobRole);
});

test("exactly one existing administrator Principal is reused and never recreated", () => {
  const administrators = MANIFEST.principals.filter((p) => p.existingAdministrator);
  assert.equal(administrators.length, 1);
  // THE SEPARATION, AT THE IDENTITY LAYER. v1 linked the reused real administrator to the Owner / Executive
  // Employee. Owner ruling: Administrator is not Owner. The `admin` Role IS the Administrator authority, so
  // the Principal that holds it belongs to the ADMINISTRATOR Employee and to nobody else.
  assert.equal(administrators[0].employee, "administrator");
  assert.deepEqual(administrators[0].securityRoles, ["admin"]);
  assert.equal(administrators[0].fixturePrincipal, null, "the reused administrator supersedes nothing");
  assert.equal(administrators[0].loginPrincipal.disposition, "REUSE_UNCHANGED");
  assert.equal(administrators[0].loginPrincipal.externalSubject, "EXISTING_ADMINISTRATOR",
    "the real administrator's credential subject is never written into the manifest");
  refusal((m) => {
    const second = m.principals.find((p) => !p.existingAdministrator && !p.existingOwnerPrincipal);
    second.existingAdministrator = true;
    second.fixturePrincipal = null;
    second.loginPrincipal.externalSubject = "EXISTING_ADMINISTRATOR";
    second.loginPrincipal.credentialEmail = null;
    second.securityRoles = ["admin"];
  }, /exactly one existing administrator Principal is reused/);
});

test("exactly one existing OWNER Principal is reused, it is a different Principal, and it never holds admin", () => {
  const owners = MANIFEST.principals.filter((p) => p.existingOwnerPrincipal);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].employee, "owner-executive");
  assert.deepEqual(owners[0].securityRoles, ["owner"]);
  assert.equal(owners[0].fixturePrincipal, null, "the reused owner supersedes nothing");
  assert.equal(owners[0].loginPrincipal.disposition, "REUSE_UNCHANGED");
  assert.equal(owners[0].loginPrincipal.externalSubject, "EXISTING_OWNER",
    "the real owner's credential subject is never written into the manifest either");
  assert.equal(owners[0].loginPrincipal.credentialEmail, null,
    "the owner's credential is real and pre-existing; it can never become a credential-activation allowlist entry");
  // NO PERSONA IS BOTH. This is the whole ruling, asserted as a property of the file rather than as prose.
  const administrator = MANIFEST.principals.find((p) => p.existingAdministrator);
  assert.notEqual(administrator.employee, owners[0].employee);
  assert.deepEqual(MANIFEST.principals.filter((p) => p.securityRoles.includes("admin")).map((p) => p.employee), ["administrator"]);
  assert.deepEqual(MANIFEST.principals.filter((p) => p.securityRoles.includes("owner")).map((p) => p.employee), ["owner-executive"]);
  refusal((m) => {
    m.principals.find((p) => p.existingOwnerPrincipal).securityRoles = ["owner", "admin"];
  }, /the Owner \/ Executive persona may never hold admin/);
  refusal((m) => {
    const o = m.principals.find((p) => p.existingOwnerPrincipal);
    delete o.existingOwnerPrincipal;
    o.loginPrincipal.externalSubject = "RESOLVED_FROM_AUTH_UID";
    o.loginPrincipal.credentialEmail = m.employees.find((e) => e.key === "owner-executive").workEmail;
    o.fixturePrincipal = {
      identityProvider: "eos-synthetic-nonprod",
      externalSubject: "synthetic-np-principal-owner-executive",
      displayName: "SYNTHETIC NONPROD Owner (fixture, cannot sign in)",
      disposition: "SUPERSEDED_BY_LOGIN_PRINCIPAL",
    };
  }, /exactly one existing owner Principal is reused/);
});

// ════════════════════════════ responsibility: three separate facts ════════════════════════════

test("Record Owner, Accountable Person and Assigned Person are never collapsed", () => {
  const same = MANIFEST.commercial.filter((r) => r.accountable === "DERIVE_FROM_OWNER" || r.accountable === r.owner);
  const split = MANIFEST.commercial.filter((r) => r.accountable !== "DERIVE_FROM_OWNER" && r.accountable !== r.owner);
  assert.ok(same.length > 0, "owner == accountable must be represented");
  assert.ok(split.length > 0, "owner != accountable must be represented");
  // And an assignment field on a commercial record is refused outright.
  refusal((m) => { m.commercial[0].assignedTo = "service-technician-a"; }, /assignment has no governed authority/);
  refusal((m) => { m.commercial = m.commercial.map((r) => ({ ...r, accountable: "DERIVE_FROM_OWNER" })); },
    /must prove BOTH owner == accountable and owner != accountable/);
});

test("assignment is never fabricated anywhere in the manifest", () => {
  // Work Order assignment lives only in `service.desired[].desiredAssignee`, and the section says BLOCKED.
  assert.equal(MANIFEST.service.assignment.status, "BLOCKED");
  assert.equal(MANIFEST.service.assignment.blockedBy, "EMPLOYEE_ASSIGNEE_PROJECTION");
  assert.equal(MANIFEST.service.assignment.workstream, "EMP-RT-05");
  for (const w of MANIFEST.service.desired) {
    assert.ok("desiredAssignee" in w);
    assert.ok(!("assigneeEmployeeId" in w) && !("assignedTo" in w));
  }
  // Truck operators the same way.
  assert.equal(MANIFEST.trucks.operatorLink.status, "BLOCKED");
  refusal((m) => { m.trucks.records[0].operatorEmployeeId = "synthetic-np-emp-service-technician-a"; },
    /Employee<->Technician relationship is BLOCKED/);
});

test("an accountable person must be ELIGIBLE under the governed policy", () => {
  assert.deepEqual(MANIFEST.eligibilityPolicy.eligibleStatuses, ["ACTIVE", "CONTRACTOR"]);
  refusal((m) => { m.commercial[1].accountable = "technician-on-leave"; }, /not eligible under COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1/);
  refusal((m) => { m.accounts[0].owner = "technician-on-leave"; }, /not eligible under COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1/);
});

// ════════════════════════════ reporting ════════════════════════════

test("the org chart is exactly the one the sample company declares, and is acyclic", () => {
  const edges = new Map(MANIFEST.reportingRelationships.edges.map((e) => [e.employee, e.manager]));
  assert.equal(edges.get("general-manager"), "owner-executive");
  for (const k of ["office-manager", "service-manager", "retail-sales-a", "retail-sales-b", "national-accounts-sales", "parts-manager"]) {
    assert.equal(edges.get(k), "general-manager", `${k} reports to the General Manager`);
  }
  for (const k of ["dispatcher", "service-technician-a", "service-technician-b", "contract-technician", "technician-on-leave"]) {
    assert.equal(edges.get(k), "service-manager", `${k} reports to the Service Manager`);
  }
  for (const k of ["parts-associate", "warehouse-manager"]) assert.equal(edges.get(k), "parts-manager");
  assert.equal(edges.get("warehouse-associate"), "warehouse-manager");
  refusal((m) => { m.reportingRelationships.edges.find((e) => e.employee === "general-manager").manager = "general-manager"; },
    /cannot be their own manager/);
  refusal((m) => {
    m.reportingRelationships.edges.find((e) => e.employee === "owner-executive" ) ;
    m.reportingRelationships.edges.push({ employee: "owner-executive", manager: "warehouse-associate" });
    m.employees.find((e) => e.key === "owner-executive").manager = "warehouse-associate";
  }, /the reporting graph has a cycle/);
});

test("Managed Employees is non-vacuous at every management level", () => {
  const counts = MANIFEST.scenarios.find((s) => s.id === "H").expectedDirectReportCounts;
  const actual = {};
  for (const e of MANIFEST.reportingRelationships.edges) actual[e.manager] = (actual[e.manager] ?? 0) + 1;
  for (const [manager, expected] of Object.entries(counts)) {
    assert.equal(actual[manager], expected, `${manager} should manage ${expected}`);
    assert.ok(expected > 0);
  }
});

test("the profile manager and the reporting edge can never disagree", () => {
  refusal((m) => { m.employees.find((e) => e.key === "dispatcher").manager = "owner-executive"; },
    /the profile manager and the reporting edge disagree/);
});

// ════════════════════════════ access ════════════════════════════

test("every capability the access contract names is in the GOVERNED POSTGRESQL VOCABULARY", () => {
  // The measurable vocabulary is eos_policy.capabilities, not PERMISSION_CATALOG. A contract written in ids
  // the PostgreSQL authority does not register could only ever report a false negative.
  const vocabulary = new Set(MANIFEST.expectedAccess.postgresCapabilityVocabulary);
  assert.ok(vocabulary.size > 0);
  for (const [key, c] of Object.entries(MANIFEST.expectedAccess.personas)) {
    for (const cap of [...c.requiredCapabilities, ...c.forbiddenCapabilities]) {
      assert.ok(vocabulary.has(cap), `${key} names ${cap}, which is outside the governed PostgreSQL vocabulary`);
    }
  }
  const m = clone();
  m.expectedAccess.personas.dispatcher.requiredCapabilities.push("inventory.balance.read");
  assert.throws(() => validateManifest(m), /CAPABILITY_NOT_IN_VOCABULARY/);
});

test("the vocabulary gap between the Role catalog and PostgreSQL is declared, not hidden", () => {
  const vocabulary = new Set(MANIFEST.expectedAccess.postgresCapabilityVocabulary);
  const catalog = new Set(PERMISSION_CATALOG.map((p) => p.id));
  // Ids the Role catalog declares that PostgreSQL does not register -- reported as a named blocker.
  const outside = sampleCompanyCapabilityKeys().filter((k) => !vocabulary.has(k));
  assert.ok(outside.length > 0, "if this ever becomes empty the CAPABILITY_VOCABULARY_PARTIAL blocker should be retired");
  assert.ok(MANIFEST.blockedRelationships.some((b) => b.code === "CAPABILITY_VOCABULARY_PARTIAL"));
  // And ids PostgreSQL registers that NO Role declares -- the other half of the same mismatch.
  const grantedByNobody = [...vocabulary].filter((k) => !catalog.has(k));
  assert.ok(grantedByNobody.length > 0);
  assert.ok(MANIFEST.blockedRelationships.some((b) => b.code === "CAPABILITY_GRANTED_BY_NO_ROLE"));
  assert.ok(grantedByNobody.includes("workOrder.lifecycle.dispatch"));
});

test("every Security Role the manifest names exists in the governed catalog -- none is invented", () => {
  for (const p of MANIFEST.principals) {
    for (const key of p.securityRoles) assert.ok(ROLE_CATALOG[key], `Security Role ${key} is not in the governed catalog`);
  }
  const m = clone();
  m.principals[1].securityRoles = ["aRoleNobodyDefined"];
  assert.throws(() => sampleCompanyCapabilityKeys(m), /ROLE_NOT_IN_CATALOG/);
});

// THE COMPARISON NOBODY WAS MAKING. verifySampleCompany.js echoes expectedSurfaces into its report and
// never checks it against the navigation catalog, so the fixture listed commercial.agreements for both
// salesperson personas while experienceAuthority.ts declared that very key a GAP -- two files disagreeing
// in silence. A surface the navigation authority cannot govern is not a surface a persona can be expected
// to reach, whatever the persona's capabilities say.
test("no persona expects a surface the navigation catalog declares a GAP", () => {
  const { EXPERIENCE_SURFACE_GAPS } = require("../lib/eosOps/experienceAuthority.js");
  const gaps = new Set(EXPERIENCE_SURFACE_GAPS.map((g) => g.key));
  assert.ok(gaps.size > 0, "if the gap list is ever empty this guard should be retired deliberately");
  const claimed = [];
  for (const [key, c] of Object.entries(MANIFEST.expectedAccess.personas)) {
    for (const surface of c.expectedSurfaces) if (gaps.has(surface)) claimed.push(`${key}:${surface}`);
  }
  assert.deepEqual(claimed, [],
    "a persona expects a surface the navigation authority declares ungovernable; move it to surfacesUngovernedToday rather than declaring the surface, which is an Owner product decision");
  // MOVED, NOT DELETED. Each one names a declared blocker, states its own classification, and carries the
  // MEASUREMENT rather than repeating the catalog's reason -- which for commercial.agreements is itself
  // false: the salesAgreement capabilities ARE registered, and the missing half is the destination.
  const CLASSES = ["DESTINATION_ABSENT", "NO_GOVERNING_CAPABILITY", "NOT_A_NAVIGABLE_DESTINATION"];
  let ungoverned = 0;
  for (const [key, c] of Object.entries(MANIFEST.expectedAccess.personas)) {
    for (const b of c.surfacesUngovernedToday ?? []) {
      ungoverned += 1;
      assert.ok(gaps.has(b.surface), `${key}: ${b.surface} is not a catalog gap and belongs in expectedSurfaces`);
      assert.ok(CLASSES.includes(b.classification), `${key}: ${b.surface} carries ${b.classification}`);
      assert.ok(MANIFEST.blockedRelationships.some((x) => x.code === b.blockedBy), `${key}: ${b.blockedBy} is not a declared blocker`);
      assert.ok(b.catalogReason.length > 40 && b.measured.length > 40 && b.correctionOwner.length > 20,
        `${key}: ${b.surface} must quote the catalog, state the measurement and name who may correct it`);
    }
  }
  assert.ok(ungoverned >= 5, "the five contradictions this guard found must all stay recorded");

  // ── commercial.agreements: RECORDED, THEN CLOSED. Not deleted, and not quietly dropped. ──
  // This lane recorded it as DESTINATION_ABSENT with the measurement that the catalog's stated reason
  // was MEASURABLY FALSE -- the salesAgreement.* capabilities were registered and granted, and what
  // was actually missing was a destination. Lanes BL and BQ then corrected the false reason and BUILT
  // that destination, so the surface is now DECLARED WITH A DOOR and the gap is genuinely gone.
  // The guard therefore flips direction rather than being retired: the surface must NOT be a catalog
  // gap, and every persona whose Roles earn it must EXPECT it.
  assert.equal(gaps.has("commercial.agreements"), false,
    "commercial.agreements is declared with a door (surface + salesAgreement.read); it may not return to the gap list without an Owner decision");
  for (const key of ["retail-sales-a", "national-accounts-sales"]) {
    const c = MANIFEST.expectedAccess.personas[key];
    assert.ok(c.expectedSurfaces.includes("commercial.agreements"),
      `${key} earns salesAgreement.read and the destination now exists, so the surface is expected, not ungoverned`);
    assert.equal((c.surfacesUngovernedToday ?? []).some((b) => b.surface === "commercial.agreements"), false,
      `${key} still records commercial.agreements as ungoverned after the destination was built`);
  }
});

test("every REQUIRED capability is derivable from the persona's declared Roles (no ACCESS_MODEL_GAP)", () => {
  const gaps = [];
  for (const [key, c] of Object.entries(MANIFEST.expectedAccess.personas)) {
    const held = new Set(c.securityRoles.flatMap((r) => ROLE_CATALOG[r].permissions ?? []));
    for (const cap of c.requiredCapabilities) if (!held.has(cap)) gaps.push(`${key}:${cap}`);
  }
  assert.deepEqual(gaps, [], "a required capability no declared Role holds is an ACCESS_MODEL_GAP, not a seed to run");
});

test("no FORBIDDEN capability is held by any Role the persona is given", () => {
  const leaks = [];
  for (const [key, c] of Object.entries(MANIFEST.expectedAccess.personas)) {
    const held = new Set(c.securityRoles.flatMap((r) => ROLE_CATALOG[r].permissions ?? []));
    for (const cap of c.forbiddenCapabilities) if (held.has(cap)) leaks.push(`${key}:${cap}`);
  }
  assert.deepEqual(leaks, [], "a forbidden capability the declared Roles grant is a contract that cannot pass");
});

test("the specific denials the access contract is for", () => {
  const p = MANIFEST.expectedAccess.personas;
  assert.ok(p["service-technician-a"].forbiddenCapabilities.includes("admin.employeeProfile.write"), "a technician must not hold admin.employeeProfile.write");
  assert.ok(p["warehouse-associate"].forbiddenCapabilities.some((c) => c.startsWith("admin.")), "a warehouse associate must not hold administration");
  assert.ok(p["warehouse-associate"].forbiddenCapabilities.includes("inventory.cycleCount.reconcile"), "a counter must not reconcile their own variance");
  assert.ok(p["warehouse-manager"].forbiddenCapabilities.includes("inventory.cycleCount.submit"), "the reconciler must not also be the counter");
  for (const salesperson of ["retail-sales-a", "retail-sales-b", "national-accounts-sales"]) {
    // Warehouse management inside the governed PostgreSQL vocabulary: stock receipt, transfers, cycle counts.
    for (const denied of ["inventory.cycleCount.submit", "inventory.cycleCount.reconcile", "inventory.stock.receive", "inventory.transfer.create"]) {
      assert.ok(p[salesperson].forbiddenCapabilities.includes(denied), `a salesperson must not hold ${denied}`);
    }
  }
  assert.ok(p["general-manager"].forbiddenCapabilities.includes("admin.employeeProfile.write"), "the General Manager holds no security administration");
  assert.ok(p["general-manager"].forbiddenCapabilities.includes("admin.principalAccess.read"));
  // The Owner/Executive is the one persona that forbids a capability NOBODY holds -- the other half of the
  // vocabulary mismatch, asserted so it cannot quietly start resolving.
  assert.ok(p["owner-executive"].forbiddenCapabilities.includes("workOrder.lifecycle.dispatch"));
});

test("a capability may never be both required and forbidden, and all four contract parts are declared", () => {
  refusal((m) => { m.expectedAccess.personas.dispatcher.requiredCapabilities.push("admin.employeeProfile.write"); },
    /is both required and forbidden/);
  refusal((m) => { delete m.expectedAccess.personas.dispatcher.deniedSurfaces; }, /deniedSurfaces must be declared/);
});

test("the access contract and the Principal can never declare different Security Roles", () => {
  refusal((m) => { m.expectedAccess.personas.dispatcher.securityRoles = ["admin"]; },
    /declare different Security Roles/);
});

test("interactive login is declared for exactly the personas with user access", () => {
  for (const e of MANIFEST.employees) {
    const interactive = e.sandboxPersona?.interactiveLogin === true;
    assert.equal(interactive, e.userAccess.state === "ENABLED", `${e.key}: interactive login must track user access`);
  }
  // The credential half is no longer a gap: it is a phase. Every interactive persona declares the sandbox
  // account the activate-logins phase ensures, and the manifest names the existing tool that activates it.
  // The documented command is the ORCHESTRATOR's own phase -- one entry point -- and it delegates.
  assert.ok(MANIFEST.sandboxCredentials.activationCommand.includes("seedSampleCompany.js"));
  assert.ok(MANIFEST.sandboxCredentials.activationCommand.includes("--mode activate-credentials"));
  assert.ok(!MANIFEST.sandboxCredentials.activationCommand.includes("--rotate"));
  assert.ok(MANIFEST.sandboxCredentials.delegatesTo.includes("activateMissingSandboxPasswords"));
  assert.equal(MANIFEST.company.operatorWorkflow.length, 5);
});

test("the capability key set is derived from the Role catalog, never hand-typed", () => {
  const keys = sampleCompanyCapabilityKeys();
  const union = new Set(MANIFEST.principals.flatMap((p) => p.securityRoles).flatMap((r) => ROLE_CATALOG[r].permissions ?? []));
  assert.deepEqual([...keys].sort(), [...union].sort());
  assert.ok(keys.includes("admin.employeeProfile.write"), "the reporting-relationship command's own capability must be reconciled");
});

test("the capability Role scope is the Roles manifest Principals name MINUS the ones deliberately withheld", () => {
  const named = MANIFEST.principals.flatMap((p) => p.securityRoles);
  const withheld = MANIFEST.expectedAccess.roleGrantScope.withheldFromReconciliation.map((r) => r.role);
  assert.deepEqual(sampleCompanyRoleKeys(), [...new Set(named)].filter((k) => !withheld.includes(k)).sort());
  // THE WITHHOLDING IS THE OWNER RULING IN CODE. `owner` is named by a Principal and is deliberately NOT
  // reconciled: the compiled catalog declares `owner` identically to `admin` (151 permissions each), while
  // eos_policy grants `owner` 47 and `admin` 66 with 19 admin-only. Reconciling would close that gap by
  // copying the Administrator's permissions onto the Owner, which is the one solution the Owner refused.
  assert.deepEqual(withheld, ["owner"]);
  assert.ok(named.includes("owner"), "owner must still be a Role a Principal HOLDS -- only its grants are withheld");
  assert.ok(!sampleCompanyRoleKeys().includes("owner"));
  // Withholding can only ever NARROW: a Role not named by any Principal is out of scope regardless.
  const m = clone();
  m.principals = [{ ...m.principals.find((p) => p.existingAdministrator), securityRoles: ["warehouseManager", "admin", "warehouseManager"] }];
  m.expectedAccess.roleGrantScope.withheldFromReconciliation = [];
  assert.deepEqual(sampleCompanyRoleKeys(m), ["admin", "warehouseManager"]);
});

test("the capability reconciliation cannot reach a canonical Role the manifest does not name", () => {
  const scope = sampleCompanyRoleKeys();
  const outside = ["owner", "salesManager", "financeManager"];
  for (const key of outside) {
    assert.ok(ROLE_CATALOG[key], `${key} must be a canonical Role for this proof to mean anything`);
    assert.ok(!scope.includes(key), `${key} is named by the manifest; pick an absent Role`);
  }
  const keys = sampleCompanyCapabilityKeys();
  const unscoped = deriveLegacyRoleGrants(keys);
  assert.ok(unscoped.some((g) => outside.includes(g.roleKey)), "without the scope these Roles WOULD be reconciled");
  const scoped = deriveLegacyRoleGrants(keys, scope);
  assert.ok(scoped.length > 0);
  assert.ok(scoped.every((g) => scope.includes(g.roleKey)));

  // Both reconciliation calls -- the dry run and the apply -- carry the scope.
  const source = readFileSync(new URL("../scripts/seedSampleCompany.js", import.meta.url), "utf8");
  const calls = source.match(/reconcileInventoryCapabilityGrants\(pool, \{[\s\S]*?\}\)/g) ?? [];
  assert.equal(calls.length, 2);
  for (const call of calls) assert.match(call, /\broleKeys\b/, `a reconciliation call is not Role-scoped: ${call}`);
});

// ════════════════════════════ cross-domain closure ════════════════════════════

test("nothing references an identity the manifest does not declare", () => {
  refusal((m) => { m.contacts[0].account = "an-account-that-does-not-exist"; }, /names unknown Account/);
  refusal((m) => { m.locations[0].account = "an-account-that-does-not-exist"; }, /names unknown Account/);
  refusal((m) => { m.commercial[6].opportunity = "SAMPLE-CO-OPP-9999"; }, /upstream .* must be declared first/);
  refusal((m) => { m.supplierCatalogItems[0].partId = "SC-PART-NOT-DECLARED"; }, /names unknown part/);
  refusal((m) => { m.purchasing[0].warehouseId = "SC-WH-NOWHERE"; }, /names unknown warehouse/);
  refusal((m) => { m.bins[0].warehouseId = "SC-WH-NOWHERE"; }, /names unknown warehouse/);
  refusal((m) => { m.trucks.records[0].homeWarehouseId = "SC-WH-NOWHERE"; }, /names unknown home warehouse/);
  refusal((m) => { m.cycleCounts[0].lines[0].partId = "SC-PART-NOT-DECLARED"; }, /names unknown part/);
  refusal((m) => { m.equipment.desired[0].equipmentModel = "NOBODY--NOTHING"; }, /names unknown equipment model/);
  refusal((m) => { m.service.desired[0].location = "a-location-that-does-not-exist"; }, /names unknown location/);
});

test("the connected business graph really does reuse the SAME objects across domains", () => {
  // Scenario A's Account is the Account its Opportunity, Agreement and Sales Order all name.
  const account = "synthetic-np-acct-retail";
  const opportunity = MANIFEST.commercial.find((r) => r.number === "SYN-NP-OPP-0001");
  const agreement = MANIFEST.commercial.find((r) => r.number === "SYN-NP-SA-0001");
  const order = MANIFEST.commercial.find((r) => r.number === "SYN-NP-SO-0001");
  assert.equal(opportunity.account, account);
  assert.equal(agreement.opportunity, opportunity.number);
  assert.equal(order.agreement, agreement.number);
  assert.equal(MANIFEST.accounts.find((a) => a.id === account).owner, opportunity.owner);
  // Scenario E's part is the SAME part the purchasing chain, the supplier catalog and a cycle count use.
  const part = "SC-PART-COMPRESSOR-01";
  assert.ok(MANIFEST.parts.records.some((p) => p.partId === part));
  assert.ok(MANIFEST.supplierCatalogItems.some((i) => i.partId === part));
  assert.ok(MANIFEST.purchasing.some((p) => p.partId === part));
  assert.ok(MANIFEST.cycleCounts.some((c) => c.lines.some((l) => l.partId === part)));
  // And the equipment the service chain wants is the equipment installed at the Account's own Location.
  const equipment = MANIFEST.equipment.desired.find((e) => e.id === "sample-co-eq-retail-freezer-1");
  assert.equal(equipment.account, account);
  assert.equal(MANIFEST.service.desired[0].equipment, equipment.id);
  assert.equal(MANIFEST.service.desired[0].account, account);
});

test("every relationship assertion names a declared subject and object, and only backed predicates", () => {
  const known = new Set([
    ...MANIFEST.employees.map((e) => `employee:${e.key}`),
    ...MANIFEST.accounts.map((a) => `account:${a.id}`),
    ...MANIFEST.contacts.map((c) => `contact:${c.id}`),
    ...MANIFEST.locations.map((l) => `location:${l.id}`),
    ...MANIFEST.commercial.filter((r) => r.kind === "OPPORTUNITY").map((r) => `opportunity:${r.number}`),
    ...MANIFEST.commercial.filter((r) => r.kind === "SALES_AGREEMENT").map((r) => `salesAgreement:${r.number}`),
    ...MANIFEST.commercial.filter((r) => r.kind === "SALES_ORDER").map((r) => `salesOrder:${r.number}`),
    ...MANIFEST.warehouses.map((w) => `warehouse:${w.warehouseId}`),
    ...MANIFEST.trucks.records.map((t) => `truck:${t.truckId}`),
    ...MANIFEST.trucks.mobileLocations.map((l) => `mobileLocation:${l.locationId}`),
    ...MANIFEST.parts.records.map((p) => `part:${p.partId}`),
    ...MANIFEST.principals.filter((p) => p.fixturePrincipal).map((p) => `fixturePrincipal:${p.fixturePrincipal.externalSubject}`),
    ...MANIFEST.principals.filter((p) => p.loginPrincipal.credentialEmail).map((p) => `loginPrincipal:${p.loginPrincipal.credentialEmail}`),
    ...MANIFEST.purchasing.map((p) => `reorderRequest:${p.reorderRequestNumber}`),
  ]);
  for (const a of MANIFEST.relationshipAssertions) {
    assert.ok(a.authority && a.authority.length > 0, `${a.predicate} asserts no authority`);
    for (const side of [a.subject, a.object]) {
      // Composite and role handles are legitimate; only the simple kinds above are name-checked.
      if (/^(role|bin|supplierCatalogItem|purchaseOrder|receivingOrder|cycleCountLine|inventoryMovement):/.test(side)) continue;
      assert.ok(known.has(side), `relationship assertion names undeclared ${side}`);
    }
  }
});

test("every BLOCKED section names a declared blocker with a real missing authority", () => {
  const codes = new Set(MANIFEST.blockedRelationships.map((b) => b.code));
  for (const b of MANIFEST.blockedRelationships) {
    assert.ok(b.desired && b.desired.length > 0, `${b.code} does not say what it wanted`);
    assert.ok(b.missingAuthority && b.missingAuthority.length > 40, `${b.code} does not name the missing authority precisely`);
    assert.ok(Array.isArray(b.domains) && b.domains.length > 0);
  }
  for (const code of ["WORK_ORDER_POSTGRES_AUTHORITY_ABSENT", "EMPLOYEE_ASSIGNEE_PROJECTION", "INBOUND_WORK_POSTGRES_AUTHORITY_ABSENT",
    "EQUIPMENT_SERIALIZED_CUSTODY_ORIGIN_ABSENT", "PARTS_POSTGRES_WRITER_INACTIVE", "EMPLOYEE_TECHNICIAN_LINK_BLOCKED",
    "FINANCIAL_SAMPLE_COVERAGE", "REPORTING_SAMPLE_COVERAGE", "TECHNICIAN_AUTHORITY_STILL_LEGACY",
    "COMMERCIAL_RECORDS_PENDING_C5"]) {
    assert.ok(codes.has(code), `${code} must be declared`);
  }
  refusal((m) => { m.service.status = "BLOCKED"; m.service.blockedBy = "A_CODE_NOBODY_DECLARED"; },
    /is BLOCKED by A_CODE_NOBODY_DECLARED, which is not declared/);
});

// ════════════════════ the Commercial half is BLOCKED_PENDING_C5 ════════════════════
//
// Owner ruling 2026-09-23: the twelve declared-synthetic Commercial records were proven Commercial C5
// blockers and were removed from nonprod by an authorized governed cleanup. They must NOT be recreated
// before C5. Acceptance therefore states the CURRENT truth -- BLOCKED -- instead of recreating target
// Commercial truth. These tests pin the exact blocked set, so nothing else can drift into it, and pin the
// non-Commercial coverage, so nothing can quietly leave with it.

const C5_CODE = "COMMERCIAL_RECORDS_PENDING_C5";
const assertionId = (a) => `${a.subject} ${a.predicate} ${a.object}`;
// The nine triples that a Commercial ROW would have to exist to answer. Frozen, exactly.
const BLOCKED_PENDING_C5 = [
  "opportunity:SYN-NP-OPP-0001 FOR_ACCOUNT account:synthetic-np-acct-retail",
  "employee:retail-sales-a OWNS opportunity:SYN-NP-OPP-0001",
  "employee:retail-sales-a ACCOUNTABLE_FOR opportunity:SYN-NP-OPP-0001",
  "employee:general-manager ACCOUNTABLE_FOR opportunity:SYN-NP-OPP-0002",
  "employee:retail-sales-b OWNS opportunity:SYN-NP-OPP-0002",
  "employee:office-manager ACCOUNTABLE_FOR salesOrder:SYN-NP-SO-0001",
  "employee:general-manager ACCOUNTABLE_FOR salesOrder:SAMPLE-CO-SO-0003",
  "salesAgreement:SYN-NP-SA-0001 FROM_OPPORTUNITY opportunity:SYN-NP-OPP-0001",
  "salesOrder:SYN-NP-SO-0001 FROM_AGREEMENT salesAgreement:SYN-NP-SA-0001",
];

test("Commercial acceptance is BLOCKED_PENDING_C5 in the manifest's OWN vocabulary, not a parallel one", () => {
  // The state is the established one: status BLOCKED naming a declared blockedRelationships code. No new
  // status word was invented, and the generic validator walk above already enforces the code is declared.
  assert.equal(MANIFEST.commercialSeedState.status, "BLOCKED");
  assert.equal(MANIFEST.commercialSeedState.blockedBy, C5_CODE);
  assert.equal(MANIFEST.commercialSeedState.seededBy, "SAMPLE_COMPANY_V3");
  const blocker = MANIFEST.blockedRelationships.find((b) => b.code === C5_CODE);
  assert.deepEqual(blocker.domains, ["commercial"]);
  assert.match(blocker.missingAuthority, /C5/);
  assert.match(blocker.missingAuthority, /written NOWHERE/);
  // The DECLARATION is untouched: blocked is not deleted. The C5 census reads these twelve numbers to
  // classify a target row as DECLARED_SYNTHETIC rather than UNKNOWN, and v3 seeds from them.
  assert.equal(MANIFEST.commercial.length, 12);
  assert.equal(MANIFEST.commercial.filter((r) => r.kind === "OPPORTUNITY").length, 6);
  assert.equal(MANIFEST.commercial.filter((r) => r.kind === "SALES_AGREEMENT").length, 3);
  assert.equal(MANIFEST.commercial.filter((r) => r.kind === "SALES_ORDER").length, 3);
  refusal((m) => { m.commercialSeedState.status = "PENDING"; }, /commercialSeedState.status must be BLOCKED/);
});

test("the BLOCKED_PENDING_C5 set is EXACTLY the nine Commercial triples -- nothing else got carried out with them", () => {
  const blocked = MANIFEST.relationshipAssertions.filter((a) => a.blockedBy);
  assert.deepEqual(blocked.map(assertionId).sort(), [...BLOCKED_PENDING_C5].sort());
  for (const a of blocked) assert.equal(a.blockedBy, C5_CODE, `${assertionId(a)} names a different blocker`);
  // Every blocked triple genuinely needs a Commercial ROW to answer; none is blocked for convenience.
  const commercialSide = /^(opportunity|salesAgreement|salesOrder):/;
  for (const a of blocked) {
    assert.ok(commercialSide.test(a.subject) || commercialSide.test(a.object),
      `${assertionId(a)} is blocked but names no Commercial record`);
  }
  // And the converse: every triple that names a Commercial record IS blocked. No half-measure.
  for (const a of MANIFEST.relationshipAssertions) {
    if (commercialSide.test(a.subject) || commercialSide.test(a.object)) {
      assert.equal(a.blockedBy, C5_CODE, `${assertionId(a)} names a Commercial record but is not blocked`);
    }
  }
});

test("NON-COMMERCIAL acceptance coverage did not shrink: 31 assertions, still unblocked, still asserting an authority", () => {
  const unblocked = MANIFEST.relationshipAssertions.filter((a) => !a.blockedBy);
  assert.equal(MANIFEST.relationshipAssertions.length, 40, "the declared assertion count must never fall");
  assert.equal(unblocked.length, 31);
  for (const a of unblocked) {
    assert.ok(!/^(opportunity|salesAgreement|salesOrder):/.test(a.subject) && !/^(opportunity|salesAgreement|salesOrder):/.test(a.object));
    assert.ok(a.authority && a.authority.length > 0, `${assertionId(a)} asserts no authority`);
  }
  // The non-Commercial DOMAIN expectations are untouched by this ruling, stated as exact numbers so a
  // later edit that trimmed one to make a suite green would fail here first.
  assert.equal(MANIFEST.employees.length, 21);
  assert.equal(MANIFEST.accounts.length, 3);
  assert.equal(MANIFEST.contacts.length, 6);
  assert.equal(MANIFEST.locations.length, 5);
  assert.equal(MANIFEST.equipmentModels.length, 4);
  assert.equal(MANIFEST.warehouses.length, 2);
  assert.equal(MANIFEST.purchasing.length, 2);
  assert.equal(MANIFEST.cycleCounts.length, 3);
  assert.equal(MANIFEST.reportingRelationships.edges.length, 20);
});

test("scenario A is PREREQUISITE-BLOCKED, not failed, and keeps every independently testable part", () => {
  const a = MANIFEST.scenarios.find((s) => s.id === "A");
  // PARTIAL is the manifest's OWN word for "some of this is real and some of it is blocked" -- scenarios
  // C and E already use it. FAILED is what the verifier says about a scenario whose objects are DRIFTING,
  // and absent-by-ruling is not drifting.
  assert.equal(a.status, "PARTIAL");
  assert.deepEqual(a.blockedBy, [C5_CODE]);
  // Scenario A combines CRM and Commercial. The CRM half survives whole.
  assert.ok(a.covered.includes("Account") && a.covered.includes("Contact") && a.covered.includes("Location"));
  assert.ok(a.blocked.some((x) => /Opportunity/.test(x)) && a.blocked.some((x) => /Sales Agreement/.test(x))
    && a.blocked.some((x) => /Sales Order/.test(x)));
  // Scenario B is the same shape and must not have been left claiming COVERED while its records are gone.
  const b = MANIFEST.scenarios.find((s) => s.id === "B");
  assert.equal(b.status, "PARTIAL");
  assert.deepEqual(b.blockedBy, [C5_CODE]);
  // The scenarios this ruling does not touch are untouched.
  assert.equal(MANIFEST.scenarios.find((s) => s.id === "H").status, "COVERED");
  assert.equal(MANIFEST.scenarios.find((s) => s.id === "G").status, "COVERED");
  assert.equal(MANIFEST.scenarios.find((s) => s.id === "F").status, "COVERED");
  assert.equal(MANIFEST.scenarios.find((s) => s.id === "D").status, "BLOCKED");
});

test("the four commercial dashboard questions surface as prerequisite-unavailable, never as a synthetic answer", () => {
  const UNANSWERABLE = [
    ["owner-executive", "What is the whole commercial pipeline and who is accountable for each record?"],
    ["general-manager", "Which commercial records am I accountable for but do not own?"],
    ["retail-sales-a", "What is in my pipeline and at what stage?"],
    ["retail-sales-a", "Which of my records is somebody else accountable for?"],
  ];
  for (const [persona, question] of UNANSWERABLE) {
    const d = MANIFEST.dashboardCoverage.find((x) => x.persona === persona);
    assert.ok(!d.testableQuestions.includes(question), `${persona} still claims to answer: ${question}`);
    assert.ok(d.notTestable.includes(`${question} (${C5_CODE})`),
      `${persona} does not state WHY it cannot answer: ${question}`);
  }
  // No remaining testable question anywhere depends on a Commercial record.
  for (const d of MANIFEST.dashboardCoverage) {
    for (const q of d.testableQuestions) {
      assert.ok(!/pipeline|commercial record/i.test(q), `${d.persona} still claims a commercial question: ${q}`);
    }
  }
  // The same move, for the reporting object that was backed by the same rows.
  assert.ok(!MANIFEST.reportingFixtures.testableFromSeededRecords.some((x) => x.object === "opportunity"));
  assert.ok(MANIFEST.reportingFixtures.notTestable.some((x) => x.object === "opportunity" && x.reason.includes(C5_CODE)));
  // The NON-commercial coverage of the same lists is unchanged, counted exactly.
  assert.deepEqual(MANIFEST.reportingFixtures.testableFromSeededRecords.map((x) => x.object),
    ["customer", "contact", "location", "employee"]);
  assert.equal(MANIFEST.dashboardCoverage.reduce((n, d) => n + d.testableQuestions.length, 0), 18);
});

test("the seed WRITES no Commercial record while the state is BLOCKED, and v3 says what must be true first", () => {
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  // The write path is not deleted -- v3 needs it -- but it is gated on the manifest state, and the gate is
  // read before anything commercial is written.
  assert.match(source, /const commercialBlocked = manifest\.commercialSeedState\.status === "BLOCKED"/);
  assert.match(source, /if \(commercialBlocked\) \{\s*\n\s*ledger\.record\("commercial", "BLOCKED", r\.number\);/);
  assert.ok(!/INSERT INTO\s+eos_commercial/.test(source), "the seed must never insert a Commercial row directly");

  const v3 = MANIFEST.sampleCompanyV3;
  assert.equal(v3.status, "PLANNED_NOT_IMPLEMENTED");
  for (const field of ["dependsOn", "wouldSeed", "avoidsReArmingTheC5Blocker"]) {
    assert.ok(Array.isArray(v3[field]) && v3[field].length > 0, `sampleCompanyV3 does not state ${field}`);
  }
  assert.ok(v3.dependsOn.some((d) => /COMMERCIAL_C5_COMPLETE/.test(d)), "v3 must depend on C5 completing first");
  assert.ok(v3.avoidsReArmingTheC5Blocker.some((x) => /commercial-c5\|/.test(x)),
    "v3 must state how it cannot interleave with the C5 copy");
  assert.match(MANIFEST.rulings.commercialPendingC5, /must NOT be recreated before C5/);
});

test("the committed catalog writer state is respected, not overridden", () => {
  const { CATALOG_WRITER_AUTHORITY } = require("../lib/catalogMaster/catalogWriterState.js");
  assert.equal(CATALOG_WRITER_AUTHORITY.postgres, "INACTIVE");
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  // The writers may be NAMED in a comment explaining why they are not used; they must never be REQUIRED.
  assert.ok(!/require\([^)]*catalogMaster[^)]*\)/.test(source),
    "the seed must never load a catalog writer the committed state says is INACTIVE");
  assert.ok(!/INSERT INTO\s+eos_ops\.parts/.test(source),
    "eos_ops.parts is the inactive writer's own table; the seed must write no Part row");
  assert.equal(MANIFEST.parts.status, "BLOCKED");
  assert.equal(MANIFEST.parts.blockedBy, "PARTS_POSTGRES_WRITER_INACTIVE");
  assert.match(MANIFEST.rulings.catalogWriterState, /INACTIVE/);
});

test("only the two documented direct inserts exist, and each is fully documented", () => {
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  const inserts = [...source.matchAll(/INSERT INTO\s+([a-z_]+\.[a-z_]+)/g)].map((m) => m[1]);
  // ONE direct insert, and only because no governed Employee writer exists anywhere. eos_ops.parts is NOT
  // here: its governed writer exists and is INACTIVE, which is a reason to write nothing, not a licence.
  assert.deepEqual([...new Set(inserts)].sort(), ["eos_workforce.employees"]);
  const documented = new Set(MANIFEST.directInserts.map((d) => d.table));
  for (const table of new Set(inserts)) assert.ok(documented.has(table), `${table} is inserted but not documented`);
  for (const d of MANIFEST.directInserts) {
    for (const field of ["why", "fields", "driftProtection", "productionFence", "runtimeReuse"]) {
      assert.ok(d[field], `${d.table} does not document ${field}`);
    }
  }
});

test("no real-looking contact data anywhere: sandbox emails and fiction-reserved phone numbers only", () => {
  const raw = readFileSync(resolve(FUNCTIONS_DIR, "scripts/fixtures/sampleCompany.v2.json"), "utf8");
  for (const email of raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    assert.ok(email.endsWith("@sandbox.invalid"), `${email} is not a sandbox address`);
  }
  for (const phone of raw.match(/\+1-\d{3}-\d{4}/g) ?? []) {
    assert.match(phone, /^\+1-555-01\d{2}$/, `${phone} is outside the fiction-reserved range`);
  }
  for (const e of MANIFEST.employees) {
    assert.equal(e.addressCity, "Sampleton");
    assert.equal(e.addressState, "ZZ");
    assert.match(e.addressStreet, /Example/);
  }
  refusal((m) => { m.employees[0].workEmail = "someone@taylorservice.com"; }, /every work email must be @sandbox.invalid/);
  refusal((m) => { m.employees[0].workPhone = "+1-206-5551234"; }, /fiction-reserved 555-01XX range/);
});

test("employee numbers are unique and governed-shaped", () => {
  refusal((m) => { m.employees[1].employeeNumber = m.employees[0].employeeNumber; }, /duplicate employee number/);
  refusal((m) => { m.employees[0].employeeNumber = "has a space"; }, /employee number fails the governed shape/);
});

// ════════════════════════════ invocation fence (pure argument checking) ════════════════════════════

const NONPROD = { EOS_ENVIRONMENT: "nonprod", SAMPLE_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const BASE = {
  environment: "platform-sandbox", databaseUrlEnv: "SAMPLE_FENCE_DB",
  tenantKey: "taylor-nonprod", performedBy: "operator", existingAdminPrincipalId: "principal-1",
  existingOwnerPrincipalId: "principal-2",
};

test("plan is the default and writes nothing", () => {
  const options = assertSampleCompanyInvocation({ ...BASE }, NONPROD);
  assert.equal(options.mode, "plan");
  assert.equal(options.apply, false);
});

test("apply requires ALL SIX facts together", () => {
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply" }, NONPROD), /--mode apply additionally requires the explicit --apply/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, apply: "true" }, NONPROD), /--apply was given without a writing mode/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true" }, { ...NONPROD, EOS_ENVIRONMENT: "production" }), /EOS_ENVIRONMENT must read exactly 'nonprod'/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true", tenantKey: "some-other-tenant" }, NONPROD), /--tenantKey taylor-nonprod is required/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true", performedBy: undefined }, NONPROD), /--performedBy <operator> is required/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true", existingAdminPrincipalId: undefined }, NONPROD), /--existingAdminPrincipalId is required/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true", existingOwnerPrincipalId: undefined }, NONPROD), /--existingOwnerPrincipalId is required/);
  // OWNER RULING, ENFORCED AT THE FENCE: Owner and Administrator are two Principals. Naming one id twice
  // would re-merge them at the command line, which is exactly how the merged fixture would come back.
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true", existingOwnerPrincipalId: "principal-1" }, NONPROD),
    /must name DIFFERENT Principals/);
  const ok = assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true" }, NONPROD);
  assert.equal(ok.apply, true);
  assert.equal(ok.existingOwnerPrincipalId, "principal-2");
});

test("production and the Certification world are refused, and platform-sandbox is required positively", () => {
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, environment: "taylor-parts-production" }, NONPROD), /production/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, environment: "platform-certification" }, NONPROD), /Certification world, which is frozen/);
  // platform-integration is neither production nor Certification, and is STILL refused: not-production is
  // not the same as the one environment this sample company is for.
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, environment: "platform-integration" }, NONPROD), /exists only in 'platform-sandbox'/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, environment: undefined }, NONPROD), /--environment is required/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "destroy" }, NONPROD), /--mode must be one of plan, apply, activate-logins, activate-credentials, verify/);
});

test("the Certification world would pass a role-only fence, which is why it is refused by NAME", () => {
  const registry = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "..", "config", "environments.json"), "utf8"));
  const certification = registry.environments.find((e) => e.id === "platform-certification");
  assert.equal(certification.role, "sandbox", "if this ever becomes 'production' the by-name refusal is still required");
});

// ════════════════════════════ INTERACTIVE LOGIN: the chain that makes a persona real ════════════════════════════

test("the runtime identity provider is what the deployed runtime actually resolves, pinned in three places", () => {
  // MEASURED, NOT CHOSEN. If any of these three moves, this pin is the reviewed diff that notices.
  const server = readFileSync(resolve(FUNCTIONS_DIR, "src/eosApi/server.ts"), "utf8");
  assert.match(server, /identityProvider:\s*\(env\.EOS_IDENTITY_PROVIDER \?\? "firebase"\)/,
    "server.ts no longer defaults the identity provider to firebase");
  assert.match(server, /return \{ externalSubject: decoded\.uid, identityProvider \}/,
    "the verifier no longer maps the Firebase uid to the external subject");
  const principalContext = readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/principalContext.ts"), "utf8");
  assert.match(principalContext, /FIREBASE_IDENTITY_PROVIDER = "firebase"/);
  const render = readFileSync(resolve(FUNCTIONS_DIR, "..", "render.yaml"), "utf8");
  const nonprod = render.slice(render.indexOf("name: eos-api-nonprod"));
  assert.ok(!/EOS_IDENTITY_PROVIDER/.test(nonprod.slice(0, nonprod.indexOf("- type:") + 1 || undefined)),
    "eos-api-nonprod now sets EOS_IDENTITY_PROVIDER; the default no longer applies and the manifest must be revisited");
  assert.equal(seed.RUNTIME_IDENTITY_PROVIDER, "firebase");
  assert.equal(MANIFEST.company.runtimeIdentityProvider, "firebase");
});

test("(1) an interactive persona can NEVER be routed through the non-authenticating fixture provider", () => {
  for (const p of MANIFEST.principals) {
    const employee = MANIFEST.employees.find((e) => e.key === p.employee);
    if (employee.sandboxPersona?.interactiveLogin !== true) continue;
    assert.equal(p.loginPrincipal.identityProvider, "firebase", `${p.employee} must log in through the runtime provider`);
    assert.notEqual(p.loginPrincipal.identityProvider, seed.SYNTHETIC_IDENTITY_PROVIDER);
  }
  refusal((m) => { m.principals[1].loginPrincipal.identityProvider = "eos-synthetic-nonprod"; },
    /a login Principal must use the runtime provider 'firebase'/);
});

test("(2) no interactive persona resolves through a provider no verifier recognizes", () => {
  // The fixture Principal still EXISTS in the manifest -- it is what the transition supersedes -- but it is
  // never the thing a persona logs in as, and its disposition says so.
  for (const p of MANIFEST.principals) {
    // The two REUSED real Principals supersede nothing and have no fixture Principal at all.
    if (p.existingAdministrator || p.existingOwnerPrincipal) continue;
    assert.equal(p.fixturePrincipal.identityProvider, seed.SYNTHETIC_IDENTITY_PROVIDER);
    assert.equal(p.fixturePrincipal.disposition, "SUPERSEDED_BY_LOGIN_PRINCIPAL");
    assert.equal(p.loginPrincipal.disposition, "ENSURE_SANDBOX_AUTH_ACCOUNT_THEN_LINK");
  }
  refusal((m) => { m.principals[2].fixturePrincipal.identityProvider = "firebase"; },
    /the superseded fixture Principal must be declared under eos-synthetic-nonprod/);
});

// Comments are stripped FIRST throughout this section: a module that EXPLAINS why it does not reach
// Firestore, or which tool owns passwords, is not a module that does either.
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("(3) the Sample Company credential path uses Firebase AUTH and never Firestore", () => {
  for (const file of ["scripts/sampleCompany/sandboxAuthDirectory.js", "scripts/sampleCompany/loginActivation.js"]) {
    const source = stripComments(readFileSync(resolve(FUNCTIONS_DIR, file), "utf8"));
    assert.ok(!/firebase-admin\/firestore|getFirestore|\.collection\(/.test(source),
      `${file} reaches Firestore; eos_workforce.employees is the Employee authority and Firebase is identity only`);
  }
  const adapter = readFileSync(resolve(FUNCTIONS_DIR, "scripts/sampleCompany/sandboxAuthDirectory.js"), "utf8");
  assert.match(adapter, /require\("firebase-admin\/auth"\)/, "the adapter is the one place Auth is used");
  // And the seed/verifier themselves never reach Firebase at all except through that adapter.
  for (const file of ["scripts/seedSampleCompany.js", "scripts/verifySampleCompany.js"]) {
    const source = stripComments(readFileSync(resolve(FUNCTIONS_DIR, file), "utf8"));
    assert.ok(!/require\("firebase-admin/.test(source), `${file} loads firebase-admin directly`);
  }
});

test("(4) a Firebase uid is never an Employee id, and is never written into the manifest", () => {
  for (const p of MANIFEST.principals) {
    if (p.existingAdministrator) {
      assert.equal(p.loginPrincipal.externalSubject, "EXISTING_ADMINISTRATOR");
      continue;
    }
    if (p.existingOwnerPrincipal) {
      assert.equal(p.loginPrincipal.externalSubject, "EXISTING_OWNER");
      continue;
    }
    assert.equal(p.loginPrincipal.externalSubject, "RESOLVED_FROM_AUTH_UID",
      "a uid is discovered from the Auth account, never committed to the repository");
  }
  refusal((m) => {
    m.principals.find((p) => !p.existingAdministrator && !p.existingOwnerPrincipal)
      .loginPrincipal.externalSubject = "AbCdEfGhIjKlMnOpQrStUvWxYz01";
  }, /a login subject is resolved from the sandbox Auth account, never written into the manifest/);
  // The activation phase refuses a uid that collides with an Employee id, by name.
  const activation = readFileSync(resolve(FUNCTIONS_DIR, "scripts/sampleCompany/loginActivation.js"), "utf8");
  assert.ok((activation.match(/UID_IS_NOT_AN_EMPLOYEE_ID/g) || []).length >= 2,
    "both the direct uid==employeeId check and the collision-against-any-Employee check must be present");
});

test("(5)(6)(7) the credential layer cannot create, rotate or touch a secret from here", () => {
  for (const file of ["scripts/sampleCompany/sandboxAuthDirectory.js", "scripts/sampleCompany/loginActivation.js",
    "scripts/sampleCompany/credentialActivation.js", "scripts/seedSampleCompany.js"]) {
    const source = stripComments(readFileSync(resolve(FUNCTIONS_DIR, file), "utf8"));
    // `hasPassword` READS whether an account can sign in; a bare `password` would SET one. Only the second
    // is forbidden, and the distinction is the whole point of this assertion.
    assert.ok(!/(?<![A-Za-z])password\s*[:=]/.test(source), `${file} sets a password value; the Sample Company sets none`);
    assert.ok(!/randomBytes|updateUser\(/.test(source), `${file} can generate or set a credential`);
  }
  // (5) an existing account is REUSED, never deleted and never recreated.
  const activation = readFileSync(resolve(FUNCTIONS_DIR, "scripts/sampleCompany/loginActivation.js"), "utf8");
  assert.match(activation, /record\.authAccount = "REUSED"/);
  assert.ok(!/deleteUser|createUser\(/.test(activation), "the activation phase never deletes or directly creates an account");
  // (6)(7) activation is DELEGATED to the existing proven implementation, and --rotate is unreachable.
  assert.match(MANIFEST.sandboxCredentials.passwordPolicy, /--rotate is REFUSED by name/);
  assert.match(MANIFEST.sandboxCredentials.scope, /reused real Administrator is EXCLUDED/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, rotate: "true" }, NONPROD),
    /--rotate is not a Sample Company operation/);
  const tool = readFileSync(resolve(FUNCTIONS_DIR, "scripts/activateSandboxPersonas.js"), "utf8");
  assert.match(tool, /const needingPassword = considered\.filter\(\(u\) => !u\.passwordHash\)/,
    "activate-missing no longer targets only passwordless personas");
  assert.match(tool, /Refusing to overwrite a file whose contents cannot be preserved/, "the unparseable-file refusal is gone");
  // THE STANDALONE CLI STILL EXISTS AND STILL BEHAVES THE SAME: the extraction added a require.main guard
  // and an OPTIONAL allowlist, and changed nothing about the default path.
  assert.match(tool, /if \(require\.main === module\)/, "requiring this module would now run its CLI");
  assert.match(tool, /const allowlist = emailAllowlist \? new Set\(emailAllowlist\) : null;/);
  assert.match(tool, /const considered = allowlist \? personas\.filter\(\(u\) => allowlist\.has\(u\.email\)\) : personas;/,
    "the allowlist must NARROW the population, never widen it");
});

test("(8) a no-access Employee gets no Principal, no link and no Role -- ever", () => {
  for (const key of Object.keys(MANIFEST.expectedAccess.noAccessPersonas)) {
    const employee = MANIFEST.employees.find((e) => e.key === key);
    assert.equal(employee.userAccess.state, "NONE");
    assert.equal(employee.sandboxPersona.interactiveLogin, false);
    assert.ok(!MANIFEST.principals.some((p) => p.employee === key), `${key} must have no Principal`);
    assert.ok(!(key in MANIFEST.expectedAccess.personas), `${key} must have no access contract`);
    assert.equal(MANIFEST.expectedAccess.noAccessPersonas[key].expectedPrincipals, 0);
    assert.equal(MANIFEST.expectedAccess.noAccessPersonas[key].expectedRoleAssignments, 0);
  }
  // A credential is never created merely because an Employee exists.
  const activation = readFileSync(resolve(FUNCTIONS_DIR, "scripts/sampleCompany/loginActivation.js"), "utf8");
  assert.match(activation, /record\.authAccount = "NOT_REQUESTED"/);
});

test("(9) exactly one active Employee link per interactive persona, enforced by the schema itself", () => {
  const migration = readFileSync(resolve(FUNCTIONS_DIR, "migrations/1758412800000_employee-principal-linkage.sql"), "utf8");
  assert.match(migration, /CREATE UNIQUE INDEX employee_principal_links_one_active_per_employee[\s\S]*?WHERE status = 'active'/);
  assert.match(migration, /CREATE UNIQUE INDEX employee_principal_links_one_active_per_principal[\s\S]*?WHERE status = 'active'/);
  // One declared login Principal per Employee, so the manifest cannot ask for two.
  const seen = new Set();
  for (const p of MANIFEST.principals) {
    assert.ok(!seen.has(p.employee), `${p.employee} declares two Principals`);
    seen.add(p.employee);
  }
});

test("(10) the fixture link transition uses the governed lifecycle, never hand SQL", () => {
  const activation = readFileSync(resolve(FUNCTIONS_DIR, "scripts/sampleCompany/loginActivation.js"), "utf8");
  // Revoke THEN establish, both through the repository.
  assert.match(activation, /links\.revokeLinkForEmployee\(client, input\.tenantId, input\.employeeId\)/);
  assert.match(activation, /links\.establishLink\(client, \{/);
  assert.ok(!/employee_principal_links/.test(activation.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")),
    "the activation phase writes the link table by hand instead of through the repository");
  // The superseded fixture Principal is retired through the governed transaction port, with an audit event.
  assert.match(activation, /tx\.setTenantMembershipStatus\(membership\.id, "disabled"\)/);
  assert.match(activation, /tx\.appendAudit\(/);
  assert.ok(!/DELETE FROM/.test(activation), "history is preserved, never deleted for cosmetics");
});

test("(11)(12) a distinct Job Role does not require a distinct Security Role", () => {
  const retail = MANIFEST.employees.find((e) => e.key === "retail-sales-a");
  const national = MANIFEST.employees.find((e) => e.key === "national-accounts-sales");
  // (12) the JOB Roles stay distinct.
  assert.equal(retail.jobRole, "RETAIL_SALES");
  assert.equal(national.jobRole, "NATIONAL_ACCOUNTS_SALES");
  assert.notEqual(retail.jobRole, national.jobRole);
  // (11) and they intentionally share one Security Role, which is NOT a defect.
  const roleOf = (key) => MANIFEST.principals.find((p) => p.employee === key).securityRoles;
  assert.deepEqual(roleOf("retail-sales-a"), ["salesperson"]);
  assert.deepEqual(roleOf("national-accounts-sales"), ["salesperson"]);
  const finding = MANIFEST.expectedAccess.accessFindings.find((f) => f.code === "RETAIL_AND_NATIONAL_ACCOUNTS_SHARE_THE_SALESPERSON_ROLE");
  assert.equal(finding.classification, "NOT_A_GAP");
  assert.match(finding.action, /^NONE\./);
  // THE TWO AXES ARE NOT 1:1, which is what "independent" means here. Three distinct Job Roles among the
  // sales and technician populations resolve to two Security Roles, and no Security Role was created to
  // mirror a Job Role name -- the seed creates no Role at all, which the catalog test pins separately.
  const jobRolesInUse = new Set(MANIFEST.principals.map((p) => MANIFEST.employees.find((e) => e.key === p.employee).jobRole));
  const securityRolesInUse = new Set(MANIFEST.principals.flatMap((p) => p.securityRoles));
  assert.ok(jobRolesInUse.size > 1 && securityRolesInUse.size > 1);
  const salesJobRoles = [...jobRolesInUse].filter((r) => r.endsWith("_SALES"));
  assert.equal(salesJobRoles.length, 2, "both sales Job Roles are in use");
  assert.equal(new Set(["retail-sales-a", "retail-sales-b", "national-accounts-sales"].flatMap(roleOf)).size, 1,
    "the two sales Job Roles resolve to exactly one shared Security Role");
});

test("(13) the access-gap classification is exhaustive: every finding carries exactly one of the five classes", () => {
  const CLASSES = ["SEED_GRANT_GAP", "POSTGRES_VOCABULARY_GAP", "DOMAIN_AUTHORITY_NOT_CUT_OVER", "NOT_A_GAP", "CONDITIONAL_AUTHORITY_GAP"];
  assert.deepEqual(MANIFEST.expectedAccess.gapClasses, CLASSES);
  assert.ok(MANIFEST.expectedAccess.accessFindings.length > 0);
  for (const f of MANIFEST.expectedAccess.accessFindings) {
    assert.ok(CLASSES.includes(f.classification), `${f.code} carries ${f.classification}`);
    assert.ok(f.finding && f.action, `${f.code} must say what was found and what was done`);
    if (f.classification !== "NOT_A_GAP") assert.ok(f.authorityEvidence, `${f.code} must carry authority evidence`);
    for (const persona of f.personas) assert.ok(persona in MANIFEST.expectedAccess.personas, `${f.code} names unknown persona ${persona}`);
  }
  // Every persona-level gap points at a declared finding, and nothing is left unclassified.
  for (const [key, p] of Object.entries(MANIFEST.expectedAccess.personas)) {
    if (!p.accessModelGap) continue;
    const finding = MANIFEST.expectedAccess.accessFindings.find((f) => f.code === p.accessModelGap.code);
    assert.ok(finding, `${key} names undeclared finding ${p.accessModelGap.code}`);
    assert.equal(p.accessModelGap.classification, finding.classification);
  }
  assert.equal(MANIFEST.expectedAccess.seedGrantGap.classification, "SEED_GRANT_GAP");
  assert.equal(MANIFEST.expectedAccess.postgresVocabularyGaps.classification, "POSTGRES_VOCABULARY_GAP");
});

test("(14) SEED_GRANT_GAP reconciles only pairs the Role catalog declares for that Role", () => {
  // The reconciliation derives its pairs from the Role objects themselves; it cannot invent one.
  const migration = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/inventoryCapabilityGrantMigration.ts"), "utf8");
  assert.match(migration, /for \(const permissionId of role\.permissions \?\? \[\]\)/,
    "grants are no longer derived from the Role catalog's own permission arrays");
  assert.match(migration, /status: "UNKNOWN_CAPABILITY"/);
  assert.match(migration, /status: "UNRESOLVED_ROLE"/);
  // And the orchestrator fails closed on either.
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  assert.match(source, /CAPABILITY_GRANT_UNRESOLVED/);
  assert.ok(!/INSERT INTO eos_policy\.role_capabilities/.test(source), "the seed writes a grant by hand");
  assert.match(MANIFEST.expectedAccess.seedGrantGap.action, /no ad-hoc SQL/);
});

test("(15) DOMAIN_AUTHORITY_NOT_CUT_OVER never yields a synthetic capability or grant", () => {
  const vocabulary = new Set(MANIFEST.expectedAccess.postgresCapabilityVocabulary);
  const blocked = MANIFEST.expectedAccess.accessFindings.filter((f) => f.classification === "DOMAIN_AUTHORITY_NOT_CUT_OVER");
  assert.ok(blocked.length > 0);
  for (const f of blocked) {
    assert.match(f.action, /^BLOCKED\./, `${f.code} must stay blocked`);
    for (const persona of f.personas) {
      // Nothing the blocked domain would need appears as a REQUIRED capability for its personas.
      for (const cap of MANIFEST.expectedAccess.personas[persona].requiredCapabilities) {
        assert.ok(vocabulary.has(cap), `${persona} requires ${cap}, which is outside the registered vocabulary`);
      }
    }
  }
  // No registration migration was authored for a runtime that does not exist.
  assert.deepEqual(MANIFEST.expectedAccess.postgresVocabularyGaps.found, []);
});

test("(20) the Part direct-insert documentation matches the executable behaviour", () => {
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  // THE EXECUTABLE FACT, read from the code rather than from a comment.
  const inserts = [...source.matchAll(/INSERT INTO\s+([a-z_]+\.[a-z_]+)/g)].map((m) => m[1]);
  assert.ok(!inserts.includes("eos_ops.parts"), "the seed inserts eos_ops.parts");
  // Every claim about it agrees.
  assert.deepEqual(MANIFEST.directInserts.map((d) => d.table), ["eos_workforce.employees"]);
  assert.equal(MANIFEST.parts.status, "BLOCKED");
  assert.match(source, /Parts\s+NOTHING IS WRITTEN/, "the orchestrator header still claims a Part direct insert");
  assert.ok(!/Part identity\s+DIRECT INSERT/.test(source), "a stale direct-insert claim survives in the header");
  // The purchasing fixtures are truthful about the part ids they carry.
  assert.match(MANIFEST.blockedRelationships.find((b) => b.code === "PARTS_POSTGRES_WRITER_INACTIVE").missingAuthority,
    /unjoined governed keys \(no foreign key references eos_ops\.parts\)/);
  const declared = new Set(MANIFEST.parts.records.map((r) => r.partId));
  for (const p of MANIFEST.purchasing) assert.ok(declared.has(p.partId));
});

test("activate-logins is a separately explicit phase that names its credential target", () => {
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "activate-logins" }, NONPROD),
    /--mode activate-logins additionally requires the explicit --apply/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "activate-logins", apply: "true" }, NONPROD),
    /--mode activate-logins requires --firebaseProjectId/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, firebaseProjectId: "eos-platform-sandbox" }, NONPROD),
    /--firebaseProjectId belongs only to the credential-layer modes/);
  const ok = assertSampleCompanyInvocation({ ...BASE, mode: "activate-logins", apply: "true", firebaseProjectId: "eos-platform-sandbox" }, NONPROD);
  assert.equal(ok.mode, "activate-logins");
  assert.equal(ok.apply, true);
});

test("the sandbox Auth adapter refuses production and the Certification world by name", async () => {
  const { assertSandboxAuthTarget, assertSandboxEmail } = require("../scripts/sampleCompany/sandboxAuthDirectory.js");
  assert.throws(() => assertSandboxAuthTarget("taylor-parts"), /customer production project/);
  assert.throws(() => assertSandboxAuthTarget("eos-platform-certification"), /Certification world, which is frozen/);
  assert.throws(() => assertSandboxAuthTarget("someone-elses-project"), /not a Firebase project declared/);
  assert.throws(() => assertSandboxAuthTarget(undefined), /--firebaseProjectId is required/);
  assert.equal(assertSandboxAuthTarget("eos-platform-sandbox"), "platform-sandbox");
  // Only sandbox addresses are ever touched.
  assert.throws(() => assertSandboxEmail("someone@taylorservice.com"), /is not a @sandbox.invalid address/);
  assert.equal(assertSandboxEmail("harper.fixture@sandbox.invalid"), "harper.fixture@sandbox.invalid");
});

// ════════════════════════════ FINAL PRE-PR: one entry point, scoped credentials, exact target ════════════

test("(1) seedSampleCompany.js is the SINGLE Sample Company operator entry point for every phase", () => {
  // All five phases are reachable from this one script, each independently explicit.
  for (const mode of ["plan", "apply", "activate-logins", "activate-credentials", "verify"]) {
    const args = { ...BASE };
    if (mode !== "plan") args.mode = mode;
    if (mode === "apply" || mode === "activate-logins" || mode === "activate-credentials") args.apply = "true";
    if (mode === "activate-logins" || mode === "activate-credentials") args.firebaseProjectId = "eos-platform-sandbox";
    if (mode === "activate-credentials") args.credentialFile = "/tmp/sample-credentials.local.json";
    const options = assertSampleCompanyInvocation(args, NONPROD);
    assert.equal(options.mode, mode);
  }
  // And the orchestrator itself dispatches every one of them -- there is no phase the operator must leave
  // this script to run.
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  assert.match(source, /options\.mode === "activate-credentials"/);
  assert.match(source, /options\.mode === "activate-logins"/);
  assert.match(source, /options\.mode === "verify"/);
  // The documented operator workflow is five invocations of THIS script and nothing else.
  assert.match(source, /THIS IS THE ONE OPERATOR ENTRY POINT/);
  const workflow = source.slice(source.indexOf("THIS IS THE ONE OPERATOR ENTRY POINT"), source.indexOf("`--rotate` is REFUSED"));
  for (const step of ["--mode plan", "--mode apply --apply", "--mode activate-logins --apply", "--mode activate-credentials --apply", "--mode verify"]) {
    assert.ok(workflow.includes(step), `the documented workflow omits ${step}`);
  }
  assert.ok(!/activateSandboxPersonas\.js --projectId/.test(workflow),
    "the documented workflow still sends the operator to a second command");
});

test("(2) credential activation DELEGATES to the existing implementation and does not copy it", () => {
  const phase = readFileSync(resolve(FUNCTIONS_DIR, "scripts/sampleCompany/credentialActivation.js"), "utf8");
  // It takes the activator as a parameter and calls it; it contains no generation of its own.
  assert.match(phase, /await activator\(\{/);
  assert.ok(!/randomBytes|updateUser\(|Sbx!/.test(phase), "the credential phase generates or sets a password itself");
  // The orchestrator wires in the EXACT function the standalone CLI uses.
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  assert.match(source, /const \{ activateMissingSandboxPasswords \} = require\("\.\/activateSandboxPersonas\.js"\)/);
  const tool = readFileSync(resolve(FUNCTIONS_DIR, "scripts/activateSandboxPersonas.js"), "utf8");
  assert.match(tool, /result = await activateMissingSandboxPasswords\(\{ auth, personas, outPath \}\)/,
    "the standalone CLI no longer calls the shared implementation");
  // Exactly ONE password-generating site in the whole Sample Company surface.
  const generators = ["scripts/activateSandboxPersonas.js", "scripts/sampleCompany/credentialActivation.js",
    "scripts/sampleCompany/sandboxAuthDirectory.js", "scripts/sampleCompany/loginActivation.js", "scripts/seedSampleCompany.js"]
    .filter((f) => /randomBytes/.test(readFileSync(resolve(FUNCTIONS_DIR, f), "utf8")));
  assert.deepEqual(generators, ["scripts/activateSandboxPersonas.js"]);
});

test("(3) Sample Company credential activation is confined to manifest personas", () => {
  const { sampleCompanyCredentialAllowlist, supersededExclusions } = require("../scripts/sampleCompany/credentialActivation.js");
  const allowlist = sampleCompanyCredentialAllowlist(MANIFEST);
  // OWNER RULING 2026-09-25: ONE CANONICAL SANDBOX LOGIN PER CANONICAL JOB ROLE. Activation
  // eligibility is derived from config/sandboxRoleIdentityRegistry.json -- the single authority --
  // not from a list kept in this manifest. Canonical role login -> eligible; noncanonical fixture
  // login -> excluded and reported; unknown login -> refused.
  const registry = require("../../config/sandboxRoleIdentityRegistry.json");
  const canonicalEmails = new Set(registry.roles.map((r) => r.authEmail));
  const noncanonicalEmails = new Set(registry.noncanonical.map((n) => n.email));
  const expected = MANIFEST.principals
    .filter((p) => !p.existingAdministrator && !p.existingOwnerPrincipal)
    .map((p) => p.loginPrincipal.credentialEmail)
    .filter((email) => canonicalEmails.has(email))
    .sort();
  assert.deepEqual(allowlist, expected);
  assert.equal(allowlist.length, 13, "the canonical role logins this manifest declares");
  for (const email of allowlist) {
    assert.ok(canonicalEmails.has(email), `${email} is allowlisted but is not a canonical role identity`);
  }

  // What was dropped is REPORTED, never silent: an excluded identity says why and names the canonical
  // login that replaced it, so a run surfaces any divergence between manifest and registry.
  const excluded = supersededExclusions(MANIFEST);
  assert.deepEqual(excluded.map((e) => e.email).sort(), [
    "gray.fixture@sandbox.invalid",
    "indigo.fixture@sandbox.invalid",
    "oakley.fixture@sandbox.invalid",
  ]);
  for (const e of excluded) {
    assert.equal(e.classification, "NONCANONICAL_FIXTURE_IDENTITY");
    assert.ok(e.supersededBy, `${e.email} must name the canonical login that replaced it`);
    assert.ok(noncanonicalEmails.has(e.email));
    assert.ok(!allowlist.includes(e.email), `${e.email} is noncanonical and must never be activatable`);
  }
  // NEITHER REUSED PRINCIPAL IS IN IT, and neither can be: both credentialEmails are null by construction.
  const administrator = MANIFEST.principals.find((p) => p.existingAdministrator);
  assert.equal(administrator.loginPrincipal.credentialEmail, null);
  const owner = MANIFEST.principals.find((p) => p.existingOwnerPrincipal);
  assert.equal(owner.loginPrincipal.credentialEmail, null);
  assert.ok(!allowlist.includes(MANIFEST.employees.find((e) => e.key === "owner-executive").workEmail),
    "the Owner's own work email must not become a credential to create: its credential is real and pre-existing");
  assert.ok(!allowlist.includes(null) && !allowlist.includes(undefined));
  for (const email of allowlist) assert.ok(email.endsWith("@sandbox.invalid"));
  // Every no-access Employee is absent.
  for (const key of Object.keys(MANIFEST.expectedAccess.noAccessPersonas)) {
    const employee = MANIFEST.employees.find((e) => e.key === key);
    assert.ok(!allowlist.includes(employee.workEmail), `${key} must never be credential-activated`);
  }
});

test("(4)(5) the allowlist narrows the existing implementation and never rotates a working credential", async () => {
  const { activateMissingSandboxPasswords } = require("../scripts/activateSandboxPersonas.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const outPath = join(mkdtempSync(join(tmpdir(), "sample-creds-")), "sandbox-credentials.local.json");

  const updated = [];
  const auth = { async updateUser(uid) { updated.push(uid); } };
  const personas = [
    { uid: "u-mine-passwordless", email: "harper.fixture@sandbox.invalid", passwordHash: null },
    { uid: "u-mine-working", email: "bailey.fixture@sandbox.invalid", passwordHash: "existing" },
    { uid: "u-someone-else", email: "unrelated.persona@sandbox.invalid", passwordHash: null },
  ];
  const result = await activateMissingSandboxPasswords({
    auth, personas, outPath,
    emailAllowlist: ["harper.fixture@sandbox.invalid", "bailey.fixture@sandbox.invalid"],
  });
  // (4) THE UNRELATED PASSWORDLESS ACCOUNT IS UNTOUCHED, even though the un-narrowed call would have taken it.
  assert.deepEqual(updated, ["u-mine-passwordless"]);
  assert.deepEqual(result.activated, ["harper.fixture@sandbox.invalid"]);
  // (5) the working Sample Company credential is left exactly alone.
  assert.deepEqual(result.unchanged, ["bailey.fixture@sandbox.invalid"]);
  assert.equal(result.scope, "ALLOWLIST");
  assert.equal(result.considered, 2);
  // The file is merged, and carries only what was activated here.
  const written = JSON.parse(readFileSync(outPath, "utf8"));
  assert.deepEqual(Object.keys(written), ["harper.fixture@sandbox.invalid"]);
  assert.ok(!Object.prototype.hasOwnProperty.call(written, "unrelated.persona@sandbox.invalid"));
  // NO PASSWORD IS EVER RETURNED.
  assert.ok(!JSON.stringify(result).includes(written["harper.fixture@sandbox.invalid"]));
});

test("a MISSING allowlisted account is reported, never silently skipped", async () => {
  const { activateMissingSandboxPasswords } = require("../scripts/activateSandboxPersonas.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const outPath = join(mkdtempSync(join(tmpdir(), "sample-creds-")), "sandbox-credentials.local.json");
  const result = await activateMissingSandboxPasswords({
    auth: { async updateUser() { throw new Error("must not be called"); } },
    personas: [{ uid: "u1", email: "bailey.fixture@sandbox.invalid", passwordHash: "existing" }],
    outPath,
    emailAllowlist: ["bailey.fixture@sandbox.invalid", "nobody.here@sandbox.invalid"],
  });
  assert.deepEqual(result.missing, ["nobody.here@sandbox.invalid"]);
  assert.deepEqual(result.activated, []);
});

test("the un-narrowed call behaves exactly as the standalone CLI always has", async () => {
  const { activateMissingSandboxPasswords } = require("../scripts/activateSandboxPersonas.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const outPath = join(mkdtempSync(join(tmpdir(), "sample-creds-")), "sandbox-credentials.local.json");
  const updated = [];
  const result = await activateMissingSandboxPasswords({
    auth: { async updateUser(uid) { updated.push(uid); } },
    personas: [
      { uid: "a", email: "a@sandbox.invalid", passwordHash: null },
      { uid: "b", email: "b@sandbox.invalid", passwordHash: "existing" },
    ],
    outPath,
  });
  assert.equal(result.scope, "EVERY_SANDBOX_PERSONA");
  assert.deepEqual(updated, ["a"], "the default path must still consider every sandbox persona");
  assert.deepEqual(result.missing, [], "there is no allowlist, so nothing can be missing from one");
});

test("(6) --rotate cannot be reached through the Sample Company", () => {
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, rotate: "true" }, NONPROD), /--rotate is not a Sample Company operation/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "activate-credentials", apply: "true", firebaseProjectId: "eos-platform-sandbox", credentialFile: "/tmp/x-credentials.local.json", rotate: "true" }, NONPROD),
    /--rotate is not a Sample Company operation/);
  for (const file of ["scripts/seedSampleCompany.js", "scripts/sampleCompany/credentialActivation.js"]) {
    const source = readFileSync(resolve(FUNCTIONS_DIR, file), "utf8");
    assert.ok(!/rotate:\s*true|"--rotate"\s*\]/.test(source), `${file} can pass --rotate through`);
  }
});

test("(7)(8) the Firebase project must be EXACTLY the one platform-sandbox registers", async () => {
  const { assertSandboxAuthTarget, expectedSampleCompanyProjectId, REQUIRED_ENVIRONMENT } =
    require("../scripts/sampleCompany/sandboxAuthDirectory.js");
  // (7) resolved from the registry, not hard-coded a second time.
  const registry = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "..", "config", "environments.json"), "utf8"));
  const sandbox = registry.environments.find((e) => e.id === REQUIRED_ENVIRONMENT);
  assert.equal(expectedSampleCompanyProjectId(), sandbox.firebase.projectId);
  assert.equal(assertSandboxAuthTarget(sandbox.firebase.projectId), REQUIRED_ENVIRONMENT);

  // (8) ANOTHER LEGITIMATE NON-PRODUCTION PROJECT IS STILL REFUSED. The live registry happens to declare no
  // second sandbox project today, so the rule is proved against a registry that does -- otherwise this test
  // would pass for the wrong reason the moment one is added.
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const withExtra = structuredClone(registry);
  withExtra.environments.push({
    id: "platform-staging", role: "sandbox", deployment: "platform", status: "live",
    firebase: { projectId: "eos-platform-staging" },
  });
  const registryPath = join(mkdtempSync(join(tmpdir(), "sample-registry-")), "environments.json");
  writeFileSync(registryPath, JSON.stringify(withExtra, null, 2));
  // It is registered, it is not production, it is not Certification -- and it is refused anyway, because a
  // split target would key every Principal to a uid nobody in platform-sandbox can present.
  assert.throws(() => assertSandboxAuthTarget("eos-platform-staging", registryPath),
    /the Sample Company lives in 'platform-sandbox', whose registered Firebase project is 'eos-platform-sandbox'/);
  assert.equal(assertSandboxAuthTarget("eos-platform-sandbox", registryPath), REQUIRED_ENVIRONMENT);
  // The three independent refusals survive.
  assert.throws(() => assertSandboxAuthTarget("taylor-parts", registryPath), /customer production project/);
  assert.throws(() => assertSandboxAuthTarget("eos-platform-certification", registryPath), /Certification world, which is frozen/);
  assert.throws(() => assertSandboxAuthTarget("taylor-parts-unregistered", registryPath), /not a Firebase project declared/);
});

test("(9) the link transition is ONE transaction, so a failure cannot strand an Employee", () => {
  const activation = readFileSync(resolve(FUNCTIONS_DIR, "scripts/sampleCompany/loginActivation.js"), "utf8");
  const transition = activation.slice(activation.indexOf("async function transitionEmployeeLink"));
  // One client, BEGIN/COMMIT, ROLLBACK on any failure -- and the current link re-read INSIDE the transaction.
  assert.match(transition, /const client = await pool\.connect\(\);/);
  assert.match(transition, /await client\.query\("BEGIN"\);/);
  assert.match(transition, /await client\.query\("COMMIT"\);/);
  assert.match(transition, /await client\.query\("ROLLBACK"\)/);
  assert.match(transition, /readActiveLinkForEmployee\(client,/);
  assert.match(transition, /revokeLinkForEmployee\(client,/);
  assert.match(transition, /establishLink\(client,/);
  assert.match(transition, /client\.release\(\)/);
  // Still the governed repository, never hand SQL.
  assert.ok(!/employee_principal_links/.test(stripComments(activation)),
    "the transition writes the link table by hand instead of through the repository");
});

test("(13) the Sample Company Auth code still has zero Firestore imports or uses", () => {
  for (const file of ["scripts/sampleCompany/sandboxAuthDirectory.js", "scripts/sampleCompany/credentialActivation.js",
    "scripts/sampleCompany/loginActivation.js"]) {
    const source = stripComments(readFileSync(resolve(FUNCTIONS_DIR, file), "utf8"));
    assert.ok(!/firebase-admin\/firestore|getFirestore|\.collection\(|FieldValue/.test(source),
      `${file} reaches Firestore; Firebase is transitional identity only and eos_workforce.employees is the Employee authority`);
  }
  // The delegated activation implementation is Auth-only too.
  const tool = stripComments(readFileSync(resolve(FUNCTIONS_DIR, "scripts/activateSandboxPersonas.js"), "utf8"));
  assert.ok(!/firebase-admin\/firestore|getFirestore|\.collection\(/.test(tool));
});

// ════════════════════════════ the OPERATOR credential seam for Auth administration ════════════════════════════
//
// Nothing here contacts Google. The adapter is driven through its `sdk` test seam with an in-memory double, and
// the token is a fixture string that is not shaped like any real credential.

const OPERATOR_TOKEN = "operator-token-fixture-0123456789abcdef";
const SANDBOX_PROJECT = "eos-platform-sandbox";

function fakeFirebaseSdk({ listUsers, users = [] } = {}) {
  const calls = { initializeApp: [], applicationDefault: 0, createUser: [] };
  let apps = [];
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const auth = {
    listUsers: listUsers ?? (async () => ({ users })),
    async getUserByEmail(email) {
      const user = byEmail.get(email);
      if (!user) throw Object.assign(new Error("no user"), { code: "auth/user-not-found" });
      return user;
    },
    async createUser(input) {
      calls.createUser.push(input);
      return { uid: `uid-${calls.createUser.length}`, email: input.email };
    },
  };
  return {
    calls,
    auth,
    sdk: {
      getApps: () => apps,
      applicationDefault: () => {
        calls.applicationDefault += 1;
        return { getAccessToken: async () => ({ access_token: "adc-fixture", expires_in: 60 }) };
      },
      initializeApp: (options) => {
        calls.initializeApp.push(options);
        const app = { options };
        apps = [app];
        return app;
      },
      getAuth: () => auth,
    },
  };
}

const adapter = () => require("../scripts/sampleCompany/sandboxAuthDirectory.js");

test("(A) plan and business apply construct no Auth adapter and need no Google credential", () => {
  // Both modes pass the fence with no operator token and no ADC in the environment.
  for (const mode of ["plan", "apply"]) {
    const args = { ...BASE, ...(mode === "apply" ? { mode, apply: "true" } : {}) };
    assert.equal(assertSampleCompanyInvocation(args, NONPROD).mode, mode);
  }
  const main = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  const body = main.slice(main.indexOf("async function main()"));
  // The adapter is constructed ONLY for the two credential phases; plan/apply fall through to the pool.
  assert.match(body, /const credentialPhase = options\.mode === "activate-logins" \|\| options\.mode === "activate-credentials";/);
  assert.match(body, /const authDirectory = credentialPhase\s*\?/);
  // And the token is read in exactly one module: the adapter.
  for (const file of ["scripts/seedSampleCompany.js", "scripts/verifySampleCompany.js", "scripts/sampleCompany/loginActivation.js",
    "scripts/sampleCompany/credentialActivation.js"]) {
    const source = stripComments(readFileSync(resolve(FUNCTIONS_DIR, file), "utf8"));
    assert.ok(!/env(\.EOS_FIREBASE_OPERATOR_ACCESS_TOKEN|\[\s*["'`]EOS_FIREBASE_OPERATOR_ACCESS_TOKEN)/.test(source), `${file} reads the operator token itself`);
  }
});

test("(B) an explicit operator token becomes the Admin credential through the one sandbox Auth adapter", async () => {
  const { createFirebaseSandboxAuthDirectory } = adapter();
  const fake = fakeFirebaseSdk();
  const directory = createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env: { EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: OPERATOR_TOKEN }, sdk: fake.sdk });
  assert.equal(directory.credentialSource, "OPERATOR_ACCESS_TOKEN");
  assert.equal(fake.calls.applicationDefault, 0, "a supplied token must not also consult ADC");
  assert.equal(fake.calls.initializeApp.length, 1);
  const { credential, projectId } = fake.calls.initializeApp[0];
  assert.equal(projectId, SANDBOX_PROJECT);
  // The firebase-admin Credential contract: { access_token: string, expires_in: number }.
  const token = await credential.getAccessToken();
  assert.equal(token.access_token, OPERATOR_TOKEN);
  assert.equal(typeof token.expires_in, "number");
  assert.deepEqual(await directory.preflight(), { projectId: SANDBOX_PROJECT, credentialSource: "OPERATOR_ACCESS_TOKEN" });

  // Absent a token, ADC is used exactly as before.
  const adc = fakeFirebaseSdk();
  const adcDirectory = createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env: {}, sdk: adc.sdk });
  assert.equal(adcDirectory.credentialSource, "APPLICATION_DEFAULT");
  assert.equal(adc.calls.applicationDefault, 1);

  // A blank token is refused -- never a silent downgrade to ADC -- and before the SDK is touched.
  const blank = fakeFirebaseSdk();
  assert.throws(() => createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env: { EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: "  " }, sdk: blank.sdk }),
    /OPERATOR_TOKEN_INVALID/);
  assert.equal(blank.calls.initializeApp.length + blank.calls.applicationDefault, 0);

  // No second initialization path: an app somebody else initialized is refused rather than reused.
  assert.throws(() => createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env: { EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: OPERATOR_TOKEN }, sdk: fake.sdk }),
    /AUTH_APP_ALREADY_INITIALIZED/);
});

test("(C) the operator token is never returned, serialized, inspected or echoed in an error", async () => {
  const { inspect } = await import("node:util");
  const { createFirebaseSandboxAuthDirectory, createOperatorAccessTokenCredential, scrubOperatorSecret } = adapter();
  const env = { EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: OPERATOR_TOKEN };
  const credential = createOperatorAccessTokenCredential(OPERATOR_TOKEN);
  assert.ok(!JSON.stringify(credential).includes(OPERATOR_TOKEN));
  assert.ok(!inspect(credential, { depth: 5, showHidden: true }).includes(OPERATOR_TOKEN));

  const fake = fakeFirebaseSdk();
  const directory = createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env, sdk: fake.sdk });
  const { auth, ...reportable } = directory;
  assert.ok(!JSON.stringify(reportable).includes(OPERATOR_TOKEN));
  assert.ok(!inspect(reportable, { depth: 5 }).includes(OPERATOR_TOKEN));

  // A failure whose message somehow carries the token is scrubbed on the way out of preflight...
  const leaky = fakeFirebaseSdk({ listUsers: async () => { throw new Error(`401 for bearer ${OPERATOR_TOKEN}`); } });
  const leakyDirectory = createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env, sdk: leaky.sdk });
  await assert.rejects(() => leakyDirectory.preflight(), (err) => {
    assert.match(err.message, /OPERATOR_CREDENTIAL_UNAVAILABLE/);
    assert.ok(!err.message.includes(OPERATOR_TOKEN), "preflight echoed the token");
    return true;
  });
  // ...and by the CLI entry points, which scrub every message they print.
  assert.equal(scrubOperatorSecret(`x ${OPERATOR_TOKEN} y`, env), "x [EOS_FIREBASE_OPERATOR_ACCESS_TOKEN redacted] y");
  for (const file of ["scripts/seedSampleCompany.js", "scripts/verifySampleCompany.js"]) {
    const source = readFileSync(resolve(FUNCTIONS_DIR, file), "utf8");
    assert.match(source.slice(source.lastIndexOf("if (require.main === module)")), /console\.error\(scrubOperatorSecret\(/,
      `${file} prints an unscrubbed error`);
  }
  // Never accepted on the command line, and the refusal does not echo the value.
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "activate-logins", apply: "true", firebaseProjectId: SANDBOX_PROJECT, operatorAccessToken: OPERATOR_TOKEN }, NONPROD),
    (err) => /only through the EOS_FIREBASE_OPERATOR_ACCESS_TOKEN environment variable/.test(err.message) && !err.message.includes(OPERATOR_TOKEN));
});

test("(D) a credential-layer run with no usable credential refuses at preflight, before any PostgreSQL or Auth write", async () => {
  const { createFirebaseSandboxAuthDirectory } = adapter();
  // Exactly the Render failure: no token, ADC falls through to a metadata server that does not exist.
  const render = fakeFirebaseSdk({ listUsers: async () => { throw new Error("getaddrinfo ENOTFOUND metadata.google.internal"); } });
  const directory = createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env: {}, sdk: render.sdk });
  await assert.rejects(() => directory.preflight(), (err) => {
    assert.equal(err.code, "OPERATOR_CREDENTIAL_UNAVAILABLE");
    assert.match(err.message, /EOS_FIREBASE_OPERATOR_ACCESS_TOKEN/);
    assert.match(err.message, /Nothing was written/);
    assert.match(err.message, /metadata\.google\.internal/);
    return true;
  });
  assert.equal(render.calls.createUser.length, 0);

  // THE ORDER IN THE ENTRY POINTS: preflight before the pool is opened and before either activation runs, and
  // in the verifier before the database is connected.
  const main = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  const body = main.slice(main.indexOf("async function main()"));
  const preflightAt = body.indexOf("await authDirectory.preflight()");
  assert.ok(preflightAt > 0, "the orchestrator does not preflight the credential");
  for (const later of ["activateSampleCompanyCredentials(", "new pg.Pool(", "activateSampleCompanyLogins("]) {
    assert.ok(body.indexOf(later) > preflightAt, `${later} can run before the credential preflight`);
  }
  const verify = readFileSync(resolve(FUNCTIONS_DIR, "scripts/verifySampleCompany.js"), "utf8");
  const verifyMain = verify.slice(verify.indexOf("async function verifySampleCompanyMain"));
  assert.ok(verifyMain.indexOf("await directory.preflight()") > 0);
  assert.ok(verifyMain.indexOf("await directory.preflight()") < verifyMain.indexOf("await client.connect()"));

  // THE FAILED LIVE ATTEMPT WROTE NOTHING. Before the persona loop the phase only READS (tenant, administrator,
  // Roles, assignments); the administrator persona only reads its link; and for the first interactive persona
  // the Auth lookup precedes every write the phase can make.
  const activation = readFileSync(resolve(FUNCTIONS_DIR, "scripts/sampleCompany/loginActivation.js"), "utf8");
  const loop = activation.slice(activation.indexOf("for (const p of manifest.principals)"));
  const lookup = loop.indexOf("await authDirectory.findByEmail(email)");
  assert.ok(lookup > 0);
  for (const write of ["createPasswordless(", "ensureTenantPrincipal(", "transitionEmployeeLink(pool", "assignRole(", "retireFixturePrincipal("]) {
    assert.ok(loop.indexOf(write) > lookup, `${write} precedes the first Auth lookup`);
  }
  const beforeLoop = stripComments(activation.slice(activation.indexOf("async function activateSampleCompanyLogins"), activation.indexOf("for (const p of manifest.principals)")));
  assert.ok(!/transact\(|ensureTenantPrincipal\(|assignRole\(|establishLink\(|revokeLink|\.query\(/.test(beforeLoop), "the phase writes before its persona loop");
});

test("(E) the wrong Firebase project is refused before the SDK or any credential is touched", () => {
  const { createFirebaseSandboxAuthDirectory } = adapter();
  for (const [project, pattern] of [["taylor-parts", /customer production project/], ["eos-platform-certification", /Certification world, which is frozen/],
    ["someone-elses-project", /not a Firebase project declared/]]) {
    const fake = fakeFirebaseSdk();
    assert.throws(() => createFirebaseSandboxAuthDirectory(project, { env: { EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: OPERATOR_TOKEN }, sdk: fake.sdk }), pattern);
    assert.equal(fake.calls.initializeApp.length + fake.calls.applicationDefault, 0, `${project} reached the SDK`);
  }
});

test("(F)(G) an operator token does not widen the sandbox email fence, and accounts are still created PASSWORDLESS", async () => {
  const { createFirebaseSandboxAuthDirectory } = adapter();
  const fake = fakeFirebaseSdk();
  const directory = createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env: { EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: OPERATOR_TOKEN }, sdk: fake.sdk });
  await assert.rejects(() => directory.findByEmail("someone@taylorservice.com"), /EMAIL_REFUSED/);
  await assert.rejects(() => directory.createPasswordless({ email: "someone@taylorservice.com", displayName: "x" }), /EMAIL_REFUSED/);
  assert.equal(fake.calls.createUser.length, 0);

  const created = await directory.createPasswordless({ email: "persona.fixture@sandbox.invalid", displayName: "Persona" });
  assert.equal(created.hasPassword, false);
  assert.deepEqual(Object.keys(fake.calls.createUser[0]).sort(), ["disabled", "displayName", "email", "emailVerified"],
    "createUser was given something other than a passwordless account");
});

test("(H) activate-credentials uses the same token-backed adapter, delegates, and keeps the allowlist", async () => {
  const { createFirebaseSandboxAuthDirectory } = adapter();
  const { activateSampleCompanyCredentials, sampleCompanyCredentialAllowlist } = require("../scripts/sampleCompany/credentialActivation.js");
  const allowlist = sampleCompanyCredentialAllowlist(MANIFEST);
  const users = [
    ...allowlist.map((email, i) => ({ uid: `u${i}`, email })),
    { uid: "outsider", email: "not-this-company@sandbox.invalid" },
  ];
  const fake = fakeFirebaseSdk({ users });
  const directory = createFirebaseSandboxAuthDirectory(SANDBOX_PROJECT, { env: { EOS_FIREBASE_OPERATOR_ACCESS_TOKEN: OPERATOR_TOKEN }, sdk: fake.sdk });
  let delegated = null;
  const result = await activateSampleCompanyCredentials(
    { apply: true, credentialFile: "/tmp/never-written-credentials.local.json" }, MANIFEST, directory,
    async (input) => { delegated = input; return { activated: [...input.emailAllowlist], unchanged: [], missing: [] }; },
  );
  assert.equal(delegated.auth, fake.auth, "the delegated activator must receive the adapter's own Auth handle");
  assert.deepEqual(delegated.emailAllowlist, allowlist);
  assert.equal(result.outOfScopeSandboxAccounts, 1);
  assert.ok(!JSON.stringify(result).includes(OPERATOR_TOKEN));
  const main = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  assert.match(main, /const \{ activateMissingSandboxPasswords \} = require\("\.\/activateSandboxPersonas\.js"\);/);
});

test("(I)(J) no Firestore is introduced, and the runtime token verifier still holds no Admin credential", () => {
  for (const file of ["scripts/sampleCompany/sandboxAuthDirectory.js", "scripts/seedSampleCompany.js", "scripts/verifySampleCompany.js"]) {
    const source = stripComments(readFileSync(resolve(FUNCTIONS_DIR, file), "utf8"));
    assert.ok(!/firebase-admin\/firestore|getFirestore|\.collection\(/.test(source), `${file} reaches Firestore`);
  }
  // The deployed API verifies ID tokens with a credential-less default app and knows nothing of the operator seam.
  const server = readFileSync(resolve(FUNCTIONS_DIR, "src/eosApi/server.ts"), "utf8");
  assert.match(server, /admin\.initializeApp\(\)/);
  assert.ok(!/EOS_FIREBASE_OPERATOR_ACCESS_TOKEN|applicationDefault|credential\s*:/.test(stripComments(server)));
  // And the Render blueprint declares no Google credential and no secret to paste.
  const blueprint = readFileSync(resolve(FUNCTIONS_DIR, "..", "render.yaml"), "utf8");
  const keys = [...blueprint.matchAll(/^\s*- key:\s*(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ["DATABASE_URL", "EOS_ALLOWED_ORIGINS", "EOS_ENVIRONMENT", "GOOGLE_CLOUD_PROJECT"]);
  assert.ok(!/sync:\s*false/.test(blueprint.replace(/#[^\n]*/g, "")));
  assert.ok(!/^\s*- key:\s*EOS_FIREBASE_OPERATOR_ACCESS_TOKEN/m.test(blueprint), "the operator token must never be declared in the runtime config");
});
