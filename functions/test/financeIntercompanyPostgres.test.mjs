// TAYLOR / VENTANA INTERCOMPANY (Controller FINANCE BUSINESS RELATIONSHIPS -- intercompany scope, 2026-10-02; DECISIONS #202).
// Proofs 1–24 over the REAL governed Reorder -> PO -> Receipt -> acquisition-cost path (no second purchasing system): buyer and
// seller from the PO's governed internal-supplier identity, the intercompany CORRELATION written by the receipt, and the paired
// INTERCOMPANY_PAYABLE / INTERCOMPANY_RECEIVABLE mechanism -- implemented, database-enforced, and HELD at the governed boundary
// (no runtime caller) until the Owner rules the business event that creates them. Real PostgreSQL; set POLICY_TEST_DATABASE_URL.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const ic = require("../lib/eosFinance/intercompany.js");
const pkg = require("../lib/eosFinance/billingPackage.js");
const fulfillment = require("../lib/eosCommercial/fulfillment/salesOrderFulfillmentAuthority.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const http = require("../lib/eosOps/eosOpsHttp.js");
const closure = require("../lib/adminPolicy/purchasingFinanceClosureDelta.js");
const partsDelta = require("../lib/adminPolicy/partsPurchasingReceivingDelta.js");
const purchasing = require("../lib/eosOps/purchasingRepository.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-finic";
const INV = "/operations/inventory";
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

test("P / Q / R / S. static: the receipt TRIGGER is wired (#202); no netting / elimination / settlement / invoice; no Firebase; no transport operation", () => {
  const receipt = readFileSync(join(SRC, "eosOps/receiveReorderStockCommand.ts"), "utf8");
  const code = strip(readFileSync(join(SRC, "eosFinance/intercompany.ts"), "utf8"));
  assert.match(receipt, /recordIntercompanyCorrelationForReceiptOn\(/, "the governed receipt writes the correlation");
  assert.match(code, /establishIntercompanyObligationsOn\(c, actor, \{ correlationId: id, trigger: INTERCOMPANY_RECEIPT_TRIGGER \}\)/, "...and establishes the pair (Owner ruling #202)");
  assert.equal(/NET.?90|\b90\b/.test(code), false, "NET 90 is configuration, never code");
  const mig = strip(readFileSync(resolve(HERE, "../migrations/1764490000000_intercompany-transactions.sql"), "utf8"));
  for (const [name, src] of [["intercompany.ts", code], ["migration", mig]]) {
    assert.equal(/\bnet(ting|ted)?\b|eliminat|settle|invoice|ledger|journal|overdue/i.test(src), false, `${name}: no netting, elimination, settlement, invoice, GL or stored overdue`);
    assert.equal(/firebase/i.test(src), false, `${name}: no Firebase`);
    assert.equal(/site_label|location_id|supplier_name/i.test(src), false, `${name}: company never from a site, location or supplier text`);
  }
  const ops = [...http.OPERATIONS_READ_OPERATIONS, ...http.OPERATIONS_MUTATION_OPERATIONS];
  assert.equal(ops.some((o) => /intercompany|obligation|settle|payment/i.test(o)), false, "no transport operation manufactures intercompany truth or payment");
});

test("Taylor / Ventana intercompany over the governed Purchasing path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "finic" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const inv = (who, operation, input) => call(who, INV, operation, input);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, category, message, what = "") => {
    assert.deepEqual([r.status, r.body.code], [status, category], `${what} ${JSON.stringify(r.body)}`);
    if (message) assert.match(r.body.message, message, what);
  };
  const grant = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant only" });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 200)}`);
  };
  for (const key of ["reorder.request.approve", "reorder.request.assign", "reorder.request.read"]) await grant("partsManager", key);
  for (const key of ["reorder.request.create.manual", "reorder.request.markReceived", "reorder.request.postPurchasingUpdate", "reorder.request.read",
    "reorder.request.recordPurchaseOrder", "reorder.request.startPurchasing"]) await grant("partsAssociate", key);
  // The correction authority is granted to NOBODY by the migration. The OWNER-RULED holders (Warehouse Manager, Parts Manager)
  // and the Parts Manager finance-defect revocation arrive exactly as an activation window issues them: the reviewed
  // Administration delta, through ordinary Administration operations (purchasingFinanceClosureDelta.ts).
  // The LIVE Parts / Purchasing / Receiving delta (supplier.record.read for the purchasing Roles) -- what nonprod already holds.
  // (Only its supplier rows: the Operational Configuration Administrator Role it also grants is a nonprod Administration Role.)
  for (const { operation, input } of partsDelta.partsPurchasingReceivingOperations().filter((o) => o.input.objectKey === "supplier")) {
    const r = await admin(operation, input);
    assert.equal(r.ok, true, `${operation} ${JSON.stringify(input)} ${JSON.stringify(r).slice(0, 200)}`);
  }
  const partsManagerFinanceBefore = await capabilitiesForRoleKeys(pool, TENANT, ["partsManager"]);
  for (const { operation, input } of closure.purchasingFinanceClosureOperations()) {
    const r = await admin(operation, input);
    assert.equal(r.ok, true, `${operation} ${JSON.stringify(input)} ${JSON.stringify(r).slice(0, 200)}`);
  }

  const pa = await person("uid-pa", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Pat Parts" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Morgan Manager" });
  const corrector = await person("uid-corr", ["warehouseManager", "inventoryReceivingClerk"], { id: "e-corr", name: "Casey Corrector" });
  const partsMgr = await person("uid-pmgr", ["partsManager"], { id: "e-pmgr", name: "Parker Parts-Manager" });
  const whAssoc = await person("uid-wa", ["warehouseAssociate"], { id: "e-wa", name: "Wren Warehouse" });
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-t',$1,'taylor','Shared Building -- Taylor','Shared Building','ACTIVE','NATIVE','fixture','fixture'),
                  ('wh-v',$1,'ventana','Shared Building -- Ventana','Shared Building','ACTIVE','NATIVE','fixture','fixture')`, [TENANT]);
  await q(`INSERT INTO eos_ops.bins (id, tenant_id, warehouse_id, area, aisle, bay, position, code, status, idempotency_key, created_by, updated_by)
           VALUES ('bin_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$1,'wh-t','MAIN','A',1,1,'MAIN-A-1-1','ACTIVE','bin_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','fixture','fixture')`, [TENANT]);
  for (const e of ["e-pa", "e-pm", "e-corr", "e-pmgr", "e-wa"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ($1,$2,$3,$4,now(),'fixture')`, [`ewe-${e}`, TENANT, e, authority.REORDER_ASSIGNMENT_QUALIFICATION]);
    for (const [kind, id] of [["REORDER_QUEUE", "taylor"], ["REORDER_QUEUE", "ventana"], ["WAREHOUSE", "wh-t"], ["WAREHOUSE", "wh-v"]]) {
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
               VALUES ($1,$2,$3,$4,$5,now(),'fixture')`, [`os-${e}-${kind}-${id}`, TENANT, e, kind, id]);
    }
  }
  const PARTS = ["P-IC-T", "P-IC-V", "P-IC-LEG", "P-IC-SELF", "P-IC-SELFV", "P-IC-UNP", "P-IC-CORR", "P-IC-LOC", "P-IC-EXT", "P-IC-OPT", "P-IC-REPLAY"];
  for (const p of PARTS) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($1,$2,'fixture',$1,$1,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [p, TENANT]);
  }
  // The EXTERNAL supplier: a governed supplier profile, linked to its CRM organization (a VENDOR).
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-acme',$1,'Acme Refrigeration','ACTIVE','fixture','fixture')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-acme','VENDOR')`, [TENANT]);
  await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
           VALUES ($1,'SUP-ACME','Acme Refrigeration','acme refrigeration','ACTIVE',1,'fixture','fixture')`, [TENANT]);
  await fin.linkSupplierToOrganization(pool, { tenantId: TENANT, principalId: "ops" }, { supplierId: "SUP-ACME", crmAccountId: "acct-acme" });

  let n = 0;
  const toPurchasing = async (partId, warehouseId, qty) => {
    const rr = ok(await inv(pa, "createReorderRequest", { partId, warehouseId, requestedQuantity: qty, recommendationStatus: "BELOW_MIN",
      quantitySource: "MANUAL", idempotencyKey: `rr-${++n}` }), "create").reorderRequestId;
    ok(await inv(pm, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED" }), "approve");
    ok(await inv(pm, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await inv(pa, "startPurchasingOnReorder", { reorderRequestId: rr }), "start");
    return rr;
  };
  const poInput = (rr, qty, supplier, price) => ({ reorderRequestId: rr, ...supplier, externalPoNumber: `PO-${rr.slice(-6)}`, orderedQuantity: qty,
    orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08", ...(price === undefined ? {} : { unitPriceMinor: price, currency: "USD" }) });
  const ordered = async ({ partId, warehouseId, qty, supplier, price }) => {
    const rr = await toPurchasing(partId, warehouseId, qty);
    ok(await inv(pa, "recordReorderPurchaseOrder", poInput(rr, qty, supplier, price)), "PO");
    return rr;
  };
  const receive = (rr, partId, location, qty, key = `rcv-${rr}`) => inv(pa, "receiveReorderStock", {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rr, purchaseOrderId: rr }, receivingLocation: location,
    lines: [{ lineId: "L1", partId, receivedQuantity: qty }], idempotencyKey: key });
  const WH_T = { type: "WAREHOUSE", locationId: "wh-t" };
  const WH_V = { type: "WAREHOUSE", locationId: "wh-v" };
  const EXT = { supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-ACME" } };
  const INTERNAL = (operatingCompanyId) => ({ supplier: { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId } });
  const po = (rr) => one(`SELECT * FROM eos_ops.purchase_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, rr]);
  const factsOf = (receivingId) => q(`SELECT * FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id=$2 ORDER BY created_at, id`, [TENANT, receivingId]);
  const counterparty = async (id) => (id === null ? null : fin.readCounterparty(pool, TENANT, id));
  const onHand = (partId, type, id) => count(`SELECT COALESCE(SUM(quantity_delta),0)::int n FROM eos_ops.inventory_movements
      WHERE tenant_id=$1 AND part_id=$2 AND location_type=$3 AND location_id=$4`, [TENANT, partId, type, id]);
  const crmAccounts = () => count(`SELECT count(*)::int n FROM eos_crm.accounts WHERE tenant_id=$1`, [TENANT]);

  const correct = (who, input) => inv(who, "correctReorderReceipt", input);
  const correlationOf = (receivingId) => one(`SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, receivingId]);
  const ics = () => count(`SELECT count(*)::int n FROM eos_finance.intercompany_transactions WHERE tenant_id=$1`, [TENANT]);
  const sys = { tenantId: TENANT, principalId: "finance-system" };
  const inTx = async (fn) => { const c = await pool.connect(); try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
    catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); } };
  const icObligations = (correlationId) => q(`SELECT o.id, o.kind, o.operating_company_id, o.status, o.currency, cp.kind AS cp_kind, cp.operating_company_id AS cp_company,
      b.originated_minor::text AS originated, b.outstanding_minor::text AS outstanding FROM eos_finance.obligations o
      JOIN eos_finance.financial_counterparties cp ON cp.id=o.counterparty_id JOIN eos_finance.obligation_balances b ON b.obligation_id=o.id
      WHERE o.tenant_id=$1 AND o.source_domain='INTERCOMPANY' AND o.source_record_id=$2 ORDER BY o.kind`, [TENANT, correlationId]).then((r) => r.rows);

  // ════════════════════ IDENTITY AND COMPANY RULES ════════════════════

  let t2v, v2t;
  const receiptDate = async (receivingId) => (await one(`SELECT to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD') d FROM eos_ops.receiving_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, receivingId])).d;
  const plusDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dueOf = async (obligationId) => (await one(`SELECT to_char(due_on,'YYYY-MM-DD') d FROM eos_finance.obligations WHERE id=$1`, [obligationId])).d;
  const corr = async (receivingId) => one(`SELECT *, to_char(obligation_date,'YYYY-MM-DD') AS od, to_char(due_on,'YYYY-MM-DD') AS dd FROM eos_finance.intercompany_transactions
      WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, receivingId]);

  await t.test("TERMS: Taylor's governed terms with Ventana are NET 90 (configuration on Taylor's profile of Ventana); nothing else is configured", async () => {
    const ventanaCp = await fin.ensureInternalCounterparty(pool, sys, "ventana");
    const p = await fin.setCounterpartyCompanyProfile(pool, sys, { counterpartyId: ventanaCp.id, operatingCompanyId: "taylor", paymentTerms: "Net 90", paymentTermsNetDays: 90 });
    assert.deepEqual([p.paymentTerms, p.paymentTermsNetDays], ["Net 90", 90]);
    await assert.rejects(fin.setCounterpartyCompanyProfile(pool, sys, { counterpartyId: ventanaCp.id, operatingCompanyId: "taylor", paymentTermsNetDays: -1 }), (e) => e.code === "PAYMENT_TERMS_INVALID");
    const taylorCp = await fin.ensureInternalCounterparty(pool, sys, "taylor");
    assert.equal(await fin.readCounterpartyCompanyProfile(pool, TENANT, taylorCp.id, "ventana"), null, "Ventana's terms with Taylor are NOT governed (never assumed NET 90)");
  });

  await t.test("A / B / C / D / E / F / G / 1 / 3 / 9 / 19. a priced Taylor receipt from Ventana establishes the pair NOW: one payable, one receivable, NET 90 due", async () => {
    const forTaylor = ok(await inv(pa, "listPurchaseOrderSupplierOptions", { reorderRequestId: await toPurchasing("P-IC-OPT", "wh-t", 1) }), "options");
    assert.ok(forTaylor.items.some((o) => o.kind === "INTERNAL_OPERATING_COMPANY" && o.operatingCompanyId === "ventana"), "1");
    const rrT = await ordered({ partId: "P-IC-T", warehouseId: "wh-t", qty: 2, supplier: INTERNAL("ventana"), price: 250000 });
    const rT = ok(await receive(rrT, "P-IC-T", WH_T, 2), "receive T<-V");
    t2v = await corr(rT.receivingId);
    const day = await receiptDate(rT.receivingId);
    assert.deepEqual([t2v.buyer_operating_company_id, t2v.seller_operating_company_id, t2v.purchase_order_id, t2v.amount_minor, t2v.currency, t2v.status, t2v.established_trigger],
      ["taylor", "ventana", rrT, "500000", "USD", "ESTABLISHED", "GOVERNED_PRICED_RECEIPT (Owner ruling #202)"], "9 + the ruled trigger");
    const obs = await icObligations(t2v.id);
    assert.deepEqual(obs.map((o) => [o.kind, o.operating_company_id, o.cp_kind, o.cp_company, o.originated, o.currency, o.status]), [
      ["INTERCOMPANY_PAYABLE", "taylor", "INTERNAL_OPERATING_COMPANY", "ventana", "500000", "USD", "OPEN"],
      ["INTERCOMPANY_RECEIVABLE", "ventana", "INTERNAL_OPERATING_COMPANY", "taylor", "500000", "USD", "OPEN"]], "A / B / C");
    assert.deepEqual([t2v.buyer_obligation_id, t2v.seller_obligation_id], [obs[0].id, obs[1].id], "C: one correlation links them");
    assert.equal(t2v.od, day, "D: the obligation date is the receipt's business date");
    assert.deepEqual([t2v.payment_terms_net_days, t2v.dd, await dueOf(obs[0].id), await dueOf(obs[1].id)], [90, plusDays(day, 90), plusDays(day, 90), plusDays(day, 90)],
      "E: due = receipt date + 90, stamped on both sides");
    const facts = await q(`SELECT fact_class, effective_at FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id = ANY($2)`, [TENANT, obs.map((o) => o.id)]);
    assert.deepEqual(facts.rows.map((f) => f.fact_class), ["OBLIGATION", "OBLIGATION"], "F: established before (and without) any payment -- no settlement fact");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1`, [TENANT]), 0, "G: no invoice was needed or created");
    const row = await po(rrT);
    assert.deepEqual([row.supplier_kind, row.supplier_operating_company_id, row.purchasing_operating_company_id], ["INTERNAL_OPERATING_COMPANY", "ventana", "taylor"], "3");
    const ev = await one(`SELECT operating_company_id FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, rT.receivingId]);
    const [fact] = (await factsOf(rT.receivingId)).rows;
    assert.deepEqual([ev.operating_company_id, fact.operating_company_id, (await counterparty(fact.counterparty_id)).operatingCompanyId], ["taylor", "taylor", "ventana"], "19");
    // H. replay creates no duplicate pair.
    const before = await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND source_domain='INTERCOMPANY'`, [TENANT]);
    assert.equal(ok(await receive(rrT, "P-IC-T", WH_T, 2), "replay").outcome, "replayed");
    const replay = await inTx((c) => ic.establishIntercompanyObligationsOn(c, sys, { correlationId: t2v.id, trigger: "x" }));
    assert.equal(replay.outcome, "replayed");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND source_domain='INTERCOMPANY'`, [TENANT]), before, "H");
    // P. never netted: both sides stand at their full amount.
    assert.deepEqual(obs.map((o) => o.outstanding), ["500000", "500000"], "P");
    // The database refuses anything but the exact pair, and refuses rewriting it.
    await assert.rejects(q(`UPDATE eos_finance.intercompany_transactions SET amount_minor=1 WHERE id=$1`, [t2v.id]), /IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_finance.intercompany_transactions SET due_on = due_on + 1 WHERE id=$1`, [t2v.id]), /IMMUTABLE|intercompany_due_shape/);
    await assert.rejects(q(`UPDATE eos_finance.obligations SET due_on = due_on + 30 WHERE id=$1`, [obs[0].id]), /OBLIGATION_IMMUTABLE/);
    await assert.rejects(q(`DELETE FROM eos_finance.intercompany_transactions WHERE id=$1`, [t2v.id]), /IMMUTABLE/);
  });

  await t.test("O / 2 / 10. reverse direction (Ventana buys from Taylor): same architecture, its OWN terms -- none governed, so NO due date is assumed", async () => {
    const rrV = await ordered({ partId: "P-IC-V", warehouseId: "wh-v", qty: 3, supplier: INTERNAL("taylor"), price: 4200 });
    const rV = ok(await receive(rrV, "P-IC-V", WH_V, 3), "receive V<-T");
    v2t = await corr(rV.receivingId);
    assert.deepEqual([v2t.buyer_operating_company_id, v2t.seller_operating_company_id, v2t.amount_minor, v2t.status, v2t.payment_terms_net_days, v2t.dd],
      ["ventana", "taylor", "12600", "ESTABLISHED", null, null]);
    const obs = await icObligations(v2t.id);
    assert.deepEqual(obs.map((o) => [o.kind, o.operating_company_id, o.cp_company, o.originated]),
      [["INTERCOMPANY_PAYABLE", "ventana", "taylor", "12600"], ["INTERCOMPANY_RECEIVABLE", "taylor", "ventana", "12600"]]);
    assert.deepEqual([await dueOf(obs[0].id), await dueOf(obs[1].id)], [null, null], "O: never NET 90 by assumption");
  });

  await t.test("4. supplier TEXT naming the other company manufactures nothing; an external supplier writes no correlation", async () => {
    const before = await ics();
    const rr = await toPurchasing("P-IC-LEG", "wh-t", 1);
    await purchasing.recordPurchaseOrder(pool, TENANT, pa.principalId, rr, { supplierName: "Ventana", externalPoNumber: "LEGACY-IC",
      orderedQuantity: 1, orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08", unitPriceMinor: 1000, currency: "USD" });
    ok(await receive(rr, "P-IC-LEG", WH_T, 1), "legacy receive");
    const rr2 = await ordered({ partId: "P-IC-EXT", warehouseId: "wh-t", qty: 1, supplier: EXT, price: 3000 });
    ok(await receive(rr2, "P-IC-EXT", WH_T, 1), "external receive");
    assert.equal(await ics(), before, "neither text 'Ventana' nor an external supplier produces an intercompany transaction");
  });

  await t.test("L / M / N / 5 / 6 / 7. Taylor->Taylor, Ventana->Ventana and CONSOLIDATED are refused (command and database)", async () => {
    refused(await inv(pa, "recordReorderPurchaseOrder", poInput(await toPurchasing("P-IC-SELF", "wh-t", 1), 1, INTERNAL("taylor"), 100)), 412, "PRECONDITION_FAILED", null, "L");
    refused(await inv(pa, "recordReorderPurchaseOrder", poInput(await toPurchasing("P-IC-SELFV", "wh-v", 1), 1, INTERNAL("ventana"), 100)), 412, "PRECONDITION_FAILED", null, "M");
    const insert = (buyer, seller, id) => q(`INSERT INTO eos_finance.intercompany_transactions (id, tenant_id, buyer_operating_company_id, seller_operating_company_id,
        source_kind, source_record_id, purchase_order_id, currency, amount_minor, cost_evidence_complete, status, obligation_date, idempotency_key, created_by)
        VALUES ($1,$2,$3,$4,'REORDER_RECEIPT',$1,'po-x','USD',100,true,'AWAITING_OBLIGATION_TRIGGER',current_date,$1,'x')`, [id, TENANT, buyer, seller]);
    await assert.rejects(insert("taylor", "taylor", "ic-self-t"), /intercompany_two_companies/);
    await assert.rejects(insert("ventana", "ventana", "ic-self-v"), /intercompany_two_companies/);
    await assert.rejects(insert("consolidated", "ventana", "ic-cons-1"), /check constraint/, "N");
    await assert.rejects(insert("taylor", "CONSOLIDATED", "ic-cons-2"), /check constraint/, "N");
    await assert.rejects(fin.ensureInternalCounterparty(pool, sys, "consolidated"));
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND lower(operating_company_id)='consolidated'`, [TENANT]), 0);
  });

  await t.test("8. physical location never determines company: two warehouse records in ONE shared building, each its own company", async () => {
    const sites = await q(`SELECT id, operating_company_key, site_label FROM eos_ops.warehouses WHERE tenant_id=$1 ORDER BY id`, [TENANT]);
    assert.deepEqual(sites.rows.map((r) => [r.id, r.operating_company_key, r.site_label]), [["wh-t", "taylor", "Shared Building"], ["wh-v", "ventana", "Shared Building"]]);
    assert.deepEqual([t2v.buyer_operating_company_id, v2t.buyer_operating_company_id], ["taylor", "ventana"]);
    const rr = await ordered({ partId: "P-IC-LOC", warehouseId: "wh-t", qty: 1, supplier: INTERNAL("ventana"), price: 7000 });
    refused(await receive(rr, "P-IC-LOC", WH_V, 1), 412, "PRECONDITION_FAILED", /its own destination warehouse/, "a receipt can't relocate a purchase into another company's warehouse record");
    assert.equal((await po(rr)).purchasing_operating_company_id, "taylor");
  });

  await t.test("I / J. an unpriced receipt fabricates nothing; once its cost evidence completes, the pair is established ONCE", async () => {
    const rrU = await ordered({ partId: "P-IC-UNP", warehouseId: "wh-t", qty: 2, supplier: INTERNAL("ventana") });
    const rU = ok(await receive(rrU, "P-IC-UNP", WH_T, 2), "unpriced receive");
    const cu = await corr(rU.receivingId);
    assert.deepEqual([cu.status, cu.cost_evidence_complete, cu.amount_minor], ["COST_EVIDENCE_MISSING", false, null], "I: missing amount != zero");
    assert.equal((await icObligations(cu.id)).length, 0);
    assert.ok(await one(`SELECT 1 FROM eos_finance.cost_evidence_exceptions WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, rU.receivingId]), "the cost-evidence exception is retained");
    // Still incomplete: the recovery holds it.
    assert.deepEqual((await ic.establishIntercompanyObligationsForCompletedEvidence(pool, sys)).map((r) => r.outcome), ["still_held"]);
    // J. The governed cost evidence becomes complete (no such pricing path exists yet -- #193 -- so the test supplies the evidence row a future
    // governed pricing path would write), then the pair is established exactly once.
    const line = await one(`SELECT * FROM eos_ops.receiving_order_lines WHERE tenant_id=$1 AND receiving_order_id=$2`, [TENANT, rU.receivingId]);
    const rcv = await one(`SELECT * FROM eos_ops.receiving_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, rU.receivingId]);
    await q(`INSERT INTO eos_finance.inventory_acquisition_costs (id, tenant_id, cost_basis, operating_company_id, purchase_order_id, purchase_order_line_id,
               purchase_order_source_type, part_id, received_quantity, unit_price_minor, extended_cost_minor, currency, receiving_id, receiving_line_id, received_at,
               receiving_location_type, receiving_location_id, created_by)
             SELECT 'iac-ic-later',$1,(SELECT cost_basis FROM eos_finance.inventory_acquisition_costs LIMIT 1),'taylor',$2,'L1','REORDER_PURCHASE_ORDER',$3,$4,30000,$4*30000,'USD',$5,$6,$7,'WAREHOUSE','wh-t','fixture'`,
      [TENANT, rrU, line.part_id, line.received_quantity, rU.receivingId, line.line_id, rcv.received_at]);
    const first = await ic.establishIntercompanyObligationsForCompletedEvidence(pool, sys);
    assert.deepEqual(first.map((r) => [r.outcome, r.correlation?.amountMinor]), [["recorded", "60000"]]);
    assert.deepEqual((await ic.establishIntercompanyObligationsForCompletedEvidence(pool, sys)), [], "nothing left to establish");
    const est = await corr(rU.receivingId);
    assert.deepEqual([est.status, est.amount_minor, est.payment_terms_net_days, est.dd], ["ESTABLISHED", "60000", 90, plusDays(est.od, 90)]);
    assert.deepEqual((await icObligations(cu.id)).map((o) => [o.kind, o.originated]), [["INTERCOMPANY_PAYABLE", "60000"], ["INTERCOMPANY_RECEIVABLE", "60000"]], "J: once");
  });

  await t.test("K. a receipt correction reverses BOTH sides (never one); history kept", async () => {
    const rrC = await ordered({ partId: "P-IC-CORR", warehouseId: "wh-t", qty: 1, supplier: INTERNAL("ventana"), price: 9000 });
    const rC = ok(await receive(rrC, "P-IC-CORR", WH_T, 1), "receive");
    const cc = await corr(rC.receivingId);
    assert.equal(cc.status, "ESTABLISHED");
    ok(await correct(corrector, { receivingId: rC.receivingId, correction: "VOID", reason: "wrong delivery", idempotencyKey: "ic-corr-1" }), "void");
    assert.equal((await corr(rC.receivingId)).status, "SUPERSEDED_BY_RECEIPT_CORRECTION");
    const obs = await icObligations(cc.id);
    assert.deepEqual(obs.map((o) => [o.kind, o.status, o.outstanding]), [["INTERCOMPANY_PAYABLE", "VOID", "0"], ["INTERCOMPANY_RECEIVABLE", "VOID", "0"]], "both voided, balanced");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id = ANY($2)`, [TENANT, obs.map((o) => o.id)]), 4,
      "each side: origination kept + one reversal");
  });

  // ════════════════════ DOWNSTREAM SALES AND SERVICE ════════════════════

  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-out',$1,'Outside Customer','ACTIVE','fixture','fixture')`, [TENANT]);
  let soN = 0;
  const outsideSale = async (company, partId, price) => {
    const so = `so-ic-${++soN}`;
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, created_by, updated_by)
             VALUES ($1,$2,$1,'acct-out','e-pa',$3,'IN_FULFILLMENT','RETAIL','USD','fixture','fixture')`, [so, TENANT, company]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
             VALUES ($1,$2,1,'PART',$3,'EQUIPMENT_SALES',1,$4)`, [TENANT, so, partId, price]);
    return so;
  };
  const fulfil = (so, company, wo) => q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind,
      source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
      SELECT $1,$2,$3,1,'PART',l.ref,1,'WORK_ORDER_COMPLETION',$5,'PART_USAGE',$4,$4,'acct-out',now(),'fixture' FROM eos_commercial.sales_order_lines l
       WHERE l.tenant_id=$2 AND l.sales_order_id=$3 AND l.line_number=1`, [`ful-${so}`, TENANT, so, company, wo]);
  const dests = {};

  await t.test("20 / 23. Taylor's outside resale of equipment bought from Ventana is a TAYLOR sale (Taylor package, receivable, destination); provenance kept", async () => {
    dests.taylor = await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "taylor", displayName: "Taylor ledger", activate: true });
    dests.ventana = await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "ventana", displayName: "Ventana ledger", activate: true });
    const so = await outsideSale("taylor", "P-IC-T", 395000);
    await fulfil(so, "taylor", "wo-taylor-delivery");
    const out = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so });
    // A direct order (no Agreement) holds on tax evidence by design (#197); the package's company and counterparty are what matter.
    const p = await one(`SELECT operating_company_id, commercial_customer_account_id, obligor_basis, accounting_destination_id FROM eos_finance.billing_packages WHERE id=$1`, [out.packageId]);
    assert.deepEqual([p.operating_company_id, p.commercial_customer_account_id, p.obligor_basis, p.accounting_destination_id],
      ["taylor", "acct-out", "DIRECT_SALE_CUSTOMER", dests.taylor.id], "Taylor's sale, Taylor's customer counterparty, Taylor's destination");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND operating_company_id='ventana' AND source_domain='BILLING_PACKAGE'`, [TENANT]), 0,
      "Ventana earns nothing from Taylor's downstream sale");
    // Provenance: the part Taylor resold traces back to its intercompany acquisition (receipt -> correlation).
    const prov = await one(`SELECT ict.seller_operating_company_id AS supplied_by, ict.buyer_operating_company_id AS acquired_by FROM eos_ops.receiving_order_lines l
        JOIN eos_finance.intercompany_transactions ict ON ict.tenant_id = l.tenant_id AND ict.source_record_id = l.receiving_order_id
       WHERE l.tenant_id=$1 AND l.part_id='P-IC-T' LIMIT 1`, [TENANT]);
    assert.deepEqual(prov, { supplied_by: "ventana", acquired_by: "taylor" });
  });

  await t.test("21 / 22 / 23. a Ventana direct outside sale stays Ventana's; a Taylor Service Work Order cannot rewrite it", async () => {
    const so = await outsideSale("ventana", "P-IC-V", 88000);
    // 22: Taylor Service delivering / installing Ventana-sold equipment is refused as the Ventana sale's fulfillment.
    await q(`INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, status, work_order_type, priority, customer_id, location_id, provenance,
               created_at, updated_at, sales_order_id, created_by_principal_id)
             VALUES ('wo-taylor-svc',$1,'taylor','WORK_IN_PROGRESS','INSTALL',2,'acct-out','loc-none','NATIVE',now(),now(),$2,$3)`, [TENANT, so, pa.principalId]);
    await q(`INSERT INTO eos_ops.work_order_sales_order_lines (tenant_id, work_order_id, sales_order_id, sales_order_line_id) VALUES ($1,'wo-taylor-svc',$2,'1')`, [TENANT, so]);
    await assert.rejects(inTx((c) => fulfillment.recordWorkOrderFulfillmentOn(c, sys, { workOrderId: "wo-taylor-svc", completedAt: new Date() })),
      (e) => e.code === "SALES_ORDER_COMPANY_MISMATCH", "22: a Taylor Service Work Order never fulfils -- or rewrites -- the Ventana sale");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_commercial.sales_order_fulfillments WHERE tenant_id=$1 AND sales_order_id=$2`, [TENANT, so]), 0);
    await fulfil(so, "ventana", "wo-ventana-pickup");
    const out = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so });
    const p = await one(`SELECT operating_company_id, accounting_destination_id FROM eos_finance.billing_packages WHERE id=$1`, [out.packageId]);
    assert.deepEqual([p.operating_company_id, p.accounting_destination_id], ["ventana", dests.ventana.id], "21 / 23: Ventana's sale, Ventana's destination");
    assert.notEqual(dests.taylor.id, dests.ventana.id);
  });
});
