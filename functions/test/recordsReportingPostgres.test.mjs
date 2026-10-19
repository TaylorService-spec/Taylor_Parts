// RECORDS AND REPORTING ON EOS -- against a real postgres:16 (Firebase exit B4, DECISIONS #B4; F7d, F7e, F7f).
//
// It proves, on PostgreSQL and with the actor's capability set stated directly (so nothing here depends on which Roles hold what):
//   1. IMPORTED SERVICE HISTORY + DATA IMPORT: the shared pipeline stages and executes a SERVICE_HISTORY file with a per-row outcome, an approval that
//      cannot run twice, an import that never overwrites, and COMPANY ISOLATION on every read (a record of another company reads as nonexistent).
//   2. REPORT BUILDER / SAVED REPORTS: a run reads the existing EOS records, equipment is bounded by the caller's companies IN THE SERVER QUERY, a field the
//      runner may not read is dropped (and so is a predicate over it), the three fields Firebase withholds stay withheld, the scan-bound refusals hold, and
//      a saved definition is the caller's alone (another Principal's reads exactly as a missing one, and every denial is audited).
//   3. PERFORMANCE GOALS: the four factors translated to EOS reach, per scope, and the three absences kept apart.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const history = require("../lib/eosOps/importedServiceHistory.js");
const dataImport = require("../lib/eosOps/dataImportOperations.js");
const reports = require("../lib/eosOps/reportOperations.js");
const goals = require("../lib/eosOps/performanceGoalReads.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const IMPORT = "admin.dataImport.execute";
const CUSTOMER_READ = "customer.record.read";
const DEF = { create: "report.definition.create", read: "reportDefinition.read", rename: "report.definition.rename", duplicate: "report.definition.duplicate", del: "report.definition.delete" };
const GOAL_READ = "performance.goal.read";

test("Records and reporting on PostgreSQL: imported history, Data Import, reports and goals", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  const principal = async (subject) => repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const admin = await principal("uid-admin");        // a Taylor Employee with an explicit Ventana company-access grant: REACHES BOTH companies
  const taylorUser = await principal("uid-taylor");  // Taylor only
  const ventanaUser = await principal("uid-ventana"); // Ventana only
  const nobody = await principal("uid-no-employee"); // no Employee link: NO company authority
  const mgr = await principal("uid-manager");        // Taylor, Role salesManager
  const rep = await principal("uid-rep");            // Taylor, Role salesperson
  const repV = await principal("uid-rep-v");         // Ventana, Role salesperson

  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f'), ('t1','ventana','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','fixture','f','f'), ('t1','ventana','ventana-co','ACTIVE','NATIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-a','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-t','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'),
                  ('e-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z'), ('e-m','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'),
                  ('e-rep','t1','ACTIVE','taylor','2020-01-01T00:00:00Z'), ('e-rep-v','t1','ACTIVE','ventana','2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('l-a','t1',$1,'e-a','taylor','OPERATOR_ASSERTED','f','test','active'), ('l-t','t1',$2,'e-t','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('l-v','t1',$3,'e-v','ventana','OPERATOR_ASSERTED','f','test','active'), ('l-m','t1',$4,'e-m','taylor','OPERATOR_ASSERTED','f','test','active'),
                  ('l-r','t1',$5,'e-rep','taylor','OPERATOR_ASSERTED','f','test','active'), ('l-rv','t1',$6,'e-rep-v','ventana','OPERATOR_ASSERTED','f','test','active')`,
  [admin, taylorUser, ventanaUser, mgr, rep, repV]);
  {
    // Written under the Administration marker, exactly as the governed grantCompanyAuthority command writes it (a trigger refuses any other writer).
    const gc = await pool.connect();
    try {
      await gc.query("BEGIN");
      await gc.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`);
      await gc.query(`INSERT INTO eos_policy.employee_company_authority_grants (id, tenant_id, employee_id, operating_company_id, reason, granted_by)
                      VALUES ('ecag-a-v','t1','e-a','ventana','fixture: reach both companies','f')`);
      await gc.query("COMMIT");
    } catch (e) { await gc.query("ROLLBACK"); throw e; } finally { gc.release(); }
  }
  // Roles for the goal hierarchy: a sales manager sees salespeople (roleHierarchy.ts), a salesperson sees nobody.
  for (const key of ["salesManager", "salesperson"]) {
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ($1,'t1',$2,$2,'SYSTEM','fixture','fixture')`, [`role-${key}`, key]);
  }
  const assign = (id, principalId, roleKey) => q(
    `INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
     VALUES ($1,'t1',$2,$3,'global',NULL,'active','f',0,'f','f')`, [id, principalId, `role-${roleKey}`]);
  await assign("a-m", mgr, "salesManager");
  await assign("a-r", rep, "salesperson");
  await assign("a-rv", repV, "salesperson");

  const actor = (principalId, caps) => ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
  const auditCount = async (action) => (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = $1`, [action])).rows[0].n;

  // ── customers, contacts, customer sites, equipment ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, customer_number, notes, created_by, updated_by) VALUES
             ('acct-acme','t1','Acme Co','ACTIVE','C-100','private note','f','f'), ('acct-beta','t1','Beta LLC','PROSPECT','C-200',NULL,'f','f')`);
  await q(`INSERT INTO eos_crm.contacts (id, tenant_id, account_id, name, email, phone, contact_role, is_primary, created_by, updated_by) VALUES
             ('ct-1','t1','acct-acme','Jo Contact','jo@example.test','555-0101','Buyer',true,'f','f')`);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, address_street, address_city, address_state, address_postal_code, access_notes, created_by, updated_by) VALUES
             ('loc-1','t1','acct-acme','Main Site','1 Main St','Phoenix','AZ','85001','gate code 1234','f','f')`);
  await q(`INSERT INTO eos_ops.equipment (id, tenant_id, operating_company_key, account_id, customer_location_id, name, status, serial_number, installed_on, created_by, updated_by) VALUES
             ('eq-t1','t1','sample-co','acct-acme','loc-1','Ice Maker A','ACTIVE','SN-1','2023-01-02','f','f'),
             ('eq-t2','t1','sample-co','acct-acme','loc-1','Ice Maker B','INACTIVE','SN-2',NULL,'f','f'),
             ('eq-v1','t1','ventana-co','acct-beta','loc-1','Ice Maker V','ACTIVE','SN-3',NULL,'f','f')`);

  // ════════════════════ 1. DATA IMPORT + IMPORTED SERVICE HISTORY ════════════════════
  await t.test("Data Import: capability first, then company; only SERVICE_HISTORY is wired; the company is chosen from the caller's own reach", async () => {
    const csv = [
      "customer,service date,work performed,reference,technician",
      "Acme Co,2024-03-05,Replaced compressor,R-1,Pat",
      "acme   co,2024-04-01,Cleaned coils,R-2,Pat",
      "Nope Inc,2024-04-02,Unknown customer,R-3,Pat",
      "Acme Co,2999-01-01,Future work,R-4,Pat",
      "Acme Co,2024-05-01,Duplicate reference,R-1,Pat",
    ].join("\n");
    const file = { fileName: "history.csv", fileText: csv, entityType: "SERVICE_HISTORY" };

    assert.equal((await refusal(() => dataImport.stageDataImport({ pool }, actor(admin, []), file))).code, "CAPABILITY_REQUIRED");
    assert.equal((await refusal(() => dataImport.stageDataImport({ pool }, actor(nobody, [IMPORT]), file))).code, "COMPANY_AUTHORITY_REQUIRED", "capability first, then company");
    // Two companies reached: the file must say which. A company outside the caller's reach reads as one that does not exist.
    assert.equal((await refusal(() => dataImport.stageDataImport({ pool }, actor(admin, [IMPORT]), file))).code, "COMPANY_REQUIRED");
    assert.equal((await refusal(() => dataImport.stageDataImport({ pool }, actor(taylorUser, [IMPORT]), { ...file, operatingCompanyKey: "ventana-co" }))).code, "COMPANY_NOT_FOUND");
    assert.equal((await refusal(() => dataImport.stageDataImport({ pool }, actor(admin, [IMPORT]), { ...file, operatingCompanyKey: "no-such-co" }))).code, "COMPANY_NOT_FOUND");
    // Parts, Customers, Equipment and Inventory write other governed authorities: refused honestly, before anything is staged.
    const unwired = await refusal(() => dataImport.stageDataImport({ pool }, actor(taylorUser, [IMPORT]), { ...file, entityType: "PARTS" }));
    assert.deepEqual([unwired.code, unwired.category], ["ENTITY_NOT_WIRED", "PRECONDITION_FAILED"]);
    // An unknown input key is refused, never ignored: a caller cannot believe it chose an authority.
    assert.equal((await refusal(() => dataImport.stageDataImport({ pool }, actor(taylorUser, [IMPORT]), { ...file, tenantId: "t2" }))).code, "INPUT_FIELD_NOT_ACCEPTED");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.data_import_jobs`)).rows[0].n, 0, "no refusal left a job behind");
  });

  let takerJob;
  await t.test("stage -> approve -> execute: per-row outcomes, an approval that cannot run twice, nothing overwritten", async () => {
    const csv = [
      "customer,service date,work performed,reference,technician",
      "Acme Co,2024-03-05,Replaced compressor,R-1,Pat",
      "acme   co,2024-04-01,Cleaned coils,R-2,Pat",
      "Nope Inc,2024-04-02,Unknown customer,R-3,Pat",
      "Acme Co,2999-01-01,Future work,R-4,Pat",
      "Acme Co,2024-05-01,Duplicate reference,R-1,Pat",
    ].join("\n");
    const file = { fileName: "history.csv", fileText: csv, entityType: "SERVICE_HISTORY" };
    const staged = await dataImport.stageDataImport({ pool }, actor(taylorUser, [IMPORT]), file);
    assert.equal(staged.staged, true);
    assert.deepEqual(staged.job.summary, { total: 5, ready: 2, warnings: 0, errors: 3 });
    assert.equal(staged.job.operatingCompanyKey, "sample-co", "one company reached: implied");
    assert.equal(staged.job.status, "STAGED");
    takerJob = staged.job.jobId;
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.imported_service_history`)).rows[0].n, 0, "staging writes no business record");

    // The approval is explicit, and only a job of a company the caller reaches exists for it.
    assert.equal((await refusal(() => dataImport.executeDataImport({ pool }, actor(taylorUser, [IMPORT]), { jobId: takerJob }))).code, "NOT_APPROVED");
    assert.equal((await refusal(() => dataImport.executeDataImport({ pool }, actor(ventanaUser, [IMPORT]), { jobId: takerJob, approved: true }))).code, "JOB_NOT_FOUND", "another company's job does not exist");
    assert.equal((await refusal(() => dataImport.executeDataImport({ pool }, actor(taylorUser, []), { jobId: takerJob, approved: true }))).code, "CAPABILITY_REQUIRED");

    const done = await dataImport.executeDataImport({ pool }, actor(taylorUser, [IMPORT]), { jobId: takerJob, approved: true });
    assert.equal(done.job.status, "COMPLETED");
    assert.deepEqual([done.job.result.created, done.job.result.replayed, done.job.result.failed], [2, 0, 0]);
    assert.equal(done.job.approvedBy, taylorUser);
    const rows = (await q(`SELECT id, account_id, operating_company_key, identity_key, to_char(service_date,'YYYY-MM-DD') AS d, technician_name, source_system, import_job_id
                             FROM eos_ops.imported_service_history ORDER BY service_date`)).rows;
    assert.deepEqual(rows.map((r) => [r.account_id, r.operating_company_key, r.d, r.technician_name, r.source_system, r.import_job_id]),
      [["acct-acme", "sample-co", "2024-03-05", "Pat", "DATA_IMPORT", takerJob], ["acct-acme", "sample-co", "2024-04-01", "Pat", "DATA_IMPORT", takerJob]]);

    // THE SAME APPROVAL CANNOT RUN TWICE.
    const again = await refusal(() => dataImport.executeDataImport({ pool }, actor(taylorUser, [IMPORT]), { jobId: takerJob, approved: true }));
    assert.deepEqual([again.code], ["JOB_NOT_STAGED"]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.imported_service_history`)).rows[0].n, 2);

    // RE-STAGING THE SAME FILE FOR THE SAME COMPANY: every row already exists, nothing is importable, nothing is overwritten.
    const restaged = await dataImport.stageDataImport({ pool }, actor(taylorUser, [IMPORT]), file);
    assert.equal(restaged.job.summary.errors, 5);
    assert.equal((await refusal(() => dataImport.executeDataImport({ pool }, actor(taylorUser, [IMPORT]), { jobId: restaged.job.jobId, approved: true }))).code, "JOB_EMPTY");

    // THE IDENTITY IS PER COMPANY: the same file staged for Ventana (by a caller who reaches both) is a different population.
    const ventanaStaged = await dataImport.stageDataImport({ pool }, actor(admin, [IMPORT]), { ...file, operatingCompanyKey: "ventana-co" });
    assert.equal(ventanaStaged.job.summary.ready, 2);
    const ventanaDone = await dataImport.executeDataImport({ pool }, actor(admin, [IMPORT]), { jobId: ventanaStaged.job.jobId, approved: true });
    assert.equal(ventanaDone.job.result.created, 2);
    assert.equal(await auditCount("dataImport.stage"), 3);
    assert.equal(await auditCount("dataImport.execute"), 2);
    assert.equal(await auditCount("dataImport.serviceHistory.create"), 4);
  });

  await t.test("Data Import history: the caller's own companies' jobs only, with the companies a file may be staged for", async () => {
    const asTaylor = await dataImport.listDataImportJobs({ pool }, actor(taylorUser, [IMPORT]), {});
    assert.deepEqual(asTaylor.jobs.map((j) => j.operatingCompanyKey), ["sample-co", "sample-co"]);
    assert.deepEqual(asTaylor.companies.map((c) => c.key), ["sample-co"]);
    const asVentana = await dataImport.listDataImportJobs({ pool }, actor(ventanaUser, [IMPORT]), {});
    assert.deepEqual(asVentana.jobs.map((j) => j.operatingCompanyKey), ["ventana-co"]);
    const asAdmin = await dataImport.listDataImportJobs({ pool }, actor(admin, [IMPORT]), {});
    assert.equal(asAdmin.jobs.length, 3);
    assert.deepEqual(asAdmin.companies.map((c) => c.key), ["sample-co", "ventana-co"]);
    assert.deepEqual(asAdmin.wiredEntities, ["SERVICE_HISTORY"]);
    assert.equal((await refusal(() => dataImport.listDataImportJobs({ pool }, actor(nobody, [IMPORT]), {}))).code, "COMPANY_AUTHORITY_REQUIRED");
  });

  await t.test("Imported service history: account-scoped, company-scoped, newest first, bounded; hidden records read as nonexistent", async () => {
    const read = (principalId, caps, input) => history.listImportedServiceHistory({ pool }, actor(principalId, caps), input);
    const asTaylor = await read(taylorUser, [CUSTOMER_READ], { accountId: "acct-acme" });
    assert.deepEqual(asTaylor.rows.map((r) => r.serviceDate), ["2024-04-01", "2024-03-05"], "newest service first");
    assert.deepEqual([asTaylor.truncated, asTaylor.accountId, asTaylor.rows[0].recordKind], [false, "acct-acme", "IMPORTED_SERVICE_HISTORY"]);
    assert.deepEqual(Object.keys(asTaylor.rows[0]).sort(), ["equipmentSerialNumber", "externalReference", "id", "importJobId", "locationName", "recordKind", "serviceDate", "sourceSystem", "summary", "technicianName"]);
    // The other company's two records are invisible to Taylor, and Ventana sees ITS two (the same dates, a different company): no flag, no count of the rest.
    const asVentana = await read(ventanaUser, [CUSTOMER_READ], { accountId: "acct-acme" });
    assert.equal(asVentana.rows.length, 2);
    assert.notDeepEqual(asVentana.rows.map((r) => r.id), asTaylor.rows.map((r) => r.id));
    assert.equal((await read(admin, [CUSTOMER_READ], { accountId: "acct-acme" })).rows.length, 4, "a caller who reaches both companies reads both");
    const limited = await read(admin, [CUSTOMER_READ], { accountId: "acct-acme", limit: 1 });
    assert.deepEqual([limited.rows.length, limited.truncated], [1, true]);
    // An account with none, an account that is not this tenant's, no capability, no company authority.
    assert.deepEqual((await read(taylorUser, [CUSTOMER_READ], { accountId: "acct-beta" })).rows, []);
    assert.equal((await refusal(() => read(taylorUser, [CUSTOMER_READ], { accountId: "acct-none" }))).code, "ACCOUNT_NOT_FOUND");
    assert.equal((await refusal(() => read(taylorUser, [], { accountId: "acct-acme" }))).code, "CAPABILITY_REQUIRED");
    assert.equal((await refusal(() => read(nobody, [CUSTOMER_READ], { accountId: "acct-acme" }))).code, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal((await refusal(() => read(taylorUser, [CUSTOMER_READ], {}))).code, "ACCOUNT_ID_REQUIRED");
  });

  // ════════════════════ 2. REPORT BUILDER / SAVED REPORTS ════════════════════
  const run = (a, definition, extra = {}, options) => reports.runReportDefinition({ pool, options }, a, { definition, ...extra });
  const CUSTOMER = ["report.customer.read", "report.customer.field.name.read", "report.customer.field.status.read"];
  const EQUIPMENT = ["report.equipment.read", "report.equipment.field.name.read", "report.equipment.field.status.read"];

  await t.test("a run reads the existing EOS records; customers are company-neutral, equipment is bounded by the caller's companies IN THE QUERY", async () => {
    const def = { objectId: "customer", fields: ["customer.name", "customer.status"], sort: [{ fieldId: "customer.name", direction: "desc" }] };
    const taylor = await run(actor(taylorUser, CUSTOMER), def);
    assert.equal(taylor.kind, "results");
    assert.deepEqual(taylor.rows, [{ "customer.name": "Beta LLC", "customer.status": "PROSPECT" }, { "customer.name": "Acme Co", "customer.status": "ACTIVE" }]);
    assert.deepEqual([taylor.rowScopeKind, taylor.companyReach, taylor.completeness, taylor.rowCount], ["company-neutral", ["taylor"], "proven-complete", 2]);
    const ventana = await run(actor(ventanaUser, CUSTOMER), def);
    assert.equal(ventana.rowCount, 2, "a customer is not owned by one company (R-15): no row predicate exists to apply");
    assert.deepEqual(ventana.companyReach, ["ventana"]);

    const eq = { objectId: "equipment", fields: ["equipment.name", "equipment.status"] };
    const names = (o) => o.rows.map((r) => r["equipment.name"]).sort();
    assert.deepEqual(names(await run(actor(taylorUser, EQUIPMENT), eq)), ["Ice Maker A", "Ice Maker B"]);
    assert.deepEqual(names(await run(actor(ventanaUser, EQUIPMENT), eq)), ["Ice Maker V"]);
    const both = await run(actor(admin, EQUIPMENT), eq);
    assert.deepEqual([names(both), both.rowScopeKind, both.companyReach], [["Ice Maker A", "Ice Maker B", "Ice Maker V"], "company-bound", ["taylor", "ventana"]]);
    // Another company's unit is not merely hidden from the answer: a filter that names it matches nothing, and nothing says it exists.
    const named = await run(actor(taylorUser, EQUIPMENT), { ...eq, filters: [{ fieldId: "equipment.name", op: "eq", value: "Ice Maker V" }] });
    assert.deepEqual([named.kind, named.rowCount], ["empty", 0]);
  });

  await t.test("a field the runner may not read is DROPPED -- and so is a predicate over it; the three fields Firebase withholds stay withheld", async () => {
    const noStatus = actor(taylorUser, ["report.customer.read", "report.customer.field.name.read"]);
    const dropped = await run(noStatus, { objectId: "customer", fields: ["customer.name", "customer.status"] });
    assert.deepEqual([dropped.kind, dropped.droppedColumnLabels, dropped.droppedFieldIds], ["partially-authorized", ["Status"], ["customer.status"]]);
    assert.deepEqual(dropped.rows.map((r) => Object.keys(r)), [["customer.name"], ["customer.name"]], "absent from the payload -- never blanked");
    // A filter on a field the runner may not read WIDENS the result; it never leaks membership.
    const widened = await run(noStatus, { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.status", op: "eq", value: "ACTIVE" }] });
    assert.deepEqual([widened.kind, widened.widened, widened.droppedPredicateFieldIds, widened.rowCount], ["truncated-widened", true, ["customer.status"], 2]);
    // customer.notes is REGISTERED and HELD in Firebase and DENIED in every Firebase environment: holding the key does not read the field.
    const notes = await run(actor(taylorUser, ["report.customer.read", "report.customer.field.notes.read"]), { objectId: "customer", fields: ["customer.notes"] });
    assert.deepEqual([notes.kind, notes.droppedFieldIds], ["partially-authorized", ["customer.notes"]]);
    assert.equal(JSON.stringify(notes).includes("private note"), false);
    for (const id of reports.INACTIVE_REPORT_CAPABILITIES) assert.match(id, /^report\.(customer\.field\.(notes|accountOwner)|location\.field\.accessNotes)\.read$/);
  });

  await t.test("the object gate and the company gate are OUTCOMES (audited), distinct from each other; a malformed definition is refused", async () => {
    const before = await auditCount("runReportDefinition");
    const denied = await run(actor(taylorUser, []), { objectId: "customer", fields: ["customer.name"] });
    assert.deepEqual([denied.kind, denied.rows, denied.completeness], ["permission-denied", null, "not-attempted"]);
    const unresolved = await run(actor(nobody, CUSTOMER), { objectId: "customer", fields: ["customer.name"] });
    assert.deepEqual([unresolved.kind, unresolved.rows, unresolved.rowScopeKind], ["company-unresolved", null, "unresolved"]);
    assert.equal(await auditCount("runReportDefinition"), before + 2, "exactly one audit event per refusal");
    const invalid = await refusal(() => run(actor(taylorUser, CUSTOMER), { objectId: "customer", fields: ["customer.nope"] }));
    assert.deepEqual([invalid.code, invalid.category], ["INVALID_DEFINITION", "INVALID_INPUT"]);
    assert.equal((await refusal(() => run(actor(taylorUser, CUSTOMER), { objectId: "workOrder" }))).code, "INVALID_DEFINITION", "an object not activated for reporting");
    // The audit event records facts about the run, never row data.
    const applied = await run(actor(taylorUser, CUSTOMER), { objectId: "customer", fields: ["customer.name"] });
    assert.equal(applied.rowCount, 2);
    const last = (await q(`SELECT after FROM eos_policy.audit_events WHERE action = 'runReportDefinition' ORDER BY occurred_at DESC LIMIT 1`)).rows[0].after;
    assert.equal(last.outcome, "applied");
    assert.equal(JSON.stringify(last).includes("Acme"), false);
  });

  await t.test("group, aggregate and the one-hop join", async () => {
    const grouped = await run(actor(taylorUser, CUSTOMER), { objectId: "customer", groupBy: ["customer.status"], aggregates: [{ fn: "countRows" }] });
    assert.deepEqual(grouped.aggregates.map((r) => [r["customer.status"], r.countRows]).sort(), [["ACTIVE", 1], ["PROSPECT", 1]]);
    assert.equal(grouped.rows, null);
    const JOIN_CAPS = [...EQUIPMENT, "report.location.field.name.read", "report.equipment.field.location.read"];
    const joined = await run(actor(taylorUser, JOIN_CAPS), { objectId: "equipment", fields: ["equipment.name", "location.name"] });
    assert.deepEqual(joined.rows.map((r) => r["location.name"]), ["Main Site", "Main Site"]);
    // Without the TRAVERSAL capability (the field that points at the location) the related column is dropped, not joined.
    const noTraversal = await run(actor(taylorUser, [...EQUIPMENT, "report.location.field.name.read"]), { objectId: "equipment", fields: ["equipment.name", "location.name"] });
    assert.deepEqual([noTraversal.kind, noTraversal.droppedFieldIds], ["partially-authorized", ["location.name"]]);
  });

  await t.test("the scan-bound refusals: a total over a cut population and a zero-row answer out of a cut scan are REFUSED, never returned", async () => {
    const small = { maxScanDocs: 1 };
    const page = await run(actor(taylorUser, CUSTOMER), { objectId: "customer", fields: ["customer.name"] }, {}, small);
    assert.deepEqual([page.kind, page.scanTruncated, page.completeness, page.rowCount], ["truncated-widened", true, "bounded-page", 1]);
    const total = await refusal(() => run(actor(taylorUser, CUSTOMER), { objectId: "customer", aggregates: [{ fn: "countRows" }] }, {}, small));
    assert.deepEqual([total.code, total.category], ["SCAN_INCOMPLETE", "PRECONDITION_FAILED"]);
    const absence = await refusal(() => run(actor(taylorUser, CUSTOMER), { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.name", op: "eq", value: "zzz" }] }, {}, small));
    assert.equal(absence.code, "ABSENCE_UNPROVEN");
    // Within the bound the same absence IS proven.
    assert.equal((await run(actor(taylorUser, CUSTOMER), { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.name", op: "eq", value: "zzz" }] })).kind, "empty");
    // Caps: the row cap pages a list and says so.
    const capped = await run(actor(taylorUser, CUSTOMER), { objectId: "customer", fields: ["customer.name"] }, {}, { maxResultRows: 1 });
    assert.deepEqual([capped.rowCount, capped.truncated, capped.scanTruncated], [1, true, false]);
  });

  await t.test("saved definitions: the caller's own, one owner; another Principal's reads exactly as a missing one; every denial is audited", async () => {
    const def = { objectId: "customer", fields: ["customer.name"] };
    const all = [DEF.create, DEF.read, DEF.rename, DEF.duplicate, DEF.del];
    const call = (fn, a, input) => reports[fn]({ pool }, a, input);
    const before = await auditCount("createReportDefinition");
    assert.equal((await refusal(() => call("createSavedReportDefinition", actor(taylorUser, [DEF.read]), { name: "A", definition: def }))).code, "CAPABILITY_REQUIRED");
    assert.equal(await auditCount("createReportDefinition"), before + 1, "a denied attempt is audited exactly once");
    assert.equal((await refusal(() => call("createSavedReportDefinition", actor(taylorUser, all), { name: " ", definition: def }))).code, "NAME_REQUIRED");
    assert.equal((await refusal(() => call("createSavedReportDefinition", actor(taylorUser, all), { name: "x".repeat(121), definition: def }))).code, "NAME_TOO_LONG");
    assert.equal((await refusal(() => call("createSavedReportDefinition", actor(taylorUser, all), { name: "Bad", definition: { objectId: "nope" } }))).code, "INVALID_DEFINITION");

    const mine = await call("createSavedReportDefinition", actor(taylorUser, all), { name: "Customers", definition: def });
    assert.deepEqual([mine.name, mine.ownerUid, mine.definition], ["Customers", taylorUser, def]);
    const listed = await call("listSavedReportDefinitions", actor(taylorUser, all), {});
    assert.deepEqual(listed.items.map((r) => r.id), [mine.id]);
    assert.deepEqual((await call("readSavedReportDefinition", actor(taylorUser, all), { definitionId: mine.id })).name, "Customers");

    // Another Principal: the list is empty and every action on the id answers the SAME "not found" -- no existence oracle.
    const other = actor(ventanaUser, all);
    assert.deepEqual((await call("listSavedReportDefinitions", other, {})).items, []);
    const probe = async (fn, definitionId) => {
      const input = fn === "renameSavedReportDefinition" || fn === "duplicateSavedReportDefinition" ? { definitionId, name: "stolen" } : { definitionId };
      const e = await refusal(() => call(fn, other, input));
      return [e.code, e.category, e.message];
    };
    const missing = await probe("readSavedReportDefinition", "rpt_missing");
    assert.deepEqual(missing.slice(0, 2), ["DEFINITION_NOT_FOUND", "NOT_FOUND"]);
    for (const fn of ["readSavedReportDefinition", "renameSavedReportDefinition", "duplicateSavedReportDefinition", "deleteSavedReportDefinition"]) {
      assert.deepEqual(await probe(fn, mine.id), await probe(fn, "rpt_missing"), `${fn}: someone else's reads exactly as a missing one`);
    }
    // ... and the foreign attempts are in the audit trail (rename, duplicate, delete: three denied events), the definition untouched.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE target_id = $1 AND (after->>'outcome') = 'denied'`, [mine.id])).rows[0].n, 3);
    assert.equal((await call("readSavedReportDefinition", actor(taylorUser, all), { definitionId: mine.id })).name, "Customers");

    // A caller WITHOUT the capability learns nothing about whether the id exists (the gate runs before the target is read).
    const noCap = await refusal(() => call("renameSavedReportDefinition", actor(taylorUser, [DEF.read]), { definitionId: "rpt_missing", name: "x" }));
    assert.equal(noCap.code, "CAPABILITY_REQUIRED");
    const renamed = await call("renameSavedReportDefinition", actor(taylorUser, all), { definitionId: mine.id, name: "Renamed" });
    assert.equal(renamed.name, "Renamed");
    const copy = await call("duplicateSavedReportDefinition", actor(taylorUser, all), { definitionId: mine.id });
    assert.deepEqual([copy.name, copy.ownerUid, copy.id === mine.id], ["Renamed (copy)", taylorUser, false]);
    assert.deepEqual(await call("deleteSavedReportDefinition", actor(taylorUser, all), { definitionId: copy.id }), { deleted: true });
    assert.equal((await refusal(() => call("readSavedReportDefinition", actor(taylorUser, all), { definitionId: copy.id }))).code, "DEFINITION_NOT_FOUND");
    assert.equal((await call("listSavedReportDefinitions", actor(taylorUser, all), {})).items.length, 1);
    // A definition confers NO report-data access: running it still needs the object read.
    assert.equal((await run(actor(taylorUser, [DEF.read]), mine.definition, { definitionId: mine.id })).kind, "permission-denied");
  });

  // ════════════════════ 3. PERFORMANCE GOALS ════════════════════
  const goal = (over) => {
    const g = { id: `g-${randomUUID().slice(0, 8)}`, metric: "service.workOrder.pastDue.count", scope: "FIRM", scopeId: null, value: 5, unit: "COUNT", direction: "AT_MOST", currency: null,
      from: "2026-01-01", to: null, status: "APPROVED", version: 1, supersedes: null, ...over };
    return q(`INSERT INTO eos_ops.performance_goals
                (tenant_id, goal_id, metric_id, target_scope_type, target_scope_id, target_value, unit, direction, currency, effective_from, effective_to, status, version,
                 created_by_ref, created_at_ms, approved_by_ref, approved_at_ms, supersedes_goal_id)
              VALUES ('t1',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'fb-author',1700000000000,$13,$14,$15)`,
    [g.id, g.metric, g.scope, g.scopeId, g.value, g.unit, g.direction, g.currency, g.from, g.to, g.status, g.version,
      g.status === "DRAFT" ? null : "fb-approver", g.status === "DRAFT" ? null : 1700000100000, g.supersedes]);
  };
  const read = (a, targets, onDate = "2026-10-18") => goals.listCurrentPerformanceGoals({ pool }, a, { targets, onDate });
  const FIRM = { metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM", targetScopeId: null };

  await t.test("goals: capability first, then company; the three absences stay three; history is not rewritten", async () => {
    assert.equal((await refusal(() => read(actor(taylorUser, []), [FIRM]))).code, "CAPABILITY_REQUIRED");
    assert.equal((await refusal(() => read(actor(nobody, [GOAL_READ]), [FIRM]))).code, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal((await refusal(() => read(actor(taylorUser, [GOAL_READ]), [FIRM], "10/18/2026"))).code, "DATE_REQUIRED");
    assert.deepEqual((await read(actor(taylorUser, [GOAL_READ]), [])).results, []);
    // NO TARGET SET: an honest empty -- not denied, not unavailable.
    const none = (await read(actor(taylorUser, [GOAL_READ]), [FIRM])).results[0];
    assert.deepEqual([none.goal, none.denied, none.unavailableReason], [null, false, null]);
    // September's target stays September's: a superseded version is history, the approved successor is the target in force.
    await goal({ id: "g-old", from: "2026-01-01", to: "2026-09-30", status: "SUPERSEDED", value: 9 });
    await goal({ id: "g-new", from: "2026-10-01", to: null, status: "APPROVED", value: 4, version: 2, supersedes: "g-old" });
    await goal({ id: "g-draft", from: "2026-10-01", status: "DRAFT", value: 1, version: 3, supersedes: "g-new" });
    const now = (await read(actor(taylorUser, [GOAL_READ]), [FIRM])).results[0];
    assert.deepEqual([now.goal.goalId, now.goal.targetValue, now.goal.version, now.goal.status], ["g-new", 4, 2, "APPROVED"], "a DRAFT is never a target");
    assert.equal((await read(actor(taylorUser, [GOAL_READ]), [FIRM], "2026-09-15")).results[0].goal, null, "the superseded version is not in force: only APPROVED is a measurement authority");
    const versions = await goals.listPerformanceGoalVersions({ pool }, actor(taylorUser, [GOAL_READ]), { target: FIRM });
    assert.deepEqual(versions.versions.map((v) => [v.goalId, v.status]), [["g-old", "SUPERSEDED"], ["g-new", "APPROVED"], ["g-draft", "DRAFT"]]);
    // UNAVAILABLE: two APPROVED versions covering one date is a data defect, shown as one -- never as "no goal".
    await goal({ id: "g-clash", from: "2026-10-05", status: "APPROVED", value: 2, version: 4, supersedes: "g-new" });
    const clash = (await read(actor(taylorUser, [GOAL_READ]), [FIRM])).results[0];
    assert.deepEqual([clash.goal, clash.denied, typeof clash.unavailableReason], [null, false, "string"]);
    // Bounded by construction: more than 40 targets is refused, not trimmed.
    assert.equal((await refusal(() => read(actor(taylorUser, [GOAL_READ]), Array.from({ length: 41 }, () => FIRM)))).code, "TOO_MANY_TARGETS");
  });

  await t.test("goals: reach to the target's scope -- company, warehouse, business unit, unusable scopes -- and the metric's own authority", async () => {
    await goal({ id: "g-co", metric: "sales.billed.amount", scope: "OPERATING_COMPANY", scopeId: "taylor", value: 1000, unit: "CURRENCY_MINOR", direction: "AT_LEAST", currency: "USD" });
    await goal({ id: "g-bu", metric: "sales.billed.amount", scope: "BUSINESS_UNIT", scopeId: "bu-1", value: 1000, unit: "CURRENCY_MINOR", direction: "AT_LEAST", currency: "USD" });
    await goal({ id: "g-loc", metric: "receiving.purchaseOrder.receivable.count", scope: "LOCATION", scopeId: "wh-1", value: 3 });
    await goal({ id: "g-loc-v", metric: "receiving.purchaseOrder.receivable.count", scope: "LOCATION", scopeId: "wh-v", value: 3 });
    const CO = { metricId: "sales.billed.amount", targetScopeType: "OPERATING_COMPANY", targetScopeId: "taylor" };
    const BU = { metricId: "sales.billed.amount", targetScopeType: "BUSINESS_UNIT", targetScopeId: "bu-1" };
    const TEAM = { metricId: "sales.billed.amount", targetScopeType: "TEAM", targetScopeId: "t-1" };
    const LOC = { metricId: "receiving.purchaseOrder.receivable.count", targetScopeType: "LOCATION", targetScopeId: "wh-1" };
    const LOC_V = { ...LOC, targetScopeId: "wh-v" };
    const UNKNOWN = { metricId: "no.such.metric", targetScopeType: "FIRM", targetScopeId: null };

    const asTaylor = (await read(actor(taylorUser, [GOAL_READ]), [CO, BU, TEAM, UNKNOWN])).results;
    assert.deepEqual([asTaylor[0].goal.targetValue, asTaylor[0].goal.currency], [1000, "USD"], "a company the caller is authorized for");
    assert.deepEqual([asTaylor[1].deniedFactor, asTaylor[1].goal], ["noGoalCapabilityAtScope", null], "EOS has no business-unit authority: denied, and nothing leaks");
    assert.equal(asTaylor[2].deniedFactor, "scopeNotUsable", "TEAM is never bindable");
    assert.equal(asTaylor[3].deniedFactor, "unknownMetric");
    const asVentana = (await read(actor(ventanaUser, [GOAL_READ]), [CO])).results[0];
    assert.deepEqual([asVentana.denied, asVentana.deniedFactor, asVentana.goal], [true, "noGoalCapabilityAtScope", null], "another company's target is outside the caller's reach");

    // LOCATION: a warehouse of a company the caller reaches AND over which it holds the WAREHOUSE scope; and the metric's own authority (factor 2).
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by) VALUES
               ('wh-1','t1','sample-co','wh-1','S','ACTIVE','NATIVE','f','f'), ('wh-v','t1','ventana-co','wh-v','S','ACTIVE','NATIVE','f','f')`);
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
             VALUES ('os-t-1','t1','e-t','WAREHOUSE','wh-1', now(),'fixture'), ('os-t-v','t1','e-t','WAREHOUSE','wh-v', now(),'fixture')`);
    const caps = [GOAL_READ, "inventory.stock.receive"];
    const loc = (await read(actor(taylorUser, caps), [LOC, LOC_V])).results;
    assert.equal(loc[0].goal.targetValue, 3);
    assert.deepEqual([loc[1].denied, loc[1].goal], [true, null], "a warehouse of a company the caller does not reach, even with the scope row");
    assert.equal((await read(actor(taylorUser, [GOAL_READ]), [LOC])).results[0].deniedFactor, "noAuthorityOverMetric", "a target on a figure the caller may not read is closed");
    assert.equal((await read(actor(mgr, caps), [LOC])).results[0].deniedFactor, "noGoalCapabilityAtScope", "no WAREHOUSE scope over wh-1");
  });

  await t.test("goals: an EMPLOYEE target needs governed visibility AND a company the caller reaches; the subject picker offers exactly what a read accepts", async () => {
    const EMP = (id) => ({ metricId: "technician.workOrder.open.count", targetScopeType: "EMPLOYEE", targetScopeId: id });
    await goal({ id: "g-e-rep", metric: "technician.workOrder.open.count", scope: "EMPLOYEE", scopeId: "e-rep", value: 6 });
    await goal({ id: "g-e-repv", metric: "technician.workOrder.open.count", scope: "EMPLOYEE", scopeId: "e-rep-v", value: 6 });
    const asMgr = (await read(actor(mgr, [GOAL_READ]), [EMP("e-rep"), EMP("e-rep-v"), EMP("e-m")])).results;
    assert.equal(asMgr[0].goal.targetValue, 6, "a sales manager reads a salesperson's target");
    assert.deepEqual([asMgr[1].deniedFactor, asMgr[1].goal], ["employeeOutsideVisibility", null], "the Role subtree never crosses a company");
    assert.equal(asMgr[2].denied, false, "a manager's own Employee is inside their visibility (a read, not a write)");
    const asRep = (await read(actor(rep, [GOAL_READ]), [EMP("e-rep"), EMP("e-m")])).results;
    assert.deepEqual([asRep[0].denied, asRep[1].deniedFactor], [false, "employeeOutsideVisibility"], "a salesperson reads their own target and nobody above them");
    const subjects = await goals.listGoalSubjects({ pool }, actor(mgr, [GOAL_READ]), {});
    assert.deepEqual(subjects.employeeIds, ["e-rep"], "own Employee removed (nobody authors their own target); other companies' Employees never offered");
    assert.deepEqual((await goals.listGoalSubjects({ pool }, actor(rep, [GOAL_READ]), {})).employeeIds, []);
    assert.equal((await refusal(() => goals.listGoalSubjects({ pool }, actor(mgr, []), {}))).code, "CAPABILITY_REQUIRED");
    const v = await goals.listPerformanceGoalVersions({ pool }, actor(mgr, [GOAL_READ]), { target: EMP("e-rep") });
    assert.deepEqual(v.versions.map((x) => x.goalId), ["g-e-rep"]);
    assert.equal((await refusal(() => goals.listPerformanceGoalVersions({ pool }, actor(mgr, [GOAL_READ]), { target: EMP("e-rep-v") }))).code, "GOAL_DENIED");
  });
});
