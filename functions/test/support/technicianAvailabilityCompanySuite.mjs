// COMPANY ISOLATION OF THE AVAILABILITY READS -- readTechnicianAvailability and findAvailableTechnicianSlots under EOS Core
// company authority (DECISIONS #235; the G-9 rule the schedule commands and suggestWorkOrderPlacement already follow).
// Proven SEPARATELY from the Work Order list (Owner direction 2026-10-17), on its own database and fixture world.
//
// Imported by test/workOrderAvailabilityPostgres.test.mjs so it runs in the Service Work Order Authority CI job.
//
// Proves, against real PostgreSQL 16:
//   * capability first: no read capability = CAPABILITY_MISSING, whatever the company standing;
//   * no company authority = COMPANY_AUTHORITY_REQUIRED, on both reads;
//   * a Taylor-only caller never sees a Ventana Employee, schedule or blocked time; a Ventana caller never sees Taylor's;
//   * a named Ventana employeeId answers EXACTLY as an unknown id -- the same response shape and the same
//     notFoundEmployeeIds placement -- and runs the SAME number of database queries (one timing class);
//   * an operatingCompanyId outside the caller's reach answers EXACTLY as an unknown company, on both reads;
//   * Taylor's whole answer is identical however much Ventana data exists (added mid-test; the history is append-only).
import { endPoolAndDrain } from "./poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const availability = require("../../lib/eosOps/workOrderAvailability.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-availco";
const NOW = Date.parse("2030-10-01T12:00:00Z");
const WEEKDAYS = Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "08:00", end: "17:00" }]]));
const READ = new Set(["workOrder.lifecycle.dispatch"]);
const RANGE = { start: "2030-10-07T00:00:00Z", end: "2030-10-12T00:00:00Z" };
const SLOTS = { durationMinutes: 60, earliestDate: "2030-10-07", timeZone: "UTC", horizonDays: 5, limit: 200 };

test("availability reads under EOS Core company authority, against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `availco_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const q = (sql, v = []) => pool.query(sql, v);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  for (const c of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, c]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$2,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, c]);
  }
  const principal = async (pid) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$1,'eos','active')`, [pid]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`m-${pid}`, T, pid]);
  };
  const employee = async (eid, company, { technician }) => {
    const pid = `prn-${eid}`;
    await principal(pid);
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
             VALUES ($1,$2,'ACTIVE',$3,$1,$4)`, [eid, T, company, `Person ${eid}`]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','f','f')`, [`l-${eid}`, T, pid, eid, company]);
    if (technician) {
      await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
               VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'f','f')`, [`q-${eid}`, T, eid]);
    }
    return pid;
  };
  // Technicians of each company, and office callers of each company.
  for (const e of ["emp-t1", "emp-t2"]) await employee(e, "taylor", { technician: true });
  for (const e of ["emp-v1", "emp-v2"]) await employee(e, "ventana", { technician: true });
  const taylorCaller = await employee("emp-office-t", "taylor", { technician: false });
  const ventanaCaller = await employee("emp-office-v", "ventana", { technician: false });
  const bothCaller = await employee("emp-office-both", "taylor", { technician: false });
  await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ('role-reach',$1,'reachFixture','Reach fixture','SYSTEM','f','f')`, [T]);
  await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
           VALUES ('ura-both-v',$1,$2,'role-reach','operatingCompany','ventana','active','f',0,'f','f')`, [T, bothCaller]);
  await principal("prn-unlinked");

  let tick = 0;
  const deps = { pool, now: () => new Date(NOW + (tick++) * 1000) };
  const actor = (principalId, capabilities = READ) => ({ tenantId: T, principalId, capabilities });
  const TAYLOR = actor(taylorCaller), VENTANA = actor(ventanaCaller), BOTH = actor(bothCaller);
  const scheduler = actor(bothCaller, new Set(["workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch"]));
  // Every technician has hours, and Ventana's have blocked time, so there is real Ventana data to leak.
  for (const e of ["emp-t1", "emp-t2", "emp-v1", "emp-v2"]) {
    await availability.setTechnicianWorkingHours(deps, { actor: scheduler }, { employeeId: e, timeZone: "UTC", weeklyHours: WEEKDAYS, reason: "fixture" });
  }
  for (const e of ["emp-v1", "emp-v2"]) {
    await availability.recordTechnicianUnavailability(deps, { actor: scheduler },
      { employeeId: e, kind: "PTO", start: "2030-10-08T00:00:00Z", end: "2030-10-09T00:00:00Z", reason: "fixture" });
  }

  /** Run one read through a query-counting pool (and its clients), so two probes can be compared by query count too. */
  const counted = async (fn) => {
    let queries = 0;
    const wrap = (target) => new Proxy(target, { get: (o, k) => (k === "query" ? (...a) => { queries += 1; return o.query(...a); } : typeof o[k] === "function" ? o[k].bind(o) : o[k]) });
    const countedPool = new Proxy(pool, {
      get: (o, k) => (k === "query" ? (...a) => { queries += 1; return o.query(...a); }
        : k === "connect" ? async () => wrap(await o.connect()) : typeof o[k] === "function" ? o[k].bind(o) : o[k]),
    });
    let result;
    try { result = { ok: await fn({ ...deps, pool: countedPool }) }; } catch (e) { result = { refused: e.code, category: e.category, message: e.message }; }
    return { result, queries };
  };
  const read = (a, input) => (d) => availability.readTechnicianAvailability(d, { actor: a }, input);
  const slots = (a, input) => (d) => availability.findAvailableTechnicianSlots(d, { actor: a }, input);
  const ids = (r) => r.ok.technicians.map((x) => x.employeeId).sort();
  const refused = (code) => (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; };

  await t.test("CAPABILITY FIRST, then COMPANY AUTHORITY: no capability = CAPABILITY_MISSING; no company = COMPANY_AUTHORITY_REQUIRED", async () => {
    for (const who of [actor("prn-unlinked", new Set()), actor(taylorCaller, new Set(["workOrder.record.read"]))]) {
      await assert.rejects(read(who, RANGE)(deps), refused("CAPABILITY_MISSING"));
      await assert.rejects(slots(who, { ...SLOTS, operatingCompanyId: "taylor" })(deps), refused("CAPABILITY_MISSING"));
    }
    for (const call of [read(actor("prn-unlinked"), RANGE), slots(actor("prn-unlinked"), { ...SLOTS, operatingCompanyId: "taylor" })]) {
      await assert.rejects(call(deps), (e) => { assert.equal(e.code, "COMPANY_AUTHORITY_REQUIRED"); assert.equal(e.category, "FORBIDDEN"); return true; });
    }
  });

  await t.test("VISIBILITY: each caller reads only its own companies' technicians, hours and blocked time", async () => {
    const taylor = (await counted(read(TAYLOR, RANGE))).result;
    assert.deepEqual(ids(taylor), ["emp-t1", "emp-t2"]);
    assert.equal(taylor.ok.technicians.some((x) => x.operatingCompanyId !== "taylor" || x.blockedTime.length > 0), false);
    assert.deepEqual(ids((await counted(read(VENTANA, RANGE))).result), ["emp-v1", "emp-v2"]);
    assert.deepEqual(ids((await counted(read(BOTH, RANGE))).result), ["emp-t1", "emp-t2", "emp-v1", "emp-v2"]);
    const taylorSlots = (await counted(slots(TAYLOR, { ...SLOTS, operatingCompanyId: "taylor" }))).result.ok;
    assert.ok(taylorSlots.slots.length > 0);
    assert.equal(taylorSlots.slots.some((s) => !["emp-t1", "emp-t2"].includes(s.employeeId)), false);
  });

  await t.test("EQUIVALENCE (readTechnicianAvailability): a named Ventana Employee answers EXACTLY as an unknown id -- shape, notFoundEmployeeIds and query count", async () => {
    const pairs = [
      [{ employeeIds: ["emp-v1"] }, { employeeIds: ["emp-nobody"] }],
      [{ employeeIds: ["emp-v1", "emp-v2"] }, { employeeIds: ["emp-nobody", "emp-nobody-2"] }],
      [{ employeeIds: ["emp-t1", "emp-v1"] }, { employeeIds: ["emp-t1", "emp-nobody"] }],
      [{ employeeIds: ["emp-v1"], operatingCompanyId: "ventana" }, { employeeIds: ["emp-nobody"], operatingCompanyId: "no-such-company" }],
      [{ operatingCompanyId: "ventana" }, { operatingCompanyId: "no-such-company" }],
      [{ employeeIds: ["emp-t1"], operatingCompanyId: "ventana" }, { employeeIds: ["emp-t1"], operatingCompanyId: "no-such-company" }],
    ];
    // The probe ids differ by construction; notFoundEmployeeIds is compared POSITIONALLY (the same slots are reported missing).
    const normalize = (r, probeIds) => r.ok
      ? { ...r.ok, notFoundEmployeeIds: r.ok.notFoundEmployeeIds.map((id) => `#${probeIds.indexOf(id)}`) }
      : r;
    for (const [ventana, nothing] of pairs) {
      const a = await counted(read(TAYLOR, { ...RANGE, ...ventana }));
      const b = await counted(read(TAYLOR, { ...RANGE, ...nothing }));
      assert.deepEqual(normalize(a.result, ventana.employeeIds ?? []), normalize(b.result, nothing.employeeIds ?? []), JSON.stringify(ventana));
      assert.equal(a.queries, b.queries, `same query count (one timing class): ${JSON.stringify(ventana)}`);
    }
    // And the Ventana Employee is reported exactly where an unknown one would be.
    const r = (await counted(read(TAYLOR, { ...RANGE, employeeIds: ["emp-t1", "emp-v1"] }))).result.ok;
    assert.deepEqual(r.notFoundEmployeeIds, ["emp-v1"]);
    assert.deepEqual(r.technicians.map((x) => x.employeeId), ["emp-t1"]);
  });

  await t.test("EQUIVALENCE (findAvailableTechnicianSlots): a company outside reach is refused EXACTLY like an unknown one; a named Ventana Employee adds nothing, exactly like an unknown id", async () => {
    const outside = await counted(slots(TAYLOR, { ...SLOTS, operatingCompanyId: "ventana" }));
    const unknown = await counted(slots(TAYLOR, { ...SLOTS, operatingCompanyId: "no-such-company" }));
    assert.equal(outside.result.refused, "OPERATING_COMPANY_NOT_GOVERNED");
    assert.deepEqual(outside.result, unknown.result, "one code, one category, one message");
    assert.equal(outside.queries, unknown.queries, "same query count (one timing class)");
    for (const [ventana, nothing] of [[["emp-v1"], ["emp-nobody"]], [["emp-t1", "emp-v1"], ["emp-t1", "emp-nobody"]], [["emp-v1", "emp-v2"], ["emp-nobody", "emp-nobody-2"]]]) {
      const a = await counted(slots(TAYLOR, { ...SLOTS, operatingCompanyId: "taylor", employeeIds: ventana }));
      const b = await counted(slots(TAYLOR, { ...SLOTS, operatingCompanyId: "taylor", employeeIds: nothing }));
      // The searched range moves with the injected clock; everything else must match.
      const strip = (r) => (r.ok ? { ...r.ok, searchedFrom: null } : r);
      assert.deepEqual(strip(a.result), strip(b.result), JSON.stringify(ventana));
      assert.equal(a.queries, b.queries, `same query count: ${JSON.stringify(ventana)}`);
    }
  });

  await t.test("INDEPENDENCE: Taylor's availability answers are identical whatever Ventana technicians, hours and blocked time exist", async () => {
    // The history is append / close-only at the database, so the proof ADDS Ventana data rather than deleting it.
    const before = { read: (await counted(read(TAYLOR, RANGE))).result, slots: (await counted(slots(TAYLOR, { ...SLOTS, operatingCompanyId: "taylor" }))).result };
    await employee("emp-v3", "ventana", { technician: true });
    await availability.setTechnicianWorkingHours(deps, { actor: scheduler }, { employeeId: "emp-v3", timeZone: "UTC", weeklyHours: WEEKDAYS, reason: "fixture" });
    await availability.recordTechnicianUnavailability(deps, { actor: scheduler },
      { employeeId: "emp-v3", kind: "TRAINING", start: "2030-10-07T09:00:00Z", end: "2030-10-07T11:00:00Z", reason: "fixture" });
    const after = { read: (await counted(read(TAYLOR, RANGE))).result, slots: (await counted(slots(TAYLOR, { ...SLOTS, operatingCompanyId: "taylor" }))).result };
    assert.deepEqual(after.read, before.read);
    assert.deepEqual({ ...after.slots.ok, searchedFrom: null }, { ...before.slots.ok, searchedFrom: null });
    assert.ok(ids((await counted(read(VENTANA, RANGE))).result).includes("emp-v3"), "the Ventana data is real -- Ventana sees it");
  });
});
