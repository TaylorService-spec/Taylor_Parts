// LEGACY REORDER PURCHASE ORDER / VOID: DRY RUN / COPY ONCE / VERIFY, against a real postgres:16.
//
// And then the proof the whole migration exists for: a Reorder that was ORDERED before the cutover,
// copied into PostgreSQL with its purchase order, can still be RECEIVED after it.
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
const copy = require("../lib/eosOps/migration/reorderPurchaseOrderMigrationCopy.js");
const plan = require("../lib/eosOps/migration/reorderPurchaseOrderMigration.js");
const receive = require("../lib/eosOps/receiveReorderStockCommand.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const UID_BUYER = "uid-legacy-buyer";
const UID_STRANGER = "uid-nobody-knows";

/** A complete, valid legacy purchase order, as the governed callable wrote them. */
const po = (id, over = {}) => ({
  id,
  data: {
    reorderRequestId: id,
    partId: "PART-LEGACY-1",
    supplierName: "Acme Supply",
    externalPoNumber: "PO-EXT-9001",
    orderedQuantity: 4,
    orderedDate: "2026-09-01",
    expectedArrivalDate: "2026-09-08",
    operatingCompanyId: "taylor",
    status: "ORDERED",
    createdBy: UID_BUYER,
    ...over,
  },
});

const voidDoc = (id, over = {}) => ({
  id,
  data: {
    reorderRequestId: id,
    reorderPurchaseOrderId: id,
    partId: "PART-LEGACY-1",
    operatingCompanyId: "taylor",
    reason: "supplier could not fulfil",
    voidedBy: UID_BUYER,
    ...over,
  },
});

test("legacy Reorder purchase order copy: completeness, resolved identity, all-or-nothing", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `po_mig_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const principal = async (subject) => repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const buyer = await principal(UID_BUYER);
  const executor = await principal("uid-executor");
  const receiver = await principal("uid-receiver");

  // THE COMPANY AND THE KEY ARE DIFFERENT VALUES ON PURPOSE. `taylor` operates under the eos_ops key
  // `sample-co`. A copy that assumed they were equal would pass with equal values and be wrong.
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f'), ('t1','ventana','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','fixture','f','f'),
                  ('t1','ventana','dormant-co','INACTIVE','NATIVE','fixture','f','f')`);

  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-1','t1','sample-co','wh-1','Sampleton','ACTIVE','NATIVE','fixture','fixture')`);
  const part = (id, controlType = "STANDARD") => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,'ACTIVE','EACH',$2,'STOCKED',false,false,false,false,1,'fixture')`,
    [id, controlType]);
  await part("PART-LEGACY-1");
  await part("PART-LEGACY-SERIAL", "SERIALIZED");

  /** A MIGRATED Reorder Request, exactly as the object copy leaves one. */
  let seq = 0;
  const migratedReorder = async (status, over = {}) => {
    const id = `rr-legacy-${++seq}`;
    await q(
      `INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id,
                                             status, requested_quantity, requested_by, updated_by, provenance)
       VALUES ($1,'t1','sample-co',$2,'wh-1',$3,$4,$5,$6,'MIGRATED')`,
      [id, over.partId ?? "PART-LEGACY-1", status, over.quantity ?? 4, buyer, executor]);
    return id;
  };

  const source = (purchaseOrders, voids = [], backLinks = null) => ({
    purchaseOrders,
    voids,
    requestBackLinks: backLinks ?? new Map(purchaseOrders.map((d) => [d.id, d.id])),
  });
  const dry = (src) => copy.dryRunPurchaseOrderMigration(pool, { tenantId: "t1", source: src });
  const run = (src, over = {}) => copy.copyPurchaseOrdersOnce(pool, {
    tenantId: "t1", source: src, performedByPrincipalId: executor, ...over,
  });
  const counts = async () => ({
    orders: (await q(`SELECT count(*)::int n FROM eos_ops.purchase_orders`)).rows[0].n,
    voids: (await q(`SELECT count(*)::int n FROM eos_ops.purchase_order_voids`)).rows[0].n,
  });

  // ════════════════════════════ DRY RUN ════════════════════════════

  await t.test("DRY RUN classifies every row and writes nothing", async () => {
    const id = await migratedReorder("ORDERED");
    const before = await counts();
    const p = await dry(source([po(id)]));
    assert.equal(p.applied, false);
    assert.equal(p.sourcePurchaseOrders, 1);
    assert.equal(p.counts.MIGRATABLE, 1);
    assert.deepEqual(await counts(), before, "a dry run writes nothing");
  });

  await t.test("the company id is RESOLVED to its key, and never used as one", async () => {
    const id = await migratedReorder("ORDERED");
    const p = await dry(source([po(id)]));
    assert.equal(p.purchaseOrders[0].disposition, "MIGRATABLE");
    assert.equal(p.purchaseOrders[0].row.operatingCompanyKey, "sample-co");
    assert.notEqual(p.purchaseOrders[0].row.operatingCompanyKey, "taylor");
  });

  await t.test("an unbound or INACTIVE-bound company is refused, not assumed equal to its key", async () => {
    for (const companyId of ["no-such-co", "ventana"]) {
      const id = await migratedReorder("ORDERED");
      const p = await dry(source([po(id, { operatingCompanyId: companyId })]));
      assert.equal(p.purchaseOrders[0].refusalCode, "COMPANY_KEY_BINDING_MISSING", companyId);
      assert.match(p.purchaseOrders[0].detail, /NOT usable as the key/);
    }
  });

  await t.test("an unresolvable recording actor is REFUSED -- never nulled, never the executor", async () => {
    // created_by is NOT NULL and carries a Principal foreign key, and it is NOT among the columns
    // ruled nullable for migrated historical unknowns. So there is no honest way to copy this row.
    const id = await migratedReorder("ORDERED");
    const p = await dry(source([po(id, { createdBy: UID_STRANGER })]));
    assert.equal(p.purchaseOrders[0].refusalCode, "ACTOR_NOT_RESOLVABLE");
    assert.match(p.purchaseOrders[0].detail, /NOT NULL and carries a Principal foreign key/);
    assert.equal(p.purchaseOrders[0].row, null, "a refused row carries no candidate to insert by accident");
  });

  await t.test("a purchase order with no Reorder Request in the SOURCE is missing evidence, not a puzzle", async () => {
    const p = await dry(source([po("rr-orphan")], [], new Map()));
    assert.equal(p.purchaseOrders[0].refusalCode, "SOURCE_REORDER_REQUEST_ABSENT");
  });

  await t.test("a purchase order whose Reorder is not in the TARGET is refused with the reason, not a foreign key error", async () => {
    const p = await dry(source([po("rr-not-copied-yet")]));
    assert.equal(p.purchaseOrders[0].refusalCode, "REORDER_REQUEST_NOT_MIGRATED");
    assert.match(p.purchaseOrders[0].detail, /copy the Reorder objects first/);
  });

  await t.test("the identity ruling is checked across all three statements of it", async () => {
    const id = await migratedReorder("ORDERED");
    // The document id and the stored reorderRequestId disagree.
    const a = await dry(source([po(id, { reorderRequestId: "something-else" })]));
    assert.equal(a.purchaseOrders[0].refusalCode, "PO_IDENTITY_MISMATCH");
    // The request's own back-link names a different order.
    const b = await dry(source([po(id)], [], new Map([[id, "a-different-order"]])));
    assert.equal(b.purchaseOrders[0].refusalCode, "PO_IDENTITY_MISMATCH");
  });

  await t.test("a price stamp that outruns its price is refused, and an unpriced order stays receivable", async () => {
    const stamped = await migratedReorder("ORDERED");
    const a = await dry(source([po(stamped, { priceAuthorityVersion: 2 })]));
    assert.equal(a.purchaseOrders[0].refusalCode, "PO_PRICE_MISSING");

    const unpriced = await migratedReorder("ORDERED");
    const b = await dry(source([po(unpriced)]));
    assert.equal(b.purchaseOrders[0].disposition, "MIGRATABLE");
    assert.equal(b.purchaseOrders[0].row.unitPriceMinor, null, "unpriced is a fact, not a defect");
  });

  // ════════════════════════════ COPY ONCE ════════════════════════════

  await t.test("COPY preserves every business fact exactly, and resolves every identity", async () => {
    const id = await migratedReorder("ORDERED");
    const result = await run(source([po(id, { unitPriceMinor: 48500, currency: "USD", priceAuthorityVersion: 2 })]));
    assert.equal(result.applied, true);
    assert.equal(result.insertedPurchaseOrders, 1);

    const { rows } = await q(`SELECT * FROM eos_ops.purchase_orders WHERE id = $1`, [id]);
    const r = rows[0];
    assert.equal(r.operating_company_key, "sample-co");
    assert.equal(r.part_id, "PART-LEGACY-1");
    assert.equal(r.supplier_name, "Acme Supply");
    assert.equal(r.external_po_number, "PO-EXT-9001");
    assert.equal(r.ordered_quantity, 4);
    assert.equal(r.ordered_date.toISOString().slice(0, 10), "2026-09-01");
    assert.equal(r.expected_arrival_date.toISOString().slice(0, 10), "2026-09-08");
    assert.equal(Number(r.unit_price_minor), 48500);
    assert.equal(r.currency, "USD");
    assert.equal(r.price_authority_version, 2);
    // THE RESOLVED PRINCIPAL, never the Firebase uid and never the executor.
    assert.equal(r.created_by, buyer);
    assert.notEqual(r.created_by, UID_BUYER);
    assert.notEqual(r.created_by, executor);
  });

  await t.test("a re-run is ALREADY_PRESENT and inserts nothing", async () => {
    const id = await migratedReorder("ORDERED");
    await run(source([po(id)]));
    const before = await counts();
    const again = await run(source([po(id)]));
    assert.equal(again.applied, false);
    assert.equal(again.refusal, "nothing to copy");
    assert.equal(again.plan.counts.ALREADY_PRESENT, 1);
    assert.deepEqual(await counts(), before, "a copy never overwrites a governed record");
  });

  await t.test("a target id carrying DIFFERENT business facts is a hard blocker, never a quiet skip", async () => {
    const id = await migratedReorder("ORDERED");
    await run(source([po(id)]));
    const before = await counts();
    const conflicting = await run(source([po(id, { orderedQuantity: 99 })]));
    assert.equal(conflicting.applied, false);
    assert.equal(conflicting.plan.purchaseOrders[0].refusalCode, "TARGET_CONFLICT");
    assert.match(conflicting.plan.purchaseOrders[0].detail, /orderedQuantity: target=4 source=99/);
    assert.deepEqual(await counts(), before);
  });

  await t.test("ONE refusal stops the WHOLE copy -- there is no partial migration", async () => {
    const good = await migratedReorder("ORDERED");
    const bad = await migratedReorder("ORDERED");
    const before = await counts();
    const result = await run(source([po(good), po(bad, { createdBy: UID_STRANGER })]));
    assert.equal(result.applied, false);
    assert.match(result.refusal, /a partial copy would leave some purchases answered by PostgreSQL/);
    assert.deepEqual(await counts(), before, "the acceptable row was NOT copied either");
  });

  await t.test("an executor who is not an active Principal of this tenant copies nothing", async () => {
    const id = await migratedReorder("ORDERED");
    const before = await counts();
    const result = await run(source([po(id)]), { performedByPrincipalId: "prn-not-a-member" });
    assert.equal(result.applied, false);
    assert.match(result.refusal, /not an active Principal/);
    assert.deepEqual(await counts(), before);
  });

  await t.test("the audit records the EXECUTOR, and the copy records the buyer", async () => {
    const id = await migratedReorder("ORDERED");
    await run(source([po(id)]));
    const { rows } = await q(
      `SELECT actor_uid, target_kind, after FROM eos_policy.audit_events WHERE action = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [copy.PURCHASE_ORDER_COPY_ACTION]);
    assert.equal(rows[0].actor_uid, executor);
    assert.equal(rows[0].target_kind, "reorder_purchase_order_migration");
    assert.ok(rows[0].after.insertedPurchaseOrders >= 1);
  });

  // ════════════════════════════ VOIDS ════════════════════════════

  await t.test("a VOIDED Reorder keeps its purchase order AND the evidence of why", async () => {
    const id = await migratedReorder("ORDERED");
    await q(`UPDATE eos_ops.reorder_requests SET status='VOIDED' WHERE id=$1`, [id]);
    const result = await run(source([po(id, { status: "VOIDED" })], [voidDoc(id)]));
    assert.equal(result.applied, true);
    assert.equal(result.insertedPurchaseOrders, 1);
    assert.equal(result.insertedVoids, 1);

    const { rows } = await q(`SELECT * FROM eos_ops.purchase_order_voids WHERE purchase_order_id = $1`, [id]);
    assert.equal(rows[0].operating_company_key, "sample-co");
    assert.equal(rows[0].part_id, "PART-LEGACY-1");
    assert.equal(rows[0].reason, "supplier could not fulfil");
    assert.equal(rows[0].voided_by, buyer);
  });

  await t.test("a void with no purchase order records nothing, and is refused", async () => {
    const p = await dry(source([], [voidDoc("rr-no-order")]));
    assert.equal(p.voids[0].refusalCode, "VOID_WITHOUT_PURCHASE_ORDER");
  });

  await t.test("a void already in the target is ALREADY_PRESENT -- append-only is never amended", async () => {
    const id = await migratedReorder("ORDERED");
    await q(`UPDATE eos_ops.reorder_requests SET status='VOIDED' WHERE id=$1`, [id]);
    await run(source([po(id)], [voidDoc(id)]));
    const again = await dry(source([po(id)], [voidDoc(id, { reason: "a different reason entirely" })]));
    assert.equal(again.voids[0].disposition, "ALREADY_PRESENT");
    const { rows } = await q(`SELECT reason FROM eos_ops.purchase_order_voids WHERE purchase_order_id = $1`, [id]);
    assert.equal(rows[0].reason, "supplier could not fulfil", "the committed void is untouched");
  });

  // ════════════════════════════ ACTIVATION COMPLETENESS ════════════════════════════

  await t.test("an ORDERED Reorder with no purchase order is reported as UNRECEIVABLE after cutover", async () => {
    const stranded = await migratedReorder("ORDERED");
    const p = await dry(source([]));
    const finding = p.incompleteAfterCopy.find((x) => x.reorderRequestId === stranded);
    assert.ok(finding, "the plan must notice a Reorder that would be stranded");
    assert.match(finding.missing, /cannot be received after cutover/);

    const verified = await copy.verifyPurchaseOrderMigration(pool, "t1");
    assert.equal(verified.passed, false);
    assert.ok(verified.findings.some((f) => f.code === "LIFECYCLE_INCOMPLETE"));
    assert.ok(verified.incompleteLifecycles.some((x) => x.reorderRequestId === stranded));

    // And the status is NEVER used to invent the order it is missing.
    const { rows } = await q(`SELECT count(*)::int n FROM eos_ops.purchase_orders WHERE id = $1`, [stranded]);
    assert.equal(rows[0].n, 0);
  });

  await t.test("VERIFY names EXACTLY the Reorders that are stranded, and no others", async () => {
    // This tenant deliberately carries the wreckage of every refusal above: Reorders whose purchase
    // order was refused for a bad company, an unresolvable buyer, a price stamp with no price. Each
    // is genuinely stranded, and VERIFY must name all of them and nothing else -- a copied Reorder
    // appearing here would mean the completeness check cannot tell the two apart.
    const expected = (await q(
      `SELECT r.id FROM eos_ops.reorder_requests r
         LEFT JOIN eos_ops.purchase_orders p ON p.id = r.id AND p.tenant_id = r.tenant_id
        WHERE r.tenant_id = 't1' AND r.status::text IN ('ORDERED','VOIDED','RECEIVED') AND p.id IS NULL
        ORDER BY r.id`)).rows.map((x) => x.id);
    const verified = await copy.verifyPurchaseOrderMigration(pool, "t1");
    assert.equal(verified.passed, false, "a tenant with stranded Reorders does not pass");
    assert.deepEqual(verified.incompleteLifecycles.map((x) => x.reorderRequestId).sort(), expected.sort());
    assert.ok(verified.incompleteLifecycles.every((x) => /cannot be received after cutover|cannot be explained after cutover/.test(x.missing)));
    assert.deepEqual(verified.uidShapedColumns, [], "no purchasing column can hold an external subject");
  });

  await t.test("VERIFY passes for a tenant whose purchasing lineage is complete", async () => {
    // A SEPARATE tenant, because "passes" is only meaningful against a world with nothing stranded
    // in it -- and t1 exists to hold the refusals.
    await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t2','t2','T2')`);
    const t2Buyer = await repo.transact({ tenantId: "t2", uid: "uid-fixture" }, async (tx) => {
      const pr = await tx.createPrincipal({ externalSubject: "uid-t2-buyer", identityProvider: "firebase" });
      await tx.createTenantMembership(pr.id);
      return pr.id;
    });
    const t2Executor = await repo.transact({ tenantId: "t2", uid: "uid-fixture" }, async (tx) => {
      const pr = await tx.createPrincipal({ externalSubject: "uid-t2-exec", identityProvider: "firebase" });
      await tx.createTenantMembership(pr.id);
      return pr.id;
    });
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ('t2','taylor','ACTIVE','fixture','f','f')`);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys
               (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ('t2','taylor','t2-co','ACTIVE','NATIVE','fixture','f','f')`);
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
             VALUES ('t2-wh','t2','t2-co','t2-wh','Elsewhere','ACTIVE','NATIVE','fixture','fixture')`);
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                        control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                        whole_unit, version, updated_by)
             VALUES ('PART-LEGACY-1','t2','fixture','PART-LEGACY-1','PART-LEGACY-1','ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`);
    await q(`INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id,
                                                   status, requested_quantity, requested_by, updated_by, provenance)
             VALUES ('rr-t2-1','t2','t2-co','PART-LEGACY-1','t2-wh','ORDERED',4,$1,$1,'MIGRATED')`, [t2Buyer]);

    const result = await copy.copyPurchaseOrdersOnce(pool, {
      tenantId: "t2",
      source: source([po("rr-t2-1", { createdBy: "uid-t2-buyer" })]),
      performedByPrincipalId: t2Executor,
    });
    assert.equal(result.applied, true);
    assert.deepEqual(result.plan.incompleteAfterCopy, [], "nothing is stranded once the order is copied");

    const verified = await copy.verifyPurchaseOrderMigration(pool, "t2");
    assert.deepEqual(verified.findings, [], "no findings when every lifecycle has its evidence");
    assert.equal(verified.passed, true);
    assert.equal(verified.purchaseOrders, 1);
  });

  // ════════════════════════════ THE PROOF THE MIGRATION EXISTS FOR ════════════════════════════

  await t.test("a MIGRATED, pre-cutover ORDERED Reorder can still be RECEIVED after cutover", async () => {
    // The starting condition is deliberately NOT a PostgreSQL-native Reorder: the Reorder row is
    // provenance MIGRATED, and its purchase order arrived through the copy above rather than through
    // recordReorderPurchaseOrder. This is the record that existed before the cutover.
    const id = await migratedReorder("ORDERED");
    const result = await run(source([po(id, { unitPriceMinor: 1250, currency: "USD", priceAuthorityVersion: 2 })]));
    assert.equal(result.applied, true);

    const provenance = await q(`SELECT provenance::text AS p FROM eos_ops.reorder_requests WHERE id = $1`, [id]);
    assert.equal(provenance.rows[0].p, "MIGRATED", "the starting condition is a migrated record, not a native one");

    const at = new Date("2026-09-20T15:00:00.000Z");
    const out = await receive.receiveReorderStock(
      { pool, now: () => at },
      { tenantId: "t1", principalId: receiver, capabilities: new Set(["inventory.stock.receive"]) },
      {
        source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id },
        receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" },
        lines: [{ lineId: "L1", partId: "PART-LEGACY-1", receivedQuantity: 4 }],
        idempotencyKey: `idem-migrated-${id}`,
      },
    );
    assert.equal(out.outcome, "applied");

    // EVERY effect, committed together.
    assert.equal(out.movementIds.length, 1);
    assert.equal(out.acquisitionCostIds.length, 1);
    assert.match(out.receivingOrderNumber, /^RO-2026-[0-9]{6,}$/);
    assert.equal(out.reorderStatus, "RECEIVED");

    const receipt = await q(`SELECT received_at, status::text AS s FROM eos_ops.receiving_orders WHERE id = $1`, [out.receivingId]);
    assert.equal(receipt.rows[0].s, "PUTAWAY_COMPLETE");
    assert.equal(receipt.rows[0].received_at.toISOString(), at.toISOString());

    const line = await q(`SELECT part_id, received_quantity FROM eos_ops.receiving_order_lines WHERE receiving_order_id = $1`, [out.receivingId]);
    assert.equal(line.rows.length, 1);
    assert.equal(line.rows[0].received_quantity, 4);

    const movement = await q(
      `SELECT movement_type::text AS t, quantity_delta, occurred_at, operating_company_key
         FROM eos_ops.inventory_movements WHERE source_id = $1`, [out.receivingId]);
    assert.equal(movement.rows[0].t, "RECEIVED");
    assert.equal(movement.rows[0].quantity_delta, 4);
    assert.equal(movement.rows[0].operating_company_key, "sample-co");
    assert.equal(movement.rows[0].occurred_at.toISOString(), at.toISOString());

    const cost = await q(`SELECT * FROM eos_finance.inventory_acquisition_costs WHERE receiving_id = $1`, [out.receivingId]);
    assert.equal(cost.rows[0].operating_company_id, "taylor", "the FINANCIAL company id, resolved from the operational key");
    assert.equal(Number(cost.rows[0].extended_cost_minor), 1250 * 4);
    assert.equal(cost.rows[0].received_at.toISOString(), at.toISOString());

    const reorder = await q(`SELECT status::text AS s, received_at, received_by_principal_id FROM eos_ops.reorder_requests WHERE id = $1`, [id]);
    assert.equal(reorder.rows[0].s, "RECEIVED");
    assert.equal(reorder.rows[0].received_at.toISOString(), at.toISOString());
    assert.equal(reorder.rows[0].received_by_principal_id, receiver);

    const audit = await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE target_id = $1`, [out.receivingId]);
    assert.equal(audit.rows[0].n, 1, "the audit is committed by the same transaction");
  });

  await t.test("a MIGRATED SERIAL Reorder receives one movement per unit and activates custody", async () => {
    const id = await migratedReorder("ORDERED", { partId: "PART-LEGACY-SERIAL", quantity: 2 });
    await run(source([po(id, { partId: "PART-LEGACY-SERIAL", orderedQuantity: 2, externalPoNumber: "PO-EXT-9002" })]));

    const out = await receive.receiveReorderStock(
      { pool, now: () => new Date("2026-09-20T16:00:00.000Z") },
      { tenantId: "t1", principalId: receiver, capabilities: new Set(["inventory.stock.receive"]) },
      {
        source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id },
        receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" },
        lines: [{ lineId: "L1", partId: "PART-LEGACY-SERIAL", receivedQuantity: 2, serialNumbers: ["LSN-1", "LSN-2"] }],
        idempotencyKey: `idem-migrated-serial-${id}`,
      },
    );
    assert.equal(out.movementIds.length, 2, "one movement per physical unit");
    assert.equal(out.serializedCustodyIds.length, 2);
    assert.deepEqual(out.acquisitionCostIds, [], "an unpriced legacy order records no cost, and no zero");

    const custody = await q(
      `SELECT serial_number, status::text AS s FROM eos_ops.serialized_custody WHERE part_id = 'PART-LEGACY-SERIAL' ORDER BY 1`);
    assert.deepEqual(custody.rows.map((r) => r.serial_number), ["LSN-1", "LSN-2"]);
    assert.ok(custody.rows.every((r) => r.s === "AVAILABLE"));
  });
});

// ════════════════════════════ NO DATABASE NEEDED ════════════════════════════

test("the purchase-order migration adds no second mapper", () => {
  // The field-level contract has exactly one home. This module resolves what a mapper cannot know --
  // bindings, Principals, what the target already holds -- and nothing else.
  assert.deepEqual([...plan.PO_DISPOSITIONS], ["MIGRATABLE", "ALREADY_PRESENT", "REFUSED"]);
  assert.deepEqual([...plan.STATUSES_REQUIRING_PURCHASE_ORDER], ["ORDERED", "VOIDED", "RECEIVED"]);
  assert.ok(plan.PO_MIGRATION_REFUSAL_CODES.includes("TARGET_CONFLICT"));
  assert.ok(plan.PO_MIGRATION_REFUSAL_CODES.includes("SOURCE_REORDER_REQUEST_ABSENT"));
});
