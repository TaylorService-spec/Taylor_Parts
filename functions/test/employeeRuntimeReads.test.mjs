// EMPLOYEE RUNTIME READS, offline -- the Workforce transport's closed surface, identity, error boundaries and the static
// ratchets over the Employee read layer. The real-database proof is functions/test/employeeRuntimeReadsPostgres.test.mjs.
//
// Offline requests run the REAL resolveOperationalContext over a fake PolicyReader and a fake pool.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const SRC = join(FUNCTIONS_DIR, "src");
const WORKFORCE = join(SRC, "eosWorkforce");
const HTTP_SOURCE = join(WORKFORCE, "workforceHttp.ts");
const READS = join(WORKFORCE, "reads");
const require = createRequire(import.meta.url);
const http = require("../lib/eosWorkforce/workforceHttp.js");
const kernel = require("../lib/eosWorkforce/reads/employeeReadKernel.js");
const responsibility = require("../lib/eosWorkforce/reads/employeeResponsibilityReads.js");
const { eosApiDomainFor } = require("../lib/eosApi/server.js");

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "lib" || entry === "dist") continue;
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}
const rel = (f) => relative(REPO, f).split("\\").join("/");
const code = (f) => strip(readFileSync(f, "utf8"));

function fakeWorld({ capabilities = ["opportunity.read"], clientQuery, member = true } = {}) {
  const lookups = [];
  const reader = {
    async getPrincipalBySubject(provider, subject) {
      lookups.push({ provider, subject });
      return provider === "firebase" && subject === "subj-alice" ? { id: "p-eos-alice", status: "active" } : null;
    },
    async listMembershipsForPrincipal() { return [{ tenantId: "t1", status: "active" }]; },
    async getTenant(id) { return { id, status: "active" }; },
    async listAssignmentsForPrincipal() { return [{ roleId: "r1", status: "active", accessVersionAtGrant: 0 }]; },
    async getAccessVersion() { return { accessVersion: 0 }; },
    async listObjects() { return []; },
    async listObjectPermissions() { return []; },
    async listFieldOverrides() { return []; },
    async listRoles() { return [{ id: "r1", key: "sales" }]; },
  };
  const clientStatements = [];
  let connects = 0;
  const pool = {
    async query(text) {
      if (/role_capabilities/.test(text)) return { rows: capabilities.map((key) => ({ key })) };
      throw new Error(`unexpected pool query ${text}`);
    },
    async connect() {
      connects++;
      return {
        async query(text, values) {
          clientStatements.push({ text, values });
          if (/tenant_memberships/.test(text)) return { rows: member ? [{ ok: 1 }] : [] };
          if (clientQuery) return clientQuery(text, values);
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const verifyToken = async (token) => {
    if (token !== "tok-alice") throw new Error("firebase: auth/argument-error for project secret-project with key AIza-SECRET");
    return { externalSubject: "subj-alice", identityProvider: "firebase" };
  };
  return { reader, pool, verifyToken, lookups, clientStatements, connects: () => connects, allowedOrigins: ["https://eos.example"] };
}
const post = (world, body, headers = {}, url = "/workforce/employees", method = "POST") => http.handleWorkforceRequest(world, {
  method, url, headers: { authorization: "Bearer tok-alice", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const parsed = (res) => JSON.parse(res.body);

// ════════════════════ closed surface ════════════════════

const OPERATIONS = ["readMyEmployeeProfile", "readEmployee", "listEmployees", "readEmployeePrincipalLink", "listManagedEmployees", "listRecordsOwnedByEmployee", "listAccountabilitiesForEmployee", "listJobRoles", "listEmployeeJobRoleHistory", "listEmployeesWithoutJobRole", "listEmployeeChangeHistory"];

const COMMANDS = ["updateEmployeeProfile", "establishReportingRelationship", "endReportingRelationship", "saveEmployeeEdit", "changeEmploymentStatus", "changeOperatingCompany", "createJobRole", "updateJobRole", "assignEmployeeJobRole"];

test("the operation list is closed: reads EMP-RT-01, 02, 03, 04, 06, 07, 08, H1 and exactly the governed Employee commands", () => {
  assert.deepEqual([...http.WORKFORCE_READ_OPERATIONS], OPERATIONS);
  assert.deepEqual([...http.WORKFORCE_COMMAND_OPERATIONS], COMMANDS);
  assert.deepEqual([...http.WORKFORCE_OPTIONAL_INPUT_OPERATIONS], ["readMyEmployeeProfile", "listEmployees"]);
  assert.equal(http.WORKFORCE_ROUTE, "/workforce/employees");
  const src = code(HTTP_SOURCE);
  assert.doesNotMatch(src, /MUTATION|assign(ed)?Work|migration\//);
  const runners = /const READ_RUNNERS = Object\.freeze\(\{([\s\S]*?)\}\s*as const\)/.exec(src)[1];
  assert.deepEqual([...runners.matchAll(/(\w+): read\(/g)].map((m) => m[1]), OPERATIONS);
  const commandRunners = /const COMMAND_RUNNERS = Object\.freeze\(\{([\s\S]*?)\}\s*as const\)/.exec(src)[1];
  assert.deepEqual([...commandRunners.matchAll(/(\w+): command\((\w+)\)/g)].map((m) => [m[1], m[2]]), COMMANDS.map((c) => [c, c]));
  for (const blocked of ["listAssignedWorkForEmployee", "listEmployeeJobRoles", "setEmploymentStatus", "assignSecurityRole", "updateEmployee", "patchEmployee"]) {
    assert.equal(http.isWorkforceOperation(blocked), false, blocked);
  }
});

test("unknown operation 404, wrong method 405, wrong path 404, OPTIONS preflight with a bounded origin", async () => {
  const w = fakeWorld();
  assert.equal((await post(w, { operation: "listAssignedWorkForEmployee", input: { employeeId: "e1" } })).status, 404);
  assert.equal((await post(w, { operation: "readMyEmployeeProfile" }, {}, "/workforce/employees", "GET")).status, 405);
  assert.equal((await post(w, { operation: "readMyEmployeeProfile" }, {}, "/workforce/other")).status, 404);
  const pre = await post(w, "", { origin: "https://eos.example" }, "/workforce/employees", "OPTIONS");
  assert.deepEqual([pre.status, pre.headers["access-control-allow-origin"]], [204, "https://eos.example"]);
  const evil = await post(w, "", { origin: "https://evil.example" }, "/workforce/employees", "OPTIONS");
  assert.equal(evil.headers["access-control-allow-origin"], undefined);
  assert.equal(w.lookups.length, 0);
});

test("a missing or invalid bearer is 401 and leaks nothing from the identity provider", async () => {
  const w = fakeWorld();
  const none = await post(w, { operation: "readMyEmployeeProfile" }, { authorization: undefined });
  assert.equal(none.status, 401);
  const bad = await post(w, { operation: "readMyEmployeeProfile" }, { authorization: "Bearer nope" });
  assert.equal(bad.status, 401);
  assert.doesNotMatch(bad.body, /secret-project|AIza|argument-error/);
});

test("envelope and input: extra envelope keys, missing input on a list, array input and authority fields refuse before identity", async () => {
  const w = fakeWorld();
  assert.equal((await post(w, { operation: "readMyEmployeeProfile", tenantId: "t2" })).status, 400);
  assert.equal((await post(w, { operation: "listRecordsOwnedByEmployee" })).status, 400);
  assert.equal((await post(w, { operation: "listRecordsOwnedByEmployee", input: [] })).status, 400);
  for (const field of http.AUTHORITY_BEARING_FIELDS) {
    const res = await post(w, { operation: "listRecordsOwnedByEmployee", input: { employeeId: "e1", family: "OPPORTUNITY", [field]: "x" } });
    assert.deepEqual([res.status, parsed(res).code], [400, "AUTHORITY_FIELD_NOT_ACCEPTED"], field);
  }
  assert.equal((await post(w, "x".repeat(http.MAX_WORKFORCE_BODY_BYTES + 1))).status, 413);
  assert.equal(w.lookups.length, 0, "identity was consulted for a refused envelope");
  assert.equal(w.connects(), 0);
});

test("only the verified subject reaches Principal resolution, and the read receives the EOS Principal id, never the subject", async () => {
  const w = fakeWorld({ capabilities: [], clientQuery: () => ({ rows: [] }) });
  const res = await post(w, { operation: "readMyEmployeeProfile" });
  assert.deepEqual([res.status, parsed(res).code], [404, "EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND"]);
  assert.deepEqual(w.lookups, [{ provider: "firebase", subject: "subj-alice" }]);
  const values = w.clientStatements.flatMap((s) => s.values ?? []);
  assert.ok(values.includes("p-eos-alice"));
  assert.ok(!values.includes("subj-alice"), "the external subject reached an Employee read");
  const link = w.clientStatements.find((s) => /employee_principal_links/.test(s.text));
  assert.match(link.text, /l\.principal_id = \$2/);
  assert.deepEqual(link.values, ["t1", "p-eos-alice"]);
});

test("capability refusal and invalid input touch no database; a missing membership refuses in the transaction", async () => {
  const w = fakeWorld({ capabilities: ["opportunity.read"] });
  const noCap = await post(w, { operation: "listRecordsOwnedByEmployee", input: { employeeId: "e1", family: "SALES_ORDER" } });
  assert.deepEqual([noCap.status, parsed(noCap).code], [403, "CAPABILITY_REQUIRED"]);
  for (const family of ["ACCOUNT", "CONTACT", "ACCOUNT_LOCATION"]) {
    const crmWithOpportunityRead = await post(w, { operation: "listRecordsOwnedByEmployee", input: { employeeId: "e1", family } });
    assert.deepEqual([crmWithOpportunityRead.status, parsed(crmWithOpportunityRead).message], [403, "this read requires customer.record.read"], family);
  }
  const badFamily = await post(w, { operation: "listAccountabilitiesForEmployee", input: { employeeId: "e1", family: "ACCOUNT" } });
  assert.deepEqual([badFamily.status, parsed(badFamily).code], [400, "FAMILY_INVALID"]);
  assert.equal(w.connects(), 0);
  const notMember = fakeWorld({ member: false });
  const res = await post(notMember, { operation: "readMyEmployeeProfile" });
  assert.deepEqual([res.status, parsed(res).code], [403, "ACTOR_NOT_TENANT_MEMBER"]);
  assert.equal(notMember.clientStatements[0].text, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
});

test("each governed category maps to its exact status; a raw failure is a generic 500 that leaks nothing", async () => {
  assert.deepEqual({ ...http.STATUS_BY_CATEGORY }, { INVALID_INPUT: 400, NOT_FOUND: 404, PRECONDITION_FAILED: 412, CONFLICT: 409, FORBIDDEN: 403, FAILED: 500 });
  const raw = new Error('relation "eos_workforce.employees" does not exist password=hunter2 host=10.0.0.7');
  const w = fakeWorld({ clientQuery: (text) => { if (/employee_principal_links/.test(text)) throw raw; return { rows: [] }; } });
  const res = await post(w, { operation: "readMyEmployeeProfile" });
  assert.deepEqual([res.status, parsed(res).code, parsed(res).message], [500, "READ_FAILED", "the read could not be completed"]);
  assert.doesNotMatch(res.body, /hunter2|10\.0\.0\.7|relation|eos_workforce/);
  assert.equal(kernel.translateEmployeeReadError(raw).message, "the read could not be completed");
});

// ════════════════════ static ratchets ════════════════════

const workforceSources = () => walk(WORKFORCE, [".ts"]);

test("no Firebase or Firestore in the Workforce layer, statically and transitively", () => {
  for (const f of workforceSources()) {
    // The migration modules NAME the snapshot's source project (firebaseProjectId) as data; nothing may import or call Firebase.
    const forbidden = f.includes(`${WORKFORCE}/migration/`)
      ? [/(from|require\()\s*["'][^"']*firebase/i, /firestore/i, /getFirestore/, /verifyIdToken/, /onCall\(|onRequest\(/, /\.collection\(/]
      : [/firebase/i, /firestore/i, /getFirestore/, /verifyIdToken/, /customClaims|claims\./, /onCall\(|onRequest\(/];
    for (const pattern of forbidden) assert.doesNotMatch(code(f), pattern, `${rel(f)} matches ${pattern}`);
  }
  const sentinel = "EMP_RT_LOADED_FIREBASE";
  const preload = join(mkdtempSync(join(tmpdir(), "emp-rt-")), "preload.cjs");
  writeFileSync(preload, `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.stderr.write("${sentinel}:"+r);process.exit(97);}return l.call(this,r,...a);};`);
  const modules = workforceSources().map((f) => join(FUNCTIONS_DIR, "lib", relative(SRC, f)).replace(/\.ts$/, ".js"));
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", modules.map((m) => `require(${JSON.stringify(m)});`).join("")], { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.equal(probe.status, 0, `a Workforce module transitively loaded Firebase: ${probe.stderr}`);
});

test("the transport carries no SQL and resolves context only through resolveOperationalContext", () => {
  const src = code(HTTP_SOURCE);
  assert.doesNotMatch(src, /\bSELECT\b|\bFROM\s+eos_|\bINSERT\b|\bUPDATE\s|\bDELETE\b|eos_workforce|eos_policy\.|eos_commercial/);
  assert.match(src, /resolveOperationalContext\(deps\.reader, deps\.pool/);
  assert.doesNotMatch(src, /resolvePrincipalContext|getPrincipalBySubject/);
});

test("the reads never touch credential identity and never match an Employee by subject, uid or Principal id", () => {
  for (const f of walk(READS, [".ts"])) {
    assert.doesNotMatch(code(f), /external_subject|externalSubject|identity_provider|identityProvider|\buid\b|firebase_uid|technician/i, rel(f));
  }
  const selfRead = code(join(READS, "myEmployeeProfile.ts"));
  assert.match(selfRead, /FROM eos_policy\.employee_principal_links l\s+WHERE l\.tenant_id = \$1 AND l\.principal_id = \$2 AND l\.status = 'active'/);
  assert.match(selfRead, /FROM eos_workforce\.employees e\s+\$\{CURRENT_MANAGER_JOIN\}\s+WHERE e\.tenant_id = \$1 AND e\.id = \$2`,\s+\[tenantId, link\.employee_id\]/);
  assert.equal((selfRead.match(/eos_workforce\.employees/g) ?? []).length, 1, "a second Employee lookup path exists");
});

test("owner and accountable stay two axes over two columns; no credited salesperson, no assignment, no manager", () => {
  const src = code(join(READS, "employeeResponsibilityReads.ts"));
  assert.match(src, /RECORD_OWNER: "owner_employee_id", ACCOUNTABLE_PERSON: "accountable_employee_id"/);
  assert.match(src, /WHERE r\.tenant_id = \$1 AND r\.\$\{personColumn\} = \$2/);
  assert.doesNotMatch(src, /credited_salesperson|assignee|assigned_|technician|manager|reports_to|COALESCE/i);
  assert.deepEqual([...responsibility.EMPLOYEE_RECORD_FAMILIES], ["OPPORTUNITY", "SALES_AGREEMENT", "SALES_ORDER", "ACCOUNT", "CONTACT", "ACCOUNT_LOCATION"]);
  // Owner ruling G: CRM families are OWNER-axis only -- no CRM accountability is inferred.
  assert.deepEqual([...responsibility.ACCOUNTABLE_RECORD_FAMILIES], ["OPPORTUNITY", "SALES_AGREEMENT", "SALES_ORDER"]);
  assert.match(src, /const crm = [^\n]*\n[^\n]*\n\s*companyExpr: "NULL::text", complete: "TRUE", capability: "customer\.record\.read", handoffKey: null,/);
  for (const [family, table] of [["ACCOUNT", "eos_crm.accounts"], ["CONTACT", "eos_crm.contacts"], ["ACCOUNT_LOCATION", "eos_crm.account_locations"]]) {
    assert.match(src, new RegExp(`${family}: crm\\("${table.replace(".", "\\.")}"`), family);
  }
});

// EMP-RT-08: Job Role now has its OWN governed modules. Every OTHER Workforce read or command still produces, infers or
// names no Job Role; and the Job Role modules themselves never touch Security Role, operational roles, ownership,
// accountability, assignment, the reporting relationship or operating company.
const JOB_ROLE_MODULES = ["jobRoleReads.ts", "employeeJobRoleCommands.ts"];
// EMP-RT-H1: the governed change history NAMES every Employee audit action (Job Role and operating company included)
// because it reports them. It is ruled separately below: it changes nothing and reads no access authority.
const HISTORY_MODULE = "employeeChangeHistoryRead.ts";
test("no Job Role, Security Role or operationalRoles is produced, inferred or named anywhere in the Workforce reads or commands", () => {
  const files = [...walk(READS, [".ts"]), ...walk(join(WORKFORCE, "commands"), [".ts"])].filter((f) => !f.endsWith(HISTORY_MODULE));
  assert.deepEqual(JOB_ROLE_MODULES.map((m) => files.some((f) => f.endsWith(m))), [true, true], "the Job Role modules moved");
  for (const f of files.filter((f) => !JOB_ROLE_MODULES.some((m) => f.endsWith(m)))) {
    assert.doesNotMatch(code(f), /jobRole|job_role|JobRole|Retail Sales|National Accounts|salesperson|securityRole|heldRoleKeys|RETAIL|NATIONAL_ACCOUNTS|operationalRoles|operational_roles/, rel(f));
  }
  for (const f of files.filter((f) => JOB_ROLE_MODULES.some((m) => f.endsWith(m)))) {
    assert.doesNotMatch(code(f), /securityRole|role_capabilities|user_role_assignments|heldRoleKeys|operationalRoles|operational_roles|owner_employee_id|accountab|assignee|reporting_relationships|operating_company|salesperson/i, rel(f));
  }
});

test("capabilities: only existing read ids, each registered in the catalog AND the PostgreSQL vocabulary; none invented", () => {
  const used = new Set([...walk(READS, [".ts"]), ...walk(join(WORKFORCE, "commands"), [".ts"]), HTTP_SOURCE].flatMap((f) => [...code(f).matchAll(/"([a-zA-Z]+\.[a-zA-Z.]+)"/g)].map((m) => m[1])).filter((s) => /\.(read|write)$/.test(s)));
  assert.deepEqual([...used].sort(), ["admin.employeeJobRole.write", "admin.employeeProfile.write", "admin.principalAccess.read", "customer.record.read", "employee.record.read", "opportunity.read", "salesAgreement.read", "salesOrder.read"]);
  const catalog = readFileSync(join(SRC, "access", "permissionCatalog.ts"), "utf8");
  const migrations = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(FUNCTIONS_DIR, "migrations", f), "utf8")).join("\n");
  for (const id of used) {
    assert.ok(catalog.includes(`id: "${id}"`), `${id} is not in the permission catalog`);
    assert.ok(migrations.includes(`'${id}'`), `${id} is not in the PostgreSQL capability vocabulary`);
  }
  assert.deepEqual([...new Set([...migrations.matchAll(/'((?:workforce|employee)\.[a-zA-Z.]+)'/g)].map((m) => m[1]))], ["employee.record.read"], "an Employee/Workforce capability other than employee.record.read was registered");
});

test("server.ts composes the Workforce transport as a fourth domain with the same pool, verifier and origins, leaving other routes alone", () => {
  assert.equal(eosApiDomainFor("/workforce/employees"), "workforce");
  assert.equal(eosApiDomainFor("/workforce/employees?x=1"), "workforce");
  assert.equal(eosApiDomainFor("/commercial/sales"), "commercial");
  assert.equal(eosApiDomainFor("/operations/inventory"), "operations");
  assert.equal(eosApiDomainFor("/admin/policy"), "administration");
  assert.equal(eosApiDomainFor("/workforceX"), "administration");
  const server = strip(readFileSync(join(SRC, "eosApi", "server.ts"), "utf8"));
  assert.match(server, /createWorkforceHttpHandler\(\{\s*reader: repo,\s*pool,\s*verifyToken,\s*allowedOrigins: config\.allowedOrigins,\s*\}\)/);
  assert.deepEqual([...server.matchAll(/from "([^"]*eosWorkforce[^"]*)"/g)].map((m) => m[1]), ["../eosWorkforce/workforceHttp"]);
  assert.equal((server.match(/getPolicyDatabasePool\(\)/g) ?? []).length, 1);
});

test("nothing but the transport imports the read layer; no Functions, Rules or client reference the route", () => {
  const importers = walk(SRC, [".ts"]).filter((f) => !f.startsWith(READS) && /eosWorkforce\/reads\/|["']\.\/reads\/(employee|myEmployeeProfile)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers.map(rel), ["functions/src/eosWorkforce/workforceHttp.ts"]);
  // The reporting writer's commands module borrows only the error-category TYPE from the read kernel.
  const outsideWorkforce = walk(SRC, [".ts"]).filter((f) => !f.startsWith(WORKFORCE) && /eosWorkforce/.test(code(f)));
  assert.deepEqual(outsideWorkforce.map(rel), ["functions/src/eosApi/server.ts"]);
  // The transport is the ONE runtime importer of the internal governed commands (W1B); nothing runtime imports migration.
  const internal = walk(WORKFORCE, [".ts"]).filter((f) => /["'][./]*\/?(commands|migration)\//.test(code(f)) && !f.includes(`${WORKFORCE}/migration/`));
  assert.deepEqual(internal.map(rel), ["functions/src/eosWorkforce/workforceHttp.ts"], "a runtime Workforce module other than the transport imports the internal writer");
  assert.doesNotMatch(code(HTTP_SOURCE), /["'][./]*\/?migration\//, "the transport imports a migration module");
  const client = walk(join(REPO, "field-ops-app-vite", "src"), [".js", ".jsx", ".ts", ".tsx"]);
  // Exactly ONE dedicated Workforce API client may hold EXECUTABLE knowledge of the transport route (#1910): the route
  // string, the route constant, the server module. Employee UI modules consume that client abstraction, and they may
  // describe the architecture in comments -- which is why this scans comment-stripped source, as the checks above do.
  const ROUTE_REFERENCE = /\/workforce\/employees|workforceHttp|WORKFORCE_ROUTE|eosWorkforce/;
  assert.deepEqual(client.filter((f) => ROUTE_REFERENCE.test(code(f))).map(rel),
    ["field-ops-app-vite/src/services/workforceApiClient.js"]);
  // NON-VACUITY: the predicate still catches a real dependency. A UI module whose EXECUTABLE source builds the route
  // fails, while the same text inside a comment does not.
  const leak = join(mkdtempSync(join(tmpdir(), "workforce-ratchet-")), "LeakedRoute.jsx");
  writeFileSync(leak, 'const leaked = "/workforce/employees";\nexport default leaked;\n');
  assert.ok(ROUTE_REFERENCE.test(code(leak)), "an executable Workforce route reference no longer fails the ratchet");
  writeFileSync(leak, '// consumes the Workforce transport (/workforce/employees) through workforceApiClient\nexport default null;\n');
  assert.ok(!ROUTE_REFERENCE.test(code(leak)), "a comment naming the architecture is treated as a dependency");
  assert.doesNotMatch(readFileSync(join(REPO, "firestore.rules"), "utf8"), /workforce\/employees|eosWorkforce/);
});

// ════════════════════ EMP-RT-H1: governed Employee change history ════════════════════

const history = require("../lib/eosWorkforce/reads/employeeChangeHistoryRead.js");

test("EMP-RT-H1 history: the closed action list is exactly the governed commands' Employee audit actions", () => {
  const profileCmd = require("../lib/eosWorkforce/commands/employeeProfileCommand.js");
  const lifecycle = require("../lib/eosWorkforce/commands/employeeLifecycleCommand.js");
  const jobRoleCmd = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
  assert.deepEqual([...history.EMPLOYEE_CHANGE_HISTORY_ACTIONS], [
    profileCmd.EMPLOYEE_PROFILE_UPDATE_ACTION,
    "employee.reportingRelationship.establish",
    "employee.reportingRelationship.end",
    lifecycle.EMPLOYMENT_STATUS_CHANGE_ACTION,
    lifecycle.OPERATING_COMPANY_CHANGE_ACTION,
    jobRoleCmd.JOB_ROLE_ASSIGN_ACTION,
  ]);
  // Every action a Workforce command audits against an Employee is in the list, and nothing else is.
  const commandSources = walk(join(WORKFORCE, "commands"), [".ts"]).map(code).join("\n");
  const audited = new Set([...commandSources.matchAll(/"(employee\.[a-zA-Z]+\.[a-zA-Z]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...audited].sort(), [...history.EMPLOYEE_CHANGE_HISTORY_ACTIONS].sort());
});

test("EMP-RT-H1 history: read-only, no Principal identity returned, no access authority read, employee.record.read gate", () => {
  const src = code(join(READS, HISTORY_MODULE));
  assert.doesNotMatch(src, /\bINSERT\b|\bUPDATE\s|\bDELETE\b|FOR UPDATE|FOR SHARE/);
  assert.doesNotMatch(src, /role_capabilities|user_role_assignments|employee_principal_links|securityRole|operationalRoles|owner_employee_id|accountab|salesperson/i);
  // actor_uid is used ONLY as a join key, never selected; the only principals column read is display_name.
  assert.equal((src.match(/actor_uid/g) ?? []).length, 1);
  assert.match(src, /LEFT JOIN eos_policy\.principals pr ON pr\.id = a\.actor_uid/);
  assert.deepEqual([...src.matchAll(/\bpr\.(\w+)/g)].map((m) => m[1]).sort(), ["display_name", "id"]);
  assert.match(src, /\(\) => \[EMPLOYEE_RECORD_READ\]/);
  assert.match(src, /a\.tenant_id = \$1 AND a\.target_kind = 'employee' AND a\.target_id = \$2 AND a\.action = ANY\(\$3::text\[\]\)/);
});

test("EMP-RT-H1 history: missing employee.record.read and invalid input refuse before the database", async () => {
  for (const [caps, input, status, code_] of [
    [["opportunity.read"], { employeeId: "e1" }, 403, "CAPABILITY_REQUIRED"],
    [["employee.record.read"], {}, 400, "EMPLOYEE_ID_REQUIRED"],
    [["employee.record.read"], { employeeId: "e1", limit: 9999 }, 400, "PAGE_SIZE_INVALID"],
    [["employee.record.read"], { employeeId: "e1", cursor: "garbage" }, 400, "CURSOR_INVALID"],
    [["employee.record.read"], { employeeId: "e1", action: "tenant.operatingCompanies.reconcile" }, 400, "INPUT_FIELD_NOT_ACCEPTED"],
  ]) {
    const w = fakeWorld({ capabilities: caps });
    const res = await post(w, { operation: "listEmployeeChangeHistory", input });
    assert.deepEqual([res.status, parsed(res).code], [status, code_], JSON.stringify(input));
    assert.equal(w.connects(), 0);
  }
  // A cursor minted for one Employee cannot reposition another Employee's history.
  const foreign = kernel.encodeEmployeeCursor("change-history:e2", { number: "2026-01-01T00:00:00.000000Z", id: "audit_x" });
  const w = fakeWorld({ capabilities: ["employee.record.read"] });
  assert.equal(parsed(await post(w, { operation: "listEmployeeChangeHistory", input: { employeeId: "e1", cursor: foreign } })).code, "CURSOR_INVALID");
});

test("RETIRED: the legacy updateEmployeeProfile Firebase callable is not exported; the legacy history read still is", () => {
  const index = code(join(SRC, "index.ts"));
  assert.doesNotMatch(index, /\bupdateEmployeeProfile\b/);
  assert.match(index, /listRecordChangeHistory,\s*\} from "\.\/access\/administrationUsersCallables"/);
  const callables = code(join(SRC, "access", "administrationUsersCallables.ts"));
  assert.doesNotMatch(callables, /updateEmployeeProfile|employeeProfileCommands/);
});
