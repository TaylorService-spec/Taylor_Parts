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
const { MANIFEST, validateManifest, sampleCompanyCapabilityKeys, assertSampleCompanyInvocation,
  EMPLOYMENT_STATUS_VALUES, JOB_ROLE_VOCABULARY, PROFILE_COLUMNS } = seed;
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
  assert.equal(lookups.employees.size, 17);
  assert.equal(lookups.principalsByEmployee.size, 15);
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
  for (const r of MANIFEST.jobRoles) {
    assert.notEqual(r.key.toUpperCase(), "SALES");
    assert.notEqual(String(r.label).trim().toUpperCase(), "SALES");
  }
  assert.ok(MANIFEST.jobRoles.some((r) => r.key === "RETAIL_SALES"));
  assert.ok(MANIFEST.jobRoles.some((r) => r.key === "NATIONAL_ACCOUNTS_SALES"));
  refusal((m) => m.jobRoles.push({ key: "SALES", label: "Sales" }), /generic Job Role named SALES is forbidden/);
  refusal((m) => m.jobRoles.push({ key: "RETAIL_SALES", label: "Sales" }), /generic Job Role named SALES is forbidden/);
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

test("the Job Role vocabulary is exactly the governed twelve", () => {
  assert.deepEqual([...MANIFEST.jobRoles.map((r) => r.key)].sort(), [...JOB_ROLE_VOCABULARY].sort());
  refusal((m) => { m.jobRoles.push({ key: "INVENTED_ROLE", label: "Invented" }); }, /outside the governed vocabulary/);
});

test("Job Role is never written to a PostgreSQL authority column", () => {
  const source = readFileSync(resolve(FUNCTIONS_DIR, "scripts/seedSampleCompany.js"), "utf8");
  // The profile column map is the ONLY place this script names Employee columns; job role is absent from it.
  assert.equal(PROFILE_COLUMNS.filter(([, col]) => /job_role/.test(col)).length, 0);
  assert.ok(!/job_role/.test(source), "seedSampleCompany.js must never name a job_role column");
  // And nothing in the manifest claims a Job Role authority.
  assert.match(MANIFEST.rulings.jobRole, /NOT YET IMPLEMENTED in PostgreSQL/);
  assert.ok(MANIFEST.blockedRelationships.some((b) => b.code === "JOB_ROLE_POSTGRES_AUTHORITY_ABSENT"));
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
  assert.equal(MANIFEST.principals.filter((p) => p.existingAdministrator).length, 1);
  refusal((m) => { m.principals[1].existingAdministrator = true; }, /exactly one existing administrator Principal is reused/);
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
  assert.ok(MANIFEST.blockedRelationships.some((b) => b.code === "SANDBOX_PERSONA_PROVISIONING_GAP"),
    "the credential half of interactive login is a declared gap, not a claim");
});

test("the capability key set is derived from the Role catalog, never hand-typed", () => {
  const keys = sampleCompanyCapabilityKeys();
  const union = new Set(MANIFEST.principals.flatMap((p) => p.securityRoles).flatMap((r) => ROLE_CATALOG[r].permissions ?? []));
  assert.deepEqual([...keys].sort(), [...union].sort());
  assert.ok(keys.includes("admin.employeeProfile.write"), "the reporting-relationship command's own capability must be reconciled");
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
    ...MANIFEST.principals.filter((p) => !p.existingAdministrator).map((p) => `principal:${p.externalSubject}`),
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
    "FINANCIAL_SAMPLE_COVERAGE", "REPORTING_SAMPLE_COVERAGE", "SANDBOX_PERSONA_PROVISIONING_GAP"]) {
    assert.ok(codes.has(code), `${code} must be declared`);
  }
  refusal((m) => { m.service.status = "BLOCKED"; m.service.blockedBy = "A_CODE_NOBODY_DECLARED"; },
    /is BLOCKED by A_CODE_NOBODY_DECLARED, which is not declared/);
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
};

test("plan is the default and writes nothing", () => {
  const options = assertSampleCompanyInvocation({ ...BASE }, NONPROD);
  assert.equal(options.mode, "plan");
  assert.equal(options.apply, false);
});

test("apply requires ALL FIVE facts together", () => {
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply" }, NONPROD), /--mode apply additionally requires the explicit --apply/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, apply: "true" }, NONPROD), /--apply was given without --mode apply/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true" }, { ...NONPROD, EOS_ENVIRONMENT: "production" }), /EOS_ENVIRONMENT must read exactly 'nonprod'/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true", tenantKey: "some-other-tenant" }, NONPROD), /--tenantKey taylor-nonprod is required/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true", performedBy: undefined }, NONPROD), /--performedBy <operator> is required/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true", existingAdminPrincipalId: undefined }, NONPROD), /--existingAdminPrincipalId is required/);
  const ok = assertSampleCompanyInvocation({ ...BASE, mode: "apply", apply: "true" }, NONPROD);
  assert.equal(ok.apply, true);
});

test("production and the Certification world are refused, and platform-sandbox is required positively", () => {
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, environment: "taylor-parts-production" }, NONPROD), /production/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, environment: "platform-certification" }, NONPROD), /Certification world, which is frozen/);
  // platform-integration is neither production nor Certification, and is STILL refused: not-production is
  // not the same as the one environment this sample company is for.
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, environment: "platform-integration" }, NONPROD), /exists only in 'platform-sandbox'/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, environment: undefined }, NONPROD), /--environment is required/);
  assert.throws(() => assertSampleCompanyInvocation({ ...BASE, mode: "destroy" }, NONPROD), /--mode must be one of plan, apply, verify/);
});

test("the Certification world would pass a role-only fence, which is why it is refused by NAME", () => {
  const registry = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "..", "config", "environments.json"), "utf8"));
  const certification = registry.environments.find((e) => e.id === "platform-certification");
  assert.equal(certification.role, "sandbox", "if this ever becomes 'production' the by-name refusal is still required");
});
