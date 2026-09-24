// WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER -- the identity reconciliation, proved offline.
// No database, no Firebase, no emulator.
//
// ════════════════════ WHERE THE EVIDENCE COMES FROM ════════════════════
//
// The four certification-world holders are NOT typed into this file. They are DERIVED by running
// scripts/certificationWorld/data/workforce.mjs, which is the generator that produces them and
// therefore the authority on who they are -- so if that roster ever changes, this suite changes
// with it instead of asserting a stale copy.
//
// The fifth holder, `sbx-partsassoc`, has no generator: it was provisioned once into the sandbox
// and is recorded in docs/audits/sandbox-a7-personas-20260806/ (README: technician / PARTS_ASSOCIATE
// / linked / ACTIVE; provision.log: partsassoc@sandbox.invalid, uid sDtteBblHLRjVRIi9pywra0YunM2,
// "Account created (no password set)"). Those measured facts are transcribed below and labelled.
//
// GOVERNED_WORKFORCE is a transcription of a READ-ONLY nonprod SELECT taken 2026-09-23: seventeen
// employees, every one `... Fixture (SYNTHETIC)` at @sandbox.invalid, and ZERO rows in
// eos_workforce.employee_work_eligibility. It is a fixture here precisely so the suite is offline;
// the assertions below check its SHAPE, so a transcription that drifts from the schema fails.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { buildWorkforce } from "../scripts/certificationWorld/data/workforce.mjs";

const require = createRequire(import.meta.url);
const recon = require("../lib/eosWorkforce/migration/partsOperationsIdentityReconciliation.js");
const evidence = require("../lib/eosWorkforce/migration/legacyWorkforceEvidence.js");
const { parseEmployeeProfileSnapshot } = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
const { LEGACY_QUALIFICATION_CANDIDATES, WORK_ELIGIBILITY_CODES } =
  require("../lib/eosWorkforce/workEligibilityVocabulary.js");
const { WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER, WITHHELD_PENDING_ELIGIBILITY_EVIDENCE } =
  require("../lib/adminPolicy/migration/credEquivalence.js");

const TENANT = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";

/** The four certification-world holders, derived from the generator that creates them. */
const certificationHolders = () => buildWorkforce()
  .filter((e) => e.operationalRoles.includes("PARTS_ASSOCIATE"))
  .map((e) => ({
    legacyEmployeeId: e.employeeId,
    sourceWorld: "platform-certification",
    dataProvenance: e.dataProvenance,
    externalSubject: null,
    employeeNumber: e.certEmployeeNumber,
    workEmail: e.certEmail,
    active: e.active,
    employmentStatus: e.employmentStatus,
  }));

/** MEASURED, docs/audits/sandbox-a7-personas-20260806/{README.md,provision.log}. */
const SANDBOX_HOLDER = Object.freeze({
  legacyEmployeeId: "sbx-partsassoc",
  sourceWorld: "eos-platform-sandbox",
  dataProvenance: null,
  externalSubject: "sDtteBblHLRjVRIi9pywra0YunM2",
  employeeNumber: null,
  workEmail: "partsassoc@sandbox.invalid",
  active: true,
  employmentStatus: "ACTIVE",
});

/**
 * MEASURED FROM GOVERNANCE RECORD, not from the project: docs/DECISIONS.md #11 (2026-07-11, six
 * production test personas, Owner-verified PASS) and the AUTH-PR-4 readiness package's persona
 * table -- securityRole dispatcher, operationalRoles [PARTS_ASSOCIATE], Auth-linked.
 *
 * Its uid and address are NULL here because they are genuinely absent from this repository, by the
 * Owner's standing instruction that DECISIONS #11 record no UIDs or emails. That absence is the
 * finding: the two signals that could bridge this identity were never written down, and production
 * is not readable from this workstation, so no automated reconciliation can resolve it.
 *
 * It is NOT a reserved-domain fixture and NOT generator output, so it must not be classified as one.
 */
const PRODUCTION_PERSONA_HOLDER = Object.freeze({
  legacyEmployeeId: "emp-rudy-parts-associate",
  sourceWorld: "taylor-parts",
  dataProvenance: null,
  externalSubject: null,
  employeeNumber: null,
  workEmail: null,
  active: true,
  employmentStatus: "ACTIVE",
});

/** The five-holder NONPROD census that `legacyHolders: 5` names. */
const nonprodHolders = () => [...certificationHolders(), SANDBOX_HOLDER];
/** Every holder known anywhere, which is what the reconciliation must actually cover. */
const legacyHolders = () => [...nonprodHolders(), PRODUCTION_PERSONA_HOLDER];

/** MEASURED nonprod, 2026-09-23, READ-ONLY. All seventeen governed Employees are synthetic. */
const GOVERNED_EMPLOYEES = Object.freeze([
  ["synthetic-np-emp-owner-executive", "SC-0001", "avery.fixture@sandbox.invalid"],
  ["synthetic-np-emp-general-manager", "SC-0002", "bailey.fixture@sandbox.invalid"],
  ["synthetic-np-emp-office-manager", "SC-0003", "casey.fixture@sandbox.invalid"],
  ["synthetic-np-emp-service-manager", "SC-0004", "devon.fixture@sandbox.invalid"],
  ["synthetic-np-emp-dispatcher", "SC-0005", "emerson.fixture@sandbox.invalid"],
  ["synthetic-np-emp-service-technician-a", "SC-0006", "finley.fixture@sandbox.invalid"],
  ["synthetic-np-emp-service-technician-b", "SC-0007", "gray.fixture@sandbox.invalid"],
  ["synthetic-np-emp-retail-sales-a", "SC-0008", "harper.fixture@sandbox.invalid"],
  ["synthetic-np-emp-retail-sales-b", "SC-0009", "indigo.fixture@sandbox.invalid"],
  ["synthetic-np-emp-national-accounts-sales", "SC-0010", "jules.fixture@sandbox.invalid"],
  ["synthetic-np-emp-parts-manager", "SC-0011", "kai.fixture@sandbox.invalid"],
  ["synthetic-np-emp-parts-associate", "SC-0012", "logan.fixture@sandbox.invalid"],
  ["synthetic-np-emp-warehouse-manager", "SC-0013", "morgan.fixture@sandbox.invalid"],
  ["synthetic-np-emp-warehouse-associate", "SC-0014", "noor.fixture@sandbox.invalid"],
  ["synthetic-np-emp-contract-technician", "SC-0015", "oakley.fixture@sandbox.invalid"],
  ["synthetic-np-emp-technician-on-leave", "SC-0016", "peyton.fixture@sandbox.invalid"],
  ["synthetic-np-emp-records-clerk", "SC-0017", "quinn.fixture@sandbox.invalid"],
]);

/** MEASURED: external subjects of the fourteen linked sandbox-persona Principals. */
const GOVERNED_SUBJECTS = Object.freeze([
  ["xiyAcX4UQEQRRqbMRrIXv3LwWVi2", "synthetic-np-emp-general-manager"],
  ["Trvw2vp0yhd2SnXOfZvDUAcv6Aj2", "synthetic-np-emp-office-manager"],
  ["oQPfzG2AUgWOo8Tm0LJvurj8dXi2", "synthetic-np-emp-service-manager"],
  ["NReyNyXVMdVkv75vpmxWuvGUeOm1", "synthetic-np-emp-dispatcher"],
  ["i4EYSBGPXPM8lweuhI5a5y2TRgH3", "synthetic-np-emp-service-technician-a"],
  ["l2AKXJ44hzUEWpYfEpiQeg208CF2", "synthetic-np-emp-service-technician-b"],
  ["4OVJwVRisyOlgBQDkjA75rs7djm2", "synthetic-np-emp-retail-sales-a"],
  ["jUzI7OPsdIbJ0WGa2YlYvGUXYKW2", "synthetic-np-emp-retail-sales-b"],
  ["zpfYS0PKUJOwVbskY1WjUreWqg72", "synthetic-np-emp-national-accounts-sales"],
  ["p9zXxj5SJiOAwbSoFcKriaQ8NGt1", "synthetic-np-emp-parts-manager"],
  ["Ap6MRSs1gKW5lQtN4lTZOaecHgu1", "synthetic-np-emp-parts-associate"],
  ["0KBdhU9Z8Yc4aTQqXHODEP1jeHf1", "synthetic-np-emp-warehouse-manager"],
  ["cgVnRUMA2Sc7WxHl1lgTmbQAhwG2", "synthetic-np-emp-warehouse-associate"],
  ["26pkGMjIBJUzDAJYZTXosfLVw933", "synthetic-np-emp-contract-technician"],
]);

const governedView = (over = {}) => ({
  tenantId: TENANT,
  employees: new Set(GOVERNED_EMPLOYEES.map(([id]) => id)),
  linkedEmployeeIds: new Set(GOVERNED_SUBJECTS.map(([, id]) => id)),
  employeeByExternalSubject: new Map(GOVERNED_SUBJECTS),
  employeeByNumber: new Map(GOVERNED_EMPLOYEES.map(([id, num]) => [num, id])),
  employeeByWorkEmail: new Map(GOVERNED_EMPLOYEES.map(([id, , mail]) => [mail, id])),
  // MEASURED: eos_workforce.employee_work_eligibility returned 0 rows.
  currentQualifications: new Set(),
  ...over,
});

// ════════════════════ THE LEGACY POPULATION ════════════════════

test("the legacy holder census is five, and four of them come from the generator", () => {
  const cert = certificationHolders();
  assert.equal(cert.length, 4);
  assert.deepEqual(cert.map((h) => h.legacyEmployeeId),
    ["cw-emp-025", "cw-emp-026", "cw-emp-027", "cw-emp-028"]);
  // Provenance and address are the two independent fixture proofs, and the generator stamps both.
  for (const h of cert) {
    assert.match(h.dataProvenance, /^SYNTHETIC/, `${h.legacyEmployeeId} lost its provenance stamp`);
    assert.match(h.workEmail, /@certification\.invalid$/);
  }
  assert.equal(nonprodHolders().length, WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.legacyHolders);
  // The nonprod census is FIVE; the known population is SIX. Keeping the two numbers apart is the
  // point: the count of five was never wrong, it was scoped, and the sixth holder lives in the one
  // project this workstation may not read.
  assert.equal(WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.productionTestPersonaHolders, 1);
  assert.equal(legacyHolders().length,
    WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.legacyHolders
    + WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.productionTestPersonaHolders);
});

test("the production test persona is UNMAPPED, and is not laundered into a fixture", () => {
  const holder = recon.reconcileHolder(PRODUCTION_PERSONA_HOLDER, governedView());
  // It carries no reserved-domain address and no generator stamp, so the fixture short-circuit must
  // NOT fire. Calling it a fixture would be the convenient answer and an unevidenced one.
  assert.equal(recon.isNonBusinessFixture(PRODUCTION_PERSONA_HOLDER), false);
  assert.equal(holder.classification, "NO_TARGET_EMPLOYEE");
  assert.equal(holder.governedEmployeeId, null);
  assert.deepEqual(holder.matchedSignals, []);
  // Unmappable, not merely unmapped: the resolving signals are absent from the evidence itself.
  assert.equal(PRODUCTION_PERSONA_HOLDER.externalSubject, null);
  assert.equal(PRODUCTION_PERSONA_HOLDER.workEmail, null);
});

test("the governed workforce this tenant actually has is itself entirely synthetic", () => {
  // Not a rhetorical point. There is no real Employee in nonprod for ANY legacy identity to match,
  // so a match found here would be a collision between two fixture populations, never a discovery.
  assert.equal(GOVERNED_EMPLOYEES.length, 17);
  for (const [id, num, mail] of GOVERNED_EMPLOYEES) {
    assert.match(id, /^synthetic-np-emp-/);
    assert.match(num, /^SC-\d{4}$/);
    assert.match(mail, /@sandbox\.invalid$/);
  }
});

// ════════════════════ THE RECONCILIATION ════════════════════

test("not one known holder reconciles to a governed Employee, and nothing is planned", () => {
  const report = recon.reconcilePartsOperationsHolders(legacyHolders(), governedView());

  assert.equal(report.qualification, "PARTS_OPERATIONS");
  assert.equal(report.legacyValue, "PARTS_ASSOCIATE");
  assert.equal(report.holders.length, 6);
  assert.deepEqual(report.counts, {
    EXACT_MATCH: 0, AMBIGUOUS: 0, NO_TARGET_EMPLOYEE: 1, NONBUSINESS_FIXTURE: 5, INACTIVE_LEGACY_IDENTITY: 0,
  });
  assert.deepEqual(report.plan, [], "no eligibility may be proposed without a proven identity");
  assert.equal(report.reconciled, false);
  assert.equal(report.applied, false);
  assert.equal(report.unmapped.length, 6);
  // No holder carries a target, not even a tentative one.
  for (const h of report.holders) assert.equal(h.governedEmployeeId, null, h.legacyEmployeeId);
  assert.deepEqual(report.holders.map((h) => h.legacyEmployeeId),
    ["cw-emp-025", "cw-emp-026", "cw-emp-027", "cw-emp-028", "emp-rudy-parts-associate", "sbx-partsassoc"]);
  // The five nonprod holders, specifically, are all fixtures.
  const nonprod = recon.reconcilePartsOperationsHolders(nonprodHolders(), governedView());
  assert.equal(nonprod.counts.NONBUSINESS_FIXTURE, 5);
  assert.equal(nonprod.holders.length, 5);
});

test("the measurement and the published blocker agree, digit for digit", () => {
  const report = recon.reconcilePartsOperationsHolders(legacyHolders(), governedView());
  assert.deepEqual({ ...WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.holderClassifications }, report.counts);
  assert.equal(WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.targetAssignments, report.plan.length);
  assert.equal(WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.qualification, report.qualification);
  // The blocker stays OPEN and the Purchase Order cells stay withheld. Both are consequences of the
  // measurement above, so a future reconciliation that succeeds will fail these lines loudly.
  assert.equal(report.reconciled, false);
  assert.deepEqual(Object.keys(WITHHELD_PENDING_ELIGIBILITY_EVIDENCE).sort(),
    ["purchaseOrder.C", "purchaseOrder.R"]);
});

test("the Parts Associate TITLE is not an identity", () => {
  // eos_workforce.employees really does contain a "Parts Associate". It is not any legacy holder,
  // and the reconciliation must refuse it even though it is the single most tempting row in the
  // table. Job Role, job title and Security Role are not admissible signals at all.
  const report = recon.reconcilePartsOperationsHolders(legacyHolders(), governedView());
  const proposed = report.plan.map((p) => p.input.employeeId);
  assert.equal(proposed.includes("synthetic-np-emp-parts-associate"), false);
  for (const h of report.holders) {
    assert.deepEqual(h.matchedSignals, [], `${h.legacyEmployeeId} matched something it should not have`);
  }
  for (const banned of ["jobTitle", "jobRole", "securityRole", "operationalRoles", "displayName"]) {
    assert.ok(recon.RULED_OUT_SIGNALS.includes(banned), `${banned} must be named as inadmissible`);
  }
  // sbx-partsassoc's own Firebase uid is not a governed Principal's subject either -- the one
  // signal that could have bridged the two worlds simply is not there.
  assert.equal(governedView().employeeByExternalSubject.has(SANDBOX_HOLDER.externalSubject), false);
});

// ════════════════════ THE CLASSIFIER ITSELF ════════════════════
//
// Positive controls. A reconciliation that can only ever answer "no" proves nothing, so each
// classification is exercised on a holder built to earn it.

test("an admissible signal on a real identity DOES produce an exact match", () => {
  const real = {
    legacyEmployeeId: "legacy-7", sourceWorld: "legacy", dataProvenance: null,
    externalSubject: null, employeeNumber: "SC-0011", workEmail: "kai.parts@taylorparts.com",
    active: true, employmentStatus: "ACTIVE",
  };
  const report = recon.reconcilePartsOperationsHolders([real], governedView());
  assert.deepEqual(report.holders[0].classification, "EXACT_MATCH");
  assert.equal(report.holders[0].governedEmployeeId, "synthetic-np-emp-parts-manager");
  assert.deepEqual(report.holders[0].matchedSignals.map((m) => m.signal), ["EMPLOYEE_NUMBER"]);
  assert.equal(report.reconciled, true);
  assert.deepEqual(report.plan.map((p) => p.input),
    [{ employeeId: "synthetic-np-emp-parts-manager", qualificationCode: "PARTS_OPERATIONS",
      reason: "legacy PARTS_ASSOCIATE gate preservation (identity proven by an admissible immutable signal)" }]);
});

test("signals that disagree are AMBIGUOUS, and no side is preferred", () => {
  const conflicted = {
    legacyEmployeeId: "legacy-8", sourceWorld: "legacy", dataProvenance: null,
    externalSubject: null, employeeNumber: "SC-0011", workEmail: "noor@taylorparts.com",
    active: true, employmentStatus: "ACTIVE",
  };
  const view = governedView({
    employeeByWorkEmail: new Map([["noor@taylorparts.com", "synthetic-np-emp-warehouse-associate"]]),
  });
  const holder = recon.reconcilePartsOperationsHolders([conflicted], view).holders[0];
  assert.equal(holder.classification, "AMBIGUOUS");
  assert.equal(holder.governedEmployeeId, null, "an ambiguous holder must carry no target");
  assert.deepEqual(holder.matchedSignals.map((m) => m.signal), ["EMPLOYEE_NUMBER", "WORK_EMAIL"]);
});

test("a real identity with no governed counterpart is NO_TARGET_EMPLOYEE, not a fixture", () => {
  const orphan = {
    legacyEmployeeId: "legacy-9", sourceWorld: "legacy", dataProvenance: null,
    externalSubject: "uid-not-in-postgres", employeeNumber: "SC-9999",
    workEmail: "someone@taylorparts.com", active: true, employmentStatus: "ACTIVE",
  };
  const holder = recon.reconcilePartsOperationsHolders([orphan], governedView()).holders[0];
  assert.equal(holder.classification, "NO_TARGET_EMPLOYEE");
  assert.equal(holder.governedEmployeeId, null);
});

test("an inactive legacy identity carries no current eligibility to preserve", () => {
  const separated = {
    legacyEmployeeId: "legacy-10", sourceWorld: "legacy", dataProvenance: null,
    externalSubject: null, employeeNumber: "SC-0011", workEmail: "gone@taylorparts.com",
    active: false, employmentStatus: "TERMINATED",
  };
  const holder = recon.reconcilePartsOperationsHolders([separated], governedView()).holders[0];
  assert.equal(holder.classification, "INACTIVE_LEGACY_IDENTITY");
  assert.equal(holder.governedEmployeeId, null);
});

test("a fixture is refused even when an admissible signal would have matched it", () => {
  // The short-circuit is the whole safety property: a generated world reuses numbers on purpose.
  const collidingFixture = {
    legacyEmployeeId: "cw-emp-999", sourceWorld: "platform-certification",
    dataProvenance: "SYNTHETIC_CERTIFICATION_FACT", externalSubject: "Ap6MRSs1gKW5lQtN4lTZOaecHgu1",
    employeeNumber: "SC-0012", workEmail: "logan.fixture@sandbox.invalid",
    active: true, employmentStatus: "ACTIVE",
  };
  const report = recon.reconcilePartsOperationsHolders([collidingFixture], governedView());
  assert.equal(report.holders[0].classification, "NONBUSINESS_FIXTURE");
  assert.deepEqual(report.holders[0].matchedSignals, []);
  assert.deepEqual(report.plan, [], "a fixture must never reach the plan, whatever it matches");
  assert.equal(recon.isNonBusinessFixture(collidingFixture), true);
});

test("every reserved domain is proof of a fixture, and a routable one is not", () => {
  const at = (workEmail) => recon.isNonBusinessFixture({
    legacyEmployeeId: "x", sourceWorld: "legacy", dataProvenance: null, workEmail,
  });
  for (const tld of recon.RESERVED_EMAIL_TLDS) assert.equal(at(`a@b.${tld}`), true, tld);
  assert.equal(at("a@taylorparts.com"), false, "a routable domain is not evidence of a fixture");
  assert.equal(at(null), false, "an absent address is not evidence of anything");
  assert.equal(at("not-an-address"), false, "a malformed value proves nothing either way");
  // KNOWN AND DELIBERATE LIMIT: this tests the TLD only, so the reserved SECOND-level domains of
  // RFC 2606 (example.com/.net/.org) are not caught. That is the safe direction to be wrong in --
  // it can only ever fail to classify something as a fixture, and a missed fixture still has to
  // clear an admissible identity signal before it can reach the plan.
  assert.equal(at("a@example.com"), false);
});

// ════════════════════ THE VOCABULARY CENSUS AGREES ════════════════════

test("the census now reports a settled target code with no resolving holder", () => {
  // Before the candidate map was corrected, PARTS_ASSOCIATE came back AMBIGUOUS_REMEDIATION with a
  // NULL code -- which read as "nobody has decided what this becomes". It has been decided.
  assert.deepEqual(Object.keys(LEGACY_QUALIFICATION_CANDIDATES).sort(),
    ["PARTS_ASSOCIATE", "TECHNICIAN", "WAREHOUSE_ASSOCIATE"]);
  assert.equal(LEGACY_QUALIFICATION_CANDIDATES.PARTS_ASSOCIATE, "PARTS_OPERATIONS");
  assert.ok(WORK_ELIGIBILITY_CODES.includes("PARTS_OPERATIONS"));

  const census = evidence.censusLegacyWorkforceEvidence(
    parseEmployeeProfileSnapshot({
      format: "EOS_EMPLOYEE_PROFILE_SNAPSHOT", version: 1,
      source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-23T00:00:00.000Z" },
      employees: legacyHolders().map((h) => ({ id: h.legacyEmployeeId, data: { operationalRoles: ["PARTS_ASSOCIATE"] } })),
    }),
    {
      tenantId: TENANT,
      employees: new Set(GOVERNED_EMPLOYEES.map(([id]) => id)),
      warehouses: new Map(),
      currentQualifications: new Set(),
      currentScopes: new Set(),
    });

  const findings = census.qualificationFindings.filter((f) => f.legacyValue === "PARTS_ASSOCIATE");
  assert.equal(findings.length, 6);
  for (const f of findings) {
    // The code is now NAMED even though the holder does not resolve: "we know what it becomes, and
    // we cannot prove who becomes it" is a different and more useful finding than "unmapped".
    assert.equal(f.disposition, "AMBIGUOUS_REMEDIATION", f.employeeId);
    assert.equal(f.qualificationCode, "PARTS_OPERATIONS", f.employeeId);
  }
  assert.deepEqual(census.plan.qualifications, [], "no holder resolves, so nothing is proposed");
  assert.equal(census.applied, false);
});
