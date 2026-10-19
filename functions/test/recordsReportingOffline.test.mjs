// RECORDS AND REPORTING ON EOS -- the OFFLINE contracts (Firebase exit B4, DECISIONS #B4). No database.
//   1. The migration registers EXACTLY the Firebase catalog's report ids (minus the one with an EOS twin) plus performance.goal.read -- and GRANTS NOTHING.
//   2. The Firebase holders those registrations will be mirrored to (the separate, Owner-authorized grant change) are the counts DECISIONS #B4 records.
//   3. The new operations are routed, closed, and not behind the Reorder boundary.
//   4. The report fields the sandbox withholds are the fields the EOS engine withholds.
//   5. The new modules reach no Firebase and no Firebase-era report engine; the two doors are earned by the mirrored keys.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const { ENVIRONMENT_ACTIVATION_REGISTRY } = require("../lib/access/environmentCapabilityOverrides.js");
const http = require("../lib/eosOps/eosOpsHttp.js");
const reports = require("../lib/eosOps/reportOperations.js");
const authority = require("../lib/eosOps/experienceAuthority.js");

const MIGRATION = "migrations/1764640000000_records-reporting-on-eos.sql";
const code = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/^\s*--.*$/gm, "");
// TypeScript source with its comments removed (the modules discuss Firebase at length; only CODE may not reach it).
const tsCode = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const REGISTERED = PERMISSION_CATALOG.map((p) => p.id).filter((id) => (id.startsWith("report.") && id !== "report.definition.read") || id === "performance.goal.read").sort();

test("the migration registers exactly the Firebase report ids (report.definition.read has an EOS twin) plus performance.goal.read, each on a unique (object, action) cell", () => {
  const sql = code(MIGRATION);
  const insert = sql.slice(sql.indexOf("INSERT INTO capabilities"), sql.indexOf("ON CONFLICT (key) DO NOTHING"));
  const rows = [...insert.matchAll(/\('(cap_[A-Za-z0-9_]+)', '([A-Za-z.]+)',\s*'(?:[^']|'')*',\s*'([A-Za-z]+)', '([A-Za-z]+)', '([A-Z_]+)', '(?:[^']|'')*'\)/g)];
  assert.deepEqual(rows.map((m) => m[2]).sort(), REGISTERED);
  assert.equal(REGISTERED.length, 39, "38 report ids + performance.goal.read");
  assert.equal(new Set(rows.map((m) => `${m[3]}/${m[4]}`)).size, rows.length, "UNIQUE (object_key, action_key)");
  assert.equal(new Set(rows.map((m) => m[1])).size, rows.length);
  assert.deepEqual([...new Set(rows.map((m) => m[3]))].sort(), ["performanceGoal", "report", "reportDefinition"]);
  assert.deepEqual([...new Set(rows.map((m) => m[5]))], ["BUSINESS_ACTION"], "no CRED verb is derived");
  assert.ok(!REGISTERED.includes("report.definition.read"), "its EOS twin is reportDefinition.read (migration 1762300800000)");
  assert.ok(PERMISSION_CATALOG.some((p) => p.id === "report.definition.read"));
});

test("THIS migration grants nothing: registering a key is not granting it, and the 122 mirrored grants are a separate, Owner-authorized change", () => {
  const sql = code(MIGRATION);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+(?:eos_policy\.)?role_capabilities/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+(?:eos_policy\.)?principal_capabilities/i);
  assert.doesNotMatch(sql, /granted_by/i);
  for (const table of ["imported_service_history", "data_import_jobs", "report_definitions", "performance_goals"]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`), table);
    assert.match(sql, new RegExp(`DROP TABLE eos_ops\\.${table};`), table);
  }
  // The down refuses to destroy business records or Administration decisions.
  assert.match(sql, /refuses to reverse -- % imported service history record/);
  assert.match(sql, /refuses to reverse -- % Role grant\(s\) hold a reporting or goal capability/);
});

test("the Firebase holders the follow-up grant change will mirror: admin and owner all 38, reportViewer 26, reportFinanceViewer 5, reportAuthor 3; performance.goal.read twelve Roles (122 pairs)", () => {
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const held = new Map();
  for (const [roleId, r] of Object.entries(roles)) {
    const ids = REGISTERED.filter((id) => r.permissions.includes(id));
    if (ids.length) held.set(roleId, ids);
  }
  const reportOnly = (ids) => ids.filter((i) => i.startsWith("report."));
  assert.deepEqual(
    [...held].map(([r, ids]) => [r, reportOnly(ids).length]).filter(([, n]) => n > 0).sort(),
    [["admin", 38], ["owner", 38], ["reportAuthor", 3], ["reportFinanceViewer", 5], ["reportViewer", 26]].sort());
  assert.deepEqual([...held].filter(([, ids]) => ids.includes("performance.goal.read")).map(([r]) => r).sort(), [
    "admin", "fieldManager", "generalManager", "operationsManager", "owner", "partsAssociate", "partsManager", "performanceGoalSubject",
    "salesManager", "salesperson", "warehouseAssociate", "warehouseManager"]);
  assert.equal([...held.values()].reduce((n, ids) => n + ids.length, 0), 122);
  // reportAuthor never deletes; reportViewer never writes or reads a sensitive field.
  assert.ok(!held.get("reportAuthor").includes("report.definition.delete"));
  assert.ok(held.get("reportViewer").every((id) => !/definition\.(create|rename|duplicate|delete)|paymentTerms|taxStatus|customer\.field\.notes|accountOwner|accessNotes/.test(id)));
});

test("the 14 new operations are in the closed Operations lists, routed to /operations/inventory, and NOT behind the Reorder activation boundary", async () => {
  const READ = ["listImportedServiceHistory", "listDataImportJobs", "listSavedReportDefinitions", "readSavedReportDefinition", "runReportDefinition",
    "listCurrentPerformanceGoals", "listPerformanceGoalVersions", "listGoalSubjects"];
  const WRITE = ["stageDataImport", "executeDataImport", "createSavedReportDefinition", "renameSavedReportDefinition", "duplicateSavedReportDefinition", "deleteSavedReportDefinition"];
  for (const op of READ) assert.ok(http.OPERATIONS_READ_OPERATIONS.includes(op), op);
  for (const op of WRITE) assert.ok(http.OPERATIONS_MUTATION_OPERATIONS.includes(op), op);
  for (const op of [...READ, ...WRITE]) {
    assert.equal(http.OPERATIONS_ROUTE_BY_OPERATION[op], "/operations/inventory", op);
    assert.equal(http.isOperationsOperation(op), true, op);
  }
  const untouchable = new Proxy({}, { get: () => { throw new Error("DEPS_TOUCHED"); } });
  for (const operation of [...READ, ...WRITE]) {
    const r = await http.executeOperation({ reader: untouchable, pool: untouchable, reorderPostgresActive: false },
      { caller: { externalSubject: "x", identityProvider: "firebase", requestedTenantId: null }, operation, input: {} }).catch((e) => e);
    assert.notEqual(r && r.code, "PRECONDITION_FAILED", `${operation} is its own authority, not behind the Reorder boundary`);
  }
  // The client transport mirrors name every one, so a typo fails here rather than as a 404.
  const client = readFileSync("../field-ops-app-vite/src/services/reorderApiClient.js", "utf8");
  for (const op of [...READ, ...WRITE]) assert.match(client, new RegExp(`"${op}"`), op);
});

test("the three report fields Firebase never activates are exactly the ones the EOS engine withholds", () => {
  const sandbox = ENVIRONMENT_ACTIVATION_REGISTRY.environments.find((e) => e.firebase?.projectId === "eos-platform-sandbox");
  const active = new Set(sandbox.capabilityActivationOverrides);
  const reportIds = PERMISSION_CATALOG.map((p) => p.id).filter((id) => id.startsWith("report."));
  const withheld = reportIds.filter((id) => !active.has(id)).sort();
  assert.deepEqual(withheld, ["report.customer.field.accountOwner.read", "report.customer.field.notes.read", "report.location.field.accessNotes.read"]);
  assert.deepEqual([...reports.INACTIVE_REPORT_CAPABILITIES].sort(), withheld);
  assert.equal(reports.REPORT_DEFINITION_CAPABILITIES.read, "reportDefinition.read");
});

test("Report Builder and Saved Reports are earned by the mirrored keys (a door confers nothing)", () => {
  const surfaces = new Map(authority.EXPERIENCE_SURFACES.map((s) => [s.key, s]));
  assert.deepEqual(surfaces.get("reporting.builder").grants.map((g) => g.capabilityKey),
    ["report.customer.read", "report.contact.read", "report.location.read", "report.equipment.read"]);
  assert.deepEqual(surfaces.get("reporting.savedReports").grants.map((g) => g.capabilityKey), ["reportDefinition.read"]);
  const client = readFileSync("../field-ops-app-vite/src/access/experienceContext.js", "utf8");
  for (const key of ["reporting.builder", "reporting.savedReports"]) assert.match(client, new RegExp(`"${key}"`), key);
});

test("the new modules reach no Firebase and no Firebase-era engine; a run is audited without row data", () => {
  const files = ["recordsSupport", "importedServiceHistory", "dataImportOperations", "reportOperations", "performanceGoalReads"].map((n) => `src/eosOps/${n}.ts`);
  for (const f of files) {
    const text = tsCode(f);
    assert.doesNotMatch(text, /firebase|reportExecutionService|savedDefinitionCommands|performanceGoalReadService|dataImportCallables|importedServiceHistoryReadService/i, f);
  }
  // The audit payload of a run names counts and field ids, never a value read from a record.
  const run = tsCode("src/eosOps/reportOperations.ts");
  const at = run.indexOf("await audit(\"applied\"");
  assert.ok(at > 0);
  const applied = run.slice(at, run.indexOf("});", at) + 3);
  assert.match(applied, /rowCount, truncated/);
  assert.doesNotMatch(applied, /\brows\b|projected|aggregateRows|cappedAggregates/);
  assert.equal(readdirSync("src/eosOps").filter((n) => /^(recordsSupport|importedServiceHistory|dataImportOperations|reportOperations|performanceGoalReads)\.ts$/.test(n)).length, 5);
});
