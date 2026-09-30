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
  life.REORDER_CANCEL, life.REORDER_READ, life.REORDER_RECORD_PO, authority.REORDER_REQUEST_ASSIGN,
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
     VALUES ($1, 't1', $2, $3, now(), 'fixture')`, [`ewe-${employeeId}`, employeeId, authority.REORDER_ASSIGNMENT_QUALIFICATION]);
  await employee("e-alice"); await link("e-alice", pAlice); await qualify("e-alice");
  await employee("e-bob");   await link("e-bob", pBob);     await qualify("e-bob");
  // The manager's queue REACH is the governed REORDER_QUEUE Operational Scope (ruling 6), not a capability of its own.
  await employee("e-manager"); await link("e-manager", pManager);

  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-1','t1','sample-co','WH','Sampleton','ACTIVE','NATIVE','f','f'),
                  ('wh-idle','t1','sample-co','WH2','Sampleton','INACTIVE','NATIVE','f','f')`);

  // RULING 2: the warehouse's eos_ops key must be BOUND to an ACTIVE company this tenant may operate
  // as. Company `taylor` operates under key `sample-co` -- deliberately different values.
  await q(`INSERT INTO eos_policy.tenant_operating_companies
             (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','fixture','f','f')`);
  // The manager's QUEUE reach: the REORDER_QUEUE scope for company key sample-co. Bob holds the scope for a DIFFERENT
  // bound company's queue -- which must never reach sample-co's requests.
  await q(`INSERT INTO eos_policy.tenant_operating_companies
             (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','other','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','other','other-co','ACTIVE','NATIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-queue-m', 't1', 'e-manager', 'REORDER_QUEUE', 'sample-co', now(), 'fixture'),
                  ('os-queue-b', 't1', 'e-bob', 'REORDER_QUEUE', 'other-co', now(), 'fixture')`);
  // A warehouse whose key nobody governs. Creating against it must refuse.
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-ungoverned','t1','not-a-bound-key','WH3','Sampleton','ACTIVE','NATIVE','f','f')`);

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
    // RULING 2: a valid-looking slug is not operating-company authority.
    await assert.rejects(create({ warehouseId: "wh-ungoverned" }), /not bound to an ACTIVE operating company/);
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
    await assert.rejects(life.readReorderQueue(deps, none), /requires reorder\.request\.read\b/);
    await assert.rejects(life.readMyAssignedReorders(deps, none), /requires reorder\.request\.read\b/);
    await assert.rejects(life.recordReorderPurchaseOrder(deps, none, { reorderRequestId: "x" }),
      /requires reorder\.request\.recordPurchaseOrder/);
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

  await t.test("recording the purchase order is the ASSIGNEE's, even for a caller holding every capability", async () => {
    const po = { reorderRequestId: rr, supplierName: "Acme", externalPoNumber: "PO-1", orderedQuantity: 4, orderedDate: "2026-03-01" };
    await assert.rejects(life.recordReorderPurchaseOrder(deps, actor(pBob), po), /assigned to may record its purchase order/);
    await assert.rejects(life.recordReorderPurchaseOrder(deps, actor(pUnlinked), po), /assigned to may record/);
    await assert.rejects(life.recordReorderPurchaseOrder(deps, actor(pManager), po), /assigned to may record/,
      "the queue scope is READ reach; it conveys no purchasing action");
    // The assignee passes the authority gate; the stub stands in for the repository's own transaction.
    let reached = 0;
    const r = await life.recordReorderPurchaseOrder({ pool, recordPurchaseOrder: async () => { reached++; return { id: "po-stub", reorderRequestId: rr, status: "ORDERED" }; } },
      actor(pAlice), po);
    assert.equal(reached, 1);
    assert.equal(r.reorderRequestId, rr);
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

  await t.test("RECEIVING IS ACTIVE (Owner ruling R2): markReorderReceived answers only with its explicit refusal", async () => {
    // ORDERED -> RECEIVED is now the governed receipt's consequence (receiveReorderStockPostgres proves the closeout).
    // The standalone operation stays callable so the refusal is explicit -- for the assignee and everyone else alike.
    assert.equal(life.RECEIVING_POSTGRES_ACTIVE, true);
    await q(`UPDATE eos_ops.reorder_requests SET status='ORDERED' WHERE id=$1`, [rr]);
    for (const who of [pAlice, pBob]) {
      await assert.rejects(life.markReorderReceived(deps, actor(who), { reorderRequestId: rr }), /closed out by receiving the stock/);
    }
    assert.equal((await q(`SELECT status::text s FROM eos_ops.reorder_requests WHERE id=$1`, [rr])).rows[0].s, "ORDERED", "nothing moved");
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

  await t.test("VOID is a MANAGEMENT EXCEPTION: capability + the PO company's queue scope, never the assignment", async () => {
    // A real Purchase Order, through the governed commands: review -> assign Alice -> start -> record.
    const v = (await create()).reorderRequestId;
    await life.reviewReorderRequest(deps, actor(pManager), { reorderRequestId: v, decision: "APPROVED" });
    await authority.assignReorderRequestToEmployee(deps, actor(pManager), { reorderRequestId: v, employeeId: "e-alice" });
    await life.startPurchasingOnReorder(deps, actor(pAlice), { reorderRequestId: v });
    const recorded = await life.recordReorderPurchaseOrder(deps, actor(pAlice), {
      reorderRequestId: v, supplierName: "Acme", externalPoNumber: "PO-V1", orderedQuantity: 4, orderedDate: "2026-03-01" });
    assert.equal(recorded.status, "ORDERED");
    const voidOf = (who, caps, voidReason = "supplier discontinued the part") =>
      life.voidReorderPurchaseOrder(deps, actor(who, caps), { reorderRequestId: v, voidReason });

    // The purchasing ASSIGNEE, holding every capability but no queue scope: refused. Assignment is not void authority.
    await assert.rejects(voidOf(pAlice, [...ALL, life.REORDER_PO_VOID]), /REORDER_QUEUE Operational Scope for this Purchase Order/);
    // Scope for a DIFFERENT company's queue: refused.
    await assert.rejects(voidOf(pBob, [...ALL, life.REORDER_PO_VOID]), /REORDER_QUEUE Operational Scope for this Purchase Order/);
    // The right scope without the capability: refused before anything else.
    await assert.rejects(voidOf(pManager, ALL), /requires reorder\.purchaseOrder\.void/);
    // A Purchase Order that does not exist is refused exactly like one out of reach.
    await assert.rejects(life.voidReorderPurchaseOrder(deps, actor(pManager, [life.REORDER_PO_VOID]), { reorderRequestId: "rr-nope", voidReason: "x" }),
      /REORDER_QUEUE Operational Scope for this Purchase Order/);
    // A reason is required.
    await assert.rejects(voidOf(pManager, [life.REORDER_PO_VOID], "   "), /voidReason must be a trimmed, non-empty string/);

    // The Parts Manager -- NOT the assignee -- with the capability and the company's queue scope: voids.
    const done = await voidOf(pManager, [life.REORDER_PO_VOID]);
    assert.deepEqual([done.status, done.voidedBy], ["VOIDED", pManager]);
    assert.equal((await q(`SELECT status::text s FROM eos_ops.reorder_requests WHERE id=$1`, [v])).rows[0].s, "VOIDED");
    const audit = (await q(`SELECT actor_uid, reason, target_kind FROM eos_policy.audit_events
                             WHERE action = 'reorder.purchaseOrder.void' AND target_id = $1`, [v])).rows;
    assert.deepEqual(audit, [{ actor_uid: pManager, reason: "supplier discontinued the part", target_kind: "purchase_order" }]);
    // Valid lifecycle state only: a second void (the request is now VOIDED) is refused, and still audited once.
    await assert.rejects(voidOf(pManager, [life.REORDER_PO_VOID]));
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.purchase_order_voids WHERE purchase_order_id=$1`, [v])).rows[0].n, 1);

    // ── THE PURCHASE ORDER READ (readReorderPurchaseOrders): same reach as readReorderRequest, for every id ──
    const pending = (await create()).reorderRequestId; // reachable, but no purchase order recorded
    const read = (who, ids, caps = ALL) => life.readReorderPurchaseOrders(deps, actor(who, caps), { reorderRequestIds: ids });
    // The queue scope reaches the request, so it reaches its purchase order AND its void record.
    const byManager = await read(pManager, [v, pending, v]);
    assert.equal(byManager.purchaseOrders.length, 1, "a reachable request with no purchase order is ABSENT, not refused");
    const po = byManager.purchaseOrders[0];
    assert.deepEqual(
      [po.id, po.reorderRequestId, po.purchaseOrderId, po.status, po.supplierName, po.externalPoNumber, po.orderedQuantity, po.orderedDate, po.expectedArrivalDate],
      [v, v, v, "ORDERED", "Acme", "PO-V1", 4, "2026-03-01", null]);
    assert.equal(po.createdBy, pAlice);
    assert.deepEqual([po.void.reorderPurchaseOrderId, po.void.reason, po.void.voidedBy], [v, "supplier discontinued the part", pManager]);
    assert.ok(po.void.createdAt && po.createdAt);
    // The assignee reaches the record assigned to her, without any queue scope.
    assert.equal((await read(pAlice, [v])).purchaseOrders[0].id, v);
    // FAIL CLOSED, WHOLE: one unreachable id refuses the read rather than vanishing from it.
    await assert.rejects(read(pAlice, [v, pending]), /neither in the caller's queue reach nor assigned/);
    await assert.rejects(read(pBob, [v]), /neither in the caller's queue reach nor assigned/);
    await assert.rejects(read(pUnlinked, [v]), /neither in the caller's queue reach nor assigned/);
    // A request that does not exist is refused exactly like one out of reach: no existence oracle.
    await assert.rejects(read(pManager, ["rr-does-not-exist"]), /neither in the caller's queue reach nor assigned/);
    // Capability first.
    await assert.rejects(read(pManager, [v], [life.REORDER_PO_VOID]), /requires reorder\.request\.read\b/);
    // A bounded, well-formed question only.
    await assert.rejects(read(pManager, []), /between 1 and 100/);
    await assert.rejects(read(pManager, Array.from({ length: 101 }, (_, k) => `rr-${k}`)), /between 1 and 100/);
    await assert.rejects(read(pManager, ["a/b"]), /between 1 and 100/);
    await assert.rejects(life.readReorderPurchaseOrders(deps, actor(pManager), { reorderRequestIds: [v], tenantId: "t2" }), /does not accept: tenantId/);
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

  await t.test("read REACH: queue scope reaches the queue; an assignment reaches only that record", async () => {
    // Alice holds reorder.request.read but NOT the REORDER_QUEUE scope: no queue, no history.
    await assert.rejects(life.readReorderQueue(deps, actor(pAlice)), /REORDER_QUEUE Operational Scope/);
    await assert.rejects(life.readMyReorderHistory(deps, actor(pAlice)), /REORDER_QUEUE Operational Scope/);
    // ...but she reaches the one record assigned to her,
    assert.equal((await life.readReorderRequest(deps, actor(pAlice), { reorderRequestId: rr })).reorderRequestId, rr);
    // and not one that is not.
    const unassigned = (await create()).reorderRequestId;
    await assert.rejects(life.readReorderRequest(deps, actor(pAlice), { reorderRequestId: unassigned }), /neither in the caller's queue reach nor assigned/);
    // The queue scope reaches any record in the queue.
    assert.equal((await life.readReorderRequest(deps, actor(pManager), { reorderRequestId: unassigned })).reorderRequestId, unassigned);
    // The scope is COMPANY-keyed: Bob's queue scope for other-co reaches none of sample-co's requests.
    assert.deepEqual(await life.readReorderQueue(deps, actor(pBob)), []);
    await assert.rejects(life.readReorderRequest(deps, actor(pBob), { reorderRequestId: unassigned }), /neither in the caller's queue reach/);
    // A missing record is refused the same way as an unreachable one: the read is no existence oracle.
    await assert.rejects(life.readReorderRequest(deps, actor(pAlice), { reorderRequestId: "rr-does-not-exist" }), /neither in the caller's queue reach/);
    // Scope without the capability is nothing.
    await assert.rejects(life.readReorderQueue(deps, actor(pManager, [])), /requires reorder\.request\.read\b/);
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

// ════════ Controller ruling 2026-09-30, Option 2(a): the ONE synthetic Taylor acceptance warehouse ════════
// Established by scripts/syntheticAcceptanceWarehouseCli.js (the governed writer, one audit event), then the whole
// synthetic lifecycle is driven against it with EXACTLY the ruled activation capability sets:
//   Parts Manager   create.manual + read + assign (held before) + approve / reject / cancel / purchaseOrder.void (ruled)
//   Parts Associate read / startPurchasing / postPurchasingUpdate / recordPurchaseOrder / markReceived (ruled)
//                   + inventory.stock.receive (held before, through inventoryReceivingClerk)
test("the synthetic Taylor acceptance warehouse (ruling 2(a)) carries the whole synthetic Reorder lifecycle", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { spawnSync } = await import("node:child_process");
  const acceptance = require("../lib/eosOps/syntheticAcceptanceWarehouse.js");
  const receiving = require("../lib/eosOps/receiveReorderStockCommand.js");
  const name = `rr_syn_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const T = "tenant-syn";
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, 'taylor-nonprod', 'synthetic acceptance proof')`, [T]);
  const principal = async (subject) => repo.transact({ tenantId: T, uid: "fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const pAdmin = await principal("uid-admin");
  const pPM = await principal("uid-parts-manager");
  const pPA = await principal("uid-parts-associate");
  const pTech = await principal("uid-technician");
  let n = 0;
  for (const [emp, p] of [["e-pm", pPM], ["e-pa", pPA], ["e-tech", pTech]]) {
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [emp, T]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
             VALUES ($1, $2, $3, $4, 'taylor', 'OPERATOR_ASSERTED', 'f', 'test', 'active')`, [`epl-${++n}`, T, p, emp]);
  }
  for (const emp of ["e-pm", "e-pa"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ($1, $2, $3, 'PARTS_OPERATIONS', now(), 'fixture')`, [`ewe-${emp}`, T, emp]);
  }
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('PART-SYN', $1, 'fixture', 'PART-SYN', 'PART-SYN', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'fixture')`, [T]);

  const cli = (...extra) => {
    const r = spawnSync(process.execPath, ["scripts/syntheticAcceptanceWarehouseCli.js", "--environment", "platform-sandbox", "--databaseUrlEnv", "SYN_DB",
      "--tenantKey", "taylor-nonprod", "--principalId", pAdmin, ...extra], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", SYN_DB: dbUrlFor(name) } });
    return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
  };
  const W = acceptance.SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId;
  const audits = async () => (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'warehouse.syntheticAcceptance.create'`)).rows[0].n;

  await t.test("the pinned identity is unmistakably synthetic and is none of the forbidden warehouses", () => {
    const w = acceptance.SYNTHETIC_ACCEPTANCE_WAREHOUSE;
    assert.deepEqual([w.warehouseId, w.operatingCompanyKey, w.status, w.provenance], ["synthetic-np-wh-taylor-acceptance", "taylor", "ACTIVE", "NATIVE"]);
    assert.match(w.name, /^SYNTHETIC .*\(fixture\)$/);
    assert.match(w.siteLabel, /not a real site/);
    assert.deepEqual([...acceptance.FORBIDDEN_WAREHOUSE_IDS], ["wh-main", "wh-north", "SC-WH-MAIN", "SC-WH-SERVICE"]);
    assert.ok(!acceptance.FORBIDDEN_WAREHOUSE_IDS.includes(w.warehouseId));
  });

  await t.test("REFUSES while `taylor` does not resolve to exactly one ACTIVE binding (never binds anything itself)", async () => {
    const r = cli("--apply");
    assert.equal(r.status, 2);
    assert.equal(r.err.code, "COMPANY_KEY_NOT_UNIQUE");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.warehouses`)).rows[0].n, 0);
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ($1, 'taylor', 'ACTIVE', 'fixture', 'f', 'f')`, [T]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1, 'taylor', 'taylor', 'ACTIVE', 'NATIVE', 'fixture', 'f', 'f')`, [T]);
    // Sample Company stays its own, unbound key -- nothing here maps it to Taylor.
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
             VALUES ('SC-WH-MAIN', $1, 'sample-co-synthetic', 'SYNTHETIC Sample Co Main Warehouse (fixture)', 'Sampleton', 'ACTIVE', 'NATIVE', 'f', 'f')`, [T]);
  });

  await t.test("dry run proves the id unused and unreferenced and writes nothing; apply creates it once with one audit event; a rerun is ALREADY_PRESENT", async () => {
    const dry = cli();
    assert.equal(dry.status, 0, JSON.stringify(dry.err));
    assert.deepEqual([dry.out.outcome, dry.out.preflight.existing, dry.out.preflight.referencingRows, dry.out.preflight.companyKeyBindings, dry.out.preflight.operatingCompanyId],
      ["DRY_RUN", "ABSENT", 0, 1, "taylor"]);
    assert.ok(dry.out.preflight.referenceColumnsChecked > 5, "every eos_* warehouse / location reference column is probed");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.warehouses WHERE id = $1`, [W])).rows[0].n, 0);
    const applied = cli("--apply");
    assert.equal(applied.status, 0, JSON.stringify(applied.err));
    assert.equal(applied.out.outcome, "CREATED");
    const row = (await q(`SELECT tenant_id, operating_company_key, name, site_label, status::text, provenance::text, created_by FROM eos_ops.warehouses WHERE id = $1`, [W])).rows;
    assert.deepEqual(row, [{ tenant_id: T, operating_company_key: "taylor", name: "SYNTHETIC Taylor Acceptance Proof Warehouse (fixture)",
      site_label: "SYNTHETIC nonprod acceptance proof -- not a real site", status: "ACTIVE", provenance: "NATIVE", created_by: pAdmin }]);
    const audit = (await q(`SELECT actor_uid, target_kind, target_id, after FROM eos_policy.audit_events WHERE action = 'warehouse.syntheticAcceptance.create'`)).rows;
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0].actor_uid, audit[0].target_kind, audit[0].target_id, audit[0].after.dataProvenance], [pAdmin, "warehouse", W, "NONPROD_SYNTHETIC_ACCEPTANCE"]);
    const again = cli("--apply");
    assert.equal(again.out.outcome, "ALREADY_PRESENT");
    assert.equal(await audits(), 1);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.bins`)).rows[0].n, 0, "no bin: receiving lands on the WAREHOUSE location");
  });

  await t.test("a pinned id occupied by a DIFFERENT record is refused, never repaired", async () => {
    await q(`UPDATE eos_ops.warehouses SET name = 'someone else' WHERE id = $1`, [W]);
    const r = cli("--apply");
    assert.equal(r.err.code, "IDENTITY_OCCUPIED");
    await q(`UPDATE eos_ops.warehouses SET name = 'SYNTHETIC Taylor Acceptance Proof Warehouse (fixture)' WHERE id = $1`, [W]);
  });

  await t.test("the Parts Associate queue scope is written through the governed command against key `taylor`", async () => {
    const scopes = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
    const entitlement = require("../lib/eosOps/conditionalEntitlement.js");
    const caps = new Set(["admin.employeeOperationalScope.write"]);
    const admin = { tenantId: T, principalId: pAdmin, capabilities: caps,
      entitlements: async () => entitlement.entitlementsFrom([...caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "admin" }, capabilityKey }))) };
    const r = await scopes.assignEmployeeOperationalScope({ pool }, admin,
      { employeeId: "e-pa", scopeType: "REORDER_QUEUE", scopeId: "taylor", reason: "ruling 2026-09-30: Parts Associate Taylor Reorder queue" });
    assert.equal(r.outcome, "ASSIGNED");
    await scopes.assignEmployeeOperationalScope({ pool }, admin,
      { employeeId: "e-pm", scopeType: "REORDER_QUEUE", scopeId: "taylor", reason: "fixture: Parts Manager Taylor Reorder queue (already held in nonprod)" });
  });

  const PM = new Set([life.REORDER_CREATE_MANUAL, life.REORDER_READ, authority.REORDER_REQUEST_ASSIGN, life.REORDER_APPROVE, life.REORDER_REJECT, life.REORDER_CANCEL, life.REORDER_PO_VOID]);
  const PA = new Set([life.REORDER_READ, life.REORDER_START_PURCHASING, life.REORDER_POST_UPDATE, life.REORDER_RECORD_PO, life.REORDER_MARK_RECEIVED, "inventory.stock.receive"]);
  const as = (principalId, caps) => ({ tenantId: T, principalId, capabilities: caps });
  const deps = { pool };
  const raise = () => life.createGovernedReorderRequest(deps, as(pPM, PM), {
    partId: "PART-SYN", warehouseId: W, requestedQuantity: 2, recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL" });
  const toOrdered = async (po) => {
    const id = (await raise()).reorderRequestId;
    await life.reviewReorderRequest(deps, as(pPM, PM), { reorderRequestId: id, decision: "APPROVED" });
    await authority.assignReorderRequestToEmployee(deps, as(pPM, PM), { reorderRequestId: id, employeeId: "e-pa" });
    await life.startPurchasingOnReorder(deps, as(pPA, PA), { reorderRequestId: id });
    await life.postPurchasingUpdate(deps, as(pPA, PA), { reorderRequestId: id, vendorContacted: true });
    const recorded = await life.recordReorderPurchaseOrder(deps, as(pPA, PA), { reorderRequestId: id, supplierName: "SYNTHETIC Supplier", externalPoNumber: po, orderedQuantity: 2, orderedDate: "2026-09-30" });
    assert.equal(recorded.status, "ORDERED");
    return id;
  };

  await t.test("create -> approve -> assign -> purchase -> PO -> RECEIVE, against the synthetic warehouse; company server-derived; lineage PO id == request id", async () => {
    const id = await toOrdered("CAC-PROOF-PO-1");
    const rr = (await q(`SELECT operating_company_key, warehouse_id, status::text s FROM eos_ops.reorder_requests WHERE id = $1`, [id])).rows[0];
    assert.deepEqual(rr, { operating_company_key: "taylor", warehouse_id: W, s: "ORDERED" });
    const po = (await q(`SELECT id, operating_company_key, part_id FROM eos_ops.purchase_orders WHERE id = $1`, [id])).rows;
    assert.deepEqual(po, [{ id, operating_company_key: "taylor", part_id: "PART-SYN" }], "the PO carries the request's id and company");
    const queue = await life.readReorderQueue(deps, as(pPA, PA), {});
    assert.ok(JSON.stringify(queue).includes(id), "the Parts Associate sees the Taylor queue");
    const receipt = await receiving.receiveReorderStock({ pool }, as(pPA, PA), {
      source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id },
      receivingLocation: { type: "WAREHOUSE", locationId: W },
      lines: [{ lineId: "L1", partId: "PART-SYN", receivedQuantity: 2 }], idempotencyKey: "CAC-PROOF-RECEIVE-1" });
    assert.ok(receipt);
    assert.equal((await q(`SELECT status::text s FROM eos_ops.reorder_requests WHERE id = $1`, [id])).rows[0].s, "RECEIVED");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1`, [T])).rows[0].n, 1);
    await assert.rejects(q(`UPDATE eos_ops.purchase_orders SET id = 'rewritten' WHERE id = $1`, [id]), "PO identity is immutable");
  });

  await t.test("Parts Manager rejects; Parts Manager voids an ORDERED PO; the Parts Associate cannot void; the technician cannot create", async () => {
    const r = (await raise()).reorderRequestId;
    const rejected = await life.reviewReorderRequest(deps, as(pPM, PM), { reorderRequestId: r, decision: "REJECTED", reviewNotes: "CAC-PROOF synthetic reject" });
    assert.equal(rejected.status, "REJECTED");
    const v = await toOrdered("CAC-PROOF-PO-2");
    await assert.rejects(life.voidReorderPurchaseOrder(deps, as(pPA, PA), { reorderRequestId: v, voidReason: "CAC-PROOF synthetic void" }), /requires reorder\.purchaseOrder\.void/);
    const voided = await life.voidReorderPurchaseOrder(deps, as(pPM, PM), { reorderRequestId: v, voidReason: "CAC-PROOF synthetic void" });
    assert.deepEqual([voided.status, voided.voidedBy], ["VOIDED", pPM]);
    await assert.rejects(life.createGovernedReorderRequest(deps, as(pTech, new Set()), {
      partId: "PART-SYN", warehouseId: W, requestedQuantity: 1, recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL" }), /requires reorder\.request\.create/);
    // Sample Company's warehouse still cannot raise a Taylor Reorder: its key is not bound, and nothing bound it.
    await assert.rejects(life.createGovernedReorderRequest(deps, as(pPM, PM), {
      partId: "PART-SYN", warehouseId: "SC-WH-MAIN", requestedQuantity: 1, recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL" }), /not bound/);
  });
  await t.test("XLF 2026-09-30: recording a PO writes exactly one audit event in its transaction; refusals and replays write none", async () => {
    const poAudits = async (id) => (await q(`SELECT actor_uid, target_kind, target_id, before, after, reason FROM eos_policy.audit_events
                                            WHERE action = 'reorder.request.recordPurchaseOrder' AND target_id = $1`, [id])).rows;
    const id = (await raise()).reorderRequestId;
    await life.reviewReorderRequest(deps, as(pPM, PM), { reorderRequestId: id, decision: "APPROVED" });
    await authority.assignReorderRequestToEmployee(deps, as(pPM, PM), { reorderRequestId: id, employeeId: "e-pa" });
    await life.startPurchasingOnReorder(deps, as(pPA, PA), { reorderRequestId: id });
    const po = { reorderRequestId: id, supplierName: "SYNTHETIC Supplier", externalPoNumber: "CAC-PROOF-PO-AUDIT", orderedQuantity: 2, orderedDate: "2026-09-30" };
    // A refused recording (not the assignee) writes nothing.
    await assert.rejects(life.recordReorderPurchaseOrder(deps, as(pPM, new Set([...PM, life.REORDER_RECORD_PO])), po), /assigned to may record/);
    assert.deepEqual(await poAudits(id), []);
    await life.recordReorderPurchaseOrder(deps, as(pPA, PA), po);
    const rows = await poAudits(id);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].actor_uid, rows[0].target_kind, rows[0].target_id, rows[0].reason], [pPA, "purchase_order", id, "purchase order recorded"]);
    assert.deepEqual(rows[0].before, { status: "PURCHASING_IN_PROGRESS" });
    assert.deepEqual(rows[0].after, { status: "ORDERED", reorderRequestId: id, purchaseOrderId: id, operatingCompanyKey: "taylor",
      warehouseId: W, partId: "PART-SYN", actorEmployeeId: "e-pa", externalPoNumber: "CAC-PROOF-PO-AUDIT", orderedQuantity: 2, orderedDate: "2026-09-30" });
    // The PO and its audit are one transaction: the audit names exactly the PO that exists.
    assert.deepEqual((await q(`SELECT id, created_by, operating_company_key FROM eos_ops.purchase_orders WHERE id = $1`, [id])).rows, [{ id, created_by: pPA, operating_company_key: "taylor" }]);
    // A replay is refused (the request is ORDERED) and adds no second audit event.
    await assert.rejects(life.recordReorderPurchaseOrder(deps, as(pPA, PA), po));
    assert.equal((await poAudits(id)).length, 1);
  });
});
