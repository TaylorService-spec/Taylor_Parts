// FINANCE ACTIVATION 1 COMPLETION (Controller, 2026-10-01; DECISIONS #193):
//   * PURCHASING SUPPLIER IDENTITY IS EXPLICIT -- EXTERNAL_ORGANIZATION (governed supplier -> CRM organization) or
//     INTERNAL_OPERATING_COMPANY (another operating company); never inferred from text, warehouse or location;
//   * RECEIPT CORRECTION originates in Operations -- VOID or CORRECTED; the original receipt, movements, cost evidence and
//     Finance facts are never deleted or edited; compensating movements, reversal / replacement facts; never negative stock.
// Over the REAL governed Reorder -> PO -> receipt -> correction path on the Operations transport. Real PostgreSQL; set
// POLICY_TEST_DATABASE_URL (without it the database half SKIPS).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const authority = require("../lib/eosOps/reorderAssignmentAuthority.js");
const http = require("../lib/eosOps/eosOpsHttp.js");
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const closure = require("../lib/adminPolicy/purchasingFinanceClosureDelta.js");
const partsDelta = require("../lib/adminPolicy/partsPurchasingReceivingDelta.js");
const purchasing = require("../lib/eosOps/purchasingRepository.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-finidc";
const INV = "/operations/inventory";
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const MIGRATION = resolve(HERE, "../migrations/1764430000000_purchasing-supplier-identity-and-receipt-correction.sql");

test("26 / 27. static: the correction authority is PostgreSQL-native, granted to nobody; no Firebase; one correction operation", () => {
  assert.equal(PERMISSION_CATALOG.some((p) => p.id === "inventory.receipt.correct"), false, "absent from PERMISSION_CATALOG: no catalog reconcile grants it");
  const up = readFileSync(MIGRATION, "utf8").split("-- Down Migration")[0];
  assert.equal(/role_capabilities|principal_capabilities|role_capability_decisions/.test(up.replace(/^\s*--.*$/gm, "")), false, "the migration grants nothing");
  for (const f of ["eosOps/receiptCorrectionCommand.ts", "eosOps/purchasingRepository.ts"]) {
    assert.equal(/from ["'][^"']*firebase/i.test(readFileSync(join(SRC, f), "utf8")), false, `${f} imports no Firebase`);
  }
  const ops = [...http.OPERATIONS_READ_OPERATIONS, ...http.OPERATIONS_MUTATION_OPERATIONS];
  assert.equal(ops.filter((o) => /correct/i.test(o)).join(), "correctReorderReceipt");
  assert.equal(ops.some((o) => /financ|fact|obligation|counterpart|acquisitionCost/i.test(o)), false, "no operation manufactures Finance truth");
});

test("supplier identity + receipt correction over the governed path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "finidc" });
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
  const PARTS = ["P-EXT", "P-T2V", "P-V2T", "P-SELF", "P-LEG", "P-VOID", "P-CORR", "P-USED", "P-WCO", "P-UNP", "P-AUTH1", "P-AUTH2", "P-AUTH3", "P-OPT-T", "P-OPT-V", "P-SELF-V"];
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

  // ════════════════════ SUPPLIER IDENTITY ════════════════════

  await t.test("1 / 2 / 7 / 10. UAT-FIN-PUR-009: an EXTERNAL supplier PO carries stable identity and resolves to its CRM organization", async () => {
    const rr = await toPurchasing("P-EXT", "wh-t", 2);
    refused(await inv(pa, "recordReorderPurchaseOrder", { ...poInput(rr, 2, EXT, 5000), supplierName: "Some Other Vendor" }), 400, "INVALID_INPUT",
      /never supplier text/, "display text cannot ride along with -- or override -- identity");
    refused(await inv(pa, "recordReorderPurchaseOrder", poInput(rr, 2, { supplierName: "Acme Refrigeration" }, 5000)), 400, "INVALID_INPUT",
      /never supplier text/, "a NEW purchase order cannot be created with supplier text alone");
    refused(await inv(pa, "recordReorderPurchaseOrder", poInput(rr, 2, { supplier: { kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-NOBODY" } }, 5000)),
      404, "NOT_FOUND", /no governed supplier/);
    ok(await inv(pa, "recordReorderPurchaseOrder", poInput(rr, 2, EXT, 5000)), "external PO");
    const row = await po(rr);
    assert.deepEqual([row.supplier_kind, row.supplier_id, row.supplier_operating_company_id, row.purchasing_operating_company_id, row.supplier_name],
      ["EXTERNAL_ORGANIZATION", "SUP-ACME", null, "taylor", "Acme Refrigeration"], "the display name is authored from the governed supplier");
    const r = ok(await receive(rr, "P-EXT", WH_T, 2), "receive");
    const [fact] = (await factsOf(r.receivingId)).rows;
    const cp = await counterparty(fact.counterparty_id);
    assert.deepEqual([fact.operating_company_id, fact.amount_minor, cp.kind, cp.crmAccountId], ["taylor", "10000", "EXTERNAL_ORGANIZATION", "acct-acme"]);
    assert.equal((await one(`SELECT supplier_id FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, r.receivingId])).supplier_id,
      "SUP-ACME", "the cost evidence names the governed supplier");
    const before = await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1`, [TENANT]);
    assert.equal(ok(await receive(rr, "P-EXT", WH_T, 2), "replay").outcome, "replayed");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1`, [TENANT]), before, "replay records nothing");
  });

  await t.test("3 / 4 / E. UAT-FIN-PUR-010: Taylor buying from Ventana -> Ventana is the INTERNAL_OPERATING_COMPANY counterparty", async () => {
    const accounts = await crmAccounts();
    const rr = await ordered({ partId: "P-T2V", warehouseId: "wh-t", qty: 1, supplier: INTERNAL("ventana"), price: 250000 });
    const row = await po(rr);
    assert.deepEqual([row.supplier_kind, row.supplier_id, row.supplier_operating_company_id, row.purchasing_operating_company_id, row.supplier_name],
      ["INTERNAL_OPERATING_COMPANY", null, "ventana", "taylor", "Ventana"]);
    const r = ok(await receive(rr, "P-T2V", WH_T, 1), "receive");
    const [fact] = (await factsOf(r.receivingId)).rows;
    const cp = await counterparty(fact.counterparty_id);
    assert.deepEqual([fact.operating_company_id, cp.kind, cp.operatingCompanyId, cp.crmAccountId, fact.correlation_id],
      ["taylor", "INTERNAL_OPERATING_COMPANY", "ventana", null, rr]);
    assert.equal(await crmAccounts(), accounts, "no CRM Account pretends Ventana is an external supplier");
    // E. the source transaction states BUYER and SELLER explicitly -- what a later governed correlation pairs on (no matching here).
    assert.deepEqual(await one(`SELECT purchasing_operating_company_id AS buyer, supplier_operating_company_id AS seller FROM eos_ops.purchase_orders
        WHERE tenant_id=$1 AND supplier_kind='INTERNAL_OPERATING_COMPANY' AND id=$2`, [TENANT, rr]), { buyer: "taylor", seller: "ventana" });
  });

  await t.test("5. UAT-FIN-PUR-011: Ventana buying from Taylor -> Taylor is the INTERNAL_OPERATING_COMPANY counterparty", async () => {
    const rr = await ordered({ partId: "P-V2T", warehouseId: "wh-v", qty: 2, supplier: INTERNAL("taylor"), price: 9900 });
    const r = ok(await receive(rr, "P-V2T", WH_V, 2), "receive");
    const [fact] = (await factsOf(r.receivingId)).rows;
    const cp = await counterparty(fact.counterparty_id);
    assert.deepEqual([fact.operating_company_id, fact.amount_minor, cp.kind, cp.operatingCompanyId], ["ventana", "19800", "INTERNAL_OPERATING_COMPANY", "taylor"]);
  });

  await t.test("UAT-FIN-PUR-019: the governed supplier SELECTION offers names, never ids to type -- and never the buyer itself or CONSOLIDATED", async () => {
    const forTaylor = ok(await inv(pa, "listPurchaseOrderSupplierOptions", { reorderRequestId: await toPurchasing("P-OPT-T", "wh-t", 1) }), "taylor options");
    assert.deepEqual(forTaylor.items.map((o) => [o.kind, o.name]), [["EXTERNAL_ORGANIZATION", "Acme Refrigeration"], ["INTERNAL_OPERATING_COMPANY", "Ventana"]],
      "Taylor sees the governed supplier and Ventana -- never Taylor, never CONSOLIDATED");
    const forVentana = ok(await inv(pa, "listPurchaseOrderSupplierOptions", { reorderRequestId: await toPurchasing("P-OPT-V", "wh-v", 1) }), "ventana options");
    assert.deepEqual(forVentana.items.map((o) => [o.kind, o.name]), [["EXTERNAL_ORGANIZATION", "Acme Refrigeration"], ["INTERNAL_OPERATING_COMPANY", "Taylor Freezer of Arizona"]],
      "Ventana sees Taylor -- never Ventana");
    assert.equal([...forTaylor.items, ...forVentana.items].some((o) => /consolidated/i.test(`${o.operatingCompanyId} ${o.name}`)), false);
    refused(await inv(whAssoc, "listPurchaseOrderSupplierOptions", { reorderRequestId: "x" }), 403, "FORBIDDEN", /requires/, "only those who record POs");
  });

  await t.test("6. UAT-FIN-PUR-012: a company cannot purchase from itself as an internal supplier -- fail closed", async () => {
    const rr = await toPurchasing("P-SELF", "wh-t", 1);
    refused(await inv(pa, "recordReorderPurchaseOrder", poInput(rr, 1, INTERNAL("taylor"), 100)), 412, "PRECONDITION_FAILED", /cannot purchase from itself/);
    refused(await inv(pa, "recordReorderPurchaseOrder", poInput(rr, 1, INTERNAL("consolidated"), 100)), 412, "PRECONDITION_FAILED", /not an ACTIVE operating company/);
    const rv = await toPurchasing("P-SELF-V", "wh-v", 1);
    refused(await inv(pa, "recordReorderPurchaseOrder", poInput(rv, 1, INTERNAL("ventana"), 100)), 412, "PRECONDITION_FAILED", /cannot purchase from itself/,
      "Ventana cannot select Ventana");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_ops.purchase_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, rr]), 0, "nothing recorded");
    assert.equal((await one(`SELECT status::text AS s FROM eos_ops.reorder_requests WHERE tenant_id=$1 AND id=$2`, [TENANT, rr])).s, "PURCHASING_IN_PROGRESS");
    // ...and structurally: the database refuses a self-purchase row even from a writer that skipped the command.
    await assert.rejects(q(`INSERT INTO eos_ops.purchase_orders (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number, ordered_quantity,
        ordered_date, created_by, supplier_kind, supplier_operating_company_id, purchasing_operating_company_id)
        VALUES ($2,$1,'taylor','P-SELF','x','x',1,'2026-10-01','fixture','INTERNAL_OPERATING_COMPANY','taylor','taylor')`, [TENANT, rr]), /purchase_order_supplier_identity/);
  });

  await t.test("8 / 9. UAT-FIN-PUR-013: legacy text-only supplier -- even text naming Ventana, in a Ventana warehouse -- is never guessed", async () => {
    // A NEW text-only PO is refused (above); a HISTORICAL one exists only through the legacy import writer -- the repository the
    // Firestore copy and the Sample Company fixtures use -- and stays valid, unchanged and readable.
    const rr = await toPurchasing("P-LEG", "wh-v", 1);
    await purchasing.recordPurchaseOrder(pool, TENANT, pa.principalId, rr, { supplierName: "Taylor Freezer of Arizona", externalPoNumber: "LEGACY-1",
      orderedQuantity: 1, orderedDate: "2026-09-01", unitPriceMinor: 700, currency: "USD" });
    const read = ok(await inv(pa, "readReorderPurchaseOrders", { reorderRequestIds: [rr] }), "legacy PO readable");
    assert.equal(read.purchaseOrders[0].supplierName, "Taylor Freezer of Arizona", "legacy supplier text is displayed as it was recorded");
    const row = await po(rr);
    assert.deepEqual([row.supplier_kind, row.supplier_id, row.supplier_operating_company_id, row.purchasing_operating_company_id, row.supplier_name],
      [null, null, null, null, "Taylor Freezer of Arizona"], "legacy supplier text kept for display, nothing more");
    const r = ok(await receive(rr, "P-LEG", WH_V, 1), "receive");
    const [fact] = (await factsOf(r.receivingId)).rows;
    assert.deepEqual([fact.operating_company_id, fact.counterparty_id], ["ventana", null], "counterparty unresolved -- never inferred from text or the building");
  });

  // ════════════════════ RECEIPT CORRECTION ════════════════════

  const correct = (who, input) => inv(who, "correctReorderReceipt", input);

  await t.test("11-15 / 17 / 21 / 22. UAT-FIN-PUR-014: a FULL RECEIPT VOID -- history kept, stock compensated, Finance reversed", async () => {
    const rr = await ordered({ partId: "P-VOID", warehouseId: "wh-t", qty: 4, supplier: EXT, price: 4100 });
    const r = ok(await receive(rr, "P-VOID", WH_T, 4), "receive");
    const [original] = (await factsOf(r.receivingId)).rows;
    assert.equal(await onHand("P-VOID", "WAREHOUSE", "wh-t"), 4);
    const input = { receivingId: r.receivingId, correction: "VOID", reason: "recorded against the wrong delivery; nothing arrived", idempotencyKey: "corr-void-1" };
    refused(await correct(pa, input), 403, "FORBIDDEN", /requires inventory\.receipt\.correct/, "an ordinary receiver holds no correction authority");

    const out = ok(await correct(corrector, input), "void");
    assert.deepEqual([out.outcome, out.correctionKind, out.replacementReceivingId, out.compensatingMovementIds.length, out.reversedFactIds.length],
      ["applied", "VOID", null, 1, 1]);
    // 11. the original receipt is never deleted; its lines and movement are untouched.
    const rcv = await one(`SELECT status::text AS status FROM eos_ops.receiving_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, r.receivingId]);
    assert.equal(rcv.status, "CANCELLED");
    assert.deepEqual((await q(`SELECT line_id, received_quantity FROM eos_ops.receiving_order_lines WHERE tenant_id=$1 AND receiving_order_id=$2`, [TENANT, r.receivingId])).rows,
      [{ line_id: "L1", received_quantity: 4 }]);
    assert.deepEqual((await q(`SELECT movement_type::text AS t, quantity_delta AS d FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND source_id=$2`, [TENANT, r.receivingId])).rows,
      [{ t: "RECEIVED", d: 4 }], "the original RECEIVED movement is not edited");
    // 12 / 13 / 14. the correction is explicit; stock leaves through a compensating ADJUSTED movement of the SAME company.
    const corr = await one(`SELECT * FROM eos_ops.receiving_corrections WHERE tenant_id=$1 AND receiving_order_id=$2`, [TENANT, r.receivingId]);
    assert.deepEqual([corr.id, corr.correction_kind, corr.reason, corr.corrected_by, corr.operating_company_key],
      [out.correctionId, "VOID", input.reason, corrector.principalId, "taylor"]);
    assert.deepEqual((await q(`SELECT movement_type::text AS t, quantity_delta AS d, operating_company_key AS k, source_kind AS s FROM eos_ops.inventory_movements
        WHERE tenant_id=$1 AND source_id=$2`, [TENANT, out.correctionId])).rows, [{ t: "ADJUSTED", d: -4, k: "taylor", s: "RECEIVING_CORRECTION" }]);
    assert.equal(await onHand("P-VOID", "WAREHOUSE", "wh-t"), 0, "the void nets inventory to zero, never below");
    // 15 / 17. Finance: the original fact is immutable; one linked reversal; the receipt nets to zero.
    const facts = (await factsOf(r.receivingId)).rows;
    assert.equal(facts.length, 2);
    const reversal = facts.find((f) => f.reverses_fact_id === original.id);
    assert.deepEqual([reversal.amount_minor, reversal.reason, reversal.created_by, reversal.operating_company_id, reversal.counterparty_id],
      ["-16400", input.reason, corrector.principalId, "taylor", original.counterparty_id]);
    assert.deepEqual(facts.find((f) => f.id === original.id), original, "the original fact is byte-for-byte unchanged");
    assert.equal(facts.reduce((s, f) => s + BigInt(f.amount_minor), 0n), 0n);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.inventory_acquisition_costs WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, r.receivingId]), 1,
      "the cost evidence is not edited");
    assert.equal((await one(`SELECT status::text AS s FROM eos_ops.reorder_requests WHERE tenant_id=$1 AND id=$2`, [TENANT, rr])).s, "ORDERED",
      "the delivery is owed a correct receipt again");
    // 21. audit: who, when, why, the original, the correction, every affected record.
    const a = await one(`SELECT * FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='inventory.receipt.correct' AND target_id=$2`, [TENANT, r.receivingId]);
    assert.deepEqual([a.actor_uid, a.reason, a.after.receivingCorrectionId, a.after.correctionKind, a.after.compensatingMovementIds, a.after.reversedFacts[0].factId],
      [corrector.principalId, input.reason, out.correctionId, "VOID", out.compensatingMovementIds, original.id]);
    // 22. replay is idempotent; a different request on the same key, or a second correction, is refused.
    const again = ok(await correct(corrector, input), "replay");
    assert.deepEqual([again.outcome, again.correctionId], ["replayed", out.correctionId]);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, r.receivingId]), 2);
    refused(await correct(corrector, { ...input, reason: "another story" }), 409, "CONFLICT", /DIFFERENT receipt correction/);
    refused(await correct(corrector, { ...input, idempotencyKey: "corr-void-2" }), 412, "PRECONDITION_FAILED", /already cancelled/);
    // The delivery can now be received correctly through the ordinary path.
    const again2 = ok(await receive(rr, "P-VOID", WH_T, 4, `rcv-${rr}-second`), "re-receive");
    assert.equal((await factsOf(again2.receivingId)).rows.length, 1);
  });

  await t.test("16 / M. UAT-FIN-PUR-015: a CORRECTED receipt -- reversal + replacement, net consequence counted once", async () => {
    const rr = await ordered({ partId: "P-CORR", warehouseId: "wh-t", qty: 3, supplier: EXT, price: 2000 });
    const r = ok(await receive(rr, "P-CORR", WH_T, 3), "receive");
    const [original] = (await factsOf(r.receivingId)).rows;
    const out = ok(await correct(corrector, { receivingId: r.receivingId, correction: "CORRECTED", reason: "put away in bin MAIN-A-1-1, not the dock",
      idempotencyKey: "corr-loc-1", replacement: { receivingLocation: { type: "BIN", locationId: "bin_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } } }), "corrected");
    assert.equal(out.correctionKind, "CORRECTED");
    const replacement = await one(`SELECT * FROM eos_ops.receiving_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, out.replacementReceivingId]);
    assert.deepEqual([replacement.status, replacement.receiving_location_type, replacement.receiving_location_id, replacement.operating_company_key],
      ["PUTAWAY_COMPLETE", "BIN", "bin_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "taylor"]);
    assert.deepEqual([await onHand("P-CORR", "WAREHOUSE", "wh-t"), await onHand("P-CORR", "BIN", "bin_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")], [0, 3]);
    const [reversal] = (await factsOf(r.receivingId)).rows.filter((f) => f.reverses_fact_id === original.id);
    const [replaced] = (await factsOf(out.replacementReceivingId)).rows;
    assert.deepEqual([replaced.corrects_fact_id, replaced.amount_minor, replaced.reason, replaced.counterparty_id, replaced.correlation_id],
      [original.id, "6000", "put away in bin MAIN-A-1-1, not the dock", original.counterparty_id, rr]);
    // M. Analysis distinguishes ORIGINAL / REVERSAL / REPLACEMENT, and the net consequence is the amount ONCE.
    const chain = (await q(`SELECT CASE WHEN reverses_fact_id IS NOT NULL THEN 'REVERSAL' WHEN corrects_fact_id IS NOT NULL THEN 'REPLACEMENT' ELSE 'ORIGINAL' END AS role,
        amount_minor FROM eos_finance.financial_facts WHERE tenant_id=$1 AND correlation_id=$2 ORDER BY created_at, id`, [TENANT, rr])).rows;
    // One transaction writes the reversal and the replacement (same created_at), so the ROLES are asserted, not a row order.
    assert.deepEqual(chain.map((c) => c.role).sort(), ["ORIGINAL", "REPLACEMENT", "REVERSAL"]);
    assert.equal(chain.reduce((s, c) => s + BigInt(c.amount_minor), 0n), 6000n, "original + reversal + replacement = the replacement, never double");
    assert.equal(reversal.amount_minor, "-6000");
    // The correction links original -> correction -> replacement for provenance.
    assert.deepEqual(await one(`SELECT receiving_order_id, replacement_receiving_order_id FROM eos_ops.receiving_corrections WHERE tenant_id=$1 AND id=$2`,
      [TENANT, out.correctionId]), { receiving_order_id: r.receivingId, replacement_receiving_order_id: out.replacementReceivingId });
    assert.equal((await one(`SELECT status::text AS s FROM eos_ops.reorder_requests WHERE tenant_id=$1 AND id=$2`, [TENANT, rr])).s, "RECEIVED");
  });

  await t.test("18 / 19. UAT-FIN-PUR-016: stock already consumed downstream prevents the correction -- never negative stock", async () => {
    const rr = await ordered({ partId: "P-USED", warehouseId: "wh-t", qty: 3, supplier: EXT, price: 1500 });
    const r = ok(await receive(rr, "P-USED", WH_T, 3), "receive");
    // Fixture: the ledger row a governed Work Order consumption writes (2 of the 3 units used downstream).
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
               movement_type, quantity_delta, source_kind, source_id, created_by)
             VALUES ('mov-fixture-used',$1,'taylor','P-USED','NONE','WAREHOUSE','wh-t','WORK_ORDER_CONSUMPTION',-2,'WORK_ORDER','wo-fixture','fixture')`, [TENANT]);
    const factsBefore = (await factsOf(r.receivingId)).rows.length;
    refused(await correct(corrector, { receivingId: r.receivingId, correction: "VOID", reason: "wrong receipt", idempotencyKey: "corr-used-1" }),
      412, "PRECONDITION_FAILED", /only 1 of the 3 received remain/);
    assert.equal((await one(`SELECT status::text AS s FROM eos_ops.receiving_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, r.receivingId])).s, "PUTAWAY_COMPLETE");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_ops.receiving_corrections WHERE tenant_id=$1 AND receiving_order_id=$2`, [TENANT, r.receivingId]), 0);
    assert.equal((await factsOf(r.receivingId)).rows.length, factsBefore, "no reversal");
    assert.equal(await onHand("P-USED", "WAREHOUSE", "wh-t"), 1, "nothing was taken below what is there");
  });

  await t.test("20. UAT-FIN-PUR-017: a 'wrong company' correction cannot silently move ownership", async () => {
    const rr = await ordered({ partId: "P-WCO", warehouseId: "wh-t", qty: 2, supplier: EXT, price: 800 });
    const r = ok(await receive(rr, "P-WCO", WH_T, 2), "receive");
    refused(await correct(corrector, { receivingId: r.receivingId, correction: "CORRECTED", reason: "it was Ventana's", idempotencyKey: "corr-wco-1",
      replacement: { receivingLocation: WH_V } }), 412, "PRECONDITION_FAILED", /own destination warehouse/, "the replacement cannot land in another company's warehouse");
    refused(await correct(corrector, { receivingId: r.receivingId, correction: "CORRECTED", reason: "it was Ventana's", idempotencyKey: "corr-wco-2",
      replacement: { receivingLocation: WH_T, operatingCompanyKey: "ventana" } }), 400, "INVALID_INPUT", /does not accept: operatingCompanyKey/);
    // All or nothing: the refused correction left the original receipt, its stock and its fact exactly as they were.
    assert.equal((await one(`SELECT status::text AS s FROM eos_ops.receiving_orders WHERE tenant_id=$1 AND id=$2`, [TENANT, r.receivingId])).s, "PUTAWAY_COMPLETE");
    assert.equal(await onHand("P-WCO", "WAREHOUSE", "wh-t"), 2);
    assert.deepEqual((await factsOf(r.receivingId)).rows.map((f) => [f.operating_company_id, f.reverses_fact_id]), [["taylor", null]]);
  });

  await t.test("23 / 24. UAT-FIN-PUR-018: an unpriced receipt's exception is RESOLVED by its correction -- never a zero cost", async () => {
    const rr = await ordered({ partId: "P-UNP", warehouseId: "wh-t", qty: 5, supplier: EXT });
    const r = ok(await receive(rr, "P-UNP", WH_T, 5), "receive");
    const exception = await one(`SELECT * FROM eos_finance.cost_evidence_exceptions WHERE tenant_id=$1 AND receiving_id=$2`, [TENANT, r.receivingId]);
    assert.equal(exception.condition, "COST_EVIDENCE_MISSING");
    const out = ok(await correct(corrector, { receivingId: r.receivingId, correction: "VOID", reason: "duplicate entry", idempotencyKey: "corr-unp-1" }), "void unpriced");
    assert.deepEqual([out.reversedFactIds, out.resolvedExceptionIds], [[], [exception.id]]);
    assert.deepEqual(await one(`SELECT resolution, receiving_correction_id, resolved_by FROM eos_finance.cost_evidence_exception_resolutions WHERE exception_id=$1`, [exception.id]),
      { resolution: "RECEIPT_VOIDED", receiving_correction_id: out.correctionId, resolved_by: corrector.principalId });
    assert.deepEqual(await one(`SELECT * FROM eos_finance.cost_evidence_exceptions WHERE id=$1`, [exception.id]), exception, "the exception itself is not edited");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND amount_minor = 0`, [TENANT]), 0);
    // 24. No governed path establishes a LATER price (the PO is immutable, no price amendment): the resolution vocabulary refuses it.
    await assert.rejects(q(`INSERT INTO eos_finance.cost_evidence_exception_resolutions (exception_id, tenant_id, resolution, receiving_correction_id, reason, resolved_by)
        VALUES ($1,$2,'COST_EVIDENCE_ESTABLISHED',$3,'x','x')`, [exception.id, TENANT, out.correctionId]));
    await assert.rejects(q(`UPDATE eos_ops.receiving_corrections SET reason='rewritten' WHERE id=$1`, [out.correctionId]), /RECEIVING_CORRECTION_IMMUTABLE/);
  });

  await t.test("UAT-FIN-PUR-020: authority -- Warehouse / Parts Manager correct within WAREHOUSE scope; associates are refused", async () => {
    const receipt = async (partId) => {
      const rr = await ordered({ partId, warehouseId: "wh-t", qty: 1, supplier: EXT, price: 100 });
      return ok(await receive(rr, partId, WH_T, 1), "receive").receivingId;
    };
    const voidOf = (receivingId, key) => ({ receivingId, correction: "VOID", reason: "authority acceptance", idempotencyKey: key });
    const r1 = await receipt("P-AUTH1");
    refused(await correct(whAssoc, voidOf(r1, "auth-wa")), 403, "FORBIDDEN", /requires inventory\.receipt\.correct/, "Warehouse Associate");
    refused(await correct(pa, voidOf(r1, "auth-pa")), 403, "FORBIDDEN", /requires inventory\.receipt\.correct/, "Parts Associate (an ordinary receiver)");
    assert.equal(ok(await correct(partsMgr, voidOf(r1, "auth-pm")), "Parts Manager").outcome, "applied");
    const r2 = await receipt("P-AUTH2");
    assert.equal(ok(await correct(corrector, voidOf(r2, "auth-wm")), "Warehouse Manager").outcome, "applied");
    // WAREHOUSE scope is preserved: the Parts Manager without scope over the receipt location is refused.
    await q(`UPDATE eos_workforce.employee_operational_scopes SET effective_to = now(), ended_by = 'fixture', ended_at = now()
        WHERE tenant_id=$1 AND employee_id='e-pmgr' AND scope_type='WAREHOUSE'`, [TENANT]);
    const r3 = await receipt("P-AUTH3");
    refused(await correct(partsMgr, voidOf(r3, "auth-pm-noscope")), 403, "FORBIDDEN", /outside your warehouse scope/, "Parts Manager outside its warehouse scope");
    // Receipt correction stays DISTINCT from receipt: the receivers hold inventory.stock.receive without the correction.
    const holders = async (key) => (await q(`SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
        JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key = $2 ORDER BY 1`, [TENANT, key])).rows.map((x) => x.key);
    assert.deepEqual(await holders("inventory.receipt.correct"), ["partsManager", "warehouseManager"]);
    for (const excluded of closure.RECEIPT_CORRECTION_EXCLUDED_ROLE_KEYS) assert.equal((await holders("inventory.receipt.correct")).includes(excluded), false, excluded);
    assert.ok((await holders("inventory.stock.receive")).includes("inventoryReceivingClerk"));
    // MANAGEABLE THROUGH ADMINISTRATION, no source edit: revoke -> refused; re-grant -> allowed again.
    const wmCorrect = { roleKey: "warehouseManager", objectKey: "receivingOrder", actionKey: "correct" };
    assert.equal((await admin("revokeObjectActionFromRole", { ...wmCorrect, reason: "administration acceptance" })).ok, true);
    refused(await correct(corrector, voidOf(r3, "auth-wm-revoked")), 403, "FORBIDDEN", /requires inventory\.receipt\.correct/, "after an Administration revoke");
    assert.equal((await admin("grantObjectActionToRole", { ...wmCorrect, reason: "administration acceptance" })).ok, true);
    assert.equal(ok(await correct(corrector, voidOf(r3, "auth-wm-regranted")), "after an Administration re-grant").outcome, "applied");
  });

  await t.test("UAT-FIN-PUR-021: the Parts Manager finance AUTHORITY DEFECT is corrected through Administration -- nothing else moves", async () => {
    const after = await capabilitiesForRoleKeys(pool, TENANT, ["partsManager"]);
    assert.ok(partsManagerFinanceBefore.has("finance.invoice.issue") && partsManagerFinanceBefore.has("finance.adjustment.record"), "the defect was present");
    const fin = (set) => [...set].filter((k) => k.startsWith("finance.")).sort();
    assert.deepEqual(fin(after), ["finance.invoice.read", "finance.payment.read"], "Parts Manager keeps only the finance READS");
    const removed = [...partsManagerFinanceBefore].filter((k) => !after.has(k)).sort();
    const added = [...after].filter((k) => !partsManagerFinanceBefore.has(k)).sort();
    assert.deepEqual([removed, added], [["finance.adjustment.record", "finance.invoice.issue"], ["inventory.receipt.correct"]]);
    // The capabilities themselves remain, held by the finance Roles -- Finance authority is not weakened.
    for (const key of ["finance.invoice.issue", "finance.adjustment.record"]) {
      assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key=$1`, [key]), 1);
      for (const role of ["controller", "accountingManager", "financeManager"]) {
        assert.ok((await capabilitiesForRoleKeys(pool, TENANT, [role])).has(key), `${role} keeps ${key}`);
      }
    }
    // A normal purchasing employee needs no Finance authority to buy and receive.
    const paCaps = await capabilitiesForRoleKeys(pool, TENANT, ["partsAssociate", "inventoryReceivingClerk"]);
    assert.equal([...paCaps].some((k) => /^finance\.(invoice\.issue|adjustment|payment\.apply|refund)/.test(k)), false);
  });

  await t.test("25 / 26. no client writes Finance truth; the corrector holds no Finance write capability", async () => {
    refused(await inv(corrector, "reverseFinancialFact", { factId: "x" }), 404, "UNKNOWN_OPERATION");
    const caps = (await q(`SELECT DISTINCT c.key FROM eos_policy.user_role_assignments a JOIN eos_policy.role_capabilities rc ON rc.tenant_id=a.tenant_id AND rc.role_id=a.role_id
        JOIN eos_policy.capabilities c ON c.id=rc.capability_id WHERE a.tenant_id=$1 AND a.principal_id=$2 AND a.status='active' AND c.key LIKE 'finance.%'`,
      [TENANT, corrector.principalId])).rows.map((x) => x.key);
    assert.deepEqual(caps, [], "the corrector holds NO finance.* capability at all -- the Finance consequence needs none");
  });
});
