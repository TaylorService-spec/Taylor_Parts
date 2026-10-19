// RECORDS AND REPORTING OFF FIREBASE (Firebase exit B4, DECISIONS #B4) -- the EOS clients and the proof that no Firebase call remains on the EOS path.
// Run: node --test test/recordsReportingEos.test.mjs
//
//   1. Imported service history: one operation, the Firebase source's result shape, `denied` kept distinct, a malformed answer an ERROR (never an empty history).
//   2. Data Import: stage / execute / list over the Operations transport, the approval sent explicitly, a refusal on authority keeping the code the screen branches on.
//   3. Report Builder: a run resolves the server's outcome payload or throws a Firebase-style coded error, so the UNCHANGED pure mappers decide every state.
//   4. Saved Reports: the six methods, list unwrapped from { items }, coded errors the unchanged outcome mapper understands.
//   5. Performance goals: the three reads with `{ result } | { errorStatus }`, an empty target list never round-trips, a malformed answer is UNAVAILABLE.
//   6. THE FAILING-SPY PINS: where an EOS API is declared each source is chosen at BUILD time, and the EOS client module imports nothing from Firebase.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECORDS_OPERATIONS, createImportedHistoryClient, createDataImportClient, createReportRunClient, createSavedReportClient,
  createPerformanceGoalClient, firebaseStyleCode,
} from "../src/services/eosRecordsClients.js";
import { mapServiceOutcome, mapCallableError } from "../src/domain/reporting/reportRunOutcome.js";
import { mapSavedDefinitionError, SAVED_DEFINITION_OUTCOME } from "../src/domain/reporting/savedReportServiceOutcome.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.join(here, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const strip = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

/** A server stand-in: answers per operation and records every call. A value with ok:false is returned as the failure it is. */
function server(answers) {
  const calls = [];
  const call = async (operation, input) => {
    calls.push([operation, input]);
    const a = answers[operation];
    const v = typeof a === "function" ? a(input) : a;
    if (v instanceof Error) throw v;
    return v?.ok === false ? v : { ok: true, result: v };
  };
  return { call, calls };
}
const failure = (code, reason = null, message = "secret detail /internal/path") => ({ ok: false, code, reason, message });

// ════════════════════ 1. IMPORTED SERVICE HISTORY ════════════════════

test("imported history: one operation, the Firebase source's shape; `denied` is distinct from an error; a malformed answer is an error, never an empty history", async () => {
  const rows = [{ id: "SH-1", recordKind: "IMPORTED_SERVICE_HISTORY", serviceDate: "2024-03-05", summary: "Replaced compressor" }];
  const s = server({ [RECORDS_OPERATIONS.importedHistory]: (input) => (input.accountId === "a-ok" ? { accountId: "a-ok", rows, truncated: true } : failure("FORBIDDEN", "CAPABILITY_REQUIRED")) });
  const fetchHistory = createImportedHistoryClient({ call: s.call });
  assert.deepEqual(await fetchHistory("a-ok", 25), { ok: true, rows, truncated: true });
  assert.deepEqual(s.calls[0], ["listImportedServiceHistory", { accountId: "a-ok", limit: 25 }]);
  assert.deepEqual(await fetchHistory("a-no"), { ok: false, code: "denied", rows: [], truncated: false });
  assert.deepEqual(s.calls[1][1], { accountId: "a-no" }, "no limit sent when none was stated");
  for (const bad of [{ rows: "nope" }, {}, null]) {
    const r = await createImportedHistoryClient({ call: server({ [RECORDS_OPERATIONS.importedHistory]: bad }).call })("a");
    assert.deepEqual([r.ok, r.code, r.rows], [false, "error", []], JSON.stringify(bad));
  }
  const unreachable = await createImportedHistoryClient({ call: async () => { throw new Error("boom"); } })("a");
  assert.deepEqual([unreachable.ok, unreachable.code], [false, "error"]);
  assert.equal((await createImportedHistoryClient({ call: server({ [RECORDS_OPERATIONS.importedHistory]: failure("INTERNAL") }).call })("a")).code, "error");
});

// ════════════════════ 2. DATA IMPORT ════════════════════

test("Data Import: only the stated fields travel; the approval is explicit; a refusal on authority keeps the code the screen already branches on", async () => {
  const s = server({
    stageDataImport: { staged: true, job: { jobId: "IMP-1", entityType: "SERVICE_HISTORY", rows: [] } },
    executeDataImport: { job: { jobId: "IMP-1", status: "COMPLETED" } },
    listDataImportJobs: { jobs: [], companies: [{ key: "sample-co", name: "Taylor" }], limits: {} },
  });
  const client = createDataImportClient({ call: s.call });
  const staged = await client.stage({ fileName: "h.csv", fileText: "a,b", operatingCompanyKey: "sample-co" });
  assert.deepEqual(staged, { ok: true, data: { staged: true, job: { jobId: "IMP-1", entityType: "SERVICE_HISTORY", rows: [] } } });
  assert.deepEqual(s.calls[0], ["stageDataImport", { fileName: "h.csv", fileText: "a,b", operatingCompanyKey: "sample-co" }], "no null placeholder is sent");
  await client.stage({ fileName: "h.xlsx", fileBase64: "AAAA", entityType: "SERVICE_HISTORY", mapping: { Customer: "customerName" } });
  assert.deepEqual(s.calls[1][1], { fileName: "h.xlsx", fileBase64: "AAAA", entityType: "SERVICE_HISTORY", mapping: { Customer: "customerName" } });
  await client.execute("IMP-1");
  assert.deepEqual(s.calls[2], ["executeDataImport", { jobId: "IMP-1", approved: true }], "naming a job is not an approval; `approved: true` is sent explicitly");
  assert.deepEqual((await client.list()).data.companies, [{ key: "sample-co", name: "Taylor" }]);

  const refuse = (code, reason) => createDataImportClient({ call: server({ stageDataImport: failure(code, reason, "This import cannot continue.") }).call }).stage({ fileName: "h.csv", fileText: "x" });
  assert.deepEqual(await refuse("FORBIDDEN", "CAPABILITY_REQUIRED"), { ok: false, code: "permission-denied", message: "This import cannot continue.", details: null });
  assert.equal((await refuse("PRECONDITION_FAILED", "ENTITY_NOT_WIRED")).code, "ENTITY_NOT_WIRED", "the screen can say WHY");
  assert.equal((await refuse("INVALID_INPUT", "COMPANY_REQUIRED")).code, "COMPANY_REQUIRED");
  assert.equal((await createDataImportClient({ call: async () => { throw new Error("boom"); } }).list()).ok, false);
});

// ════════════════════ 3. REPORT BUILDER ════════════════════

test("Report Builder: the server's outcome reaches the UNCHANGED pure mapper; every refusal is a coded error the UNCHANGED error mapper understands", async () => {
  const payload = { kind: "results", objectId: "customer", rows: [{ "customer.name": "Acme" }], aggregates: null, rowCount: 1, rowCap: 10000, truncated: false,
    completeness: "proven-complete", scanTruncated: false, widened: false, droppedColumnLabels: [], droppedPredicateCount: 0 };
  const s = server({ runReportDefinition: payload });
  const run = createReportRunClient({ call: s.call });
  const mapped = mapServiceOutcome(await run({ objectId: "customer" }, { definitionId: "rpt_1" }));
  assert.deepEqual([mapped.ok, mapped.kind, mapped.rowCount, mapped.completeness], [true, "results", 1, "proven-complete"]);
  assert.deepEqual(s.calls[0], ["runReportDefinition", { definition: { objectId: "customer" }, definitionId: "rpt_1" }]);
  assert.deepEqual(s.calls.length, 1);

  const thrown = async (answer) => createReportRunClient({ call: server({ runReportDefinition: answer }).call })({ objectId: "customer" }).then(() => null, (e) => e);
  // The two scan-bound refusals are ONE actionable state ("narrow the report"), not "unavailable"; nothing else about them is guessed.
  for (const reason of ["SCAN_INCOMPLETE", "ABSENCE_UNPROVEN"]) {
    const err = await thrown(failure("PRECONDITION_FAILED", reason));
    assert.equal(err.code, "resource-exhausted");
    assert.equal(mapCallableError(err).kind, "incomplete-scan");
  }
  assert.equal(mapCallableError(await thrown(failure("FORBIDDEN", "CAPABILITY_REQUIRED"))).kind, "permission-denied");
  assert.equal(mapCallableError(await thrown(failure("INVALID_INPUT", "INVALID_DEFINITION"))).kind, "unsupported");
  assert.equal(mapCallableError(await thrown(failure("PRECONDITION_FAILED", "UNKNOWN_REPORT_OBJECT"))).kind, "unsupported");
  assert.equal(mapCallableError(await thrown(failure("UNREACHABLE"))).kind, "unavailable");
  assert.equal(mapCallableError(await thrown(failure("INTERNAL"))).kind, "unavailable");
  assert.equal(mapCallableError(await thrown(new Error("boom"))).kind, "unavailable");
  // A refusal the server states as an OUTCOME (permission-denied / company-unresolved) arrives as a payload and keeps its kind.
  assert.equal(mapServiceOutcome({ ...payload, kind: "company-unresolved", rows: null }).ok, false);
  assert.equal((await thrown(failure("INTERNAL"))).message.includes("secret"), false, "a raw server message never rides the error");
  assert.equal(firebaseStyleCode({ code: "CONFLICT" }), "aborted");
});

// ════════════════════ 4. SAVED REPORTS ════════════════════

test("Saved Reports: the six methods call the six operations; list unwraps { items }; coded errors map through the unchanged outcome mapper", async () => {
  const record = { id: "rpt_1", name: "Customers", ownerUid: "p1", definition: { objectId: "customer" }, createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z" };
  const s = server({
    createSavedReportDefinition: record, readSavedReportDefinition: record, listSavedReportDefinitions: { items: [record] },
    renameSavedReportDefinition: { ...record, name: "R" }, duplicateSavedReportDefinition: { ...record, id: "rpt_2" }, deleteSavedReportDefinition: { deleted: true },
  });
  const svc = createSavedReportClient({ call: s.call });
  assert.equal((await svc.create({ name: "Customers", definition: record.definition })).id, "rpt_1");
  assert.equal((await svc.get("rpt_1")).name, "Customers");
  assert.deepEqual(await svc.list(), [record]);
  assert.equal((await svc.rename("rpt_1", "R")).name, "R");
  assert.equal((await svc.duplicate("rpt_1")).id, "rpt_2");
  await svc.duplicate("rpt_1", "Copy");
  assert.deepEqual(await svc.remove("rpt_1"), { deleted: true });
  assert.deepEqual(s.calls.map(([op]) => op), ["createSavedReportDefinition", "readSavedReportDefinition", "listSavedReportDefinitions", "renameSavedReportDefinition",
    "duplicateSavedReportDefinition", "duplicateSavedReportDefinition", "deleteSavedReportDefinition"]);
  assert.deepEqual(s.calls[4][1], { definitionId: "rpt_1" }, "no name when none was stated");
  assert.deepEqual(s.calls[5][1], { definitionId: "rpt_1", name: "Copy" });

  const err = async (answer) => createSavedReportClient({ call: server({ readSavedReportDefinition: answer }).call }).get("x").then(() => null, (e) => e);
  assert.equal(mapSavedDefinitionError(await err(failure("NOT_FOUND", "DEFINITION_NOT_FOUND"))).kind, SAVED_DEFINITION_OUTCOME.NOT_FOUND);
  assert.equal(mapSavedDefinitionError(await err(failure("FORBIDDEN", "CAPABILITY_REQUIRED"))).kind, SAVED_DEFINITION_OUTCOME.DENIED);
  assert.equal(mapSavedDefinitionError(await err(failure("INVALID_INPUT", "INVALID_DEFINITION"))).kind, SAVED_DEFINITION_OUTCOME.INVALID);
  assert.equal(mapSavedDefinitionError(await err(failure("UNREACHABLE"))).kind, SAVED_DEFINITION_OUTCOME.UNAVAILABLE);
  assert.equal(mapSavedDefinitionError(await err(failure("INTERNAL"))).kind, SAVED_DEFINITION_OUTCOME.FAILURE);
  // A malformed list is a coded error, never an empty list of saved reports.
  const bad = await createSavedReportClient({ call: server({ listSavedReportDefinitions: { items: "nope" } }).call }).list().then(() => null, (e) => e);
  assert.equal(bad.code, "internal");
});

// ════════════════════ 5. PERFORMANCE GOALS ════════════════════

test("performance goals: three reads with the Firebase client's shapes; an empty target list never round-trips; denied is distinct from unavailable; a malformed answer is unavailable", async () => {
  const s = server({ listCurrentPerformanceGoals: { results: [{ metricId: "m", goal: null }], onDate: "2026-10-18" }, listPerformanceGoalVersions: { versions: [] }, listGoalSubjects: { employeeIds: ["e-1"] } });
  const goals = createPerformanceGoalClient({ call: s.call });
  const target = { metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM", targetScopeId: null };
  assert.deepEqual(await goals.fetchCurrentPerformanceGoals([], "2026-10-18"), { result: { results: [], onDate: "2026-10-18" } });
  assert.equal(s.calls.length, 0, "no round trip for no targets");
  assert.deepEqual((await goals.fetchCurrentPerformanceGoals([target], "2026-10-18")).result.onDate, "2026-10-18");
  assert.deepEqual(s.calls[0], ["listCurrentPerformanceGoals", { targets: [target], onDate: "2026-10-18" }]);
  assert.deepEqual(await goals.fetchPerformanceGoalVersions(target), { result: { versions: [] } });
  assert.deepEqual(await goals.fetchGoalSubjects(), { result: { employeeIds: ["e-1"] } });
  const status = async (answer) => (await createPerformanceGoalClient({ call: server({ listGoalSubjects: answer }).call }).fetchGoalSubjects()).errorStatus;
  assert.equal(await status(failure("FORBIDDEN", "CAPABILITY_REQUIRED")), "denied");
  assert.equal(await status(failure("FORBIDDEN", "COMPANY_AUTHORITY_REQUIRED")), "denied");
  assert.equal(await status(failure("INTERNAL")), "unavailable");
  assert.equal(await status(failure("UNREACHABLE")), "unavailable");
  assert.equal(await status({ employeeIds: "nope" }), "unavailable");
  assert.equal(await status(new Error("boom")), "unavailable");
});

// ════════════════════ 6. THE FAILING-SPY PINS ════════════════════

test("where an EOS API is declared each source is chosen at BUILD time, with no runtime fallback in either direction", () => {
  const history = strip(src("access/importedServiceHistorySource.js"));
  assert.match(history, /export const fetchImportedServiceHistory = EOS_SESSION_SOURCE \? createImportedHistoryClient\(\) : firebaseFetchImportedServiceHistory;/);

  const imp = strip(src("access/dataImportClient.js"));
  assert.match(imp, /const eosImport = EOS_SESSION_SOURCE \? createDataImportClient\(\) : null;/);
  for (const needle of ["if (eosImport) return eosImport.stage(", "if (eosImport) return eosImport.execute(jobId);", "if (eosImport) return eosImport.list();"]) assert.ok(imp.includes(needle), needle);
  // The Catalog / Equipment refusals run BEFORE either source, so an entity type's rules do not depend on where it runs.
  assert.ok(imp.indexOf("const refusal = catalogImportRefusal(entityType) ?? equipmentImportRefusal(entityType);") < imp.indexOf("if (eosImport) return eosImport.execute(jobId);"));

  const seam = strip(src("domain/reporting/reportExecutionSeam.js"));
  assert.match(seam, /const eosRun = EOS_SESSION_SOURCE \? createReportRunClient\(\) : null;/);
  assert.ok(seam.indexOf("if (eosRun) return mapServiceOutcome(await eosRun(definition, options));") < seam.indexOf("httpsCallable(functions, RUN_REPORT_CALLABLE)"), "the Firebase callable is built only after the EOS arm");

  assert.match(strip(src("domain/reporting/savedReportService.js")), /export const savedReportService = EOS_SESSION_SOURCE \? createSavedReportClient\(\) : firebaseSavedReportService;/);

  const goals = strip(src("services/performanceGoalClient.js"));
  assert.match(goals, /const eosGoals = EOS_SESSION_SOURCE \? createPerformanceGoalClient\(\) : null;/);
  for (const name of ["CurrentPerformanceGoals", "PerformanceGoalVersions", "GoalSubjects"]) {
    assert.match(goals, new RegExp(`export const fetch${name} = eosGoals \\? eosGoals\\.fetch${name} : firebaseFetch${name};`), name);
  }
  // The Firebase arms keep their original names and bodies (production is unchanged).
  assert.match(goals, /async function firebaseFetchCurrentPerformanceGoals\(/);
});

test("the EOS client module imports nothing from Firebase and decides nothing (no capability, no company, no entity rule)", () => {
  const text = strip(src("services/eosRecordsClients.js"));
  assert.doesNotMatch(text, /from\s+["'][^"']*firebase/i);
  assert.doesNotMatch(text, /httpsCallable|getFirestore|initializeApp|firebase\//);
  assert.doesNotMatch(text, /report\.(customer|contact|location|equipment|definition)\.|performance\.goal\.|admin\.dataImport\.|customer\.record\./, "the gate is the server's");
  // The transport is imported LAZILY, so the module stays node-importable and nothing initializes at import.
  assert.match(text, /const callReorderApi = async \(\.\.\.args\) => \(await import\("\.\/reorderApiClient\.js"\)\)\.callReorderApi\(\.\.\.args\);/);
});

test("the transport mirrors name every new operation, so a typo fails here rather than as a 404", () => {
  const names = (file, exportName) => {
    const text = src(file);
    const start = text.indexOf(`export const ${exportName}`);
    return [...text.slice(start, text.indexOf("]);", start)).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  };
  const reads = names("services/reorderApiClient.js", "REORDER_READ_OPERATIONS");
  const writes = names("services/reorderApiClient.js", "REORDER_COMMAND_OPERATIONS");
  const all = Object.values(RECORDS_OPERATIONS);
  assert.equal(all.length, 14);
  for (const op of all) assert.ok(reads.includes(op) || writes.includes(op), op);
  for (const op of ["stageDataImport", "executeDataImport", "createSavedReportDefinition", "renameSavedReportDefinition", "duplicateSavedReportDefinition", "deleteSavedReportDefinition"]) {
    assert.ok(writes.includes(op), `${op} is a command`);
  }
  assert.ok(reads.includes("runReportDefinition"), "a run is a read: it changes no business record");
});

test("the nav and the capability twins: Report Builder and Saved Reports are governed destinations, and the registered report ids are asked under their own names", async () => {
  const nav = await import("../src/navigation/navConfig.js");
  assert.deepEqual(nav.NAV_SURFACE_ACCESS["reporting/builder"], ["reporting.builder"]);
  assert.deepEqual(nav.NAV_SURFACE_ACCESS["reporting/savedReports"], ["reporting.savedReports"]);
  for (const key of ["reporting/builder", "reporting/savedReports"]) assert.equal(Object.prototype.hasOwnProperty.call(nav.NAV_SURFACE_GAPS, key), false, key);
  assert.ok(nav.NAV_SURFACE_GAPS["reporting/*"], "the eight domain report placeholders stay a declared domain gap");
  assert.deepEqual(nav.navigationSurfaceMapViolations(), []);
  const ctx = await import("../src/access/experienceContext.js");
  for (const key of ["reporting.builder", "reporting.savedReports"]) assert.ok(ctx.EXPERIENCE_SURFACE_KEYS.includes(key), key);
  const access = await import("../src/access/eosCapabilityAccess.js");
  for (const id of ["report.customer.read", "report.contact.read", "report.location.read", "report.equipment.read",
    "report.definition.create", "report.definition.rename", "report.definition.duplicate", "report.definition.delete"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(access.FIREBASE_IDS_WITHOUT_EOS_TWIN, id), false, `${id} is registered in EOS under its own name`);
    assert.equal(access.eosKeyForFirebaseId(id), id);
  }
  assert.equal(access.eosKeyForFirebaseId("report.definition.read"), "reportDefinition.read", "its EOS twin, unchanged");
});

test("Data Import offers the operating-company choice only when the server says the caller reaches more than one", () => {
  const screen = strip(src("modules/administration/AdminDataImport.jsx"));
  assert.match(screen, /const needsCompany = companies\.length > 1;/);
  assert.match(screen, /setCompanies\(Array\.isArray\(res\.data\?\.companies\) \? res\.data\.companies : \[\]\);/, "the list is the server's answer, never a client guess");
  assert.match(screen, /disabled=\{busy \|\| \(needsCompany && !companyKey\)\}/);
  assert.match(screen, /operatingCompanyKey/);
});
