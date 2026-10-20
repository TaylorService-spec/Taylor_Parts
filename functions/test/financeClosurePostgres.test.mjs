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
import { assignFinanceCompanies } from "./support/financeCompanyAccess.mjs";

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
const { capabilitiesForRoleKeys, protectedAdministratorKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-fclose";
const ISO_ACCOUNT = "acct-iso"; // a customer of BOTH operating companies: the Taylor/Ventana negative-isolation fixture
const ISO_VENTANA_ONLY = "acct-iso-v"; // a customer of Ventana ONLY: must look exactly like no account to a Taylor-only caller
const INV = "/operations/inventory", WO = "/operations/work-orders", FIN = "/operations/finance", AN = "/operations/analysis";
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
  for (const p of ["P-DS", "P-PUR", "P-UNPRICED", "P-IC", "P-IC2", "P-PATHB"]) {
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
  // COMPANY ASSIGNMENT IS MANDATORY (Financials Workspace P0 correction): the Finance principals this suite exercises are
  // explicitly assigned to Taylor and Ventana. The SCOPE test below proves what happens without (or with partial) assignment.
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrl, acctMgr, sysAdmin]);

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

  let ctrlCost;
  await t.test("MUST-2: intercompany-relief rows withhold partId + quantity without inventory.catalog.cost.read; counts, money and every other read identical", async () => {
    const COST = "inventory.catalog.cost.read";
    const WITHHELD = [{ group: "RELIEF_INVENTORY", fields: ["partId", "quantity"], requires: [COST] }];
    await grant("financeManager", COST); // local test tenant only: financeManager is held by no other person in this suite
    ctrlCost = await person("uid-ctrl-cost", ["controller", "financeManager"], { id: "e-ctrl-cost", name: "Quinn Cost-Reader" });
    // The same Finance company reach as ctrl (Financials company assignment): the ONLY difference between them is the cost read.
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrlCost]);
    // (a) premise: the controller holds the Finance read and NOT the cost read; the cost reader holds both.
    const ctrlKeys = new Set(await capabilitiesForRoleKeys(pool, TENANT, ["controller"]));
    assert.deepEqual([ctrlKeys.has("finance.payment.read"), ctrlKeys.has(COST)], [true, false], "controller: Finance read without the cost read");
    const costKeys = new Set(await capabilitiesForRoleKeys(pool, TENANT, ["controller", "financeManager"]));
    assert.deepEqual([costKeys.has("finance.payment.read"), costKeys.has(COST)], [true, true], "cost reader: both");
    // (c) premise: the Administrator holds the PROTECTED admin Role and NO grant of the cost read (standing excludes it, #230).
    assert.equal((await one(`SELECT protected FROM eos_policy.roles WHERE tenant_id=$1 AND key='admin'`, [TENANT])).protected, true, "admin is the protected Administrator Role");
    assert.equal(new Set(await capabilitiesForRoleKeys(pool, TENANT, ["admin"])).has(COST), false, "no explicit cost-read grant reaches the Administrator");
    const standing = new Set(await protectedAdministratorKeys(pool, TENANT, ["admin"]));
    assert.deepEqual([standing.size > 0, standing.has(COST)], [true, false], "standing implies READ keys but never the cost read (PROTECTED_ADMINISTRATOR_EXCLUSIONS)");

    for (const scope of ["ventana", "consolidated", "taylor"]) {
      const plain = ok(await fn(ctrl, "readFinanceWorkspace", { operatingCompanyId: scope }), `ctrl ${scope}`);
      const costed = ok(await fn(ctrlCost, "readFinanceWorkspace", { operatingCompanyId: scope }), `cost ${scope}`);
      const adminWs = ok(await fn(sysAdmin, "readFinanceWorkspace", { operatingCompanyId: scope }), `admin ${scope}`);
      if (scope !== "taylor") {
        assert.ok(plain.intercompanyReliefPending.length >= 1, `${scope}: the unrelieved P-IC2 line is pending relief`);
        // (b) the cost reader sees the part and the quantity.
        const p2 = costed.intercompanyReliefPending.find((r) => r.partId === "P-IC2");
        assert.ok(p2, `${scope}: the cost reader sees P-IC2 ${JSON.stringify(costed.intercompanyReliefPending)}`);
        assert.deepEqual([p2.quantity, p2.sellerOperatingCompanyId, p2.buyerOperatingCompanyId, p2.receivingLineId, p2.withheld], [1, "ventana", "taylor", "L1", []]);
      }
      // (a) + (c) without the cost read: ids kept, partId + quantity ABSENT (not null), the withheld group named -- never a value.
      for (const [who, ws] of [["controller", plain], ["protected Administrator", adminWs]]) {
        assert.equal(ws.intercompanyReliefPending.length, costed.intercompanyReliefPending.length, `${who} ${scope}: same rows`);
        ws.intercompanyReliefPending.forEach((row, i) => {
          const full = costed.intercompanyReliefPending[i];
          assert.deepEqual(Object.keys(row), ["intercompanyTransactionId", "sellerOperatingCompanyId", "buyerOperatingCompanyId", "receivingLineId", "withheld"], `${who} ${scope}`);
          assert.equal(Object.hasOwn(row, "partId") || Object.hasOwn(row, "quantity"), false, `${who} ${scope}: absent, never null`);
          assert.deepEqual(row.withheld, WITHHELD, `${who} ${scope}: withheld names the group and key`);
          assert.doesNotMatch(JSON.stringify(row), /P-IC/, `${who} ${scope}: no part value anywhere in the row`);
          const { partId: _p, quantity: _q, withheld: _w, ...ids } = full;
          const { withheld: _w2, ...shown } = row;
          assert.deepEqual(shown, ids, `${who} ${scope}: the ids are kept exactly`);
        });
        // (d) every other field of the response is deep-equal; counts and money identical.
        const { intercompanyReliefPending: _a, ...restW } = ws;
        const { intercompanyReliefPending: _b, ...restC } = costed;
        assert.deepEqual(restW, restC, `${who} ${scope}: every other workspace section is identical`);
        assert.deepEqual(ws.exceptionCounts, costed.exceptionCounts, `${who} ${scope}: counts identical`);
        assert.equal(ws.exceptionCounts.intercompanyReliefPending, costed.intercompanyReliefPending.length, `${who} ${scope}: the count is the row count`);
      }
      assert.deepEqual(adminWs, plain, `${scope}: the Administrator sees exactly what a Finance reader without the cost read sees`);
    }
    // (e) the obligation and settlement reads are unaffected.
    for (const scope of ["taylor", "ventana", "consolidated"]) {
      const lists = [];
      for (const who of [ctrl, ctrlCost, sysAdmin]) {
        lists.push([ok(await fn(who, "listObligations", { operatingCompanyId: scope })), ok(await fn(who, "listSettlements", { operatingCompanyId: scope }))]);
      }
      assert.deepEqual(lists[0], lists[1], `${scope}: obligations + settlements identical with and without the cost read`);
      assert.deepEqual(lists[0], lists[2], `${scope}: obligations + settlements identical for the Administrator`);
    }
    const detail = await Promise.all([ctrl, ctrlCost, sysAdmin].map(async (who) => ok(await fn(who, "readObligation", { obligationId: ic.buyer_obligation_id }))));
    assert.deepEqual(detail[0], detail[1]);
    assert.deepEqual(detail[0], detail[2]);
  });

  await t.test("MUST-2 path B: a missing-cost row and the cost-evidence measure withhold part + quantity without the cost read; the later payable cannot be divided", async () => {
    // The inference (#2084, Lane D + static trace): an unpriced receipt's exception shows (receipt, part, quantity); once the
    // evidence arrives the PAYABLE opens on that SAME receipt at the at-cost total -- a single-line receipt's total / quantity
    // is the unit cost. Without inventory.catalog.cost.read neither the workspace row nor the Analysis measure carries the
    // part or the quantity, so the payable total has nothing to be divided by.
    const COST = "inventory.catalog.cost.read";
    const rr = await ordered({ partId: "P-PATHB", qty: 4, supplier: EXT });
    const r = ok(await receive(rr, "P-PATHB", 4), "unpriced receipt");
    const rowOf = async (who) => ok(await fn(who, "readFinanceWorkspace", { operatingCompanyId: "taylor" }), "workspace")
      .missingCostEvidence.find((x) => x.receivingId === r.receivingId);
    const costed = await rowOf(ctrlCost);
    assert.deepEqual([costed.partId, costed.receivedQuantity, costed.withheld], ["P-PATHB", 4, []], "the cost reader sees the part and the quantity");
    for (const [who, p] of [["controller", ctrl], ["protected Administrator", sysAdmin]]) {
      const row = await rowOf(p);
      assert.ok(row, `${who}: the exception stays visible and actionable`);
      assert.equal(Object.hasOwn(row, "partId") || Object.hasOwn(row, "receivedQuantity"), false, `${who}: absent, never null`);
      assert.deepEqual(row.withheld, [{ group: "MISSING_COST_INVENTORY", fields: ["partId", "receivedQuantity"], requires: [COST] }], who);
      const { partId: _p, receivedQuantity: _q, withheld: _w, ...ids } = costed;
      const { withheld: _w2, ...shown } = row;
      assert.deepEqual(shown, ids, `${who}: the receipt, line, purchase order and company are kept exactly`);
    }
    // The Analysis measure (and the areas that carry it) applies the same rule; the count is the same for every caller.
    const measure = async (who) => ok(await call(who, AN, "readMeasureAnalysis", { measureId: "finance.costEvidence.missing", operatingCompanyId: "taylor" }), "measure").measure;
    const full = await measure(ctrlCost);
    const src = full.provenance.sources.find((x) => x.label === r.receivingId);
    assert.deepEqual([src.dimension, src.quantity, full.withheld], ["P-PATHB", 4, undefined], "the cost reader's measure is unchanged");
    for (const [who, p] of [["controller", ctrl], ["protected Administrator", sysAdmin]]) {
      const m = await measure(p);
      assert.deepEqual(m.value, full.value, `${who}: the count is identical`);
      assert.deepEqual(m.withheld, [{ group: "COST_INFERENCE", fields: ["dimension", "quantity"], requires: [COST] }], who);
      assert.deepEqual(m.drivers.byDimension, [], `${who}: no per-part driver`);
      assert.equal(Object.hasOwn(m.aggregate, "quantity"), false, `${who}: no total quantity`);
      for (const c of m.drivers.byCompany) assert.equal(Object.hasOwn(c, "quantity"), false, `${who}: no per-company quantity`);
      assert.ok(m.provenance.sources.some((x) => x.label === r.receivingId), `${who}: the receipt is still a source`);
      for (const x of m.provenance.sources) assert.equal(Object.hasOwn(x, "dimension") || Object.hasOwn(x, "quantity"), false, `${who}: source without part or quantity`);
      assert.doesNotMatch(JSON.stringify(m), /P-PATHB/, `${who}: the part appears nowhere in the measure`);
      for (const area of ["finance", "purchasing", "executive"]) {
        const res = await call(p, AN, "readAnalysisWorkspace", { area, operatingCompanyId: "taylor" });
        if (res.status === 200) assert.doesNotMatch(JSON.stringify(res.body.result), /P-PATHB/, `${who} ${area}: no figure, driver, insight or exception names the part`);
      }
    }
    // The evidence arrives; the PAYABLE opens on the same receipt at the at-cost total (4 x 2500).
    ok(await fn(whm, "supplyReceiptCostEvidence", { receivingId: r.receivingId, receivingLineId: "L1", unitPriceMinor: 2500, currency: "USD",
      reason: "vendor invoice states the price", evidenceReference: "INV-PB" }), "supply");
    for (const [who, p] of [["controller", ctrl], ["protected Administrator", sysAdmin]]) {
      const pay = ok(await fn(p, "listObligations", { operatingCompanyId: "taylor", kind: "PAYABLE" })).items.find((o) => o.sourceRecordId === r.receivingId);
      assert.equal(pay.originatedMinor, "10000", `${who}: the at-cost total is a Finance figure by design`);
      const detail = ok(await fn(p, "readObligation", { obligationId: pay.id }));
      const ws = ok(await fn(p, "readFinanceWorkspace", { operatingCompanyId: "taylor" }));
      const m = await measure(p);
      // Nothing the reader without the cost read can see carries the receipt's part or quantity -- the divisor is gone.
      for (const [what, body] of [["payable", pay], ["obligation detail", detail], ["workspace", ws], ["measure", m]]) {
        assert.doesNotMatch(JSON.stringify(body), /P-PATHB/, `${who} ${what}: no part`);
      }
      assert.equal(ws.missingCostEvidence.some((x) => x.receivingId === r.receivingId), false, `${who}: the exception is resolved`);
    }
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

  // SETTLEMENT CORRECTION UI (Owner direction 2026-10-14): the screen reuses listSettlements + reverseSettlementApplication +
  // voidSettlement. What it relies on: the list carries each application and its status; a re-sent correction is a replay that
  // writes nothing; only finance.settlement.correct holders correct.
  await t.test("CORR-UI: the list the screen reads; duplicate reverse / void replay and write nothing; without finance.settlement.correct, no correction", async () => {
    const { out } = await directPackage({ price: 3300 });
    const rec = await receivableOf(out.packageId);
    const s = await record(ctrl, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 3300, sourceReference: "CHK-UI-1" });
    const a = (await apply(ctrl, s.id, [{ obligationId: rec, amountMinor: 3300 }])).applications[0].applicationId;
    const listed = ok(await fn(ctrl, "listSettlements", { operatingCompanyId: "taylor" })).items.find((x) => x.id === s.id);
    assert.deepEqual([listed.status, listed.appliedMinor, listed.unappliedMinor, listed.applications.map((x) => [x.id, x.obligationId, x.amountMinor, x.status])],
      ["RECORDED", "3300", "0", [[a, rec, "3300", "APPLIED"]]], "the screen's row: status, balances and each application");
    const factCount = async () => Number((await one(`SELECT count(*) n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id=$2`, [TENANT, rec])).n);
    // No finance.settlement.correct: refused before anything is read or written.
    for (const who of [salesP, techP, sysAdmin]) {
      refused(await fn(who, "reverseSettlementApplication", { applicationId: a, reason: "x", idempotencyKey: key("no") }), 403, "CAPABILITY_REQUIRED");
      refused(await fn(who, "voidSettlement", { settlementId: s.id, reason: "x" }), 403, "CAPABILITY_REQUIRED");
    }
    const before = await factCount();
    const k = key("ui-rv");
    const first = ok(await fn(ctrl, "reverseSettlementApplication", { applicationId: a, reason: "applied to the wrong receivable", idempotencyKey: k }));
    assert.equal(first.outcome, "reversed");
    assert.equal(await factCount(), before + 1, "one reversal fact");
    // A double submit (same key) and a second attempt (new key) are replays: no second reversal fact.
    assert.equal(ok(await fn(ctrl, "reverseSettlementApplication", { applicationId: a, reason: "applied to the wrong receivable", idempotencyKey: k })).outcome, "replayed");
    assert.equal(ok(await fn(acctMgr, "reverseSettlementApplication", { applicationId: a, reason: "again", idempotencyKey: key("ui-rv2") })).outcome, "replayed");
    assert.equal(await factCount(), before + 1, "replays write nothing");
    const after = ok(await fn(ctrl, "readSettlement", { settlementId: s.id }));
    assert.deepEqual([after.unappliedMinor, after.applications[0].status, after.applications[0].reversalReason], ["3300", "REVERSED", "applied to the wrong receivable"],
      "the original application stays in history, marked reversed, with its reason");
    assert.equal(ok(await fn(ctrl, "voidSettlement", { settlementId: s.id, reason: "check returned" })).outcome, "voided");
    assert.equal(ok(await fn(ctrl, "voidSettlement", { settlementId: s.id, reason: "check returned" })).outcome, "replayed");
    const voided = ok(await fn(ctrl, "readSettlement", { settlementId: s.id }));
    assert.deepEqual([voided.status, voided.voidReason, voided.reconciliationStatus], ["VOID", "check returned", "NOT_APPLICABLE"]);
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
    for (const h of [...taylor.accountingHandoffs, ...ventana.accountingHandoffs]) {
      assert.notEqual(h.obligationId, "null", "an absent obligation is null, never the text \"null\"");
      if (h.payloadKind !== "OPERATIONAL_BILLING_PACKAGE") assert.ok(h.billingPackageId === null && typeof h.obligationId === "string", `an obligation-anchored handoff: ${JSON.stringify(h)}`);
    }
    for (const who of [techP]) refused(await fn(who, "readFinanceWorkspace", { operatingCompanyId: "taylor" }), 403, "CAPABILITY_REQUIRED");
    const detail = ok(await fn(ctrl, "readObligation", { obligationId: dsReceivable }));
    assert.deepEqual([detail.kind, detail.status, detail.applications.length >= 2, detail.facts.some((f) => f.factClass === "OBLIGATION")], ["RECEIVABLE", "SETTLED", true, true]);
    assert.equal(ok(await fn(ctrl, "readObligation", { obligationId: payable })).accountingHandoffs[0].payloadKind, "VENDOR_PAYABLE");
    void financed; void ic;
  });

  await t.test("ACCOUNT: listObligations narrows to one CRM account inside the reached companies; a bad id is refused, an unknown one is empty", async () => {
    const acctCount = async (companies, accountId, status = null) => Number((await one(`SELECT count(*)::int n FROM eos_finance.obligations o
      JOIN eos_finance.financial_counterparties cp ON cp.tenant_id=o.tenant_id AND cp.id=o.counterparty_id
      WHERE o.tenant_id=$1 AND o.operating_company_id = ANY($2) AND cp.crm_account_id=$3 AND ($4::text IS NULL OR o.status=$4)`, [TENANT, companies, accountId, status])).n);
    // THE ISOLATION FIXTURE, created here and never assumed: one CRM Account that is a customer of BOTH companies, with one
    // Taylor and one Ventana receivable. The SCOPE test below proves the Taylor/Ventana denial against it.
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ($1,$2,'Shared Customer','ACTIVE','f','f')`, [ISO_ACCOUNT, TENANT]);
    await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,$2,'CUSTOMER')`, [TENANT, ISO_ACCOUNT]);
    for (const companyKey of ["taylor", "ventana"]) {
      const { out } = await directPackage({ account: ISO_ACCOUNT, price: 1200, companyKey });
      assert.ok(await receivableOf(out.packageId), `fixture: a ${companyKey} receivable for ${ISO_ACCOUNT} (${JSON.stringify(out).slice(0, 300)})`);
    }
    assert.deepEqual([await acctCount(["taylor"], ISO_ACCOUNT), await acctCount(["ventana"], ISO_ACCOUNT)], [1, 1], "fixture: one obligation per company");
    // ...and one Account that is a customer of VENTANA ONLY: to a Taylor-only caller it must be indistinguishable from none.
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ($1,$2,'Ventana-Only Customer','ACTIVE','f','f')`, [ISO_VENTANA_ONLY, TENANT]);
    await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,$2,'CUSTOMER')`, [TENANT, ISO_VENTANA_ONLY]);
    assert.ok(await receivableOf((await directPackage({ account: ISO_VENTANA_ONLY, price: 900, companyKey: "ventana" })).out.packageId), "fixture: a Ventana-only receivable");
    assert.deepEqual([await acctCount(["taylor"], ISO_VENTANA_ONLY), await acctCount(["ventana"], ISO_VENTANA_ONLY)], [0, 1], "fixture: Ventana only");

    const acct = ISO_ACCOUNT;
    const taylor = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", crmAccountId: acct })).items;
    assert.deepEqual(taylor.map((o) => [o.operatingCompanyId, o.counterparty.crmAccountId]), [["taylor", acct]], "exactly that account's Taylor obligation");
    const ventana = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "ventana", crmAccountId: acct })).items;
    assert.deepEqual(ventana.map((o) => [o.operatingCompanyId, o.counterparty.crmAccountId]), [["ventana", acct]], "exactly that account's Ventana obligation");
    const cons = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "consolidated", crmAccountId: acct })).items;
    assert.deepEqual(cons.map((o) => o.operatingCompanyId).sort(), ["taylor", "ventana"], "the consolidated read is both companies' rows for the account, no more");
    // The row is the obligation register's own shape: amounts and references only -- no part, quantity or unit cost (the
    // cost INPUTS #2084 withholds on the workspace rows never appear on an obligation row at all).
    for (const o of cons) {
      assert.deepEqual(Object.keys(o).sort(), ["counterparty", "currency", "dueOn", "id", "kind", "operatingCompanyId", "originatedMinor",
        "outstandingMinor", "overdue", "settledMinor", "sourceDomain", "sourceRecordId", "sourceSalesOrder", "status"]);
      // F-2: the Sales Order the receivable was billed from -- a reference (id and number), never an amount, part or cost.
      assert.deepEqual(Object.keys(o.sourceSalesOrder).sort(), ["id", "salesOrderNumber"]);
    }
    const open = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", crmAccountId: acct, status: "OPEN" })).items;
    assert.ok(open.length === await acctCount(["taylor"], acct, "OPEN") && open.every((o) => o.status === "OPEN"), "combined with status: the intersection");
    assert.deepEqual(ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", crmAccountId: "acct-does-not-exist" })).items, []);
    for (const bad of ["", "   ", 5, null]) refused(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", crmAccountId: bad }), 400, "ACCOUNT_INVALID", JSON.stringify(bad));
    // The filter grants nothing: no key, no rows, whatever account is named.
    refused(await fn(techP, "listObligations", { operatingCompanyId: "taylor", crmAccountId: acct }), 403, "CAPABILITY_REQUIRED");
    // Sales holds finance.payment.read FLAT (migration 1761609600000 L157-158) but no Finance company assignment, so it
    // reaches NO company: naming its own customer's Account reads nothing.
    assert.equal((await capabilitiesForRoleKeys(pool, TENANT, ["salesperson"])).has("finance.payment.read"), true, "precondition: sales holds the view key flat");
    for (const c of ["taylor", "ventana", "consolidated"]) refused(await fn(salesP, "listObligations", { operatingCompanyId: c, crmAccountId: acct }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE", `sales ${c}`);
  });

  // ── COMPANY ASSIGNMENT IS MANDATORY (Owner ruling 2026-10-13; Financials Workspace P0 correction 2026-10-14) ──
  await t.test("SCOPE: Finance reads and settlement commands need the key AND an explicit company assignment; Consolidated needs every company", async () => {
    const OUT = "OUTSIDE_OPERATING_COMPANY_SCOPE";
    // Records of each company, read from the store (this suite created both).
    const ventanaSettlement = (await one(`SELECT id FROM eos_finance.settlements WHERE tenant_id=$1 AND operating_company_id='ventana' AND status='RECORDED' ORDER BY recorded_at LIMIT 1`, [TENANT])).id;
    const ventanaApplication = (await one(`SELECT a.id FROM eos_finance.settlement_applications a JOIN eos_finance.settlements s ON s.tenant_id=a.tenant_id AND s.id=a.settlement_id
      WHERE a.tenant_id=$1 AND s.operating_company_id='ventana' AND a.status='APPLIED' LIMIT 1`, [TENANT]))?.id;
    const ventanaObligation = (await one(`SELECT id FROM eos_finance.obligations WHERE tenant_id=$1 AND operating_company_id='ventana' LIMIT 1`, [TENANT])).id;
    const taylorSettlement = (await one(`SELECT s.id FROM eos_finance.settlements s JOIN eos_finance.settlement_balances b ON b.tenant_id=s.tenant_id AND b.settlement_id=s.id
      WHERE s.tenant_id=$1 AND s.operating_company_id='taylor' AND s.status='RECORDED' AND b.unapplied_minor > 0 ORDER BY s.recorded_at LIMIT 1`, [TENANT])).id;
    const taylorObligation = (await one(`SELECT id FROM eos_finance.obligations WHERE tenant_id=$1 AND operating_company_id='taylor' LIMIT 1`, [TENANT])).id;
    const snapshot = async () => (await q(`SELECT (SELECT count(*) FROM eos_finance.settlements WHERE tenant_id=$1) s,
      (SELECT count(*) FROM eos_finance.settlement_applications WHERE tenant_id=$1) a, (SELECT count(*) FROM eos_finance.settlement_reconciliations WHERE tenant_id=$1) r`, [TENANT])).rows[0];

    // (1) A global finance Role with NO company assignment reaches nothing -- not even with the Owner's or Controller's keys.
    const ctrlNone = await person("uid-ctrl-none", ["controller"], { id: "e-ctrl-none", name: "Nell Unassigned-Controller" });
    const adminNone = await person("uid-admin-none", ["admin"], { id: "e-admin-none", name: "Ari Unassigned-Administrator" });
    for (const who of [ctrlNone, adminNone]) {
      assert.deepEqual(ok(await fn(who, "readMyFinanceCompanyAccess", {})).companies, [], "no assignment, no company");
      for (const c of ["taylor", "ventana", "consolidated", undefined]) {
        refused(await fn(who, "readFinanceWorkspace", c === undefined ? {} : { operatingCompanyId: c }), 403, OUT, `unassigned: ${c}`);
      }
      refused(await fn(who, "listObligations", { operatingCompanyId: "taylor" }), 403, OUT);
      refused(await fn(who, "listObligations", { operatingCompanyId: "taylor", crmAccountId: ISO_ACCOUNT }), 403, OUT, "naming an Account gives no reach");
      refused(await fn(who, "listSettlements", { operatingCompanyId: "taylor" }), 403, OUT);
      refused(await fn(who, "readObligation", { obligationId: taylorObligation }), 404, "OBLIGATION_NOT_FOUND");
      refused(await fn(who, "readSettlement", { settlementId: taylorSettlement }), 404, "SETTLEMENT_NOT_FOUND");
    }
    const before = await snapshot();
    refused(await fn(ctrlNone, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 5,
      currency: "USD", sourceReference: "x", idempotencyKey: key("sc0") }), 403, OUT);
    refused(await fn(ctrlNone, "applySettlement", { settlementId: taylorSettlement, applications: [{ obligationId: taylorObligation, amountMinor: 1 }], idempotencyKey: key("sc1") }), 404, "SETTLEMENT_NOT_FOUND");

    // (2) Assigned to TAYLOR only: Taylor works; Ventana, Consolidated and an unknown company are refused identically; Ventana
    // records answer exactly like missing ones; no write lands.
    const ctrlT = await person("uid-ctrl-t", ["controller"], { id: "e-ctrl-t", name: "Tia Taylor-Controller" });
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrlT], ["taylor"]);
    const access = ok(await fn(ctrlT, "readMyFinanceCompanyAccess", {}));
    assert.deepEqual([access.consolidated, access.companies.map((c) => [c.operatingCompanyId, c.actions])],
      [false, [["taylor", { view: true, record: true, apply: true, correct: true, reconcile: true }]]]);
    assert.equal(ok(await fn(ctrlT, "readFinanceWorkspace", { operatingCompanyId: "taylor" })).scope.companies.join(), "taylor");
    const outside = refused(await fn(ctrlT, "readFinanceWorkspace", { operatingCompanyId: "ventana" }), 403, OUT);
    for (const c of ["consolidated", "saratoga", "no-such-company"]) {
      const body = refused(await fn(ctrlT, "readFinanceWorkspace", { operatingCompanyId: c }), 403, OUT, `Taylor-only: ${c}`);
      assert.deepEqual(Object.keys(body).sort(), Object.keys(outside).sort(), "the same refusal shape: existence is not revealed");
    }
    refused(await fn(ctrlT, "listObligations", { operatingCompanyId: "ventana" }), 403, OUT);
    // NEGATIVE ISOLATION (never skipped): naming an Account that holds a Ventana obligation does not widen reach. The
    // Ventana row must exist, or this proves nothing -- the ACCOUNT test created it.
    const isoVentana = (await one(`SELECT o.id FROM eos_finance.obligations o JOIN eos_finance.financial_counterparties cp ON cp.tenant_id=o.tenant_id AND cp.id=o.counterparty_id
      WHERE o.tenant_id=$1 AND o.operating_company_id='ventana' AND cp.crm_account_id=$2`, [TENANT, ISO_ACCOUNT]))?.id;
    assert.ok(isoVentana, `fixture: ${ISO_ACCOUNT} must hold a Ventana obligation for the isolation proof`);
    refused(await fn(ctrlT, "listObligations", { operatingCompanyId: "ventana", crmAccountId: ISO_ACCOUNT }), 403, OUT);
    refused(await fn(ctrlT, "listObligations", { operatingCompanyId: "consolidated", crmAccountId: ISO_ACCOUNT }), 403, OUT);
    refused(await fn(ctrlT, "listObligations", { crmAccountId: ISO_ACCOUNT }), 403, OUT);
    const isoTaylorOnly = ok(await fn(ctrlT, "listObligations", { operatingCompanyId: "taylor", crmAccountId: ISO_ACCOUNT })).items;
    assert.deepEqual(isoTaylorOnly.map((o) => o.operatingCompanyId), ["taylor"], "a Taylor-only caller sees the account's Taylor row only");
    assert.ok(!isoTaylorOnly.some((o) => o.id === isoVentana), "and never the Ventana obligation");
    refused(await fn(ctrlT, "readObligation", { obligationId: isoVentana }), 404, "OBLIGATION_NOT_FOUND");
    // EQUIVALENCE: to a Taylor-only caller a Ventana-only Account is exactly a nonexistent one -- the same empty list in Taylor,
    // and the same refusal body (decided by company scope BEFORE the account is looked at) in Ventana / Consolidated.
    const none = "acct-does-not-exist";
    assert.deepEqual(ok(await fn(ctrlT, "listObligations", { operatingCompanyId: "taylor", crmAccountId: ISO_VENTANA_ONLY })),
      ok(await fn(ctrlT, "listObligations", { operatingCompanyId: "taylor", crmAccountId: none })), "Ventana-only account == no account");
    for (const c of ["ventana", "consolidated"]) {
      const a = refused(await fn(ctrlT, "listObligations", { operatingCompanyId: c, crmAccountId: ISO_VENTANA_ONLY }), 403, OUT);
      const b = refused(await fn(ctrlT, "listObligations", { operatingCompanyId: c, crmAccountId: none }), 403, OUT);
      const shape = (r) => [Object.keys(r).sort(), r.code, r.message];
      assert.deepEqual(shape(a), shape(b), `${c}: the same refusal for a Ventana account and a nonexistent one`);
    }
    // Scope is decided first, so a malformed id outside reach is refused as out of scope, not as invalid input.
    refused(await fn(ctrlT, "listObligations", { operatingCompanyId: "ventana", crmAccountId: "" }), 403, OUT);
    refused(await fn(ctrlT, "listSettlements", { operatingCompanyId: "consolidated" }), 403, OUT);
    refused(await fn(ctrlT, "readObligation", { obligationId: ventanaObligation }), 404, "OBLIGATION_NOT_FOUND");
    refused(await fn(ctrlT, "readObligation", { obligationId: "obl-does-not-exist" }), 404, "OBLIGATION_NOT_FOUND");
    refused(await fn(ctrlT, "readSettlement", { settlementId: ventanaSettlement }), 404, "SETTLEMENT_NOT_FOUND");
    assert.equal(ok(await fn(ctrlT, "readObligation", { obligationId: taylorObligation })).operatingCompanyId, "taylor");
    refused(await fn(ctrlT, "recordSettlement", { operatingCompanyId: "ventana", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 5,
      currency: "USD", sourceReference: "x", idempotencyKey: key("sc2") }), 403, OUT);
    refused(await fn(ctrlT, "applySettlement", { settlementId: ventanaSettlement, applications: [{ obligationId: ventanaObligation, amountMinor: 1 }], idempotencyKey: key("sc3") }), 404, "SETTLEMENT_NOT_FOUND");
    refused(await fn(ctrlT, "applySettlement", { settlementId: taylorSettlement, applications: [{ obligationId: ventanaObligation, amountMinor: 1 }], idempotencyKey: key("sc4") }), 404, "OBLIGATION_NOT_FOUND",
      "a Taylor settlement cannot reach a Ventana obligation");
    refused(await fn(ctrlT, "voidSettlement", { settlementId: ventanaSettlement, reason: "x" }), 404, "SETTLEMENT_NOT_FOUND");
    refused(await fn(ctrlT, "reconcileSettlement", { settlementId: ventanaSettlement, externalReference: "x", externalAmountMinor: 1, idempotencyKey: key("sc5") }), 404, "SETTLEMENT_NOT_FOUND");
    if (ventanaApplication) refused(await fn(ctrlT, "reverseSettlementApplication", { applicationId: ventanaApplication, reason: "x", idempotencyKey: key("sc6") }), 404, "APPLICATION_NOT_FOUND");
    assert.deepEqual(await snapshot(), before, "no refused command wrote anything");
    // ...and inside its company the same principal still works: a Taylor settlement is recorded.
    const mine = await record(ctrlT, { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 700 });
    assert.equal(mine.operatingCompanyId, "taylor");

    // (3) A company assignment is REACH, never a key: assigned to both companies with no settlement key, nothing can be recorded.
    const viewer = await person("uid-fin-viewer", [], { id: "e-fin-viewer", name: "Vic Viewer" });
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [viewer]);
    const va = ok(await fn(viewer, "readMyFinanceCompanyAccess", {}));
    assert.deepEqual([va.consolidated, va.companies.map((c) => [c.operatingCompanyId, c.actions.record, c.actions.apply])], [true, [["taylor", false, false], ["ventana", false, false]]]);
    assert.deepEqual(ok(await fn(viewer, "readFinanceWorkspace", { operatingCompanyId: "consolidated" })).scope.companies, ["taylor", "ventana"]);
    refused(await fn(viewer, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-cust"), kind: "CUSTOMER_PAYMENT", amountMinor: 5,
      currency: "USD", sourceReference: "x", idempotencyKey: key("sc7") }), 403, "CAPABILITY_REQUIRED");

    // (4) Assigned to BOTH companies: Consolidated is the sum of the two, owning nothing.
    const both = ok(await fn(ctrl, "readMyFinanceCompanyAccess", {}));
    assert.deepEqual([both.consolidated, both.companies.map((c) => c.operatingCompanyId)], [true, ["taylor", "ventana"]]);
    refused(await fn(techP, "readMyFinanceCompanyAccess", {}), 403, "CAPABILITY_REQUIRED");
  });
});
