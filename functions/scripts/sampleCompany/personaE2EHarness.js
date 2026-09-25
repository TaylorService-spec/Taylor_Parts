// PERSONA E2E HARNESS -- the acceptance-scenario layer of the Sample Company persona catalog, and the
// PREFLIGHT that decides which governed authority writes a given nonprod database can actually accept.
//
// ════════════════════ WHY A PREFLIGHT EXISTS AT ALL ════════════════════
//
// personaAuthorityDimensions.js plans 13 governed writes. Six of them cannot be applied to the nonprod
// database as it stands, for THREE DIFFERENT reasons, and the difference matters:
//
//   the administering Principal does not hold a LIVE grant for the command's capability
//   the scope names a warehouse that does not exist in this tenant
//   the scope names an operating company KEY with no ACTIVE tenant_operating_company_keys binding
//
// Calling the command anyway produces, respectively, a FORBIDDEN, a foreign-key violation and a
// plpgsql RAISE from `eos_workforce.operational_scope_target_exists`. All three are correct refusals
// and all three are useless to an operator, because a seed phase that aborts on step 4 leaves steps
// 5..13 unattempted and unexplained. The preflight asks the database the SAME questions the guards
// ask, BEFORE the transaction, and partitions the plan. Nothing is weakened: a step the preflight
// clears is still checked again by the command itself, and a step it blocks is never attempted.
//
// "Fail closed, then continue" is the whole design. A blocked step is reported by CODE, with the exact
// missing fact named, and the remaining steps still run.
//
// ════════════════════ WHAT THIS FILE NEVER DOES ════════════════════
//
//   never writes anything -- it is pure, takes measured facts as data, and touches no driver
//   never grants a capability, never creates a Role, never binds an operating company key
//   never substitutes a different Employee, warehouse or company key for one that is missing
//   never turns a test-persona requirement into a business permission: a scenario that needs a
//     capability nobody holds is declared BLOCKED, never made to pass by granting it
"use strict";

const PERSONA_MANIFEST = require("../fixtures/personaAuthorityDimensions.v1.json");
const SAMPLE_COMPANY = require("../fixtures/sampleCompany.v2.json");

/**
 * The scenario manifest is loaded LAZILY and on purpose. `preflightAuthorityPlan` is what the
 * operator seed path needs, and an operator run must not be able to fail because an acceptance
 * fixture it never reads is missing or malformed.
 */
const e2eManifest = () => require("../fixtures/personaE2EScenarios.v1.json");

class PersonaE2EError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PersonaE2EError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new PersonaE2EError(code, message);
};

/**
 * Why a planned governed write cannot be attempted against THIS database right now.
 *
 * Each code names a fact that is missing, never a permission that should be added. Removing a block
 * is always somebody else's governed change -- a grant reconciliation, a warehouse seed, an operating
 * company key binding -- and this module deliberately performs none of them.
 */
const PREFLIGHT_BLOCK_CODES = Object.freeze([
  "CAPABILITY_NOT_LIVE",
  "EMPLOYEE_NOT_IN_TENANT",
  "WAREHOUSE_NOT_IN_TENANT",
  "OPERATING_COMPANY_KEY_NOT_ACTIVE",
]);

/** The scenario phases a persona acceptance run walks, in order. */
const E2E_PHASES = Object.freeze([
  "LOGIN", "LANDING", "NAVIGATION", "RECORD_VISIBILITY", "ALLOWED_ACTION", "DENIED_ACTION",
]);

/** What a scenario's readiness means. `BLOCKED_PENDING_C5` is never merged into plain BLOCKED. */
const E2E_READINESS = Object.freeze(["READY", "PARTIAL", "BLOCKED", "BLOCKED_PENDING_C5"]);

/** Business-process availability. Same vocabulary as readiness, plus the not-seeded case. */
const PROCESS_AVAILABILITY = Object.freeze([
  "READY", "PARTIAL", "BLOCKED", "BLOCKED_PENDING_C5", "DECLARED_NOT_SEEDED",
]);

/**
 * Partition a governed authority plan into what this database can accept and what it cannot.
 *
 * `live` carries MEASURED facts only -- the administering Principal's live capability keys, the
 * Employee ids in the tenant, the warehouse ids in the tenant and the ACTIVE operating company keys.
 * It is injected rather than read, so this function is provable without a connection and so the
 * caller, not this module, decides what "live" means.
 */
function preflightAuthorityPlan(plan, live) {
  if (!Array.isArray(plan)) refuse("PLAN_INVALID", "a plan is an array of governed command steps");
  for (const field of ["capabilities", "employeeIds", "warehouseIds", "activeOperatingCompanyKeys"]) {
    if (!(live?.[field] instanceof Set)) refuse("LIVE_FACTS_INVALID", `live.${field} must be a Set of measured values`);
  }
  const applicable = [];
  const blocked = [];
  const block = (step, code, detail) => {
    if (!PREFLIGHT_BLOCK_CODES.includes(code)) refuse("BLOCK_CODE_UNKNOWN", `${code} is not a preflight block code`);
    blocked.push(Object.freeze({ step, code, detail }));
  };
  for (const step of plan) {
    if (typeof step?.command !== "string" || typeof step?.requiresCapability !== "string" || typeof step?.input !== "object") {
      refuse("PLAN_INVALID", "every step names a command, the capability it requires and its input");
    }
    // CAPABILITY FIRST, exactly as the command itself checks it. A step whose capability is not live
    // is blocked before anything about the Employee or the target is considered, so the refusal never
    // reports a second, incidental gap the operator cannot act on yet.
    if (!live.capabilities.has(step.requiresCapability)) {
      block(step, "CAPABILITY_NOT_LIVE", step.requiresCapability);
      continue;
    }
    // A CATALOG step names no Employee, because a Job Role catalog entry is a tenant fact rather than a
    // fact about a person. It is the ONLY step shape that may omit one, and it must name a governed
    // catalog id instead: a step that names neither is a malformed plan, not a passable one.
    if (!("employeeId" in step.input)) {
      if (typeof step.input.jobRoleId !== "string" || step.input.jobRoleId === "") {
        refuse("PLAN_INVALID", "a step that names no Employee must name a governed catalog id");
      }
      applicable.push(step);
      continue;
    }
    if (!live.employeeIds.has(step.input.employeeId)) {
      block(step, "EMPLOYEE_NOT_IN_TENANT", step.input.employeeId);
      continue;
    }
    if (step.input.scopeType === "WAREHOUSE" && !live.warehouseIds.has(step.input.scopeId)) {
      block(step, "WAREHOUSE_NOT_IN_TENANT", step.input.scopeId);
      continue;
    }
    if (step.input.scopeType === "REORDER_QUEUE" && !live.activeOperatingCompanyKeys.has(step.input.scopeId)) {
      block(step, "OPERATING_COMPANY_KEY_NOT_ACTIVE", step.input.scopeId);
      continue;
    }
    applicable.push(step);
  }
  return Object.freeze({
    applicable: Object.freeze(applicable),
    blocked: Object.freeze(blocked),
    counts: Object.freeze({ planned: plan.length, applicable: applicable.length, blocked: blocked.length }),
  });
}

/**
 * Validate the Lane Q scenario manifest against the persona catalog it layers onto.
 *
 * The rule this enforces above all others: a scenario may name only a persona the catalog declares,
 * and it may not claim READY for a business process the manifest's own coverage table calls blocked.
 * A green scenario over an unavailable domain is the exact failure mode an acceptance suite is for.
 */
function validateE2EManifest(manifest = e2eManifest(), personaManifest = PERSONA_MANIFEST, sampleCompany = SAMPLE_COMPANY) {
  if (manifest.manifest !== "PERSONA_E2E_SCENARIOS" || manifest.version !== 1) {
    refuse("MANIFEST_INVALID", "not the v1 persona E2E scenario manifest");
  }
  if (manifest.basis.manifest !== personaManifest.manifest || manifest.basis.version !== personaManifest.version) {
    refuse("MANIFEST_INVALID", "this manifest layers onto PERSONA_AUTHORITY_DIMENSIONS v1 and nothing else");
  }
  if (manifest.tenantKey !== sampleCompany.company.tenantKey || manifest.environment !== sampleCompany.company.environment) {
    refuse("MANIFEST_INVALID", "tenant and environment must be the Sample Company's own");
  }

  const personaKeys = new Set(Object.keys(personaManifest.personas));
  const loginPersonas = new Set(sampleCompany.principals.map((p) => p.employee));

  // ---- the authentication dependency must be RECORDED, not assumed away (Q1).
  const auth = manifest.authenticationDependency;
  if (!auth || auth.status !== "TRANSITIONAL_DEPENDENCY") {
    refuse("AUTH_DEPENDENCY_UNRECORDED", "the login/bootstrap identity dependency must be recorded explicitly");
  }
  if (auth.issuesBusinessAuthority !== false || auth.issuesEmployeeIdentity !== false) {
    refuse("AUTH_DEPENDENCY_OVERREACH", "the external identity provider issues login identity ONLY; business authority and Employee identity are EOS/PostgreSQL");
  }
  for (const field of ["provider", "project", "verifiedBy", "resolvesTo", "usedForOnly", "notUsedFor", "evidence"]) {
    if (auth[field] === undefined) refuse("AUTH_DEPENDENCY_INCOMPLETE", `authenticationDependency.${field} is required`);
  }
  if (!Array.isArray(auth.evidence) || auth.evidence.length === 0) {
    refuse("AUTH_DEPENDENCY_INCOMPLETE", "the dependency is recorded with file evidence, never asserted");
  }

  // ---- personas: every requested canonical role is dispositioned exactly once.
  const dispositions = new Set(["PROVISIONABLE", "MERGED", "BLOCKED"]);
  const seenRequested = new Set();
  for (const row of manifest.canonicalPersonas) {
    if (seenRequested.has(row.requestedRole)) refuse("PERSONA_DUPLICATE", `${row.requestedRole} is dispositioned twice`);
    seenRequested.add(row.requestedRole);
    if (!dispositions.has(row.disposition)) refuse("PERSONA_DISPOSITION_UNKNOWN", `${row.requestedRole}: ${row.disposition}`);
    if (row.disposition === "MERGED") {
      if (!personaKeys.has(row.mergedInto)) refuse("PERSONA_UNKNOWN", `${row.requestedRole} merges into ${row.mergedInto}, which the catalog does not declare`);
      // A MERGE IS A CLAIM ABOUT THE SYSTEM, and it has to survive being questioned. Saying WHY is
      // the whole difference between "these two are the same" and "we only built one".
      if (typeof row.mergeEvidence !== "string" || row.mergeEvidence.trim() === "") {
        refuse("MERGE_UNJUSTIFIED", `${row.requestedRole}: a merge states the measured evidence that the system experience is equivalent`);
      }
      if (row.whatWouldSeparateThem === undefined) {
        refuse("MERGE_UNJUSTIFIED", `${row.requestedRole}: a merge states what would make them separate personas again`);
      }
    }
    if (row.disposition === "PROVISIONABLE" && !personaKeys.has(row.persona)) {
      refuse("PERSONA_UNKNOWN", `${row.requestedRole} names persona ${row.persona}, which the catalog does not declare`);
    }
    if (row.disposition === "PROVISIONABLE" && !loginPersonas.has(row.persona)) {
      refuse("PERSONA_CANNOT_LOG_IN", `${row.requestedRole} names persona ${row.persona}, which has no Principal and therefore cannot be a login persona`);
    }
    if (row.disposition === "BLOCKED" && (typeof row.blockedBy !== "string" || row.blockedBy.trim() === "")) {
      refuse("PERSONA_BLOCK_UNNAMED", `${row.requestedRole}: a blocked persona names its blocker`);
    }
  }

  // ---- business process coverage (Q8)
  const seenDomains = new Set();
  for (const row of manifest.businessProcessCoverage) {
    if (seenDomains.has(row.domain)) refuse("DOMAIN_DUPLICATE", `${row.domain} is measured twice`);
    seenDomains.add(row.domain);
    if (!PROCESS_AVAILABILITY.includes(row.availability)) refuse("AVAILABILITY_UNKNOWN", `${row.domain}: ${row.availability}`);
    if (row.availability !== "READY" && (typeof row.blocker !== "string" || row.blocker.trim() === "")) {
      refuse("BLOCKER_UNNAMED", `${row.domain}: anything short of READY names the EXACT blocker`);
    }
    if (typeof row.measuredEvidence !== "string" || row.measuredEvidence.trim() === "") {
      refuse("EVIDENCE_REQUIRED", `${row.domain}: availability is measured, never inherited`);
    }
  }
  for (const domain of manifest.requiredDomains) {
    if (!seenDomains.has(domain)) refuse("DOMAIN_MISSING", `${domain} is a required business process and is not measured`);
  }
  const coverage = new Map(manifest.businessProcessCoverage.map((r) => [r.domain, r]));

  // ---- scenarios (Q7)
  const seenScenarioIds = new Set();
  let readyScenarios = 0;
  let deniedActions = 0;
  const phasesCovered = new Set();
  for (const s of manifest.scenarios) {
    if (seenScenarioIds.has(s.id)) refuse("SCENARIO_DUPLICATE", `${s.id} is declared twice`);
    seenScenarioIds.add(s.id);
    if (!E2E_PHASES.includes(s.phase)) refuse("PHASE_UNKNOWN", `${s.id}: ${s.phase}`);
    if (!E2E_READINESS.includes(s.readiness)) refuse("READINESS_UNKNOWN", `${s.id}: ${s.readiness}`);
    if (!personaKeys.has(s.persona)) refuse("PERSONA_UNKNOWN", `${s.id} names persona ${s.persona}`);
    if (s.phase !== "LOGIN" && s.phase !== "LANDING" && !s.domain) {
      refuse("SCENARIO_INVALID", `${s.id}: a scenario beyond login/landing names the business process it exercises`);
    }
    if (s.domain && !coverage.has(s.domain)) refuse("DOMAIN_UNKNOWN", `${s.id} names domain ${s.domain}, which is not measured`);
    // THE RULE THIS WHOLE VALIDATOR EXISTS FOR. A scenario that expects to be ALLOWED cannot be
    // readier than the process it runs against; a green happy path over an unavailable domain is
    // worse than no test, because it is believed.
    //
    // A DENIAL is deliberately exempt, and the exemption is not a loophole: a scenario that asserts
    // "this domain refuses everyone, with THIS category" is runnable precisely BECAUSE the domain is
    // unavailable, and it is the only thing that tells a dead surface apart from a working guard.
    if (s.readiness === "READY" && s.expect.outcome === "ALLOWED" && s.domain
        && coverage.get(s.domain).availability !== "READY") {
      refuse("SCENARIO_OVERSTATES_AVAILABILITY",
        `${s.id} claims a READY happy path against ${s.domain}, which is ${coverage.get(s.domain).availability}`);
    }
    if (s.readiness !== "READY" && (typeof s.blockedBy !== "string" || s.blockedBy.trim() === "")) {
      refuse("SCENARIO_BLOCK_UNNAMED", `${s.id}: anything short of READY names its blocker`);
    }
    if (typeof s.expect !== "object" || s.expect === null) refuse("SCENARIO_INVALID", `${s.id}: an expectation is required`);
    if (typeof s.expect.outcome !== "string") refuse("SCENARIO_INVALID", `${s.id}: the expectation names an outcome`);
    if (s.phase === "DENIED_ACTION") {
      if (s.expect.outcome !== "DENIED") refuse("SCENARIO_INVALID", `${s.id}: a DENIED_ACTION scenario expects DENIED`);
      // A DENIAL THAT DOES NOT SAY WHY IS NOT A TEST. "Denied because unauthorized" and "denied
      // because the surface is broken" look identical from outside unless the reason is asserted.
      if (typeof s.expect.reason !== "string" || s.expect.reason.trim() === "") {
        refuse("DENIAL_REASON_REQUIRED", `${s.id}: a denial asserts the REASON, not merely the refusal`);
      }
      deniedActions += 1;
    }
    if (s.phase === "ALLOWED_ACTION" && s.expect.outcome !== "ALLOWED") {
      refuse("SCENARIO_INVALID", `${s.id}: an ALLOWED_ACTION scenario expects ALLOWED`);
    }
    if (s.readiness === "READY") readyScenarios += 1;
    phasesCovered.add(s.phase);
  }
  // Every phase the Owner named must be represented, even where the only honest entry is a blocked one.
  for (const phase of E2E_PHASES) {
    if (!phasesCovered.has(phase)) refuse("PHASE_MISSING", `no scenario covers the ${phase} phase`);
  }
  if (readyScenarios === 0) refuse("COVERAGE_INSUFFICIENT", "a harness in which nothing is runnable today is a design, not a harness");
  if (deniedActions === 0) refuse("COVERAGE_INSUFFICIENT", "a suite that proves only positives proves nothing about a gate");

  // ---- the assigned/unassigned fixture (Q5) must be honest about every candidate path it refused
  const fixture = manifest.assignedUnassignedFixture;
  if (!fixture || !Array.isArray(fixture.candidatePaths) || fixture.candidatePaths.length === 0) {
    refuse("ASSIGNMENT_FIXTURE_MISSING", "the assigned-vs-unassigned fixture declares the governed paths it considered");
  }
  for (const path of fixture.candidatePaths) {
    for (const field of ["recordKind", "governedWriter", "requiredCapability", "assigneeQualification", "status"]) {
      if (path[field] === undefined) refuse("ASSIGNMENT_PATH_INCOMPLETE", `a candidate path declares ${field}`);
    }
    if (path.status !== "SEEDED" && (typeof path.blockedBy !== "string" || path.blockedBy.trim() === "")) {
      refuse("ASSIGNMENT_PATH_INCOMPLETE", `${path.recordKind}: an unseeded path names the exact blocker`);
    }
    // A SEEDED path may not go quiet either. An assignment ROW existing is not the same fact as the
    // governed assignment COMMAND being invokable, and a path that reported the first while staying silent
    // about the second would read as "this works" when nothing can write it.
    if (path.status === "SEEDED" && (typeof path.stillBlockedForWriting !== "string" || path.stillBlockedForWriting.trim() === "")) {
      refuse("ASSIGNMENT_PATH_INCOMPLETE", `${path.recordKind}: a seeded path states what still blocks the governed writer, or NONE`);
    }
  }

  return Object.freeze({
    personas: manifest.canonicalPersonas.length,
    provisionable: manifest.canonicalPersonas.filter((r) => r.disposition === "PROVISIONABLE").length,
    merged: manifest.canonicalPersonas.filter((r) => r.disposition === "MERGED").length,
    blocked: manifest.canonicalPersonas.filter((r) => r.disposition === "BLOCKED").length,
    scenarios: manifest.scenarios.length,
    readyScenarios,
    domains: manifest.businessProcessCoverage.length,
  });
}

module.exports = {
  get E2E_MANIFEST() { return e2eManifest(); },
  E2E_PHASES,
  E2E_READINESS,
  PROCESS_AVAILABILITY,
  PREFLIGHT_BLOCK_CODES,
  PersonaE2EError,
  preflightAuthorityPlan,
  validateE2EManifest,
};
