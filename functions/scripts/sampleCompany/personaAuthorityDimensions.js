// PERSONA AUTHORITY DIMENSIONS -- the Work Eligibility and Operational Scope layer of the Sample
// Company persona catalog, plus the contextual-authorization decisions those two authorities are
// supposed to produce.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// sampleCompany.v2.json builds a complete governed acceptance world -- 17 Employees, 15 interactive
// Principals, explicit Security Roles, a capability contract per persona -- and contains ZERO
// occurrences of workEligibility, operationalScope, PARTS_OPERATIONS or REORDER_QUEUE. So does
// syntheticNonprodWorkforceSeed.v1.json. eos_workforce.employee_work_eligibility holds 0 rows.
//
// The consequence is not cosmetic. functions/src/eosOps/contextualAuthorization.ts -- the evaluator
// that replaced the legacy `operationalRoles` gate with three SEPARATE typed predicates -- is
// imported by no file under functions/src. Its only importer is its own Postgres test. The persona
// catalog cannot exercise it because no persona has anything for it to read.
//
// This module closes that, and only that. It creates no Employee, no Principal, no tenant
// membership, no Security Role assignment, no CRM row and no commercial record: every one of those
// already has a governed owner in seedSampleCompany.js and a second writer would be a second
// authority. It declares two workforce facts about Employees that already exist, and writes them
// through the governed commands that own them.
//
// ════════════════════ THE SEPARATION THIS FILE IS FOR ════════════════════
//
//   SECURITY CAPABILITY   may this Principal perform this KIND of action?   eos_policy, checked FIRST
//   WORK ELIGIBILITY      is this Employee QUALIFIED for this kind of work? eos_workforce
//   OPERATIONAL SCOPE     WHERE may this Employee do it?                    eos_workforce
//   RECORD ASSIGNMENT     is THIS record theirs?                            eos_ops
//
// Four authorities, four answers. The validator's whole job is to refuse a manifest in which one of
// them is derived from another -- which is how the legacy `operationalRoles` bundle happened.
//
// ════════════════════ WHAT IT NEVER DOES ════════════════════
//
//   never inserts into eos_workforce.employee_work_eligibility or employee_operational_scopes
//     directly. Both have governed commands (assignEmployeeWorkEligibility /
//     assignEmployeeOperationalScope) and the direct-insert policy permits a raw insert only where
//     NO governed writer exists. Here the writers exist and the missing thing is a GRANT -- see
//     NO_ROLE_DECLARES_THE_WORKFORCE_ADMIN_CAPABILITIES in the manifest's blockers.
//   never widens a Role, never grants a capability, never creates or assigns a Security Role
//   never reproduces a legacy operationalRoles value as a qualification code
//   never ends an existing qualification or scope: seeding is ASSIGN-only and idempotent
//   DRY RUN BY DEFAULT; `apply` requires the caller to have passed the Sample Company fence first
"use strict";

const MANIFEST = require("../fixtures/personaAuthorityDimensions.v1.json");
const SAMPLE_COMPANY = require("../fixtures/sampleCompany.v2.json");

/**
 * The legacy `operationalRoles` vocabulary, mirrored here for ONE purpose: to refuse it. A
 * qualification code names a KIND OF WORK; a legacy value named a role bundle. If one of these ever
 * appears as a qualification code or a scope type, the manifest has re-fused what the decomposition
 * split apart, and the run refuses rather than seeding it.
 *
 * Mirrored from functions/src/access/employeeProfileCommands.ts OPERATIONAL_ROLE_VALUES; the test
 * asserts equality against the compiled module so the two cannot drift.
 */
const LEGACY_OPERATIONAL_ROLE_VALUES = Object.freeze([
  "PARTS_MANAGER", "PARTS_ASSOCIATE", "TECHNICIAN", "WAREHOUSE_MANAGER",
  "WAREHOUSE_ASSOCIATE", "SERVICE_MANAGER", "SALES_MANAGER", "SALES_ASSOCIATE",
]);

/** The predicate kinds contextualAuthorization.ts can prove. Mirrored; the test asserts equality. */
const CONTEXT_PREDICATE_KINDS = Object.freeze(["WORK_ELIGIBILITY", "OPERATIONAL_SCOPE", "RECORD_ASSIGNMENT"]);

/** The refusal reasons that evaluator can return. Mirrored; the test asserts equality. */
const AUTHORIZATION_REASONS = Object.freeze([
  "ALLOWED", "CAPABILITY_MISSING", "EMPLOYEE_LINK_REQUIRED", "WORK_ELIGIBILITY_MISSING",
  "OUTSIDE_OPERATIONAL_SCOPE", "NOT_ASSIGNED", "WORK_ELIGIBILITY_UNMAPPED",
]);

/** The record kinds RecordContext accepts. Mirrored; the test asserts equality. */
const RECORD_KINDS = Object.freeze(["reorderRequest", "workOrder"]);

const ASSIGN_REASON_PREFIX = "PERSONA FIXTURE";

class PersonaDimensionsError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PersonaDimensionsError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new PersonaDimensionsError(code, message);
};

/**
 * Validate the manifest against the Sample Company it layers onto and against the governed
 * vocabularies. Pure: no database, no Firebase, no I/O beyond the two required JSON files.
 *
 * `vocabulary` is injected so the test can prove the validator reads the COMPILED governed
 * vocabularies rather than a second copy of them.
 */
function validateManifest(manifest = MANIFEST, sampleCompany = SAMPLE_COMPANY, vocabulary = {}) {
  const qualificationCodes = new Set(vocabulary.workEligibilityCodes ?? ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS", "PARTS_OPERATIONS"]);
  const scopeTypes = new Set(vocabulary.operationalScopeTypes ?? ["WAREHOUSE", "REORDER_QUEUE"]);

  if (manifest.manifest !== "PERSONA_AUTHORITY_DIMENSIONS" || manifest.version !== 1) {
    refuse("MANIFEST_INVALID", "not the v1 persona authority dimensions manifest");
  }
  if (manifest.basis.manifest !== sampleCompany.manifest || sampleCompany.sampleCompanyVersion !== 2) {
    refuse("MANIFEST_INVALID", "this manifest layers onto SAMPLE_COMPANY_V2 and nothing else");
  }
  if (manifest.operatingCompanyKey !== sampleCompany.company.operatingCompanyKey) {
    refuse("MANIFEST_INVALID", "the operating company KEY must be the Sample Company's own key");
  }
  if (manifest.tenantKey !== sampleCompany.company.tenantKey || manifest.environment !== sampleCompany.company.environment) {
    refuse("MANIFEST_INVALID", "tenant and environment must be the Sample Company's own");
  }

  // ---- the Employees this manifest may talk about, and the warehouses a scope may name
  const employees = new Map(sampleCompany.employees.map((e) => [e.key, e]));
  const warehouses = new Set(sampleCompany.warehouses.map((w) => w.warehouseId));
  const linkedEmployeeKeys = new Set(sampleCompany.principals.map((p) => p.employee));
  const employee = (key, what) => {
    const e = employees.get(key);
    if (!e) refuse("UNKNOWN_EMPLOYEE", `${what} names ${key}, which the Sample Company does not declare`);
    return e;
  };

  // ---- Work Eligibility
  const eligibilityByEmployee = new Map();
  for (const row of manifest.workEligibility) {
    employee(row.employee, "a work eligibility row");
    if (!qualificationCodes.has(row.qualificationCode)) {
      refuse("QUALIFICATION_UNKNOWN", `${row.employee}: ${row.qualificationCode} is not in the governed Work Eligibility vocabulary`);
    }
    if (LEGACY_OPERATIONAL_ROLE_VALUES.includes(row.qualificationCode)) {
      refuse("LEGACY_VOCABULARY_REFUSED", `${row.employee}: ${row.qualificationCode} is a legacy operationalRoles value, not a kind of work`);
    }
    if (typeof row.reason !== "string" || !row.reason.startsWith(ASSIGN_REASON_PREFIX)) {
      refuse("REASON_REQUIRED", `${row.employee}: every fixture qualification must say it is a fixture, in its reason`);
    }
    const held = eligibilityByEmployee.get(row.employee) ?? new Set();
    if (held.has(row.qualificationCode)) refuse("DUPLICATE_QUALIFICATION", `${row.employee} holds ${row.qualificationCode} twice`);
    held.add(row.qualificationCode);
    eligibilityByEmployee.set(row.employee, held);
  }

  // ---- Operational Scope
  const scopesByEmployee = new Map();
  for (const row of manifest.operationalScopes) {
    employee(row.employee, "an operational scope row");
    if (!scopeTypes.has(row.scopeType)) {
      refuse("SCOPE_TYPE_UNKNOWN", `${row.employee}: ${row.scopeType} is not in the governed Operational Scope vocabulary`);
    }
    if (LEGACY_OPERATIONAL_ROLE_VALUES.includes(row.scopeType)) {
      refuse("LEGACY_VOCABULARY_REFUSED", `${row.employee}: ${row.scopeType} is a legacy operationalRoles value, not a scope type`);
    }
    if (row.scopeType === "WAREHOUSE" && !warehouses.has(row.scopeId)) {
      refuse("SCOPE_TARGET_UNKNOWN", `${row.employee}: warehouse ${row.scopeId} is not declared by the Sample Company`);
    }
    // The eos_ops key, NOT the operating company ID. `operating_company_id` != `operating_company_key`,
    // and a REORDER_QUEUE scope whose id were the company ID would silently never match a request.
    if (row.scopeType === "REORDER_QUEUE" && row.scopeId !== manifest.operatingCompanyKey) {
      refuse("SCOPE_TARGET_UNKNOWN", `${row.employee}: a REORDER_QUEUE scope_id must be the operating company KEY ${manifest.operatingCompanyKey}, not ${row.scopeId}`);
    }
    if (row.scopeType === "REORDER_QUEUE" && row.scopeId === sampleCompany.company.operatingCompanyId) {
      refuse("COMPANY_ID_IS_NOT_COMPANY_KEY", `${row.employee}: ${row.scopeId} is the operating company ID; a scope names the KEY`);
    }
    if (typeof row.reason !== "string" || !row.reason.startsWith(ASSIGN_REASON_PREFIX)) {
      refuse("REASON_REQUIRED", `${row.employee}: every fixture scope must say it is a fixture, in its reason`);
    }
    const held = scopesByEmployee.get(row.employee) ?? new Set();
    const handle = `${row.scopeType}:${row.scopeId}`;
    if (held.has(handle)) refuse("DUPLICATE_SCOPE", `${row.employee} holds ${handle} twice`);
    held.add(handle);
    scopesByEmployee.set(row.employee, held);
  }

  // ---- NO DIMENSION MAY IMPLY ANOTHER. Each of these would be a re-fusion of the legacy bundle.
  //
  // A qualification is not a Job Role. SERVICE_TECHNICIAN eligibility on a SERVICE_TECHNICIAN Job
  // Role is fine and expected; what must never happen is the manifest DERIVING one from the other,
  // which shows up as every holder of a Job Role holding the matching code with no exceptions.
  const technicianJobRoleHolders = sampleCompany.employees.filter((e) => e.jobRole === "SERVICE_TECHNICIAN").map((e) => e.key);
  const technicianQualified = technicianJobRoleHolders.filter((k) => (eligibilityByEmployee.get(k) ?? new Set()).has("SERVICE_TECHNICIAN"));
  if (technicianQualified.length === technicianJobRoleHolders.length) {
    refuse("JOB_ROLE_IMPLIES_QUALIFICATION",
      "every SERVICE_TECHNICIAN Job Role holder is qualified, so the manifest cannot prove Job Role and Work Eligibility are independent; at least one must be withheld");
  }
  const scopedWithoutQualification = [...scopesByEmployee.keys()].filter((k) => !eligibilityByEmployee.has(k));
  if (scopedWithoutQualification.length === 0) {
    refuse("SCOPE_IMPLIES_QUALIFICATION",
      "no Employee holds an Operational Scope without a Work Eligibility, so the manifest cannot prove scope and qualification are independent");
  }
  const qualifiedWithoutScope = [...eligibilityByEmployee.keys()].filter((k) => !scopesByEmployee.has(k));
  if (qualifiedWithoutScope.length === 0) {
    refuse("QUALIFICATION_IMPLIES_SCOPE",
      "no Employee holds a Work Eligibility without an Operational Scope, so the manifest cannot prove qualification and scope are independent");
  }

  // ---- withheld rows are DECLARED, not merely absent. An absent row proves nothing about intent.
  for (const row of [...manifest.workEligibilityWithheld, ...manifest.operationalScopesWithheld]) {
    employee(row.employee, "a withheld row");
    if (typeof row.reason !== "string" || row.reason.trim() === "") refuse("REASON_REQUIRED", `${row.employee}: a withheld dimension must say why`);
  }
  const withheldEligibility = new Set(manifest.workEligibilityWithheld.map((r) => r.employee));
  for (const [key, codes] of eligibilityByEmployee) {
    if (withheldEligibility.has(key) && codes.size > 0) {
      refuse("WITHHELD_AND_HELD", `${key} both holds and withholds a work eligibility`);
    }
  }

  // ---- personas: every dimension declared here must agree with the Sample Company's own facts
  const personaKeys = Object.keys(manifest.personas);
  for (const key of personaKeys) {
    const p = manifest.personas[key];
    const e = employee(key, `persona ${key}`);
    if (p.employee !== e.id) refuse("PERSONA_DRIFT", `${key}: declared Employee id ${p.employee} is not the Sample Company's ${e.id}`);
    if (p.jobRole !== e.jobRole) refuse("PERSONA_DRIFT", `${key}: declared Job Role ${p.jobRole} is not the Sample Company's ${e.jobRole}`);
    const principal = sampleCompany.principals.find((x) => x.employee === key);
    const expectedRoles = principal ? principal.securityRoles : [];
    if (JSON.stringify(p.securityRoles) !== JSON.stringify(expectedRoles)) {
      refuse("PERSONA_DRIFT", `${key}: declared Security Roles differ from the Sample Company's; a persona and its Principal can never disagree`);
    }
    const heldCodes = [...(eligibilityByEmployee.get(key) ?? [])].sort();
    if (JSON.stringify([...p.workEligibility].sort()) !== JSON.stringify(heldCodes)) {
      refuse("PERSONA_DRIFT", `${key}: declared workEligibility differs from the manifest's own rows`);
    }
    const heldScopes = [...(scopesByEmployee.get(key) ?? [])].sort();
    if (JSON.stringify([...p.operationalScopes].sort()) !== JSON.stringify(heldScopes)) {
      refuse("PERSONA_DRIFT", `${key}: declared operationalScopes differ from the manifest's own rows`);
    }
    // A persona with no Principal holds no Security Role, and cannot hold an Operational Scope
    // reached through one either -- but it MAY still be an Employee with facts about it.
    if (!linkedEmployeeKeys.has(key) && p.securityRoles.length > 0) {
      refuse("PERSONA_DRIFT", `${key}: has no Principal in the Sample Company and therefore holds no Security Role`);
    }
  }
  for (const e of sampleCompany.employees) {
    if (!manifest.personas[e.key]) refuse("PERSONA_MISSING", `the Sample Company declares Employee ${e.key}, which this catalog does not evaluate`);
  }

  // ---- contextual expectations
  const seenIds = new Set();
  let capabilityMissing = 0;
  let allowed = 0;
  let scopeRefusals = 0;
  let assignmentRefusals = 0;
  for (const cx of manifest.contextualExpectations) {
    if (seenIds.has(cx.id)) refuse("DUPLICATE_EXPECTATION", `${cx.id} is declared twice`);
    seenIds.add(cx.id);
    if (cx.persona !== null) employee(cx.persona, `expectation ${cx.id}`);
    if (typeof cx.capabilityKey !== "string" || cx.capabilityKey.trim() === "") refuse("EXPECTATION_INVALID", `${cx.id}: a capability key is required`);
    if (!AUTHORIZATION_REASONS.includes(cx.expect.reason)) refuse("EXPECTATION_INVALID", `${cx.id}: ${cx.expect.reason} is not a reason the evaluator can return`);
    if (cx.expect.allowed !== (cx.expect.reason === "ALLOWED")) refuse("EXPECTATION_INVALID", `${cx.id}: allowed and reason disagree`);
    if (cx.expect.predicate !== undefined && !CONTEXT_PREDICATE_KINDS.includes(cx.expect.predicate)) {
      refuse("EXPECTATION_INVALID", `${cx.id}: ${cx.expect.predicate} is not a predicate kind`);
    }
    // A CAPABILITY_MISSING refusal names no predicate -- that is the leak-prevention rule, not a
    // formatting preference: naming one would tell an unauthorized caller which gate they reached.
    if (cx.expect.reason === "CAPABILITY_MISSING" && cx.expect.predicate !== undefined) {
      refuse("EXPECTATION_INVALID", `${cx.id}: a missing capability must not name a predicate`);
    }
    const predicateLists = cx.paths ?? (cx.predicates ? [cx.predicates] : []);
    for (const list of predicateLists) {
      for (const predicate of list) {
        if (!CONTEXT_PREDICATE_KINDS.includes(predicate.kind)) refuse("EXPECTATION_INVALID", `${cx.id}: ${predicate.kind} is not a predicate kind`);
        if (predicate.kind === "OPERATIONAL_SCOPE" && !scopeTypes.has(predicate.scopeType)) {
          refuse("EXPECTATION_INVALID", `${cx.id}: ${predicate.scopeType} is not a scope type`);
        }
        if (predicate.kind === "RECORD_ASSIGNMENT" && predicate.relation !== "ASSIGNED_EMPLOYEE") {
          refuse("EXPECTATION_INVALID", `${cx.id}: ASSIGNED_EMPLOYEE is the only assignment relation`);
        }
      }
    }
    const needsRecord = predicateLists.some((l) => l.some((p) => p.kind === "RECORD_ASSIGNMENT"));
    if (needsRecord && !cx.record) refuse("EXPECTATION_INVALID", `${cx.id}: a RECORD_ASSIGNMENT predicate needs a record`);
    if (cx.record && !cx.declaredOnly && !RECORD_KINDS.includes(cx.record.recordKind)) {
      refuse("EXPECTATION_INVALID", `${cx.id}: ${cx.record.recordKind} is not a record kind the evaluator accepts`);
    }
    if (cx.expect.reason === "CAPABILITY_MISSING") capabilityMissing += 1;
    if (cx.expect.allowed) allowed += 1;
    if (cx.expect.reason === "OUTSIDE_OPERATIONAL_SCOPE") scopeRefusals += 1;
    if (cx.expect.reason === "NOT_ASSIGNED") assignmentRefusals += 1;
  }
  // The gates the Owner named. A suite that proves only positives proves nothing about a gate.
  if (allowed === 0 || capabilityMissing === 0 || scopeRefusals === 0 || assignmentRefusals === 0) {
    refuse("COVERAGE_INSUFFICIENT",
      "the expectations must include at least one ALLOWED, one CAPABILITY_MISSING, one OUTSIDE_OPERATIONAL_SCOPE and one NOT_ASSIGNED");
  }

  // ---- honest gaps must be DECLARED as such, never silently expected to pass
  for (const cx of manifest.contextualExpectations) {
    if (cx.declaredOnly && !cx.notCoveredBy && !cx.$comment) {
      refuse("UNDECLARED_GAP", `${cx.id}: a declared-only expectation must say what does not cover it`);
    }
  }

  return { employees, eligibilityByEmployee, scopesByEmployee, warehouses, personaKeys };
}

/**
 * Plan the governed writes, without a database and without a client.
 *
 * Returns the exact command calls a seed phase would make, in order. Kept separate from the writer
 * so a plan can be inspected, diffed and asserted with no connection at all -- the same posture
 * seedSampleCompany.js takes with `--mode plan`.
 */
function planPersonaAuthorityDimensions(manifest = MANIFEST, sampleCompany = SAMPLE_COMPANY) {
  const { employees } = validateManifest(manifest, sampleCompany);
  const id = (key) => employees.get(key).id;
  const plan = [];
  for (const row of manifest.workEligibility) {
    plan.push({
      command: "assignEmployeeWorkEligibility",
      requiresCapability: "admin.employeeWorkEligibility.write",
      input: { employeeId: id(row.employee), qualificationCode: row.qualificationCode, reason: row.reason },
    });
  }
  for (const row of manifest.operationalScopes) {
    plan.push({
      command: "assignEmployeeOperationalScope",
      requiresCapability: "admin.employeeOperationalScope.write",
      input: { employeeId: id(row.employee), scopeType: row.scopeType, scopeId: row.scopeId, reason: row.reason },
    });
  }
  return Object.freeze(plan);
}

/**
 * The seed phase. `commands` is injected -- the compiled governed writers in production, doubles in
 * tests -- so this function never reaches for a module that would drag in `pg` behind the caller's
 * fence.
 *
 * `apply` false plans only and returns the same summary shape with every count at zero, so a plan
 * and an apply are comparable.
 */
async function seedPersonaAuthorityDimensions(deps, actor, options, manifest = MANIFEST, sampleCompany = SAMPLE_COMPANY) {
  const plan = planPersonaAuthorityDimensions(manifest, sampleCompany);
  const summary = {
    planned: plan.length,
    workEligibility: { assigned: 0, unchanged: 0 },
    operationalScopes: { assigned: 0, unchanged: 0 },
  };
  if (!options.apply) return { applied: false, summary, plan };

  for (const step of plan) {
    const bucket = step.command === "assignEmployeeWorkEligibility" ? "workEligibility" : "operationalScopes";
    const result = await deps.commands[step.command](deps, actor, step.input);
    if (result.outcome === "NO_CHANGE") summary[bucket].unchanged += 1;
    else if (result.outcome === "ASSIGNED") summary[bucket].assigned += 1;
    else refuse("UNEXPECTED_OUTCOME", `${step.command} returned ${result.outcome}; this phase only ever assigns`);
  }
  return { applied: true, summary, plan };
}

module.exports = {
  MANIFEST,
  LEGACY_OPERATIONAL_ROLE_VALUES,
  CONTEXT_PREDICATE_KINDS,
  AUTHORIZATION_REASONS,
  RECORD_KINDS,
  PersonaDimensionsError,
  validateManifest,
  planPersonaAuthorityDimensions,
  seedPersonaAuthorityDimensions,
};
