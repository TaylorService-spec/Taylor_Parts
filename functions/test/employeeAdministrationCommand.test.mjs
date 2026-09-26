// LANE BT -- the GOVERNED Employee administration capability, proved OFFLINE.
//
// The subject is the gap the Owner ruled a product defect: there was no governed PostgreSQL Employee
// WRITER. `INSERT INTO eos_workforce.employees` appeared in exactly two places, both fixture seeds
// (scripts/seedSyntheticNonprodWorkforce.js, scripts/seedSampleCompany.js), and
// scripts/provisionEmployeeAccess.js writes Firestore. This suite proves the parts of the fix that need
// no database: the operator fence, the closed input vocabularies, the pure validation, the static
// prohibitions ("creating an Employee creates no authority", "no raw SQL escape hatch", "no new
// capability"), and the transport registration.
//
// The behaviour against a real postgres:16 -- authorization, refusal, conflict, audit, cross-tenant
// isolation and the expected-current-value guard -- is employeeAdministrationCommandPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FUNCTIONS_DIR, "src");
const COMMANDS = join(SRC, "eosWorkforce", "commands");
const require = createRequire(import.meta.url);

const cli = require("../scripts/administerEmployeeCli.js");
const creation = require("../lib/eosWorkforce/commands/employeeCreationCommand.js");
const links = require("../lib/eosWorkforce/commands/employeePrincipalLinkCommands.js");
const input = require("../lib/eosWorkforce/commands/employeeAdministrationInput.js");
const authority = require("../lib/eosWorkforce/commands/employeeAdministrationAuthority.js");
const kernel = require("../lib/eosWorkforce/commands/employeeCommandKernel.js");
const http = require("../lib/eosWorkforce/workforceHttp.js");

/** Comment-stripped source, the same posture the sibling Workforce guards take. */
const code = (file) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const source = (name) => code(join(COMMANDS, name));

const CREATION_SRC = "employeeCreationCommand.ts";
const LINK_SRC = "employeePrincipalLinkCommands.ts";
const ACTOR_SRC = "employeeAdministrationAuthority.ts";
const REASON_SRC = "employeeAdministrationInput.ts";

// ════════════════════ the closed surface ════════════════════

test("the four new operations are registered as COMMANDS, and no generic patch or authority-granting name is", () => {
  for (const op of ["createEmployee", "linkEmployeePrincipal", "unlinkEmployeePrincipal", "relinkEmployeePrincipal"]) {
    assert.ok(http.WORKFORCE_COMMAND_OPERATIONS.includes(op), `${op} is not a registered command`);
    assert.ok(!http.WORKFORCE_READ_OPERATIONS.includes(op), `${op} was registered as a read`);
  }
  // Nothing that would set a link without stating the value it replaces, and nothing that would create
  // an Employee and its authority together.
  for (const absent of ["setEmployeePrincipal", "updateEmployee", "patchEmployee", "createEmployeeWithAccess",
    "provisionEmployeeAccess", "assignSecurityRole", "createEmployeeAndJobRole", "deleteEmployee", "unlinkEmployee"]) {
    assert.equal(http.isWorkforceOperation(absent), false, absent);
  }
});

test("the TARGET Principal is never spelled `principalId`: the transport would refuse the body outright", () => {
  // The transport refuses an authority-bearing field BEFORE it verifies a token, so a link command that
  // called its target `principalId` would be unreachable rather than merely badly named.
  assert.ok(http.AUTHORITY_BEARING_FIELDS.includes("principalId"));
  const src = source(LINK_SRC);
  for (const accepted of [/"linkedPrincipalId"/, /"expectedCurrentPrincipalId"/, /"newPrincipalId"/]) assert.match(src, accepted);
  assert.doesNotMatch(src, /acceptOnly\([^)]*"principalId"/);
  for (const field of http.AUTHORITY_BEARING_FIELDS) {
    assert.doesNotMatch(src, new RegExp(`acceptOnly\\(input, \\[[^\\]]*"${field}"`), field);
    assert.doesNotMatch(source(CREATION_SRC), new RegExp(`acceptOnly\\(input, \\[[^\\]]*"${field}"`), field);
  }
});

// ════════════════════ creating an Employee creates NO authority ════════════════════

/** Every relation in which a row would BE authority, or would grant one. */
const AUTHORITY_RELATIONS = Object.freeze([
  "eos_policy.user_role_assignments", "eos_policy.role_capabilities", "eos_policy.principal_capabilities",
  "eos_policy.principals", "eos_policy.tenant_memberships", "eos_policy.roles", "eos_policy.capabilities",
  "eos_workforce.employee_job_role_assignments", "eos_workforce.job_roles", "eos_workforce.employee_work_eligibility",
  "eos_workforce.employee_operational_scopes", "eos_workforce.employee_reporting_relationships",
]);

test("createEmployee writes ONE Employee row and ONE audit event, and grants nothing -- no Role, Job Role, eligibility, scope, manager or link", () => {
  const src = source(CREATION_SRC);
  const writes = [...src.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+\.[a-z_]+)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(writes, ["INSERT INTO eos_workforce.employees"],
    "createEmployee writes something other than the Employee row (the audit row goes through appendEmployeeAudit)");
  for (const relation of AUTHORITY_RELATIONS) {
    assert.ok(!src.includes(relation), `createEmployee names ${relation}`);
  }
  // It does not reach the Job Role command either: a Job Role hidden inside a create would make an
  // Employee's business function a side effect of its existence.
  assert.doesNotMatch(src, /employeeJobRoleCommands|assignEmployeeJobRole|employeeWorkEligibilityCommands|employeeOperationalScopeCommands|employeePrincipalLinkCommands/);
  // Exactly one audit append, and the append is the shared one -- not a hand-rolled INSERT.
  assert.equal((src.match(/appendEmployeeAudit\(/g) ?? []).length, 1);
  assert.equal(creation.EMPLOYEE_CREATE_ACTION, "employee.record.create");
});

test("the link commands touch the link relation only: they never write an Employee, a Principal, a membership, a Role or a grant", () => {
  const src = source(LINK_SRC);
  const writes = [...src.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+\.[a-z_]+)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual([...new Set(writes)].sort(),
    ["INSERT INTO eos_policy.employee_principal_links", "UPDATE eos_policy.employee_principal_links"]);
  // NOTHING IS DELETED. A revoked link is history the partial unique indexes deliberately allow to stay.
  assert.doesNotMatch(src, /\bDELETE\b/);
  for (const relation of AUTHORITY_RELATIONS.filter((r) => r !== "eos_policy.principals" && r !== "eos_policy.tenant_memberships")) {
    assert.ok(!src.includes(relation), `the link commands name ${relation}`);
  }
  // principals / tenant_memberships appear ONLY in the target Principal's read-side precondition.
  assert.equal((src.match(/INSERT INTO|UPDATE /g) ?? []).length, 2);
  assert.match(src, /FOR SHARE OF m/);
});

test("the administering actor resolver is SELECT-only and can only ADD grants eos_policy already holds", () => {
  const src = source(ACTOR_SRC);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/, "the authority resolver writes");
  // It reads the two grant relations and the membership, and nothing else about anything.
  assert.match(src, /eos_policy\.tenant_memberships/);
  assert.match(src, /eos_policy\.user_role_assignments/);
  assert.match(src, /capabilitiesForRoleKeys/);
  assert.match(src, /principalCapabilityGrants/);
  // A caller can never state authority, and the refused names include the ones the brief calls out.
  for (const field of ["heldRoleKeys", "capabilities", "roles", "entitlements", "grants", "permissions", "securityRole"]) {
    assert.ok(authority.SUPPLIED_AUTHORITY_FIELDS.includes(field), field);
  }
  assert.throws(() => authority.assertNoSuppliedAuthority(["tenantId", "principalId", "capabilities"]),
    (err) => err.code === "AUTHORITY_ARGUMENT_REFUSED" && err.category === "FORBIDDEN");
  assert.throws(() => authority.assertNoSuppliedAuthority(["heldRoleKeys"]), (err) => err.code === "AUTHORITY_ARGUMENT_REFUSED");
  // `principalId` is deliberately NOT refused here: the link commands name a TARGET Principal, and the
  // resolver's own request object carries the ADMINISTERING one, which the fence supplies, not a body.
  assert.doesNotThrow(() => authority.assertNoSuppliedAuthority(["tenantId", "principalId"]));
});

test("NO CAPABILITY IS ADDED BY THIS LANE: the new sources gate on the existing admin.employeeProfile.write and add no migration", () => {
  const all = [CREATION_SRC, LINK_SRC, ACTOR_SRC, REASON_SRC].map(source).join("\n");
  const capabilityLiterals = [...all.matchAll(/"([a-zA-Z]+(?:\.[a-zA-Z]+)+\.(?:read|write))"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(capabilityLiterals)], [], "a capability key is spelled in a new source instead of imported");
  assert.equal(kernel.EMPLOYEE_PROFILE_WRITE, "admin.employeeProfile.write");
  assert.match(source(CREATION_SRC), /EMPLOYEE_PROFILE_WRITE\)/);
  assert.match(source(LINK_SRC), /EMPLOYEE_PROFILE_WRITE\)/);
  // And no migration declares a NEW Employee-administration capability: the four new names this lane
  // introduces are AUDIT ACTIONS, not capabilities. The four that exist are the four that existed.
  const migrations = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(FUNCTIONS_DIR, "migrations", f), "utf8")).join("\n");
  const declared = [...new Set([...migrations.matchAll(/'(admin\.employee[A-Za-z]*\.[a-z]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(declared, ["admin.employeeJobRole.write", "admin.employeeOperationalScope.write",
    "admin.employeeProfile.write", "admin.employeeWorkEligibility.write"],
    "this lane changed the Employee capability vocabulary; capability authority must not change in this wave");
  for (const action of [creation.EMPLOYEE_CREATE_ACTION, links.PRINCIPAL_LINK_ESTABLISH_ACTION,
    links.PRINCIPAL_LINK_REVOKE_ACTION, links.PRINCIPAL_LINK_RELINK_ACTION]) {
    assert.ok(!migrations.includes(`'${action}'`), `${action} was registered as a capability`);
  }
});

test("no Firebase, and no Firestore-shaped write, anywhere in the new sources or the operator wrapper", () => {
  const files = [join(COMMANDS, CREATION_SRC), join(COMMANDS, LINK_SRC), join(COMMANDS, ACTOR_SRC),
    join(COMMANDS, REASON_SRC), join(FUNCTIONS_DIR, "scripts", "administerEmployeeCli.js")];
  for (const f of files) {
    assert.doesNotMatch(code(f), /firebase-admin|firebase\/|getFirestore|admin\.firestore|collection\(|\.doc\(|\bFieldValue\b|customClaims|setCustomUserClaims/, f);
  }
});

// ════════════════════ the reason, and the pure validation ════════════════════

test("every governed Employee administration operation requires a specific reason", () => {
  assert.deepEqual([input.MIN_GOVERNED_REASON_LENGTH, input.MAX_GOVERNED_REASON_LENGTH], [10, 500]);
  for (const bad of [undefined, null, "", "fix", "  padded  ", "x".repeat(501), 7, {}]) {
    assert.throws(() => input.requireGovernedReason(bad), (err) => err.code === "REASON_REQUIRED" && err.category === "INVALID_INPUT", String(bad));
  }
  assert.equal(input.requireGovernedReason("new hire, per signed offer 2026-09-25"), "new hire, per signed offer 2026-09-25");
});

test("prepareEmployeeCreation: the closed vocabulary, the two required lifecycle facts, and the profile normalization it shares with the profile writer", () => {
  const ok = creation.prepareEmployeeCreation({
    employeeId: "emp-jane", employmentStatus: "ACTIVE", operatingCompanyId: "taylor",
    profile: { displayName: "Jane Doe", hireDate: "2026-09-01" }, reason: "new hire per signed offer",
  });
  assert.deepEqual([ok.employeeId, ok.employmentStatus, ok.operatingCompanyId, [...ok.profile.keys()]],
    ["emp-jane", "ACTIVE", "taylor", ["displayName", "hireDate"]]);
  // A create with NO profile fact is legitimate: nothing is fabricated.
  assert.equal(creation.prepareEmployeeCreation({ employeeId: "e", employmentStatus: "CONTRACTOR", operatingCompanyId: "ventana", reason: "contractor start" }).profile.size, 0);

  const base = { employeeId: "emp-jane", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "new hire per signed offer" };
  const refusal = (patch, code) => assert.throws(() => creation.prepareEmployeeCreation({ ...base, ...patch }), (err) => err.code === code, JSON.stringify(patch));
  refusal({ employmentStatus: undefined }, "EMPLOYMENT_STATUS_INVALID");
  refusal({ employmentStatus: "PROBATION" }, "EMPLOYMENT_STATUS_INVALID");
  refusal({ operatingCompanyId: undefined }, "OPERATING_COMPANY_INVALID");
  refusal({ operatingCompanyId: "Taylor" }, "OPERATING_COMPANY_INVALID");
  refusal({ employeeId: "a/b" }, "EMPLOYEE_ID_REQUIRED");
  refusal({ reason: undefined }, "REASON_REQUIRED");
  refusal({ profile: { workEmail: "not-an-email" } }, "PROFILE_FIELD_INVALID");
  refusal({ profile: { hireDate: "2026-02-31" } }, "PROFILE_FIELD_INVALID");
  refusal({ profile: { employeeNumber: "has space" } }, "PROFILE_FIELD_INVALID");
  // The fields a create must never accept: authority, access identity, the manager, and the decomposed authorities.
  for (const field of ["securityRole", "operationalRoles", "userId", "principalId", "linkedPrincipalId", "jobRoleId",
    "managerEmployeeId", "capabilities", "tenantId", "qualificationCode", "changes"]) {
    refusal({ [field]: "x" }, "INPUT_FIELD_NOT_ACCEPTED");
  }
  // And a profile object may not smuggle a non-profile key in either.
  refusal({ profile: { employmentStatus: "ACTIVE" } }, "INPUT_FIELD_NOT_ACCEPTED");
  refusal({ profile: { operationalRoles: "x" } }, "INPUT_FIELD_NOT_ACCEPTED");
});

test("the link commands' audit actions are the three the change history projects, and the link source is the asserted one", () => {
  assert.deepEqual(
    [links.PRINCIPAL_LINK_ESTABLISH_ACTION, links.PRINCIPAL_LINK_REVOKE_ACTION, links.PRINCIPAL_LINK_RELINK_ACTION],
    ["employee.principalLink.establish", "employee.principalLink.revoke", "employee.principalLink.relink"]);
  // OPERATOR_ASSERTED is the only term a command may write: the other term in migration 1758412800000's
  // closed vocabulary is a DERIVED fact belonging to the migration that derived it.
  assert.equal(links.GOVERNED_LINK_SOURCE, "OPERATOR_ASSERTED");
  assert.doesNotMatch(source(LINK_SRC), /RECIPROCAL_FIREBASE_UID_LINK/);
});

// ════════════════════ the operator wrapper's fence ════════════════════

const FENCE_BASE = Object.freeze({
  environment: "platform-sandbox", databaseUrlEnv: "DB", tenantKey: "taylor-nonprod",
  performedBy: "operator", adminPrincipalId: "p-admin", command: "createEmployee",
  employeeId: "emp-jane", employmentStatus: "ACTIVE", operatingCompanyId: "taylor",
  reason: "new hire, per signed offer 2026-09-25",
});
const FENCE_ENV = Object.freeze({ DB: "postgres://x", EOS_ENVIRONMENT: "nonprod" });
const invoke = (patch = {}, env = FENCE_ENV) => cli.assertInvocation({ ...FENCE_BASE, ...patch }, env);
const refusedBy = (patch, code, env = FENCE_ENV) => assert.throws(() => invoke(patch, env), (err) => err.code === code, JSON.stringify(patch));

test("the operator wrapper is dry-run by default and refuses production by role AND by project id, the frozen world, and a non-nonprod runtime", () => {
  assert.equal(invoke().apply, false);
  assert.equal(invoke({ apply: "true" }).apply, true);
  // Production, twice over: the declared role, and the customer project id named literally.
  assert.throws(() => invoke({ environment: "taylor-parts-production" }), /production/);
  assert.throws(() => invoke({ environment: "not-a-declared-environment" }), /config\/environments\.json/);
  refusedBy({ environment: "platform-certification" }, "ENVIRONMENT_FROZEN");
  // Refusing production is not the same as knowing the target is nonprod.
  assert.throws(() => invoke({}, { ...FENCE_ENV, EOS_ENVIRONMENT: "production" }), /EOS_ENVIRONMENT/);
  assert.throws(() => invoke({}, { ...FENCE_ENV, EOS_ENVIRONMENT: undefined }), /EOS_ENVIRONMENT/);
  // The connection string is NAMED, never passed.
  assert.throws(() => invoke({}, { EOS_ENVIRONMENT: "nonprod" }), /DB/);
});

test("the operator wrapper refuses argv-supplied authority BY NAME, refuses a credential on argv, and refuses an unknown flag rather than ignoring it", () => {
  for (const flag of ["heldRoleKeys", "capabilities", "roles", "role", "grants", "permissions", "entitlements",
    "securityRole", "jobRole", "tenantId", "principalId", "uid"]) {
    refusedBy({ [flag]: "x" }, "AUTHORITY_ARGUMENT_REFUSED");
  }
  // `jobRoleId` WAS on that list and is not any more, because --command assignEmployeeJobRole now takes
  // one (Owner ruling 2026-09-25). It moved to OPERATION_FLAGS rather than being listed twice: a flag
  // that is both known and authority-refused is a lie in one of the two lists, since KNOWN_FLAGS is
  // tested first. A Job Role is a business position and carries no authority -- and the refusal that
  // actually matters, that no OTHER command may take one, is proved below and in the Postgres suite.
  assert.ok(!cli.AUTHORITY_BEARING_FLAGS.includes("jobRoleId"));
  assert.ok(cli.AUTHORITY_BEARING_FLAGS.includes("jobRole") && cli.AUTHORITY_BEARING_FLAGS.includes("securityRole"));
  assert.ok(cli.KNOWN_FLAGS.includes("jobRoleId"));
  for (const flag of ["password", "token", "idToken", "serviceAccountKey", "databaseUrl", "connectionString", "apiKey"]) {
    refusedBy({ [flag]: "x" }, "CREDENTIAL_ARGUMENT_REFUSED");
  }
  refusedBy({ employmentState: "ACTIVE" }, "UNKNOWN_FLAG_REFUSED");
  refusedBy({ force: "true" }, "UNKNOWN_FLAG_REFUSED");
  // Every refusal above happens before a driver is loaded: the fence is a pure function of argv and env.
  assert.equal(typeof cli.assertInvocation, "function");
  assert.doesNotMatch(code(join(FUNCTIONS_DIR, "scripts", "administerEmployeeCli.js")).split("async function main")[0], /require\("pg"\)|require\("\.\.\/lib\//);
});

test("the operator wrapper requires the named target, the named administrator and a specific reason", () => {
  for (const flag of ["tenantKey", "performedBy", "adminPrincipalId", "command", "employeeId", "reason"]) {
    refusedBy({ [flag]: undefined }, flag === "reason" ? "ARGUMENT_REQUIRED" : "ARGUMENT_REQUIRED");
    refusedBy({ [flag]: "true" }, "ARGUMENT_REQUIRED");
  }
  refusedBy({ reason: "too short" }, "REASON_REQUIRED");
  refusedBy({ performedBy: "not a valid operator!" }, "ARGUMENT_REQUIRED");
  refusedBy({ command: "deleteEmployee" }, "COMMAND_UNKNOWN");
  refusedBy({ command: "createJobRole" }, "COMMAND_UNKNOWN");
  refusedBy({ command: "updateJobRole" }, "COMMAND_UNKNOWN");
  refusedBy({ command: "assignEmployeeWorkEligibility" }, "COMMAND_UNKNOWN");
  refusedBy({ command: "assignEmployeeOperationalScope" }, "COMMAND_UNKNOWN");
  // assignEmployeeJobRole was COMMAND_UNKNOWN here until the Owner ruling of 2026-09-25 added it. The
  // catalog writers beside it (createJobRole, updateJobRole) and the two other decomposed Workforce
  // authorities are still not administered here: ONE bounded operation was added, not a Job Role surface.
  assert.deepEqual([...cli.COMMANDS],
    ["createEmployee", "updateEmployeeProfile", "linkEmployeePrincipal", "unlinkEmployeePrincipal", "relinkEmployeePrincipal",
      "assignEmployeeJobRole"]);
});

test("the operator wrapper builds ONLY inputs the governed command accepts, per command, and never a field it would refuse", () => {
  const create = invoke();
  assert.deepEqual(create.input, {
    employeeId: "emp-jane", reason: FENCE_BASE.reason, employmentStatus: "ACTIVE", operatingCompanyId: "taylor",
  });
  // The pure validator of the real command accepts the wrapper's input verbatim -- the wrapper is not a
  // second vocabulary.
  assert.doesNotThrow(() => creation.prepareEmployeeCreation(create.input));
  const withProfile = invoke({ displayName: "Jane Doe", addressCity: "Phoenix", hireDate: "2026-09-01" });
  assert.deepEqual(withProfile.input.profile, { displayName: "Jane Doe", "address.city": "Phoenix", hireDate: "2026-09-01" });
  assert.doesNotThrow(() => creation.prepareEmployeeCreation(withProfile.input));
  assert.deepEqual(Object.keys(cli.PROFILE_FLAGS).length, 17);

  const link = invoke({ command: "linkEmployeePrincipal", employmentStatus: undefined, operatingCompanyId: undefined, linkedPrincipalId: "p-jane" });
  assert.deepEqual(link.input, { employeeId: "emp-jane", reason: FENCE_BASE.reason, linkedPrincipalId: "p-jane" });
  const unlink = invoke({ command: "unlinkEmployeePrincipal", employmentStatus: undefined, operatingCompanyId: undefined, expectedCurrentPrincipalId: "p-jane" });
  assert.deepEqual(unlink.input, { employeeId: "emp-jane", reason: FENCE_BASE.reason, expectedCurrentPrincipalId: "p-jane" });
  const relink = invoke({ command: "relinkEmployeePrincipal", employmentStatus: undefined, operatingCompanyId: undefined, expectedCurrentPrincipalId: "p-jane", newPrincipalId: "p-jane2" });
  assert.deepEqual(relink.input, { employeeId: "emp-jane", reason: FENCE_BASE.reason, expectedCurrentPrincipalId: "p-jane", newPrincipalId: "p-jane2" });
  const edit = invoke({ command: "updateEmployeeProfile", employmentStatus: undefined, operatingCompanyId: undefined, jobTitle: "Service Technician" });
  assert.deepEqual(edit.input, { employeeId: "emp-jane", reason: FENCE_BASE.reason, changes: { jobTitle: "Service Technician" } });

  // THE EXPECTED-CURRENT-VALUE GUARD IS NOT OPTIONAL, so the wrapper cannot omit it.
  refusedBy({ command: "unlinkEmployeePrincipal", employmentStatus: undefined, operatingCompanyId: undefined }, "ARGUMENT_REQUIRED");
  refusedBy({ command: "relinkEmployeePrincipal", employmentStatus: undefined, operatingCompanyId: undefined, expectedCurrentPrincipalId: "p-jane" }, "ARGUMENT_REQUIRED");
  // And a flag that belongs to another command is refused rather than silently dropped.
  refusedBy({ command: "linkEmployeePrincipal", linkedPrincipalId: "p-jane" }, "ARGUMENT_NOT_ACCEPTED");
  refusedBy({ command: "linkEmployeePrincipal", employmentStatus: undefined, operatingCompanyId: undefined, linkedPrincipalId: "p-jane", displayName: "Jane" }, "ARGUMENT_NOT_ACCEPTED");
  refusedBy({ command: "createEmployee", linkedPrincipalId: "p-jane" }, "ARGUMENT_NOT_ACCEPTED");
  refusedBy({ command: "updateEmployeeProfile", employmentStatus: undefined, operatingCompanyId: undefined }, "ARGUMENT_REQUIRED");

  // ---- the Job Role assignment: THREE inputs, exactly the three the governed command accepts ----
  const jobRoleBase = { command: "assignEmployeeJobRole", employmentStatus: undefined, operatingCompanyId: undefined };
  const assign = invoke({ ...jobRoleBase, jobRoleId: "service-technician" });
  assert.deepEqual(assign.input, { employeeId: "emp-jane", reason: FENCE_BASE.reason, jobRoleId: "service-technician" });
  // There is no fourth key, and in particular no employmentStatus, no profile change, no principal and
  // no expected-current value -- the wrapper composes exactly acceptOnly(["employeeId","jobRoleId","reason"]).
  assert.deepEqual(Object.keys(assign.input).sort(), ["employeeId", "jobRoleId", "reason"]);
  refusedBy({ ...jobRoleBase }, "ARGUMENT_REQUIRED");                    // --jobRoleId is mandatory
  refusedBy({ ...jobRoleBase, jobRoleId: "true" }, "ARGUMENT_REQUIRED"); // and cannot be a bare flag
  refusedBy({ ...jobRoleBase, jobRoleId: "service-technician", reason: undefined }, "ARGUMENT_REQUIRED");
  refusedBy({ ...jobRoleBase, jobRoleId: "service-technician", reason: "too short" }, "REASON_REQUIRED");
  // IT ADDS NO IMPLICIT ANYTHING. Every field belonging to another operation is refused, not dropped.
  for (const flag of ["employmentStatus", "operatingCompanyId", "linkedPrincipalId", "expectedCurrentPrincipalId",
    "newPrincipalId", "displayName", "jobTitle", "hireDate"]) {
    refusedBy({ ...jobRoleBase, jobRoleId: "service-technician", [flag]: "x" }, "ARGUMENT_NOT_ACCEPTED");
  }
  // AND --jobRoleId IS REFUSED BY EVERY OTHER COMMAND, which is the half of the old "JOB ROLES ARE NOT
  // ADMINISTERED HERE" rule that survives: creating or editing an Employee still assigns no position.
  for (const command of ["createEmployee", "updateEmployeeProfile", "linkEmployeePrincipal", "unlinkEmployeePrincipal", "relinkEmployeePrincipal"]) {
    refusedBy({ command, jobRoleId: "service-technician" }, "ARGUMENT_NOT_ACCEPTED");
  }
});

test("the operator wrapper has NO raw SQL escape hatch: its only statement is the tenant lookup, and it drives the governed commands", () => {
  const src = code(join(FUNCTIONS_DIR, "scripts", "administerEmployeeCli.js"));
  const statements = [...src.matchAll(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/g)].map((m) => m[1]);
  assert.deepEqual(statements, [], "the operator wrapper contains a write statement of its own");
  assert.deepEqual([...src.matchAll(/pool\.query\(/g)].length, 1, "the wrapper makes a query other than the tenant lookup");
  assert.match(src, /SELECT id FROM eos_policy\.tenants WHERE key = \$1/);
  // Every write goes through one of the six governed commands, by module path.
  for (const mod of ["employeeCreationCommand", "employeeProfileCommand", "employeePrincipalLinkCommands",
    "employeeJobRoleCommands", "employeeAdministrationAuthority"]) {
    assert.ok(src.includes(mod), mod);
  }
  // THE JOB ROLE ASSIGNMENT IS IMPORTED, NOT IMPLEMENTED. The wrapper names the governed command and the
  // module it lives in, and holds not one line of Job Role logic: no catalog row, no assignment row, no
  // status check, no history. Those live in src/eosWorkforce/commands/employeeJobRoleCommands.ts and are
  // proved by employeeJobRolePostgres.test.mjs; the write-statement assertion above already proves this
  // file cannot reach the tables itself.
  assert.match(src, /require\("\.\.\/lib\/eosWorkforce\/commands\/employeeJobRoleCommands\.js"\)/);
  // The map entry IS the imported symbol, and there is no local definition of that name anywhere.
  assert.match(src, /assignEmployeeJobRole: jobRoles\.assignEmployeeJobRole/);
  assert.doesNotMatch(src, /(?:async\s+)?function\s+assignEmployeeJobRole|assignEmployeeJobRole\s*=\s*(?:async\s*)?\(/);
  assert.doesNotMatch(src, /employee_job_role_assignments|job_roles\b|effective_to|JOB_ROLE_ID_SHAPE/);
  // And it still never creates a Job Role, assigns a Role, mints a Principal, or writes an eligibility or a scope.
  assert.doesNotMatch(src, /createJobRole|updateJobRole|assignRole|createPrincipal|WorkEligibility|OperationalScope/);
});
