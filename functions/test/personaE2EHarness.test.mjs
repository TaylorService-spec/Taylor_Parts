// PERSONA E2E HARNESS -- the acceptance-scenario layer and the authority-plan preflight.
//
// NO DATABASE, NO FIREBASE, NO EMULATOR, NO NETWORK. Every governed vocabulary this suite asserts
// against is read from the COMPILED module that OWNS it, never from a second copy typed here -- the
// point being that a vocabulary change breaks this suite rather than silently diverging from it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const harness = require("../scripts/sampleCompany/personaE2EHarness.js");
const dimensions = require("../scripts/sampleCompany/personaAuthorityDimensions.js");
const MANIFEST = require("../scripts/fixtures/personaE2EScenarios.v1.json");
const PERSONA_MANIFEST = require("../scripts/fixtures/personaAuthorityDimensions.v1.json");
const SAMPLE_COMPANY = require("../scripts/fixtures/sampleCompany.v2.json");

const compiledContextual = require("../lib/eosOps/contextualAuthorization.js");
const compiledWorkEligibility = require("../lib/eosWorkforce/workEligibilityVocabulary.js");
const compiledScope = require("../lib/eosWorkforce/operationalScopeVocabulary.js");
const compiledWorkOrderAssignment = require("../lib/eosOps/workOrderAssignmentAuthority.js");
const compiledReorderAssignment = require("../lib/eosOps/reorderAssignmentAuthority.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");

const clone = (v) => JSON.parse(JSON.stringify(v));
const refusal = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
};

// ════════════════════════════ the manifest, as committed ════════════════════════════

test("the committed scenario manifest validates against the persona catalog it layers onto", () => {
  const summary = harness.validateE2EManifest();
  // SEVENTEEN ROWS FOR THE OWNER'S SIXTEEN PERSONAS. The seventeenth is "Purchasing", kept as an explicit
  // MERGED disposition into parts-manager, because the Owner's own population writes that persona as
  // "Parts Manager/Purchasing" -- the merge is recorded rather than silently absorbed.
  assert.equal(summary.personas, 17, "the sixteen canonical personas the Owner named, plus the Purchasing merge, each dispositioned once");
  assert.equal(summary.provisionable + summary.merged + summary.blocked, 17);
  assert.ok(summary.readyScenarios > 0, "a harness in which nothing is runnable is a design, not a harness");
});

test("every canonical persona the Owner named is present, exactly once", () => {
  const requested = MANIFEST.canonicalPersonas.map((r) => r.requestedRole);
  assert.equal(new Set(requested).size, requested.length, "no requested role is dispositioned twice");
  // THE OWNER'S SIXTEEN. Owner/Executive and Administrator are SEPARATE entries by ruling; the two
  // technicians are SEPARATE entries because the whole point of the pair is that they differ in one fact;
  // Service Manager, Finance/Accounting, Reporting and Restricted were all missing before.
  const REQUIRED = [
    "Owner / Executive", "Administrator", "General Manager", "Service Manager", "Dispatcher",
    "Service Technician (assigned)", "Service Technician (unassigned)",
    "Parts Associate", "Parts Manager", "Warehouse Associate", "Warehouse Manager",
    "Retail Sales", "National Accounts Sales", "Finance / Accounting", "Reporting / Read-Only",
    "Restricted (negative control)",
  ];
  assert.equal(REQUIRED.length, 16);
  for (const role of REQUIRED) assert.ok(requested.includes(role), `${role} is not dispositioned`);
  // "Purchasing" stays dispositioned as the merge the Owner made into Parts Manager.
  assert.ok(requested.includes("Purchasing"));
  assert.equal(requested.length, 17);
  // AND NO MERGED OWNER/ADMIN ROW MAY SURVIVE, in either direction.
  const administrator = MANIFEST.canonicalPersonas.find((r) => r.requestedRole === "Administrator");
  assert.equal(administrator.disposition, "PROVISIONABLE");
  assert.equal(administrator.persona, "administrator");
  assert.notEqual(administrator.mergedInto, "owner-executive");
  const owner = MANIFEST.canonicalPersonas.find((r) => r.requestedRole === "Owner / Executive");
  assert.deepEqual(owner.securityRoles, ["owner"]);
  assert.deepEqual(administrator.securityRoles, ["admin"]);
  assert.notEqual(owner.persona, administrator.persona);
  assert.notEqual(owner.employee, administrator.employee);
});

test("every provisionable persona names an Employee the Sample Company declares and a Principal it can log in as", () => {
  const employees = new Map(SAMPLE_COMPANY.employees.map((e) => [e.key, e]));
  const loginKeys = new Set(SAMPLE_COMPANY.principals.map((p) => p.employee));
  for (const row of MANIFEST.canonicalPersonas.filter((r) => r.disposition === "PROVISIONABLE")) {
    const employee = employees.get(row.persona);
    assert.ok(employee, `${row.persona} is not a Sample Company Employee`);
    assert.equal(row.employee, employee.id, `${row.persona}: the manifest and the Sample Company disagree about the Employee id`);
    assert.ok(loginKeys.has(row.persona), `${row.persona} has no Principal and cannot be a login persona`);
    const principal = SAMPLE_COMPANY.principals.find((p) => p.employee === row.persona);
    assert.deepEqual([...row.securityRoles].sort(), [...principal.securityRoles].sort(),
      `${row.persona}: a persona and its Principal can never disagree about Security Roles`);
  }
});

test("a merge states its evidence and what would separate the two again", () => {
  const merges = MANIFEST.canonicalPersonas.filter((r) => r.disposition === "MERGED");
  assert.ok(merges.length >= 1);
  for (const row of merges) {
    assert.ok(PERSONA_MANIFEST.personas[row.mergedInto], `${row.requestedRole} merges into an undeclared persona`);
    assert.ok(row.mergeEvidence.length > 80, `${row.requestedRole}: "they are the same" is a claim, and a claim needs measured evidence`);
    assert.ok(row.whatWouldSeparateThem.length > 40, `${row.requestedRole}: a merge that cannot say what would undo it is an assumption`);
  }
});

// ════════════════════════════ the vocabularies, from the compiled owners ════════════════════════════

test("the scenario phases and readiness vocabularies are closed, and BLOCKED_PENDING_C5 is its own value", () => {
  assert.deepEqual([...harness.E2E_PHASES],
    ["LOGIN", "LANDING", "NAVIGATION", "RECORD_VISIBILITY", "ALLOWED_ACTION", "DENIED_ACTION"]);
  assert.ok(harness.E2E_READINESS.includes("BLOCKED_PENDING_C5"));
  assert.ok(harness.PROCESS_AVAILABILITY.includes("BLOCKED_PENDING_C5"),
    "Commercial's C5 block is never merged into a plain BLOCKED, because they are removed by different work");
  for (const phase of harness.E2E_PHASES) {
    assert.ok(MANIFEST.scenarios.some((s) => s.phase === phase), `no scenario covers ${phase}`);
  }
});

test("every Work Eligibility code the fixtures name is in the COMPILED governed vocabulary", () => {
  const governed = new Set(compiledWorkEligibility.WORK_ELIGIBILITY_CODES);
  assert.deepEqual(governed, compiledContextual.GOVERNED_QUALIFICATION_CODES,
    "the writer's vocabulary and the evaluator's mirror of it must not drift");
  for (const row of PERSONA_MANIFEST.workEligibility) {
    assert.ok(governed.has(row.qualificationCode), `${row.qualificationCode} is not a governed qualification`);
  }
  assert.ok(governed.has("PARTS_OPERATIONS"), "Q6: PARTS_OPERATIONS is expressed through the canonical model");
  for (const legacy of dimensions.LEGACY_OPERATIONAL_ROLE_VALUES) {
    assert.ok(!governed.has(legacy), `${legacy} is a legacy operationalRoles value and must never be a qualification code`);
  }
});

test("no legacy operationalRoles value appears anywhere in the scenario manifest", () => {
  const serialized = JSON.stringify(MANIFEST);
  for (const legacy of dimensions.LEGACY_OPERATIONAL_ROLE_VALUES) {
    // The prohibited value may be NAMED only where the manifest is explaining that it was refused.
    const occurrences = serialized.split(`"${legacy}"`).length - 1;
    assert.equal(occurrences, 0, `${legacy} appears as a value in the scenario manifest`);
  }
});

test("the Operational Scope types the fixtures name are the compiled ones", () => {
  const governed = new Set(compiledScope.OPERATIONAL_SCOPE_TYPES);
  for (const row of PERSONA_MANIFEST.operationalScopes) {
    assert.ok(governed.has(row.scopeType), `${row.scopeType} is not a governed scope type`);
  }
});

// ════════════════════════════ Q5: the assignment fixture, against the real writers ════════════════════════════

test("the assigned/unassigned fixture names the real capability and qualification each governed writer requires", () => {
  const byKind = new Map(MANIFEST.assignedUnassignedFixture.candidatePaths.map((p) => [p.recordKind, p]));
  const workOrder = byKind.get("workOrder");
  const reorder = byKind.get("reorderRequest");
  assert.ok(workOrder && reorder, "both governed assignment paths are considered, not just the convenient one");

  assert.equal(workOrder.requiredCapability, compiledWorkOrderAssignment.WORK_ORDER_ASSIGN);
  assert.equal(workOrder.assigneeQualification, compiledWorkOrderAssignment.WORK_ORDER_ASSIGNMENT_QUALIFICATION);
  assert.equal(reorder.requiredCapability, compiledReorderAssignment.REORDER_REQUEST_ASSIGN);
  assert.equal(reorder.assigneeQualification, compiledReorderAssignment.REORDER_ASSIGNMENT_QUALIFICATION);
});

test("THE CONFLICT, ASSERTED: the Reorder writer's qualification is not one any Service Technician persona holds", () => {
  const required = compiledReorderAssignment.REORDER_ASSIGNMENT_QUALIFICATION;
  const technicianPersonas = Object.entries(PERSONA_MANIFEST.personas)
    .filter(([, p]) => p.jobRole === "SERVICE_TECHNICIAN");
  assert.ok(technicianPersonas.length >= 2);
  for (const [key, persona] of technicianPersonas) {
    assert.ok(!persona.workEligibility.includes(required),
      `${key} holds ${required}; a Service Technician given warehouse eligibility to satisfy a test writer is a fabricated workforce fact`);
  }
  // The REORDER path is the one that is still unseeded, and it still names its blocker. The fixture as a
  // whole is PARTIALLY_SEEDED because the WORK ORDER path is not: see the next test.
  assert.equal(MANIFEST.assignedUnassignedFixture.status, "PARTIALLY_SEEDED");
  assert.ok(MANIFEST.assignedUnassignedFixture.candidatePaths
    .filter((p) => p.status !== "SEEDED")
    .every((p) => typeof p.blockedBy === "string" && p.blockedBy.length > 0),
  "an unseeded path names its exact blocker rather than going quiet");
});

test("the assigned/unassigned separation is LIVE on the Work Order, and the governed WRITER is still not", () => {
  // THE STALE CLAIM THIS REPLACES. The fixture read NOT_SEEDED and both paths read BLOCKED, so the
  // assigned-vs-unassigned proof the Owner asked for looked unrunnable. It was unrunnable on the REORDER
  // path only. eos_ops.work_order_assignments already holds one open row for service-technician-a and none
  // for -b (measured 2026-09-24), so the SEPARATION is provable today against a real record.
  const workOrder = MANIFEST.assignedUnassignedFixture.candidatePaths.find((p) => p.recordKind === "workOrder");
  assert.equal(workOrder.status, "SEEDED");
  assert.equal(workOrder.assigneeQualificationSatisfied, true, "SERVICE_TECHNICIAN eligibility is live for both technicians");
  assert.equal(workOrder.recordStatusSatisfied, true);
  assert.equal(workOrder.blockedBy, undefined, "a seeded path has no blocker to name");
  // AND THE DISTINCTION THAT MUST NOT BE LOST. The row exists; the governed COMMAND is still uninvokable,
  // because workOrder.lifecycle.dispatch is declared by no Role in the compiled catalog. Nothing here
  // grants it, and a later change that quietly did must fail this assertion first.
  assert.match(workOrder.stillBlockedForWriting, /^WORK_ORDER_LIFECYCLE_DISPATCH_DECLARED_BY_NO_ROLE\b/);
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const declarers = Object.values(roles)
    .filter((r) => (r.permissions ?? []).includes(compiledWorkOrderAssignment.WORK_ORDER_ASSIGN)).map((r) => r.id);
  assert.deepEqual(declarers, [], "workOrder.lifecycle.dispatch is declared by NO Role; the governed writer stays unreachable");
  const statuses = new Set(compiledWorkOrderAssignment.ASSIGNABLE_WORK_ORDER_STATUSES);
  assert.ok(statuses.has("SCHEDULED"), "the nonprod record the fixture names is SCHEDULED, which must be an assignable status");
  // The two technician personas differ in EXACTLY one fact, which is what makes the pair a proof.
  const a = PERSONA_MANIFEST.personas["service-technician-a"];
  const b = PERSONA_MANIFEST.personas["service-technician-b"];
  assert.deepEqual(a.securityRoles, b.securityRoles);
  assert.deepEqual(a.jobRole, b.jobRole);
  assert.deepEqual(a.workEligibility, b.workEligibility);
  assert.deepEqual(a.operationalScopes, b.operationalScopes);
  const relationship = PERSONA_MANIFEST.recordRelationships.find((r) => r.recordKind === "workOrder");
  assert.equal(relationship.status, "SEEDED");
  assert.equal(relationship.assignedEmployee, "service-technician-a");
});

// ════════════════════════════ the preflight ════════════════════════════

// All three governed workforce capabilities are REGISTERED and granted to admin and owner in nonprod
// (measured 2026-09-24), so all three belong in the live set. `taylor` is the only ACTIVE operating
// company key, which is why the three sample-co-synthetic REORDER_QUEUE scopes are the blocked steps.
const LIVE = Object.freeze({
  capabilities: new Set([
    "admin.employeeJobRole.write", "admin.employeeWorkEligibility.write", "admin.employeeOperationalScope.write",
  ]),
  employeeIds: new Set(SAMPLE_COMPANY.employees.map((e) => e.id)),
  warehouseIds: new Set(["SC-WH-MAIN", "SC-WH-SERVICE"]),
  activeOperatingCompanyKeys: new Set(["taylor"]),
});

test("the preflight reproduces the measured nonprod partition exactly", () => {
  const plan = dimensions.planPersonaAuthorityDimensions();
  const expected = SAMPLE_COMPANY.jobRoles.length + SAMPLE_COMPANY.employees.length
    + PERSONA_MANIFEST.workEligibility.length + PERSONA_MANIFEST.operationalScopes.length;
  const result = harness.preflightAuthorityPlan(plan, LIVE);
  assert.equal(result.counts.planned, expected);
  assert.equal(result.counts.planned, 48, "14 Job Role catalog entries, 21 Job Role assignments, 7 eligibilities, 6 scopes");
  assert.equal(result.counts.blocked, 3);
  assert.equal(result.counts.applicable, 45);
  assert.ok(result.blocked.every((b) => b.code === "OPERATING_COMPANY_KEY_NOT_ACTIVE"));
  assert.ok(result.blocked.every((b) => b.detail === "sample-co-synthetic"));
});

test("a Job Role catalog step names no Employee, and a step that names neither is refused as malformed", () => {
  // The catalog entry is a TENANT fact, so there is no Employee for the preflight to look up. That is the
  // only step shape allowed to omit one, and omitting BOTH is a plan bug rather than a passable step.
  const catalog = dimensions.planPersonaAuthorityDimensions().filter((s) => s.command === "createJobRole");
  assert.equal(catalog.length, SAMPLE_COMPANY.jobRoles.length);
  for (const s of catalog) assert.equal("employeeId" in s.input, false);
  assert.equal(harness.preflightAuthorityPlan(catalog, LIVE).counts.applicable, catalog.length);
  assert.throws(
    () => harness.preflightAuthorityPlan(
      [{ command: "createJobRole", requiresCapability: "admin.employeeJobRole.write", input: {} }], LIVE),
    /PLAN_INVALID/);
});

test("a missing capability blocks a step BEFORE anything about the Employee or the target is considered", () => {
  const plan = dimensions.planPersonaAuthorityDimensions();
  const result = harness.preflightAuthorityPlan(plan, {
    ...LIVE, capabilities: new Set(), employeeIds: new Set(), warehouseIds: new Set(),
  });
  assert.equal(result.counts.applicable, 0);
  assert.ok(result.blocked.every((b) => b.code === "CAPABILITY_NOT_LIVE"),
    "the refusal names the capability and nothing else, so an operator is not sent chasing an incidental second gap");
});

test("a warehouse the tenant does not hold blocks only that step", () => {
  const plan = dimensions.planPersonaAuthorityDimensions();
  const result = harness.preflightAuthorityPlan(plan, { ...LIVE, warehouseIds: new Set(["SC-WH-MAIN"]) });
  const codes = result.blocked.map((b) => b.code);
  assert.ok(codes.includes("WAREHOUSE_NOT_IN_TENANT"));
  assert.equal(result.blocked.filter((b) => b.code === "WAREHOUSE_NOT_IN_TENANT").length, 1);
  assert.equal(result.counts.applicable, 44, "fail closed on one step, continue with the rest");
});

test("an Employee outside the tenant blocks its step and is never substituted", () => {
  const result = harness.preflightAuthorityPlan(
    [{ command: "assignEmployeeWorkEligibility", requiresCapability: "admin.employeeWorkEligibility.write", input: { employeeId: "not-a-tenant-employee", qualificationCode: "SERVICE_TECHNICIAN" } }],
    LIVE);
  assert.equal(result.counts.applicable, 0);
  assert.equal(result.blocked[0].code, "EMPLOYEE_NOT_IN_TENANT");
  assert.equal(result.blocked[0].detail, "not-a-tenant-employee");
});

test("the preflight refuses malformed input rather than guessing", () => {
  assert.equal(refusal(() => harness.preflightAuthorityPlan(null, LIVE)).code, "PLAN_INVALID");
  assert.equal(refusal(() => harness.preflightAuthorityPlan([], { capabilities: [] })).code, "LIVE_FACTS_INVALID");
  assert.equal(refusal(() => harness.preflightAuthorityPlan([{ command: "x" }], LIVE)).code, "PLAN_INVALID");
});

test("the preflight writes nothing and holds no driver", () => {
  const source = require("node:fs").readFileSync(
    new URL("../scripts/sampleCompany/personaE2EHarness.js", import.meta.url), "utf8");
  for (const f of ["require(\"pg\")", "require('pg')", "firebase-admin", "INSERT INTO", "UPDATE ", "DELETE FROM"]) {
    assert.ok(!source.includes(f), `the harness must not contain ${f}`);
  }
});

// ════════════════════════════ the validator's own guards ════════════════════════════

test("a happy-path scenario cannot claim READY against a business process that is not READY", () => {
  const broken = clone(MANIFEST);
  broken.scenarios.push({
    id: "E2E-BOGUS", phase: "ALLOWED_ACTION", persona: "parts-manager", domain: "Catalog",
    readiness: "READY", expect: { outcome: "ALLOWED", assert: "anything" },
  });
  assert.equal(refusal(() => harness.validateE2EManifest(broken)).code, "SCENARIO_OVERSTATES_AVAILABILITY");
});

test("a denial scenario MAY be READY against a blocked process, because that is what it is proving", () => {
  const ok = clone(MANIFEST);
  ok.scenarios.push({
    id: "E2E-DENIAL-OVER-DEAD-SURFACE", phase: "DENIED_ACTION", persona: "office-manager", domain: "Catalog",
    readiness: "READY", expect: { outcome: "DENIED", reason: "CAPABILITY_MISSING", assert: "403" },
  });
  assert.doesNotThrow(() => harness.validateE2EManifest(ok));
});

test("a denial that does not state its reason is refused", () => {
  const broken = clone(MANIFEST);
  broken.scenarios.find((s) => s.phase === "DENIED_ACTION").expect.reason = "   ";
  assert.equal(refusal(() => harness.validateE2EManifest(broken)).code, "DENIAL_REASON_REQUIRED");
});

test("anything short of READY must name its blocker, and so must any process short of READY", () => {
  const brokenScenario = clone(MANIFEST);
  const blockedScenario = brokenScenario.scenarios.find((s) => s.readiness !== "READY");
  delete blockedScenario.blockedBy;
  assert.equal(refusal(() => harness.validateE2EManifest(brokenScenario)).code, "SCENARIO_BLOCK_UNNAMED");

  const brokenDomain = clone(MANIFEST);
  const partial = brokenDomain.businessProcessCoverage.find((r) => r.availability !== "READY");
  delete partial.blocker;
  assert.equal(refusal(() => harness.validateE2EManifest(brokenDomain)).code, "BLOCKER_UNNAMED");
});

test("availability is measured, never inherited: a domain with no evidence is refused", () => {
  const broken = clone(MANIFEST);
  broken.businessProcessCoverage[0].measuredEvidence = "";
  assert.equal(refusal(() => harness.validateE2EManifest(broken)).code, "EVIDENCE_REQUIRED");
});

test("every one of the fourteen required business processes is measured", () => {
  const broken = clone(MANIFEST);
  broken.businessProcessCoverage = broken.businessProcessCoverage.filter((r) => r.domain !== "Receiving");
  assert.equal(refusal(() => harness.validateE2EManifest(broken)).code, "DOMAIN_MISSING");
  assert.equal(MANIFEST.requiredDomains.length, 14);
});

test("Q1: the authentication dependency is recorded, and recording it as issuing authority is refused", () => {
  assert.equal(MANIFEST.authenticationDependency.status, "TRANSITIONAL_DEPENDENCY");
  assert.equal(MANIFEST.authenticationDependency.provider, "Firebase Auth, email/password");
  assert.equal(MANIFEST.authenticationDependency.project, "eos-platform-sandbox");
  assert.ok(MANIFEST.authenticationDependency.evidence.length >= 5);

  const broken = clone(MANIFEST);
  broken.authenticationDependency.issuesBusinessAuthority = true;
  assert.equal(refusal(() => harness.validateE2EManifest(broken)).code, "AUTH_DEPENDENCY_OVERREACH");

  const unrecorded = clone(MANIFEST);
  delete unrecorded.authenticationDependency;
  assert.equal(refusal(() => harness.validateE2EManifest(unrecorded)).code, "AUTH_DEPENDENCY_UNRECORDED");
});

test("a merge without evidence, and a blocked persona without a blocker, are both refused", () => {
  const noEvidence = clone(MANIFEST);
  noEvidence.canonicalPersonas.find((r) => r.disposition === "MERGED").mergeEvidence = "";
  assert.equal(refusal(() => harness.validateE2EManifest(noEvidence)).code, "MERGE_UNJUSTIFIED");

  const noBlocker = clone(MANIFEST);
  noBlocker.canonicalPersonas.find((r) => r.disposition === "BLOCKED").blockedBy = "";
  assert.equal(refusal(() => harness.validateE2EManifest(noBlocker)).code, "PERSONA_BLOCK_UNNAMED");
});

test("a provisionable persona with no Principal is refused: Employee is not user access", () => {
  const broken = clone(MANIFEST);
  broken.canonicalPersonas[0].persona = "records-clerk";
  broken.canonicalPersonas[0].disposition = "PROVISIONABLE";
  assert.equal(refusal(() => harness.validateE2EManifest(broken)).code, "PERSONA_CANNOT_LOG_IN");
});

test("the assignment fixture cannot go quiet about a path it refused", () => {
  const broken = clone(MANIFEST);
  const unseeded = broken.assignedUnassignedFixture.candidatePaths.find((p) => p.status !== "SEEDED");
  delete unseeded.blockedBy;
  assert.equal(refusal(() => harness.validateE2EManifest(broken)).code, "ASSIGNMENT_PATH_INCOMPLETE");
  // ...and a path cannot escape the rule by CLAIMING to be seeded without saying what still blocks writing.
  const quiet = clone(MANIFEST);
  const seeded = quiet.assignedUnassignedFixture.candidatePaths.find((p) => p.status === "SEEDED");
  delete seeded.stillBlockedForWriting;
  assert.equal(refusal(() => harness.validateE2EManifest(quiet)).code, "ASSIGNMENT_PATH_INCOMPLETE");
});

test("the Administration READ claim names every login persona, and reads do NOT separate Owner from Administrator", () => {
  // THE CLAIM THIS REPLACES. This row used to read "Reads require only an active Principal with an ACTIVE
  // tenant membership -- so every one of the 15 personas can perform them", which described a BYPASS. Once
  // Administration reads are capability-enforced before dispatch, that sentence is false, and a persona
  // census is the honest replacement. The census cannot be recomputed offline -- the grants live in
  // eos_policy, not in the compiled catalog -- so what IS asserted here is that it stays COMPLETE.
  const row = MANIFEST.businessProcessCoverage.find((r) => r.administrationReadAuthority);
  const census = row.administrationReadAuthority;
  const loginPersonas = SAMPLE_COMPANY.principals.map((p) => p.employee).sort();
  assert.deepEqual(Object.keys(census.byPersona).sort(), loginPersonas,
    "a persona added to the catalog must appear here, even with an empty list -- 'reads nothing' is a measurement");
  // The negative control reads nothing, and says so explicitly rather than by omission.
  assert.deepEqual(census.byPersona["restricted-user"], []);
  // READS DO NOT SEPARATE OWNER FROM ADMINISTRATOR. All four Administration read capabilities are granted
  // to exactly `admin` and `owner`, so the separation lives on the mutation side and on the 19 admin-only
  // operational capabilities -- not here. Asserting it keeps anyone from citing reads as the difference.
  assert.deepEqual(census.byPersona["owner-executive"], census.byPersona.administrator);
  for (const key of ["admin.principalAccess.read", "admin.securityPolicy.read", "workflowDefinition.read"]) {
    assert.deepEqual(census.byCapability[key].grantedToRoles, ["admin", "owner"], key);
  }
  // The bypass sentence survives only as a QUOTED correction, never as the row's own claim.
  assert.match(row.measuredEvidence, /^CORRECTED 2026-09-24\./);
  assert.match(row.measuredEvidence, /described a BYPASS, and it is being closed/);
});

// ════════════════════════════ the honesty the Owner asked for by name ════════════════════════════

test("Commercial is BLOCKED_PENDING_C5 and no scenario fakes a Commercial record", () => {
  const financials = MANIFEST.businessProcessCoverage.find((r) => r.domain === "Financials");
  assert.equal(financials.availability, "BLOCKED_PENDING_C5");
  const sales = MANIFEST.businessProcessCoverage.find((r) => r.domain === "Sales");
  assert.ok(sales.blocker.includes("BLOCKED_PENDING_C5"));
  for (const s of MANIFEST.scenarios.filter((x) => x.domain === "Sales" && x.expect.outcome === "ALLOWED")) {
    assert.equal(s.readiness, "BLOCKED_PENDING_C5", `${s.id} must not claim a runnable Commercial happy path`);
  }
  assert.equal(MANIFEST.liveMeasurement["eos_commercial.opportunities"], 0);
  assert.equal(MANIFEST.liveMeasurement["eos_commercial.sales_agreements"], 0);
  assert.equal(MANIFEST.liveMeasurement["eos_commercial.sales_orders"], 0);
});

test("the manifest carries no credential, token or connection string", () => {
  const serialized = JSON.stringify(MANIFEST).toLowerCase();
  for (const f of ["password\":", "postgresql://", "postgres://", "bearer ey", "apikey", "secret\":", "dpg-"]) {
    assert.ok(!serialized.includes(f), `the manifest must not contain ${f}`);
  }
  assert.equal(MANIFEST.credentialPath.noCredentialInThisManifest.length > 0, true);
});

test("no production identity or frozen world is named as a target", () => {
  const serialized = JSON.stringify(MANIFEST);
  assert.ok(!serialized.includes("taylor-parts"), "the production Firebase project is never named as a target");
  assert.equal(MANIFEST.environment, "platform-sandbox");
  assert.equal(MANIFEST.tenantKey, "taylor-nonprod");
});

test("what this lane wrote is declared exactly, and what it refused to write is declared too", () => {
  assert.equal(MANIFEST.nonprodChange.wroteAnything, true);
  assert.equal(MANIFEST.nonprodChange.writes.length, 2);
  for (const w of MANIFEST.nonprodChange.writes) {
    assert.ok(w.tool && w.why && typeof w.dryRunFirst === "string" && w.dryRunFirst.startsWith("yes"), "a nonprod write names its tool, its reason and its dry run");
  }
  assert.ok(MANIFEST.nonprodChange.didNotWrite.some((s) => s.includes("Commercial")));
  assert.ok(MANIFEST.nonprodChange.didNotWrite.some((s) => s.includes("raw SQL")));
  assert.equal(MANIFEST.liveMeasurement["eos_workforce.employee_work_eligibility"].after, 7);
  assert.equal(MANIFEST.liveMeasurement["eos_workforce.employee_operational_scopes"].after, 6);
  assert.equal(MANIFEST.liveMeasurement["eos_ops.work_order_assignments"], 0);
  assert.equal(MANIFEST.liveMeasurement["eos_ops.reorder_request_assignments"], 0);
});
