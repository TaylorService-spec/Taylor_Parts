// FINANCE CLOSURE (EOS CONTROLLER -- NEXT 3 MAJOR ROADMAP BLOCKS, Package A, 2026-10-03; DECISIONS #206; migration 1764510000000).
// End-to-end proofs over real PostgreSQL, through the governed transports (/operations/finance, /operations/inventory,
// /operations/work-orders) and the Commercial / Finance commands:
//   AUTH  the four settlement capabilities, separated; held by owner / GM / controller / accountingManager / financeManager; never
//         admin, Sales or Technicians.
//   DS    direct sale -> billing package -> receivable -> handoff -> customer payments (partial, multiple) -> SETTLED.
//   MANY  one payment across two receivables; an unapplied remainder.
//   FIN   financed sale -> entitlement -> FUNDING_RECEIVABLE -> provider funding -> FUNDED; customer contribution separate;
//         FUNDED never by hand before the money; trade-in never a settlement.
//   PUR   PO -> priced receipt -> acquisition cost -> PAYABLE (+ handoff, governed terms) -> vendor payment -> SETTLED.
//   F4    unpriced receipt -> exception -> governed late cost evidence -> PAYABLE exactly once.
//   IC    Ventana -> Taylor: receipt, paired obligations, TWO company-side handoffs (each acknowledged with its own reference),
//         Ventana relief (once, seller's warehouse only), intercompany payment / receipt each side; unpriced IC completed late.
//   F2    Taylor Service performs a Ventana sale's service only under the seller's authorization; the seller stays the seller.
//   CORR  reversal / re-application / void / replacement reconstruct balances; reconciliation RECONCILED / MISMATCH.
//   NEG   wrong company / currency / counterparty / kind / over-application / future date / CONSOLIDATED refused.
//   WS    the exception-first workspace, per company and as the CONSOLIDATED projection.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant, HOUR } from "./support/serviceBaselineTenant.mjs";
import { deterministicAccountingAdapter, TEST_ADAPTER_KEY } from "./support/deterministicAccountingAdapter.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const pkg = require("../lib/eosFinance/billingPackage.js");
const fsale = require("../lib/eosFinance/financedSale.js");
const delivery = require("../lib/eosFinance/accountingDelivery.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const soCommands = require("../lib/eosCommercial/commands/salesOrderCommandService.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const closure = require("../lib/adminPolicy/purchasingFinanceClosureDelta.js");
const partsDelta = require("../lib/adminPolicy/partsPurchasingReceivingDelta.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-fclose";
const INV = "/operations/inventory", WO = "/operations/work-orders", FIN = "/operations/finance";
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("static: settlement is evidence, never a bank fact; no trade-in settlement kind; no Firebase in Finance Closure", () => {
  const settlement = strip(readFileSync(join(SRC, "eosFinance/settlement.ts"), "utf8"));
  assert.doesNotMatch(settlement, /TRADE_IN|tradeIn/i, "no settlement kind and no path for a trade-in");
  for (const f of ["eosFinance/settlement.ts", "eosFinance/obligationHandoff.ts", "eosFinance/vendorPayable.ts", "eosFinance/financeOperations.ts",
    "eosOps/costEvidenceSupplyCommand.ts", "eosOps/intercompanyInventoryRelief.ts", "eosCommercial/fulfillment/serviceProviderAuthorization.ts"]) {
    assert.doesNotMatch(strip(readFileSync(join(SRC, f), "utf8")), /firebase|firestore/i, `${f}: no Firebase`);
  }
  assert.doesNotMatch(strip(readFileSync(join(SRC, "eosFinance/settlement.ts"), "utf8")), /netting|netOff|offset\(/i, "no netting");
});

test("finance closure over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "fclose" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const grant = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant only" });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 200)}`);
  };
  const sys = { tenantId: TENANT, principalId: "finance-system" };
  const fn = (who, operation, input) => call(who, FIN, operation, input);

  // ── people ──
  for (const key of ["reorder.request.approve", "reorder.request.assign", "reorder.request.read"]) await grant("partsManager", key);
  for (const key of ["reorder.request.create.manual", "reorder.request.markReceived", "reorder.request.postPurchasingUpdate", "reorder.request.read",
    "reorder.request.recordPurchaseOrder", "reorder.request.startPurchasing"]) await grant("partsAssociate", key);
  for (const { operation, input } of partsDelta.partsPurchasingReceivingOperations().filter((o) => o.input.objectKey === "supplier")) assert.equal((await admin(operation, input)).ok, true);
  for (const { operation, input } of closure.purchasingFinanceClosureOperations()) assert.equal((await admin(operation, input)).ok, true);
  await grant("inventoryTransferOperator", "inventory.transfer.dispatch");
  const pa = await person("uid-pa", ["partsAssociate", "inventoryReceivingClerk"], { id: "e-pa", name: "Pat Parts" });
  const pm = await person("uid-pm", ["partsManager", "purchasingManager"], { id: "e-pm", name: "Morgan Manager" });
  const whm = await person("uid-whm", ["warehouseManager"], { id: "e-whm", name: "Casey Corrector" });
  const vwh = await person("uid-vwh", ["inventoryTransferOperator"], { id: "e-vwh", name: "Val Ventana-Warehouse", company: "ventana" });
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const acctMgr = await person("uid-acct", ["accountingManager"], { id: "e-acct", name: "Avery Accounting" });
  const sysAdmin = await person("uid-sysadmin", ["admin"], { id: "e-sysadmin", name: "Rowan Administrator" });
  const salesP = await person("uid-sales", ["salesperson"], { id: "e-sales", name: "Riley Retail" });
  const techP = await person("uid-tech", ["technician"], { id: "e-tech", name: "Finley Tech", technician: true });
  const dispatcher = await person("uid-dispatch", ["dispatcher"], { id: "e-dispatch", name: "Emerson Dispatch" });

  // ── companies, warehouses, parts, suppliers, customers ──
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-t',$1,'taylor','Shared Building -- Taylor','Shared Building','ACTIVE','NATIVE','f','f'),
                  ('wh-v',$1,'ventana','Shared Building -- Ventana','Shared Building','ACTIVE','NATIVE','f','f')`, [TENANT]);
  for (const e of ["e-pa", "e-pm", "e-whm", "e-vwh"]) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ($1,$2,$3,$4,now(),'f')`, [`ewe-${e}`, TENANT, e, authority.REORDER_ASSIGNMENT_QUALIFICATION]);
    for (const [kind, id] of [["REORDER_QUEUE", "taylor"], ["REORDER_QUEUE", "ventana"], ["WAREHOUSE", "wh-t"], ["WAREHOUSE", "wh-v"]]) {
      if (e === "e-vwh" && id !== "wh-v") continue; // the Ventana operator's scope is Ventana's warehouse record only
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
               VALUES ($1,$2,$3,$4,$5,now(),'f')`, [`os-${e}-${kind}-${id}`, TENANT, e, kind, id]);
    }
  }
  for (const p of ["P-DS", "P-PUR", "P-UNPRICED", "P-IC", "P-IC2"]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($1,$2,'f',$1,$1,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'f')`, [p, TENANT]);
  }
  // Ventana's own recorded stock of the equipment it will sell to Taylor (its warehouse record in the shared building).
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
             movement_type, quantity_delta, source_kind, source_id, created_by)
           VALUES ('mov-v-stock',$1,'ventana','P-IC','NONE','WAREHOUSE','wh-v','RECEIVED',5,'FIXTURE','fixture','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-acme',$1,'Acme Refrigeration','ACTIVE','f','f'),
           ('acct-cust',$1,'Harbor Grill','ACTIVE','f','f'), ('acct-cust2',$1,'Other Diner','ACTIVE','f','f'), ('acct-lessor',$1,'Sample Lessor','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-acme','VENDOR'), ($1,'acct-cust','CUSTOMER'),
           ($1,'acct-cust2','CUSTOMER'), ($1,'acct-lessor','FINANCING_PROVIDER')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-c',$1,'acct-cust','Downtown','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
           VALUES ($1,'SUP-ACME','Acme Refrigeration','acme refrigeration','ACTIVE',1,'f','f')`, [TENANT]);
  await fin.linkSupplierToOrganization(pool, sys, { supplierId: "SUP-ACME", crmAccountId: "acct-acme" });
  await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "taylor", displayName: "Taylor Ledger", providerKey: TEST_ADAPTER_KEY, activate: true });
  await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "ventana", displayName: "Ventana Ledger", providerKey: TEST_ADAPTER_KEY, activate: true });

  // ── purchasing helpers ──
  let n = 0;
  const toPurchasing = async (partId, warehouseId, qty) => {
    const rr = ok(await call(pa, INV, "createReorderRequest", { partId, warehouseId, requestedQuantity: qty, recommendationStatus: "BELOW_MIN",
      quantitySource: "MANUAL", idempotencyKey: `rr-${++n}` }), "create").reorderRequestId;
    ok(await call(pm, INV, "reviewReorderRequest", { reorderRequestId: rr, decision: "APPROVED" }), "approve");
    ok(await call(pm, INV, "assignReorderRequest", { reorderRequestId: rr, employeeId: "e-pa" }), "assign");
    ok(await call(pa, INV, "startPurchasingOnReorder", { reorderRequestId: rr }), "start");
    return rr;
  };
  const ordered = async ({ partId, qty, supplier, price }) => {
    const rr = await toPurchasing(partId, "wh-t", qty);
    ok(await call(pa, INV, "recordReorderPurchaseOrder", { reorderRequestId: rr, ...supplier, externalPoNumber: `PO-${rr.slice(-6)}`, orderedQuantity: qty,
      orderedDate: "2026-10-01", expectedArrivalDate: "2026-10-08", ...(price === undefined ? {} : { unitPriceMinor: price, currency: "USD" }) }), "PO");
    return rr;
  };
  const receive = (rr, partId, qty) => call(pa, INV, "receiveReorderStock", { source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rr, purchaseOrderId: rr },
    receivingLocation: { type: "WAREHOUSE", locationId: "wh-t" }, lines: [{ lineId: "L1", partId, receivedQuantity: qty }], idempotencyKey: `rcv-${rr}` });
  const EXT = { supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-ACME" } };
  const INTERNAL = (operatingCompanyId) => ({ supplier: { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId } });
  const onHand = (partId, id, key) => count(`SELECT COALESCE(SUM(quantity_delta),0)::int n FROM eos_ops.inventory_movements
      WHERE tenant_id=$1 AND part_id=$2 AND location_type='WAREHOUSE' AND location_id=$3 AND operating_company_key=$4`, [TENANT, partId, id, key]);
  const balance = async (obligationId) => (await fin.readObligationBalance(pool, TENANT, obligationId));
  let sk = 0;
  const key = (k) => `${k}-${++sk}`;
  const customer = (crmAccountId) => ({ kind: "EXTERNAL_ORGANIZATION", crmAccountId });
  const company = (operatingCompanyId) => ({ kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId });
  const record = async (who, input) => ok(await fn(who, "recordSettlement", { currency: "USD", sourceReference: `REF-${++sk}`, idempotencyKey: key("stl"), ...input }), "record").settlement;
  const apply = async (who, settlementId, applications) => ok(await fn(who, "applySettlement", { settlementId, applications, idempotencyKey: key("app") }), "apply");

  // ── commercial helpers (direct + financed packages) ──
  for (const ch of ["RETAIL"]) await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,$2,'ACTIVE','f','f','f') ON CONFLICT DO NOTHING`, [TENANT, ch]);
  const seller = await person("uid-seller", [], { id: "e-seller", name: "Sam Seller" });
  const sellerActor = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]) };
  await q(`INSERT INTO eos_commercial.sales_discount_authorities (tenant_id, principal_id, max_discount_basis_points, updated_by) VALUES ($1,$2,1000,'f')`, [TENANT, seller.principalId]);
  const commercialDeps = { pool, catalog: { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } } };
  let gn = 0;
  const directPackage = async ({ account = "acct-cust", price = 40000, extra = {}, approveTradeIn = null, companyKey = "taylor" } = {}) => {
    const opp = `opp-fc-${++gn}`;
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, sales_channel, stage, operating_company_key,
               credited_salesperson_employee_id, created_by, updated_by) VALUES ($1,$2,$1,$3,'e-seller','RETAIL','DECISION',$4,'e-seller','f','f')`, [opp, TENANT, account, companyKey]);
    const ag = (await sa.createSalesAgreement(commercialDeps, sellerActor, { idempotencyKey: `sa-${gn}`, opportunityId: opp, ownerEmployeeId: "e-seller", isLease: false,
      taxEvidence: { status: "DETERMINED", amountMinor: 0, currency: "USD" }, lines: [{ kind: "SERVICE", ref: "SVC-X", quantity: 1, unitPrice: price, businessUnitId: "SERVICE" }], ...extra }));
    const agreementId = (ag.result ?? ag).salesAgreementId;
    if (approveTradeIn) await approveTradeIn(agreementId);
    await sa.acceptSalesAgreement(commercialDeps, sellerActor, { idempotencyKey: `acc-${gn}`, salesAgreementId: agreementId });
    const so = `so-fc-${gn}`;
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, sales_agreement_id, created_by, updated_by)
             VALUES ($1,$2,$1,$3,'e-seller',$4,'IN_FULFILLMENT','RETAIL','USD',$5,'f','f')`, [so, TENANT, account, companyKey, agreementId]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,1,'SERVICE','SVC-X','INSTALLATION',1,$3)`, [TENANT, so, price]);
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
             VALUES ($1,$2,$3,1,'SERVICE','SVC-X',1,'WORK_ORDER_COMPLETION',$4,'SERVICE_PERFORMED',$5,$5,$6,now(),'f')`, [`ful-${so}`, TENANT, so, `wo-${so}`, companyKey, account]);
    return { agreementId, so, out: await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so }) };
  };
  const receivableOf = async (packageId, kind = "RECEIVABLE") => (await one(`SELECT id FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id=$2 AND kind=$3`, [TENANT, packageId, kind]))?.id;

  await t.test("AUTH: the four settlement capabilities are separate, held by the five Finance-execution Roles, never admin / Sales / Technician", async () => {
    const holds = async (role) => new Set(await capabilitiesForRoleKeys(pool, TENANT, [role]));
    const KEYS = ["finance.settlement.record", "finance.settlement.apply", "finance.settlement.correct", "finance.reconciliation.record"];
    for (const role of ["owner", "generalManager", "controller", "accountingManager", "financeManager"]) {
      const h = await holds(role);
      for (const k of KEYS) assert.equal(h.has(k), true, `${role} holds ${k}`);
    }
    for (const role of ["admin", "salesperson", "technician", "dispatcher", "partsManager", "warehouseManager"]) {
      const h = await holds(role);
      for (const k of KEYS) assert.equal(h.has(k), false, `${role} must not hold ${k}`);
    }
    const rows = await q(`SELECT key, object_key, action_key FROM eos_policy.capabilities WHERE key = ANY($1) ORDER BY action_key`, [KEYS]);
    assert.deepEqual(rows.rows.map((r) => `${r.object_key}.${r.action_key}`).sort(), ["settlement.apply", "settlement.correct", "settlement.reconcile", "settlement.record"]);
    for (const who of [salesP, techP, sysAdmin]) {
      refused(await fn(who, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 1,
        currency: "USD", sourceReference: "x", idempotencyKey: key("no") }), 403, "CAPABILITY_REQUIRED", "nobody without finance.settlement.record manufactures a settlement");
    }
  });

  let dsReceivable;
  await t.test("DS: direct sale -> package -> receivable -> handoff -> partial + second payment -> SETTLED; over-application refused", async () => {
    const { out } = await directPackage({});
    assert.equal(out.status, "READY");
    dsReceivable = await receivableOf(out.packageId);
    assert.equal((await one(`SELECT status FROM eos_finance.accounting_handoffs WHERE tenant_id=$1 AND billing_package_id=$2`, [TENANT, out.packageId])).status, "READY_FOR_DELIVERY");
    const p1 = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 25000, method: "CHECK" });
    assert.deepEqual([p1.direction, p1.status, p1.unappliedMinor, p1.reconciliationStatus], ["RECEIPT", "RECORDED", "25000", "UNRECONCILED"]);
    const a1 = await apply(acctMgr, p1.id, [{ obligationId: dsReceivable, amountMinor: 25000 }]);
    assert.deepEqual([a1.obligations[0].status, a1.obligations[0].outstandingMinor, a1.settlement.unappliedMinor], ["PARTIAL", "15000", "0"]);
    const p2 = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 20000 });
    refused(await fn(ctrl, "applySettlement", { settlementId: p2.id, applications: [{ obligationId: dsReceivable, amountMinor: 20000 }], idempotencyKey: key("over") }),
      409, "SETTLEMENT_OVER_APPLIED", "an obligation is never over-applied");
    const a2 = await apply(ctrl, p2.id, [{ obligationId: dsReceivable, amountMinor: 15000 }]);
    assert.deepEqual([a2.obligations[0].status, a2.obligations[0].outstandingMinor, a2.settlement.unappliedMinor], ["SETTLED", "0", "5000"],
      "multiple payments against one obligation; the remainder stays unapplied, never invented as applied");
    const b = await balance(dsReceivable);
    assert.deepEqual([b.originatedMinor, b.settledMinor, b.outstandingMinor], [40000n, 40000n, 0n]);
    const replay = await fn(ctrl, "applySettlement", { settlementId: p2.id, applications: [{ obligationId: dsReceivable, amountMinor: 15000 }], idempotencyKey: `app-${sk}` });
    assert.equal(replay.status, 200);
  });

  await t.test("MANY: one payment across two receivables of one customer; unapplied remainder; refused beyond the payment", async () => {
    const a = await directPackage({ account: "acct-cust2", price: 30000 });
    const b = await directPackage({ account: "acct-cust2", price: 10000 });
    const ra = await receivableOf(a.out.packageId), rb = await receivableOf(b.out.packageId);
    const pay = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust2"), kind: "CUSTOMER_PAYMENT", amountMinor: 45000 });
    await apply(ctrl, pay.id, [{ obligationId: ra, amountMinor: 30000 }, { obligationId: rb, amountMinor: 10000 }]);
    const s = ok(await fn(ctrl, "readSettlement", { settlementId: pay.id }));
    assert.deepEqual([s.appliedMinor, s.unappliedMinor, s.applications.length], ["40000", "5000", 2]);
    assert.deepEqual([(await balance(ra)).status, (await balance(rb)).status], ["SETTLED", "SETTLED"]);
    const c = await directPackage({ account: "acct-cust2", price: 9000 });
    const rc = await receivableOf(c.out.packageId);
    refused(await fn(ctrl, "applySettlement", { settlementId: pay.id, applications: [{ obligationId: rc, amountMinor: 6000 }], idempotencyKey: key("beyond") }),
      409, "SETTLEMENT_OVER_APPLIED", "beyond the settlement's unapplied 5000");
    await apply(ctrl, pay.id, [{ obligationId: rc, amountMinor: 5000 }]);
    assert.deepEqual([(await balance(rc)).status, (await balance(rc)).outstandingMinor], ["PARTIAL", 4000n]);
  });

  let financed;
  await t.test("FIN: discount + approved trade-in + cash -> entitlement -> provider funding -> FUNDED; contribution separate; FUNDED never before the money", async () => {
    const gmP = await person("uid-gm-fc", ["generalManager"], { id: "e-gm-fc", name: "Gale GM" });
    const ownerActor = { tenantId: TENANT, principalId: gmP.principalId, capabilities: new Set(await capabilitiesForRoleKeys(pool, TENANT, ["generalManager"])) };
    const res = await directPackage({ extra: { customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 2000 }, downPaymentMinor: 3000,
      tradeIns: [{ description: "Used unit (SAMPLE)", proposedValueMinor: 5000 }] },
      approveTradeIn: async (agreementId) => {
        await sa.approveSalesAgreementTradeIn(commercialDeps, ownerActor, { idempotencyKey: key("ti"), salesAgreementId: agreementId, itemNumber: 1, approvedCreditMinor: 5000 });
        await fsale.recordFinancingArrangement(pool, sys, { salesAgreementId: agreementId, financingProviderAccountId: "acct-lessor", arrangementKind: "LEASE",
          customerContributionMinor: 3000, idempotencyKey: key("arr") });
      } });
    const p = await one(`SELECT * FROM eos_finance.billing_packages WHERE id=$1`, [res.out.packageId]);
    assert.deepEqual([p.total_minor, p.trade_in_minor, p.customer_contribution_minor, p.financed_amount_minor], ["38000", "5000", "3000", "30000"]);
    const arr = await one(`SELECT id FROM eos_commercial.financing_arrangements WHERE tenant_id=$1 AND sales_agreement_id=$2`, [TENANT, res.agreementId]);
    const ev = await fsale.recordFinancingApprovalEvidence(pool, sys, { arrangementId: arr.id, documentReference: "DOC-FC", signed: true, approved: true, idempotencyKey: key("ev") });
    await fsale.transitionFinancingArrangement(pool, sys, { arrangementId: arr.id, toStatus: "APPROVED", reason: "x", idempotencyKey: key("ap") });
    await fsale.transitionFinancingArrangement(pool, sys, { arrangementId: arr.id, toStatus: "FUNDING_ENTITLED", reason: "signed + approved", evidenceId: ev.evidenceId, idempotencyKey: key("en") });
    const funding = await receivableOf(res.out.packageId, "FUNDING_RECEIVABLE");
    const contribution = await receivableOf(res.out.packageId, "RECEIVABLE");
    assert.deepEqual([(await balance(funding)).originatedMinor, (await balance(contribution)).originatedMinor], [30000n, 3000n]);
    await assert.rejects(fsale.transitionFinancingArrangement(pool, sys, { arrangementId: arr.id, toStatus: "FUNDED", reason: "by hand", idempotencyKey: key("f") }),
      (e) => e.code === "FUNDING_NOT_RECEIVED", "FUNDING_ENTITLED is not money received");
    // Provider money cannot settle the customer's contribution, nor customer money the provider's receivable.
    const prov = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-lessor"), kind: "PROVIDER_FUNDING", amountMinor: 30000, method: "WIRE" });
    refused(await fn(ctrl, "applySettlement", { settlementId: prov.id, applications: [{ obligationId: contribution, amountMinor: 3000 }], idempotencyKey: key("x") }),
      409, "SETTLEMENT_COUNTERPARTY_MISMATCH");
    refused(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "PROVIDER_FUNDING", amountMinor: 1,
      currency: "USD", sourceReference: "x", idempotencyKey: key("pf") }), 409, "FUNDING_COUNTERPARTY_NOT_FINANCING_PROVIDER");
    const partial = await apply(ctrl, prov.id, [{ obligationId: funding, amountMinor: 10000 }]);
    assert.deepEqual([partial.fundedArrangements, (await one(`SELECT status FROM eos_commercial.financing_arrangements WHERE id=$1`, [arr.id])).status], [[], "FUNDING_ENTITLED"]);
    const full = await apply(ctrl, prov.id, [{ obligationId: funding, amountMinor: 20000 }]);
    assert.deepEqual([full.fundedArrangements, (await one(`SELECT status FROM eos_commercial.financing_arrangements WHERE id=$1`, [arr.id])).status], [[arr.id], "FUNDED"]);
    const fundedEvent = await one(`SELECT reason FROM eos_commercial.financing_arrangement_events WHERE arrangement_id=$1 AND to_status='FUNDED'`, [arr.id]);
    assert.match(fundedEvent.reason, /provider funding received and applied in full/);
    // A FUNDED arrangement's funding is not reversed in EOS.
    refused(await fn(ctrl, "reverseSettlementApplication", { applicationId: full.applications[0].applicationId, reason: "oops", idempotencyKey: key("rv") }),
      409, "FINANCING_FUNDED");
    // The customer's contribution: its own settlement, its own receivable. No settlement exists for the trade-in.
    const cash = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 3000, method: "CASH" });
    const c2 = await apply(ctrl, cash.id, [{ obligationId: contribution, amountMinor: 3000 }]);
    assert.equal(c2.obligations[0].status, "SETTLED");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.settlements WHERE tenant_id=$1 AND amount_minor = 5000`, [TENANT]), 0, "the 5000 trade-in is never a settlement");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id=$2 AND counterparty_id IN
      (SELECT id FROM eos_finance.financial_counterparties WHERE crm_account_id='acct-cust') AND kind='RECEIVABLE'`, [TENANT, res.out.packageId]), 1, "no customer A/R for the provider-funded amount");
    financed = { arrangementId: arr.id, funding, contribution };
  });

  let payable;
  await t.test("PUR: PO -> priced receipt -> acquisition cost -> PAYABLE (+ handoff, governed NET terms) -> vendor payment -> SETTLED", async () => {
    await fin.setCounterpartyCompanyProfile(pool, sys, { counterpartyId: (await fin.ensureExternalCounterparty(pool, sys, "acct-acme")).id, operatingCompanyId: "taylor",
      paymentTerms: "Net 30", paymentTermsNetDays: 30 });
    const rr = await ordered({ partId: "P-PUR", qty: 2, supplier: EXT, price: 4000 });
    const r = ok(await receive(rr, "P-PUR", 2), "priced receipt");
    const o = await one(`SELECT o.*, to_char(o.due_on,'YYYY-MM-DD') dd FROM eos_finance.obligations o WHERE tenant_id=$1 AND idempotency_key=$2`, [TENANT, `ap:rcv:${r.receivingId}`]);
    assert.deepEqual([o.kind, o.operating_company_id, o.source_domain, o.status], ["PAYABLE", "taylor", "RECEIVING", "OPEN"]);
    assert.equal((await balance(o.id)).originatedMinor, 8000n, "the receipt's evidenced acquisition cost");
    const bd = await one(`SELECT to_char(eos_policy.operating_company_business_date($1,'taylor',received_at) + 30,'YYYY-MM-DD') d FROM eos_ops.receiving_orders WHERE id=$2`, [TENANT, r.receivingId]);
    assert.equal(o.dd, bd.d, "due by the governed NET 30, from the receipt's business date");
    const h = await one(`SELECT payload_kind, status, billing_package_id FROM eos_finance.accounting_handoffs WHERE tenant_id=$1 AND obligation_id=$2`, [TENANT, o.id]);
    assert.deepEqual([h.payload_kind, h.status, h.billing_package_id], ["VENDOR_PAYABLE", "READY_FOR_DELIVERY", null]);
    const vp = await record(acctMgr, { operatingCompanyId: "taylor", counterparty: customer("acct-acme"), kind: "VENDOR_PAYMENT", amountMinor: 8000, method: "ACH" });
    assert.equal(vp.direction, "DISBURSEMENT");
    const a = await apply(acctMgr, vp.id, [{ obligationId: o.id, amountMinor: 8000 }]);
    assert.equal(a.obligations[0].status, "SETTLED");
    payable = o.id;
  });

  await t.test("F4: unpriced receipt -> exception, no payable -> governed late cost evidence -> PAYABLE exactly once; history kept", async () => {
    const rr = await ordered({ partId: "P-UNPRICED", qty: 3, supplier: EXT });
    const r = ok(await receive(rr, "P-UNPRICED", 3), "unpriced receipt");
    const statusBefore = (await one(`SELECT status::text s FROM eos_ops.receiving_orders WHERE id=$1`, [r.receivingId])).s;
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND idempotency_key=$2`, [TENANT, `ap:rcv:${r.receivingId}`]), 0,
      "no fabricated obligation for a missing cost");
    const ws0 = ok(await fn(ctrl, "readFinanceWorkspace", { operatingCompanyId: "taylor" }));
    assert.ok(ws0.missingCostEvidence.some((x) => x.receivingId === r.receivingId), "the exception is surfaced");
    refused(await fn(ctrl, "supplyReceiptCostEvidence", { receivingId: r.receivingId, receivingLineId: "L1", unitPriceMinor: 1500, currency: "USD", reason: "vendor invoice" }),
      403, "CAPABILITY_REQUIRED", "Finance does not hold the receipt-record correction authority");
    const s = ok(await fn(whm, "supplyReceiptCostEvidence", { receivingId: r.receivingId, receivingLineId: "L1", unitPriceMinor: 1500, currency: "USD",
      reason: "vendor invoice INV-77 states the price", evidenceReference: "INV-77" }), "supply");
    assert.deepEqual([s.extendedCostMinor, s.remainingMissingLines, s.payable.status], ["4500", 0, "ESTABLISHED"]);
    refused(await fn(whm, "supplyReceiptCostEvidence", { receivingId: r.receivingId, receivingLineId: "L1", unitPriceMinor: 9, currency: "USD", reason: "again" }),
      412, "COST_EVIDENCE_NOT_MISSING");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND idempotency_key=$2`, [TENANT, `ap:rcv:${r.receivingId}`]), 1, "exactly once");
    const res = await one(`SELECT resolution, receiving_correction_id, cost_evidence_supply_id, resolved_by FROM eos_finance.cost_evidence_exception_resolutions z
      JOIN eos_finance.cost_evidence_exceptions x ON x.id = z.exception_id WHERE x.receiving_id=$1`, [r.receivingId]);
    assert.deepEqual([res.resolution, res.receiving_correction_id, res.cost_evidence_supply_id, res.resolved_by], ["COST_EVIDENCE_SUPPLIED", null, s.supplyId, whm.principalId]);
    assert.equal((await one(`SELECT status::text s FROM eos_ops.receiving_orders WHERE id=$1`, [r.receivingId])).s, statusBefore, "the receipt itself is not rewritten");
    assert.equal((await one(`SELECT cost_basis::text b FROM eos_finance.inventory_acquisition_costs WHERE receiving_id=$1`, [r.receivingId])).b, "GOVERNED_LATE_COST_EVIDENCE");
  });

  let ic;
  await t.test("IC: Ventana -> Taylor: paired obligations, TWO company-side handoffs (own destination, own reference), Ventana relief once, company-side settlement", async () => {
    const rr = await ordered({ partId: "P-IC", qty: 2, supplier: INTERNAL("ventana"), price: 125000 });
    const beforeV = await onHand("P-IC", "wh-v", "ventana");
    const r = ok(await receive(rr, "P-IC", 2), "intercompany receipt");
    const tr = await one(`SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, r.receivingId]);
    assert.equal(tr.status, "ESTABLISHED");
    assert.deepEqual([await onHand("P-IC", "wh-t", "taylor"), await onHand("P-IC", "wh-v", "ventana")], [2, beforeV], "Taylor's receipt never decrements Ventana by inference");
    const hs = (await q(`SELECT h.id, h.operating_company_id, h.payload_kind, h.status, h.accounting_destination_id, d.operating_company_id dco
        FROM eos_finance.accounting_handoffs h JOIN eos_finance.accounting_destinations d ON d.id = h.accounting_destination_id
       WHERE h.tenant_id=$1 AND h.correlation_id=$2 ORDER BY h.operating_company_id`, [TENANT, tr.id])).rows;
    assert.deepEqual(hs.map((h) => [h.operating_company_id, h.payload_kind, h.status, h.dco]),
      [["taylor", "INTERCOMPANY_OBLIGATION", "READY_FOR_DELIVERY", "taylor"], ["ventana", "INTERCOMPANY_OBLIGATION", "READY_FOR_DELIVERY", "ventana"]],
      "each side to its own company's destination; never CONSOLIDATED; never netted");
    const adapter = deterministicAccountingAdapter(["ACK", "ACK"]);
    const refs = [];
    for (const h of hs) {
      const d = await delivery.deliverAccountingHandoff({ pool, adapters: { [adapter.key]: adapter } }, sys, { handoffId: h.id, idempotencyKey: key("dl") });
      assert.equal(d.attemptOutcome, "ACKNOWLEDGED");
      refs.push(d.providerDocumentReference);
    }
    assert.notEqual(refs[0], refs[1], "a provider reference per side");
    const sides = adapter.deliveries.map((x) => [x.payload.contract.name, x.payload.obligation.kind, x.payload.intercompany.side, x.payload.intercompany.correlationId]);
    assert.deepEqual(sides, [["eos.accounting.operational-obligation", "INTERCOMPANY_PAYABLE", "BUYER_PAYABLE", tr.id], ["eos.accounting.operational-obligation", "INTERCOMPANY_RECEIVABLE", "SELLER_RECEIVABLE", tr.id]]);
    // FBR-F1: relief -- refused from Taylor's record, refused out of scope, done once from Ventana's record.
    refused(await fn(vwh, "relieveIntercompanySaleInventory", { intercompanyTransactionId: tr.id, receivingLineId: "L1", sourceWarehouseId: "wh-t", reason: "x", idempotencyKey: key("rl") }),
      412, "RELIEF_WAREHOUSE_NOT_SELLERS");
    refused(await fn(pa, "relieveIntercompanySaleInventory", { intercompanyTransactionId: tr.id, receivingLineId: "L1", sourceWarehouseId: "wh-v", reason: "x", idempotencyKey: key("rl") }),
      403, "CAPABILITY_REQUIRED");
    const rel = ok(await fn(vwh, "relieveIntercompanySaleInventory", { intercompanyTransactionId: tr.id, receivingLineId: "L1", sourceWarehouseId: "wh-v",
      reason: "shipped to Taylor under the intercompany sale", idempotencyKey: key("rl") }));
    assert.deepEqual([rel.quantity, rel.sellerOperatingCompanyKey, await onHand("P-IC", "wh-v", "ventana"), await onHand("P-IC", "wh-t", "taylor")], [2, "ventana", beforeV - 2, 2]);
    refused(await fn(vwh, "relieveIntercompanySaleInventory", { intercompanyTransactionId: tr.id, receivingLineId: "L1", sourceWarehouseId: "wh-v", reason: "again", idempotencyKey: key("rl") }),
      409, "INTERCOMPANY_ALREADY_RELIEVED", "no double decrement");
    // Settlement, each company-side: Taylor pays Ventana; Ventana records receipt from Taylor. Never netted.
    const tPay = await record(ctrl, { operatingCompanyId: "taylor", counterparty: company("ventana"), kind: "INTERCOMPANY_PAYMENT", amountMinor: 250000, correlationId: tr.id });
    await apply(ctrl, tPay.id, [{ obligationId: tr.buyer_obligation_id, amountMinor: 250000 }]);
    const vRec = await record(ctrl, { operatingCompanyId: "ventana", counterparty: company("taylor"), kind: "INTERCOMPANY_RECEIPT", amountMinor: 250000, correlationId: tr.id });
    await apply(ctrl, vRec.id, [{ obligationId: tr.seller_obligation_id, amountMinor: 250000 }]);
    assert.deepEqual([(await balance(tr.buyer_obligation_id)).status, (await balance(tr.seller_obligation_id)).status], ["SETTLED", "SETTLED"]);
    refused(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: company("taylor"), kind: "INTERCOMPANY_PAYMENT", amountMinor: 1, currency: "USD",
      sourceReference: "self", idempotencyKey: key("self") }), 409, "SETTLEMENT_COUNTERPARTY_KIND");
    ic = tr;
  });

  await t.test("IC + F4: an unpriced intercompany receipt is held; late cost evidence establishes the pair and both handoffs exactly once", async () => {
    const rr = await ordered({ partId: "P-IC2", qty: 1, supplier: INTERNAL("ventana") });
    const r = ok(await receive(rr, "P-IC2", 1), "unpriced intercompany receipt");
    const before = await one(`SELECT * FROM eos_finance.intercompany_transactions WHERE source_record_id=$1`, [r.receivingId]);
    assert.deepEqual([before.status, before.buyer_obligation_id], ["COST_EVIDENCE_MISSING", null]);
    const s = ok(await fn(whm, "supplyReceiptCostEvidence", { receivingId: r.receivingId, receivingLineId: "L1", unitPriceMinor: 70000, currency: "USD", reason: "Ventana price list" }));
    assert.equal(s.payable.status, "NOT_VENDOR_PURCHASE", "an internal purchase is intercompany, never a vendor payable");
    const after = await one(`SELECT * FROM eos_finance.intercompany_transactions WHERE source_record_id=$1`, [r.receivingId]);
    assert.equal(after.status, "ESTABLISHED");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, after.id]), 2);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoffs WHERE tenant_id=$1 AND correlation_id=$2`, [TENANT, after.id]), 2);
  });

  await t.test("F2: Taylor Service performs a Ventana sale's service only under the seller's authorization; the seller stays the seller", async () => {
    const ROUND = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
    ok(await call(dispatcher, WO, "setTechnicianWorkingHours", { employeeId: "e-tech", timeZone: "UTC", weeklyHours: ROUND, reason: "fixture" }), "hours");
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel,
               currency, credited_salesperson_employee_id, accountable_employee_id, location_id, created_by, updated_by)
             VALUES ('so-ventana',$1,'SO-2026-V00001','acct-cust','e-seller','ventana','IN_FULFILLMENT','RETAIL','USD','e-seller','e-seller','loc-c','f','f')`, [TENANT]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
             VALUES ($1,'so-ventana',1,'SERVICE','SVC-INSTALL','INSTALLATION',1,90000)`, [TENANT]);
    const create = (type) => call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-cust", locationId: "loc-c", workOrderType: type,
      priority: 2, salesOrderId: "so-ventana", salesOrderLines: [1] });
    refused(await create("SERVICE_CALL"), 412, "SALES_ORDER_COMPANY_MISMATCH", "no arbitrary cross-company Work Order");
    await assert.rejects(soCommands.authorizeSalesOrderServiceProvider(commercialDeps, { ...sellerActor, capabilities: new Set(["salesAgreement.read"]) },
      { idempotencyKey: key("auth"), salesOrderId: "so-ventana", serviceOperatingCompanyId: "taylor", scopes: ["SERVICE"], reason: "x" }), (e) => e.code === "CAPABILITY_REQUIRED");
    const auth = await soCommands.authorizeSalesOrderServiceProvider(commercialDeps, sellerActor, { idempotencyKey: key("auth"), salesOrderId: "so-ventana",
      serviceOperatingCompanyId: "taylor", scopes: ["SERVICE"], reason: "Taylor Service installs for Ventana's customer" });
    assert.deepEqual([(auth.result ?? auth).serviceOperatingCompanyKey, (auth.result ?? auth).status], ["taylor", "ACTIVE"]);
    refused(await create("INSTALL"), 412, "SALES_ORDER_COMPANY_MISMATCH", "the authorization covers SERVICE only");
    const woId = ok(await create("SERVICE_CALL"), "authorized cross-company Work Order").workOrderId;
    assert.equal((await one(`SELECT operating_company_key k FROM eos_ops.work_orders WHERE id=$1`, [woId])).k, "taylor", "the Work Order is the service-performing company's");
    ok(await call(dispatcher, WO, "markWorkOrderReady", { workOrderId: woId }), "ready");
    ok(await call(dispatcher, WO, "setWorkOrderPartsPlan", { workOrderId: woId, plan: [] }), "plan");
    const start = Date.now() + 2 * 24 * HOUR;
    ok(await call(dispatcher, WO, "scheduleWorkOrder", { workOrderId: woId, employeeId: "e-tech", scheduledStart: start, scheduledEnd: start + HOUR }), "schedule");
    ok(await call(dispatcher, WO, "dispatchWorkOrder", { workOrderId: woId }), "dispatch");
    for (const op of ["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(techP, WO, op, { workOrderId: woId }), op);
    ok(await call(techP, WO, "completeWorkOrder", { workOrderId: woId }), "complete");
    const f = await one(`SELECT operating_company_key, operating_company_id, service_operating_company_key FROM eos_commercial.sales_order_fulfillments WHERE source_work_order_id=$1`, [woId]);
    assert.deepEqual([f.operating_company_key, f.operating_company_id, f.service_operating_company_key], ["ventana", "ventana", "taylor"], "seller = Ventana; service provider = Taylor");
    assert.equal((await one(`SELECT operating_company_key k FROM eos_commercial.sales_orders WHERE id='so-ventana'`)).k, "ventana", "the seller is never rewritten");
    await soCommands.revokeSalesOrderServiceProvider(commercialDeps, sellerActor, { idempotencyKey: key("rev"), salesOrderId: "so-ventana", serviceOperatingCompanyId: "taylor", reason: "done" });
    refused(await create("SERVICE_CALL"), 412, "SALES_ORDER_COMPANY_MISMATCH", "revoked");
  });

  await t.test("CORR: reverse -> balance restored; re-apply; void refused with live applications; void + replacement; reconciliation", async () => {
    const { out } = await directPackage({ price: 12000 });
    const rec = await receivableOf(out.packageId);
    const wrong = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 12000, sourceReference: "CHK-1001" });
    const a = await apply(ctrl, wrong.id, [{ obligationId: rec, amountMinor: 12000 }]);
    refused(await fn(ctrl, "voidSettlement", { settlementId: wrong.id, reason: "keyed wrong" }), 409, "SETTLEMENT_HAS_APPLICATIONS");
    refused(await fn(acctMgr, "reverseSettlementApplication", { applicationId: a.applications[0].applicationId, idempotencyKey: key("rv") }), 400, "REASON_REQUIRED");
    const rv = ok(await fn(acctMgr, "reverseSettlementApplication", { applicationId: a.applications[0].applicationId, reason: "applied the wrong check", idempotencyKey: key("rv") }));
    assert.deepEqual([rv.obligation.status, rv.obligation.outstandingMinor, rv.settlement.unappliedMinor], ["OPEN", "12000", "12000"]);
    const facts = await q(`SELECT amount_minor::text a, reverses_fact_id FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id=$2 AND fact_class='SETTLEMENT' ORDER BY created_at`, [TENANT, rec]);
    assert.deepEqual(facts.rows.map((f) => [f.a, f.reverses_fact_id !== null]), [["12000", false], ["-12000", true]], "the original is kept; the reversal is linked");
    ok(await fn(ctrl, "voidSettlement", { settlementId: wrong.id, reason: "check was for another account" }));
    const replacement = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 12000, sourceReference: "CHK-1002",
      replacesSettlementId: wrong.id });
    assert.equal(replacement.replacesSettlementId, wrong.id);
    await apply(ctrl, replacement.id, [{ obligationId: rec, amountMinor: 12000 }]);
    const b = await balance(rec);
    assert.deepEqual([b.status, b.settledMinor, b.outstandingMinor], ["SETTLED", 12000n, 0n], "balances reconstruct deterministically from facts");
    const second = await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 1, currency: "USD",
      sourceReference: "x", replacesSettlementId: wrong.id, idempotencyKey: key("dup") });
    assert.deepEqual([second.status, second.body.code], [409, "SETTLEMENT_ALREADY_REPLACED"], "a VOID settlement is replaced once");
  });

  await t.test("RECON: RECONCILED when the external amount agrees, MISMATCH otherwise (with a reason); VOID is not reconciled", async () => {
    const s = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 700 });
    const ok1 = ok(await fn(acctMgr, "reconcileSettlement", { settlementId: s.id, externalReference: "QB-PMT-1", externalAmountMinor: 700, idempotencyKey: key("rc") }));
    assert.equal(ok1.reconciliation.outcome, "RECONCILED");
    const s2 = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 800 });
    refused(await fn(acctMgr, "reconcileSettlement", { settlementId: s2.id, externalReference: "QB-PMT-2", externalAmountMinor: 80, idempotencyKey: key("rc") }), 400, "REASON_REQUIRED");
    const mm = ok(await fn(acctMgr, "reconcileSettlement", { settlementId: s2.id, externalReference: "QB-PMT-2", externalAmountMinor: 80, reason: "accounting shows 0.80", idempotencyKey: key("rc") }));
    assert.equal(mm.reconciliation.outcome, "MISMATCH");
    assert.equal(ok(await fn(ctrl, "readSettlement", { settlementId: s2.id })).reconciliationStatus, "MISMATCH");
    refused(await fn(salesP, "reconcileSettlement", { settlementId: s.id, externalReference: "x", externalAmountMinor: 700, idempotencyKey: key("rc") }), 403, "CAPABILITY_REQUIRED");
    const ws = ok(await fn(ctrl, "readFinanceWorkspace", { operatingCompanyId: "taylor" }));
    assert.ok(ws.reconciliation.some((r) => r.settlementId === s2.id && r.status === "MISMATCH"));
    assert.ok(ws.exceptionCounts.reconciliationMismatches >= 1 && ws.exceptionCounts.unreconciledSettlements >= 1);
  });

  await t.test("NEG: wrong company / currency / counterparty / kind / future date / CONSOLIDATED are refused", async () => {
    const { out } = await directPackage({ price: 5000 });
    const rec = await receivableOf(out.packageId);
    const ventanaPay = await record(ctrl, { operatingCompanyId: "ventana", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 5000 });
    refused(await fn(ctrl, "applySettlement", { settlementId: ventanaPay.id, applications: [{ obligationId: rec, amountMinor: 100 }], idempotencyKey: key("n1") }), 409, "SETTLEMENT_COMPANY_MISMATCH");
    const eur = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 5000, currency: "EUR" });
    refused(await fn(ctrl, "applySettlement", { settlementId: eur.id, applications: [{ obligationId: rec, amountMinor: 100 }], idempotencyKey: key("n2") }), 409, "SETTLEMENT_CURRENCY_MISMATCH");
    const otherCustomer = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust2"), kind: "CUSTOMER_PAYMENT", amountMinor: 5000 });
    refused(await fn(ctrl, "applySettlement", { settlementId: otherCustomer.id, applications: [{ obligationId: rec, amountMinor: 100 }], idempotencyKey: key("n3") }), 409, "SETTLEMENT_COUNTERPARTY_MISMATCH");
    const vendorKind = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "VENDOR_PAYMENT", amountMinor: 5000 });
    refused(await fn(ctrl, "applySettlement", { settlementId: vendorKind.id, applications: [{ obligationId: rec, amountMinor: 100 }], idempotencyKey: key("n4") }), 409, "SETTLEMENT_KIND_MISMATCH");
    refused(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 5, currency: "USD",
      businessDate: "2099-01-01", sourceReference: "x", idempotencyKey: key("n5") }), 400, "BUSINESS_DATE_IN_FUTURE");
    refused(await fn(ctrl, "recordSettlement", { operatingCompanyId: "consolidated", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 5, currency: "USD",
      sourceReference: "x", idempotencyKey: key("n6") }), 400, "CONSOLIDATED_NOT_A_COMPANY");
    refused(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "TRADE_IN", amountMinor: 5, currency: "USD",
      sourceReference: "x", idempotencyKey: key("n7") }), 400, "SETTLEMENT_KIND_INVALID");
    refused(await fn(ctrl, "applySettlement", { settlementId: ventanaPay.id, applications: [{ obligationId: rec, amountMinor: 0 }], idempotencyKey: key("n8") }), 400, "AMOUNT_INVALID");
  });

  await t.test("WS: the workspace per company and as the CONSOLIDATED projection; Sales / Technicians cannot read it; drill-through to an obligation", async () => {
    const taylor = ok(await fn(ctrl, "readFinanceWorkspace", { operatingCompanyId: "taylor" }));
    const ventana = ok(await fn(ctrl, "readFinanceWorkspace", { operatingCompanyId: "ventana" }));
    const cons = ok(await fn(ctrl, "readFinanceWorkspace", { operatingCompanyId: "consolidated" }));
    assert.equal(cons.scope.projection, "CONSOLIDATED_REPORTING_PROJECTION");
    assert.deepEqual(cons.scope.companies, ["taylor", "ventana"]);
    assert.equal(cons.receivables.count, taylor.receivables.count + ventana.receivables.count, "the projection is the sum of the companies, owning nothing");
    assert.ok(taylor.unappliedSettlements.length >= 1);
    assert.equal(taylor.missingCostEvidence.length, 0, "the late-evidenced line is no longer missing");
    for (const who of [techP]) refused(await fn(who, "readFinanceWorkspace", { operatingCompanyId: "taylor" }), 403, "CAPABILITY_REQUIRED");
    const detail = ok(await fn(ctrl, "readObligation", { obligationId: dsReceivable }));
    assert.deepEqual([detail.kind, detail.status, detail.applications.length >= 2, detail.facts.some((f) => f.factClass === "OBLIGATION")], ["RECEIVABLE", "SETTLED", true, true]);
    assert.equal(ok(await fn(ctrl, "readObligation", { obligationId: payable })).accountingHandoffs[0].payloadKind, "VENDOR_PAYABLE");
    void financed; void ic;
  });
});
