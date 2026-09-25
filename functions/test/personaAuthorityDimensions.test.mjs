// PERSONA AUTHORITY DIMENSIONS -- the manifest's invariants, the vocabularies it may not drift from,
// and the separations it exists to prove.
//
// Pure: no database, no Firebase, no network. Every governed vocabulary is read from the COMPILED
// module that owns it, so a manifest can never be validated against a second copy of a rule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);

const MODULE_PATH = join(FUNCTIONS_DIR, "scripts/sampleCompany/personaAuthorityDimensions.js");
const dimensions = require(MODULE_PATH);
const { MANIFEST, validateManifest, planPersonaAuthorityDimensions, seedPersonaAuthorityDimensions } = dimensions;

const SAMPLE_COMPANY = require("../scripts/fixtures/sampleCompany.v2.json");
const V1 = require("../scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json");

// The governed owners of every vocabulary this manifest uses.
const { WORK_ELIGIBILITY_CODES, EMPLOYEE_WORK_ELIGIBILITY_WRITE } = require("../lib/eosWorkforce/workEligibilityVocabulary.js");
const { OPERATIONAL_SCOPE_TYPES, EMPLOYEE_OPERATIONAL_SCOPE_WRITE } = require("../lib/eosWorkforce/operationalScopeVocabulary.js");
const contextual = require("../lib/eosOps/contextualAuthorization.js");
const { OPERATIONAL_ROLE_VALUES } = require("../lib/access/employeeProfileCommands.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");

const VOCABULARY = { workEligibilityCodes: WORK_ELIGIBILITY_CODES, operationalScopeTypes: OPERATIONAL_SCOPE_TYPES };
const clone = () => JSON.parse(JSON.stringify(MANIFEST));
const validate = (m = MANIFEST, sc = SAMPLE_COMPANY) => validateManifest(m, sc, VOCABULARY);
const refusal = (m, sc = SAMPLE_COMPANY) => {
  try {
    validateManifest(m, sc, VOCABULARY);
  } catch (err) {
    return err.code;
  }
  return null;
};

// ════════════════════ (1) THE MANIFEST AS COMMITTED ════════════════════

test("(1) the manifest validates as it is committed, against the compiled governed vocabularies", () => {
  const result = validate();
  assert.equal(result.personaKeys.length, SAMPLE_COMPANY.employees.length);
});

test("every governed vocabulary is the compiled one, never a second copy that could drift", () => {
  assert.deepEqual(dimensions.LEGACY_OPERATIONAL_ROLE_VALUES, OPERATIONAL_ROLE_VALUES);
  assert.deepEqual(dimensions.CONTEXT_PREDICATE_KINDS, contextual.CONTEXT_PREDICATE_KINDS);
  assert.deepEqual([...WORK_ELIGIBILITY_CODES].sort(), [...contextual.GOVERNED_QUALIFICATION_CODES].sort());
});

test("this manifest layers onto SAMPLE_COMPANY_V2 and refuses anything else", () => {
  assert.equal(MANIFEST.basis.manifest, SAMPLE_COMPANY.manifest);
  assert.equal(refusal(MANIFEST, { ...SAMPLE_COMPANY, sampleCompanyVersion: 3 }), "MANIFEST_INVALID");
});

// ── The gap this manifest exists to close, measured STRUCTURALLY rather than by substring. ──
// This was a substring scan over JSON.stringify(fixture) for four tokens. It began failing at
// bd1d60a1, on SYNTHETIC_NONPROD_WORKFORCE_V1 principals[].roleReasons.technician -- a free-text
// Owner-ruling sentence reading "technician is the standing negative eligibility case and must
// never be given PARTS_OPERATIONS merely to satisfy a test (Owner ruling 2026-09-23)". That is
// prose AFFIRMING the separation, not an upstream authority row. The scan had two defects:
//   (a) it could not tell a governed VALUE from a sentence about one; and
//   (b) it named 2 of the 5 governed terms, so it could never have seen SERVICE_TECHNICIAN --
//       simultaneously a Job Role key and a Work Eligibility code -- sitting upstream already.
// PARTS_OPERATIONS is governed and stays upstream. What is pinned below is the exact structural
// footprint of EVERY governed term in both fixtures, so the manifest remains the sole authority.

const UPSTREAM_FIXTURES = { SAMPLE_COMPANY_V2: SAMPLE_COMPANY, SYNTHETIC_NONPROD_WORKFORCE_V1: V1 };
const GOVERNED_TERMS = new Set([...WORK_ELIGIBILITY_CODES, ...OPERATIONAL_SCOPE_TYPES]);
const AUTHORITY_SECTION_KEYS = ["workEligibility", "operationalScopes"];

// Every path at which a governed term may appear upstream as an EXACT value, and the dimension
// that path actually belongs to. JOB_ROLE and LOCATION_TYPE are OTHER dimensions that happen to
// share a spelling; neither grants anyone a Work Eligibility or an Operational Scope.
const DECLARED_UPSTREAM_TERM_PATHS = {
  SAMPLE_COMPANY_V2: {
    "$.jobRoles[].key = SERVICE_TECHNICIAN": "JOB_ROLE",
    "$.employees[].jobRole = SERVICE_TECHNICIAN": "JOB_ROLE",
    "$.purchasing[].receipt.receivingLocation.type = WAREHOUSE": "LOCATION_TYPE",
    "$.cycleCounts[].location.type = WAREHOUSE": "LOCATION_TYPE",
  },
  SYNTHETIC_NONPROD_WORKFORCE_V1: {
    "$.jobRoles[].key = SERVICE_TECHNICIAN": "JOB_ROLE",
    "$.employees[].jobRole = SERVICE_TECHNICIAN": "JOB_ROLE",
  },
};
// A path may never be legalised by DECLARING it to be the dimension this manifest owns.
const NON_AUTHORITY_DIMENSIONS = new Set(["JOB_ROLE", "LOCATION_TYPE"]);

const scanUpstream = (fixture) => {
  const sections = new Set();
  const values = new Set();
  (function walk(node, path) {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, `${path}[]`);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (AUTHORITY_SECTION_KEYS.includes(k)) sections.add(`${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
      return;
    }
    if (typeof node === "string" && GOVERNED_TERMS.has(node)) values.add(`${path} = ${node}`);
  })(fixture, "$");
  return { sections: [...sections].sort(), values: [...values].sort() };
};

test("the gap this manifest exists to close is real: no upstream fixture holds a Work Eligibility or Operational Scope SECTION", () => {
  for (const [name, fixture] of Object.entries(UPSTREAM_FIXTURES)) {
    assert.deepEqual(scanUpstream(fixture).sections, [],
      `${name} grew an authority section this manifest already owns; reconcile the two manifests`);
  }
});

test("every upstream appearance of a governed term is pinned to a path, and to a DIFFERENT dimension", () => {
  for (const [name, fixture] of Object.entries(UPSTREAM_FIXTURES)) {
    const declared = DECLARED_UPSTREAM_TERM_PATHS[name];
    assert.deepEqual(scanUpstream(fixture).values, Object.keys(declared).sort(),
      `${name}: a governed term appeared, moved or vanished upstream; reconcile the two manifests`);
    for (const [path, dimension] of Object.entries(declared)) {
      assert.ok(NON_AUTHORITY_DIMENSIONS.has(dimension),
        `${name} ${path} is declared ${dimension}; an upstream path may never be declared a Work Eligibility or an Operational Scope`);
    }
  }
});

test("no upstream Employee record carries a Work Eligibility or a scope -- only a Job Role, which implies neither", () => {
  for (const [name, fixture] of Object.entries(UPSTREAM_FIXTURES)) {
    for (const employee of fixture.employees) {
      for (const [field, value] of Object.entries(employee)) {
        if (field === "jobRole") continue; // a different dimension, proved non-implying by (3)
        for (const v of Array.isArray(value) ? value : [value]) {
          assert.ok(!GOVERNED_TERMS.has(v),
            `${name} ${employee.key}.${field} = ${v}: an upstream Employee silently gained a governed eligibility or scope it was never granted through this manifest`);
        }
      }
    }
  }
});

test("the Owner ruling that keeps technician the standing negative eligibility case is still recorded upstream", () => {
  // This sentence is what the old substring scan tripped over. It is governed evidence (bd1d60a1),
  // so it is now asserted PRESENT: deleting it would quietly erase Owner ruling 2026-09-23.
  const technician = V1.principals.find((p) => p.employee === "service-technician-a");
  assert.match(technician.roleReasons.technician, /must never be given PARTS_OPERATIONS/);
  assert.match(technician.roleReasons.technician, /Owner ruling 2026-09-23/);
  // ...and it is prose ONLY: no technician persona holds PARTS_OPERATIONS in this manifest, while
  // the parts personas -- which is where PARTS_OPERATIONS is governed -- do.
  const partsOperations = MANIFEST.workEligibility
    .filter((r) => r.qualificationCode === "PARTS_OPERATIONS")
    .map((r) => r.employee)
    .sort();
  assert.deepEqual(partsOperations, ["parts-associate", "parts-manager"]);
  for (const e of SAMPLE_COMPANY.employees.filter((x) => x.jobRole === "SERVICE_TECHNICIAN")) {
    assert.ok(!partsOperations.includes(e.key), `${e.key} is a technician and must not hold PARTS_OPERATIONS`);
  }
});

// ════════════════════ (2) THE VOCABULARY FENCE ════════════════════

test("(2) a legacy operationalRoles value can never be a qualification code", () => {
  for (const legacy of OPERATIONAL_ROLE_VALUES) {
    const m = clone();
    m.workEligibility[0].qualificationCode = legacy;
    // Every legacy value is outside the governed vocabulary, so it is refused twice over. The
    // QUALIFICATION_UNKNOWN check fires first; either refusal is fail-closed.
    assert.ok(["QUALIFICATION_UNKNOWN", "LEGACY_VOCABULARY_REFUSED"].includes(refusal(m)), legacy);
  }
});

test("a qualification code outside the governed vocabulary is refused", () => {
  const m = clone();
  m.workEligibility[0].qualificationCode = "PARTS_OPERATIONS_V2";
  assert.equal(refusal(m), "QUALIFICATION_UNKNOWN");
});

test("a scope type outside the governed vocabulary is refused", () => {
  const m = clone();
  m.operationalScopes[0].scopeType = "REGION";
  assert.equal(refusal(m), "SCOPE_TYPE_UNKNOWN");
});

test("a WAREHOUSE scope may only name a warehouse the Sample Company declares", () => {
  const m = clone();
  m.operationalScopes.find((r) => r.scopeType === "WAREHOUSE").scopeId = "SC-WH-NOWHERE";
  assert.equal(refusal(m), "SCOPE_TARGET_UNKNOWN");
});

test("operating_company_id is NOT operating_company_key: a REORDER_QUEUE scope naming the id is refused", () => {
  assert.notEqual(SAMPLE_COMPANY.company.operatingCompanyId, SAMPLE_COMPANY.company.operatingCompanyKey);
  const m = clone();
  for (const row of m.operationalScopes) {
    if (row.scopeType === "REORDER_QUEUE") row.scopeId = SAMPLE_COMPANY.company.operatingCompanyId;
  }
  assert.ok(["SCOPE_TARGET_UNKNOWN", "COMPANY_ID_IS_NOT_COMPANY_KEY"].includes(refusal(m)));
});

// ════════════════════ (3) NO DIMENSION MAY IMPLY ANOTHER ════════════════════

test("(3) Job Role may not imply Work Eligibility: at least one Job Role holder must lack the code", () => {
  const m = clone();
  const onLeave = SAMPLE_COMPANY.employees.find((e) => e.key === "technician-on-leave");
  assert.equal(onLeave.jobRole, "SERVICE_TECHNICIAN");
  m.workEligibility.push({ employee: "technician-on-leave", qualificationCode: "SERVICE_TECHNICIAN", reason: "PERSONA FIXTURE: forced" });
  m.personas["technician-on-leave"].workEligibility = ["SERVICE_TECHNICIAN"];
  assert.equal(refusal(m), "JOB_ROLE_IMPLIES_QUALIFICATION");
});

test("Operational Scope may not imply Work Eligibility", () => {
  const m = clone();
  // The dispatcher is the proof: a scope with no qualification. Give them one and the separation
  // is no longer demonstrable anywhere in the catalog.
  m.workEligibility.push({ employee: "dispatcher", qualificationCode: "PARTS_OPERATIONS", reason: "PERSONA FIXTURE: forced" });
  m.personas.dispatcher.workEligibility = ["PARTS_OPERATIONS"];
  m.workEligibilityWithheld = m.workEligibilityWithheld.filter((r) => r.employee !== "dispatcher");
  assert.equal(refusal(m), "SCOPE_IMPLIES_QUALIFICATION");
});

test("Work Eligibility may not imply Operational Scope", () => {
  const m = clone();
  for (const key of ["service-technician-a", "service-technician-b", "contract-technician", "warehouse-associate", "warehouse-manager"]) {
    m.operationalScopes.push({ employee: key, scopeType: "REORDER_QUEUE", scopeId: m.operatingCompanyKey, reason: "PERSONA FIXTURE: forced" });
    m.personas[key].operationalScopes = [...new Set([...m.personas[key].operationalScopes, `REORDER_QUEUE:${m.operatingCompanyKey}`])];
  }
  assert.equal(refusal(m), "QUALIFICATION_IMPLIES_SCOPE");
});

test("the three separations are each proved by a NAMED persona, not by an accident of the data", () => {
  const { eligibilityByEmployee, scopesByEmployee } = validate();
  // scope without qualification
  assert.ok(scopesByEmployee.has("dispatcher") && !eligibilityByEmployee.has("dispatcher"));
  // qualification without scope
  assert.ok(eligibilityByEmployee.has("service-technician-a") && !scopesByEmployee.has("service-technician-a"));
  // Job Role without the matching qualification
  assert.ok(!eligibilityByEmployee.has("technician-on-leave"));
  // the broadest Security Role with no operational qualification at all -- and it is the ADMINISTRATOR's,
  // not the Owner's. Owner ruling: Owner is not Administrator and Administrator is not Owner.
  assert.deepEqual(MANIFEST.personas.administrator.securityRoles, ["admin"]);
  assert.deepEqual(MANIFEST.personas.administrator.workEligibility, []);
  assert.deepEqual(MANIFEST.personas["owner-executive"].securityRoles, ["owner"]);
  assert.deepEqual(MANIFEST.personas["owner-executive"].workEligibility, []);
});

test("OWNER IS NOT ADMINISTRATOR: two personas, two Employees, two Principals, two Roles, and no merge left", () => {
  const owner = MANIFEST.personas["owner-executive"];
  const administrator = MANIFEST.personas.administrator;
  assert.notEqual(owner.employee, administrator.employee);
  assert.notEqual(owner.jobRole, administrator.jobRole);
  assert.deepEqual(owner.securityRoles, ["owner"]);
  assert.deepEqual(administrator.securityRoles, ["admin"]);
  // The merged OWNER/ADMIN fixture may not survive in ANY form: not as a persona field, not as a catalog
  // disposition. (parts-manager keeps `mergedFrom: ["Purchasing"]`, which is a merge the Owner made: the
  // required population names that persona "Parts Manager/Purchasing" as one entry.)
  for (const [key, p] of Object.entries(MANIFEST.personas)) {
    assert.ok(!(p.mergedFrom ?? []).includes("Administrator"), `${key} still merges Administrator into itself`);
    assert.ok(!(p.mergedFrom ?? []).includes("Owner / Executive"), `${key} still merges Owner / Executive into itself`);
  }
  assert.equal(MANIFEST.personas["owner-executive"].mergedFrom, undefined);
  assert.equal(MANIFEST.personas["owner-executive"].mergeReason, undefined);
  const administratorGap = MANIFEST.catalogGaps.find((g) => /^Administrator/.test(g.requestedRole));
  assert.notEqual(administratorGap.disposition, "MERGED_INTO_OWNER_EXECUTIVE");
  assert.equal(administratorGap.disposition, "CLOSED_IN_SAMPLE_COMPANY_V2");
  assert.equal(administratorGap.closedBy, "personas['administrator']");
  // And the separation is NOT made by giving the Owner the Administrator's permissions: the `owner` Role
  // is withheld from the Sample Company's grant reconciliation for exactly that reason.
  assert.deepEqual(SAMPLE_COMPANY.expectedAccess.roleGrantScope.withheldFromReconciliation.map((r) => r.role), ["owner"]);
  assert.match(SAMPLE_COMPANY.expectedAccess.roleGrantScope.withheldFromReconciliation[0].reason, /may NOT be solved by copying/);
});

test("REPORTING is a BLOCKED_DOMAIN placeholder and holds no reporting authority of any kind", () => {
  const p = MANIFEST.personas["report-analyst"];
  assert.equal(p.acceptance, "BLOCKED_DOMAIN");
  assert.equal(p.blockedBy, "REPORTING_CAPABILITY_VOCABULARY_ABSENT");
  assert.deepEqual(p.securityRoles, []);
  assert.equal(p.northStar, "NONE");
  assert.ok(!SAMPLE_COMPANY.principals.some((x) => x.employee === "report-analyst"), "the Reporting persona holds no Principal");
  // NOT ONE report capability may be granted while the domain is outside eos_policy. Measured, not assumed:
  // no report.* id is in the governed vocabulary, so no contract anywhere could name one and pass.
  const vocabulary = SAMPLE_COMPANY.expectedAccess.postgresCapabilityVocabulary;
  assert.deepEqual(vocabulary.filter((k) => k.startsWith("report")), []);
  for (const role of ["reportViewer", "reportFinanceViewer", "reportAuthor"]) {
    assert.ok(!SAMPLE_COMPANY.principals.some((x) => x.securityRoles.includes(role)), `${role} is held by nobody`);
  }
  assert.ok(MANIFEST.blockers.some((b) => b.code === "REPORTING_CAPABILITY_VOCABULARY_ABSENT"));
});

test("the RESTRICTED negative control is signed in, and that is what makes it different from records-clerk", () => {
  const restricted = MANIFEST.personas["restricted-user"];
  assert.deepEqual(restricted.securityRoles, ["generalEmployee"]);
  assert.deepEqual(restricted.workEligibility, []);
  assert.deepEqual(restricted.operationalScopes, []);
  // IT HAS A PRINCIPAL. records-clerk and technician-on-leave do not, so their refusals come before
  // authorization is reached; this one's come FROM authorization.
  assert.ok(SAMPLE_COMPANY.principals.some((x) => x.employee === "restricted-user"));
  for (const key of ["records-clerk", "technician-on-leave"]) {
    assert.ok(!SAMPLE_COMPANY.principals.some((x) => x.employee === key), `${key} must stay Principal-less`);
  }
  // Its Role is real and grants nothing -- measured from the compiled catalog, never assumed.
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  assert.ok(roles.generalEmployee, "generalEmployee must be a real governed Role");
  assert.deepEqual(roles.generalEmployee.permissions ?? [], []);
  // Same Job Role as the office manager, radically different Security Role: the mirror image of the
  // retail-vs-national-accounts proof, which is same Security Role and different Job Role.
  assert.equal(restricted.jobRole, MANIFEST.personas["office-manager"].jobRole);
  assert.notDeepEqual(restricted.securityRoles, MANIFEST.personas["office-manager"].securityRoles);
});

test("the FINANCE persona holds the registered financial authority that nobody held", () => {
  const finance = MANIFEST.personas["finance-controller"];
  assert.deepEqual(finance.securityRoles, ["controller"]);
  assert.equal(finance.jobRole, "FINANCE_MANAGER");
  // JOB ROLE IS NOT SECURITY ROLE, and this persona is where the two most obviously do not have to agree:
  // it carries the FINANCE_MANAGER business function and does NOT hold the `financeManager` Security Role.
  assert.ok(!finance.securityRoles.includes("financeManager"));
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const contract = SAMPLE_COMPANY.expectedAccess.personas["finance-controller"];
  const held = new Set(roles.controller.permissions ?? []);
  for (const cap of contract.requiredCapabilities) assert.ok(held.has(cap), `controller does not declare ${cap}`);
  for (const cap of contract.forbiddenCapabilities) assert.ok(!held.has(cap), `controller declares forbidden ${cap}`);
  assert.ok(contract.requiredCapabilities.some((c) => c.startsWith("finance.")), "the finance authority must actually be exercised");
  // And it is ONE finance authority, not three copies of the same seventeen capabilities.
  for (const role of ["accountingManager", "financeManager"]) {
    assert.ok(!SAMPLE_COMPANY.principals.some((x) => x.securityRoles.includes(role)), `${role} stays held by nobody`);
  }
});

// ════════════════════ (4) THE PERSONA CATALOG CAN NEVER DRIFT FROM THE SAMPLE COMPANY ════════════════════

test("(4) every Sample Company Employee is evaluated, and none is invented", () => {
  const declared = new Set(SAMPLE_COMPANY.employees.map((e) => e.key));
  assert.deepEqual(new Set(Object.keys(MANIFEST.personas)), declared);
});

test("a persona's Employee id, Job Role and Security Roles are the Sample Company's own", () => {
  for (const field of ["employee", "jobRole"]) {
    const m = clone();
    m.personas["parts-associate"][field] = "drifted";
    assert.equal(refusal(m), "PERSONA_DRIFT", field);
  }
  const m = clone();
  m.personas["parts-associate"].securityRoles = ["technician"];
  assert.equal(refusal(m), "PERSONA_DRIFT");
});

test("a persona's declared dimensions can never disagree with the manifest's own rows", () => {
  const m = clone();
  m.personas["parts-associate"].workEligibility = [];
  assert.equal(refusal(m), "PERSONA_DRIFT");
});

test("every Security Role a persona names exists in the governed catalog -- none is invented", () => {
  const catalog = new Set([...Object.keys(COMPATIBILITY_ROLES), ...Object.keys(GOVERNED_BUSINESS_ROLES)]);
  for (const [key, persona] of Object.entries(MANIFEST.personas)) {
    for (const role of persona.securityRoles) assert.ok(catalog.has(role), `${key} names unknown Role ${role}`);
  }
});

test("a persona with no Principal holds no Security Role", () => {
  for (const key of ["technician-on-leave", "records-clerk"]) {
    assert.deepEqual(MANIFEST.personas[key].securityRoles, []);
    assert.equal(MANIFEST.personas[key].northStar, "NONE");
  }
});

// ════════════════════ (5) THE GATES THE OWNER NAMED ════════════════════

test("(5) the expectation set proves every gate, positive and negative", () => {
  const byReason = new Map();
  for (const cx of MANIFEST.contextualExpectations) {
    byReason.set(cx.expect.reason, (byReason.get(cx.expect.reason) ?? 0) + 1);
  }
  for (const reason of ["ALLOWED", "CAPABILITY_MISSING", "OUTSIDE_OPERATIONAL_SCOPE", "NOT_ASSIGNED",
    "WORK_ELIGIBILITY_MISSING", "WORK_ELIGIBILITY_UNMAPPED", "EMPLOYEE_LINK_REQUIRED"]) {
    assert.ok((byReason.get(reason) ?? 0) > 0, `no expectation returns ${reason}`);
  }
});

test("a suite with no negative is refused", () => {
  const m = clone();
  m.contextualExpectations = m.contextualExpectations.filter((cx) => cx.expect.allowed);
  assert.equal(refusal(m), "COVERAGE_INSUFFICIENT");
});

test("a CAPABILITY_MISSING refusal never names a predicate -- it would leak which gate was reached", () => {
  for (const cx of MANIFEST.contextualExpectations) {
    if (cx.expect.reason === "CAPABILITY_MISSING") assert.equal(cx.expect.predicate, undefined, cx.id);
  }
  const m = clone();
  const target = m.contextualExpectations.find((cx) => cx.expect.reason === "CAPABILITY_MISSING");
  target.expect.predicate = "OPERATIONAL_SCOPE";
  assert.equal(refusal(m), "EXPECTATION_INVALID");
});

test("assigned vs unassigned is proved by ONE difference and nothing else", () => {
  const a = MANIFEST.personas["service-technician-a"];
  const b = MANIFEST.personas["service-technician-b"];
  assert.deepEqual(a.securityRoles, b.securityRoles);
  assert.deepEqual(a.jobRole, b.jobRole);
  assert.deepEqual(a.workEligibility, b.workEligibility);
  assert.deepEqual(a.operationalScopes, b.operationalScopes);
  const assigned = MANIFEST.contextualExpectations.find((cx) => cx.id === "CX-05-ASSIGNED-TECHNICIAN");
  const unassigned = MANIFEST.contextualExpectations.find((cx) => cx.id === "CX-06-UNASSIGNED-TECHNICIAN");
  assert.equal(assigned.record.recordId, unassigned.record.recordId);
  assert.equal(assigned.capabilityKey, unassigned.capabilityKey);
  assert.equal(assigned.expect.reason, "ALLOWED");
  assert.equal(unassigned.expect.reason, "NOT_ASSIGNED");
});

test("in scope vs outside scope is proved by ONE persona, with no second login", () => {
  const inScope = MANIFEST.contextualExpectations.find((cx) => cx.id === "CX-11-WAREHOUSE-SCOPE-IN");
  const outScope = MANIFEST.contextualExpectations.find((cx) => cx.id === "CX-12-WAREHOUSE-SCOPE-OUT");
  assert.equal(inScope.persona, outScope.persona);
  assert.equal(inScope.capabilityKey, outScope.capabilityKey);
  assert.equal(outScope.expect.reason, "OUTSIDE_OPERATIONAL_SCOPE");
  // and the withholding is DECLARED, not merely absent from the rows
  assert.ok(MANIFEST.operationalScopesWithheld.some((r) => r.employee === "warehouse-associate" && r.wouldBe === "WAREHOUSE:SC-WH-SERVICE"));
});

test("an alternative-path expectation declares paths, never a flat predicate list", () => {
  for (const id of ["CX-07-ALTERNATIVE-PATH-VIA-ASSIGNMENT", "CX-08-ALTERNATIVE-PATH-VIA-QUEUE"]) {
    const cx = MANIFEST.contextualExpectations.find((x) => x.id === id);
    assert.ok(Array.isArray(cx.paths) && cx.paths.length === 2, id);
    assert.equal(cx.predicates, undefined, id);
  }
});

test("a predicate kind the evaluator cannot prove is refused", () => {
  const m = clone();
  m.contextualExpectations[2].predicates = [{ kind: "RECORD_OWNERSHIP", relation: "OWNER" }];
  assert.equal(refusal(m), "EXPECTATION_INVALID");
});

test("a RECORD_ASSIGNMENT expectation without a record is refused", () => {
  const m = clone();
  const cx = m.contextualExpectations.find((x) => x.id === "CX-06-UNASSIGNED-TECHNICIAN");
  delete cx.record;
  assert.equal(refusal(m), "EXPECTATION_INVALID");
});

// ════════════════════ (6) HONEST GAPS ════════════════════

test("(6) an expectation no authority covers is declared as such, never left looking passable", () => {
  for (const cx of MANIFEST.contextualExpectations) {
    if (cx.declaredOnly) assert.ok(cx.notCoveredBy || cx.$comment, cx.id);
  }
  const m = clone();
  const gap = m.contextualExpectations.find((cx) => cx.declaredOnly && cx.notCoveredBy);
  delete gap.notCoveredBy;
  delete gap.$comment;
  assert.equal(refusal(m), "UNDECLARED_GAP");
});

test("owner-vs-non-owner is declared NOT COVERED, because there is no ownership predicate kind", () => {
  assert.ok(!contextual.CONTEXT_PREDICATE_KINDS.includes("RECORD_OWNERSHIP"));
  const cx = MANIFEST.contextualExpectations.find((x) => x.id === "CX-15-OWNER-VS-NON-OWNER");
  assert.equal(cx.declaredOnly, true);
  assert.equal(cx.notCoveredBy, "contextualAuthorization.ts");
});

test("EMPLOYEE_LINK_REQUIRED is declared unprovable, because every login persona is linked", () => {
  const linked = new Set(SAMPLE_COMPANY.principals.map((p) => p.employee));
  for (const p of SAMPLE_COMPANY.principals) assert.ok(linked.has(p.employee));
  const cx = MANIFEST.contextualExpectations.find((x) => x.id === "CX-16-EMPLOYEE-LINK-REQUIRED");
  assert.equal(cx.persona, null);
  assert.equal(cx.declaredOnly, true);
});

test("the e2e matrix marks unavailable functionality honestly, with evidence for every row", () => {
  const allowed = new Set(["AVAILABLE", "PARTIAL", "UNAVAILABLE", "BLOCKED", "DECLARED_NOT_SEEDED"]);
  for (const row of MANIFEST.e2eMatrix) {
    assert.ok(allowed.has(row.availability), `${row.domain}: ${row.availability}`);
    assert.ok(typeof row.evidence === "string" && row.evidence.length > 40, `${row.domain} has no evidence`);
    assert.ok(typeof row.testableToday === "string" && row.testableToday.length > 0, row.domain);
  }
  // A matrix in which everything works is the failure mode this lane was warned about.
  assert.ok(MANIFEST.e2eMatrix.some((r) => r.availability !== "AVAILABLE"));
});

test("every blocker names a severity and a resolution, and none is a silent TODO", () => {
  for (const b of MANIFEST.blockers) {
    for (const field of ["code", "severity", "finding", "consequence", "resolution"]) {
      assert.ok(typeof b[field] === "string" && b[field].length > 0, `${b.code} missing ${field}`);
    }
  }
});

// ════════════════════ (7) LEGACY EVIDENCE IS EVIDENCE, NOT AUTHORITY ════════════════════

test("(7) no legacy operationalRoles value is carried as a qualification code or a scope type", () => {
  // FIELD-SCOPED, NOT A STRING SEARCH. Some Job Role KEYS coincide with legacy operationalRoles
  // strings (PARTS_MANAGER, WAREHOUSE_ASSOCIATE, SERVICE_TECHNICIAN) and that is not a defect: Job
  // Role is a different axis with its own vocabulary, pinned by the Sample Company. What must never
  // happen is a legacy value reaching an ENFORCEMENT field.
  const legacy = new Set(OPERATIONAL_ROLE_VALUES);
  for (const row of MANIFEST.workEligibility) assert.ok(!legacy.has(row.qualificationCode), row.qualificationCode);
  for (const row of MANIFEST.operationalScopes) assert.ok(!legacy.has(row.scopeType), row.scopeType);
  for (const persona of Object.values(MANIFEST.personas)) {
    for (const code of persona.workEligibility) assert.ok(!legacy.has(code), code);
  }
  for (const cx of MANIFEST.contextualExpectations) {
    for (const list of cx.paths ?? (cx.predicates ? [cx.predicates] : [])) {
      for (const p of list) {
        // CX-14 is the ONE place a legacy label appears in a predicate, and only to assert that the
        // evaluator REFUSES it as WORK_ELIGIBILITY_UNMAPPED. A use, not a grant.
        if (p.kind === "WORK_ELIGIBILITY" && legacy.has(p.qualificationCode)) {
          assert.equal(cx.expect.reason, "WORK_ELIGIBILITY_UNMAPPED", `${cx.id} uses a legacy label without refusing it`);
        }
        if (p.kind === "OPERATIONAL_SCOPE") assert.ok(!legacy.has(p.scopeType), cx.id);
      }
    }
  }
});

test("every Job Role a persona names is the Sample Company's own, never a legacy role re-entering", () => {
  const jobRoleKeys = new Set(SAMPLE_COMPANY.jobRoles.map((r) => r.key));
  for (const [key, persona] of Object.entries(MANIFEST.personas)) {
    assert.ok(jobRoleKeys.has(persona.jobRole), `${key} names Job Role ${persona.jobRole}`);
  }
});

test("no Firebase-uid-shaped token reaches an authoritative section", () => {
  const authoritative = JSON.stringify({
    workEligibility: MANIFEST.workEligibility,
    operationalScopes: MANIFEST.operationalScopes,
    personas: MANIFEST.personas,
    contextualExpectations: MANIFEST.contextualExpectations,
  });
  assert.ok(!/\b[A-Za-z0-9]{28}\b/.test(authoritative));
  // and the legacy persona evidence carries no uid either
  assert.ok(!/\b[A-Za-z0-9]{28}\b/.test(JSON.stringify(MANIFEST.legacyPersonaScenarios)));
});

test("every legacy persona records an intended scenario and a replacement, and nothing else", () => {
  for (const [family, entry] of Object.entries(MANIFEST.legacyPersonaScenarios)) {
    if (family.startsWith("$")) continue;
    for (const scenario of entry.scenarios ?? []) {
      assert.ok(scenario.intendedScenario && scenario.intendedScenario.length > 20, `${family}/${scenario.legacyId}`);
      assert.ok(scenario.replacedBy, `${family}/${scenario.legacyId} has no disposition`);
      assert.equal(scenario.uid, undefined);
      assert.equal(scenario.operationalRoles, undefined);
      assert.equal(scenario.securityRole, undefined);
    }
  }
});

test("the Owner's TEST_PERSONA ruling is recorded against the persona it was about", () => {
  const family = MANIFEST.legacyPersonaScenarios["emp-rudy-*"];
  const target = family.scenarios.find((s) => s.legacyId === "emp-rudy-parts-associate");
  assert.equal(target.ownerClassification, "TEST_PERSONA");
  assert.match(target.replacedBy, /^parts-associate/);
  assert.match(family.doNotTouch, /provisions nothing, deletes nothing/);
});

// ════════════════════ (8) THE PLAN, AND THE GOVERNED WRITERS ════════════════════

test("(8) the plan is exactly the manifest's rows, through the governed commands and nothing else", () => {
  const plan = planPersonaAuthorityDimensions();
  assert.equal(plan.length,
    SAMPLE_COMPANY.jobRoles.length + SAMPLE_COMPANY.employees.length
    + MANIFEST.workEligibility.length + MANIFEST.operationalScopes.length);
  const commands = new Set(plan.map((s) => s.command));
  assert.deepEqual([...commands].sort(),
    ["assignEmployeeJobRole", "assignEmployeeOperationalScope", "assignEmployeeWorkEligibility", "createJobRole"]);
  // THE JOB ROLE CATALOG FIRST, because assignEmployeeJobRole reads its entry FOR SHARE and refuses one
  // that does not exist. Then eligibility BEFORE scope: a scope on an unqualified Employee is a legitimate
  // state, but ordering the writes this way keeps the seed's output readable as the model reads.
  assert.equal(plan[0].command, "createJobRole");
  assert.equal(plan[plan.length - 1].command, "assignEmployeeOperationalScope");
  const order = plan.map((s) => s.command);
  const lastCatalog = order.lastIndexOf("createJobRole");
  assert.ok(lastCatalog < order.indexOf("assignEmployeeJobRole"), "no assignment may be planned before its catalog entry");
  assert.ok(order.lastIndexOf("assignEmployeeJobRole") < order.indexOf("assignEmployeeWorkEligibility"));
  assert.ok(order.lastIndexOf("assignEmployeeWorkEligibility") < order.indexOf("assignEmployeeOperationalScope"));
});

test("EVERY Employee gets a governed Job Role assignment -- access has nothing to do with it", () => {
  const plan = planPersonaAuthorityDimensions().filter((s) => s.command === "assignEmployeeJobRole");
  assert.equal(plan.length, SAMPLE_COMPANY.employees.length,
    "a Job Role is a business function; an Employee with no Principal still has one");
  const byEmployee = new Map(plan.map((s) => [s.input.employeeId, s.input.jobRoleId]));
  const catalog = new Map(SAMPLE_COMPANY.jobRoles.map((r) => [r.key, r.pgJobRoleId]));
  for (const e of SAMPLE_COMPANY.employees) {
    assert.equal(byEmployee.get(e.id), catalog.get(e.jobRole), `${e.key} is assigned its own declared Job Role and no other`);
  }
  // The personas with NO Principal are in it, which is the point: Job Role is not access.
  for (const key of ["records-clerk", "technician-on-leave", "report-analyst"]) {
    const e = SAMPLE_COMPANY.employees.find((x) => x.key === key);
    assert.ok(byEmployee.has(e.id), `${key} has no Principal and must still carry a Job Role`);
  }
});

test("RETAIL SALES and NATIONAL ACCOUNTS SALES are two catalog entries and stay two", () => {
  const catalog = planPersonaAuthorityDimensions().filter((s) => s.command === "createJobRole");
  assert.equal(catalog.length, SAMPLE_COMPANY.jobRoles.length);
  const ids = catalog.map((s) => s.input.jobRoleId);
  assert.equal(new Set(ids).size, ids.length, "two Job Roles may never collapse onto one governed id");
  assert.ok(ids.includes("retail-sales") && ids.includes("national-accounts-sales"));
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]{1,62}$/, "the governed writer refuses any other id shape");
  // The distinction is REAL only here: both sales personas hold the identical `salesperson` Security Role.
  const roleOf = (k) => SAMPLE_COMPANY.principals.find((p) => p.employee === k).securityRoles;
  assert.deepEqual(roleOf("retail-sales-a"), roleOf("national-accounts-sales"));
  assert.notEqual(MANIFEST.personas["retail-sales-a"].jobRole, MANIFEST.personas["national-accounts-sales"].jobRole);
});

test("the plan asks for the NARROW capability each authority declares, and they are not the same one", () => {
  assert.notEqual(EMPLOYEE_WORK_ELIGIBILITY_WRITE, EMPLOYEE_OPERATIONAL_SCOPE_WRITE);
  const { EMPLOYEE_JOB_ROLE_WRITE } = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
  assert.notEqual(EMPLOYEE_JOB_ROLE_WRITE, EMPLOYEE_WORK_ELIGIBILITY_WRITE);
  assert.notEqual(EMPLOYEE_JOB_ROLE_WRITE, EMPLOYEE_OPERATIONAL_SCOPE_WRITE);
  const BY_COMMAND = {
    createJobRole: EMPLOYEE_JOB_ROLE_WRITE,
    assignEmployeeJobRole: EMPLOYEE_JOB_ROLE_WRITE,
    assignEmployeeWorkEligibility: EMPLOYEE_WORK_ELIGIBILITY_WRITE,
    assignEmployeeOperationalScope: EMPLOYEE_OPERATIONAL_SCOPE_WRITE,
  };
  for (const step of planPersonaAuthorityDimensions()) {
    assert.equal(step.requiresCapability, BY_COMMAND[step.command], step.command);
  }
});

test("every planned input carries the governed Employee ID, never a persona key or a subject", () => {
  const ids = new Set(SAMPLE_COMPANY.employees.map((e) => e.id));
  for (const step of planPersonaAuthorityDimensions()) {
    if (step.command === "createJobRole") continue; // a catalog entry names no Employee at all
    assert.ok(ids.has(step.input.employeeId), step.input.employeeId);
    assert.match(step.input.employeeId, /^synthetic-np-emp-[a-z0-9-]+$/);
  }
});

test("plan writes nothing", async () => {
  let called = 0;
  const bump = async () => { called += 1; };
  const deps = { commands: { createJobRole: bump, assignEmployeeJobRole: bump, assignEmployeeWorkEligibility: bump, assignEmployeeOperationalScope: bump } };
  const result = await seedPersonaAuthorityDimensions(deps, { tenantId: "t", principalId: "p" }, { apply: false });
  assert.equal(called, 0);
  assert.equal(result.applied, false);
  assert.equal(result.summary.planned, planPersonaAuthorityDimensions().length);
});

test("apply is idempotent: a second run over an already-seeded world assigns nothing", async () => {
  const state = new Set();
  const deps = {
    commands: {
      async createJobRole(_d, _a, input) {
        const handle = `jr:${input.jobRoleId}`;
        const seen = state.has(handle);
        state.add(handle);
        return { outcome: seen ? "NO_CHANGE" : "CREATED" };
      },
      async assignEmployeeJobRole(_d, _a, input) {
        const handle = `ejr:${input.employeeId}:${input.jobRoleId}`;
        const seen = state.has(handle);
        state.add(handle);
        return { outcome: seen ? "NO_CHANGE" : "ASSIGNED" };
      },
      async assignEmployeeWorkEligibility(_d, _a, input) {
        const handle = `we:${input.employeeId}:${input.qualificationCode}`;
        const seen = state.has(handle);
        state.add(handle);
        return { outcome: seen ? "NO_CHANGE" : "ASSIGNED" };
      },
      async assignEmployeeOperationalScope(_d, _a, input) {
        const handle = `os:${input.employeeId}:${input.scopeType}:${input.scopeId}`;
        const seen = state.has(handle);
        state.add(handle);
        return { outcome: seen ? "NO_CHANGE" : "ASSIGNED" };
      },
    },
  };
  const actor = { tenantId: "t", principalId: "p" };
  const first = await seedPersonaAuthorityDimensions(deps, actor, { apply: true });
  assert.equal(first.summary.jobRoleCatalog.created, SAMPLE_COMPANY.jobRoles.length);
  assert.equal(first.summary.jobRoles.assigned, SAMPLE_COMPANY.employees.length);
  assert.equal(first.summary.workEligibility.assigned, MANIFEST.workEligibility.length);
  assert.equal(first.summary.operationalScopes.assigned, MANIFEST.operationalScopes.length);
  assert.equal(first.summary.workEligibility.unchanged, 0);

  const second = await seedPersonaAuthorityDimensions(deps, actor, { apply: true });
  assert.equal(second.summary.jobRoleCatalog.created, 0);
  assert.equal(second.summary.jobRoles.assigned, 0);
  assert.equal(second.summary.workEligibility.assigned, 0);
  assert.equal(second.summary.operationalScopes.assigned, 0);
  assert.equal(second.summary.jobRoleCatalog.unchanged, SAMPLE_COMPANY.jobRoles.length);
  assert.equal(second.summary.jobRoles.unchanged, SAMPLE_COMPANY.employees.length);
  assert.equal(second.summary.workEligibility.unchanged, MANIFEST.workEligibility.length);
  assert.equal(second.summary.operationalScopes.unchanged, MANIFEST.operationalScopes.length);
});

test("this phase only ever CREATES a catalog entry or ASSIGNS -- an END outcome is a bug and refuses", async () => {
  const ok = async () => ({ outcome: "ASSIGNED" });
  const deps = {
    commands: {
      createJobRole: async () => ({ outcome: "CREATED" }),
      assignEmployeeJobRole: ok,
      assignEmployeeWorkEligibility: async () => ({ outcome: "ENDED" }),
      assignEmployeeOperationalScope: ok,
    },
  };
  await assert.rejects(
    seedPersonaAuthorityDimensions(deps, { tenantId: "t", principalId: "p" }, { apply: true }),
    /UNEXPECTED_OUTCOME/,
  );
});

test("the module never reaches for a database, a Firebase module or a raw INSERT", () => {
  const source = readFileSync(MODULE_PATH, "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [/require\(["']pg["']\)/, /firebase/i, /INSERT\s+INTO/i, /\bpool\b/, /\bclient\.query\b/]) {
    assert.ok(!forbidden.test(code), `forbidden construct reached the module: ${forbidden}`);
  }
});

// ════════════════════ (9) THE PROVISIONING CONTRACT ════════════════════

test("(9) the provisioning contract answers every requirement, and invents no second authentication", () => {
  const c = MANIFEST.provisioningContract;
  for (const field of ["nonprodOnly", "obviouslySynthetic", "repeatable", "safeReset",
    "credentialsOutsideSourceControl", "noProductionLeakage", "noFirebaseBusinessAuthority"]) {
    assert.ok(typeof c[field] === "string" && c[field].length > 40, `provisioningContract.${field}`);
  }
  assert.match(c.credentialsOutsideSourceControl, /sandbox-credentials\.local\.json/);
  assert.match(c.credentialsOutsideSourceControl, /gitignored/);
  // No credential, secret, password or token value appears anywhere in the manifest.
  const text = JSON.stringify(MANIFEST);
  for (const forbidden of [/"password"\s*:/i, /"secret"\s*:/i, /"token"\s*:/i, /postgres(ql)?:\/\//i]) {
    assert.ok(!forbidden.test(text), `a credential-shaped value reached the manifest: ${forbidden}`);
  }
});

test("the measured identity architecture is what the deployed runtime actually resolves", () => {
  const { FIREBASE_IDENTITY_PROVIDER } = require("../lib/adminPolicy/principalContext.js");
  assert.equal(FIREBASE_IDENTITY_PROVIDER, "firebase");
  assert.equal(MANIFEST.identityArchitecture.observedIdentityProviders.firebase.length > 0, true);
  assert.equal(SAMPLE_COMPANY.company.runtimeIdentityProvider, FIREBASE_IDENTITY_PROVIDER);
  assert.equal(MANIFEST.identityArchitecture.nonFirebaseLoginPath.startsWith("NONE EXISTS"), true);
  // The non-authenticating fixture provider is named identically in both manifests.
  assert.equal(SAMPLE_COMPANY.company.syntheticIdentityProvider, "eos-synthetic-nonprod");
  assert.ok("eos-synthetic-nonprod" in MANIFEST.identityArchitecture.observedIdentityProviders);
});

test("the administering authority is MEASURED from the compiled catalog, not grepped", () => {
  // A first pass grepped functions/src/access for these literals, found only the permission-catalog
  // declarations, and concluded no Role held them. ADMIN_ROLE composes its list programmatically and
  // OWNER_ROLE spreads it, so the grep was wrong. This test is the measurement that replaced it.
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  for (const capability of [EMPLOYEE_WORK_ELIGIBILITY_WRITE, EMPLOYEE_OPERATIONAL_SCOPE_WRITE]) {
    const holders = Object.values(roles).filter((r) => (r.permissions ?? []).includes(capability)).map((r) => r.id).sort();
    assert.deepEqual(holders, ["admin", "owner"], capability);
  }
  // and the persona that administers this phase is the one holding `admin` -- which, since the Owner ruled
  // Owner and Administrator apart, is the ADMINISTRATOR persona and no longer the Owner / Executive.
  assert.ok(MANIFEST.personas.administrator.securityRoles.includes("admin"));
  assert.ok(!MANIFEST.personas["owner-executive"].securityRoles.includes("admin"));
  const item = MANIFEST.prerequisites.find((p) => p.code === "ADMINISTERING_CAPABILITIES_REQUIRED");
  assert.equal(item.blocks, "NOTHING");
  assert.match(item.measured, /admin.*owner/);
});

test("the catalog-vs-grants divergence on reorder.request.read is declared, not assumed away", () => {
  // The migration INSERTed role_capabilities rows for a key the TS catalog never declares. A
  // verifier reading the catalog and one reading the database disagree, and every expectation here
  // is written against the database. Declaring it is what stops the next reader calling it a bug.
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const holders = Object.values(roles).filter((r) => (r.permissions ?? []).includes("reorder.request.read"));
  assert.equal(holders.length, 0, "the catalog now declares reorder.request.read; the divergence note is stale");
  assert.ok(roles.technician.permissions.includes("reorder.request.read.own"));
  const item = MANIFEST.prerequisites.find((p) => p.code === "REORDER_REQUEST_READ_IS_GRANTED_BUT_NOT_DECLARED");
  assert.match(item.measured, /DIVERGENCE/);
});

test("the withheld technician Purchase Order cells are still withheld, and the expectation says so", () => {
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  for (const capability of ["reorder.purchaseOrder.read", "reorder.purchaseOrder.create"]) {
    assert.ok(!(roles.partsAssociate.permissions ?? []).includes(capability), `partsAssociate now holds ${capability}`);
  }
  // technician DECLARES them in the Role catalog, under an operationalRoleActive condition, and the
  // migration deliberately did not grant the plain capability. Both halves must stay true.
  assert.ok(roles.technician.permissions.includes("reorder.purchaseOrder.create"));
  assert.ok(roles.technician.conditionsByPermission["reorder.purchaseOrder.create"].some((c) => c.kind === "operationalRoleActive"));
  const cx = MANIFEST.contextualExpectations.find((x) => x.id === "CX-10-PURCHASE-ORDER-CREATE-WITHHELD-FROM-TECHNICIAN");
  assert.equal(cx.expect.reason, "CAPABILITY_MISSING");
  assert.match(cx.becomesAllowedWhen, /WORK_ELIGIBILITY\(PARTS_OPERATIONS\)/);
});

test("the parts persona carries no legacy role coupling and is the declared replacement", () => {
  const parts = MANIFEST.personas["parts-associate"];
  assert.equal(parts.replaces, "emp-rudy-parts-associate (TEST_PERSONA)");
  assert.deepEqual(parts.securityRoles, ["partsAssociate", "inventoryReceivingClerk"]);
  assert.deepEqual(parts.workEligibility, ["PARTS_OPERATIONS"]);
  assert.deepEqual(parts.operationalScopes, [`REORDER_QUEUE:${MANIFEST.operatingCompanyKey}`]);
  assert.ok(!parts.securityRoles.includes("technician"), "the parts persona must never be given a Role named technician");
});
