// THE GOVERNED REORDER LIFECYCLE, against a real postgres:16.
//
// The point of this suite is the ASSIGNEE SEAM: three actions belong to the Employee the work was
// assigned to, and that is now decided by resolving the caller to an Employee rather than by
// comparing a Firebase uid to a document field.
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
const life = require("../lib/eosOps/reorderLifecycleCommands.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const ALL = new Set([
  life.REORDER_CREATE_MANUAL, life.REORDER_CREATE_SYSTEM, life.REORDER_APPROVE, life.REORDER_REJECT,
  life.REORDER_START_PURCHASING, life.REORDER_POST_UPDATE, life.REORDER_MARK_RECEIVED,
  life.REORDER_CANCEL, life.REORDER_READ_QUEUE, life.REORDER_READ_OWN, authority.REORDER_REQUEST_ASSIGN,
]);

test("the governed Reorder lifecycle: capability first, then the assignee narrows it", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rr_life_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);

  const principal = async (subject) => repo.transact({ tenantId: "t1", uid: "fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const pManager = await principal("uid-manager");
  const pAlice = await principal("uid-alice");   // the assignee
  const pBob = await principal("uid-bob");       // NOT the assignee
  const pUnlinked = await principal("uid-unlinked");

  const employee = (id) => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
     VALUES ($1, 't1', 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [id]);
  let n = 0;
  const link = (employeeId, principalId) => q(
    `INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
     VALUES ($1, 't1', $2, $3, 'taylor', 'OPERATOR_ASSERTED', 'f', 'test', 'active')`, [`epl-${++n}`, principalId, employeeId]);
  const qualify = (employeeId) => q(
    `INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
     VALUES ($1, 't1', $2, 'WAREHOUSE_OPERATIONS', now(), 'fixture')`, [`ewe-${employeeId}`, employeeId]);
  await employee("e-alice"); await link("e-alice", pAlice); await qualify("e-alice");
  await employee("e-bob");   await link("e-bob", pBob);     await qualify("e-bob");

  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-1','t1','sample-co','WH','Sampleton','ACTIVE','NATIVE','f','f'),
                  ('wh-idle','t1','sample-co','WH2','Sampleton','INACTIVE','NATIVE','f','f')`);

  const actor = (principalId, caps = ALL) => ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const deps = { pool };
  const create = (over = {}) => life.createGovernedReorderRequest(deps, actor(pManager), {
    partId: "PART-1", warehouseId: "wh-1", requestedQuantity: 4,
    recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL", ...over,
  });

  await t.test("creation reads the company FROM the warehouse and never from the caller", async () => {
    const r = await create();
    const { rows } = await q(`SELECT operating_company_key, provenance, status::text status, requested_by FROM eos_ops.reorder_requests WHERE id=$1`, [r.reorderRequestId]);
    assert.equal(rows[0].operating_company_key, "sample-co");
    assert.equal(rows[0].provenance, "NATIVE");
    assert.equal(rows[0].status, "PENDING_REVIEW");
    assert.equal(rows[0].requested_by, pManager, "the requester is the EOS Principal");
    // The command accepts no operatingCompanyKey at all: a caller cannot supply company authority.
    await assert.rejects(create({ operatingCompanyKey: "someone-elses-co" }), /does not accept/);
  });

  await t.test("creation refuses a warehouse this tenant does not have, and an inactive one", async () => {
    await assert.rejects(create({ warehouseId: "wh-nope" }), /no warehouse in this tenant/);
    await assert.rejects(create({ warehouseId: "wh-idle" }), /ACTIVE warehouse/);
    // And there is no default: omitting the warehouse is refused, never resolved to the only one.
    await assert.rejects(create({ warehouseId: undefined }), /a warehouse is required/);
  });

  await t.test("a manual request states a real quantity", async () => {
    await assert.rejects(create({ requestedQuantity: 0 }), /greater than zero/);
    // A system recommendation may legitimately be zero, and needs its own capability.
    const r = await life.createGovernedReorderRequest(deps, actor(pManager), {
      partId: "PART-1", warehouseId: "wh-1", requestedQuantity: 0, manual: false,
      recommendationStatus: "OK", quantitySource: "SYSTEM",
    });
    assert.ok(r.reorderRequestId);
  });

  await t.test("every command refuses without its capability, before anything else is considered", async () => {
    const none = actor(pManager, []);
    await assert.rejects(life.createGovernedReorderRequest(deps, none, {
      partId: "P", warehouseId: "wh-1", requestedQuantity: 1, recommendationStatus: "B", quantitySource: "M",
    }), /requires reorder\.request\.create\.manual/);
    await assert.rejects(life.readReorderQueue(deps, none), /requires reorder\.request\.read\.queue/);
    await assert.rejects(life.readMyAssignedReorders(deps, none), /requires reorder\.request\.read\.own/);
  });

  // ════════════════ the assignee seam ════════════════
  let rr;
  await t.test("review advances to the Parts Manager's queue, recording the decision and its actor", async () => {
    rr = (await create()).reorderRequestId;
    const r = await life.reviewReorderRequest(deps, actor(pManager), { reorderRequestId: rr, decision: "APPROVED", reviewNotes: "stock is low" });
    assert.equal(r.status, "READY_FOR_PARTS_MANAGER");
    const { rows } = await q(`SELECT review_decision, review_notes, reviewed_by_principal_id, reviewed_at FROM eos_ops.reorder_requests WHERE id=$1`, [rr]);
    assert.equal(rows[0].review_decision, "APPROVED");
    assert.equal(rows[0].review_notes, "stock is low");
    assert.equal(rows[0].reviewed_by_principal_id, pManager);
    assert.ok(rows[0].reviewed_at);
    await assert.rejects(life.reviewReorderRequest(deps, actor(pManager), { reorderRequestId: rr, decision: "APPROVED" }), /not under review/);
    // A rejection states why; an approval need not. The legacy Rules drew that line and it is kept.
    const other = (await create()).reorderRequestId;
    await assert.rejects(life.reviewReorderRequest(deps, actor(pManager), { reorderRequestId: other, decision: "REJECTED" }), /states why/);
    const rejected = await life.reviewReorderRequest(deps, actor(pManager), {
      reorderRequestId: other, decision: "REJECTED", reviewNotes: "stock arrived another way" });
    assert.equal(rejected.status, "REJECTED");
  });

  await t.test("assignment advances the status in the same transaction", async () => {
    const r = await authority.assignReorderRequestToEmployee(deps, actor(pManager), { reorderRequestId: rr, employeeId: "e-alice" });
    assert.equal(r.outcome, "ASSIGNED");
    assert.equal((await q(`SELECT status::text s FROM eos_ops.reorder_requests WHERE id=$1`, [rr])).rows[0].s, "ASSIGNED_TO_PARTS_ASSOCIATE");
  });

  await t.test("THE SEAM: a capable NON-assignee is refused; the assignee is not", async () => {
    // Bob holds every capability. He is simply not who the work was assigned to.
    await assert.rejects(
      life.startPurchasingOnReorder(deps, actor(pBob), { reorderRequestId: rr }),
      /belongs to the Employee the Reorder Request is assigned to/);
    // A Principal with no Employee link resolves to no Employee at all.
    await assert.rejects(
      life.startPurchasingOnReorder(deps, actor(pUnlinked), { reorderRequestId: rr }),
      /belongs to the Employee/);
    const r = await life.startPurchasingOnReorder(deps, actor(pAlice), { reorderRequestId: rr, purchasingNotes: "ringing round" });
    assert.equal(r.status, "PURCHASING_IN_PROGRESS");
  });

  await t.test("the assignee predicate NARROWS a capability; it never grants one", async () => {
    // Alice IS the assignee, and still cannot act without the capability.
    await assert.rejects(
      life.postPurchasingUpdate(deps, actor(pAlice, []), { reorderRequestId: rr, vendorContacted: true }),
      /requires reorder\.request\.postPurchasingUpdate/);
  });

  await t.test("purchasing progress is the assignee's, and every authored fact is kept", async () => {
    await assert.rejects(life.postPurchasingUpdate(deps, actor(pBob), { reorderRequestId: rr, vendorContacted: true }), /assigned to/);
    await life.postPurchasingUpdate(deps, actor(pAlice), {
      reorderRequestId: rr, purchasingNotes: "two suppliers contacted",
      vendorContacted: true, expectedAvailabilityDate: "2026-04-01",
    });
    const { rows } = await q(`SELECT purchasing_notes, vendor_contacted, expected_availability_date, last_purchasing_update_by_principal_id FROM eos_ops.reorder_requests WHERE id=$1`, [rr]);
    assert.equal(rows[0].purchasing_notes, "two suppliers contacted");
    assert.equal(rows[0].vendor_contacted, true);
    assert.equal(rows[0].expected_availability_date.toISOString().slice(0, 10), "2026-04-01");
    assert.equal(rows[0].last_purchasing_update_by_principal_id, pAlice);
    await assert.rejects(life.postPurchasingUpdate(deps, actor(pAlice), { reorderRequestId: rr, expectedAvailabilityDate: "01/04/2026" }), /ISO calendar day/);
  });

  await t.test("reassigning work already in progress is refused, exactly as the legacy transition was", async () => {
    // firestore.rules' Assign arm fires only from READY_FOR_PARTS_MANAGER. Permitting a
    // mid-purchasing reassignment here would make it reachable for the first time -- access widened
    // by a database move rather than by a decision.
    await assert.rejects(
      authority.assignReorderRequestToEmployee(deps, actor(pManager), { reorderRequestId: rr, employeeId: "e-bob" }),
      /not awaiting assignment/);
    // Alice is still the assignee, so she may still act.
    await life.postPurchasingUpdate(deps, actor(pAlice), { reorderRequestId: rr, vendorContacted: false });
  });

  await t.test("receipt closes out from ORDERED only, and only by the assignee", async () => {
    await assert.rejects(life.markReorderReceived(deps, actor(pAlice), { reorderRequestId: rr }), /has not been ordered/);
    await q(`UPDATE eos_ops.reorder_requests SET status='ORDERED' WHERE id=$1`, [rr]);
    await assert.rejects(life.markReorderReceived(deps, actor(pBob), { reorderRequestId: rr }), /assigned to/);
    const r = await life.markReorderReceived(deps, actor(pAlice), { reorderRequestId: rr });
    assert.equal(r.status, "RECEIVED");
    const { rows } = await q(`SELECT received_at, received_by_principal_id FROM eos_ops.reorder_requests WHERE id=$1`, [rr]);
    assert.ok(rows[0].received_at, "the terminal status states when it happened");
    assert.equal(rows[0].received_by_principal_id, pAlice);
  });

  await t.test("cancellation is a management action, states a reason, and stops at ORDERED", async () => {
    const c = (await create()).reorderRequestId;
    await assert.rejects(life.cancelReorderRequest(deps, actor(pManager), { reorderRequestId: c, cancellationReason: "x" }), /cannot be cancelled/);
    await life.reviewReorderRequest(deps, actor(pManager), { reorderRequestId: c, decision: "APPROVED" });
    await assert.rejects(life.cancelReorderRequest(deps, actor(pManager), { reorderRequestId: c }), /states why/);
    const r = await life.cancelReorderRequest(deps, actor(pManager), { reorderRequestId: c, cancellationReason: "duplicate request" });
    assert.equal(r.status, "CANCELLED");
    const { rows } = await q(`SELECT cancelled_at, cancellation_reason, cancelled_by_principal_id FROM eos_ops.reorder_requests WHERE id=$1`, [c]);
    assert.equal(rows[0].cancellation_reason, "duplicate request");
    assert.equal(rows[0].cancelled_by_principal_id, pManager);
    assert.ok(rows[0].cancelled_at);
    // An ORDERED request is voided, not cancelled -- that is the purchase order's business.
    await q(`UPDATE eos_ops.reorder_requests SET status='ORDERED' WHERE id=$1`, [rr]);
    await assert.rejects(life.cancelReorderRequest(deps, actor(pManager), { reorderRequestId: rr, cancellationReason: "too late" }), /is voided instead/);
  });

  await t.test("'my assigned work' is scoped by EMPLOYEE, not by a Firebase uid", async () => {
    const mine = await life.readMyAssignedReorders(deps, actor(pAlice));
    assert.ok(mine.some((x) => x.reorderRequestId === rr), "Alice holds the assignment");
    const bobs = await life.readMyAssignedReorders(deps, actor(pBob));
    assert.ok(!bobs.some((x) => x.reorderRequestId === rr), "Bob was never assigned this work");
    // An unlinked Principal is not an Employee and therefore has no assigned work. Not an error --
    // the honest empty answer.
    assert.deepEqual(await life.readMyAssignedReorders(deps, actor(pUnlinked)), []);
  });

  await t.test("the queue is a different question from 'my work', and derives the owner", async () => {
    const queue = await life.readReorderQueue(deps, actor(pManager));
    assert.ok(queue.length >= 3);
    for (const item of queue) {
      assert.ok(item.currentOwner === null || ["INVENTORY", "PARTS_MANAGER", "PARTS_ASSOCIATE"].includes(item.currentOwner));
      assert.ok(!("assignedToUserId" in item), "no uid-keyed field survives into the governed read");
    }
  });

  await t.test("no Firebase uid is stored by any lifecycle write", async () => {
    const { rows } = await q(
      `SELECT count(*)::int n FROM eos_ops.reorder_requests
        WHERE requested_by LIKE 'uid-%' OR reviewed_by_principal_id LIKE 'uid-%'
           OR cancelled_by_principal_id LIKE 'uid-%' OR received_by_principal_id LIKE 'uid-%'`);
    assert.equal(rows[0].n, 0);
  });
});
