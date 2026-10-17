// THE GOVERNED WORK ORDER LIST QUERY -- listWorkOrders { query } and describeWorkOrderListQuery
// (docs/architecture/object-filter-sort-standard.md; Owner decisions ND-1..ND-7, 2026-10-15).
//
// Imported by test/workOrderDomainCutoverPostgres.test.mjs so it runs in the Service Work Order Authority CI job
// without a workflow edit; it owns its own database and fixture world, so it shares nothing with that file but the run.
//
// Proves, against real PostgreSQL 16:
//   * filters apply in SQL BEFORE the page is cut -- matches older than any first page are returned on page one;
//   * every sortable field, both directions, pages by keyset with no duplicate and no gap (ties broken by id),
//     NULLs LAST both ways (ND-7), and stays correct when rows are inserted between pages;
//   * EOS Core company authority (ND-4, DECISIONS #235): a Taylor-only caller never sees, matches, sorts against or
//     is offered a Ventana Work Order -- on the governed path AND on the legacy filters; no authority = refused;
//   * fail closed: unknown, unbound and never-bound fields refuse identically; operators, values, cursors and
//     mixed shapes are refused without echoing a value; no counts anywhere in the response (ND-2);
//   * complaint text is not searchable (ND-6).
import { endPoolAndDrain } from "./poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { workOrderEntity } from "../../../field-ops-app-vite/src/metadata/definitions/workOrder.js";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const queries = require("../../lib/eosOps/workOrderQueries.js");
const lq = require("../../lib/eosOps/listQuery.js");
const woq = require("../../lib/eosOps/workOrderListQuery.js");
const ops = require("../../lib/eosOps/workOrderOperations.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const READ = new Set(["workOrder.record.read"]);

// ════════════════════ OFFLINE ════════════════════

test("LIST QUERY binding: the server serves every filter and sort the client Work Order definition declares", () => {
  const b = woq.WORK_ORDER_LIST_BINDING.fields;
  for (const f of workOrderEntity.fields) {
    if (f.filterable) {
      assert.ok(b[f.id]?.filter, `${f.id} is filterable in metadata and unbound on the server`);
      for (const op of f.operators) assert.ok(b[f.id].filter.operators.includes(op), `${f.id} ${op} is declared and not served`);
    }
    if (f.sortable) assert.ok(b[f.id]?.sort, `${f.id} is sortable in metadata and unbound on the server`);
  }
  // ND-6 and the recorded exclusions: never bound, so never filterable, sortable or searchable.
  for (const never of ["complaint", "diagnosis", "resolution", "rentalAgreementId", "createdByPrincipalId", "id"]) assert.equal(b[never], undefined, never);
  assert.deepEqual(woq.WORK_ORDER_LIST_FIELD_GROUPS.groups.map((g) => [g.key, g.read]), [["LIST", null]], "v1 grants nothing new");
});

test("LIST QUERY binding: a binding that promises more than its type can serve fails at load", () => {
  const base = { objectKey: "x", id: { expr: "t.id", cast: "text" }, defaultSort: [] };
  assert.throws(() => lq.defineListBinding({ ...base, fields: { a: { type: "TEXT", nullable: true, filter: { expr: "t.a", cast: "text", operators: ["EQUALS"] } } } }), /ceiling/);
  assert.throws(() => lq.defineListBinding({ ...base, fields: { a: { type: "STRING", nullable: false, filter: { expr: "t.a", cast: "text", operators: ["IS_NULL"] } } } }), /never NULL/);
  assert.throws(() => lq.defineListBinding({ ...base, fields: { a: { type: "ENUM", nullable: false, filter: { expr: "t.a", cast: "text", operators: ["EQUALS"] } } } }), /governed values/);
  assert.throws(() => lq.defineListBinding({ ...base, fields: { a: { type: "TEXT", nullable: true, sort: { expr: "t.a", cast: "text", nullable: true } } } }), /unsortable/);
  assert.throws(() => lq.defineListBinding({ ...base, fields: { "a;drop": { type: "STRING", nullable: true } } }), /plain identifier/);
});

test("LIST QUERY validation: fail closed, identical refusals, never a value echoed, nothing from the request in SQL", () => {
  const eff = woq.workOrderListFieldsFor(READ, ["taylor"]);
  const code = (raw) => { try { lq.validateListQuery(raw, eff, ["taylor"]); return "OK"; } catch (e) { return [e.code, e.message]; } };
  const notAvailable = code({ v: 1, filters: [{ field: "nope", op: "EQUALS", value: "x" }] });
  assert.equal(notAvailable[0], "LIST_QUERY_FIELD_NOT_AVAILABLE");
  for (const field of ["complaint", "rentalAgreementId", "id", "__proto__", "w.id; DROP TABLE x", 7]) {
    assert.deepEqual(code({ v: 1, filters: [{ field, op: "EQUALS", value: "x" }] }), notAvailable, `field ${String(field)}`);
  }
  assert.equal(code({ v: 1, sort: [{ field: "complaint", dir: "ASC" }] })[0], "LIST_QUERY_SORT_NOT_AVAILABLE");
  assert.deepEqual(code({ v: 1, sort: [{ field: "complaint", dir: "ASC" }] }), code({ v: 1, sort: [{ field: "nope", dir: "ASC" }] }));
  assert.equal(code({ v: 1, sort: [{ field: "type", dir: "ASC" }] })[0], "LIST_QUERY_SORT_NOT_AVAILABLE", "a classification has no order");
  assert.equal(code({ v: 1, filters: [{ field: "status", op: "GREATER_THAN", value: "CREATED" }] })[0], "LIST_QUERY_OPERATOR_NOT_AVAILABLE");
  const secret = code({ v: 1, filters: [{ field: "status", op: "EQUALS", value: "SECRET-VALUE-42" }] });
  assert.equal(secret[0], "LIST_QUERY_VALUE_INVALID");
  assert.equal(secret[1].includes("SECRET"), false, "a refusal never echoes a value");
  assert.equal(code({ v: 1, filters: [{ field: "company", op: "EQUALS", value: "ventana" }] })[0], "LIST_QUERY_VALUE_INVALID", "only the caller's companies");
  assert.equal(code({ v: 1, filters: [{ field: "priority", op: "EQUALS", value: "2" }] })[0], "LIST_QUERY_VALUE_INVALID", "typed values: 2, not '2'");
  assert.equal(code({ v: 1, filters: [{ field: "createdAt", op: "GREATER_OR_EQUAL", value: "yesterday" }] })[0], "LIST_QUERY_VALUE_INVALID");
  assert.equal(code({ v: 1, filters: [{ field: "status", op: "IN", value: Array(51).fill("CREATED") }] })[0], "LIST_QUERY_VALUE_INVALID");
  assert.equal(code({ v: 1, filters: Array(11).fill({ field: "status", op: "EQUALS", value: "CREATED" }) })[0], "LIST_QUERY_INVALID");
  assert.equal(code({ v: 1, filters: [{ field: "equipmentId", op: "IS_NULL", value: "x" }] })[0], "LIST_QUERY_VALUE_INVALID");
  assert.equal(code({ v: 1, limit: 201 })[0], "LIMIT_INVALID");
  assert.equal(code({ v: 1, limit: "50" })[0], "LIMIT_INVALID");
  assert.equal(code({ v: 2 })[0], "LIST_QUERY_INVALID");
  assert.equal(code({ v: 1, count: true })[0], "LIST_QUERY_INVALID", "no counts (ND-2): an unknown key is refused");
  assert.equal(code({ v: 1, sort: [{ field: "priority", dir: "asc; DROP" }] })[0], "LIST_QUERY_INVALID");
  assert.equal(code({ v: 1, cursor: "not-a-cursor" })[0], "CURSOR_INVALID");

  // Hostile text is a BOUND parameter, never SQL.
  const hostile = "x' OR 1=1; -- )’";
  const q = lq.validateListQuery({ v: 1, filters: [{ field: "woNumber", op: "TEXT_PREFIX", value: hostile }], search: hostile }, eff, ["taylor"]);
  const params = [];
  const c = lq.compileListQuery(eff, q, params);
  assert.equal([c.orderBy, c.selectKeys, ...c.predicates].join(" ").includes("1=1"), false);
  assert.ok(params.every((p) => typeof p === "string" && p.includes("1=1")));
});

test("LIST QUERY validation: a restricted field group removes the field from filter, sort, search and describe at once", () => {
  const restricted = lq.effectiveListFields(woq.WORK_ORDER_LIST_BINDING, { readable: (f) => f !== "customerId", callerValues: { company: ["taylor"] } });
  const d = lq.describeListQuery(restricted);
  assert.equal(d.fields.some((f) => f.field === "customerId"), false);
  assert.deepEqual(d.search, ["woNumber", "locationId"], "the customer name stops matching search");
  const unknown = (() => { try { lq.validateListQuery({ v: 1, filters: [{ field: "nope", op: "EQUALS", value: "a" }] }, restricted); } catch (e) { return [e.code, e.message]; } })();
  const hidden = (() => { try { lq.validateListQuery({ v: 1, filters: [{ field: "customerId", op: "EQUALS", value: "a" }] }, restricted); } catch (e) { return [e.code, e.message]; } })();
  assert.deepEqual(hidden, unknown, "an unreadable field is indistinguishable from one that does not exist");
  const narrowed = lq.effectiveListFields(woq.WORK_ORDER_LIST_BINDING, { readable: () => true, narrowing: { priority: { sort: false } }, callerValues: { company: ["taylor"] } });
  assert.equal(narrowed.fields.get("priority").sortable, false, "tenant narrowing switches an ability off");
  assert.ok(narrowed.fields.get("priority").operators.length > 0, "and only that ability");
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-wolq";
const pad = (n) => String(n).padStart(4, "0");
const MIN = 60_000;
const BASE = Date.parse("2026-06-01T00:00:00Z");
const TAYLOR_N = 240;
const VENTANA_N = 30;

// The fixture world, generated deterministically, so every expectation below is computed from THIS, not from SQL.
const ACCOUNTS = [["acct-a", "alpha Bakery"], ["acct-b", "Beta Grill"], ["acct-c", "charlie Cafe"], ["acct-v", "Ventana Ice"]];
const taylorRows = Array.from({ length: TAYLOR_N }, (_, k) => {
  const i = k + 1;
  const scheduled = i % 5 === 1 || i % 5 === 2;
  const start = scheduled ? BASE + 30 * 24 * 60 * MIN + (i % 17) * 60 * MIN : null;
  const status = i <= 10 ? "CLOSED" : ["CREATED", "SCHEDULED", "DISPATCHED", "COMPLETED"][i % 4];
  return {
    id: `wo-t-${pad(i)}`, company: "taylor", number: `WO-2026-${String(i).padStart(6, "0")}`, status,
    priority: (i % 4) + 1, severity: i % 3 === 0 ? null : ["EQUIPMENT_DOWN", "PARTIAL_OPERATION", "COSMETIC"][i % 3],
    customer: ["acct-a", "acct-b", "acct-c"][i % 3], scheduledStart: start, scheduledEnd: start === null ? null : start + 60 * MIN,
    // Pairs share a created_at, so the id tie-breaker is exercised on the default order.
    createdAt: BASE + Math.floor(i / 2) * MIN,
    assignee: i % 4 === 0 ? "emp-t1" : i % 4 === 1 ? "emp-t2" : null,
    complaint: i === 7 ? "compressor leaking badly" : null,
  };
});
const ventanaRows = Array.from({ length: VENTANA_N }, (_, k) => ({
  id: `wo-v-${pad(k + 1)}`, company: "ventana", number: `WO-2026-9${String(k + 1).padStart(5, "0")}`, status: "CREATED",
  priority: 1, severity: "EQUIPMENT_DOWN", customer: k % 2 === 0 ? "acct-v" : "acct-a", scheduledStart: null, scheduledEnd: null,
  createdAt: BASE + (10_000 + k) * MIN, assignee: null, complaint: null,
}));

test("the governed Work Order list query, against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wolq_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const person = async (pid, company) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$1,'eos','active')`, [pid]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`m-${pid}`, T, pid]);
    if (company) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id) VALUES ($1,$2,'ACTIVE',$3)`, [`emp-${pid}`, T, company]);
      await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','f','f')`, [`l-${pid}`, T, pid, `emp-${pid}`, company]);
    }
  };
  await person("prn-taylor", "taylor");
  await person("prn-ventana", "ventana");
  await person("prn-unlinked", null);
  for (const [id, display] of [["emp-t1", "Zed Tech"], ["emp-t2", "amy Tech"]]) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ($1,$2,'ACTIVE','taylor',$3)`, [id, T, display]);
  }
  for (const [id, n] of ACCOUNTS) {
    await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ($1,$2,$3,'ACTIVE','f','f')`, [id, T, n]);
    await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,created_by,updated_by) VALUES ($1,$2,$3,$4,'f','f')`, [`loc-${id}`, T, id, `${n} Main`]);
  }
  for (const r of [...taylorRows, ...ventanaRows]) {
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,severity,customer_id,location_id,
               scheduled_start,scheduled_end,completed_at,closed_at,complaint,provenance,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,'SERVICE_CALL',$6,$7,$8,$9,$10,$11,$12,$13,$14,'MIGRATED',$15,$15)`,
      [r.id, T, r.company, r.number, r.status, r.priority, r.severity, r.customer, `loc-${r.customer}`,
        r.scheduledStart && new Date(r.scheduledStart), r.scheduledEnd && new Date(r.scheduledEnd),
        r.status === "COMPLETED" ? new Date(r.createdAt + MIN) : null, r.status === "CLOSED" ? new Date(r.createdAt + 2 * MIN) : null,
        r.complaint, new Date(r.createdAt)]);
    if (r.assignee) {
      await q(`INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,provenance)
               VALUES ($1,$2,$3,$4,'MIGRATION',now(),'MIGRATED')`, [`a-${r.id}`, T, r.id, r.assignee]);
    }
  }
  await q(`INSERT INTO eos_ops.work_order_parts_plan (tenant_id,work_order_id,part_id,qty_planned,planned_by,updated_by)
           VALUES ($1,'wo-t-0003','part-x',2,'f','f'),($1,'wo-v-0001','part-x',2,'f','f')`, [T]);

  const actor = (principalId, capabilities = READ) => ({ tenantId: T, principalId, capabilities });
  const TAYLOR = actor("prn-taylor");
  const list = (a, query) => queries.listWorkOrders({ pool }, a, { query: { v: 1, ...query } });
  const all = async (a, query, limit = 37) => {
    const ids = [];
    let cursor;
    for (let n = 0; n < 50; n += 1) {
      const page = await list(a, { ...query, limit, ...(cursor ? { cursor } : {}) });
      ids.push(...page.items.map((w) => w.workOrderId));
      assert.equal(page.truncated, page.hasMore);
      if (!page.hasMore) { assert.equal(page.nextCursor, null); return ids; }
      cursor = page.nextCursor;
    }
    throw new Error("paging did not terminate");
  };
  const refused = (code) => (e) => { assert.equal(e.code, code, JSON.stringify({ code: e.code, message: e.message })); return true; };

  await t.test("FILTERS BEFORE PAGINATION: the ten oldest CLOSED Work Orders come back on page one", async () => {
    const page = await list(TAYLOR, { filters: [{ field: "status", op: "EQUALS", value: "CLOSED" }], limit: 6 });
    assert.equal(page.items.length, 6);
    assert.ok(page.items.every((w) => w.status === "CLOSED"));
    assert.equal(page.hasMore, true);
    const ids = await all(TAYLOR, { filters: [{ field: "status", op: "EQUALS", value: "CLOSED" }] }, 6);
    assert.deepEqual(ids.sort(), taylorRows.filter((r) => r.status === "CLOSED").map((r) => r.id).sort());
    assert.equal(Object.keys(page).sort().join(), "applied,hasMore,items,nextCursor,truncated", "no counts in the response (ND-2)");
  });

  const comparators = {
    woNumber: (r) => r.number, priority: (r) => r.priority, scheduledStart: (r) => r.scheduledStart,
    createdAt: (r) => r.createdAt, customerId: (r) => ACCOUNTS.find(([id]) => id === r.customer)[1].toLowerCase(),
    severity: (r) => (r.severity === null ? null : ["EQUIPMENT_DOWN", "PARTIAL_OPERATION", "COSMETIC", "PREVENTIVE"].indexOf(r.severity)),
    assignedTechId: (r) => (r.assignee === "emp-t1" ? "zed tech" : r.assignee === "emp-t2" ? "amy tech" : null),
    status: (r) => ["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED"].indexOf(r.status),
  };
  /** The expected order, computed in JS: value (NULLs LAST both directions), then id in the clause's direction. */
  const expected = (field, dir) => [...taylorRows].sort((a, b) => {
    const va = comparators[field](a); const vb = comparators[field](b);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * (dir === "ASC" ? 1 : -1);
    }
    return (a.id < b.id ? -1 : 1) * (dir === "ASC" ? 1 : -1);
  }).map((r) => r.id);

  await t.test("GLOBAL SORT + KEYSET: every sortable field, both directions, equals the whole-set order -- no duplicate, no gap, NULLs last", async () => {
    for (const field of Object.keys(comparators)) {
      for (const dir of ["ASC", "DESC"]) {
        assert.deepEqual(await all(TAYLOR, { sort: [{ field, dir }] }), expected(field, dir), `${field} ${dir}`);
      }
    }
    const describe = await queries.describeWorkOrderListQuery({ pool }, TAYLOR, {});
    const sortable = describe.fields.filter((f) => f.sortable).map((f) => f.field);
    for (const field of sortable.filter((f) => !(f in comparators))) {
      for (const dir of ["ASC", "DESC"]) {
        const ids = await all(TAYLOR, { sort: [{ field, dir }] }, 53);
        assert.equal(new Set(ids).size, TAYLOR_N, `${field} ${dir}: every Taylor Work Order exactly once`);
      }
    }
  });

  await t.test("DEFAULT ORDER is createdAt DESC with the id tie-break, and a two-clause sort orders by both", async () => {
    assert.deepEqual(await all(TAYLOR, {}), expected("createdAt", "DESC"));
    const two = await all(TAYLOR, { sort: [{ field: "priority", dir: "ASC" }, { field: "scheduledStart", dir: "DESC" }] }, 29);
    const exp = [...taylorRows].sort((a, b) => (a.priority - b.priority)
      || (a.scheduledStart === b.scheduledStart ? (a.id < b.id ? 1 : -1) : a.scheduledStart === null ? 1 : b.scheduledStart === null ? -1 : b.scheduledStart - a.scheduledStart)).map((r) => r.id);
    assert.deepEqual(two, exp);
  });

  await t.test("KEYSET under concurrent inserts: a row added before the cursor never duplicates or drops one", async () => {
    const first = await list(TAYLOR, { sort: [{ field: "createdAt", dir: "DESC" }], limit: 40 });
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,customer_id,location_id,provenance,created_at,updated_at)
             VALUES ('wo-t-late',$1,'taylor','WO-2026-777777','CREATED','SERVICE_CALL',2,'acct-a','loc-acct-a','MIGRATED',now(),now())`, [T]);
    const ids = [...first.items.map((w) => w.workOrderId)];
    let cursor = first.nextCursor;
    while (cursor) {
      const p = await list(TAYLOR, { sort: [{ field: "createdAt", dir: "DESC" }], limit: 40, cursor });
      ids.push(...p.items.map((w) => w.workOrderId));
      cursor = p.nextCursor;
    }
    assert.deepEqual(ids, expected("createdAt", "DESC"), "the newer row sorts before the cursor and is not inserted mid-stream");
    await q(`DELETE FROM eos_ops.work_orders WHERE id = 'wo-t-late'`);
  });

  await t.test("OPERATORS: ranges, IN / NOT IN, null tests, prefix, the parts-plan relationship, and search", async () => {
    const ids = async (filters, extra = {}) => (await all(TAYLOR, { filters, ...extra }, 200)).sort();
    const where = (fn) => taylorRows.filter(fn).map((r) => r.id).sort();
    assert.deepEqual(await ids([{ field: "priority", op: "IN", value: [1, 4] }]), where((r) => [1, 4].includes(r.priority)));
    assert.deepEqual(await ids([{ field: "severity", op: "IS_NULL" }]), where((r) => r.severity === null));
    assert.deepEqual(await ids([{ field: "severity", op: "NOT_IN", value: ["COSMETIC"] }]), where((r) => r.severity !== "COSMETIC"), "NOT IN keeps the NULLs");
    assert.deepEqual(await ids([{ field: "assignedTechId", op: "IS_NULL" }]), where((r) => r.assignee === null), "Unassigned");
    assert.deepEqual(await ids([{ field: "assignedTechId", op: "EQUALS", value: "emp-t1" }]), where((r) => r.assignee === "emp-t1"));
    assert.deepEqual(await ids([{ field: "scheduledStart", op: "IS_NULL" }]), where((r) => r.scheduledStart === null), "Unscheduled");
    const from = new Date(BASE + 50 * MIN).toISOString(); const to = new Date(BASE + 60 * MIN).toISOString();
    assert.deepEqual(await ids([{ field: "createdAt", op: "GREATER_OR_EQUAL", value: from }, { field: "createdAt", op: "LESS_THAN", value: to }]),
      where((r) => r.createdAt >= BASE + 50 * MIN && r.createdAt < BASE + 60 * MIN));
    assert.deepEqual(await ids([{ field: "customerId", op: "IN", value: ["acct-a", "acct-c"] }, { field: "priority", op: "NOT_EQUALS", value: 2 }]),
      where((r) => ["acct-a", "acct-c"].includes(r.customer) && r.priority !== 2), "conditions AND together");
    assert.deepEqual(await ids([{ field: "woNumber", op: "TEXT_PREFIX", value: "WO-2026-00001" }]), where((r) => r.number.startsWith("WO-2026-00001")));
    assert.deepEqual(await ids([{ field: "plannedPartId", op: "EQUALS", value: "part-x" }]), ["wo-t-0003"], "Ventana's plan for the same Part is not visible");
    assert.deepEqual(await ids([], { search: "BETA" }), where((r) => r.customer === "acct-b"), "search covers the customer name, case-insensitively");
    assert.deepEqual(await ids([], { search: "100%_" }), [], "LIKE metacharacters are literal");
  });

  await t.test("ND-6: complaint text is not searchable", async () => {
    assert.deepEqual((await list(TAYLOR, { search: "leaking" })).items, []);
    const d = await queries.describeWorkOrderListQuery({ pool }, TAYLOR, {});
    assert.deepEqual(d.search, ["woNumber", "customerId", "locationId"]);
  });

  await t.test("COMPANY AUTHORITY: a Taylor caller never sees, matches, sorts against or is offered a Ventana Work Order", async () => {
    const taylorIds = await all(TAYLOR, {}, 200);
    assert.equal(taylorIds.length, TAYLOR_N);
    assert.equal(taylorIds.some((id) => id.startsWith("wo-v-")), false);
    assert.deepEqual((await list(TAYLOR, { filters: [{ field: "customerId", op: "EQUALS", value: "acct-v" }] })).items, [], "a Ventana customer matches nothing");
    assert.deepEqual((await list(TAYLOR, { search: "Ventana Ice" })).items, []);
    assert.equal((await list(TAYLOR, { filters: [{ field: "customerId", op: "EQUALS", value: "acct-a" }] })).items.some((w) => w.operatingCompanyKey !== "taylor"), false,
      "the shared customer's Ventana work stays out");
    const d = await queries.describeWorkOrderListQuery({ pool }, TAYLOR, {});
    assert.deepEqual(d.fields.find((f) => f.field === "company").values, ["taylor"], "the company picklist is the caller's own");
    await assert.rejects(list(TAYLOR, { filters: [{ field: "company", op: "IN", value: ["taylor", "ventana"] }] }), refused("LIST_QUERY_VALUE_INVALID"));
    const ventana = await all(actor("prn-ventana"), {}, 200);
    assert.deepEqual(ventana.sort(), ventanaRows.map((r) => r.id).sort());
    // The LEGACY filters are company-scoped too.
    const legacy = await queries.listWorkOrders({ pool }, TAYLOR, { limit: 200, customerId: "acct-v" });
    assert.deepEqual(legacy.items, []);
    const legacyAll = await queries.listWorkOrders({ pool }, TAYLOR, { limit: 200 });
    assert.equal(legacyAll.items.some((w) => w.operatingCompanyKey !== "taylor"), false);
    for (const call of [() => list(actor("prn-unlinked"), {}), () => queries.listWorkOrders({ pool }, actor("prn-unlinked"), {}),
      () => queries.describeWorkOrderListQuery({ pool }, actor("prn-unlinked"), {})]) {
      // A STATED refusal, never an empty list: FORBIDDEN (403) with the server's sentence -- the words My Work renders as
      // "Not available to you -- <reason>." (MyWorkspace.jsx) and the client maps to its remedy copy (workOrderOutcome.js).
      await assert.rejects(call(), (e) => {
        assert.equal(e.code, "COMPANY_AUTHORITY_REQUIRED");
        assert.equal(e.category, "FORBIDDEN");
        assert.equal(e.message, "no operating-company authority: requires one access-eligible linked Employee with an active home company, or an operating-company assignment");
        return true;
      });
    }
  });

  await t.test("EQUIVALENCE: to a Taylor caller, every probe at a Ventana record answers EXACTLY as a probe at a record that does not exist", async () => {
    // Pairs of (aimed at Ventana data, aimed at nothing). Each pair must produce the identical page -- items, hasMore,
    // nextCursor -- or the identical refusal (code AND message). Anything else would let a Taylor caller learn that a
    // Ventana record, customer, Part or company exists.
    const probe = async (query) => {
      try {
        const p = await list(TAYLOR, query);
        return { items: p.items, hasMore: p.hasMore, nextCursor: p.nextCursor };
      } catch (e) { return { refused: e.code, message: e.message, category: e.category }; }
    };
    const legacy = async (input) => {
      try { const p = await queries.listWorkOrders({ pool }, TAYLOR, input); return { items: p.items, truncated: p.truncated }; }
      catch (e) { return { refused: e.code, message: e.message }; }
    };
    const pairs = [
      [{ filters: [{ field: "customerId", op: "EQUALS", value: "acct-v" }] }, { filters: [{ field: "customerId", op: "EQUALS", value: "acct-none" }] }],
      [{ filters: [{ field: "customerId", op: "IN", value: ["acct-v"] }] }, { filters: [{ field: "customerId", op: "IN", value: ["acct-none"] }] }],
      [{ filters: [{ field: "woNumber", op: "EQUALS", value: ventanaRows[0].number }] }, { filters: [{ field: "woNumber", op: "EQUALS", value: "WO-2026-555555" }] }],
      [{ filters: [{ field: "woNumber", op: "TEXT_PREFIX", value: "WO-2026-9" }] }, { filters: [{ field: "woNumber", op: "TEXT_PREFIX", value: "WO-2026-8" }] }],
      [{ search: "Ventana Ice" }, { search: "Nonexistent Shop" }],
      [{ search: ventanaRows[3].number }, { search: "WO-2026-555555" }],
      [{ filters: [{ field: "locationId", op: "EQUALS", value: "loc-acct-v" }] }, { filters: [{ field: "locationId", op: "EQUALS", value: "loc-none" }] }],
      [{ filters: [{ field: "company", op: "EQUALS", value: "ventana" }] }, { filters: [{ field: "company", op: "EQUALS", value: "no-such-company" }] }],
      [{ filters: [{ field: "company", op: "IN", value: ["ventana"] }] }, { filters: [{ field: "company", op: "IN", value: ["no-such-company"] }] }],
      // A Part only Ventana plans, vs a Part nobody plans.
      [{ filters: [{ field: "plannedPartId", op: "EQUALS", value: "part-v-only" }] }, { filters: [{ field: "plannedPartId", op: "EQUALS", value: "part-none" }] }],
    ];
    await q(`INSERT INTO eos_ops.work_order_parts_plan (tenant_id,work_order_id,part_id,qty_planned,planned_by,updated_by)
             VALUES ($1,'wo-v-0002','part-v-only',1,'f','f')`, [T]);
    for (const [ventana, nothing] of pairs) {
      for (const extra of [{}, { sort: [{ field: "customerId", dir: "ASC" }], limit: 1 }]) {
        assert.deepEqual(await probe({ ...ventana, ...extra }), await probe({ ...nothing, ...extra }), JSON.stringify(ventana));
      }
    }
    for (const [ventana, nothing] of [[{ customerId: "acct-v" }, { customerId: "acct-none" }], [{ search: "Ventana Ice" }, { search: "Nonexistent Shop" }],
      [{ plannedPartId: "part-v-only" }, { plannedPartId: "part-none" }]]) {
      assert.deepEqual(await legacy(ventana), await legacy(nothing), `legacy ${JSON.stringify(ventana)}`);
    }
    // The whole Taylor answer -- every page under every default -- is the same with Ventana's data present or deleted.
    const before = await all(TAYLOR, {}, 200);
    const describeBefore = await queries.describeWorkOrderListQuery({ pool }, TAYLOR, {});
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM eos_ops.work_order_parts_plan WHERE work_order_id LIKE 'wo-v-%'`);
      await client.query(`DELETE FROM eos_ops.work_orders WHERE id LIKE 'wo-v-%'`);
      assert.deepEqual(await (async () => {
        const ids = []; let cursor;
        for (;;) {
          const p = await queries.listWorkOrders({ pool: client }, TAYLOR, { query: { v: 1, limit: 200, ...(cursor ? { cursor } : {}) } });
          ids.push(...p.items.map((w) => w.workOrderId));
          if (!p.hasMore) return ids;
          cursor = p.nextCursor;
        }
      })(), before, "Taylor's list does not depend on Ventana rows existing");
      assert.deepEqual(await queries.describeWorkOrderListQuery({ pool: client }, TAYLOR, {}), describeBefore);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.work_orders WHERE id LIKE 'wo-v-%'`)).rows[0].n, VENTANA_N, "rolled back");
  });

  await t.test("CURSORS reposition inside ONE query and ONE scope -- anything else is refused, never restarted", async () => {
    const p = await list(TAYLOR, { filters: [{ field: "priority", op: "EQUALS", value: 1 }], limit: 5 });
    assert.ok(p.nextCursor);
    await assert.rejects(list(TAYLOR, { filters: [{ field: "priority", op: "EQUALS", value: 2 }], limit: 5, cursor: p.nextCursor }), refused("CURSOR_INVALID"));
    await assert.rejects(list(TAYLOR, { filters: [{ field: "priority", op: "EQUALS", value: 1 }], sort: [{ field: "woNumber", dir: "ASC" }], cursor: p.nextCursor }), refused("CURSOR_INVALID"));
    await assert.rejects(list(actor("prn-ventana"), { filters: [{ field: "priority", op: "EQUALS", value: 1 }], limit: 5, cursor: p.nextCursor }), refused("CURSOR_INVALID"),
      "a cursor minted under Taylor's scope is refused under Ventana's");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p.nextCursor, "base64url").toString()), k: ["x"] })).toString("base64url");
    await assert.rejects(list(TAYLOR, { filters: [{ field: "priority", op: "EQUALS", value: 1 }], limit: 5, cursor: forged }), refused("CURSOR_INVALID"));
  });

  await t.test("SHAPE: query is not mixed with the legacy filters; the capability gate still comes first; describe takes no input", async () => {
    await assert.rejects(queries.listWorkOrders({ pool }, TAYLOR, { query: { v: 1 }, statuses: ["CREATED"] }), refused("INPUT_FIELD_NOT_ACCEPTED"));
    await assert.rejects(list(actor("prn-taylor", new Set()), {}), refused("CAPABILITY_MISSING"));
    await assert.rejects(queries.describeWorkOrderListQuery({ pool }, TAYLOR, { x: 1 }), refused("INPUT_FIELD_NOT_ACCEPTED"));
    await assert.rejects(list(TAYLOR, { filters: [{ field: "complaint", op: "TEXT_CONTAINS", value: "leak" }] }), (e) => {
      assert.equal(e.code, "LIST_QUERY_FIELD_NOT_AVAILABLE"); assert.equal(e.category, "INVALID_INPUT"); assert.equal(e.message.includes("leak"), false); return true;
    });
    assert.ok(ops.WORK_ORDER_READ_OPERATIONS.includes("describeWorkOrderListQuery"));
    assert.equal(typeof ops.EOS_WORK_ORDER_OPERATIONS.describeWorkOrderListQuery, "function");
  });
});
