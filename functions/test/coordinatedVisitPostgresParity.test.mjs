// COORDINATED OPERATIONS — legacy projection vs the PostgreSQL read seam, over ONE dataset.
//
// The capability `fulfillment.coordinatedVisit.read` is governed in PostgreSQL; the read it governs
// still reaches `fieldops_wos` (COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER). This suite proves the
// PostgreSQL side reproduces the legacy projection exactly, and names every place it does not.
//
// The two sides are fed THE SAME business dataset: the PostgreSQL rows and the in-memory Firestore
// documents are generated from one fixture table, so a divergence is a real divergence and not two
// authors disagreeing about a fixture.
//
// Prerequisite: `npm run build` in functions/ (this suite imports the compiled lib/ output).
// The database half runs only with POLICY_TEST_DATABASE_URL set, with --test-concurrency=1.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FUNCTIONS_DIR, "src");
const require = createRequire(import.meta.url);

const legacy = require("../lib/fulfillment/coordinatedVisitReadService.js");
const visits = require("../lib/fulfillment/coordinatedVisit.js");
const target = require("../lib/eosOps/coordinatedVisitPostgresRead.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const LEGACY_SOURCE = readFileSync(join(SRC, "fulfillment", "coordinatedVisitReadService.ts"), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// ════════════════════════════════════════════════════════════════════════════════════
// 1. THE LEGACY CONTRACT, EXTRACTED FROM THE LEGACY FILE — never restated from memory
// ════════════════════════════════════════════════════════════════════════════════════

/** The legacy status list, read out of its own source rather than copied into this test. */
function legacyActiveStatuses() {
  const block = /const ACTIVE_COORDINATION_STATUSES = \[([\s\S]*?)\] as const;/.exec(LEGACY_SOURCE);
  assert.ok(block, "the legacy read no longer declares ACTIVE_COORDINATION_STATUSES; this ratchet is stale");
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}
function legacyNumber(name) {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(LEGACY_SOURCE);
  assert.ok(m, `the legacy read no longer declares ${name}`);
  return Number(m[1]);
}

test("the PostgreSQL seam governs the SAME capability key the legacy read governs", () => {
  assert.equal(target.COORDINATED_VISIT_CAPABILITY.key, legacy.COORDINATED_VISIT_READ_CAPABILITY);
  assert.equal(target.COORDINATED_VISIT_CAPABILITY.key, "fulfillment.coordinatedVisit.read");
  // Re-homed onto the Sales Order as a named business act, NOT the Object's generic READ verb.
  assert.equal(target.COORDINATED_VISIT_CAPABILITY.objectKey, "salesOrder");
  assert.equal(target.COORDINATED_VISIT_CAPABILITY.actionKey, "readCoordinatedVisits");
  assert.equal(target.COORDINATED_VISIT_CAPABILITY.actionKind, "BUSINESS_ACTION");
  assert.notEqual(target.COORDINATED_VISIT_CAPABILITY.actionKey, "read");
});

test("the active coordination queue is the legacy one, status for status", () => {
  assert.deepEqual([...target.ACTIVE_COORDINATION_STATUSES], legacyActiveStatuses());
  assert.equal(target.ACTIVE_COORDINATION_STATUSES.length, 10);
  assert.equal(target.ACTIVE_COORDINATION_STATUSES.includes("CLOSED"), false, "a closed Work Order is archived");
  // Dropping CANCELLED would hide the only status coordinatedVisit.ts can reach ATTENTION through.
  assert.equal(target.ACTIVE_COORDINATION_STATUSES.includes("CANCELLED"), true);
  assert.deepEqual([...visits.BLOCKED_STATUSES], ["CANCELLED"]);
});

test("the bounds are the legacy bounds", () => {
  assert.equal(target.DEFAULT_LIMIT, legacyNumber("DEFAULT_LIMIT"));
  assert.equal(target.MAX_RESOLVED_SALES_ORDER_REFERENCES, legacy.MAX_RESOLVED_SALES_ORDER_REFERENCES);
});

test("every difference from the legacy read is declared, with a reason", () => {
  const ids = target.DELIBERATE_PARITY_DIFFERENCES.map((d) => d.id);
  assert.deepEqual(ids, [
    "TENANT_SCOPED", "ALLOCATED_QTY_UNAVAILABLE", "LINE_REF_IDENTITY_IS_THE_LINE_NUMBER",
    "REFERENCE_RESOLUTION_DOES_NOT_FAIL_SOFT",
  ]);
  for (const d of target.DELIBERATE_PARITY_DIFFERENCES) {
    for (const field of ["legacy", "postgres", "why"]) {
      assert.ok(typeof d[field] === "string" && d[field].length > 20, `${d.id}.${field} is a label, not a statement`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════════════
// 2. NO CUTOVER, NO FIREBASE
// ════════════════════════════════════════════════════════════════════════════════════

test("NO CUTOVER: the legacy read still reads fieldops_wos and nothing imports the PostgreSQL seam", () => {
  assert.ok(LEGACY_SOURCE.includes("WORK_ORDERS_COLLECTION"),
    "the legacy read stopped naming the legacy collection -- that would be a cutover, not a seam");
  assert.ok(LEGACY_SOURCE.includes("export const listCoordinatedOperations = onCall"),
    "listCoordinatedOperations is no longer the Firebase callable it was");
  assert.equal(/coordinatedVisitPostgresRead/.test(LEGACY_SOURCE), false,
    "the legacy read reaches the PostgreSQL seam");

  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (full.endsWith(".ts") || full.endsWith(".tsx") || full.endsWith(".js") || full.endsWith(".jsx")) out.push(full);
    }
    return out;
  };
  // IMPORTS, not mentions. COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER names the seam's PATH as
  // tracking data, which is the opposite of reaching it; an import specifier is the thing to forbid.
  const REACHES = /(?:from\s+["'][^"']*coordinatedVisitPostgresRead["']|require\(\s*["'][^"']*coordinatedVisitPostgresRead["']|import\(\s*["'][^"']*coordinatedVisitPostgresRead["'])/;
  const importers = walk(SRC)
    .filter((f) => f !== join(SRC, "eosOps", "coordinatedVisitPostgresRead.ts"))
    .filter((f) => REACHES.test(readFileSync(f, "utf8")))
    .map((f) => relative(FUNCTIONS_DIR, f).split("\\").join("/"));
  assert.deepEqual(importers, [], "a runtime module reaches the seam; this slice builds it and switches nothing");
  // And the only place that names it at all is the tracker.
  const mentions = walk(SRC)
    .filter((f) => f !== join(SRC, "eosOps", "coordinatedVisitPostgresRead.ts"))
    .filter((f) => /coordinatedVisitPostgresRead/.test(readFileSync(f, "utf8")))
    .map((f) => relative(FUNCTIONS_DIR, f).split("\\").join("/"));
  assert.deepEqual(mentions, ["src/adminPolicy/migration/credEquivalence.ts"]);

  const clientDir = join(FUNCTIONS_DIR, "..", "field-ops-app-vite", "src");
  const clientHits = walk(clientDir)
    .filter((f) => /coordinatedVisitPostgresRead|readCoordinatedOperations\b/.test(readFileSync(f, "utf8")));
  assert.deepEqual(clientHits, [], "a North Star client reaches the seam");
});

test("the tracked blocker names the seam, the proof, and what is still left", () => {
  const { COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER: b } = require("../lib/adminPolicy/migration/credEquivalence.js");
  assert.equal(b.capability, target.COORDINATED_VISIT_CAPABILITY.key);
  assert.equal(b.sourceCollection, "fieldops_wos", "the blocker must keep naming the collection the read still reaches");
  assert.equal(b.postgresSeam, "functions/src/eosOps/coordinatedVisitPostgresRead.ts");
  assert.equal(b.parityProof, "functions/test/coordinatedVisitPostgresParity.test.mjs");
  for (const path of [b.readService, b.postgresSeam, b.parityProof]) {
    assert.ok(statSync(join(FUNCTIONS_DIR, "..", path)).isFile(), `${path} does not exist; the tracker is stale`);
  }
  assert.ok(b.remaining.length > 40, "a real statement of what is left, not a label");
});

test("NO FIREBASE: the seam names none, and loading it resolves none", () => {
  const code = strip(readFileSync(join(SRC, "eosOps", "coordinatedVisitPostgresRead.ts"), "utf8"));
  for (const forbidden of [/firebase/i, /getFirestore/, /\bonCall\b/, /HttpsError/, /resolveEffectiveAccess/,
    /permissionCatalog/, /operationalRoles/, /caller\.role/, /\buid\b/, /\bcollection\(/, /WORK_ORDERS_COLLECTION/]) {
    assert.doesNotMatch(code, forbidden, `the seam reaches for ${forbidden}`);
  }
  // `fieldops_wos` may be NAMED -- the declared difference has to say which collection the legacy read
  // reaches, exactly as COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER does -- but only inside that data.
  const named = [...code.matchAll(/fieldops_wos/g)];
  assert.equal(named.length, 1, "fieldops_wos is named outside the declared-difference record");
  assert.ok(/legacy: "the fieldops_wos collection is global/.test(code));
  const sentinel = "CV_SEAM_LOADED_FIREBASE";
  const preload = join(mkdtempSync(join(tmpdir(), "cv-")), "preload.cjs");
  writeFileSync(preload, `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.stderr.write("${sentinel}:"+r);process.exit(97);}return l.call(this,r,...a);};`);
  const probe = spawnSync(process.execPath, ["--require", preload, "-e",
    `require(${JSON.stringify(join(FUNCTIONS_DIR, "lib", "eosOps", "coordinatedVisitPostgresRead.js"))});`],
  { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.equal(probe.status, 0, `the seam transitively loaded Firebase: ${probe.stderr}`);
});

test("READ ONLY: the seam contains no write SQL and no lock", () => {
  const code = strip(readFileSync(join(SRC, "eosOps", "coordinatedVisitPostgresRead.ts"), "utf8"));
  for (const forbidden of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+[a-z_]+\.[a-z_]+\s+SET\b/i, /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i, /\bMERGE\s+INTO\b/i, /FOR\s+UPDATE/i, /nextval|setval/i, /pg_advisory/i,
    /CREATE\s+TABLE/i, /dispatch_schedule/i, /coordinated_visits/i]) {
    assert.doesNotMatch(code, forbidden, `the seam contains ${forbidden}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════
// 3. THE SHARED FIXTURE — one business dataset, two backends
// ════════════════════════════════════════════════════════════════════════════════════

const TENANT = "t-cv";
const OTHER_TENANT = "t-other";

/** The anchoring Sales Orders and their lines. `so-missing` is an anchor no Sales Order answers to. */
const SALES_ORDERS = [
  { id: "so-alpha", number: "SO-2026-000001", account: "acct-1", lines: [
    { lineNumber: 1, kind: "PART", ref: "part-a", orderedQty: 2, businessUnit: "PARTS", allocatedQty: 2 },
    { lineNumber: 2, kind: "SERVICE", ref: "svc-install", orderedQty: 1, businessUnit: "INSTALLATION", allocatedQty: 0 },
  ] },
  { id: "so-beta", number: "SO-2026-000002", account: "acct-1", lines: [
    { lineNumber: 1, kind: "EQUIPMENT_MODEL", ref: "model-x", orderedQty: 1, businessUnit: "EQUIPMENT_SALES", allocatedQty: 1 },
  ] },
];
const UNRESOLVABLE_ANCHOR = "so-missing";

/**
 * The Work Orders. Ids are ASCII and ascending, so Firestore's document-key order, PostgreSQL's
 * `COLLATE "C"` order and JavaScript's own string order are the same ordering.
 */
const WORK_ORDERS = [
  { id: "wo-01", status: "SCHEDULED", so: "so-alpha", customer: "acct-1", location: "loc-1", lineIds: ["1", "2"] },
  { id: "wo-02", status: "DISPATCHED", so: "so-alpha", customer: "acct-1", location: "loc-1", lineIds: ["2"] },
  { id: "wo-03", status: "COMPLETED", so: "so-beta", customer: "acct-1", location: "loc-2", lineIds: ["1"] },
  // Disagrees with wo-03 on BOTH customer and location: one visit, inconsistent context, surfaced not hidden.
  { id: "wo-04", status: "CANCELLED", so: "so-beta", customer: "acct-2", location: "loc-3", lineIds: [] },
  // Not coordinated at all: no anchor. Fetched inside the page, dropped, counted in `skipped`.
  { id: "wo-05", status: "CREATED", so: null, customer: "acct-1", location: "loc-1", lineIds: [] },
  // CLOSED: the one excluded status. Carries an anchor, so its absence can only come from the filter.
  { id: "wo-06", status: "CLOSED", so: "so-alpha", customer: "acct-1", location: "loc-1", lineIds: [] },
  // Anchored to a Sales Order that does not exist -- exactly the nonprod estate's shape.
  { id: "wo-07", status: "ARRIVED", so: UNRESOLVABLE_ANCHOR, customer: "acct-1", location: "loc-1", lineIds: ["1"] },
  // Names a line the Sales Order does not have: dropped, document kept.
  { id: "wo-08", status: "WORK_IN_PROGRESS", so: "so-alpha", customer: "acct-1", location: "loc-1", lineIds: ["9"] },
];
/** Another tenant's Work Order. PostgreSQL must never return it; Firestore has no way to know about it. */
const OTHER_TENANT_WORK_ORDER = { id: "wo-09", status: "SCHEDULED", so: "so-t2", customer: "acct-t2", location: "loc-t2" };

const lineOf = (soId, lineId) =>
  SALES_ORDERS.find((s) => s.id === soId)?.lines.find((l) => String(l.lineNumber) === lineId) ?? null;

/** The SAME fixture, spelled as `fieldops_wos` documents. */
function legacyDocuments() {
  return WORK_ORDERS.map((w) => ({
    id: w.id,
    data: {
      woNumber: `WO-2026-${w.id.slice(3).padStart(6, "0")}`,
      status: w.status,
      customerId: w.customer,
      locationId: w.location,
      ...(w.so ? { salesOrderId: w.so } : {}),
      salesOrderLineRefs: w.lineIds.map((lineId) => {
        const l = lineOf(w.so, lineId);
        // A line the order does not have has no ref/kind to state -- the legacy projection drops it,
        // and so does the PostgreSQL join. The fixture states the unknown rather than inventing one.
        return l === null
          ? { lineId, orderedQty: 0, allocatedQty: 0 }
          : { ref: l.ref, kind: l.kind, orderedQty: l.orderedQty, allocatedQty: l.allocatedQty, lineId };
      }),
      // Facts NEITHER projection carries. Present so their absence is proven, not assumed.
      assignedTechId: "uid-tech-1",
      scheduledTechId: "uid-tech-2",
      createdByUid: "uid-creator",
      scheduledStart: { seconds: 1767225600, nanoseconds: 0 },
      scheduledEnd: { seconds: 1767232800, nanoseconds: 0 },
      executionLog: [{ note: "x" }],
      inventorySnapshot: [{ sku: "SKU-1" }],
    },
  }));
}

/** An in-memory `fieldops_wos` + `sales_orders`, shaped exactly as the legacy read uses them. */
function fakeFirestore() {
  const docs = legacyDocuments();
  const orders = Object.fromEntries(SALES_ORDERS.map((s) => [s.id, { salesOrderNumber: s.number }]));
  return {
    collection(name) {
      if (name === "fieldops_wos") {
        return {
          where(field, op, values) {
            assert.equal(field, "status");
            assert.equal(op, "in");
            const kept = docs
              .filter((d) => values.includes(d.data.status))
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // Firestore's document-key order
            return {
              limit(n) {
                const page = kept.slice(0, n);
                return { async get() { return { size: page.length, docs: page.map((d) => ({ id: d.id, data: () => d.data })) }; } };
              },
            };
          },
        };
      }
      return { doc: (id) => ({ id }) };
    },
    async getAll(...refs) {
      return refs.map((r) => ({
        id: r.id,
        exists: Object.prototype.hasOwnProperty.call(orders, r.id),
        data: () => orders[r.id],
      }));
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════
// 4. THE COMPARISON
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * One line ref, reduced to what BOTH authorities can state.
 *
 * `allocatedQty` is deliberately excluded here and asserted separately: PostgreSQL Commercial holds
 * no allocated-quantity authority, and the comparison must SHOW that rather than smooth it away.
 */
const comparableLine = (l) => ({ ref: l.ref, kind: l.kind, orderedQty: l.orderedQty, lineId: l.lineId ?? null });
const comparableWorkOrder = (w) => ({
  id: w.id, woNumber: w.woNumber, status: w.status, customerId: w.customerId,
  locationId: w.locationId, salesOrderId: w.salesOrderId,
  salesOrderLineRefs: w.salesOrderLineRefs.map(comparableLine),
});
const comparableVisit = (v) => ({
  salesOrderId: v.salesOrderId, customerId: v.customerId, locationId: v.locationId,
  contextConsistent: v.contextConsistent, total: v.total, completed: v.completed, blocked: v.blocked,
  readiness: v.readiness,
  workOrders: v.workOrders.map((w) => ({ id: w.id, woNumber: w.woNumber, status: w.status, lineRefs: w.lineRefs.map(comparableLine) })),
});

// ════════════════════════════════════════════════════════════════════════════════════
// 5. AGAINST A REAL POSTGRESQL
// ════════════════════════════════════════════════════════════════════════════════════

const DB_NAME = `cv_parity_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("coordinated-operations parity, legacy projection vs PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 6 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);

  // Every statement any governed read issues, captured. A read that wrote would show up here first.
  const statements = [];
  const spyPool = {
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (text, values) => { statements.push(String(text)); return client.query(text, values); },
        release: () => client.release(),
      };
    },
  };
  const deps = { pool: spyPool };

  // ── the world ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1,$1,'CV'), ($2,$2,'Other')`, [TENANT, OTHER_TENANT]);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-1',$1,'ACTIVE','taylor'), ('e-2',$2,'ACTIVE','taylor')`, [TENANT, OTHER_TENANT]);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-1',$1,'Harbor','ACTIVE','e-1','x','x'), ('acct-2',$1,'Summit','ACTIVE','e-1','x','x'),
    ('acct-t2',$2,'Other','ACTIVE','e-2','x','x')`, [TENANT, OTHER_TENANT]);
  for (const [p, tenant, status] of [["p-reader", TENANT, "active"], ["p-nocap", TENANT, "active"],
    ["p-other", OTHER_TENANT, "active"], ["p-disabled", TENANT, "disabled"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof',$2)`, [p, status]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${p}`, tenant, p]);
  }

  for (const s of SALES_ORDERS) {
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, created_by, updated_by)
             VALUES ($1,$2,$3,$4,'e-1','taylor','x','x')`, [s.id, TENANT, s.number, s.account]);
    for (const l of s.lines) {
      await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`, [TENANT, s.id, l.lineNumber, l.kind, l.ref, l.businessUnit, l.orderedQty]);
    }
  }
  await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, created_by, updated_by)
           VALUES ('so-t2',$1,'SO-2026-000099','acct-t2','e-2','taylor','x','x')`, [OTHER_TENANT]);

  const insertWorkOrder = async (w, tenant) => {
    await q(`INSERT INTO eos_ops.work_orders
      (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority,
       customer_id, location_id, sales_order_id, provenance, created_at, updated_at, completed_at, closed_at)
      VALUES ($1,$2,'taylor',$3,$4,'SERVICE_CALL',3,$5,$6,$7,'MIGRATED', now(), now(), $8, $9)`,
    [w.id, tenant, `WO-2026-${w.id.slice(3).padStart(6, "0")}`, w.status, w.customer, w.location, w.so,
      ["COMPLETED"].includes(w.status) ? new Date() : null, w.status === "CLOSED" ? new Date() : null]);
    for (const lineId of w.lineIds ?? []) {
      await q(`INSERT INTO eos_ops.work_order_sales_order_lines (tenant_id, work_order_id, sales_order_id, sales_order_line_id)
               VALUES ($1,$2,$3,$4)`, [tenant, w.id, w.so, lineId]);
    }
  };
  for (const w of WORK_ORDERS) await insertWorkOrder(w, TENANT);
  await insertWorkOrder({ ...OTHER_TENANT_WORK_ORDER, lineIds: [] }, OTHER_TENANT);

  // ── the capability set comes from the CANONICAL PostgreSQL authority, not from this test ──
  await q(`INSERT INTO eos_policy.roles (id, tenant_id, key, name, origin, created_by, updated_by)
           VALUES ('r-dispatch',$1,'dispatcher','Dispatcher','SYSTEM','proof','proof')`, [TENANT]);
  await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
           SELECT 'rc-cv-proof',$1,'r-dispatch', c.id,'proof','proof','proof'
             FROM eos_policy.capabilities c WHERE c.key = $2`, [TENANT, target.COORDINATED_VISIT_CAPABILITY.key]);

  const resolved = await capabilityAuthority.capabilitiesForRoleKeys(pool, TENANT, ["dispatcher"]);
  const READER = Object.freeze({ tenantId: TENANT, principalId: "p-reader", capabilities: resolved });

  await t.test("AUTHORIZATION: the capability set is the one eos_policy resolved, and it holds the governed key", async () => {
    assert.ok(resolved instanceof Set);
    assert.equal(resolved.has(target.COORDINATED_VISIT_CAPABILITY.key), true,
      "capabilitiesForRoleKeys did not return the governed capability -- the grant path is not what this test believes");
    // The capability row itself is the canonical one migration 1761955200000 wrote.
    const { rows } = await q(`SELECT object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = $1`,
      [target.COORDINATED_VISIT_CAPABILITY.key]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { object_key: "salesOrder", action_key: "readCoordinatedVisits", action_kind: "BUSINESS_ACTION" });
    // Holding it must not be holding salesOrder.read.
    assert.equal(resolved.has("salesOrder.read"), false);
  });

  await t.test("AUTHORIZATION: fail closed on every missing precondition, capability FIRST", async () => {
    const refuses = async (actor, code) => {
      await assert.rejects(() => target.readCoordinatedOperations(deps, actor), (e) => {
        assert.equal(e.name, "CoordinatedVisitReadError");
        assert.equal(e.code, code, `expected ${code}, got ${e.code}`);
        assert.doesNotMatch(e.message, /SELECT|eos_ops|eos_policy\./, "a refusal leaked SQL");
        return true;
      });
    };
    await refuses({ tenantId: TENANT, principalId: "p-reader", capabilities: new Set() }, "CAPABILITY_REQUIRED");
    await refuses({ tenantId: TENANT, principalId: "p-reader", capabilities: new Set(["salesOrder.read"]) }, "CAPABILITY_REQUIRED");
    await refuses({ tenantId: "", principalId: "p-reader", capabilities: resolved }, "ACTOR_CONTEXT_REQUIRED");
    await refuses({ tenantId: TENANT, principalId: "  ", capabilities: resolved }, "ACTOR_CONTEXT_REQUIRED");
    await refuses({ tenantId: TENANT, principalId: "p-reader", capabilities: ["a", "b"] }, "ACTOR_CONTEXT_REQUIRED");
    // A capability the caller holds but is not a member for, and a principal who was disabled.
    await refuses({ tenantId: TENANT, principalId: "p-other", capabilities: resolved }, "ACTOR_NOT_TENANT_MEMBER");
    await refuses({ tenantId: TENANT, principalId: "p-disabled", capabilities: resolved }, "ACTOR_NOT_TENANT_MEMBER");
    await refuses({ tenantId: TENANT, principalId: "p-unknown", capabilities: resolved }, "ACTOR_NOT_TENANT_MEMBER");

    // CAPABILITY FIRST: the refusal for a caller with no capability must not depend on the record world.
    const before = statements.length;
    await refuses({ tenantId: "no-such-tenant", principalId: "nobody", capabilities: new Set() }, "CAPABILITY_REQUIRED");
    assert.equal(statements.length, before, "a capability-less caller reached the database");
  });

  // ── THE PARITY COMPARISON ──
  let pgResult;
  let legacyResult;

  await t.test("the two reads produce the same page: ids, order, statuses, context, counts", async () => {
    pgResult = await target.readCoordinatedOperations(deps, READER);
    legacyResult = await legacy.readActiveCoordinatedWorkOrders(fakeFirestore());

    assert.equal(pgResult.status, "ready");
    assert.equal(legacyResult.status, "ready");
    assert.deepEqual(Object.keys(pgResult).sort(), Object.keys(legacyResult).sort(),
      "the result envelopes differ");

    // GROUP MEMBERSHIP, IDS AND ORDERING.
    assert.deepEqual(pgResult.workOrders.map((w) => w.id), legacyResult.workOrders.map((w) => w.id));
    assert.deepEqual(pgResult.workOrders.map((w) => w.id), ["wo-01", "wo-02", "wo-03", "wo-04", "wo-07", "wo-08"],
      "non-vacuity: the expected six coordinated Work Orders, in document-key order");

    // FIELD FOR FIELD, including status, customer/location representation and line refs.
    assert.deepEqual(pgResult.workOrders.map(comparableWorkOrder), legacyResult.workOrders.map(comparableWorkOrder));

    // COUNTS.
    assert.equal(pgResult.skipped, legacyResult.skipped);
    assert.equal(pgResult.skipped, 1, "wo-05 carries no anchor and is not coordinated");
    assert.equal(pgResult.truncated, legacyResult.truncated);
    assert.equal(pgResult.truncated, false);

    // THE EXCLUDED STATUS, proven by absence rather than assumed.
    assert.equal(pgResult.workOrders.some((w) => w.id === "wo-06"), false, "a CLOSED Work Order is archived");
    assert.equal(legacyResult.workOrders.some((w) => w.id === "wo-06"), false);
  });

  await t.test("the anchoring Sales Order is NAMED identically, and an unresolvable anchor is ABSENT", () => {
    assert.deepEqual(pgResult.salesOrderReferences, legacyResult.salesOrderReferences);
    assert.deepEqual(pgResult.salesOrderReferences, { "so-alpha": "SO-2026-000001", "so-beta": "SO-2026-000002" });
    assert.equal(UNRESOLVABLE_ANCHOR in pgResult.salesOrderReferences, false,
      "an anchor no Sales Order answers to must be absent, never mapped to its own id");
    for (const v of Object.values(pgResult.salesOrderReferences)) assert.match(v, /^SO-\d{4}-\d{6}$/);
  });

  await t.test("NEITHER projection carries assignment, schedule or raw-identity facts", () => {
    const allowed = ["customerId", "id", "locationId", "salesOrderId", "salesOrderLineRefs", "status", "woNumber"];
    for (const w of [...pgResult.workOrders, ...legacyResult.workOrders]) {
      assert.deepEqual(Object.keys(w).sort(), allowed, `${w.id} carries a field outside the governed allowlist`);
    }
    // The fixture documents DO carry them, so this is a real exclusion and not an empty fixture.
    const raw = legacyDocuments()[0].data;
    for (const present of ["assignedTechId", "scheduledTechId", "createdByUid", "scheduledStart", "scheduledEnd", "executionLog", "inventorySnapshot"]) {
      assert.ok(present in raw, `the fixture stopped carrying ${present}; the exclusion proof is vacuous`);
    }
  });

  await t.test("the DERIVED coordinated visits are identical, group for group", () => {
    const pgVisits = visits.buildCoordinatedVisits(pgResult.workOrders.map((w) => ({ ...w })));
    const legacyVisits = visits.buildCoordinatedVisits(legacyResult.workOrders.map((w) => ({ ...w })));
    assert.deepEqual(pgVisits.map(comparableVisit), legacyVisits.map(comparableVisit));

    // Non-vacuity: the fixture exercises every readiness the projection can reach except READY-by-all-done.
    const byOrder = new Map(pgVisits.map((v) => [v.salesOrderId, v]));
    assert.deepEqual([...byOrder.keys()].sort(), ["so-alpha", "so-beta", UNRESOLVABLE_ANCHOR].sort());
    assert.equal(byOrder.get("so-alpha").total, 3, "one visit, three Work Orders -- the coordination case");
    assert.equal(byOrder.get("so-alpha").readiness, "IN_PROGRESS");
    assert.equal(byOrder.get("so-beta").blocked, 1);
    assert.equal(byOrder.get("so-beta").readiness, "ATTENTION", "a cancelled unit needs attention");
    assert.equal(byOrder.get("so-beta").contextConsistent, false, "the grouped units disagree on customer and location");
    assert.equal(byOrder.get(UNRESOLVABLE_ANCHOR).total, 1);

    // An EMPTY group is unreachable in both: a group exists only because a Work Order made it.
    for (const v of pgVisits) assert.ok(v.total > 0);
  });

  await t.test("TRUNCATION and page composition agree at a bound that actually truncates", async () => {
    for (const limit of [1, 2, 3, 7, 8]) {
      const pgPage = await target.readActiveCoordinatedWorkOrdersFromPostgres(pool, TENANT, limit);
      const legacyPage = await legacy.readActiveCoordinatedWorkOrders(fakeFirestore(), limit);
      assert.equal(pgPage.truncated, legacyPage.truncated, `truncated disagrees at limit ${limit}`);
      assert.equal(pgPage.skipped, legacyPage.skipped, `skipped disagrees at limit ${limit}`);
      assert.deepEqual(pgPage.workOrders.map((w) => w.id), legacyPage.workOrders.map((w) => w.id),
        `page composition disagrees at limit ${limit}`);
      assert.deepEqual(pgPage.salesOrderReferences, legacyPage.salesOrderReferences,
        `references disagree at limit ${limit}`);
    }
    // Non-vacuity: 7 active rows, so a bound below that must truncate and one at or above must not.
    assert.equal((await target.readActiveCoordinatedWorkOrdersFromPostgres(pool, TENANT, 3)).truncated, true);
    assert.equal((await target.readActiveCoordinatedWorkOrdersFromPostgres(pool, TENANT, 7)).truncated, false);
  });

  // ── THE DECLARED DIFFERENCES, PROVEN ──

  await t.test("DIFFERENCE TENANT_SCOPED: another tenant's Work Order is unreachable", async () => {
    assert.equal(pgResult.workOrders.some((w) => w.id === "wo-09"), false);
    const otherResolved = new Set([target.COORDINATED_VISIT_CAPABILITY.key]);
    const other = await target.readCoordinatedOperations(deps,
      { tenantId: OTHER_TENANT, principalId: "p-other", capabilities: otherResolved });
    assert.deepEqual(other.workOrders.map((w) => w.id), ["wo-09"],
      "non-vacuity: the row exists and is readable in its own tenant");
    assert.deepEqual(other.salesOrderReferences, { "so-t2": "SO-2026-000099" });
  });

  await t.test("DIFFERENCE ALLOCATED_QTY_UNAVAILABLE: null, never a fabricated 0", () => {
    const pgLines = pgResult.workOrders.flatMap((w) => w.salesOrderLineRefs);
    const legacyLines = legacyResult.workOrders.flatMap((w) => w.salesOrderLineRefs);
    assert.equal(pgLines.length, legacyLines.length);
    assert.ok(pgLines.length >= 3, "non-vacuity: there are line refs to compare");
    for (const l of pgLines) {
      assert.equal(l.allocatedQty, null, "PostgreSQL Commercial holds no allocated quantity");
      assert.notEqual(l.allocatedQty, 0, "0 means BACKORDERED in the legacy model and would be a fabricated fact");
    }
    // The legacy side really does carry numbers, including a meaningful 0 -- so this is a true gap.
    assert.deepEqual([...new Set(legacyLines.map((l) => typeof l.allocatedQty))], ["number"]);
    assert.ok(legacyLines.some((l) => l.allocatedQty === 0));
    assert.ok(legacyLines.some((l) => l.allocatedQty > 0));
  });

  await t.test("DIFFERENCE LINE_REF_IDENTITY: lineId is the commercial line number, and a line the order lacks is dropped", () => {
    const wo1 = pgResult.workOrders.find((w) => w.id === "wo-01");
    assert.deepEqual(wo1.salesOrderLineRefs.map((l) => l.lineId), ["1", "2"]);
    assert.deepEqual(wo1.salesOrderLineRefs.map((l) => l.kind), ["PART", "SERVICE"]);
    assert.deepEqual(wo1.salesOrderLineRefs.map((l) => l.orderedQty), [2, 1]);
    // wo-08 names line "9", which so-alpha does not have: the row is dropped, the Work Order kept.
    const wo8 = pgResult.workOrders.find((w) => w.id === "wo-08");
    assert.deepEqual(wo8.salesOrderLineRefs, []);
    assert.equal(legacyResult.workOrders.find((w) => w.id === "wo-08").salesOrderLineRefs.length, 0);
    // wo-07's anchor has no Sales Order at all, so it has no lines either.
    assert.deepEqual(pgResult.workOrders.find((w) => w.id === "wo-07").salesOrderLineRefs, []);
  });

  await t.test("no line ref crosses to a Sales Order the Work Order is not anchored to", async () => {
    await q(`INSERT INTO eos_ops.work_order_sales_order_lines (tenant_id, work_order_id, sales_order_id, sales_order_line_id)
             VALUES ($1,'wo-01','so-beta','1')`, [TENANT]);
    const after = await target.readCoordinatedOperations(deps, READER);
    assert.deepEqual(after.workOrders.find((w) => w.id === "wo-01").salesOrderLineRefs.map((l) => l.lineId), ["1", "2"],
      "a line ref naming a different Sales Order is not part of this coordinated visit");
    await q(`DELETE FROM eos_ops.work_order_sales_order_lines WHERE tenant_id=$1 AND work_order_id='wo-01' AND sales_order_id='so-beta'`, [TENANT]);
  });

  await t.test("the canonical capability row is what opens the read, not merely the grant", async () => {
    await q(`UPDATE eos_policy.capabilities SET action_kind = 'READ' WHERE key = $1`, [target.COORDINATED_VISIT_CAPABILITY.key]);
    await assert.rejects(() => target.readCoordinatedOperations(deps, READER),
      (e) => e.code === "CAPABILITY_NOT_CANONICAL" && e.category === "FORBIDDEN");
    await q(`UPDATE eos_policy.capabilities SET action_kind = 'BUSINESS_ACTION' WHERE key = $1`, [target.COORDINATED_VISIT_CAPABILITY.key]);
    const back = await target.readCoordinatedOperations(deps, READER);
    assert.equal(back.workOrders.length, 6, "non-vacuity: restoring the canonical row restores the read");
  });

  await t.test("the read wrote nothing, and PostgreSQL itself would have refused", async () => {
    assert.ok(statements.length > 0);
    for (const s of statements) {
      assert.doesNotMatch(s, /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|CREATE|DROP|ALTER)\b/i, `a read issued: ${s}`);
    }
    assert.ok(statements.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"),
      "the read did not open a read-only snapshot");
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await assert.rejects(() => client.query(`UPDATE eos_ops.work_orders SET priority = 1 WHERE tenant_id = $1`, [TENANT]),
        /read-only transaction/i);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  await t.test("NO PROJECTION TABLE was created: the visit stays derived", async () => {
    const { rows } = await q(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_name IN ('dispatch_schedule','dispatch_schedules','coordinated_visits','coordinated_visit')`);
    assert.deepEqual(rows, [], "a retired Administration Object grew a table");
    const objects = await q(`SELECT key FROM eos_policy.objects WHERE key IN ('dispatchSchedule','notifications')`);
    assert.deepEqual(objects.rows, [], "a retired Administration Object came back");
  });

  await t.test("an empty world reads as an empty page, not as a failure", async () => {
    const empty = await target.readActiveCoordinatedWorkOrdersFromPostgres(pool, "t-nonexistent");
    assert.deepEqual(empty, { status: "ready", workOrders: [], salesOrderReferences: {}, skipped: 0, truncated: false });
    const legacyEmpty = await legacy.readActiveCoordinatedWorkOrders({
      collection: () => ({ where: () => ({ limit: () => ({ async get() { return { size: 0, docs: [] }; } }) }) }),
      async getAll() { return []; },
    });
    assert.deepEqual({ ...legacyEmpty }, { status: "ready", workOrders: [], salesOrderReferences: {}, skipped: 0, truncated: false });
  });

  await t.test("a page size outside the governed bound REFUSES rather than being quietly clamped", async () => {
    for (const bad of [0, -1, 1.5, 301, Number.NaN, "10"]) {
      await assert.rejects(() => target.readActiveCoordinatedWorkOrdersFromPostgres(pool, TENANT, bad),
        (e) => e.code === "PAGE_SIZE_INVALID" && e.category === "INVALID_INPUT", `limit ${String(bad)} was accepted`);
    }
  });
});
