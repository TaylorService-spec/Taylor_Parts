// FINANCE ACTIVATION 1 -- PURCHASE ORDER -> RECEIPT -> ACQUISITION-COST EVIDENCE -> FINANCIAL FACT (Controller, 2026-10-01;
// DECISIONS #145, #190, #191). Over the REAL governed Reorder purchasing path and the receipt command on the Operations
// transport: the receipt's Finance consequence commits in the receipt's own transaction, exactly once, owned by the
// purchasing transaction's governed operating company; an unpriced receipt is a COST_EVIDENCE_MISSING exception (never
// zero, never blocked); no caller can manufacture a fact; durable evidence is deterministically re-projectable.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const http = require("../lib/eosOps/eosOpsHttp.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-finpur";
const INV = "/operations/inventory";
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

test("15 / 22. static: only the receipt command composes the Finance writer; no transport names a Finance-fact operation; no Firebase", () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const importers = walk(SRC).filter((f) => f.endsWith(".ts") && !f.includes(`${join("eosFinance", "")}`))
    .filter((f) => /eosFinance\/financeFoundation/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length + 1).split("\\").join("/")).sort();
  assert.deepEqual(importers, ["eosOps/costEvidenceSupplyCommand.ts", "eosOps/receiptCorrectionCommand.ts", "eosOps/receiveReorderStockCommand.ts", "eosOps/workOrderScheduling.ts"],
    "the Finance writer is reached only as a server-side consequence: the receipt, its governed correction (#193), and the Work Order completion's billing package (#196)");
  const ops = [...http.OPERATIONS_READ_OPERATIONS, ...http.OPERATIONS_MUTATION_OPERATIONS];
  assert.equal(ops.some((o) => /financ|fact|obligation|counterpart|acquisitionCost/i.test(o)), false, "no Operations operation manufactures Finance truth");
  assert.equal(/firebase/i.test(readFileSync(join(SRC, "eosFinance/financeFoundation.ts"), "utf8").replace(/no Firebase[^\n]*/gi, "")), false);
  // The ONE governed receipt correction (DECISIONS #193) originates in Operations; no accounting-only correction exists.
  assert.deepEqual(ops.filter((o) => /receipt/i.test(o) && /correct|void|cancel|reverse/i.test(o)), ["correctReorderReceipt"]);
});

test("Finance Activation 1 over the governed purchasing / receiving path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, repo, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "finpur" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const inv = (who, operation, input) => call(who, INV, operation, input);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const grant = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "nonprod Reorder authority as measured" });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 200)}`);
  };
  for (const key of ["reorder.request.approve", "reorder.request.assign", "reorder.request.read"]) await grant("partsManager", key);
  for (const key of ["reorder.request.create.manual", "reorder.request.markReceived", "reorder.request.postPurchasingUpdate", "reorder.request.read",
    "reorder.request.recordPurchaseOrder", "reorder.request.startPurchasing"]) await grant("partsAssociate", key);

  const pa = await person("uid-pa", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Pat Parts" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Morgan Parts-Manager" });
  // SHARED PHYSICAL FACILITY, DISTINCT OWNERSHIP (#190 §5): two governed warehouses, one building, two companies.
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-shared-t',$1,'taylor','Shared Building -- Taylor stock','Shared Building','ACTIVE','NATIVE','fixture','fixture'),
                  ('wh-shared-v',$1,'ventana','Shared Building -- Ventana stock','Shared Building','ACTIVE','NATIVE','fixture','fixture')`, [TENANT]);
  for (const e of ["e-pa", "e-pm"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ($1,$2,$3,$4,now(),'fixture')`, [`ewe-${e}`, TENANT, e, authority.REORDER_ASSIGNMENT_QUALIFICATION]);
    for (const [kind, id] of [["REORDER_QUEUE", "taylor"], ["REORDER_QUEUE", "ventana"], ["WAREHOUSE", "wh-shared-t"], ["WAREHOUSE", "wh-shared-v"]]) {
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
               VALUES ($1,$2,$3,$4,$5,now(),'fixture')`, [`os-${e}-${kind}-${id}`, TENANT, e, kind, id]);
    }
  }
  for (const p of ["PRT-FAN", "PRT-ICE", "PRT-BELT"]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [p, TENANT]);
  }
  // The governed supplier every new PO names (DECISIONS #193). Deliberately NOT linked to a CRM organization here.
  await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
           VALUES ($1,'SUP-DESERT','Desert Refrigeration Supply','desert refrigeration supply','ACTIVE',1,'fixture','fixture')`, [TENANT]);

  let n = 0;
  const purchased = async ({ partId, warehouseId, qty = 4, unitPriceMinor, currency }) => {
    const rr = ok(await inv(pa, "createReorderRequest", { partId, warehouseId, requestedQuantity: qty, recommendationStatus: "BELOW_MIN",
      quantitySource: "MANUAL", idempotencyKey: `rr-${++n}` }), "create").reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED" }), "approve");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: rr }), "start");
    ok(await inv(pa, "recordReorderPurchaseOrder", { reorderRequestId: rr, supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-DESERT" }, externalPoNumber: `PO-${n}`,
      orderedQuantity: qty, orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08",
      ...(unitPriceMinor !== undefined ? { unitPriceMinor, currency } : {}) }), "PO");
    return rr;
  };
  const receive = (rr, partId, warehouseId, qty = 4) => inv(pa, "receiveReorderStock", { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rr, purchaseOrderId: rr },
    receivingLocation: { type: "WAREHOUSE", locationId: warehouseId }, lines: [{ lineId: "L1", partId, receivedQuantity: qty }], idempotencyKey: `rcv-${rr}` });
  const factsFor = (receivingId) => q(`SELECT * FROM eos_finance.financial_facts WHERE tenant_id = $1 AND source_record_id = $2`, [TENANT, receivingId]);

  let taylorReceipt, taylorRr;
  await t.test("1-6 / 16 / 20. UAT-FIN-PUR-001: a Taylor priced receipt produces its evidence and exactly one Finance fact, with full provenance", async () => {
    taylorRr = await purchased({ partId: "PRT-FAN", warehouseId: "wh-shared-t", qty: 4, unitPriceMinor: 4100, currency: "USD" });
    const r = ok(await receive(taylorRr, "PRT-FAN", "wh-shared-t"), "receive");
    taylorReceipt = r.receivingId;
    assert.equal(r.outcome, "applied");
    const evidence = (await q(`SELECT * FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, taylorReceipt])).rows;
    assert.equal(evidence.length, 1, "the existing acquisition-cost authority wrote its evidence (unchanged)");
    const facts = (await factsFor(taylorReceipt)).rows;
    assert.equal(facts.length, 1, "exactly one Finance fact");
    const f = facts[0];
    assert.deepEqual([f.fact_class, f.fact_type, f.operating_company_id, f.amount_minor, f.currency, f.basis, f.source_domain, f.source_line, f.correlation_id, f.idempotency_key],
      ["COST_EVIDENCE", "ACQUISITION_COST", "taylor", String(4 * 4100), "USD", "PURCHASE_ORDER_LINE_PRICE", "RECEIVING", "L1", taylorRr, `acq:${evidence[0].id}`]);
    assert.equal(String(f.amount_minor), String(evidence[0].extended_cost_minor), "the amount IS the governed evidence's amount");
    assert.equal(new Date(f.effective_at).toISOString(), new Date(evidence[0].received_at).toISOString(), "effective at the receipt's business time");
    assert.equal(f.created_by, pa.principalId, "audited as the receiver's server-side consequence");
    assert.equal(f.counterparty_id, null, "the governed supplier is not linked to a CRM organization, so the counterparty stays unresolved -- never guessed");
    // 16. the receiver holds no Finance write authority at all.
    const caps = (await q(`SELECT DISTINCT c.key FROM eos_policy.user_role_assignments a JOIN eos_policy.role_capabilities rc ON rc.tenant_id=a.tenant_id AND rc.role_id=a.role_id
        JOIN eos_policy.capabilities c ON c.id=rc.capability_id WHERE a.tenant_id=$1 AND a.principal_id=$2 AND a.status='active' AND c.key LIKE 'finance.%'`, [TENANT, pa.principalId])).rows.map((x) => x.key);
    assert.equal(caps.some((k) => /issue|apply|record|adjust|refund/.test(k)), false, `no Finance write capability: ${caps.join(",")}`);
    // 20. ANALYSIS PROVENANCE: fact -> evidence -> receipt line -> receipt -> PO -> supplier (name) -> company, + Part, qty, unit price, location.
    const trace = await one(`SELECT f.id AS fact, e.id AS evidence, l.line_id, r.id AS receipt, po.id AS po, po.supplier_name, e.supplier_name AS evidence_supplier,
        f.operating_company_id, k.operating_company_key AS po_key, l.part_id, e.received_quantity, e.unit_price_minor, e.receiving_location_type, e.receiving_location_id
        FROM eos_finance.financial_facts f
        JOIN eos_finance.inventory_acquisition_costs e ON e.tenant_id = f.tenant_id AND f.idempotency_key = 'acq:' || e.id
        JOIN eos_ops.receiving_orders r ON r.tenant_id = f.tenant_id AND r.id = f.source_record_id
        JOIN eos_ops.receiving_order_lines l ON l.tenant_id = r.tenant_id AND l.receiving_order_id = r.id AND l.line_id = f.source_line
        JOIN eos_ops.purchase_orders po ON po.tenant_id = r.tenant_id AND po.id = r.source_purchase_order_id
        JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = f.tenant_id AND k.operating_company_id = f.operating_company_id AND k.status = 'ACTIVE'
       WHERE f.tenant_id = $1 AND f.id = $2`, [TENANT, f.id]);
    assert.deepEqual([trace.receipt, trace.po, trace.supplier_name, trace.evidence_supplier, trace.po_key, trace.part_id, trace.received_quantity, trace.unit_price_minor, trace.receiving_location_id],
      [taylorReceipt, taylorRr, "Desert Refrigeration Supply", "Desert Refrigeration Supply", "taylor", "PRT-FAN", 4, "4100", "wh-shared-t"]);
  });

  await t.test("3-4. UAT-FIN-PUR-004: replaying the same receipt returns it and duplicates neither evidence nor fact", async () => {
    const before = [await count(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1`, [TENANT]),
      await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1`, [TENANT])];
    const r = ok(await receive(taylorRr, "PRT-FAN", "wh-shared-t"), "replay");
    assert.deepEqual([r.outcome, r.receivingId], ["replayed", taylorReceipt]);
    assert.deepEqual([await count(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1`, [TENANT]),
      await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1`, [TENANT])], before);
    // Re-projecting the same receipt explicitly is also a no-op.
    const p = await fin.projectReceiptAcquisitionCost(pool, { tenantId: TENANT, principalId: "ops" }, { receivingId: taylorReceipt });
    assert.equal(p.facts[0].outcome, "replayed");
  });

  await t.test("21 / 7. UAT-FIN-PUR-002 + 008: a Ventana priced receipt in the SAME building is Ventana's fact; Taylor's stays Taylor's", async () => {
    const rr = await purchased({ partId: "PRT-ICE", warehouseId: "wh-shared-v", qty: 3, unitPriceMinor: 125000, currency: "USD" });
    const r = ok(await receive(rr, "PRT-ICE", "wh-shared-v", 3), "receive ventana");
    const f = (await factsFor(r.receivingId)).rows[0];
    assert.deepEqual([f.operating_company_id, f.amount_minor], ["ventana", String(3 * 125000)]);
    assert.equal((await factsFor(taylorReceipt)).rows[0].operating_company_id, "taylor");
    const sites = (await q(`SELECT DISTINCT site_label FROM eos_ops.warehouses WHERE tenant_id=$1 AND id IN ('wh-shared-t','wh-shared-v')`, [TENANT])).rows;
    assert.equal(sites.length, 1, "one physical building, two owners -- ownership never follows the building");
  });

  await t.test("12-14. UAT-FIN-PUR-003: an unpriced receipt succeeds and is a COST_EVIDENCE_MISSING exception -- never a zero-cost fact", async () => {
    const rr = await purchased({ partId: "PRT-BELT", warehouseId: "wh-shared-t", qty: 5 });
    const r = ok(await receive(rr, "PRT-BELT", "wh-shared-t", 5), "unpriced receive is not blocked");
    assert.equal(r.outcome, "applied");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, r.receivingId]), 0);
    assert.equal((await factsFor(r.receivingId)).rows.length, 0, "no Finance fact for unknown cost");
    assert.deepEqual((await q(`SELECT condition, operating_company_id, part_id, received_quantity, purchase_order_id FROM eos_finance.cost_evidence_exceptions
        WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, r.receivingId])).rows,
      [{ condition: "COST_EVIDENCE_MISSING", operating_company_id: "taylor", part_id: "PRT-BELT", received_quantity: 5, purchase_order_id: rr }]);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND amount_minor = 0`, [TENANT]), 0);
    // The stock arrived regardless (the operational receipt is the authority).
    assert.equal(await count(`SELECT COALESCE(SUM(quantity_delta),0)::int n FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND part_id='PRT-BELT'`, [TENANT]), 5);
  });

  await t.test("15 / 17. UAT-FIN-PUR-005: no caller can manufacture a Finance fact; facts are append-only", async () => {
    const r = await inv(pa, "recordFinancialFact", { amountMinor: 1 });
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(r.body.code, "UNKNOWN_OPERATION");
    const f = (await factsFor(taylorReceipt)).rows[0];
    await assert.rejects(q(`UPDATE eos_finance.financial_facts SET amount_minor = 1 WHERE tenant_id=$1 AND id=$2`, [TENANT, f.id]));
    await assert.rejects(q(`DELETE FROM eos_finance.financial_facts WHERE tenant_id=$1 AND id=$2`, [TENANT, f.id]));
  });

  // Durable source state that has not produced its consequence: a receipt recorded BEFORE this activation.
  const legacyReceipt = async (id, { company = "taylor", key = "taylor", price = 4100, supplierId = null, location = "wh-shared-t" } = {}) => {
    await q(`INSERT INTO eos_ops.receiving_orders (id, tenant_id, operating_company_key, source_kind, source_purchase_order_id, receiving_location_type,
               receiving_location_id, status, idempotency_key, received_at, created_by, updated_by)
             VALUES ($1,$2,$3,'PURCHASE_ORDER',$4,'WAREHOUSE',$5,'CHECKED_IN',$1,'2026-09-30T09:00:00Z','fixture','fixture')`, [id, TENANT, key, `po-${id}`, location]);
    await q(`INSERT INTO eos_ops.receiving_order_lines (id, tenant_id, receiving_order_id, line_id, part_id, tracking_mode, expected_quantity, received_quantity)
             VALUES ($1,$2,$3,'L1','PRT-FAN','NONE',2,2)`, [`${id}-L1`, TENANT, id]);
    if (price !== null) {
      await q(`INSERT INTO eos_finance.inventory_acquisition_costs (id, tenant_id, cost_basis, operating_company_id, purchase_order_id, purchase_order_line_id,
                 purchase_order_source_type, supplier_id, supplier_name, part_id, received_quantity, unit_price_minor, extended_cost_minor, currency,
                 receiving_id, receiving_line_id, received_at, receiving_location_type, receiving_location_id, created_by)
               VALUES ($1,$2,'PURCHASE_ORDER_LINE_PRICE',$3,$4,'L1','PURCHASE_ORDER',$5,'Acme Supply','PRT-FAN',2,$6,$7,'USD',$8,'L1','2026-09-30T09:00:00Z','WAREHOUSE',$9,'fixture')`,
        [`acq-${id}`, TENANT, company, `po-${id}`, supplierId, price, price * 2, id, location]);
    }
  };

  await t.test("19. deterministic recovery: durable evidence without its consequence is re-projected, idempotently", async () => {
    await legacyReceipt("rcv-pre-1");
    await legacyReceipt("rcv-pre-2", { price: null });
    const first = await fin.recoverReceiptFinancialConsequences(pool, { tenantId: TENANT, principalId: "finance-recovery" });
    assert.deepEqual([first.receiptsProjected, first.factsRecorded, first.missingCostEvidence], [["rcv-pre-1", "rcv-pre-2"], 1, 1]);
    const again = await fin.recoverReceiptFinancialConsequences(pool, { tenantId: TENANT, principalId: "finance-recovery" });
    assert.deepEqual([again.receiptsProjected, again.factsRecorded], [[], 0], "nothing left to recover; nothing duplicated");
    assert.equal((await factsFor("rcv-pre-1")).rows.length, 1);
  });

  await t.test("7 / 8 / 9. company follows the governed transaction, never the location; unresolvable / CONSOLIDATED fail closed", async () => {
    // Evidence frozen as Ventana's (the purchasing transaction) while the stock sits in Taylor's warehouse: the fact is Ventana's.
    await legacyReceipt("rcv-where-not-whose", { company: "ventana", key: "ventana", location: "wh-shared-t" });
    await fin.projectReceiptAcquisitionCost(pool, { tenantId: TENANT, principalId: "ops" }, { receivingId: "rcv-where-not-whose" });
    assert.equal((await factsFor("rcv-where-not-whose")).rows[0].operating_company_id, "ventana");
    // UAT-FIN-PUR-006: an unbound company key (unpriced line resolves through the receipt's key) fails closed -- nothing written.
    await legacyReceipt("rcv-unbound", { key: "nobody-co", price: null });
    await assert.rejects(fin.projectReceiptAcquisitionCost(pool, { tenantId: TENANT, principalId: "ops" }, { receivingId: "rcv-unbound" }),
      (e) => e.code === "OPERATING_COMPANY_UNRESOLVED");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.cost_evidence_exceptions WHERE tenant_id=$1 AND receiving_id='rcv-unbound'`, [TENANT]), 0);
    await legacyReceipt("rcv-cons", { company: "consolidated", key: "taylor" });
    await assert.rejects(fin.projectReceiptAcquisitionCost(pool, { tenantId: TENANT, principalId: "ops" }, { receivingId: "rcv-cons" }),
      (e) => e.code === "CONSOLIDATED_NOT_A_COMPANY");
    // Clear the deliberately-broken fixtures so later recovery sweeps only see governable receipts.
    for (const id of ["rcv-unbound", "rcv-cons"]) {
      await q(`DELETE FROM eos_ops.receiving_order_lines WHERE tenant_id=$1 AND receiving_order_id=$2`, [TENANT, id]);
      await q(`UPDATE eos_ops.receiving_orders SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2`, [TENANT, id]);
    }
  });

  await t.test("10-11. an external supplier governed onto its organization resolves to ONE counterparty -- never duplicated", async () => {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-acme',$1,'Acme Supply','ACTIVE','fixture','fixture')`, [TENANT]);
    await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-acme','VENDOR')`, [TENANT]);
    await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
             VALUES ($1,'SUP-ACME','Acme Supply','acme supply','ACTIVE',1,'fixture','fixture')`, [TENANT]);
    await fin.linkSupplierToOrganization(pool, { tenantId: TENANT, principalId: "ops" }, { supplierId: "SUP-ACME", crmAccountId: "acct-acme" });
    await legacyReceipt("rcv-acme-1", { supplierId: "SUP-ACME" });
    await legacyReceipt("rcv-acme-2", { supplierId: "SUP-ACME" });
    await fin.recoverReceiptFinancialConsequences(pool, { tenantId: TENANT, principalId: "ops" });
    const cps = (await q(`SELECT DISTINCT counterparty_id FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id IN ('rcv-acme-1','rcv-acme-2')`, [TENANT])).rows;
    assert.equal(cps.length, 1);
    const cp = await fin.readCounterparty(pool, TENANT, cps[0].counterparty_id);
    assert.deepEqual([cp.kind, cp.crmAccountId], ["EXTERNAL_ORGANIZATION", "acct-acme"]);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_counterparties WHERE tenant_id=$1 AND crm_account_id='acct-acme'`, [TENANT]), 1);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_crm.accounts WHERE tenant_id=$1 AND name='Acme Supply'`, [TENANT]), 1, "no second organization");
  });

  await t.test("18. UAT-FIN-PUR-007: a Finance-only correction is REVERSE / CORRECT (the operational receipt correction is #193, proven separately)", async () => {
    const f = (await factsFor(taylorReceipt)).rows[0];
    const corr = await fin.correctFinancialFact(pool, { tenantId: TENANT, principalId: "finance-ops" },
      { factId: f.id, reason: "supplier credit: unit price was 39.00", idempotencyKey: "corr-taylor-1", replacement: { amountMinor: 4 * 3900 } });
    assert.deepEqual([corr.reversal.reversesFactId, corr.replacement.correctsFactId, corr.replacement.sourceRecordId, corr.replacement.sourceLine],
      [f.id, f.id, taylorReceipt, "L1"]);
    const original = (await q(`SELECT amount_minor FROM eos_finance.financial_facts WHERE tenant_id=$1 AND id=$2`, [TENANT, f.id])).rows[0];
    assert.equal(original.amount_minor, String(4 * 4100), "the original fact is untouched");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, taylorReceipt]), 1,
      "the operational evidence is not rewritten by a financial correction");
  });
});
