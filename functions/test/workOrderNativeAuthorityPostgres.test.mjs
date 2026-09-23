// NATIVE WORK ORDER AUTHORITY -- create, numbering and lifecycle, against a real postgres:16.
//
// The legacy path is the argument for most of what is proved here: createWorkOrder authorized on
// `caller.role` and identified technicians by `caller.technicianId`, so the client's own view of who it
// was decided what it could do. Every test below is a way that cannot happen again.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const create = require("../lib/eosOps/workOrderCreateCommand.js");
const numbering = require("../lib/eosOps/workOrderNumbering.js");
const lifecycle = require("../lib/eosOps/workOrderLifecycle.js");
const legacyEngine = require("../lib/transitionEngine.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const TENANT = "t-native";
// company id and key DIFFER, so any string shortcut fails loudly.
const COMPANY = "taylor";
const COMPANY_KEY = "sample-co-test";
const PRINCIPAL = "prn-creator";

test("native Work Order authority", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `native_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 10 });
  const q = (text, values = []) => pool.query(text, values);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const repo = new PostgresPolicyRepository(pool);
  const principalId = await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: "uid-creator", identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const authorize = (companyId, status = "ACTIVE") => q(
    `INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
     VALUES ($1,$2,$3,'test','fixture','fixture') ON CONFLICT (tenant_id, operating_company_id) DO UPDATE SET status=EXCLUDED.status`,
    [TENANT, companyId, status]);
  const bindKey = (companyId, key) => q(
    `INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
     VALUES ($1,$2,$3,'ACTIVE','NATIVE','test','fixture','fixture')`, [TENANT, companyId, key]);
  await authorize(COMPANY); await bindKey(COMPANY, COMPANY_KEY);
  await authorize("ventana");                      // ACTIVE company, deliberately UNKEYED
  await authorize("dormant", "INACTIVE");

  const deps = { pool };
  const actor = (over = {}) => ({
    tenantId: TENANT, principalId, capabilities: new Set([create.WORK_ORDER_CREATE, lifecycle.WORK_ORDER_TRANSITION]),
    operatingCompanyId: COMPANY, ...over,
  });
  const INPUT = Object.freeze({ customerId: "acct-1", locationId: "loc-1", workOrderType: "SERVICE_CALL", priority: 2 });
  const make = (overActor = {}, overInput = {}) => create.createWorkOrder(deps, actor(overActor), { ...INPUT, ...overInput });

  // ════════════════════ CREATE ════════════════════

  await t.test("a canonical Work Order is created, numbered, and opens its own history", async () => {
    const r = await make();
    assert.match(r.workOrderNumber, /^WO-[0-9]{4}-[0-9]{6}$/);
    assert.equal(r.status, "CREATED");
    assert.equal(r.provenance, "NATIVE");
    assert.equal(r.createdByPrincipalId, principalId);
    assert.equal(r.operatingCompanyKey, COMPANY_KEY);
    assert.notEqual(r.operatingCompanyKey, r.operatingCompanyId, "the key came from the binding, not the id");
    const history = await lifecycle.readTransitionHistory(pool, TENANT, r.workOrderId);
    assert.equal(history.length, 1, "creation writes exactly one opening transition");
    assert.equal(history[0].fromStatus, null, "nothing preceded creation");
    assert.deepEqual([history[0].toStatus, history[0].action, history[0].provenance], ["CREATED", "create", "NATIVE"]);
    assert.equal(history[0].actorPrincipalId, principalId);
  });

  await t.test("the CAPABILITY is required and is checked before anything is read", async () => {
    await assert.rejects(() => make({ capabilities: new Set() }), (e) => {
      assert.equal(e.code, "CAPABILITY_MISSING"); return true;
    });
  });

  await t.test("VENTANA -- ACTIVE company, no key -- fails closed", async () => {
    await assert.rejects(() => make({ operatingCompanyId: "ventana" }), (e) => {
      assert.equal(e.code, "OPERATING_COMPANY_KEY_NOT_BOUND");
      assert.match(e.message, /nothing is inferred from the company id/);
      return true;
    });
    const { rows } = await q(`SELECT count(*)::int AS n FROM eos_ops.work_orders WHERE operating_company_key='ventana'`);
    assert.equal(rows[0].n, 0, "no Ventana key was invented to make this pass");
  });

  await t.test("an INACTIVE or unknown company fails closed", async () => {
    for (const companyId of ["dormant", "acme"]) {
      await assert.rejects(() => make({ operatingCompanyId: companyId }), (e) => {
        assert.equal(e.code, "OPERATING_COMPANY_KEY_NOT_BOUND"); return true;
      }, companyId);
    }
    await assert.rejects(() => make({ operatingCompanyId: "" }), (e) => {
      assert.equal(e.code, "OPERATING_COMPANY_REQUIRED");
      assert.match(e.message, /never inferred from the customer/);
      return true;
    });
  });

  await t.test("the NATIVE type vocabulary is required, and legacy SERVICE is refused", async () => {
    for (const type of create.NATIVE_WORK_ORDER_TYPES) {
      const r = await make({}, { workOrderType: type });
      assert.equal(r.status, "CREATED", type);
    }
    for (const bad of ["SERVICE", "service_call", "EMERGENCY", ""]) {
      await assert.rejects(() => make({}, { workOrderType: bad }), (e) => {
        assert.equal(e.code, "WORK_ORDER_TYPE_INVALID");
        return true;
      }, bad);
    }
    // And the migration normalization is NOT reachable from native create.
    assert.equal(create.NATIVE_WORK_ORDER_TYPES.includes("SERVICE"), false);
  });

  await t.test("SERVER-AUTHORED fields cannot be forged by client input", async () => {
    for (const forged of [
      { id: "wo-forged" }, { workOrderNumber: "WO-2026-999999" }, { status: "COMPLETED" },
      { provenance: "MIGRATED" }, { createdBy: "someone" }, { operatingCompanyKey: "taylor" },
      { tenantId: "another" }, { completedAt: "2020-01-01" },
    ]) {
      await assert.rejects(() => make({}, forged), (e) => {
        assert.equal(e.code, "SERVER_AUTHORED_FIELD_REJECTED");
        assert.match(e.message, new RegExp(Object.keys(forged)[0]));
        return true;
      }, JSON.stringify(forged));
    }
    // An unknown field is refused too -- ignoring teaches a caller that sending it is fine.
    await assert.rejects(() => make({}, { nonsense: 1 }), (e) => {
      assert.equal(e.code, "INPUT_FIELD_NOT_ACCEPTED"); return true;
    });
  });

  await t.test("a refused create writes NOTHING -- no row, no number consumed", async () => {
    const before = await q(`SELECT (SELECT count(*)::int FROM eos_ops.work_orders) AS wo,
                                   (SELECT last_value FROM eos_ops.work_order_number_counters WHERE tenant_id=$1) AS seq`, [TENANT]);
    await assert.rejects(() => make({ operatingCompanyId: "ventana" }));
    const after = await q(`SELECT (SELECT count(*)::int FROM eos_ops.work_orders) AS wo,
                                  (SELECT last_value FROM eos_ops.work_order_number_counters WHERE tenant_id=$1) AS seq`, [TENANT]);
    assert.deepEqual(after.rows[0], before.rows[0], "a rolled-back create must consume no number");
  });

  // ════════════════════ NUMBERING ════════════════════

  await t.test("the format is exact and six digits is a FLOOR, not a cap", () => {
    assert.equal(numbering.formatWorkOrderNumber(2026, 65), "WO-2026-000065");
    assert.equal(numbering.formatWorkOrderNumber(2026, 1234567), "WO-2026-1234567", "never truncated");
    assert.match(numbering.formatWorkOrderNumber(2026, 1), numbering.WORK_ORDER_NUMBER_PATTERN);
    for (const bad of [[2026, 0], [2026, -1], [1969, 1]]) {
      assert.throws(() => numbering.formatWorkOrderNumber(bad[0], bad[1]));
    }
  });

  await t.test("the allocator does NOT use max()+1 -- derived from its own source", () => {
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/workOrderNumbering.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    assert.equal(/max\s*\(/i.test(src), false, "max()+1 races: two callers read the same maximum");
    assert.match(src, /ON CONFLICT \(tenant_id, year\)[\s\S]*DO UPDATE SET last_value/, "one locking statement");
    assert.match(src, /RETURNING last_value/);
  });

  await t.test("CONCURRENT allocation issues no duplicates", async () => {
    const at = new Date("2031-06-01T00:00:00.000Z");
    const results = await Promise.all(Array.from({ length: 25 }, () =>
      numbering.allocateWorkOrderNumber(pool, TENANT, at)));
    const numbers = results.map((r) => r.number);
    assert.equal(new Set(numbers).size, 25, "25 concurrent allocations, 25 distinct numbers");
    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    assert.deepEqual(sequences, Array.from({ length: 25 }, (_, i) => i + 1), "a dense 1..25 run, no gaps");
  });

  await t.test("a rolled-back allocation REUSES the number -- no gap in a business reference", async () => {
    const at = new Date("2032-01-01T00:00:00.000Z");
    const client = await pool.connect();
    await client.query("BEGIN");
    const inside = await numbering.allocateWorkOrderNumber(client, TENANT, at);
    await client.query("ROLLBACK");
    client.release();
    const after = await numbering.allocateWorkOrderNumber(pool, TENANT, at);
    assert.equal(after.number, inside.number,
      "a counter row rolls back with its transaction; a SEQUENCE would have left a gap nobody can explain");
  });

  await t.test("the YEAR comes from the instant, and each year starts its own run", async () => {
    const a = await numbering.allocateWorkOrderNumber(pool, TENANT, new Date("2040-12-31T23:59:59.000Z"));
    const b = await numbering.allocateWorkOrderNumber(pool, TENANT, new Date("2041-01-01T00:00:01.000Z"));
    assert.equal(a.year, 2040); assert.equal(b.year, 2041);
    assert.equal(b.sequence, 1, "a new year begins at 1");
    assert.match(b.number, /^WO-2041-000001$/);
  });

  await t.test("MIGRATED numbers are never re-issued: the counter is seeded past them", async () => {
    // The 13 migrated records carry WO-2026-000001..000064. Seed the same shape and prove the allocator
    // starts after it rather than colliding.
    const other = "t-seeded";
    await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [other]);
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority,
                customer_id, location_id, provenance, created_at, updated_at)
             VALUES ('wo-mig', $1, 'k', 'WO-2026-000064', 'CANCELLED', 'SERVICE_CALL', 2, 'c', 'l', 'MIGRATED', now(), now())`, [other]);
    // Re-seed exactly as the migration does.
    await q(`INSERT INTO eos_ops.work_order_number_counters (tenant_id, year, last_value)
             SELECT tenant_id, substring(work_order_number FROM 4 FOR 4)::int, max(substring(work_order_number FROM 9)::bigint)
               FROM eos_ops.work_orders WHERE tenant_id = $1 AND work_order_number IS NOT NULL GROUP BY 1,2
             ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = EXCLUDED.last_value`, [other]);
    const next = await numbering.allocateWorkOrderNumber(pool, other, new Date("2026-05-01T00:00:00.000Z"));
    assert.equal(next.number, "WO-2026-000065", "the next native number follows the highest migrated one");
    const { rows } = await q(`SELECT work_order_number FROM eos_ops.work_orders WHERE id='wo-mig'`);
    assert.equal(rows[0].work_order_number, "WO-2026-000064", "and the migrated number is untouched");
  });

  // ════════════════════ LIFECYCLE ════════════════════

  await t.test("the status vocabulary is THE canonical one -- no second lifecycle", () => {
    assert.deepEqual([...lifecycle.WORK_ORDER_STATUSES].sort(), Object.keys(legacyEngine.TRANSITIONS).sort());
    assert.deepEqual([...lifecycle.TERMINAL_STATUSES].sort(), [...legacyEngine.TERMINAL_STATUSES].sort());
  });

  await t.test("the matrix is EXACTLY the live process's edges -- none added, none dropped", () => {
    const legacy = new Set();
    for (const [from, tos] of Object.entries(legacyEngine.TRANSITIONS)) for (const to of tos) legacy.add(`${from}->${to}`);
    const mine = new Set(lifecycle.TRANSITION_MATRIX.map((r) => `${r.from}->${r.to}`));
    assert.deepEqual([...mine].sort(), [...legacy].sort(), "the matrix must not invent a business transition");
  });

  await t.test("every NOT_YET_IMPLEMENTED edge names what it depends on", () => {
    for (const r of lifecycle.TRANSITION_MATRIX) {
      if (r.disposition === "NOT_YET_IMPLEMENTED") {
        assert.ok(r.dependsOn && r.dependsOn.length > 20, `${r.from}->${r.to} must say what is missing`);
      } else {
        assert.equal(r.dependsOn, null);
      }
    }
    // The three inventory-effect statuses are all deferred, per inventoryService STATE_TRIGGERS.
    for (const to of ["DISPATCHED", "COMPLETED", "CANCELLED"]) {
      const edges = lifecycle.TRANSITION_MATRIX.filter((r) => r.to === to);
      assert.ok(edges.length > 0);
      for (const e of edges) assert.equal(e.disposition, "NOT_YET_IMPLEMENTED", `${e.from}->${to}`);
    }
  });

  await t.test("an ALLOWED transition succeeds and writes history exactly once", async () => {
    const wo = await make();
    const r = await lifecycle.transitionWorkOrder(deps, actor(), {
      workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH", note: "ready",
    });
    assert.deepEqual([r.fromStatus, r.toStatus, r.action], ["CREATED", "READY_TO_DISPATCH", "markReadyToDispatch"]);
    const history = await lifecycle.readTransitionHistory(pool, TENANT, wo.workOrderId);
    assert.equal(history.length, 2, "create + one transition");
    assert.equal(history[1].actorPrincipalId, principalId);
    const { rows } = await q(`SELECT status::text AS s FROM eos_ops.work_orders WHERE id=$1`, [wo.workOrderId]);
    assert.equal(rows[0].s, "READY_TO_DISPATCH");
  });

  await t.test("a transition whose authority is missing FAILS CLOSED rather than changing status", async () => {
    const wo = await make();
    await lifecycle.transitionWorkOrder(deps, actor(), { workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH" });
    await assert.rejects(() => lifecycle.transitionWorkOrder(deps, actor(), {
      workOrderId: wo.workOrderId, expectedStatus: "READY_TO_DISPATCH", toStatus: "SCHEDULED",
    }), (e) => {
      assert.equal(e.code, "TRANSITION_AUTHORITY_UNAVAILABLE");
      assert.match(e.message, /scheduling authority/);
      return true;
    });
    const { rows } = await q(`SELECT status::text AS s FROM eos_ops.work_orders WHERE id=$1`, [wo.workOrderId]);
    assert.equal(rows[0].s, "READY_TO_DISPATCH", "the status did not move");
    assert.equal((await lifecycle.readTransitionHistory(pool, TENANT, wo.workOrderId)).length, 2, "and no history was written");
  });

  await t.test("cancellation fails closed because the RELEASE effect is not composed", async () => {
    const wo = await make();
    await assert.rejects(() => lifecycle.transitionWorkOrder(deps, actor({ capabilities: new Set([lifecycle.WORK_ORDER_LIFECYCLE_CANCEL]) }), {
      workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "CANCELLED",
    }), (e) => {
      assert.equal(e.code, "TRANSITION_AUTHORITY_UNAVAILABLE");
      assert.match(e.message, /releaseParts|strands the stock/);
      return true;
    });
  });

  // ════════════════════ CAPABILITY VOCABULARY AND THE EFFECT BOUNDARY ════════════════════

  await t.test("the engine asks for the POSTGRESQL vocabulary, and workOrder.cancel is gone", async () => {
    const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    for (const rel of ["src/eosOps/workOrderLifecycle.ts", "src/eosOps/workOrderCreateCommand.ts"]) {
      const src = strip(readFileSync(resolve(FUNCTIONS_DIR, rel), "utf8"));
      assert.equal(/["'`]workOrder\.cancel["'`]/.test(src), false,
        `${rel} still references workOrder.cancel, which exists only in the Firestore catalog`);
    }
    // The keys the engine actually uses, all of which must exist in eos_policy.capabilities.
    const used = new Set(lifecycle.TRANSITION_MATRIX.map((r) => r.capability));
    used.add(create.WORK_ORDER_CREATE);
    const { rows } = await q(`SELECT key FROM eos_policy.capabilities WHERE key = ANY($1::text[])`, [[...used]]);
    assert.deepEqual([...rows.map((r) => r.key)].sort(), [...used].sort(),
      "every capability this engine asks for must exist in the PostgreSQL vocabulary");
    // And the one the ruling refused must NOT have been added.
    const absent = await q(`SELECT count(*)::int AS n FROM eos_policy.capabilities WHERE key = 'workOrder.cancel'`);
    assert.equal(absent.rows[0].n, 0, "workOrder.cancel would duplicate workOrder.lifecycle.cancel");
  });

  await t.test("each EFFECT-BEARING edge carries its own capability -- the general key is not a superset", () => {
    const expected = { DISPATCHED: "workOrder.lifecycle.dispatch", COMPLETED: "workOrder.lifecycle.complete", CANCELLED: "workOrder.lifecycle.cancel" };
    for (const [to, capability] of Object.entries(expected)) {
      const edges = lifecycle.TRANSITION_MATRIX.filter((r) => r.to === to);
      assert.ok(edges.length > 0, to);
      for (const e of edges) {
        assert.equal(e.capability, capability, `${e.from}->${to} must require ${capability}`);
        assert.notEqual(e.capability, lifecycle.WORK_ORDER_TRANSITION,
          `${e.from}->${to} writes an inventory commitment; the general capability must not stand in for it`);
      }
    }
    // Conversely the non-effect edges use the general key and nothing more specific.
    for (const e of lifecycle.TRANSITION_MATRIX.filter((r) => !lifecycle.EFFECT_BEARING_TARGET_STATUSES.includes(r.to))) {
      assert.equal(e.capability, lifecycle.WORK_ORDER_TRANSITION, `${e.from}->${e.to}`);
    }
  });

  await t.test("workOrder.transition alone cannot authorize dispatch, cancel or complete", async () => {
    const general = actor({ capabilities: new Set([create.WORK_ORDER_CREATE, lifecycle.WORK_ORDER_TRANSITION]) });
    for (const [expectedStatus, toStatus] of [["SCHEDULED", "DISPATCHED"], ["WORK_IN_PROGRESS", "COMPLETED"], ["CREATED", "CANCELLED"]]) {
      const wo = await make();
      await q(`UPDATE eos_ops.work_orders SET status=$2::eos_ops.ops_work_order_status WHERE id=$1`, [wo.workOrderId, expectedStatus]);
      await assert.rejects(() => lifecycle.transitionWorkOrder(deps, general, { workOrderId: wo.workOrderId, expectedStatus, toStatus }),
        (e) => {
          // FORBIDDEN, not "unavailable": an unauthorized caller is told it is unauthorized and nothing more.
          assert.equal(e.code, "CAPABILITY_MISSING", `${expectedStatus}->${toStatus}`);
          assert.match(e.message, /workOrder\.lifecycle\./);
          return true;
        }, `${expectedStatus}->${toStatus}`);
    }
  });

  await t.test("holding the SPECIFIC capability gets past authorization and then fails closed on the effect", async () => {
    const wo = await make();
    await q(`UPDATE eos_ops.work_orders SET status='SCHEDULED' WHERE id=$1`, [wo.workOrderId]);
    await assert.rejects(() => lifecycle.transitionWorkOrder(deps, actor({ capabilities: new Set([lifecycle.WORK_ORDER_LIFECYCLE_DISPATCH]) }), {
      workOrderId: wo.workOrderId, expectedStatus: "SCHEDULED", toStatus: "DISPATCHED",
    }), (e) => {
      assert.equal(e.code, "TRANSITION_AUTHORITY_UNAVAILABLE", "authorized, but the reserve effect is not composed");
      return true;
    });
  });

  await t.test("create requires workOrder.create -- no lifecycle key substitutes for it", async () => {
    for (const caps of [[lifecycle.WORK_ORDER_TRANSITION], [lifecycle.WORK_ORDER_LIFECYCLE_DISPATCH], [lifecycle.WORK_ORDER_LIFECYCLE_CANCEL], []]) {
      await assert.rejects(() => make({ capabilities: new Set(caps) }), (e) => {
        assert.equal(e.code, "CAPABILITY_MISSING"); return true;
      }, JSON.stringify(caps));
    }
    // And workOrder.create does not authorize a transition.
    const wo = await make();
    await assert.rejects(() => lifecycle.transitionWorkOrder(deps, actor({ capabilities: new Set([create.WORK_ORDER_CREATE]) }), {
      workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH",
    }), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
  });

  await t.test("a transition the business does not perform is REFUSED", async () => {
    const wo = await make();
    await assert.rejects(() => lifecycle.transitionWorkOrder(deps, actor(), {
      workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "COMPLETED",
    }), (e) => { assert.equal(e.code, "TRANSITION_NOT_ALLOWED"); return true; });
  });

  await t.test("a STALE expected state loses the race", async () => {
    const wo = await make();
    await lifecycle.transitionWorkOrder(deps, actor(), { workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH" });
    await assert.rejects(() => lifecycle.transitionWorkOrder(deps, actor(), {
      workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH",
    }), (e) => {
      assert.equal(e.code, "STALE_WORK_ORDER_STATE");
      assert.equal(e.category, "CONFLICT");
      return true;
    });
  });

  await t.test("two simultaneous transitions from the same state: exactly one wins", async () => {
    const wo = await make();
    const attempt = () => lifecycle.transitionWorkOrder(deps, actor(), {
      workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH",
    }).then(() => "won").catch((e) => e.code);
    const [a, b] = await Promise.all([attempt(), attempt()]);
    assert.deepEqual([a, b].filter((x) => x === "won").length, 1, `exactly one winner, got ${a}/${b}`);
    assert.equal((await lifecycle.readTransitionHistory(pool, TENANT, wo.workOrderId)).length, 2,
      "and history records the move once");
  });

  await t.test("a transition requires its capability", async () => {
    const wo = await make();
    await assert.rejects(() => lifecycle.transitionWorkOrder(deps, actor({ capabilities: new Set() }), {
      workOrderId: wo.workOrderId, expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH",
    }), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
  });

  await t.test("history is APPEND-ONLY at the database, not merely by convention", async () => {
    const wo = await make();
    await assert.rejects(() => q(`UPDATE eos_ops.work_order_transitions SET to_status='CLOSED' WHERE work_order_id=$1`, [wo.workOrderId]),
      /append-only/);
    await assert.rejects(() => q(`DELETE FROM eos_ops.work_order_transitions WHERE work_order_id=$1`, [wo.workOrderId]),
      /append-only/);
  });

  // ════════════════════ MIGRATED RECORD COMPATIBILITY ════════════════════

  await t.test("a MIGRATED Work Order uses the native transition command -- one runtime, not two", async () => {
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority,
                customer_id, location_id, provenance, completed_at, created_at, updated_at)
             VALUES ('wo-migrated-1', $1, $2, 'WO-2019-000008', 'COMPLETED', 'SERVICE_CALL', 2, 'acct-1', 'loc-1',
                     'MIGRATED', now(), now(), now())`, [TENANT, COMPANY_KEY]);
    const r = await lifecycle.transitionWorkOrder(deps, actor(), {
      workOrderId: "wo-migrated-1", expectedStatus: "COMPLETED", toStatus: "CLOSED",
    });
    assert.equal(r.toStatus, "CLOSED");
    const { rows } = await q(`SELECT status::text AS s, provenance::text AS p, closed_at IS NOT NULL AS closed FROM eos_ops.work_orders WHERE id='wo-migrated-1'`);
    assert.deepEqual(rows[0], { s: "CLOSED", p: "MIGRATED", closed: true },
      "the record stays MIGRATED -- provenance describes origin, not which commands may act on it");
    const history = await lifecycle.readTransitionHistory(pool, TENANT, "wo-migrated-1");
    assert.equal(history.at(-1).provenance, "NATIVE", "the TRANSITION is native: it really happened now");
    assert.equal(history.at(-1).actorPrincipalId, principalId);
  });

  // ════════════════════ ARCHITECTURE ════════════════════

  await t.test("no Firebase, no legacy caller identity, no string company inference", () => {
    for (const rel of ["src/eosOps/workOrderCreateCommand.ts", "src/eosOps/workOrderLifecycle.ts", "src/eosOps/workOrderNumbering.ts"]) {
      const src = readFileSync(resolve(FUNCTIONS_DIR, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
      assert.equal(/firebase-admin|firebase-functions|getFirestore|onCall/.test(src), false, `${rel}: Firebase`);
      assert.equal(/caller\.role|caller\.technicianId|customClaims|operationalRoles/.test(src), false, `${rel}: legacy caller identity`);
      assert.equal(/jobRole|jobTitle/i.test(src), false, `${rel}: Job Role authorization`);
      assert.equal(/["'`]taylor["'`]|["'`]ventana["'`]/i.test(src), false, `${rel}: a named company`);
      assert.equal(/operatingCompanyKey\s*[:=]\s*[a-zA-Z_.]*operatingCompanyId/.test(src), false, `${rel}: key inferred from id`);
    }
    // The create command resolves the key through the SHARED authority.
    const createSrc = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/workOrderCreateCommand.ts"), "utf8");
    assert.match(createSrc, /resolveOperatingCompanyKeyForCompany/);
  });

  await t.test("there is no arbitrary status mutation in the command API", () => {
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/workOrderLifecycle.ts"), "utf8");
    // Every status write goes through the matrix; the only UPDATE sets status from a validated toStatus.
    const updates = [...src.matchAll(/UPDATE \$\{SCHEMA\}\.work_orders[\s\S]{0,200}/g)].map((m) => m[0]);
    assert.equal(updates.length, 1, "exactly one status writer");
    assert.match(updates[0], /SET status = \$3/);
    assert.equal(/setStatus|updateStatus\s*\(/.test(src), false, "no free-form status setter is exported");
  });
});
