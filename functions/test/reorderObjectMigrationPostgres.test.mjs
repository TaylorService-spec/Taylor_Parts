// LEGACY REORDER OBJECT DRY RUN / COPY ONCE / VERIFY, against a real postgres:16.
//
// The copy's job is to REFUSE more often than it writes, so most of this suite is about what it will
// not copy, what it will not invent, and what it will not overwrite.
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
const copy = require("../lib/eosOps/migration/reorderObjectMigrationCopy.js");
const plan = require("../lib/eosOps/migration/reorderObjectMigration.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

/** A complete, valid legacy Reorder document. Each test spoils exactly one thing. */
const doc = (id, over = {}) => ({
  id,
  data: {
    partId: "PART-1", recommendationStatus: "BELOW_MIN", urgency: "ROUTINE", quantitySource: "RECOMMENDED",
    recommendedQty: 5, requestedQty: 5, status: "PENDING_REVIEW", currentOwner: "INVENTORY",
    requestedBy: "uid-alice", createdAt: 1700000000000,
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
    assignedToUserId: null, assignedBy: null, assignedAt: null,
    purchasingStartedAt: null, purchasingStartedBy: null, purchasingNotes: null,
    vendorContacted: null, expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null, lastPurchasingUpdateBy: null,
    purchaseOrderId: null, orderedBy: null, orderedAt: null, receivedBy: null, receivedAt: null,
    cancelledBy: null, cancelledAt: null, cancellationReason: null,
    voidedBy: null, voidedAt: null, voidReason: null,
    warehouseId: "wh-1", operatingCompanyId: "sample-co",
    ...over,
  },
});

test("legacy Reorder object copy: complete parity, resolved identity, all-or-nothing", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rr_obj_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);

  const principal = async (tenantId, subject) => repo.transact({ tenantId, uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const pAlice = await principal("t1", "uid-alice");
  const executor = await principal("t1", "uid-executor");
  await principal("t2", "uid-t2");

  const warehouse = (id, company, tenant = "t1") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, $3, $1, 'Sampleton', 'ACTIVE', 'NATIVE', 'fixture', 'fixture')`, [id, tenant, company]);
  await warehouse("wh-1", "sample-co");
  await warehouse("wh-other-co", "different-co");

  const run = (source, over = {}) => copy.copyReorderObjectsOnce(pool, {
    tenantId: "t1", source, performedByPrincipalId: executor, ...over,
  });

  await t.test("DRY RUN classifies every row and writes nothing", async () => {
    const before = (await q(`SELECT count(*)::int n FROM eos_ops.reorder_requests`)).rows[0].n;
    const p = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1",
      source: [
        doc("rr-ok"),
        doc("rr-no-warehouse", { warehouseId: "wh-nope" }),
        doc("rr-wrong-co", { warehouseId: "wh-other-co" }),
        doc("rr-gen1", { warehouseId: null }),
      ],
    });
    assert.equal(p.applied, false);
    assert.equal(p.sourceRows, 4);
    assert.equal(p.counts.MIGRATABLE, 1);
    assert.equal(p.counts.REFUSED, 3);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.reorder_requests`)).rows[0].n, before);
  });

  await t.test("RULING 3: a warehouse from another operating company is refused, never reconciled", async () => {
    const p = await copy.dryRunReorderObjectMigration(pool, { tenantId: "t1", source: [doc("rr-x", { warehouseId: "wh-other-co" })] });
    assert.equal(p.rows[0].refusalCode, "WAREHOUSE_COMPANY_DISAGREEMENT");
  });

  await t.test("a generation-1 record is refused, and no warehouse is inferred for it", async () => {
    const p = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1",
      source: [doc("rr-a", { warehouseId: null }), doc("rr-b", { operatingCompanyId: null })],
    });
    assert.equal(p.counts.MIGRATABLE, 0);
    // Exactly one warehouse exists for this company; it is still not borrowed.
    assert.ok(p.rows.every((r) => r.disposition === "REFUSED"));
  });

  await t.test("a stored currentOwner that disagrees with the lifecycle is refused, not silently re-derived", async () => {
    const p = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1", source: [doc("rr-owner", { currentOwner: "PARTS_ASSOCIATE" })] });
    assert.equal(p.rows[0].refusalCode, "CURRENT_OWNER_DISAGREEMENT");
  });

  await t.test("a terminal status with no moment leaves the status unexplained, so it is refused", async () => {
    const p = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1",
      source: [doc("rr-c", { status: "CANCELLED", currentOwner: null, cancelledAt: null, cancellationReason: "late" })],
    });
    assert.equal(p.rows[0].refusalCode, "MISSING_TERMINAL_MOMENT");
  });

  await t.test("half a review is refused, and an ungoverned decision is refused", async () => {
    const half = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1", source: [doc("rr-d", { reviewDecision: "APPROVED", reviewedAt: null })] });
    assert.equal(half.rows[0].refusalCode, "REVIEW_HALF_RECORDED");
    const bogus = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1", source: [doc("rr-e", { reviewDecision: "MAYBE", reviewedAt: 1700000000001 })] });
    assert.equal(bogus.rows[0].refusalCode, "UNKNOWN_REVIEW_DECISION");
  });

  await t.test("a date is never guessed at", async () => {
    const p = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1", source: [doc("rr-f", { expectedAvailabilityDate: "03/04/2026" })] });
    assert.equal(p.rows[0].refusalCode, "INVALID_DATE");
    const inst = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1", source: [doc("rr-g", { createdAt: "last Tuesday" })] });
    assert.equal(inst.rows[0].refusalCode, "INVALID_INSTANT");
  });

  await t.test("ONE refusal blocks the whole copy: no partial migration", async () => {
    const r = await run([doc("rr-good"), doc("rr-bad", { warehouseId: "wh-nope" })]);
    assert.equal(r.applied, false);
    assert.match(r.refusal, /partial/);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.reorder_requests`)).rows[0].n, 0);
  });

  await t.test("the executor is validated in the copy transaction, not trusted", async () => {
    const r = await run([doc("rr-ok")], { performedByPrincipalId: "not-a-principal" });
    assert.equal(r.applied, false);
    assert.match(r.refusal, /executor/);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.reorder_requests`)).rows[0].n, 0);
  });

  let copied;
  await t.test("COPY ONCE writes every authored fact, with the requester resolved to a Principal", async () => {
    copied = await run([
      doc("rr-1"),
      doc("rr-2", {
        status: "PURCHASING_IN_PROGRESS", currentOwner: "PARTS_ASSOCIATE",
        reviewDecision: "APPROVED", reviewedAt: 1700000001000, reviewedBy: "uid-alice",
        reviewNotes: "approved on the floor",
        purchasingStartedAt: 1700000002000, purchasingStartedBy: "uid-alice",
        purchasingNotes: "called two suppliers", vendorContacted: true,
        expectedAvailabilityDate: "2026-03-04",
        lastPurchasingUpdateAt: 1700000003000, lastPurchasingUpdateBy: "uid-alice",
      }),
    ]);
    assert.equal(copied.applied, true, copied.refusal ?? "");
    assert.equal(copied.inserted, 2);

    const { rows } = await q(`SELECT * FROM eos_ops.reorder_requests WHERE id = 'rr-2'`);
    const r = rows[0];
    assert.equal(r.provenance, "MIGRATED");
    assert.equal(r.requested_by, pAlice, "the uid must be resolved to a Principal, never stored raw");
    assert.equal(r.reviewed_by_principal_id, pAlice);
    assert.equal(r.review_decision, "APPROVED");
    assert.equal(r.review_notes, "approved on the floor");
    assert.equal(r.purchasing_notes, "called two suppliers");
    assert.equal(r.vendor_contacted, true);
    assert.equal(r.expected_availability_date.toISOString().slice(0, 10), "2026-03-04");
    assert.equal(r.recommendation_status, "BELOW_MIN");
    assert.equal(r.quantity_source, "RECOMMENDED");
    // The legacy instant, not the migration's clock.
    assert.equal(r.created_at.toISOString(), new Date(1700000000000).toISOString());
  });

  await t.test("an unresolved requester becomes NULL -- never a fabricated or substituted Principal", async () => {
    const r = await run([doc("rr-unknown", { requestedBy: "uid-long-gone" })]);
    assert.equal(r.applied, true, r.refusal ?? "");
    const { rows } = await q(`SELECT requested_by, updated_by, provenance FROM eos_ops.reorder_requests WHERE id = 'rr-unknown'`);
    assert.equal(rows[0].requested_by, null, "an unknown requester is recorded as unknown");
    assert.notEqual(rows[0].updated_by, null);
    // The executor appears as who ran the import, and NOT as who requested the Reorder.
    assert.equal(rows[0].updated_by, executor);
    assert.equal(rows[0].provenance, "MIGRATED");
  });

  await t.test("a Principal from another tenant is not this tenant's actor", async () => {
    const r = await run([doc("rr-cross", { requestedBy: "uid-t2" })]);
    assert.equal(r.applied, true, r.refusal ?? "");
    const { rows } = await q(`SELECT requested_by FROM eos_ops.reorder_requests WHERE id = 'rr-cross'`);
    assert.equal(rows[0].requested_by, null);
  });

  await t.test("a Reorder the authority already holds is never overwritten", async () => {
    const p = await copy.dryRunReorderObjectMigration(pool, {
      tenantId: "t1", source: [doc("rr-1", { requestedQty: 999 })] });
    assert.equal(p.rows[0].disposition, "ALREADY_PRESENT");
    const r = await run([doc("rr-1", { requestedQty: 999 })]);
    assert.equal(r.applied, false);
    assert.equal((await q(`SELECT requested_quantity FROM eos_ops.reorder_requests WHERE id='rr-1'`)).rows[0].requested_quantity, 5);
  });

  await t.test("the audit record names the executor, and the executor is nowhere else", async () => {
    const { rows } = await q(
      `SELECT actor_uid, action, after FROM eos_policy.audit_events WHERE action = $1 ORDER BY occurred_at`,
      [copy.REORDER_OBJECT_COPY_ACTION]);
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].actor_uid, executor);
    // No Reorder claims the executor as its requester.
    const { rows: claimed } = await q(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE requested_by = $1`, [executor]);
    assert.equal(claimed[0].n, 0, "the migration executor must never stand in for a historical requester");
  });

  await t.test("VERIFY proves identity structurally, and a colliding string does not fool it", async () => {
    // A Principal whose external subject collides with a stored Principal id. Identity comes from the
    // authority that holds the value, not from its characters.
    await repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: pAlice, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
    });
    const v = await copy.verifyReorderObjectMigration(pool, "t1");
    assert.equal(v.passed, true, JSON.stringify(v.findings));
    assert.deepEqual(v.uidShapedColumns, [], "no column in reorder_requests can hold an external subject");
    assert.ok(v.checked >= 4);
    assert.equal(v.unresolvedActors, 2, "the two unresolvable requesters are reported, not hidden");
  });

  await t.test("the derived owner is a total function over the governed statuses", () => {
    const STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED", "READY_FOR_PARTS_MANAGER",
      "ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS", "ORDERED", "RECEIVED", "CANCELLED", "VOIDED"];
    for (const s of STATUSES) {
      const owner = plan.deriveReorderCurrentOwner(s);
      assert.ok(owner === null || ["INVENTORY", "PARTS_MANAGER", "PARTS_ASSOCIATE"].includes(owner), s);
    }
  });
});
