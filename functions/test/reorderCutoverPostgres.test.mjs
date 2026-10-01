// REORDER CUTOVER CLI against a real postgres:16 -- census -> copy objects -> copy assignments -> copy purchasing ->
// verify, run as the operator runs it: scripts/reorderCutover.js as a child process over a checksummed
// EOS_REORDER_SNAPSHOT file.
//
// The copy logic itself is proved by the three existing suites (reorderObjectMigrationPostgres,
// reorderAssignmentMigrationPostgres, reorderPurchaseOrderMigrationPostgres). What is proved HERE is the tool around
// it: the stage ORDER is enforced before anything is written, each stage lands with provenance MIGRATED, an identical
// rerun changes nothing, a snapshot whose checksum disagrees is refused, and the evidence carries no legacy uid, no
// field value and no connection string.
//
// Its OWN database (rr_cut_<uuid12>), migrated by the normal runner, dropped in t.after. Same skip contract as every
// other Postgres suite: set POLICY_TEST_DATABASE_URL to run.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { hash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// DQ-032: the committed manifest of the eight synthetic fixtures the COPY excludes (never deleted from Firestore).
const EXCLUSION_MANIFEST = resolve(FUNCTIONS_DIR, "..", "docs", "architecture", "reorder-migration-exclusion-manifest.json");
const { REORDER_SCENARIO_FIXTURES, SCENARIO_ID } = createRequire(import.meta.url)("../lib/sandboxFixtures/reorderScenarioFixtures.js");
/** The base snapshot plus all eight declared fixtures, exactly as the scenario seeder writes their facts. */
const SNAPSHOT_WITH_FIXTURES = () => {
  const base = SNAPSHOT();
  const collections = { ...base.collections };
  for (const f of REORDER_SCENARIO_FIXTURES) {
    collections[f.collection] = [...collections[f.collection], { id: f.id, data: { ...f.facts, scenarioId: SCENARIO_ID } }];
  }
  return { ...base, collections, counts: Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.length])) };
};

// Owner ruling 2026-09-29: the CW-P-0000 live-proof records (CERTIFICATION_LIVE_PROOF) and the held record
// (LEGACY_INCOMPLETE_OPERATING_CONTEXT) are declared in the SAME committed manifest, each as its own class.
const MANIFEST_JSON = JSON.parse(readFileSync(EXCLUSION_MANIFEST, "utf8"));
const LIVE_PROOF_IDS = MANIFEST_JSON.certificationLiveProof.entries;
const HELD_IDS = MANIFEST_JSON.holds.entries;
/** The live-proof and held records, stated on the synthetic source warehouses EOS does not (and must not) hold. */
const ruledClassDocs = () => {
  const out = { reorder_requests: [], reorder_purchase_orders: [], reorder_purchase_order_voids: [] };
  for (const e of LIVE_PROOF_IDS) {
    if (e.collection === "reorder_requests") out.reorder_requests.push(reorder(e.id, { partId: "CW-P-0000", warehouseId: "wh-main", operatingCompanyId: "taylor" }));
    else out.reorder_purchase_orders.push({ id: e.id, data: { ...order(e.id).data, partId: "CW-P-0000" } });
  }
  for (const e of HELD_IDS) out[e.collection].push(reorder(e.id, { warehouseId: null, operatingCompanyId: null }));
  return out;
};
const withRuledClasses = (base, { operational = true } = {}) => {
  const ruled = ruledClassDocs();
  const collections = {};
  for (const k of Object.keys(ruled)) collections[k] = [...base.collections[k].filter((d) => operational || !d.id.startsWith("rr-cut-")), ...ruled[k]];
  return { ...base, collections, counts: Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.length])) };
};

const DB_NAME = `rr_cut_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const TENANT_KEY = "rr-cutover-nonprod";
const SUPPLIER = "Acme Supply Confidential";

/** A complete, valid legacy Reorder document. Instants are epoch milliseconds, exactly as Firestore stores them. */
const reorder = (id, over = {}) => ({
  id,
  data: {
    partId: "PART-LEGACY-1", recommendationStatus: "BELOW_MIN", urgency: "ROUTINE", quantitySource: "RECOMMENDED",
    recommendedQty: 4, requestedQty: 4, status: "PENDING_REVIEW", currentOwner: "INVENTORY",
    requestedBy: "uid-alice", createdAt: 1758000000000,
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
    assignedToUserId: null, assignedBy: null, assignedAt: null,
    purchaseOrderId: null, warehouseId: "wh-1", operatingCompanyId: "taylor",
    ...over,
  },
});
const reviewed = { reviewDecision: "APPROVED", reviewedAt: 1758000100000, reviewedBy: "uid-manager" };
const order = (id) => ({
  id,
  data: {
    reorderRequestId: id, partId: "PART-LEGACY-1", supplierName: SUPPLIER, externalPoNumber: `PO-EXT-${id}`,
    orderedQuantity: 4, orderedDate: "2026-09-01", expectedArrivalDate: "2026-09-08", operatingCompanyId: "taylor",
    status: "ORDERED", createdBy: "uid-buyer",
  },
});
const voidOf = (id) => ({
  id,
  data: { reorderRequestId: id, reorderPurchaseOrderId: id, partId: "PART-LEGACY-1", operatingCompanyId: "taylor", reason: "supplier could not fulfil", voidedBy: "uid-buyer", voidedAt: 1758000900000 },
});

const SNAPSHOT = () => {
  const requests = [
    reorder("rr-cut-1"),
    reorder("rr-cut-2", { ...reviewed, status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE", assignedToUserId: "uid-alice", assignedBy: "uid-manager", assignedAt: 1758000200000 }),
    // The requester and the assignor are historical uids nobody can resolve: provenance, never a blocker.
    reorder("rr-cut-3", { ...reviewed, status: "ORDERED", currentOwner: "PARTS_ASSOCIATE", requestedBy: "uid-legacy-gone", assignedToUserId: "uid-alice", assignedBy: "uid-legacy-gone", purchaseOrderId: "rr-cut-3" }),
    reorder("rr-cut-4", { ...reviewed, status: "VOIDED", currentOwner: null, assignedToUserId: "uid-alice", assignedBy: "uid-manager", purchaseOrderId: "rr-cut-4" }),
  ];
  const orders = [order("rr-cut-3"), order("rr-cut-4")];
  const voids = [voidOf("rr-cut-4")];
  return {
    format: "EOS_REORDER_SNAPSHOT",
    version: 1,
    source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-28T12:00:00.000Z" },
    counts: { reorder_requests: requests.length, reorder_purchase_orders: orders.length, reorder_purchase_order_voids: voids.length },
    collections: { reorder_requests: requests, reorder_purchase_orders: orders, reorder_purchase_order_voids: voids },
  };
};

test("reorder cutover CLI, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 4 });
  const dir = mkdtempSync(join(tmpdir(), "reorder-cutover-cli-"));
  t.after(async () => {
    rmSync(dir, { recursive: true, force: true });
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const q = (text, values = []) => pool.query(text, values);
  const n = async (sql, values = ["tenant-rr"]) => Number((await q(sql, values)).rows[0].n);

  // ---- the tenant, its Principals, the assignee's Employee link, the warehouse, the company -> key binding ----
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('tenant-rr', $1, 'Reorder cutover proof'), ('tenant-other', 'rr-other', 'Other')`, [TENANT_KEY]);
  const principal = async (id, subject, tenant = "tenant-rr") => {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1, $2, 'firebase', 'active')`, [id, subject]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1, $2, $3)`, [`m-${id}`, tenant, id]);
  };
  await principal("p-alice", "uid-alice");
  await principal("p-manager", "uid-manager");
  await principal("p-buyer", "uid-buyer");
  await principal("p-executor", "uid-executor");
  await principal("p-outsider", "uid-outsider", "tenant-other");
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-alice', 'tenant-rr', 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('epl-alice', 'tenant-rr', 'p-alice', 'e-alice', 'taylor', 'OPERATOR_ASSERTED', 'f', 'test', 'active')`);
  // The company and the key are DIFFERENT values on purpose: `taylor` operates under eos_ops key `sample-co`.
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('tenant-rr', 'taylor', 'ACTIVE', 'fixture', 'f', 'f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('tenant-rr', 'taylor', 'sample-co', 'ACTIVE', 'NATIVE', 'fixture', 'f', 'f')`);
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-1', 'tenant-rr', 'sample-co', 'wh-1', 'Sampleton', 'ACTIVE', 'NATIVE', 'fixture', 'fixture')`);

  const run = (mode, extra = [], { snapshot = SNAPSHOT(), checksum = "match" } = {}) => {
    const file = join(dir, `${mode}-${randomUUID()}.json`);
    const text = JSON.stringify(snapshot);
    writeFileSync(file, text);
    if (checksum === "match") writeFileSync(`${file}.sha256`, `${hash("sha256", text)}  snapshot.json\n`);
    if (checksum === "mismatch") writeFileSync(`${file}.sha256`, `${hash("sha256", `${text} `)}  snapshot.json\n`);
    const res = spawnSync(process.execPath, ["scripts/reorderCutover.js", "--mode", mode, "--environment", "platform-sandbox", "--databaseUrlEnv", "REORDER_TEST_DB",
      "--tenantKey", TENANT_KEY, "--snapshot", file, "--exclusionManifest", EXCLUSION_MANIFEST, ...extra], {
      cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", REORDER_TEST_DB: dbUrl() },
    });
    const all = `${res.stdout}${res.stderr}`;
    // EVIDENCE DISCIPLINE, on every run: no legacy uid, no field value, no connection string.
    assert.doesNotMatch(all, /uid-(alice|manager|buyer|legacy-gone|executor)/, `a legacy uid leaked:\n${all}`);
    assert.ok(!all.includes(SUPPLIER), "a document field value leaked");
    assert.ok(!all.includes(dbUrl()) && !all.includes(URL_BASE), "the database URL leaked");
    const password = new URL(URL_BASE).password;
    if (password) assert.ok(!all.includes(`:${password}@`), "the database password leaked");
    return { status: res.status, out: res.stdout ? JSON.parse(res.stdout) : null, err: res.stderr };
  };
  const copy = (stage, principalId = "p-executor", opts) => run("copy", ["--stage", stage, "--principalId", principalId], opts);
  const target = async () => ({
    reorders: await n(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE tenant_id = $1`),
    assignments: await n(`SELECT count(*)::int n FROM eos_ops.reorder_request_assignments WHERE tenant_id = $1`),
    orders: await n(`SELECT count(*)::int n FROM eos_ops.purchase_orders WHERE tenant_id = $1`),
    voids: await n(`SELECT count(*)::int n FROM eos_ops.purchase_order_voids WHERE tenant_id = $1`),
    audits: await n(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1`),
  });
  const EMPTY = { reorders: 0, assignments: 0, orders: 0, voids: 0, audits: 0 };

  await t.test("census is READ ONLY: snapshot counts, each stage's classification, the empty target", async () => {
    const r = run("census");
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.readOnly, true);
    assert.equal(r.out.copyReady, true);
    assert.deepEqual(r.out.blockers, []);
    assert.deepEqual(r.out.evidence.snapshotCensus.counts, { reorder_requests: 4, reorder_purchase_orders: 2, reorder_purchase_order_voids: 1 });
    assert.deepEqual(r.out.evidence.snapshotCensus.statusDistribution, { ASSIGNED_TO_PARTS_ASSOCIATE: 1, ORDERED: 1, PENDING_REVIEW: 1, VOIDED: 1 });
    assert.match(r.out.evidence.snapshotSha256, /^[0-9a-f]{64}$/);
    assert.equal(r.out.stages.objects.counts.MIGRATABLE, 4);
    assert.equal(r.out.stages.assignments.counts.EXACT_EMPLOYEE_ASSIGNMENT, 3);
    // Before the objects exist every order is PENDING the objects stage -- not a blocker.
    assert.deepEqual(r.out.stages.purchasing.pendingObjects, { purchaseOrders: 2, voids: 1 });
    assert.deepEqual(r.out.stages.purchasing.blockers, []);
    assert.deepEqual(r.out.target, { reorderRequests: 0, reorderRequestsMigrated: 0, currentAssignments: 0, currentAssignmentsMigrated: 0, purchaseOrders: 0, purchaseOrderVoids: 0 });
    assert.deepEqual(await target(), EMPTY, "census wrote nothing");
  });

  await t.test("DQ-032: the eight declared fixtures are excluded exactly -- counts, ids, nothing else removed", async () => {
    const r = run("census", [], { snapshot: SNAPSHOT_WITH_FIXTURES() });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.copyReady, true);
    const x = r.out.evidence.exclusion;
    assert.match(x.manifestSha256, /^[0-9a-f]{64}$/);
    assert.equal(x.manifestCount, 8);
    assert.equal(x.excluded.length, 8);
    assert.deepEqual(x.absent, []);
    assert.equal(x.onlyDeclaredFixturesExcluded, true);
    assert.deepEqual(x.counts, {
      reorder_requests: { source: 9, excluded: 5, held: 0, retained: 4 },
      reorder_purchase_orders: { source: 5, excluded: 3, held: 0, retained: 2 },
      reorder_purchase_order_voids: { source: 1, excluded: 0, held: 0, retained: 1 },
    });
    // Every later stage sees the retained population only: the same plan as the fixture-free snapshot.
    assert.deepEqual(r.out.evidence.snapshotCensus.counts, { reorder_requests: 4, reorder_purchase_orders: 2, reorder_purchase_order_voids: 1 });
    assert.equal(r.out.stages.objects.counts.MIGRATABLE, 4);
    assert.deepEqual(await target(), EMPTY, "census wrote nothing");
  });

  await t.test("Owner 2026-09-29: the real source shape (8 fixtures, 10 live-proof, 1 held, 0 operational) censuses to an EMPTY queue", async () => {
    const r = run("census", [], { snapshot: withRuledClasses(SNAPSHOT_WITH_FIXTURES(), { operational: false }) });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.copyReady, true);
    assert.deepEqual(r.out.blockers, []);
    const x = r.out.evidence.exclusion;
    assert.equal(x.manifestCount, 8, "the fixture bucket is still exactly eight");
    assert.equal(x.certificationLiveProof.classification, "CERTIFICATION_LIVE_PROOF");
    assert.equal(x.certificationLiveProof.excluded.length, 10);
    assert.equal(x.held.classification, "LEGACY_INCOMPLETE_OPERATING_CONTEXT");
    assert.deepEqual(x.held.held.map((e) => e.id), ["eA7o3t8DyUXmtg8MCKjT"]);
    assert.equal(x.onlyDeclaredFixturesExcluded, true);
    assert.deepEqual(x.counts.reorder_requests, { source: 15, excluded: 14, held: 1, retained: 0 });
    // Every stage sees an empty population: no warehouse is resolved, translated or required.
    assert.deepEqual(r.out.evidence.snapshotCensus.counts, { reorder_requests: 0, reorder_purchase_orders: 0, reorder_purchase_order_voids: 0 });
    assert.ok(!JSON.stringify(r.out.warehouseIdentity).includes("wh-main"), "an excluded record's warehouse never reaches warehouse identity");
    assert.deepEqual(await target(), EMPTY, "census wrote nothing");
  });

  await t.test("warehouse identity: every legacy warehouse id is an exact EOS warehouse, per warehouse, with evidence", async () => {
    const r = run("census");
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.warehouseIdentity.allExact, true);
    assert.deepEqual(r.out.warehouseIdentity.entries.map((e) => [e.legacyWarehouseId, e.verdict, e.reorderCount, e.eosWarehouse?.id]),
      [["wh-1", "EXACT_MATCH", 4, "wh-1"]]);
  });

  await t.test("warehouse identity: an id EOS does not hold blocks the copy and is never translated", async () => {
    const snapshot = SNAPSHOT();
    snapshot.collections.reorder_requests[0].data.warehouseId = "legacy-main-yard";
    const r = run("census", [], { snapshot });
    assert.equal(r.status, 1);
    assert.equal(r.out.copyReady, false);
    assert.ok(r.out.blockers.includes("WAREHOUSE_IDENTITY"));
    const missing = r.out.warehouseIdentity.entries.find((e) => e.legacyWarehouseId === "legacy-main-yard");
    assert.equal(missing.verdict, "MISSING_IN_EOS");
    assert.equal(missing.eosWarehouse, null);
    assert.deepEqual(await target(), EMPTY);
  });

  await t.test("DQ-032: a manifest other than the declared one is refused before any read", async () => {
    const wider = join(dir, `wider-${randomUUID()}.json`);
    const text = JSON.stringify({ format: "EOS_REORDER_MIGRATION_EXCLUSION", entries: [{ collection: "reorder_requests", id: "rr-cut-1" }] });
    writeFileSync(wider, text);
    writeFileSync(`${wider}.sha256`, `${hash("sha256", text)}  wider.json\n`);
    const snapFile = join(dir, `snap-${randomUUID()}.json`);
    const snapText = JSON.stringify(SNAPSHOT());
    writeFileSync(snapFile, snapText);
    writeFileSync(`${snapFile}.sha256`, `${hash("sha256", snapText)}  snapshot.json\n`);
    const res = spawnSync(process.execPath, ["scripts/reorderCutover.js", "--mode", "census", "--environment", "platform-sandbox", "--databaseUrlEnv", "REORDER_TEST_DB",
      "--tenantKey", TENANT_KEY, "--snapshot", snapFile, "--exclusionManifest", wider], {
      cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", REORDER_TEST_DB: dbUrl() },
    });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /not the repository's declared DQ-032 manifest/);
    assert.deepEqual(await target(), EMPTY);
  });

  await t.test("the stage order is enforced before anything is written", async () => {
    const a = copy("assignments");
    assert.equal(a.status, 2);
    assert.equal(a.out.reason, "STAGE_PREREQUISITE_NOT_MET");
    assert.deepEqual(a.out.unmetPrerequisites, ["objects"]);
    const p = copy("purchasing");
    assert.equal(p.status, 2);
    assert.deepEqual(p.out.unmetPrerequisites, ["objects", "assignments"]);
    assert.deepEqual(await target(), EMPTY);
  });

  await t.test("the snapshot's checksum is checked in every mode: missing or mismatched is refused, nothing written", async () => {
    for (const checksum of ["missing", "mismatch"]) {
      const r = copy("objects", "p-executor", { checksum });
      assert.equal(r.status, 2);
      assert.match(r.err, checksum === "missing" ? /sha256 is missing/ : /does not match/);
    }
    assert.equal(run("verify", [], { checksum: "mismatch" }).status, 2);
    assert.deepEqual(await target(), EMPTY);
  });

  await t.test("a foreign-tenant executor is refused by the copy module, nothing written", async () => {
    const r = copy("objects", "p-outsider");
    assert.equal(r.status, 2);
    assert.equal(r.out.outcome, "REFUSED");
    assert.match(r.out.refusal, /not an active Principal with an active membership/);
    assert.deepEqual(await target(), EMPTY);
  });

  await t.test("copy objects: four Reorders, MIGRATED, requester resolved or honestly NULL; rerun is NO_CHANGES", async () => {
    const r = copy("objects");
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.outcome, "COPIED");
    assert.deepEqual(r.out.inserted, { reorderRequests: 4 });
    const rows = (await q(`SELECT id, provenance, requested_by, updated_by, operating_company_key FROM eos_ops.reorder_requests WHERE tenant_id = 'tenant-rr' ORDER BY id`)).rows;
    assert.deepEqual(rows.map((x) => [x.id, x.provenance, x.requested_by, x.updated_by, x.operating_company_key]), [
      ["rr-cut-1", "MIGRATED", "p-alice", "p-executor", "sample-co"],
      ["rr-cut-2", "MIGRATED", "p-alice", "p-executor", "sample-co"],
      ["rr-cut-3", "MIGRATED", null, "p-executor", "sample-co"],
      ["rr-cut-4", "MIGRATED", "p-alice", "p-executor", "sample-co"],
    ]);
    const again = copy("objects");
    assert.equal(again.status, 0, again.err);
    assert.equal(again.out.outcome, "NO_CHANGES");
    assert.equal(again.out.applied, false);
    assert.equal(again.out.plan.counts.ALREADY_PRESENT, 4);
    assert.equal((await target()).reorders, 4);
  });

  await t.test("purchasing still waits for assignments", async () => {
    const p = copy("purchasing");
    assert.equal(p.status, 2);
    assert.deepEqual(p.out.unmetPrerequisites, ["assignments"]);
    assert.equal((await target()).orders, 0);
  });

  await t.test("copy assignments: three exact Employee assignments, MIGRATED, unresolved assignor NULL; rerun is NO_CHANGES", async () => {
    const r = copy("assignments");
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.outcome, "COPIED");
    assert.deepEqual(r.out.inserted, { assignments: 3 });
    const rows = (await q(`SELECT reorder_request_id, assigned_employee_id, provenance, assigned_by_principal_id FROM eos_ops.reorder_request_assignments
                            WHERE tenant_id = 'tenant-rr' AND effective_to IS NULL ORDER BY reorder_request_id`)).rows;
    assert.deepEqual(rows.map((x) => [x.reorder_request_id, x.assigned_employee_id, x.provenance, x.assigned_by_principal_id]), [
      ["rr-cut-2", "e-alice", "MIGRATED", "p-manager"],
      ["rr-cut-3", "e-alice", "MIGRATED", null],
      ["rr-cut-4", "e-alice", "MIGRATED", "p-manager"],
    ]);
    const again = copy("assignments");
    assert.equal(again.status, 0, again.err);
    assert.equal(again.out.outcome, "NO_CHANGES");
    assert.equal(again.out.plan.counts.ALREADY_GOVERNED, 3);
    assert.equal((await target()).assignments, 3);
  });

  await t.test("copy purchasing: two orders and one void, actors resolved; rerun is NO_CHANGES", async () => {
    const r = copy("purchasing");
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.outcome, "COPIED");
    assert.deepEqual(r.out.inserted, { purchaseOrders: 2, voids: 1 });
    const orders = (await q(`SELECT id, created_by, operating_company_key FROM eos_ops.purchase_orders WHERE tenant_id = 'tenant-rr' ORDER BY id`)).rows;
    assert.deepEqual(orders, [
      { id: "rr-cut-3", created_by: "p-buyer", operating_company_key: "sample-co" },
      { id: "rr-cut-4", created_by: "p-buyer", operating_company_key: "sample-co" },
    ]);
    assert.deepEqual((await q(`SELECT purchase_order_id, voided_by FROM eos_ops.purchase_order_voids WHERE tenant_id = 'tenant-rr'`)).rows,
      [{ purchase_order_id: "rr-cut-4", voided_by: "p-buyer" }]);
    // Historical instants survive the copy: the void's voidedAt, and rr-cut-2's assignedAt as its effective_from.
    const voidedAt = (await q(`SELECT voided_at FROM eos_ops.purchase_order_voids WHERE purchase_order_id = 'rr-cut-4'`)).rows[0].voided_at;
    assert.equal(new Date(voidedAt).toISOString(), new Date(1758000900000).toISOString());
    const from = (await q(`SELECT effective_from FROM eos_ops.reorder_request_assignments WHERE reorder_request_id = 'rr-cut-2'`)).rows[0].effective_from;
    assert.equal(new Date(from).toISOString(), new Date(1758000200000).toISOString());
    const before = await target();
    const again = copy("purchasing");
    assert.equal(again.status, 0, again.err);
    assert.equal(again.out.outcome, "NO_CHANGES");
    assert.deepEqual(await target(), before, "an identical rerun writes nothing, not even an audit row");
    // One audit row per applied stage, and none for the NO_CHANGES reruns or the refusals.
    assert.equal(before.audits, 3);
  });

  await t.test("verify is READ ONLY and reconciles all three stages against the snapshot", async () => {
    const before = await target();
    const r = run("verify");
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.readOnly, true);
    assert.equal(r.out.reconciled, true);
    assert.deepEqual(r.out.reconciliation, { objectsAllPresent: true, assignmentsAllPresent: true, purchasingAllPresent: true, targetAccounted: true });
    assert.equal(r.out.stages.objects.verify.passed, true);
    assert.equal(r.out.stages.objects.verify.checked, 4);
    assert.equal(r.out.stages.assignments.verify.passed, true);
    assert.equal(r.out.stages.assignments.verify.checked, 3);
    assert.equal(r.out.stages.purchasing.verify.passed, true);
    assert.deepEqual(r.out.stages.purchasing.verify.incompleteLifecycles, []);
    assert.deepEqual(r.out.target, { reorderRequests: 4, reorderRequestsMigrated: 4, currentAssignments: 3, currentAssignmentsMigrated: 3, purchaseOrders: 2, purchaseOrderVoids: 1 });
    assert.deepEqual(await target(), before, "verify wrote nothing");
  });

  await t.test("Owner 2026-09-29: live-proof and held records never reach PG Reorder, and CW-P-0000 never reaches PG Catalog", async () => {
    const snapshot = withRuledClasses(SNAPSHOT());
    const before = await target();
    for (const stage of ["objects", "assignments", "purchasing"]) {
      const r = copy(stage, "p-executor", { snapshot });
      assert.equal(r.status, 0, r.err);
      assert.equal(r.out.outcome, "NO_CHANGES", `${stage}: only the already-copied operational records remain`);
    }
    assert.deepEqual(await target(), before, "nothing written");
    const ids = [...LIVE_PROOF_IDS, ...HELD_IDS].map((e) => e.id);
    assert.equal(await n(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE id = ANY($1)`, [ids]), 0);
    assert.equal(await n(`SELECT count(*)::int n FROM eos_ops.purchase_orders WHERE id = ANY($1)`, [ids]), 0);
    assert.equal(await n(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE part_id = 'CW-P-0000'`, []), 0);
    assert.equal(await n(`SELECT count(*)::int n FROM eos_ops.parts WHERE id = 'CW-P-0000'`, []), 0);
  });

  await t.test("verify is NOT reconciled against a snapshot the target does not hold", async () => {
    const bigger = SNAPSHOT();
    bigger.collections.reorder_requests.push(reorder("rr-cut-5"));
    bigger.counts.reorder_requests = 5;
    const r = run("verify", [], { snapshot: bigger });
    assert.equal(r.status, 1);
    assert.equal(r.out.reconciled, false);
    assert.equal(r.out.reconciliation.objectsAllPresent, false);
    assert.equal(r.out.stages.objects.notYetPresent, 1);
  });

  await t.test("a snapshot from another project, or a malformed one, is refused before any read", async () => {
    const foreign = SNAPSHOT();
    foreign.source.firebaseProjectId = "taylor-parts";
    const prod = run("census", [], { snapshot: foreign });
    assert.equal(prod.status, 2);
    assert.match(prod.err, /production project 'taylor-parts'/);
    const other = SNAPSHOT();
    other.source.firebaseProjectId = "eos-platform-integration";
    const wrong = run("census", [], { snapshot: other });
    assert.equal(wrong.status, 2);
    assert.match(wrong.err, /declares 'eos-platform-sandbox'/);
    const miscounted = SNAPSHOT();
    miscounted.counts.reorder_purchase_orders = 9;
    const mis = run("census", [], { snapshot: miscounted });
    assert.equal(mis.status, 2);
    assert.match(mis.err, /SNAPSHOT_COUNT_MISMATCH/);
  });
});

// ════════ Controller ruling 2026-09-30, Option B: the five pinned Sample Company v2 purchasing fixtures ════════
// The rows below are the nonprod rows EXACTLY (read-only dump, 2026-09-30), so the pinned fingerprints are proved to BE
// those records. They are seeded with session_replication_role = replica because they carry the historical operator
// string `rudy` in actor columns -- the very characteristic the ruling classifies -- which today's foreign keys refuse.
const SAMPLE_COMPANY_PURCHASING = {
  "reorder_requests": [
    {
      "id": "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae",
      "status": "VOIDED",
      "part_id": "SC-PART-BELT-06",
      "urgency": null,
      "tenant_id": "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25",
      "created_at": "2026-09-16T17:29:48.351759+00:00",
      "provenance": "NATIVE",
      "updated_at": "2026-09-16T17:29:48.358799+00:00",
      "updated_by": "rudy",
      "received_at": null,
      "reviewed_at": null,
      "cancelled_at": null,
      "requested_by": "rudy",
      "review_notes": null,
      "warehouse_id": "SC-WH-MAIN",
      "work_order_id": null,
      "quantity_source": null,
      "review_decision": null,
      "purchasing_notes": null,
      "vendor_contacted": null,
      "requested_quantity": 10,
      "cancellation_reason": null,
      "recommended_quantity": 10,
      "operating_company_key": "sample-co-synthetic",
      "purchasing_started_at": null,
      "recommendation_status": null,
      "reorder_request_number": "RR-2026-000902",
      "received_by_principal_id": null,
      "reviewed_by_principal_id": null,
      "cancelled_by_principal_id": null,
      "last_purchasing_update_at": null,
      "expected_availability_date": null,
      "purchasing_started_by_principal_id": null,
      "last_purchasing_update_by_principal_id": null
    },
    {
      "id": "rr_f7090a49-f1b1-40cf-8bde-c7d9a69574af",
      "status": "ORDERED",
      "part_id": "SC-PART-COMPRESSOR-01",
      "urgency": null,
      "tenant_id": "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25",
      "created_at": "2026-09-16T17:29:48.263067+00:00",
      "provenance": "NATIVE",
      "updated_at": "2026-09-16T17:29:48.266803+00:00",
      "updated_by": "rudy",
      "received_at": null,
      "reviewed_at": null,
      "cancelled_at": null,
      "requested_by": "rudy",
      "review_notes": null,
      "warehouse_id": "SC-WH-MAIN",
      "work_order_id": null,
      "quantity_source": null,
      "review_decision": null,
      "purchasing_notes": null,
      "vendor_contacted": null,
      "requested_quantity": 4,
      "cancellation_reason": null,
      "recommended_quantity": 4,
      "operating_company_key": "sample-co-synthetic",
      "purchasing_started_at": null,
      "recommendation_status": null,
      "reorder_request_number": "RR-2026-000901",
      "received_by_principal_id": null,
      "reviewed_by_principal_id": null,
      "cancelled_by_principal_id": null,
      "last_purchasing_update_at": null,
      "expected_availability_date": null,
      "purchasing_started_by_principal_id": null,
      "last_purchasing_update_by_principal_id": null
    }
  ],
  "purchase_orders": [
    {
      "id": "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae",
      "part_id": "SC-PART-BELT-06",
      "currency": "USD",
      "tenant_id": "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25",
      "created_at": "2026-09-16T17:29:48.353218+00:00",
      "created_by": "rudy",
      "ordered_date": "2026-09-02",
      "supplier_name": "SYNTHETIC Acme Parts Supply (fixture)",
      "ordered_quantity": 10,
      "unit_price_minor": 2200,
      "external_po_number": "SC-PO-000902",
      "expected_arrival_date": "2026-09-09",
      "operating_company_key": "sample-co-synthetic",
      "price_authority_version": null
    },
    {
      "id": "rr_f7090a49-f1b1-40cf-8bde-c7d9a69574af",
      "part_id": "SC-PART-COMPRESSOR-01",
      "currency": "USD",
      "tenant_id": "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25",
      "created_at": "2026-09-16T17:29:48.266803+00:00",
      "created_by": "rudy",
      "ordered_date": "2026-09-01",
      "supplier_name": "SYNTHETIC Acme Parts Supply (fixture)",
      "ordered_quantity": 4,
      "unit_price_minor": 48500,
      "external_po_number": "SC-PO-000901",
      "expected_arrival_date": "2026-09-08",
      "operating_company_key": "sample-co-synthetic",
      "price_authority_version": null
    }
  ],
  "purchase_order_voids": [
    {
      "reason": "SAMPLE COMPANY V2: supplier could not fulfil; order voided before receipt",
      "part_id": "SC-PART-BELT-06",
      "tenant_id": "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25",
      "voided_at": "2026-09-16T17:29:48.358799+00:00",
      "voided_by": "rudy",
      "purchase_order_id": "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae",
      "operating_company_key": "sample-co-synthetic"
    }
  ]
};

test("Option B: pinned Sample Company purchasing fixtures are KNOWN_NON_MIGRATED_FIXTURE; everything else still refuses", { skip: SKIP, concurrency: 1 }, async (t) => {
  const fixtures = createRequire(import.meta.url)("../lib/eosOps/migration/reorderKnownFixtures.js");
  const purchasingCopy = createRequire(import.meta.url)("../lib/eosOps/migration/reorderPurchaseOrderMigrationCopy.js");
  const name = `rr_fix_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const dir = mkdtempSync(join(tmpdir(), "reorder-fixtures-"));
  t.after(async () => {
    rmSync(dir, { recursive: true, force: true });
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  const q = (text, values = []) => pool.query(text, values);
  const KT = fixtures.REORDER_FIXTURE_TENANT_ID;
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, 'fixture tenant')`, [KT, TENANT_KEY]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ($1, 'taylor', 'ACTIVE', 'fixture', 'f', 'f')`, [KT]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ($1, 'taylor', 'taylor', 'ACTIVE', 'NATIVE', 'fixture', 'f', 'f')`, [KT]);
  const asReplica = async (fn) => {
    const c = await pool.connect();
    try { await c.query("SET session_replication_role = replica"); return await fn(c); } finally { await c.query("RESET session_replication_role"); c.release(); }
  };
  const seedRow = (c, table, row) => c.query(`INSERT INTO eos_ops.${table} SELECT * FROM jsonb_populate_record(NULL::eos_ops.${table}, $1::jsonb)`, [JSON.stringify(row)]);
  await asReplica(async (c) => { for (const [table, rows] of Object.entries(SAMPLE_COMPANY_PURCHASING)) for (const r of rows) await seedRow(c, table, r); });

  // The snapshot as the real source reduces to it: every record excluded or held, nothing operational.
  const empty = { format: "EOS_REORDER_SNAPSHOT", version: 1, source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-30T00:00:00.000Z" },
    counts: { reorder_requests: 0, reorder_purchase_orders: 0, reorder_purchase_order_voids: 0 },
    collections: { reorder_requests: [], reorder_purchase_orders: [], reorder_purchase_order_voids: [] } };
  const verify = () => {
    const file = join(dir, `s-${randomUUID()}.json`);
    const text = JSON.stringify(empty);
    writeFileSync(file, text);
    writeFileSync(`${file}.sha256`, `${hash("sha256", text)}  s.json\n`);
    const res = spawnSync(process.execPath, ["scripts/reorderCutover.js", "--mode", "verify", "--environment", "platform-sandbox", "--databaseUrlEnv", "RR_FIX_DB",
      "--tenantKey", TENANT_KEY, "--snapshot", file, "--exclusionManifest", EXCLUSION_MANIFEST],
    { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", RR_FIX_DB: url } });
    return { status: res.status, out: res.stdout ? JSON.parse(res.stdout) : null, err: res.stderr };
  };
  const tamper = (sql, values = []) => asReplica((c) => c.query(sql, values));
  const refusedThenRestored = async (label, change, restore) => {
    await tamper(...change);
    const r = verify();
    assert.equal(r.status, 1, `${label}: ${r.err}`);
    assert.equal(r.out.reconciled, false, label);
    assert.ok(r.out.fixtureRefusals.length > 0, `${label}: refused as a fixture mismatch`);
    await tamper(...restore);
    assert.equal(verify().out.reconciled, true, `${label}: restored`);
  };
  const RR_ORDERED = "rr_f7090a49-f1b1-40cf-8bde-c7d9a69574af";
  const RR_VOIDED = "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae";

  await t.test("1, 2, 11, 12: exactly 2 requests + 2 POs + 1 void accepted by pinned fingerprint; Taylor migration stays 0 / 0 / 0", async () => {
    const r = verify();
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out.reconciled, true);
    assert.equal(r.out.reconciliation.targetAccounted, true);
    const shape = (k) => r.out.knownNonMigratedFixtures[k].map((x) => [x.id, x.classification, x.fingerprint]);
    for (const k of ["reorderRequests", "purchaseOrders", "voids"]) {
      assert.deepEqual(shape(k), fixtures.KNOWN_REORDER_FIXTURES[k].map((p) => [p.id, "KNOWN_NON_MIGRATED_FIXTURE", p.fingerprint]), k);
    }
    assert.deepEqual([fixtures.KNOWN_REORDER_FIXTURES.reorderRequests.length, fixtures.KNOWN_REORDER_FIXTURES.purchaseOrders.length, fixtures.KNOWN_REORDER_FIXTURES.voids.length], [2, 2, 1]);
    assert.deepEqual(r.out.unknownTargetRecords, { reorderRequests: [], purchaseOrders: [], voids: [] });
    assert.deepEqual(r.out.fixtureRefusals, []);
    assert.equal(r.out.stages.purchasing.verify.passed, true);
    assert.deepEqual([r.out.target.reorderRequestsMigrated, r.out.target.currentAssignmentsMigrated], [0, 0], "no fixture is counted as migrated Taylor data");
    assert.deepEqual(r.out.evidence.snapshotCensus.counts, { reorder_requests: 0, reorder_purchase_orders: 0, reorder_purchase_order_voids: 0 });
  });

  await t.test("3: a changed actor refuses, and nothing repairs it", () => refusedThenRestored("actor",
    [`UPDATE eos_ops.purchase_orders SET created_by = 'someone-else' WHERE id = $1`, [RR_ORDERED]],
    [`UPDATE eos_ops.purchase_orders SET created_by = 'rudy' WHERE id = $1`, [RR_ORDERED]]));

  await t.test("4: a changed company key refuses", () => refusedThenRestored("company key",
    [`UPDATE eos_ops.purchase_order_voids SET operating_company_key = 'taylor' WHERE purchase_order_id = $1`, [RR_VOIDED]],
    [`UPDATE eos_ops.purchase_order_voids SET operating_company_key = 'sample-co-synthetic' WHERE purchase_order_id = $1`, [RR_VOIDED]]));

  await t.test("5: a changed request / PO / void relationship refuses", () => refusedThenRestored("relationship",
    [`UPDATE eos_ops.purchase_order_voids SET purchase_order_id = $2 WHERE purchase_order_id = $1`, [RR_VOIDED, RR_ORDERED]],
    [`UPDATE eos_ops.purchase_order_voids SET purchase_order_id = $1 WHERE purchase_order_id = $2`, [RR_VOIDED, RR_ORDERED]]));

  await t.test("6: a changed business field refuses", () => refusedThenRestored("business field",
    [`UPDATE eos_ops.reorder_requests SET requested_quantity = 5 WHERE id = $1`, [RR_ORDERED]],
    [`UPDATE eos_ops.reorder_requests SET requested_quantity = 4 WHERE id = $1`, [RR_ORDERED]]));

  // Migration 1764380000000 (G2) added two nullable columns AFTER the pins were measured. They leave the fingerprint only
  // while NULL; a value written into one is a changed fixture like any other column.
  await t.test("a value in a post-pin column (create idempotency) refuses", () => refusedThenRestored("post-pin column",
    [`UPDATE eos_ops.reorder_requests SET create_idempotency_key = 'k', create_request_fingerprint = 'f' WHERE id = $1`, [RR_ORDERED]],
    [`UPDATE eos_ops.reorder_requests SET create_idempotency_key = NULL, create_request_fingerprint = NULL WHERE id = $1`, [RR_ORDERED]]));

  await t.test("a missing pinned fixture refuses: the set is exact", () => refusedThenRestored("missing",
    [`DELETE FROM eos_ops.purchase_order_voids WHERE purchase_order_id = $1`, [RR_VOIDED]],
    [`INSERT INTO eos_ops.purchase_order_voids SELECT * FROM jsonb_populate_record(NULL::eos_ops.purchase_order_voids, $1::jsonb)`, [JSON.stringify(SAMPLE_COMPANY_PURCHASING.purchase_order_voids[0])]]));

  await t.test("7: an unexpected additional Sample Company record refuses", async () => {
    await asReplica((c) => seedRow(c, "reorder_requests", { ...SAMPLE_COMPANY_PURCHASING.reorder_requests[1], id: "rr_sample_extra", reorder_request_number: "RR-2026-000999" }));
    const r = verify();
    assert.equal(r.out.reconciled, false);
    assert.ok(r.out.fixtureRefusals.some((x) => x.includes("rr_sample_extra")));
    await tamper(`DELETE FROM eos_ops.reorder_requests WHERE id = 'rr_sample_extra'`);
  });

  await t.test("8: an ordinary unknown target record refuses", async () => {
    await asReplica((c) => seedRow(c, "reorder_requests", { ...SAMPLE_COMPANY_PURCHASING.reorder_requests[1], id: "rr_ordinary_unknown", operating_company_key: "taylor", reorder_request_number: "RR-2026-000998" }));
    const r = verify();
    assert.equal(r.out.reconciled, false);
    assert.deepEqual(r.out.unknownTargetRecords.reorderRequests, ["rr_ordinary_unknown"]);
    await tamper(`DELETE FROM eos_ops.reorder_requests WHERE id = 'rr_ordinary_unknown'`);
  });

  await t.test("9, 10: an ordinary ungoverned company and an ordinary invalid actor still fail the purchasing verify", async () => {
    const known = {
      reorderRequestIds: fixtures.KNOWN_REORDER_FIXTURES.reorderRequests.map((p) => p.id),
      purchaseOrderIds: fixtures.KNOWN_REORDER_FIXTURES.purchaseOrders.map((p) => p.id),
      voidIds: fixtures.KNOWN_REORDER_FIXTURES.voids.map((p) => p.id),
    };
    assert.equal((await purchasingCopy.verifyPurchaseOrderMigration(pool, KT, known)).passed, true);
    await asReplica((c) => seedRow(c, "purchase_orders", { ...SAMPLE_COMPANY_PURCHASING.purchase_orders[1], id: "po_ordinary", operating_company_key: "not-a-bound-key", created_by: "not-a-principal" }));
    const v = await purchasingCopy.verifyPurchaseOrderMigration(pool, KT, known);
    assert.equal(v.passed, false);
    assert.deepEqual(v.findings.map((f) => [f.code, f.count]), [["ACTOR_NOT_ACTIVE_MEMBER", 1], ["COMPANY_KEY_NOT_GOVERNED", 1]], "exactly the ordinary row, never the fixtures");
    // Without the proved fixture ids the verify is exactly as before: the fixtures are findings too.
    const unexcluded = await purchasingCopy.verifyPurchaseOrderMigration(pool, KT);
    assert.deepEqual(unexcluded.findings.filter((f) => f.code === "ACTOR_NOT_ACTIVE_MEMBER").map((f) => f.count), [3, 1]);
    await tamper(`DELETE FROM eos_ops.purchase_orders WHERE id = 'po_ordinary'`);
  });

  await t.test("the pins apply only in the pinned tenant", async () => {
    const c = await pool.connect();
    try {
      const other = await fixtures.classifyReorderTarget(c, "tenant-other", { reorderRequests: new Set(), purchaseOrders: new Set(), voids: new Set() });
      assert.deepEqual(other.known, { reorderRequests: [], purchaseOrders: [], voids: [] });
    } finally { c.release(); }
  });
});
