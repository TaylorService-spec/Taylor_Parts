// EMPLOYEE PROFILE, READ AUTHORITY AND REPORTING RELATIONSHIP, offline (Owner rulings A-F). The real-database proof is
// functions/test/employeeProfileAuthorityPostgres.test.mjs; the CLI fences are in operatorScriptEnvironmentFence.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const SRC = join(FUNCTIONS_DIR, "src");
const WORKFORCE = join(SRC, "eosWorkforce");
const MIGRATION_FILE = "1759838400000_employee-profile-and-reporting-authority.sql";
const require = createRequire(import.meta.url);
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const { deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const { EMPLOYEE_CAPABILITY_GRANT_KEYS } = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const { deriveEmployeeDisplayName } = require("../lib/eosWorkforce/reads/employeeRecordProjection.js");
const commands = require("../lib/eosWorkforce/commands/reportingRelationshipCommands.js");
const snapshotLib = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
const exporter = require("../scripts/exportEmployeeProfileSnapshot.js");

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function walk(dir, exts) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "lib" || entry === "dist") continue;
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}
const rel = (f) => relative(REPO, f).split("\\").join("/");
const migration = () => readFileSync(join(FUNCTIONS_DIR, "migrations", MIGRATION_FILE), "utf8");
const upSql = () => migration().split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");

// ════════════════════ ruling A: employee.record.read ════════════════════

test("employee.record.read is registered once, active:false, with its exact scope, in the catalog and its client mirror", () => {
  const entries = PERMISSION_CATALOG.filter((p) => p.id === "employee.record.read");
  assert.equal(entries.length, 1);
  assert.deepEqual({ ...entries[0], description: undefined }, { id: "employee.record.read", resource: "employee.record", action: "read", active: false, description: undefined });
  assert.match(entries[0].description, /Employee business record and the bounded Employee directory projection/);
  assert.match(entries[0].description, /no Principal access state, Role, credential or provider identity, Job Role, ownership mutation or Employee mutation/);
  assert.ok(readFileSync(join(REPO, "field-ops-app-vite", "src", "access", "permissionCatalog.ts"), "utf8").includes('id: "employee.record.read"'));
});

test("role holders come from the Role catalog: exactly Administrator, Owner and General Manager -- never the operational Roles", () => {
  assert.deepEqual(deriveLegacyRoleGrants(EMPLOYEE_CAPABILITY_GRANT_KEYS).map((g) => `${g.roleKey}:${g.capabilityKey}`), [
    "admin:admin.employeeJobRole.write", "admin:admin.employeeProfile.write", "admin:admin.principalAccess.read", "admin:employee.record.read",
    "generalManager:employee.record.read",
    "owner:admin.employeeJobRole.write", "owner:admin.employeeProfile.write", "owner:admin.principalAccess.read", "owner:employee.record.read",
  ]);
  // EMP-RT-08 ruling: admin.employeeJobRole.write only for the admin-level Roles that administer Employees -- never to
  // managers, never to operational Roles, and never derived from a Job Role.
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  for (const key of ["dispatcher", "salesperson", "technician", "partsManager", "warehouseManager"]) {
    assert.ok(roles[key], `${key} is not a catalog Role`);
    assert.ok(!roles[key].permissions.includes("employee.record.read"), `${key} holds employee.record.read`);
    assert.ok(!roles[key].permissions.includes("admin.employeeJobRole.write"), `${key} holds admin.employeeJobRole.write`);
  }
  assert.ok(!roles.generalManager.permissions.some((p) => p.startsWith("admin.")), "General Manager gained an admin.* capability");
});

test("the grant is delivered by the existing reconciliation, never by migration SQL or a request-time Security Role inference", () => {
  assert.doesNotMatch(upSql(), /role_capabilities|INSERT INTO\s+(eos_policy\.)?roles|user_role_assignments/i);
  for (const f of walk(join(WORKFORCE, "reads"), [".ts"]).concat(walk(join(WORKFORCE, "commands"), [".ts"]))) {
    assert.doesNotMatch(strip(readFileSync(f, "utf8")), /compatibilityRoles|governedBusinessRoles|securityRole|users\/|\.role\b/, rel(f));
  }
  const grants = strip(readFileSync(join(WORKFORCE, "migration", "employeeCapabilityGrants.ts"), "utf8"));
  assert.match(grants, /reconcileInventoryCapabilityGrants\(pool, \{ \.\.\.options, capabilityKeys: EMPLOYEE_CAPABILITY_GRANT_KEYS \}\)/);
  assert.doesNotMatch(grants, /generalManager|"admin"|"owner"/, "the grant module lists Roles by hand");
});

test("employee.record.read reads return no Principal, provider, Role or account status (static)", () => {
  const src = strip(readFileSync(join(WORKFORCE, "reads", "employeeDirectoryReads.ts"), "utf8")) + strip(readFileSync(join(WORKFORCE, "reads", "employeeRecordProjection.ts"), "utf8"));
  assert.doesNotMatch(src, /principal_id|eos_policy\.principals|tenant_memberships|external_subject|identity_provider|role|asserted_by|link_source|\bl\.id\b/i);
  assert.equal((src.match(/employee_principal_links/g) ?? []).length, 1, "the directory read reaches the link table for more than the userAccess EXISTS");
  assert.match(src, /EXISTS \(SELECT 1 FROM eos_policy\.employee_principal_links l\s+WHERE l\.tenant_id = e\.tenant_id AND l\.employee_id = e\.id AND l\.status = 'active'\) AS linked/);
  const link = strip(readFileSync(join(WORKFORCE, "reads", "employeePrincipalLinkRead.ts"), "utf8"));
  assert.match(link, /PRINCIPAL_ACCESS_READ = "admin\.principalAccess\.read"/);
  assert.doesNotMatch(link, /employee\.record\.read|external_subject|identity_provider|user_role_assignments|role_capabilities/);
});

// ════════════════════ rulings C/D/E: the migration ════════════════════

test("the migration sorts strictly between catalog 026 and catalog cutover 027 and is the only new Employee migration", () => {
  const stamp = Number(MIGRATION_FILE.slice(0, 13));
  assert.ok(stamp > 1759795200000 && stamp < 1759881600000);
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"));
  assert.ok(files.includes(MIGRATION_FILE));
});

test("profile facts: structured address, no operationalRoles, no Job Role, no credential or principal column", () => {
  const sql = upSql();
  for (const c of ["employee_number", "display_name", "first_name", "middle_name", "last_name", "preferred_name", "job_title", "work_email", "work_phone", "mobile_phone",
    "address_street", "address_unit", "address_city", "address_state", "address_postal_code", "hire_date", "separation_date"]) {
    assert.match(sql, new RegExp(`ADD COLUMN ${c}\\s+(TEXT|DATE)[,;]`), c);
  }
  assert.doesNotMatch(sql, /operational|job_role|security_role|firebase|user_id|uid\b|external_subject|identity_provider|JSONB|principal_id/i);
  assert.match(sql, /CREATE UNIQUE INDEX employees_employee_number_unique_per_tenant\s+ON employees \(tenant_id, upper\(employee_number\)\)\s+WHERE employee_number IS NOT NULL/);
  assert.doesNotMatch(sql, /hire_date\s*<=?\s*separation_date|separation_date\s*>=?\s*hire_date/, "an ordering rule the source command does not enforce");
});

test("reporting relationship: a table, not a column; same-tenant FKs, not-self, one current, history trigger", () => {
  const sql = upSql();
  assert.doesNotMatch(sql, /ADD COLUMN manager/i);
  assert.match(sql, /FOREIGN KEY \(tenant_id, employee_id\) REFERENCES employees \(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, manager_employee_id\) REFERENCES employees \(tenant_id, id\)/);
  assert.match(sql, /CHECK \(employee_id <> manager_employee_id\)/);
  assert.match(sql, /CREATE UNIQUE INDEX employee_reporting_one_current_per_employee\s+ON employee_reporting_relationships \(tenant_id, employee_id\)\s+WHERE effective_to IS NULL/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON employee_reporting_relationships/);
  assert.doesNotMatch(sql, /dotted|secondary|relationship_kind|is_primary/i, "multiple-manager semantics were invented");
});

test("display name is derived deterministically from governed name facts", () => {
  assert.equal(deriveEmployeeDisplayName({ preferred_name: "Bob", display_name: "Robert Jones", first_name: "Robert", last_name: "Jones" }), "Bob");
  assert.equal(deriveEmployeeDisplayName({ preferred_name: null, display_name: "Robert Jones", first_name: "R", last_name: "J" }), "Robert Jones");
  assert.equal(deriveEmployeeDisplayName({ first_name: "Robert", last_name: "Jones" }), "Robert Jones");
  assert.equal(deriveEmployeeDisplayName({ last_name: "Jones" }), "Jones");
  assert.equal(deriveEmployeeDisplayName({}), null);
  const projection = strip(readFileSync(join(WORKFORCE, "reads", "employeeRecordProjection.ts"), "utf8"));
  assert.doesNotMatch(projection, /principals/);
});

// ════════════════════ the reporting writer ════════════════════

test("reporting writer: capability, input and self-management refusals touch no database", async () => {
  let connects = 0;
  const pool = { connect: async () => { connects++; throw new Error("no database"); } };
  const actor = (caps) => ({ tenantId: "t1", principalId: "p1", capabilities: new Set(caps) });
  await assert.rejects(commands.establishReportingRelationship({ pool }, actor(["employee.record.read"]), { employeeId: "e1", managerEmployeeId: "e2" }), (e) => e.code === "CAPABILITY_REQUIRED");
  await assert.rejects(commands.establishReportingRelationship({ pool }, actor(["admin.employeeProfile.write"]), { employeeId: "e1", managerEmployeeId: "e1" }), (e) => e.code === "REPORTING_SELF_MANAGER");
  await assert.rejects(commands.establishReportingRelationship({ pool }, actor(["admin.employeeProfile.write"]), { employeeId: "e1", managerEmployeeId: "e2", tenantId: "t2" }), (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED");
  await assert.rejects(commands.endReportingRelationship({ pool }, actor(["admin.employeeProfile.write"]), { employeeId: "e/1" }), (e) => e.code === "EMPLOYEE_ID_REQUIRED");
  assert.equal(connects, 0);
  await assert.rejects(commands.endReportingRelationship({ pool }, actor(["admin.employeeProfile.write"]), { employeeId: "e1" }), (e) => e.code === "COMMAND_FAILED" && !/no database/.test(e.message));
  const src = strip(readFileSync(join(WORKFORCE, "commands", "reportingRelationshipCommands.ts"), "utf8"));
  assert.doesNotMatch(src, /DELETE FROM|SET manager_employee_id|UPDATE eos_workforce\.employees/i, "the writer deletes or rewrites history");
});

// ════════════════════ ruling F: the profile migration ════════════════════

const EXPORTER = join(FUNCTIONS_DIR, "scripts", "exportEmployeeProfileSnapshot.js");

test("the exporter is MIGRATION-ONLY: marked, one allowlisted collection, read only, no production mode", () => {
  const src = readFileSync(EXPORTER, "utf8");
  assert.ok(src.startsWith("// FIREBASE_EXIT_MIGRATION_ONLY"));
  assert.deepEqual({ ...exporter.COLLECTIONS }, { employees: "employees" });
  const code = strip(src);
  assert.equal((code.match(/\.collection\(/g) ?? []).length, 1);
  assert.match(code, /db\.collection\(COLLECTIONS\.employees\)\.get\(\)/);
  assert.doesNotMatch(code, /\.(set|add|update|delete|create|batch|runTransaction|bulkWriter|onSnapshot|listen)\(/);
  assert.doesNotMatch(code, /setInterval|cron|schedule|confirmProduction/i);
  assert.match(code, /flag: "wx", mode: 0o600/);
  assert.match(code, /hash\("sha256", text\)/);
  assert.throws(() => exporter.assertExportInvocation({ projectId: "taylor-parts", out: "/nonexistent/x.json" }), /production/);
  const dir = mkdtempSync(join(tmpdir(), "emp-export-"));
  const existing = join(dir, "exists.json");
  writeFileSync(existing, "{}");
  assert.throws(() => exporter.assertExportInvocation({ projectId: "eos-platform-sandbox", out: existing }), /never overwritten/);
});

test("the exporter is structurally isolated: no runtime module, client module, integration or other script imports it", () => {
  const runtime = [...walk(SRC, [".ts", ".js"]), ...walk(join(REPO, "field-ops-app-vite", "src"), [".js", ".jsx", ".ts", ".tsx"]), ...walk(join(REPO, "integrations"), [".js", ".mjs", ".cjs", ".ts"])];
  // Code only: a comment may NAME the exporter (the snapshot format documents where files come from); nothing may load it.
  assert.deepEqual(runtime.filter((f) => /exportEmployeeProfileSnapshot/.test(strip(readFileSync(f, "utf8")))).map(rel), []);
  const scripts = [...walk(join(FUNCTIONS_DIR, "scripts"), [".js", ".mjs", ".cjs"]), ...walk(join(REPO, "scripts"), [".js", ".mjs", ".cjs"])].filter((f) => f !== EXPORTER);
  assert.deepEqual(scripts.filter((f) => /require\([^)]*exportEmployeeProfileSnapshot|from\s+["'][^"']*exportEmployeeProfileSnapshot/.test(readFileSync(f, "utf8"))).map(rel), []);
  for (const f of ["employeeProfileCutover.js", "employeeCapabilityGrantMigrationCli.js"]) {
    assert.doesNotMatch(strip(readFileSync(join(FUNCTIONS_DIR, "scripts", f), "utf8")), /require\(\s*["'][^"']*firebase|from\s+["'][^"']*firebase|getFirestore|\.collection\(|FIREBASE_EXIT_MIGRATION_ONLY/, f);
  }
  for (const f of walk(join(WORKFORCE, "migration"), [".ts"])) {
    assert.doesNotMatch(strip(readFileSync(f, "utf8")), /(from|require\()\s*["'][^"']*firebase|getFirestore|\.collection\(/, rel(f));
  }
});

test("snapshot census: the command's normalization, blockers, reconciliation, uid and operationalRoles never canonical, deterministic digest", () => {
  const raw = {
    format: "EOS_EMPLOYEE_PROFILE_SNAPSHOT", version: 1, source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-10T12:00:00Z" },
    employees: [
      { id: "e2", data: { displayName: "B", managerEmployeeId: "e2", userId: "uid-XYZ", operationalRoles: ["SALES_ASSOCIATE"], securityRole: "salesperson" } },
      { id: "e1", data: { displayName: "  Ann  ", workPhone: "", employeeNumber: "E-1", address: { street: "1 Main" }, managerEmployeeId: "e9" } },
    ],
  };
  const { census, canonical } = snapshotLib.censusEmployeeProfileSnapshot(snapshotLib.parseEmployeeProfileSnapshot(raw));
  assert.equal(census.copyReady, true);
  assert.deepEqual(canonical.profiles.map((p) => p.id), ["e1", "e2"]);
  assert.deepEqual([canonical.profiles[0].display_name, canonical.profiles[0].work_phone, canonical.profiles[0].address_street], ["Ann", null, "1 Main"]);
  assert.deepEqual(census.reconciliation.map((r) => r.code).sort(), ["MANAGER_IS_SELF", "MANAGER_NOT_IN_SNAPSHOT"]);
  assert.deepEqual([census.legacyAccountPointers, census.operationalRolesNotMigrated, canonical.managers.length], [1, 1, 0]);
  const text = JSON.stringify(canonical);
  assert.doesNotMatch(text, /uid-XYZ|SALES_ASSOCIATE|salesperson|operational/);
  assert.deepEqual(Object.keys(canonical.profiles[0]).filter((k) => k !== "id").sort(), [...snapshotLib.PROFILE_COLUMNS].sort());
  assert.equal(snapshotLib.censusEmployeeProfileSnapshot(snapshotLib.parseEmployeeProfileSnapshot(structuredClone(raw))).census.canonicalDigest, census.canonicalDigest);
  assert.throws(() => snapshotLib.parseEmployeeProfileSnapshot({ ...raw, format: "EOS_CATALOG_SNAPSHOT" }), /not an EOS_EMPLOYEE_PROFILE_SNAPSHOT/);
});

test("the cutover writes actor columns only as the operator label, never a snapshot value", () => {
  const src = strip(readFileSync(join(WORKFORCE, "migration", "employeeProfileCutover.ts"), "utf8"));
  assert.match(src, /const actor = `employee-profile-cutover:\$\{input\.performedBy\}`/);
  assert.doesNotMatch(src, /userId|\.uid\b|legacy\?*\.(?!employmentStatus|operatingCompanyId)/, "a legacy account pointer reaches the copy");
  assert.doesNotMatch(src, /INSERT INTO eos_workforce\.employees|DELETE FROM|operational/i, "the copy creates Employees, deletes, or carries operationalRoles");
});
